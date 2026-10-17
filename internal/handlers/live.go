package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"piscine-devnest/internal/model"
	"piscine-devnest/internal/storage"
	"piscine-devnest/internal/ws"
)

// ---------------------------------------------------------------------------
// 1. LIVE NOW ACTIVE STREAMS & DETAILS
// ---------------------------------------------------------------------------

// GetActiveLives returns all currently active broadcasts, with followed hosts first
func (h *Handler) GetActiveLives(c *gin.Context) {
	currentUserID := c.GetUint("user_id")

	var lives []model.Live
	query := h.DB.Where("status = ?", "live").
		Preload("Host", func(db *gorm.DB) *gorm.DB {
			return db.Select("id", "username", "name", "avatar_url", "status")
		}).
		Order("started_at DESC")

	if err := query.Find(&lives).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch active lives"})
		return
	}

	// Filter out lives where host is banned, suspended, or missing
	activeLives := make([]model.Live, 0, len(lives))
	for _, l := range lives {
		if l.Host != nil && l.Host.Status != "banned" && l.Host.Status != "suspended" {
			// Pull real-time viewer count & reactions from in-memory room if present
			if room := h.LiveManager.GetRoom(l.ID); room != nil {
				l.ViewerCount = len(room.Viewers)
				l.TotalReactions = room.TotalReactions
			}
			cs := l.GetChatSettings()
			l.ParsedChatSettings = &cs
			activeLives = append(activeLives, l)
		}
	}

	// Order lives with people the requester follows first
	if currentUserID > 0 && len(activeLives) > 1 {
		var followingIDs []uint
		h.DB.Model(&model.Follow{}).Where("follower_id = ?", currentUserID).Pluck("following_id", &followingIDs)
		followingMap := make(map[uint]bool, len(followingIDs))
		for _, fid := range followingIDs {
			followingMap[fid] = true
		}

		sort.SliceStable(activeLives, func(i, j int) bool {
			iFollowed := followingMap[activeLives[i].HostID]
			jFollowed := followingMap[activeLives[j].HostID]
			if iFollowed != jFollowed {
				return iFollowed
			}
			return activeLives[i].StartedAt.After(activeLives[j].StartedAt)
		})
	}

	c.JSON(http.StatusOK, gin.H{"lives": activeLives})
}

// GetLiveDetails returns stream state and role of requesting user
func (h *Handler) GetLiveDetails(c *gin.Context) {
	idStr := c.Param("id")
	liveID, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid live ID"})
		return
	}

	var live model.Live
	if err := h.DB.Preload("Host", func(db *gorm.DB) *gorm.DB {
		return db.Select("id", "username", "name", "avatar_url", "status")
	}).First(&live, liveID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "live stream not found"})
		return
	}

	currentUserID := c.GetUint("user_id")
	role := "viewer"
	if currentUserID == live.HostID {
		role = "host"
	} else if currentUserID > 0 {
		var liveRole model.LiveRole
		if err := h.DB.Where("live_id = ? AND user_id = ?", live.ID, currentUserID).First(&liveRole).Error; err == nil {
			role = liveRole.Role
		}
	}

	cs := live.GetChatSettings()
	live.ParsedChatSettings = &cs

	if room := h.LiveManager.GetRoom(live.ID); room != nil {
		live.ViewerCount = len(room.Viewers)
		live.TotalReactions = room.TotalReactions
		c.JSON(http.StatusOK, gin.H{
			"live":            live,
			"role":            role,
			"guests":          room.GetGuestsList(),
			"viewer_count":    live.ViewerCount,
			"total_reactions": live.TotalReactions,
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"live":            live,
		"role":            role,
		"guests":          []interface{}{},
		"viewer_count":    live.ViewerCount,
		"total_reactions": live.TotalReactions,
	})
}

// ---------------------------------------------------------------------------
// 2. START & END BROADCAST
// ---------------------------------------------------------------------------

