package ws

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
)

// WebSocket upgrader tuned for 100k concurrency (low memory buffer footprint + compression)
var upgrader = websocket.Upgrader{
	CheckOrigin:       func(r *http.Request) bool { return true },
	ReadBufferSize:    1024,
	WriteBufferSize:   1024,
	EnableCompression: true,
}

// SafeConn wraps websocket.Conn with a mutex and strict write deadlines to avoid hung sockets
type SafeConn struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func (sc *SafeConn) WriteMessage(messageType int, data []byte) error {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	_ = sc.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	return sc.conn.WriteMessage(messageType, data)
}

func (sc *SafeConn) Close() error {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	return sc.conn.Close()
}

// registration carries a new connection along with the authenticated user it belongs to
type registration struct {
	conn   *SafeConn
	userID uint
}

// userMessage is a targeted message for a single user
type userMessage struct {
	userID  uint
	payload []byte
}

type CallSignalHandler func(fromUserID uint, toUserID uint, raw map[string]interface{})

type clusterMessage struct {
	SourceInstance string          `json:"source_instance"`
	Type           string          `json:"type"` // "broadcast", "user_message", "presence"
	TargetUserID   uint            `json:"target_user_id,omitempty"`
	Payload        json.RawMessage `json:"payload"`
}

type Hub struct {
	mu           sync.RWMutex
	Clients      map[*SafeConn]uint
	UserConns    map[uint]map[*SafeConn]bool
	UserSSEConns map[uint]map[chan []byte]bool
	UserLastSeen map[uint]time.Time
	BroadcastC   chan []byte
	Register     chan registration
	Unregister   chan *SafeConn
	SendToUserC  chan userMessage
	OnCallSignal CallSignalHandler

	// Multi-instance distributed Redis clustering
	redisClient *redis.Client
	instanceID  string
}

func NewHub() *Hub {
	h := &Hub{
		Clients:      make(map[*SafeConn]uint),
		UserConns:    make(map[uint]map[*SafeConn]bool),
		UserSSEConns: make(map[uint]map[chan []byte]bool),
		UserLastSeen: make(map[uint]time.Time),
		BroadcastC:   make(chan []byte, 1024),
		Register:     make(chan registration, 256),
		Unregister:   make(chan *SafeConn, 256),
		SendToUserC:  make(chan userMessage, 1024),
		instanceID:   fmt.Sprintf("%d-%d", os.Getpid(), time.Now().UnixNano()),
	}

	h.initRedis()
	return h
}

func (h *Hub) Run() {
	for {
		select {
		case reg := <-h.Register:
			h.mu.Lock()
			isFirst := len(h.UserConns[reg.userID]) == 0
			h.Clients[reg.conn] = reg.userID
			if h.UserConns[reg.userID] == nil {
				h.UserConns[reg.userID] = make(map[*SafeConn]bool)
			}
			h.UserConns[reg.userID][reg.conn] = true
			if h.UserLastSeen == nil {
				h.UserLastSeen = make(map[uint]time.Time)
			}
			h.UserLastSeen[reg.userID] = time.Now()
			h.mu.Unlock()
			log.Println("client registered, user:", reg.userID)
			if isFirst {
				go h.BroadcastPresence(reg.userID, true)
			}

		case sc := <-h.Unregister:
			h.mu.Lock()
			var unregUID uint
			var isLast bool
			if uid, ok := h.Clients[sc]; ok {
				unregUID = uid
				delete(h.Clients, sc)
				if conns, exists := h.UserConns[uid]; exists {
					delete(conns, sc)
					if len(conns) == 0 {
						delete(h.UserConns, uid)
						isLast = true
					}
				}
				sc.Close()
				log.Println("client unregistered, user:", uid)
			}
			h.mu.Unlock()
			if isLast && unregUID > 0 {
				h.mu.RLock()
				lastSeen, hasLast := h.UserLastSeen[unregUID]
				isRecent := hasLast && time.Since(lastSeen) < 2*time.Minute
				h.mu.RUnlock()
				// Keep user marked online if recently active (e.g. app minimized or reconnecting)
				if !isRecent {
					go h.BroadcastPresence(unregUID, false)
				}
			}

		case message := <-h.BroadcastC:
			h.mu.RLock()
			for sc := range h.Clients {
				go sc.WriteMessage(websocket.TextMessage, message)
			}
			h.mu.RUnlock()

		case um := <-h.SendToUserC:
			h.mu.RLock()
			if conns, exists := h.UserConns[um.userID]; exists {
				for sc := range conns {
					go sc.WriteMessage(websocket.TextMessage, um.payload)
				}
			}
			h.mu.RUnlock()
		}
	}
}

