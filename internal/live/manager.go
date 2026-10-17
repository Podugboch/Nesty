package live

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"
	"piscine-devnest/internal/model"
	"piscine-devnest/internal/ws"
)

// Participant in a live room
type Participant struct {
	UserID    uint      `json:"user_id"`
	Username  string    `json:"username"`
	Name      string    `json:"name"`
	AvatarURL string    `json:"avatar_url"`
	Role      string    `json:"role"` // "host", "moderator", "guest", "viewer"
	JoinedAt  time.Time `json:"joined_at"`
}

// Guest on stage (max 3)
type Guest struct {
	UserID    uint   `json:"user_id"`
	Username  string `json:"username"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
	AudioOnly bool   `json:"audio_only"`
	VideoOff  bool   `json:"video_off"`
	Muted     bool   `json:"muted"`
}

// HandRaise item in host's queue
type HandRaise struct {
	UserID    uint      `json:"user_id"`
	Username  string    `json:"username"`
	Name      string    `json:"name"`
	AvatarURL string    `json:"avatar_url"`
	RaisedAt  time.Time `json:"raised_at"`
}

// ChatMessageItem for live chat
type ChatMessageItem struct {
	ID        string    `json:"id"`
	LiveID    uint      `json:"live_id"`
	UserID    uint      `json:"user_id"`
	Username  string    `json:"username"`
	Name      string    `json:"name"`
	AvatarURL string    `json:"avatar_url"`
	Text      string    `json:"text"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"created_at"`
	TimeAgo   string    `json:"time"`
}

// LiveRoom maintains live session state in memory
type LiveRoom struct {
	mu           sync.RWMutex
	LiveID       uint
	HostID       uint
	Title        string
	SaveReplay   bool
	Status       string // "live", "ended"
	StartedAt    time.Time
	ChatSettings model.ChatSettings

	Viewers   map[uint]*Participant
	Guests    map[uint]*Guest // capped at 3
	HandQueue []*HandRaise

	// Cached permissions
	Roles map[uint]string     // "host", "moderator", "guest", "viewer"
	Bans  map[uint]*time.Time // nil = permanent ban; timestamp = timeout

	// Rate limiting & batching
	UserLastChat map[uint]time.Time
	UserTaps     map[uint][]time.Time // timestamps of reaction taps in current window
	UserLastHand map[uint]time.Time

	// 500ms reaction aggregator
	ReactionCounts  map[string]int
	TotalReactions  int
	reactionsTicker *time.Ticker
	stopTicker      chan struct{}

	// Disconnect grace period (60s)
	disconnectTimer *time.Timer
	HostConnected   bool
}

type LiveManager struct {
	db           *gorm.DB
	hub          *ws.Hub
	roomsMu      sync.RWMutex
	rooms        map[uint]*LiveRoom
	userRoomsMu  sync.RWMutex
	userRooms    map[uint]map[uint]bool // userID -> set of liveIDs
}

func NewLiveManager(db *gorm.DB, hub *ws.Hub) *LiveManager {
	return &LiveManager{
		db:        db,
		hub:       hub,
		rooms:     make(map[uint]*LiveRoom),
		userRooms: make(map[uint]map[uint]bool),
	}
}

// CreateRoom initializes a live broadcast room
func (m *LiveManager) CreateRoom(live *model.Live) *LiveRoom {
	m.roomsMu.Lock()
	defer m.roomsMu.Unlock()

	if existing, ok := m.rooms[live.ID]; ok && existing.Status == "live" {
		return existing
	}

	cs := live.GetChatSettings()

	room := &LiveRoom{
		LiveID:          live.ID,
		HostID:          live.HostID,
		Title:           live.Title,
		SaveReplay:      live.SaveReplay,
		Status:          "live",
		StartedAt:       live.StartedAt,
		ChatSettings:    cs,
		Viewers:         make(map[uint]*Participant),
		Guests:          make(map[uint]*Guest),
		HandQueue:       make([]*HandRaise, 0),
		Roles:           make(map[uint]string),
		Bans:            make(map[uint]*time.Time),
		UserLastChat:    make(map[uint]time.Time),
		UserTaps:        make(map[uint][]time.Time),
		UserLastHand:    make(map[uint]time.Time),
		ReactionCounts:  make(map[string]int),
		TotalReactions:  live.TotalReactions,
		reactionsTicker: time.NewTicker(500 * time.Millisecond),
		stopTicker:      make(chan struct{}),
		HostConnected:   true,
	}

	room.Roles[live.HostID] = "host"
	m.rooms[live.ID] = room

	// Start 500ms reaction batch broadcaster
	go room.runReactionsBatcher(m)

	return room
}

// GetRoom retrieves active room
func (m *LiveManager) GetRoom(liveID uint) *LiveRoom {
	m.roomsMu.RLock()
	defer m.roomsMu.RUnlock()
	return m.rooms[liveID]
}

// JoinRoom registers a user into a live session
func (m *LiveManager) JoinRoom(liveID uint, user *model.User) (*LiveRoom, string, error) {
	room := m.GetRoom(liveID)
	if room == nil {
		// Attempt to load from database if active
		var dbLive model.Live
		if err := m.db.First(&dbLive, liveID).Error; err != nil || dbLive.Status != "live" {
			return nil, "", errors.New("live stream not found or has ended")
		}
		room = m.CreateRoom(&dbLive)
	}

	room.mu.Lock()
	defer room.mu.Unlock()

	if room.Status != "live" {
		return nil, "", errors.New("live stream has ended")
	}

	// 1. Check if user is banned or timed out from this live
	if until, exists := room.Bans[user.ID]; exists {
		if until == nil {
			return nil, "", errors.New("you have been removed from this live broadcast")
		}
		if time.Now().Before(*until) {
			remaining := int(time.Until(*until).Seconds())
			return nil, "", fmt.Errorf("you are timed out from this live for %d more seconds", remaining)
		}
		// Timeout expired
		delete(room.Bans, user.ID)
	} else {
		// Check database for existing ban
		var ban model.LiveBan
		if err := m.db.Where("live_id = ? AND user_id = ?", liveID, user.ID).First(&ban).Error; err == nil {
			if ban.Until == nil {
				room.Bans[user.ID] = nil
				return nil, "", errors.New("you have been removed from this live broadcast")
			}
			if time.Now().Before(*ban.Until) {
				room.Bans[user.ID] = ban.Until
				remaining := int(time.Until(*ban.Until).Seconds())
				return nil, "", fmt.Errorf("you are timed out from this live for %d more seconds", remaining)
			}
		}
	}

	// 2. Determine user role
	role := "viewer"
	if user.ID == room.HostID {
		role = "host"
		room.HostConnected = true
		if room.disconnectTimer != nil {
			room.disconnectTimer.Stop()
			room.disconnectTimer = nil
		}
	} else if r, ok := room.Roles[user.ID]; ok {
		role = r
	} else {
		var liveRole model.LiveRole
		if err := m.db.Where("live_id = ? AND user_id = ?", liveID, user.ID).First(&liveRole).Error; err == nil {
			role = liveRole.Role
			room.Roles[user.ID] = role
		}
	}

	room.Roles[user.ID] = role

	// Add to viewers
	room.Viewers[user.ID] = &Participant{
		UserID:    user.ID,
		Username:  user.Username,
		Name:      user.Name,
		AvatarURL: user.AvatarURL,
		Role:      role,
		JoinedAt:  time.Now(),
	}

	m.userRoomsMu.Lock()
	if m.userRooms[user.ID] == nil {
		m.userRooms[user.ID] = make(map[uint]bool)
	}
	m.userRooms[user.ID][liveID] = true
	m.userRoomsMu.Unlock()

	viewerCount := len(room.Viewers)

	// Broadcast updated viewer count asynchronously
	go func(lid uint, count int) {
		m.BroadcastToLive(lid, map[string]interface{}{
			"type":         "live_viewer_count",
			"live_id":      lid,
			"viewer_count": count,
		})
	}(liveID, viewerCount)

	return room, role, nil
}

// LeaveRoom removes a user from a live room
func (m *LiveManager) LeaveRoom(liveID uint, userID uint) {
	room := m.GetRoom(liveID)
	if room == nil {
		return
	}

	room.mu.Lock()
	delete(room.Viewers, userID)

	// Remove from stage if guest
	wasGuest := false
	if _, ok := room.Guests[userID]; ok {
		delete(room.Guests, userID)
		wasGuest = true
	}

	// Remove from hand raise queue
	cleanedQueue := make([]*HandRaise, 0, len(room.HandQueue))
	for _, h := range room.HandQueue {
		if h.UserID != userID {
			cleanedQueue = append(cleanedQueue, h)
		}
	}
	room.HandQueue = cleanedQueue
	viewerCount := len(room.Viewers)
	room.mu.Unlock()

	m.userRoomsMu.Lock()
	if conns := m.userRooms[userID]; conns != nil {
		delete(conns, liveID)
		if len(conns) == 0 {
			delete(m.userRooms, userID)
		}
	}
	m.userRoomsMu.Unlock()

	if wasGuest {
		m.BroadcastToLive(liveID, map[string]interface{}{
			"type":    "live_stage_guests_update",
			"live_id": liveID,
			"guests":  room.GetGuestsList(),
		})
	}

	m.BroadcastToLive(liveID, map[string]interface{}{
		"type":         "live_viewer_count",
		"live_id":      liveID,
		"viewer_count": viewerCount,
	})
}

// EndRoom terminates an active broadcast session
func (m *LiveManager) EndRoom(liveID uint, requesterID uint) error {
	room := m.GetRoom(liveID)
	if room == nil {
		// Update DB in case room is not in memory
		now := time.Now()
		m.db.Model(&model.Live{}).Where("id = ? AND status = 'live'", liveID).Updates(map[string]interface{}{
			"status":   "ended",
			"ended_at": &now,
		})
		m.hub.Broadcast(fmt.Sprintf(`{"type":"live_now_ended","live_id":%d}`, liveID))
		return nil
	}

	room.mu.Lock()
	if room.HostID != requesterID {
		// Check if requester is super_admin or admin
		var user model.User
		if err := m.db.First(&user, requesterID).Error; err != nil || (user.Role != "admin" && user.Role != "super_admin") {
			room.mu.Unlock()
			return errors.New("only host or admin can end the stream")
		}
	}

	if room.Status == "ended" {
		room.mu.Unlock()
		return nil
	}

	room.Status = "ended"
	if room.disconnectTimer != nil {
		room.disconnectTimer.Stop()
	}
	close(room.stopTicker)
	room.reactionsTicker.Stop()
	totalReactions := room.TotalReactions
	room.mu.Unlock()

	// Update Database
	now := time.Now()
	m.db.Model(&model.Live{}).Where("id = ?", liveID).Updates(map[string]interface{}{
		"status":          "ended",
		"ended_at":        &now,
		"total_reactions": totalReactions,
		"viewer_count":    0,
	})

	// Notify room viewers
	m.BroadcastToLive(liveID, map[string]interface{}{
		"type":    "live_ended",
		"live_id": liveID,
	})

	// Notify whole app to update Live Now row
	liveNowEndMsg, _ := json.Marshal(map[string]interface{}{
		"type":    "live_now_ended",
		"live_id": liveID,
	})
	m.hub.Broadcast(string(liveNowEndMsg))

	m.roomsMu.Lock()
	delete(m.rooms, liveID)
	m.roomsMu.Unlock()

	return nil
}

// AutoEndLive is triggered when 60s host grace period expires
func (m *LiveManager) AutoEndLive(liveID uint) {
	log.Printf("[LiveStudio] Host grace period expired for live %d. Automatically ending broadcast.", liveID)
	room := m.GetRoom(liveID)
	if room != nil {
		_ = m.EndRoom(liveID, room.HostID)
	}
}

// HandleReaction processes an emoji reaction with strict 5/s rate limit
func (m *LiveManager) HandleReaction(liveID uint, userID uint, reaction string) error {
	validReactions := map[string]bool{
		"heart": true,
		"fire":  true,
		"clap":  true,
		"laugh": true,
		"wow":   true,
	}

	cleanReaction := strings.ToLower(strings.TrimSpace(reaction))
	if !validReactions[cleanReaction] {
		return errors.New("invalid reaction type")
	}

	room := m.GetRoom(liveID)
	if room == nil || room.Status != "live" {
		return errors.New("live not active")
	}

	room.mu.Lock()
	defer room.mu.Unlock()

	now := time.Now()
	oneSecAgo := now.Add(-1 * time.Second)

	// Filter timestamps in the last second
	taps := room.UserTaps[userID]
	validTaps := make([]time.Time, 0, len(taps)+1)
	for _, t := range taps {
		if t.After(oneSecAgo) {
			validTaps = append(validTaps, t)
		}
	}

	// Max 5 taps per second
	if len(validTaps) >= 5 {
		room.UserTaps[userID] = validTaps
		return nil // silently rate-limit client
	}

	validTaps = append(validTaps, now)
	room.UserTaps[userID] = validTaps

	room.ReactionCounts[cleanReaction]++
	room.TotalReactions++

	return nil
}

// runReactionsBatcher flushes batched reactions every 500ms
func (r *LiveRoom) runReactionsBatcher(m *LiveManager) {
	for {
		select {
		case <-r.stopTicker:
			return
		case <-r.reactionsTicker.C:
			r.mu.Lock()
			if len(r.ReactionCounts) == 0 {
				r.mu.Unlock()
				continue
			}

			// Snapshot counts & clear
			snapshot := make(map[string]int, len(r.ReactionCounts))
			for k, v := range r.ReactionCounts {
				snapshot[k] = v
			}
			r.ReactionCounts = make(map[string]int)
			tot := r.TotalReactions
			lid := r.LiveID
			r.mu.Unlock()

			m.BroadcastToLive(lid, map[string]interface{}{
				"type":            "live_reactions_batch",
				"live_id":         lid,
				"counts":          snapshot,
				"total_reactions": tot,
			})
		}
	}
}

// HandleChatMessage validates permissions, slow mode, blocked words, and broadcasts
func (m *LiveManager) HandleChatMessage(liveID uint, user *model.User, rawText string) (*ChatMessageItem, error) {
	room := m.GetRoom(liveID)
	if room == nil || room.Status != "live" {
		return nil, errors.New("live stream not active")
	}

	trimmed := strings.TrimSpace(rawText)
	if trimmed == "" {
		return nil, errors.New("message cannot be empty")
	}
	if len(trimmed) > 500 {
		return nil, errors.New("message exceeds 500 character limit")
	}

	room.mu.Lock()
	defer room.mu.Unlock()

	// 1. Check ban or timeout
	if until, exists := room.Bans[user.ID]; exists {
		if until == nil {
			return nil, errors.New("you have been removed from this live")
		}
		if time.Now().Before(*until) {
			rem := int(time.Until(*until).Seconds())
			return nil, fmt.Errorf("you are timed out for %d more seconds", rem)
		}
		delete(room.Bans, user.ID)
	}

	role := room.Roles[user.ID]
	if role == "" {
		role = "viewer"
	}
	isHostOrMod := role == "host" || role == "moderator"

	// 2. Chat Enabled check
	if !room.ChatSettings.ChatEnabled && !isHostOrMod {
		return nil, errors.New("chat is disabled by the host")
	}

	// 3. Followers-Only check
	if room.ChatSettings.FollowersOnly && !isHostOrMod {
		var followCount int64
		m.db.Model(&model.Follow{}).
			Where("follower_id = ? AND following_id = ?", user.ID, room.HostID).
			Count(&followCount)
		if followCount == 0 {
			return nil, errors.New("followers-only chat: you must follow the host to participate in chat")
		}
	}

	// 4. Slow Mode check
	if room.ChatSettings.SlowMode > 0 && !isHostOrMod {
		lastMsg, exists := room.UserLastChat[user.ID]
		if exists {
			elapsed := time.Since(lastMsg)
			required := time.Duration(room.ChatSettings.SlowMode) * time.Second
			if elapsed < required {
				rem := int((required - elapsed).Seconds()) + 1
				return nil, fmt.Errorf("slow mode active: please wait %d seconds", rem)
			}
		}
	}

	// 5. Blocked Words filter: messages matching blocked words are hidden before broadcast
	lowerText := strings.ToLower(trimmed)
	for _, word := range room.ChatSettings.BlockedWords {
		cleaned := strings.ToLower(strings.TrimSpace(word))
		if cleaned != "" && strings.Contains(lowerText, cleaned) {
			return nil, errors.New("message contains words blocked in this live")
		}
	}

	room.UserLastChat[user.ID] = time.Now()

	msgItem := &ChatMessageItem{
		ID:        fmt.Sprintf("%d-%d", user.ID, time.Now().UnixNano()),
		LiveID:    liveID,
		UserID:    user.ID,
		Username:  user.Username,
		Name:      user.Name,
		AvatarURL: user.AvatarURL,
		Text:      trimmed,
		Role:      role,
		CreatedAt: time.Now(),
		TimeAgo:   "Just now",
	}

	// Broadcast chat message
	go m.BroadcastToLive(liveID, map[string]interface{}{
		"type":    "live_chat_message",
		"live_id": liveID,
		"message": msgItem,
	})

	return msgItem, nil
}

// DeleteChatMessage deletes a chat message if caller is host or moderator
func (m *LiveManager) DeleteChatMessage(liveID uint, callerID uint, messageID string) error {
	room := m.GetRoom(liveID)
	if room == nil {
		return errors.New("room not active")
	}

	room.mu.RLock()
	role := room.Roles[callerID]
	isHostOrMod := role == "host" || role == "moderator"
	room.mu.RUnlock()

	if !isHostOrMod {
		return errors.New("permission denied: only host and moderators can delete messages")
	}

	m.BroadcastToLive(liveID, map[string]interface{}{
		"type":       "live_chat_deleted",
		"live_id":    liveID,
		"message_id": messageID,
	})

	return nil
}

// TimeoutUser applies a timeout to a viewer (60s, 300s, 3600s)
func (m *LiveManager) TimeoutUser(liveID uint, callerID uint, targetUserID uint, durationSec int) error {
	room := m.GetRoom(liveID)
	if room == nil {
		return errors.New("room not active")
	}

	room.mu.Lock()
	defer room.mu.Unlock()

	callerRole := room.Roles[callerID]
	if callerRole != "host" && callerRole != "moderator" {
		return errors.New("permission denied: only host and moderators can timeout users")
	}

	if targetUserID == room.HostID {
		return errors.New("cannot timeout the host")
	}

	until := time.Now().Add(time.Duration(durationSec) * time.Second)
	room.Bans[targetUserID] = &until

	// Persist to database
	ban := model.LiveBan{
		LiveID: liveID,
		UserID: targetUserID,
		Until:  &until,
		Reason: fmt.Sprintf("Timed out for %d seconds by user %d", durationSec, callerID),
	}
	m.db.Create(&ban)

	// Send target user notification
	go m.hub.SendToUser(targetUserID, []byte(fmt.Sprintf(
		`{"type":"live_user_timed_out","live_id":%d,"duration_seconds":%d,"until":"%s"}`,
		liveID, durationSec, until.Format(time.RFC3339),
	)))

	return nil
}

// RemoveUser kicks and permanently bans a user from rejoining this live
func (m *LiveManager) RemoveUser(liveID uint, callerID uint, targetUserID uint) error {
	room := m.GetRoom(liveID)
	if room == nil {
		return errors.New("room not active")
	}

	room.mu.Lock()
	callerRole := room.Roles[callerID]
	if callerRole != "host" && callerRole != "moderator" {
		room.mu.Unlock()
		return errors.New("permission denied: only host and moderators can remove viewers")
	}

	if targetUserID == room.HostID {
		room.mu.Unlock()
		return errors.New("cannot remove the host")
	}

	room.Bans[targetUserID] = nil // Permanent ban
	delete(room.Viewers, targetUserID)
	delete(room.Guests, targetUserID)

	// Clean queue
	cleaned := make([]*HandRaise, 0, len(room.HandQueue))
	for _, h := range room.HandQueue {
		if h.UserID != targetUserID {
			cleaned = append(cleaned, h)
		}
	}
	room.HandQueue = cleaned
	viewerCount := len(room.Viewers)
	room.mu.Unlock()

	// Persist permanent ban to DB
	ban := model.LiveBan{
		LiveID: liveID,
		UserID: targetUserID,
		Until:  nil,
		Reason: fmt.Sprintf("Removed from live by user %d", callerID),
	}
	m.db.Create(&ban)

	// Notify removed user
	kickMsg, _ := json.Marshal(map[string]interface{}{
		"type":    "live_user_removed",
		"live_id": liveID,
		"reason":  "You have been removed from this live by a moderator.",
	})
	m.hub.SendToUser(targetUserID, kickMsg)

	// Broadcast updated count & guests
	m.BroadcastToLive(liveID, map[string]interface{}{
		"type":         "live_viewer_count",
		"live_id":      liveID,
		"viewer_count": viewerCount,
	})
	m.BroadcastToLive(liveID, map[string]interface{}{
		"type":    "live_stage_guests_update",
		"live_id": liveID,
		"guests":  room.GetGuestsList(),
	})

	return nil
}

// SetModerator assigns or removes moderator role
func (m *LiveManager) SetModerator(liveID uint, hostID uint, targetUserID uint, isMod bool) error {
	room := m.GetRoom(liveID)
	if room == nil {
		return errors.New("room not active")
	}

	room.mu.Lock()
	if room.HostID != hostID {
		room.mu.Unlock()
		return errors.New("only host can assign moderators")
	}

	newRole := "viewer"
	if isMod {
		newRole = "moderator"
	}
	room.Roles[targetUserID] = newRole
	if p, ok := room.Viewers[targetUserID]; ok {
		p.Role = newRole
	}
	room.mu.Unlock()

	// Upsert in database
	if isMod {
		roleEntry := model.LiveRole{
			LiveID: liveID,
			UserID: targetUserID,
			Role:   "moderator",
		}
		m.db.Where("live_id = ? AND user_id = ?", liveID, targetUserID).
			Assign(model.LiveRole{Role: "moderator"}).
			FirstOrCreate(&roleEntry)
	} else {
		m.db.Where("live_id = ? AND user_id = ?", liveID, targetUserID).
			Delete(&model.LiveRole{})
	}

	m.BroadcastToLive(liveID, map[string]interface{}{
		"type":           "live_role_updated",
		"live_id":        liveID,
		"target_user_id": targetUserID,
		"role":           newRole,
	})

	return nil
}

// UpdateChatSettings updates chat controls
func (m *LiveManager) UpdateChatSettings(liveID uint, hostID uint, settings model.ChatSettings) error {
	room := m.GetRoom(liveID)
	if room == nil {
		return errors.New("room not active")
	}

	room.mu.Lock()
	if room.HostID != hostID {
		room.mu.Unlock()
		return errors.New("only host can change chat settings")
	}
	room.ChatSettings = settings
	room.mu.Unlock()

	// Persist to DB
	bytes, _ := json.Marshal(settings)
	m.db.Model(&model.Live{}).Where("id = ?", liveID).Update("chat_settings", string(bytes))

	m.BroadcastToLive(liveID, map[string]interface{}{
		"type":          "live_chat_settings_updated",
		"live_id":       liveID,
		"chat_settings": settings,
	})

	return nil
}

// RaiseHand queues viewer for stage
func (m *LiveManager) RaiseHand(liveID uint, user *model.User) error {
	room := m.GetRoom(liveID)
	if room == nil || room.Status != "live" {
		return errors.New("live not active")
	}

	room.mu.Lock()
	defer room.mu.Unlock()

	// Rate limit: 1 hand raise action per 5 seconds
	if last, exists := room.UserLastHand[user.ID]; exists && time.Since(last) < 5*time.Second {
		return errors.New("please wait a moment before raising hand again")
	}
	room.UserLastHand[user.ID] = time.Now()

	// Check if already in queue
	for _, h := range room.HandQueue {
		if h.UserID == user.ID {
			return nil
		}
	}

	// Check if already guest on stage
	if _, isGuest := room.Guests[user.ID]; isGuest {
		return errors.New("you are already on stage")
	}

	room.HandQueue = append(room.HandQueue, &HandRaise{
		UserID:    user.ID,
		Username:  user.Username,
		Name:      user.Name,
		AvatarURL: user.AvatarURL,
		RaisedAt:  time.Now(),
	})

	// Send updated queue to host
	go m.sendHandQueueToHost(room)

	return nil
}

// LowerHand removes viewer from hand raise queue
func (m *LiveManager) LowerHand(liveID uint, userID uint) error {
	room := m.GetRoom(liveID)
	if room == nil {
		return errors.New("room not active")
	}

	room.mu.Lock()
	defer room.mu.Unlock()

	cleaned := make([]*HandRaise, 0, len(room.HandQueue))
	for _, h := range room.HandQueue {
		if h.UserID != userID {
			cleaned = append(cleaned, h)
		}
	}
	room.HandQueue = cleaned

	go m.sendHandQueueToHost(room)

	return nil
}

// InviteToStage allows host to invite a viewer directly
func (m *LiveManager) InviteToStage(liveID uint, hostID uint, targetUserID uint, audioOnly bool) error {
	room := m.GetRoom(liveID)
	if room == nil {
		return errors.New("room not active")
	}

	room.mu.RLock()
	if room.HostID != hostID {
		room.mu.RUnlock()
		return errors.New("only host can invite to stage")
	}
	if len(room.Guests) >= 3 {
		room.mu.RUnlock()
		return errors.New("stage is full (maximum 3 guests)")
	}
	room.mu.RUnlock()

	payload, _ := json.Marshal(map[string]interface{}{
		"type":       "live_stage_invited",
		"live_id":    liveID,
		"host_id":    hostID,
		"audio_only": audioOnly,
	})
	m.hub.SendToUser(targetUserID, payload)

	return nil
}

// AcceptStageInvite accepts invitation and adds to stage grid (capped at 3)
func (m *LiveManager) AcceptStageInvite(liveID uint, user *model.User, audioOnly bool) error {
	room := m.GetRoom(liveID)
	if room == nil {
		return errors.New("room not active")
	}

	room.mu.Lock()
	if len(room.Guests) >= 3 {
		room.mu.Unlock()
		return errors.New("stage is currently full (maximum 3 guests)")
	}

	room.Guests[user.ID] = &Guest{
		UserID:    user.ID,
		Username:  user.Username,
		Name:      user.Name,
		AvatarURL: user.AvatarURL,
		AudioOnly: audioOnly,
		VideoOff:  audioOnly,
		Muted:     false,
	}

	// Remove from queue if present
	cleaned := make([]*HandRaise, 0, len(room.HandQueue))
	for _, h := range room.HandQueue {
		if h.UserID != user.ID {
			cleaned = append(cleaned, h)
		}
	}
	room.HandQueue = cleaned
	room.Roles[user.ID] = "guest"
	room.mu.Unlock()

	// Broadcast stage guests update
	m.BroadcastToLive(liveID, map[string]interface{}{
		"type":    "live_stage_guests_update",
		"live_id": liveID,
		"guests":  room.GetGuestsList(),
	})

	go m.sendHandQueueToHost(room)

	return nil
}

// RemoveStageGuest removes guest from stage
func (m *LiveManager) RemoveStageGuest(liveID uint, callerID uint, targetUserID uint) error {
	room := m.GetRoom(liveID)
	if room == nil {
		return errors.New("room not active")
	}

	room.mu.Lock()
	if room.HostID != callerID && callerID != targetUserID {
		room.mu.Unlock()
		return errors.New("permission denied")
	}

	delete(room.Guests, targetUserID)
	if room.Roles[targetUserID] == "guest" {
		room.Roles[targetUserID] = "viewer"
	}
	room.mu.Unlock()

	// Notify removed guest
	go m.hub.SendToUser(targetUserID, []byte(fmt.Sprintf(`{"type":"live_stage_removed","live_id":%d}`, liveID)))

	m.BroadcastToLive(liveID, map[string]interface{}{
		"type":    "live_stage_guests_update",
		"live_id": liveID,
		"guests":  room.GetGuestsList(),
	})

	return nil
}

// MuteStageGuest toggles mute state of a guest on stage
func (m *LiveManager) MuteStageGuest(liveID uint, hostID uint, targetUserID uint, muted bool) error {
	room := m.GetRoom(liveID)
	if room == nil {
		return errors.New("room not active")
	}

	room.mu.Lock()
	if room.HostID != hostID {
		room.mu.Unlock()
		return errors.New("only host can mute guests")
	}

	if g, ok := room.Guests[targetUserID]; ok {
		g.Muted = muted
	}
	room.mu.Unlock()

	m.BroadcastToLive(liveID, map[string]interface{}{
		"type":    "live_stage_guests_update",
		"live_id": liveID,
		"guests":  room.GetGuestsList(),
	})

	return nil
}

// HandleHostDisconnect sets up 60-second grace period
func (m *LiveManager) HandleHostDisconnect(hostID uint) {
	m.roomsMu.RLock()
	activeHostRooms := make([]*LiveRoom, 0)
	for _, r := range m.rooms {
		if r.HostID == hostID && r.Status == "live" {
			activeHostRooms = append(activeHostRooms, r)
		}
	}
	m.roomsMu.RUnlock()

	for _, room := range activeHostRooms {
		room.mu.Lock()
		room.HostConnected = false
		if room.disconnectTimer != nil {
			room.disconnectTimer.Stop()
		}
		lid := room.LiveID
		room.disconnectTimer = time.AfterFunc(60*time.Second, func() {
			m.AutoEndLive(lid)
		})
		room.mu.Unlock()

		m.BroadcastToLive(lid, map[string]interface{}{
			"type":             "live_host_status",
			"live_id":          lid,
			"connected":        false,
			"grace_period_sec": 60,
			"message":          "Host temporarily disconnected. Waiting up to 60s for reconnection...",
		})
	}
}

// HandleHostReconnect cancels grace period timer
func (m *LiveManager) HandleHostReconnect(hostID uint) {
	m.roomsMu.RLock()
	for _, r := range m.rooms {
		if r.HostID == hostID && r.Status == "live" {
			r.mu.Lock()
			r.HostConnected = true
			if r.disconnectTimer != nil {
				r.disconnectTimer.Stop()
				r.disconnectTimer = nil
			}
			lid := r.LiveID
			r.mu.Unlock()

			m.BroadcastToLive(lid, map[string]interface{}{
				"type":      "live_host_status",
				"live_id":   lid,
				"connected": true,
			})
		}
	}
	m.roomsMu.RUnlock()
}

// GetGuestsList helper
func (r *LiveRoom) GetGuestsList() []*Guest {
	r.mu.RLock()
	defer r.mu.RUnlock()
	list := make([]*Guest, 0, len(r.Guests))
	for _, g := range r.Guests {
		list = append(list, g)
	}
	return list
}

// GetHandQueue helper
func (r *LiveRoom) GetHandQueue() []*HandRaise {
	r.mu.RLock()
	defer r.mu.RUnlock()
	res := make([]*HandRaise, len(r.HandQueue))
	copy(res, r.HandQueue)
	return res
}

func (m *LiveManager) sendHandQueueToHost(room *LiveRoom) {
	queue := room.GetHandQueue()
	payload, _ := json.Marshal(map[string]interface{}{
		"type":       "live_hand_queue_update",
		"live_id":    room.LiveID,
		"hand_queue": queue,
	})
	m.hub.SendToUser(room.HostID, payload)
}

// BroadcastToLive broadcasts a message only to viewers and guests in the specific live room
func (m *LiveManager) BroadcastToLive(liveID uint, payload map[string]interface{}) {
	room := m.GetRoom(liveID)
	if room == nil {
		return
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return
	}

	room.mu.RLock()
	recipients := make([]uint, 0, len(room.Viewers)+1)
	recipients = append(recipients, room.HostID)
	for uid := range room.Viewers {
		if uid != room.HostID {
			recipients = append(recipients, uid)
		}
	}
	room.mu.RUnlock()

	for _, uid := range recipients {
		m.hub.SendToUser(uid, data)
	}
}
