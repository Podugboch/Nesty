package ws

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// WebSocket upgrader
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// SafeConn wraps websocket.Conn with a mutex to avoid concurrent write panics
type SafeConn struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func (sc *SafeConn) WriteMessage(messageType int, data []byte) error {
	sc.mu.Lock()
	defer sc.mu.Unlock()
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

type Hub struct {
	mu          sync.RWMutex
	Clients     map[*SafeConn]uint
	UserConns   map[uint]map[*SafeConn]bool
	BroadcastC  chan []byte
	Register    chan registration
	Unregister  chan *SafeConn
	SendToUserC chan userMessage
}

func NewHub() *Hub {
	return &Hub{
		Clients:     make(map[*SafeConn]uint),
		UserConns:   make(map[uint]map[*SafeConn]bool),
		BroadcastC:  make(chan []byte, 256),
		Register:    make(chan registration),
		Unregister:  make(chan *SafeConn),
		SendToUserC: make(chan userMessage, 256),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case reg := <-h.Register:
			h.mu.Lock()
			h.Clients[reg.conn] = reg.userID
			if h.UserConns[reg.userID] == nil {
				h.UserConns[reg.userID] = make(map[*SafeConn]bool)
			}
			h.UserConns[reg.userID][reg.conn] = true
			h.mu.Unlock()
			log.Println("client registered, user:", reg.userID)

		case sc := <-h.Unregister:
			h.mu.Lock()
			if uid, ok := h.Clients[sc]; ok {
				delete(h.Clients, sc)
				if conns, exists := h.UserConns[uid]; exists {
					delete(conns, sc)
					if len(conns) == 0 {
						delete(h.UserConns, uid)
					}
				}
				sc.Close()
				log.Println("client unregistered, user:", uid)
			}
			h.mu.Unlock()

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

		// Handle client-side heartbeat ping
		var raw map[string]interface{}
		if err := json.Unmarshal(msg, &raw); err == nil {
			if msgType, ok := raw["type"].(string); ok && msgType == "ping" {
				sc.WriteMessage(websocket.TextMessage, []byte(`{"type":"pong"}`))
				continue
			}

			// Handle targeted signaling message if 'to_user_id' is present
			if target, ok := raw["to_user_id"]; ok {
				var targetID uint
				switch v := target.(type) {
				case float64:
					targetID = uint(v)
				case int:
					targetID = uint(v)
				}
				if targetID > 0 {
					raw["from_user_id"] = userID
					if _, hasEvent := raw["event"]; !hasEvent {
						raw["event"] = "call_signal"
					}
					outMsg, _ := json.Marshal(raw)
					h.SendToUser(targetID, outMsg)
					continue
				}
			}
		}

		h.Broadcast(string(msg))
	}
}

// Broadcast sends a message to all connected clients
func (h *Hub) Broadcast(msg string) {
	h.BroadcastC <- []byte(msg)
}

// SendToUser delivers a message to all connections belonging to the given userID
func (h *Hub) SendToUser(userID uint, msg []byte) bool {
	h.mu.RLock()
	conns, exists := h.UserConns[userID]
	if !exists || len(conns) == 0 {
		h.mu.RUnlock()
		return false
	}
	list := make([]*SafeConn, 0, len(conns))
	for sc := range conns {
		list = append(list, sc)
	}
	h.mu.RUnlock()

	sentCount := 0
	for _, sc := range list {
		if err := sc.WriteMessage(websocket.TextMessage, msg); err == nil {
			sentCount++
		}
	}
	return sentCount > 0
}

// IsUserOnline returns true if the user currently has at least one active WebSocket connection
func (h *Hub) IsUserOnline(userID uint) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	conns, exists := h.UserConns[userID]
	return exists && len(conns) > 0
}

// GetOnlineUserIDs returns a slice of all user IDs with active connections
func (h *Hub) GetOnlineUserIDs() []uint {
	h.mu.RLock()
	defer h.mu.RUnlock()
	ids := make([]uint, 0, len(h.UserConns))
	for uid, conns := range h.UserConns {
		if len(conns) > 0 {
			ids = append(ids, uid)
		}
	}
	return ids
}