// HandleConnections upgrades the HTTP connection to a WebSocket and registers
// it under the given authenticated userID.
func (h *Hub) HandleConnections(w http.ResponseWriter, r *http.Request, userID uint) {
	wsConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Upgrade error:", err)
		return
	}

	sc := &SafeConn{conn: wsConn}
	h.Register <- registration{conn: sc, userID: userID}

	// Keep connection alive across proxies (Render, Cloudflare) with periodic pings
	ticker := time.NewTicker(25 * time.Second)
	stopPing := make(chan struct{})
	defer func() {
		ticker.Stop()
		close(stopPing)
		h.Unregister <- sc
	}()

	go func() {
		for {
			select {
			case <-ticker.C:
				if err := sc.WriteMessage(websocket.PingMessage, []byte{}); err != nil {
					return
				}
			case <-stopPing:
				return
			}
		}
	}()

	wsConn.SetPongHandler(func(string) error {
		return nil
	})

	for {
		_, msg, err := wsConn.ReadMessage()
		if err != nil {
			break
		}

		// Handle client-side heartbeat ping & touch presence
		var raw map[string]interface{}
		if err := json.Unmarshal(msg, &raw); err == nil {
			h.TouchUser(userID)
			if msgType, ok := raw["type"].(string); ok && msgType == "ping" {
				sc.WriteMessage(websocket.TextMessage, []byte(`{"type":"pong"}`))
				continue
			}

			// Handle targeted signaling message if 'to_user_id' is present
			if target, ok := raw["to_user_id"]; ok && target != nil {
				var targetID uint
				switch v := target.(type) {
				case float64:
					targetID = uint(v)
				case int:
					targetID = uint(v)
				case int64:
					targetID = uint(v)
				case string:
					if parsed, parseErr := strconv.ParseUint(v, 10, 32); parseErr == nil {
						targetID = uint(parsed)
					}
				case json.Number:
					if parsed, parseErr := v.Int64(); parseErr == nil {
						targetID = uint(parsed)
					}
				}

				if targetID > 0 {
					raw["from_user_id"] = userID
					if _, hasEvent := raw["event"]; !hasEvent {
						raw["event"] = "call_signal"
					}
					outMsg, _ := json.Marshal(raw)
					delivered := h.SendToUser(targetID, outMsg)

					// Trigger callback for push notification / background wake-up
					if h.OnCallSignal != nil {
						go h.OnCallSignal(userID, targetID, raw)
					}

					// Log if callee is offline
					if !delivered {
						log.Printf("[Hub] Targeted message to user %d could not be delivered directly (user offline)", targetID)
					}
				}

				// CRITICAL FIX: Targeted WebRTC signals must NEVER fall through to h.Broadcast!
				continue
			}

			// CRITICAL FIX: Guard against untargeted call_signal broadcast leaks
			if ev, ok := raw["event"].(string); ok && ev == "call_signal" {
				continue
			}
			if typ, ok := raw["type"].(string); ok && strings.HasPrefix(typ, "call_") {
				continue
			}
		}

		h.Broadcast(string(msg))
	}
}

func (h *Hub) initRedis() {
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = os.Getenv("REDIS_TLS_URL")
	}
	if redisURL == "" {
		log.Println("[Hub] REDIS_URL not set; running in high-performance standalone in-memory mode")
		return
	}

	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Printf("[Hub] Failed to parse REDIS_URL: %v; running in standalone mode", err)
		return
	}

	opt.PoolSize = 50
	opt.MinIdleConns = 10
	opt.DialTimeout = 3 * time.Second
	opt.ReadTimeout = 3 * time.Second
	opt.WriteTimeout = 3 * time.Second

	rdb := redis.NewClient(opt)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Printf("[Hub] Redis ping failed: %v; running in standalone mode", err)
		return
	}

	h.redisClient = rdb
	log.Printf("[Hub] Successfully connected to Redis for multi-instance clustering (Instance ID: %s)", h.instanceID)

	// Subscribe to Redis broadcast & signaling channels
	go h.listenRedis()
}