// StartLive creates a new live broadcast session
func (h *Handler) StartLive(c *gin.Context) {
	currentUserID := c.GetUint("user_id")
	if currentUserID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var input struct {
		Title           string             `json:"title"`
		NotifyFollowers bool               `json:"notify_followers"`
		SaveReplay      bool               `json:"save_replay"`
		ChatSettings    model.ChatSettings `json:"chat_settings"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		input.Title = "🔴 Live Broadcast"
		input.NotifyFollowers = true
		input.SaveReplay = false
		input.ChatSettings = model.ChatSettings{
			ChatEnabled:   true,
			SlowMode:      0,
			FollowersOnly: false,
			BlockedWords:  []string{},
		}
	}

	if strings.TrimSpace(input.Title) == "" {
		input.Title = "🔴 Live Broadcast"
	}

	// Ensure any old active live by this host is safely ended
	var oldLives []model.Live
	h.DB.Where("host_id = ? AND status = 'live'", currentUserID).Find(&oldLives)
	for _, old := range oldLives {
		_ = h.LiveManager.EndRoom(old.ID, currentUserID)
	}

	live := model.Live{
		HostID:          currentUserID,
		Title:           strings.TrimSpace(input.Title),
		Status:          "live",
		StartedAt:       time.Now(),
		NotifyFollowers: input.NotifyFollowers,
		SaveReplay:      input.SaveReplay,
		ViewerCount:     1,
		TotalReactions:  0,
	}
	live.SetChatSettings(input.ChatSettings)

	if err := h.DB.Create(&live).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create live stream"})
		return
	}

	// Create host role
	hostRole := model.LiveRole{
		LiveID: live.ID,
		UserID: currentUserID,
		Role:   "host",
	}
	h.DB.Create(&hostRole)

	// Load Host data
	var hostUser model.User
	h.DB.Select("id", "username", "name", "avatar_url", "status").First(&hostUser, currentUserID)
	live.Host = &hostUser

	// Initialize in-memory live room
	h.LiveManager.CreateRoom(&live)

	// If save_replay was requested, initialize replay row
	if input.SaveReplay {
		replay := model.LiveReplay{
			LiveID: live.ID,
			Status: "recording",
		}
		h.DB.Create(&replay)
	}

	// Fan out notifications to followers in a background goroutine (batched)
	if input.NotifyFollowers {
		h.fanOutGoLiveNotifications(hostUser, live)
	}

	// Broadcast Live Now row event
	liveNowMsg, _ := json.Marshal(map[string]interface{}{
		"type": "live_now_started",
		"live": live,
	})
	h.Hub.Broadcast(string(liveNowMsg))

	c.JSON(http.StatusCreated, gin.H{
		"live": live,
		"role": "host",
	})
}

// EndLive ends a live stream
func (h *Handler) EndLive(c *gin.Context) {
	currentUserID := c.GetUint("user_id")
	idStr := c.Param("id")
	liveID, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid live ID"})
		return
	}

	var live model.Live
	if err := h.DB.First(&live, liveID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "live stream not found"})
		return
	}

	if live.HostID != currentUserID {
		var user model.User
		h.DB.First(&user, currentUserID)
		if user.Role != "admin" && user.Role != "super_admin" {
			c.JSON(http.StatusForbidden, gin.H{"error": "only host can end the live stream"})
			return
		}
	}

	if err := h.LiveManager.EndRoom(uint(liveID), currentUserID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// If replay was recording, mark it ready
	h.DB.Model(&model.LiveReplay{}).
		Where("live_id = ? AND status = 'recording'", liveID).
		Update("status", "ready")

	c.JSON(http.StatusOK, gin.H{"message": "stream ended successfully"})
}

// ---------------------------------------------------------------------------
// 3. FAN-OUT GO-LIVE NOTIFICATIONS (BATCHED IN BACKGROUND)
// ---------------------------------------------------------------------------

func (h *Handler) fanOutGoLiveNotifications(host model.User, live model.Live) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[LiveNotifications] Recovered from panic in fan-out: %v", r)
			}
		}()

		var followerIDs []uint
		if err := h.DB.Model(&model.Follow{}).
			Where("following_id = ?", host.ID).
			Pluck("follower_id", &followerIDs).Error; err != nil || len(followerIDs) == 0 {
			return
		}

		batchSize := 100
		for i := 0; i < len(followerIDs); i += batchSize {
			end := i + batchSize
			if end > len(followerIDs) {
				end = len(followerIDs)
			}
			batch := followerIDs[i:end]

			for _, fid := range batch {
				notif := model.Notification{
					UserID:  fid,
					ActorID: host.ID,
					Type:    "live_started",
					LiveID:  &live.ID,
				}
				if err := h.DB.Create(&notif).Error; err == nil {
					h.DB.Preload("Actor", func(db *gorm.DB) *gorm.DB {
						return db.Select("id", "username", "name", "avatar_url")
					}).First(&notif, notif.ID)

					payload, _ := json.Marshal(gin.H{
						"event":        "notification",
						"notification": notif,
						"live": gin.H{
							"id":         live.ID,
							"title":      live.Title,
							"host_id":    host.ID,
							"username":   host.Username,
							"name":       host.Name,
							"avatar_url": host.AvatarURL,
						},
					})
					h.Hub.SendToUser(fid, payload)
				}

				if h.Push != nil {
					h.Push.SendLiveStartedPush(fid, host, live.ID, live.Title)
				}
			}

			time.Sleep(25 * time.Millisecond) // Yield CPU to maintain low server latency
		}
	}()
}

// ---------------------------------------------------------------------------
// 4. REPLAY SAVING & CHUNKED UPLOAD
// ---------------------------------------------------------------------------

// UploadReplayChunk receives a 5-second chunk of recorded video from the host
func (h *Handler) UploadReplayChunk(c *gin.Context) {
	currentUserID := c.GetUint("user_id")
	idStr := c.Param("id")
	liveID, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid live ID"})
		return
	}

	var live model.Live
	if err := h.DB.First(&live, liveID).Error; err != nil || live.HostID != currentUserID {
		c.JSON(http.StatusForbidden, gin.H{"error": "only stream host can upload replay chunks"})
		return
	}

	chunkIndexStr := c.PostForm("chunk_index")
	chunkIndex, _ := strconv.Atoi(chunkIndexStr)

	file, _, err := c.Request.FormFile("chunk")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing chunk file"})
		return
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read chunk"})
		return
	}

	// Write chunk to temporary storage directory: ./uploads/replays/{live_id}/
	dir := filepath.Join(".", "uploads", "replays", fmt.Sprintf("%d", liveID))
	_ = os.MkdirAll(dir, 0755)

	chunkPath := filepath.Join(dir, fmt.Sprintf("chunk_%06d.part", chunkIndex))
	if err := os.WriteFile(chunkPath, data, 0644); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save chunk"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":      "chunk_saved",
		"chunk_index": chunkIndex,
	})
}

// FinishReplay finalizes or discards uploaded chunks
func (h *Handler) FinishReplay(c *gin.Context) {
	currentUserID := c.GetUint("user_id")
	idStr := c.Param("id")
	liveID, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid live ID"})
		return
	}

	var live model.Live
	if err := h.DB.First(&live, liveID).Error; err != nil || live.HostID != currentUserID {
		c.JSON(http.StatusForbidden, gin.H{"error": "permission denied"})
		return
	}

	var input struct {
		Action string `json:"action"` // "ready" | "discard"
	}
	_ = c.ShouldBindJSON(&input)

	dir := filepath.Join(".", "uploads", "replays", fmt.Sprintf("%d", liveID))

	if input.Action == "discard" {
		_ = os.RemoveAll(dir)
		h.DB.Model(&model.LiveReplay{}).
			Where("live_id = ?", liveID).
			Update("status", "discarded")
		c.JSON(http.StatusOK, gin.H{"message": "replay discarded"})
		return
	}

	// Assemble chunks into final file
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) == 0 {
		c.JSON(http.StatusOK, gin.H{"status": "no_chunks_stored", "storage_path": ""})
		return
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name() < entries[j].Name()
	})

	combinedPath := filepath.Join(dir, "assembled_replay.webm")
	outFile, err := os.Create(combinedPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to assemble replay"})
		return
	}

	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".part") {
			partPath := filepath.Join(dir, entry.Name())
			partBytes, readErr := os.ReadFile(partPath)
			if readErr == nil {
				_, _ = outFile.Write(partBytes)
			}
		}
	}
	outFile.Close()

	// Upload to Supabase if configured, or use assembled file path
	finalBytes, _ := os.ReadFile(combinedPath)
	storagePath := combinedPath

	if os.Getenv("SUPABASE_URL") != "" && os.Getenv("SUPABASE_SERVICE_KEY") != "" {
		filename := fmt.Sprintf("replay_%d_%s.webm", liveID, uuid.New().String()[:8])
		if pubURL, uploadErr := storage.UploadToSupabase("media", filename, finalBytes, "video/webm"); uploadErr == nil {
			storagePath = pubURL
		}
	}

	h.DB.Model(&model.LiveReplay{}).
		Where("live_id = ?", liveID).
		Updates(map[string]interface{}{
			"status":       "ready",
			"storage_path": storagePath,
		})

	c.JSON(http.StatusOK, gin.H{
		"status":       "ready",
		"storage_path": storagePath,
	})
}

// PublishReplay publishes an assembled replay as a standard Post or Reel
func (h *Handler) PublishReplay(c *gin.Context) {
	currentUserID := c.GetUint("user_id")
	idStr := c.Param("id")
	liveID, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid live ID"})
		return
	}

	var live model.Live
	if err := h.DB.First(&live, liveID).Error; err != nil || live.HostID != currentUserID {
		c.JSON(http.StatusForbidden, gin.H{"error": "permission denied"})
		return
	}

	var input struct {
		PublishType  string `json:"publish_type"` // "post" | "reel"
		Caption      string `json:"caption"`
		VideoURL     string `json:"video_url"`
		ThumbnailURL string `json:"thumbnail_url"`
		Community    string `json:"community"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || input.VideoURL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "video_url is required"})
		return
	}

	caption := strings.TrimSpace(input.Caption)
	if caption == "" {
		caption = fmt.Sprintf("Replay of %s", live.Title)
	}

	if input.PublishType == "reel" {
		reel := model.Reel{
			UserID:   currentUserID,
			VideoURL: input.VideoURL,
			Caption:  caption,
		}
		if err := h.DB.Create(&reel).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create reel from replay"})
			return
		}

		h.DB.Model(&model.LiveReplay{}).
			Where("live_id = ?", liveID).
			Updates(map[string]interface{}{
				"status": "published",
			})

		c.JSON(http.StatusCreated, gin.H{"status": "published", "reel": reel})
		return
	}

	// Default: publish as regular post
	post := model.Post{
		UserID:    currentUserID,
		Content:   caption,
		MediaURL:  input.VideoURL,
		Community: input.Community,
	}
	if err := h.DB.Create(&post).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create post from replay"})
		return
	}

	h.DB.Model(&model.LiveReplay{}).
		Where("live_id = ?", liveID).
		Updates(map[string]interface{}{
			"status":  "published",
			"post_id": post.ID,
		})

	c.JSON(http.StatusCreated, gin.H{"status": "published", "post": post})
}