func (h *Hub) listenRedis() {
	if h.redisClient == nil {
		return
	}
	ctx := context.Background()
	pubsub := h.redisClient.Subscribe(ctx, "nesty:cluster:events")
	ch := pubsub.Channel()

	for msg := range ch {
		var cm clusterMessage
		if err := json.Unmarshal([]byte(msg.Payload), &cm); err != nil {
			continue
		}
		// Ignore self-published messages to prevent duplicate delivery
		if cm.SourceInstance == h.instanceID {
			continue
		}

		switch cm.Type {
		case "broadcast":
			h.mu.RLock()
			conns := make([]*SafeConn, 0, len(h.Clients))
			for sc := range h.Clients {
				conns = append(conns, sc)
			}
			h.mu.RUnlock()
			for _, sc := range conns {
				go sc.WriteMessage(websocket.TextMessage, cm.Payload)
			}

		case "user_message":
			if cm.TargetUserID > 0 {
				h.deliverLocalUserMessage(cm.TargetUserID, cm.Payload)
			}

		case "presence":
			h.mu.RLock()
			conns := make([]*SafeConn, 0, len(h.Clients))
			for sc := range h.Clients {
				conns = append(conns, sc)
			}
			h.mu.RUnlock()
			for _, sc := range conns {
				go sc.WriteMessage(websocket.TextMessage, cm.Payload)
			}
		}
	}
}

// Broadcast sends a message to all connected clients locally and across all cluster nodes
func (h *Hub) Broadcast(msg string) {
	h.BroadcastC <- []byte(msg)

	if h.redisClient != nil {
		cm := clusterMessage{
			SourceInstance: h.instanceID,
			Type:           "broadcast",
			Payload:        json.RawMessage(msg),
		}
		if data, err := json.Marshal(cm); err == nil {
			go func() {
				ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
				defer cancel()
				_ = h.redisClient.Publish(ctx, "nesty:cluster:events", data).Err()
			}()
		}
	}
}

// RegisterSSE registers a native Server-Sent Events channel for targeted call events
func (h *Hub) RegisterSSE(userID uint, ch chan []byte) {
	if userID == 0 || ch == nil {
		return
	}
	h.mu.Lock()
	if h.UserSSEConns == nil {
		h.UserSSEConns = make(map[uint]map[chan []byte]bool)
	}
	if h.UserSSEConns[userID] == nil {
		h.UserSSEConns[userID] = make(map[chan []byte]bool)
	}
	h.UserSSEConns[userID][ch] = true
	if h.UserLastSeen == nil {
		h.UserLastSeen = make(map[uint]time.Time)
	}
	h.UserLastSeen[userID] = time.Now()
	h.mu.Unlock()
	log.Printf("[Hub] Registered native SSE listener for user %d (total active SSE channels: %d)", userID, len(h.UserSSEConns[userID]))
}

// UnregisterSSE removes a native Server-Sent Events channel
func (h *Hub) UnregisterSSE(userID uint, ch chan []byte) {
	if userID == 0 || ch == nil {
		return
	}
	h.mu.Lock()
	if h.UserSSEConns != nil && h.UserSSEConns[userID] != nil {
		delete(h.UserSSEConns[userID], ch)
		if len(h.UserSSEConns[userID]) == 0 {
			delete(h.UserSSEConns, userID)
		}
	}
	h.mu.Unlock()
	log.Printf("[Hub] Unregistered native SSE listener for user %d", userID)
}

// deliverLocalUserMessage delivers a message to local WebSocket and SSE connections
func (h *Hub) deliverLocalUserMessage(userID uint, payload []byte) bool {
	h.mu.RLock()
	conns, existsWS := h.UserConns[userID]
	sseConns, existsSSE := h.UserSSEConns[userID]
	if (!existsWS || len(conns) == 0) && (!existsSSE || len(sseConns) == 0) {
		h.mu.RUnlock()
		return false
	}

	wsList := make([]*SafeConn, 0, len(conns))
	for sc := range conns {
		wsList = append(wsList, sc)
	}

	sseList := make([]chan []byte, 0, len(sseConns))
	for ch := range sseConns {
		sseList = append(sseList, ch)
	}
	h.mu.RUnlock()

	sentCount := 0
	for _, sc := range wsList {
		if err := sc.WriteMessage(websocket.TextMessage, payload); err == nil {
			sentCount++
		}
	}
	for _, ch := range sseList {
		select {
		case ch <- payload:
			sentCount++
		default:
			log.Printf("[Hub] SSE channel for user %d was full, dropping message", userID)
		}
	}
	return sentCount > 0
}

// SendToUser delivers a message to all connections (WebSocket + Native SSE) belonging to the given userID
// If Redis clustering is active, it also publishes to the cluster to reach nodes hosting the user's connection.
func (h *Hub) SendToUser(userID uint, msg []byte) bool {
	deliveredLocal := h.deliverLocalUserMessage(userID, msg)

	if h.redisClient != nil {
		cm := clusterMessage{
			SourceInstance: h.instanceID,
			Type:           "user_message",
			TargetUserID:   userID,
			Payload:        json.RawMessage(msg),
		}
		if data, err := json.Marshal(cm); err == nil {
			go func() {
				ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
				defer cancel()
				_ = h.redisClient.Publish(ctx, "nesty:cluster:events", data).Err()
			}()
		}
	}

	return deliveredLocal
}

// TouchUser updates the user's last active timestamp so presence is maintained even if app is minimized
func (h *Hub) TouchUser(userID uint) {
	if userID == 0 {
		return
	}
	h.mu.Lock()
	if h.UserLastSeen == nil {
		h.UserLastSeen = make(map[uint]time.Time)
	}
	h.UserLastSeen[userID] = time.Now()
	h.mu.Unlock()

	if h.redisClient != nil {
		go func(uid uint) {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			_ = h.redisClient.ZAdd(ctx, "nesty:presence", redis.Z{
				Score:  float64(time.Now().Unix()),
				Member: uid,
			}).Err()
		}(userID)
	}
}

// RemoveUserPresence completely clears presence on explicit logout
func (h *Hub) RemoveUserPresence(userID uint) {
	if userID == 0 {
		return
	}
	h.mu.Lock()
	if h.UserLastSeen != nil {
		delete(h.UserLastSeen, userID)
	}
	delete(h.UserConns, userID)
	if h.UserSSEConns != nil {
		delete(h.UserSSEConns, userID)
	}
	h.mu.Unlock()

	if h.redisClient != nil {
		go func(uid uint) {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			_ = h.redisClient.ZRem(ctx, "nesty:presence", uid).Err()
		}(userID)
	}
	go h.BroadcastPresence(userID, false)
}

// IsUserOnline returns true if user has active WebSocket connections, native SSE connections, or was active within 2 minutes
func (h *Hub) IsUserOnline(userID uint) bool {
	h.mu.RLock()
	if conns, exists := h.UserConns[userID]; exists && len(conns) > 0 {
		h.mu.RUnlock()
		return true
	}
	if sseConns, exists := h.UserSSEConns[userID]; exists && len(sseConns) > 0 {
		h.mu.RUnlock()
		return true
	}
	if lastSeen, ok := h.UserLastSeen[userID]; ok {
		if time.Since(lastSeen) < 2*time.Minute {
			h.mu.RUnlock()
			return true
		}
	}
	h.mu.RUnlock()

	if h.redisClient != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
		defer cancel()
		score, err := h.redisClient.ZScore(ctx, "nesty:presence", strconv.FormatUint(uint64(userID), 10)).Result()
		if err == nil {
			return (time.Now().Unix() - int64(score)) < 120
		}
	}
	return false
}

// GetOnlineUserIDs returns a slice of all user IDs with active connections or recent activity
func (h *Hub) GetOnlineUserIDs() []uint {
	seen := make(map[uint]bool)
	ids := make([]uint, 0)

	h.mu.RLock()
	for uid, conns := range h.UserConns {
		if len(conns) > 0 {
			seen[uid] = true
			ids = append(ids, uid)
		}
	}
	for uid, lastSeen := range h.UserLastSeen {
		if !seen[uid] && time.Since(lastSeen) < 2*time.Minute {
			seen[uid] = true
			ids = append(ids, uid)
		}
	}
	h.mu.RUnlock()

	if h.redisClient != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		minScore := strconv.FormatInt(time.Now().Unix()-120, 10)
		redisMembers, err := h.redisClient.ZRangeByScore(ctx, "nesty:presence", &redis.ZRangeBy{
			Min: minScore,
			Max: "+inf",
		}).Result()
		if err == nil {
			for _, m := range redisMembers {
				if uid, parseErr := strconv.ParseUint(m, 10, 32); parseErr == nil {
					if !seen[uint(uid)] {
						seen[uint(uid)] = true
						ids = append(ids, uint(uid))
					}
				}
			}
		}
	}

	return ids
}

// BroadcastPresence sends a presence notification to all connected clients
func (h *Hub) BroadcastPresence(userID uint, online bool) {
	msg, err := json.Marshal(map[string]interface{}{
		"event":   "presence",
		"user_id": userID,
		"online":  online,
	})
	if err != nil {
		return
	}
	h.mu.RLock()
	conns := make([]*SafeConn, 0, len(h.Clients))
	for sc := range h.Clients {
		conns = append(conns, sc)
	}
	h.mu.RUnlock()

	for _, sc := range conns {
		go sc.WriteMessage(websocket.TextMessage, msg)
	}

	if h.redisClient != nil {
		cm := clusterMessage{
			SourceInstance: h.instanceID,
			Type:           "presence",
			Payload:        json.RawMessage(msg),
		}
		if data, err := json.Marshal(cm); err == nil {
			go func() {
				ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
				defer cancel()
				_ = h.redisClient.Publish(ctx, "nesty:cluster:events", data).Err()
			}()
		}
	}
}