// ---------------------------------------------------------------------------
// 5. WEBSOCKET MESSAGE HOOK FOR LIVE STUDIO
// ---------------------------------------------------------------------------

// HandleLiveWSMessage processes incoming live messages from client SafeConn
func (h *Handler) HandleLiveWSMessage(userID uint, raw map[string]interface{}, sc *ws.SafeConn) bool {
	rawType, _ := raw["type"].(string)
	rawEvent, _ := raw["event"].(string)

	isLiveMsg := strings.HasPrefix(rawType, "live_") || rawEvent == "live_signal"
	if !isLiveMsg {
		return false
	}

	liveIDVal, hasLid := raw["live_id"]
	var liveID uint
	if hasLid && liveIDVal != nil {
		switch v := liveIDVal.(type) {
		case float64:
			liveID = uint(v)
		case int:
			liveID = uint(v)
		case int64:
			liveID = uint(v)
		case string:
			if parsed, err := strconv.ParseUint(v, 10, 32); err == nil {
				liveID = uint(parsed)
			}
		}
	}

	if liveID == 0 {
		return true
	}

	switch rawType {
	case "live_join":
		var user model.User
		if err := h.DB.Select("id", "username", "name", "avatar_url", "status").First(&user, userID).Error; err == nil {
			room, role, joinErr := h.LiveManager.JoinRoom(liveID, &user)
			if joinErr != nil {
				errPayload, _ := json.Marshal(map[string]interface{}{
					"type":    "live_error",
					"live_id": liveID,
					"message": joinErr.Error(),
				})
				_ = sc.WriteMessage(1, errPayload)
				return true
			}

			// Send room state to the joining user
			statePayload, _ := json.Marshal(map[string]interface{}{
				"type":            "live_room_state",
				"live_id":         liveID,
				"host_id":         room.HostID,
				"title":           room.Title,
				"save_replay":     room.SaveReplay,
				"role":            role,
				"viewer_count":    len(room.Viewers),
				"total_reactions": room.TotalReactions,
				"guests":          room.GetGuestsList(),
				"chat_settings":   room.ChatSettings,
				"hand_queue":      room.GetHandQueue(),
			})
			_ = sc.WriteMessage(1, statePayload)
		}

	case "live_leave":
		h.LiveManager.LeaveRoom(liveID, userID)

	case "live_reaction":
		reaction, _ := raw["reaction"].(string)
		_ = h.LiveManager.HandleReaction(liveID, userID, reaction)

	case "live_chat":
		text, _ := raw["text"].(string)
		var user model.User
		if err := h.DB.Select("id", "username", "name", "avatar_url").First(&user, userID).Error; err == nil {
			if _, chatErr := h.LiveManager.HandleChatMessage(liveID, &user, text); chatErr != nil {
				errPayload, _ := json.Marshal(map[string]interface{}{
					"type":    "live_chat_error",
					"live_id": liveID,
					"message": chatErr.Error(),
				})
				_ = sc.WriteMessage(1, errPayload)
			}
		}

	case "live_chat_delete":
		messageID, _ := raw["message_id"].(string)
		_ = h.LiveManager.DeleteChatMessage(liveID, userID, messageID)

	case "live_user_timeout":
		targetID := parseUintValue(raw["target_user_id"])
		duration := parseIntValue(raw["duration_seconds"])
		if duration <= 0 {
			duration = 60
		}
		_ = h.LiveManager.TimeoutUser(liveID, userID, targetID, duration)

	case "live_user_remove":
		targetID := parseUintValue(raw["target_user_id"])
		_ = h.LiveManager.RemoveUser(liveID, userID, targetID)

	case "live_set_moderator":
		targetID := parseUintValue(raw["target_user_id"])
		isMod, _ := raw["is_moderator"].(bool)
		_ = h.LiveManager.SetModerator(liveID, userID, targetID, isMod)

	case "live_chat_settings":
		if csRaw, ok := raw["chat_settings"].(map[string]interface{}); ok {
			var cs model.ChatSettings
			bytes, _ := json.Marshal(csRaw)
			_ = json.Unmarshal(bytes, &cs)
			_ = h.LiveManager.UpdateChatSettings(liveID, userID, cs)
		}

	case "live_hand_raise":
		var user model.User
		if err := h.DB.Select("id", "username", "name", "avatar_url").First(&user, userID).Error; err == nil {
			_ = h.LiveManager.RaiseHand(liveID, &user)
		}

	case "live_hand_lower":
		_ = h.LiveManager.LowerHand(liveID, userID)

	case "live_stage_invite":
		targetID := parseUintValue(raw["target_user_id"])
		audioOnly, _ := raw["audio_only"].(bool)
		_ = h.LiveManager.InviteToStage(liveID, userID, targetID, audioOnly)

	case "live_stage_accept":
		audioOnly, _ := raw["audio_only"].(bool)
		var user model.User
		if err := h.DB.Select("id", "username", "name", "avatar_url").First(&user, userID).Error; err == nil {
			_ = h.LiveManager.AcceptStageInvite(liveID, &user, audioOnly)
		}

	case "live_stage_decline":
		room := h.LiveManager.GetRoom(liveID)
		if room != nil {
			declineMsg, _ := json.Marshal(map[string]interface{}{
				"type":         "live_stage_declined",
				"live_id":      liveID,
				"from_user_id": userID,
			})
			h.Hub.SendToUser(room.HostID, declineMsg)
		}

	case "live_stage_remove":
		targetID := parseUintValue(raw["target_user_id"])
		if targetID == 0 {
			targetID = userID // Guest leaving stage
		}
		_ = h.LiveManager.RemoveStageGuest(liveID, userID, targetID)

	case "live_stage_mute":
		targetID := parseUintValue(raw["target_user_id"])
		muted, _ := raw["muted"].(bool)
		_ = h.LiveManager.MuteStageGuest(liveID, userID, targetID, muted)

	case "live_end":
		_ = h.LiveManager.EndRoom(liveID, userID)
	}

	return true
}

func parseUintValue(val interface{}) uint {
	if val == nil {
		return 0
	}
	switch v := val.(type) {
	case float64:
		return uint(v)
	case int:
		return uint(v)
	case int64:
		return uint(v)
	case string:
		if p, err := strconv.ParseUint(v, 10, 32); err == nil {
			return uint(p)
		}
	}
	return 0
}

func parseIntValue(val interface{}) int {
	if val == nil {
		return 0
	}
	switch v := val.(type) {
	case float64:
		return int(v)
	case int:
		return v
	case int64:
		return int(v)
	case string:
		if p, err := strconv.Atoi(v); err == nil {
			return p
		}
	}
	return 0
}
