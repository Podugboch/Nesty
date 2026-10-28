package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv" // 👈 Added for parameter parsing
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"piscine-devnest/internal/ai"
	"piscine-devnest/internal/live"
	"piscine-devnest/internal/middleware"
	"piscine-devnest/internal/model"
	"piscine-devnest/internal/push"
	"piscine-devnest/internal/storage"
	"piscine-devnest/internal/utils"
	"piscine-devnest/internal/ws"
)

type Handler struct {
	DB          *gorm.DB
	Hub         *ws.Hub
	Push        *push.PushService
	LiveManager *live.LiveManager
	AI          *ai.Service
	callTimers  sync.Map
}

// Constructor
func NewHandler(db *gorm.DB, hub *ws.Hub, pushSvc *push.PushService) *Handler {
	lm := live.NewLiveManager(db, hub)
	h := &Handler{
		DB:          db,
		Hub:         hub,
		Push:        pushSvc,
		LiveManager: lm,
		AI:          ai.NewService(),
	}
	hub.OnLiveMessage = h.HandleLiveWSMessage
	hub.OnUserDisconnect = lm.HandleHostDisconnect
	hub.OnUserConnect = lm.HandleHostReconnect
	return h
}

// ---------------------- ROUTES ----------------------
func (h *Handler) RegisterRoutes(r *gin.Engine) {
	api := r.Group("/api")

	// PUBLIC ROUTES
	api.GET("/ping", h.Ping)
	api.POST("/users", h.CreateUser)
	api.POST("/register", h.CreateUser)
	api.POST("/login", middleware.RateLimitLogin(), h.Login)
	api.POST("/forgot-password", h.ForgotPassword)
	api.GET("/community-stats", h.GetCommunityStats)
	api.GET("/community/stats", h.GetCommunityStats)
	api.GET("/webrtc/config", h.GetWebRTCConfig)
	api.GET("/group-calls/active", h.GetActiveGroupCalls)
	api.GET("/tracks", h.GetTracks)
	api.GET("/reels", h.GetReels)
	api.GET("/reels/:id/comments", h.GetReelComments)
	api.GET("/music/search", h.SearchMusic)
	api.GET("/communities", h.GetCommunities)
	api.GET("/communities/:slug", h.GetCommunity)

	// LIVE BROADCAST STUDIO (ACTIVE STREAMS & DETAILS)
	api.GET("/lives/active", h.GetActiveLives)
	api.GET("/lives/:id", h.GetLiveDetails)

	// PROTECTED ROUTES
	protected := api.Group("/", utils.JWTMiddleware(), h.CheckUserStatus)
	{
		// REELS
		protected.POST("/reels", h.CreateReel)
		protected.POST("/reels/:id/like", h.ToggleReelLike)
		protected.POST("/reels/:id/comments", h.CreateReelComment)
		protected.DELETE("/reels/:id", h.DeleteReel)
		protected.POST("/reel-comments/:id/like", h.ToggleReelCommentLike)

		// COMMUNITIES
		protected.POST("/communities", h.CreateCommunity)
		protected.POST("/communities/:slug/join", h.JoinCommunity)
		protected.POST("/communities/:slug/leave", h.LeaveCommunity)
		protected.GET("/communities/:slug/members", h.GetCommunityMembers)
		protected.POST("/communities/:slug/members/:user_id/approve", h.ApproveCommunityMember)
		protected.POST("/communities/:slug/members/:user_id/reject", h.RejectCommunityMember)
		protected.POST("/communities/:slug/members/:user_id/role", h.UpdateCommunityMemberRole)
		protected.POST("/communities/:slug/invite", h.InviteCommunityMember)
		protected.POST("/communities/:slug/suggest-to-followers", h.SuggestCommunityToFollowers)
		protected.POST("/communities/:slug/accept-invite", h.AcceptCommunityInvite)
		protected.POST("/communities/:slug/decline-invite", h.DeclineCommunityInvite)
		protected.PUT("/communities/:slug/settings", h.UpdateCommunitySettings)
		// USERS
		protected.GET("/me", h.Me)
		protected.GET("/users", h.GetUsers)
		protected.GET("/users/:id", h.GetUser)
		protected.GET("/users/by-username/:username", h.GetUserByUsername)
		protected.GET("/users/search", h.SearchUsers)
		protected.PUT("/users/:id", h.UpdateUser)
		protected.DELETE("/users/:id", h.DeleteUser)

		protected.GET("/users/:id/profile", h.GetUserProfile)
		protected.GET("/users/:id/posts", h.GetUserPosts)

		protected.POST("/users/:id/follow", h.FollowUser)
		protected.DELETE("/users/:id/follow", h.UnfollowUser)
		protected.GET("/users/:id/followers", h.GetFollowers)
		protected.GET("/users/:id/following", h.GetFollowing)

		// RESOURCES
		protected.GET("/resources", h.GetResources)
		protected.GET("/resources/:id", h.GetResource)
		protected.POST("/resources", h.CreateResource)
		protected.PUT("/resources/:id", h.UpdateResource)
		protected.DELETE("/resources/:id", h.DeleteResource)

		// POSTS
		protected.GET("/posts", h.GetPosts)
		protected.POST("/posts", h.CreatePost)
		protected.POST("/posts/:id/repost", h.RepostPost)
		protected.PUT("/posts/:id", h.UpdatePost)
		protected.DELETE("/posts/:id", h.DeletePost)

		// LIKES & COMMENTS ✅ REGISTERED SMOOTHLY
		protected.POST("/posts/:id/like", h.LikePost)
		protected.POST("/posts/:id/comments", h.AddComment)
		protected.POST("/comments/:id/like", h.TogglePostCommentLike)

		//NOTIFICATION
		protected.GET("/notifications", h.GetNotifications)
		protected.POST("/notifications/:id/read", h.MarkNotificationRead)
		protected.POST("/notifications/read-all", h.MarkAllNotificationsRead)
		protected.POST("/notifications/call", h.RecordCallNotification)

		// MEDIA UPLOAD
		protected.POST("/upload", h.UploadMedia)

		// MESSAGES & CHAT
		protected.GET("/messages/:partner_id", h.GetChatHistory)
		protected.GET("/conversations", h.GetConversations)
		protected.POST("/messages", h.SendMessage)
		protected.PATCH("/messages/:id", h.EditMessage)
		protected.DELETE("/messages/:id", h.DeleteMessage)
		protected.POST("/messages/:id/reaction", h.ReactToMessage)
		protected.POST("/conversations/:partner_id/mute", h.MuteConversation)
		protected.DELETE("/conversations/:partner_id/mute", h.UnmuteConversation)
		protected.GET("/conversations/:partner_id/muted", h.IsConversationMuted)

		// USER BLOCKING & PRIVACY
		protected.POST("/users/:id/block", h.BlockUser)
		protected.DELETE("/users/:id/block", h.UnblockUser)
		protected.GET("/users/blocked", h.GetBlockedUsers)
		protected.PUT("/users/privacy", h.UpdatePrivacySettings)
		protected.POST("/account/delete", h.DeleteAccount)

		// AI DISCOVERY & SUMMARIZATION
		protected.GET("/ai/recommendations", h.GetAIRecommendations)
		protected.POST("/ai/summarize", h.SummarizeDiscussion)

		// CALL & WEBRTC SIGNALING
		protected.GET("/call/online/:id", h.CheckUserOnline)
		protected.GET("/call/events", h.CallEventsStream)
		protected.POST("/call/signal", h.SendCallSignal)

		// DEVICE PUSH TOKENS
		protected.POST("/devices", h.RegisterDevice)
		protected.DELETE("/devices", h.UnregisterDevice)
		protected.POST("/logout", h.Logout)

		// HEARTBEAT & PRESENCE
		protected.POST("/heartbeat", h.Heartbeat)
		protected.GET("/heartbeat", h.Heartbeat)
		protected.POST("/users/heartbeat", h.Heartbeat)

		// REPORTS (Normal user endpoint with anti-spam rate limiting)
		protected.POST("/reports", middleware.RateLimitReport(), h.CreateReport)

		// LIVE BROADCAST STUDIO (HOST & PARTICIPANT ACTIONS)
		protected.POST("/lives", h.StartLive)
		protected.POST("/lives/:id/end", h.EndLive)
		protected.PUT("/lives/:id/title", h.UpdateLiveTitle)
		protected.POST("/lives/:id/title", h.UpdateLiveTitle)
		protected.POST("/lives/:id/replay/chunk", h.UploadReplayChunk)
		protected.POST("/lives/:id/replay/finish", h.FinishReplay)
		protected.POST("/lives/:id/replay/publish", h.PublishReplay)
	}

	// ADMIN ROUTES (Server-enforced role checking from database)
	admin := api.Group("/admin", utils.JWTMiddleware(), h.CheckUserStatus, middleware.RateLimitAdmin())
	{
		// Moderator and above: Reports and Content
		modOnly := admin.Group("/", h.RequireRole("moderator"))
		{
			modOnly.GET("/reports", h.AdminGetReports)
			modOnly.POST("/reports/:id/resolve", h.AdminResolveReport)
			modOnly.POST("/content/:type/:id/hide", h.AdminHideContent)
			modOnly.POST("/content/:type/:id/restore", h.AdminRestoreContent)
		}

		// Admin and above: Users, Suspend, Ban, Restore, Stats
		adminOnly := admin.Group("/", h.RequireRole("admin"))
		{
			adminOnly.GET("/users", h.AdminGetUsers)
			adminOnly.GET("/users/:id", h.AdminGetUser)
			adminOnly.POST("/users/:id/suspend", h.AdminSuspendUser)
			adminOnly.POST("/users/:id/ban", h.AdminBanUser)
			adminOnly.POST("/users/:id/restore", h.AdminRestoreUser)
			adminOnly.GET("/stats", h.AdminGetStats)
		}

		// Super Admin only: Role changes and Audit Log
		superAdminOnly := admin.Group("/", h.RequireRole("super_admin"))
		{
			superAdminOnly.POST("/users/:id/role", h.AdminUpdateUserRole)
			superAdminOnly.GET("/audit-log", h.AdminGetAuditLog)
		}
	}

	// Direct root fallbacks for mobile / devices
	r.POST("/devices", utils.JWTMiddleware(), h.RegisterDevice)
	r.DELETE("/devices", utils.JWTMiddleware(), h.UnregisterDevice)
	r.POST("/logout", utils.JWTMiddleware(), h.Logout)
	r.POST("/heartbeat", utils.JWTMiddleware(), h.Heartbeat)
	r.GET("/heartbeat", utils.JWTMiddleware(), h.Heartbeat)
	r.GET("/webrtc/config", h.GetWebRTCConfig)
	r.GET("/tracks", h.GetTracks)
	r.GET("/music/search", h.SearchMusic)
	r.GET("/communities", h.GetCommunities)

	// WebSocket
	r.GET("/ws", func(c *gin.Context) {
		tokenStr := c.Query("token")
		if tokenStr == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "missing token"})
			return
		}

		claims, err := utils.ParseToken(tokenStr)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired token"})
			return
		}

		h.Hub.HandleConnections(c.Writer, c.Request, claims.UserID)
	})
}

// ---------------------- BASIC ----------------------
func (h *Handler) Ping(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"message": "pong"})
}

// ---------------------- POSTS ----------------------

// canAccessCommunityPost checks whether the given user has access to a post belonging to a community.
// Returns true if the post is public/general or if the user is an active member of the community.
func (h *Handler) canAccessCommunityPost(communitySlugOrID string, userID uint) bool {
	comm := strings.TrimSpace(communitySlugOrID)
	if comm == "" || comm == "general" || comm == "home" {
		return true
	}
	if userID == 0 {
		return false
	}
	var community model.Community
	if err := h.DB.Where("slug = ? OR id::text = ?", comm, comm).First(&community).Error; err != nil {
		return false
	}
	var member model.CommunityMember
	if err := h.DB.Where("community_id = ? AND user_id = ? AND status = 'active'", community.ID, userID).First(&member).Error; err != nil {
		return false
	}
	return true
}

func (h *Handler) CreatePost(c *gin.Context) {
	var input struct {
		Content        string   `json:"content"`
		MediaURL       string   `json:"media_url"`
		Community      string   `json:"community"`
		MusicTrackID   *uint    `json:"music_track_id"`
		MusicSource    string   `json:"music_source"`
		MusicURL       string   `json:"music_url"`
		MusicTitle     string   `json:"music_title"`
		MusicArtist    string   `json:"music_artist"`
		MusicStartSec  float64  `json:"music_start_sec"`
		MuteOriginal   bool     `json:"mute_original"`
		MusicVolume    *float64 `json:"music_volume"`
		OriginalVolume *float64 `json:"original_volume"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate music_track_id if provided
	if input.MusicTrackID != nil && *input.MusicTrackID > 0 {
		var trk model.Track
		if err := h.DB.First(&trk, *input.MusicTrackID).Error; err != nil {
			input.MusicTrackID = nil
		}
	}

	// Validate volume ranges (0.0 to 1.0)
	musicVol := 1.0
	if input.MusicVolume != nil {
		if *input.MusicVolume < 0 || *input.MusicVolume > 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "music_volume must be between 0 and 1"})
			return
		}
		musicVol = *input.MusicVolume
	}

	origVol := 1.0
	if input.OriginalVolume != nil {
		if *input.OriginalVolume < 0 || *input.OriginalVolume > 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "original_volume must be between 0 and 1"})
			return
		}
		origVol = *input.OriginalVolume
	}

	// Validate music_start_sec >= 0
	if input.MusicStartSec < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "music_start_sec must be non-negative"})
		return
	}

	comm := strings.TrimSpace(input.Community)
	if comm == "" {
		comm = "general"
	}

	userID := c.GetUint("user_id")

	// If posting to a specific community, ensure community exists and user is an active member
	if comm != "general" && comm != "home" {
		var community model.Community
		if err := h.DB.Where("slug = ? OR id::text = ?", comm, comm).First(&community).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "community not found"})
			return
		}
		var member model.CommunityMember
		if err := h.DB.Where("community_id = ? AND user_id = ? AND status = 'active'", community.ID, userID).First(&member).Error; err != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "You must join this community before posting."})
			return
		}
		comm = community.Slug
	}
	post := model.Post{
		UserID:         userID,
		Content:        input.Content,
		MediaURL:       input.MediaURL,
		Community:      comm,
		MusicTrackID:   input.MusicTrackID,
		MusicSource:    input.MusicSource,
		MusicURL:       input.MusicURL,
		MusicTitle:     input.MusicTitle,
		MusicArtist:    input.MusicArtist,
		MusicStartSec:  input.MusicStartSec,
		MuteOriginal:   input.MuteOriginal,
		MusicVolume:    musicVol,
		OriginalVolume: origVol,
	}

	if err := h.DB.Create(&post).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create post"})
		return
	}

	h.DB.Preload("User", func(db *gorm.DB) *gorm.DB {
		return db.Select("id", "username", "name", "email", "avatar_url")
	}).Preload("MusicTrack").First(&post, post.ID)

	h.processMentions(post.Content, userID, post.ID)

	c.JSON(http.StatusCreated, post)
}

func (h *Handler) UploadMedia(c *gin.Context) {
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no file uploaded"})
		return
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read file"})
		return
	}

	contentType := header.Header.Get("Content-Type")
	ext := filepath.Ext(header.Filename)

	if ext == "" {
		if strings.HasPrefix(contentType, "video/") {
			if strings.Contains(contentType, "webm") {
				ext = ".webm"
			} else {
				ext = ".mp4"
			}
		} else if strings.HasPrefix(contentType, "image/") {
			if strings.Contains(contentType, "png") {
				ext = ".png"
			} else if strings.Contains(contentType, "webp") {
				ext = ".webp"
			} else {
				ext = ".jpg"
			}
		}
	}

	if contentType == "" || contentType == "application/octet-stream" {
		switch strings.ToLower(ext) {
		case ".mp4", ".m4v":
			contentType = "video/mp4"
		case ".webm":
			contentType = "video/webm"
		case ".mov":
			contentType = "video/quicktime"
		case ".ogg", ".ogv":
			contentType = "video/ogg"
		case ".3gp":
			contentType = "video/3gpp"
		case ".png":
			contentType = "image/png"
		case ".jpg", ".jpeg":
			contentType = "image/jpeg"
		case ".gif":
			contentType = "image/gif"
		case ".webp":
			contentType = "image/webp"
		case ".mp3":
			contentType = "audio/mpeg"
		default:
			contentType = "application/octet-stream"
		}
	}

	filename := fmt.Sprintf("%d_%s%s", time.Now().UnixNano(), uuid.New().String()[:8], ext)

	publicURL, err := storage.UploadToSupabase("media", filename, data, contentType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"url": publicURL})
}

func (h *Handler) GetPosts(c *gin.Context) {
	var posts []model.Post

	limit := 30
	page := 1

	if l := c.Query("limit"); l != "" {
		fmt.Sscanf(l, "%d", &limit)
	}
	if p := c.Query("page"); p != "" {
		fmt.Sscanf(p, "%d", &page)
	}

	offset := (page - 1) * limit
	userID := c.GetUint("user_id")

	query := h.DB.
		Where("posts.hidden_at IS NULL").
		Preload("User", func(db *gorm.DB) *gorm.DB {
			return db.Select("id", "username", "name", "email", "avatar_url")
		}).
		Preload("MusicTrack").
		Preload("Comments", func(db *gorm.DB) *gorm.DB {
			return db.Where("comments.hidden_at IS NULL").Order("created_at asc")
		}).
		Preload("Comments.User", func(db *gorm.DB) *gorm.DB {
			return db.Select("id", "username", "name", "email", "avatar_url")
		}).
		Preload("Parent", func(db *gorm.DB) *gorm.DB {
			return db.Where("posts.hidden_at IS NULL")
		}).
		Preload("Parent.User", func(db *gorm.DB) *gorm.DB {
			return db.Select("id", "username", "name", "email", "avatar_url")
		})

	var followingIDs []uint
	if userID > 0 {
		h.DB.Model(&model.Follow{}).Where("follower_id = ?", userID).Pluck("following_id", &followingIDs)
		followingIDs = append(followingIDs, userID) // include your own posts too
	}

	if c.Query("following") == "true" {
		query = query.Where("user_id IN ?", followingIDs)
	}

	community := strings.TrimSpace(c.Query("community"))
	if community == "" || community == "home" || community == "general" || community == "all" {
		query = query.Where("posts.community = 'general' OR posts.community = 'home' OR posts.community = '' OR posts.community IS NULL")
	} else {
		var targetComm model.Community
		if err := h.DB.Where("slug = ? OR id::text = ?", community, community).First(&targetComm).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "community not found"})
			return
		}
		if userID == 0 {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required to view community posts"})
			return
		}
		var member model.CommunityMember
		if err := h.DB.Where("community_id = ? AND user_id = ? AND status = 'active'", targetComm.ID, userID).First(&member).Error; err != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "This community is private. Only active members can view posts in this community."})
			return
		}
		query = query.Where("posts.community = ? OR posts.community = ?", targetComm.Slug, fmt.Sprintf("%d", targetComm.ID))
	}

	if len(followingIDs) > 0 && c.Query("following") != "true" {
		// Priority on posts from people we follow first, then other users follow
		query = query.Order(gorm.Expr("CASE WHEN user_id IN (?) THEN 0 ELSE 1 END, created_at desc", followingIDs))
	} else {
		query = query.Order("created_at desc")
	}

	if err := query.
		Limit(limit).
		Offset(offset).
		Find(&posts).Error; err != nil {

		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch posts"})
		return
	}

	if len(posts) > 0 {
		ids := make([]uint, len(posts))
		var allCommentIDs []uint
		for i, p := range posts {
			ids[i] = p.ID
			for _, cm := range p.Comments {
				allCommentIDs = append(allCommentIDs, cm.ID)
			}
		}
		var likedIDs []uint
		h.DB.Model(&model.Like{}).Where("user_id = ? AND post_id IN ?", userID, ids).Pluck("post_id", &likedIDs)
		likedSet := make(map[uint]bool, len(likedIDs))
		for _, id := range likedIDs {
			likedSet[id] = true
		}
		for i := range posts {
			posts[i].LikedByMe = likedSet[posts[i].ID]
		}

		if userID > 0 && len(allCommentIDs) > 0 {
			var likedCommentIDs []uint
			h.DB.Model(&model.CommentLike{}).Where("user_id = ? AND comment_id IN ?", userID, allCommentIDs).Pluck("comment_id", &likedCommentIDs)
			likedCommentSet := make(map[uint]bool, len(likedCommentIDs))
			for _, cid := range likedCommentIDs {
				likedCommentSet[cid] = true
			}
			for i := range posts {
				for j := range posts[i].Comments {
					posts[i].Comments[j].LikedByMe = likedCommentSet[posts[i].Comments[j].ID]
				}
			}
		}
	}

	c.JSON(http.StatusOK, posts)
}

func (h *Handler) UpdatePost(c *gin.Context) {
	var post model.Post

	if err := h.DB.First(&post, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "post not found",
		})
		return
	}

	var input struct {
		Content string `json:"content"`
	}

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": err.Error(),
		})
		return
	}

	post.Content = input.Content

	if err := h.DB.Save(&post).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "failed to update post",
		})
		return
	}

	h.DB.Preload("User", func(db *gorm.DB) *gorm.DB {
		return db.Select("id", "username", "name", "email", "avatar_url")
	}).First(&post, post.ID)

	c.JSON(http.StatusOK, post)
}

func (h *Handler) DeletePost(c *gin.Context) {
	var post model.Post

	if err := h.DB.First(&post, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "post not found",
		})
		return
	}

	userID := c.GetUint("user_id")
	var currentUser model.User
	_ = h.DB.Select("role").First(&currentUser, userID)
	isAdmin := currentUser.Role == "admin" || currentUser.Role == "super_admin" || currentUser.Role == "moderator"

	if post.UserID != userID && !isAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "not authorized to delete this post"})
		return
	}

	if err := h.DB.Delete(&post).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "failed to delete post",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "post deleted",
	})
}

func (h *Handler) RepostPost(c *gin.Context) {
	userID := c.GetUint("user_id")
	targetPostIDNum, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid post id"})
		return
	}
	targetPostID := uint(targetPostIDNum)

	// 1. Verify the original post exists
	var originalPost model.Post
	if err := h.DB.First(&originalPost, targetPostID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "original post not found"})
		return
	}

	// Verify permission if original post is inside a community
	if !h.canAccessCommunityPost(originalPost.Community, userID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "This post belongs to a private community. Only active members can repost it."})
		return
	}

	// 2. Create the repost
	// A repost has no media of its own and optional comment/text content (like a quote retweet), 
	// or it can just be a pure repost with empty content.
	var input struct {
		Content string `json:"content"`
	}
	_ = c.ShouldBindJSON(&input) // optional: allows quote reposts!

	repost := model.Post{
		UserID:    userID,
		Content:   input.Content,
		ParentID:  &targetPostID,
		Community: originalPost.Community,
	}

	if err := h.DB.Create(&repost).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create repost"})
		return
	}

	// 3. Load the relations (including the nested parent post and the parent post's author)
	h.DB.Preload("User", func(db *gorm.DB) *gorm.DB {
		return db.Select("id", "username", "name", "email", "avatar_url")
	}).Preload("Parent").Preload("Parent.User", func(db *gorm.DB) *gorm.DB {
		return db.Select("id", "username", "name", "email", "avatar_url")
	}).First(&repost, repost.ID)

	// 4. Notify the original poster that someone reposted their content!
	h.createNotification(originalPost.UserID, userID, "repost", &repost.ID)

	c.JSON(http.StatusCreated, repost)
}

// ---------------------- INTERACTIONS ----------------------

func (h *Handler) LikePost(c *gin.Context) {
	userID := c.GetUint("user_id")

	postIDNum, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid post id"})
		return
	}
	postID := uint(postIDNum)

	var post model.Post
	if err := h.DB.First(&post, postID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Post not found"})
		return
	}

	if !h.canAccessCommunityPost(post.Community, userID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "This post belongs to a private community. Only active members can like it."})
		return
	}

	var existing model.Like
	err = h.DB.Where("user_id = ? AND post_id = ?", userID, postID).First(&existing).Error

	liked := false
	if err == nil {
		// Already liked -> unlike
		if err := h.DB.Delete(&existing).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to unlike post"})
			return
		}
		liked = false
	} else {
		// Not liked yet -> like
		like := model.Like{UserID: userID, PostID: postID}
		if err := h.DB.Create(&like).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to like post"})
			return
		}
		liked = true
		h.createNotification(post.UserID, userID, "like", &postID)
	}

	// Always recompute the count fresh from the likes table itself.
	// This makes the count self-correcting -- it can never drift or go
	// negative, even if two toggle requests race each other.
	var count int64
	h.DB.Model(&model.Like{}).Where("post_id = ?", postID).Count(&count)
	h.DB.Model(&post).UpdateColumn("likes", count)

	c.JSON(http.StatusOK, gin.H{"liked": liked, "likes": count})
}

func (h *Handler) AddComment(c *gin.Context) {
	id := c.Param("id")
	userID := c.GetUint("user_id")

	var req struct {
		Content  string `json:"content" binding:"required"`
		ParentID *uint  `json:"parent_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Content required"})
		return
	}

	postIDNum, err := strconv.ParseUint(id, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid post id"})
		return
	}
	postID := uint(postIDNum)

	var post model.Post
	if err := h.DB.First(&post, postID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "post not found"})
		return
	}

	if !h.canAccessCommunityPost(post.Community, userID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "This post belongs to a private community. Only active members can comment on it."})
		return
	}

	comment := model.Comment{
		PostID:   postID,
		UserID:   userID,
		Content:  req.Content,
		ParentID: req.ParentID,
	}

	if err := h.DB.Create(&comment).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save comment"})
		return
	}

	// Update comments count on post
	h.DB.Model(&post).UpdateColumn("comments_count", gorm.Expr("comments_count + 1"))

	h.DB.Preload("User", func(db *gorm.DB) *gorm.DB {
		return db.Select("id", "username", "name", "email", "avatar_url")
	}).First(&comment, comment.ID)

	// If it's a reply to another comment, notify the parent comment owner
	if req.ParentID != nil && *req.ParentID > 0 {
		var parentComment model.Comment
		if err := h.DB.First(&parentComment, *req.ParentID).Error; err == nil {
			if parentComment.UserID != userID {
				h.createNotification(parentComment.UserID, userID, "comment_reply", &postID)
			}
		}
	}

	if post.UserID != userID {
		h.createNotification(post.UserID, userID, "comment", &postID)
	}
	h.processMentions(comment.Content, userID, postID)

	c.JSON(http.StatusOK, comment)
}

func (h *Handler) TogglePostCommentLike(c *gin.Context) {
	userID := c.GetUint("user_id")
	idNum, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid comment id"})
		return
	}
	commentID := uint(idNum)

	var comment model.Comment
	if err := h.DB.First(&comment, commentID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "comment not found"})
		return
	}

	var existing model.CommentLike
	err = h.DB.Where("user_id = ? AND comment_id = ?", userID, commentID).First(&existing).Error
	liked := false
	if err == nil {
		// Unlike
		if err := h.DB.Delete(&existing).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to unlike comment"})
			return
		}
		liked = false
	} else {
		// Like
		like := model.CommentLike{UserID: userID, CommentID: commentID}
		if err := h.DB.Create(&like).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to like comment"})
			return
		}
		liked = true
		if comment.UserID != userID {
			h.createNotification(comment.UserID, userID, "comment_like", &comment.PostID)
		}
	}

	var count int64
	h.DB.Model(&model.CommentLike{}).Where("comment_id = ?", commentID).Count(&count)
	h.DB.Model(&comment).UpdateColumn("likes", count)

	c.JSON(http.StatusOK, gin.H{"liked": liked, "likes": count})
}

// ---------------------- FOLLOWERS / FOLLOWING LISTS ----------------------

type userWithFollowStatus struct {
	model.User
	IsFollowing bool `json:"is_following"`
}

// buildFollowStatusList takes a set of user IDs and returns them as full user
// records, each annotated with whether the requester currently follows them.
func (h *Handler) buildFollowStatusList(userIDs []uint, requesterID uint) []userWithFollowStatus {
	var users []model.User
	if len(userIDs) > 0 {
		h.DB.Where("id IN ?", userIDs).Find(&users)
	}

	var requesterFollowingIDs []uint
	h.DB.Model(&model.Follow{}).Where("follower_id = ?", requesterID).Pluck("following_id", &requesterFollowingIDs)
	followingSet := make(map[uint]bool, len(requesterFollowingIDs))
	for _, id := range requesterFollowingIDs {
		followingSet[id] = true
	}

	result := make([]userWithFollowStatus, len(users))
	for i, u := range users {
		result[i] = userWithFollowStatus{User: u, IsFollowing: followingSet[u.ID] || u.ID == requesterID}
	}
	return result
}

func (h *Handler) GetFollowers(c *gin.Context) {
	targetIDNum, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}
	targetID := uint(targetIDNum)
	requesterID := c.GetUint("user_id")

	var follows []model.Follow
	h.DB.Where("following_id = ?", targetID).Find(&follows)

	ids := make([]uint, len(follows))
	for i, f := range follows {
		ids[i] = f.FollowerID
	}

	c.JSON(http.StatusOK, h.buildFollowStatusList(ids, requesterID))
}

func (h *Handler) GetFollowing(c *gin.Context) {
	targetIDNum, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}
	targetID := uint(targetIDNum)
	requesterID := c.GetUint("user_id")

	var follows []model.Follow
	h.DB.Where("follower_id = ?", targetID).Find(&follows)

	ids := make([]uint, len(follows))
	for i, f := range follows {
		ids[i] = f.FollowingID
	}

	c.JSON(http.StatusOK, h.buildFollowStatusList(ids, requesterID))
}

// ---------------------- NOTIFICATIONS ----------------------

// createNotification saves a notification and pushes it live over the
// WebSocket hub if the recipient is connected. Never notifies a user about
// their own action (e.g. liking your own post).
func (h *Handler) createNotification(recipientID, actorID uint, notifType string, postID *uint) {
	if recipientID == actorID {
		return
	}

	notif := model.Notification{
		UserID:  recipientID,
		ActorID: actorID,
		Type:    notifType,
		PostID:  postID,
	}

	if err := h.DB.Create(&notif).Error; err != nil {
		return
	}

	h.DB.Preload("Actor", func(db *gorm.DB) *gorm.DB {
		return db.Select("id", "username", "name", "avatar_url")
	}).First(&notif, notif.ID)

	payload, err := json.Marshal(gin.H{"event": "notification", "notification": notif})
	if err == nil {
		h.Hub.SendToUser(recipientID, payload)
	}
}

var mentionRegex = regexp.MustCompile(`@([a-zA-Z0-9_]+)`)

// processMentions scans content for @username patterns and creates a
// "mention" notification for each valid, distinct user mentioned.
func (h *Handler) processMentions(content string, actorID uint, postID uint) {
	matches := mentionRegex.FindAllStringSubmatch(content, -1)
	seen := make(map[string]bool)

	for _, m := range matches {
		username := m[1]
		if seen[username] {
			continue
		}
		seen[username] = true

		var mentionedUser model.User
		if err := h.DB.Where("username = ?", username).First(&mentionedUser).Error; err != nil {
			continue // no such user, skip silently
		}

		h.createNotification(mentionedUser.ID, actorID, "mention", &postID)
	}
}

func (h *Handler) GetNotifications(c *gin.Context) {
	userID := c.GetUint("user_id")

	var notifications []model.Notification
	h.DB.Preload("Actor", func(db *gorm.DB) *gorm.DB {
		return db.Select("id", "username", "name", "avatar_url")
	}).
		Where("user_id = ?", userID).
		Order("created_at desc").
		Limit(50).
		Find(&notifications)

	var unreadCount int64
	h.DB.Model(&model.Notification{}).Where("user_id = ? AND read = ?", userID, false).Count(&unreadCount)

	c.JSON(http.StatusOK, gin.H{
		"notifications": notifications,
		"unread_count":  unreadCount,
	})
}

func (h *Handler) MarkNotificationRead(c *gin.Context) {
	userID := c.GetUint("user_id")
	id := c.Param("id")

	if err := h.DB.Model(&model.Notification{}).
		Where("id = ? AND user_id = ?", id, userID).
		Update("read", true).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update notification"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "marked read"})
}

func (h *Handler) MarkAllNotificationsRead(c *gin.Context) {
	userID := c.GetUint("user_id")

	h.DB.Model(&model.Notification{}).
		Where("user_id = ? AND read = ?", userID, false).
		Update("read", true)

	c.JSON(http.StatusOK, gin.H{"message": "all marked read"})
}

type CallNotificationInput struct {
	ToUserID uint   `json:"to_user_id" binding:"required"`
	Type     string `json:"type" binding:"required"`
}

func (h *Handler) RecordCallNotification(c *gin.Context) {
	userID := c.GetUint("user_id")
	var input CallNotificationInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if input.Type != "missed_call" && input.Type != "missed_video_call" {
		input.Type = "missed_call"
	}

	h.createNotification(input.ToUserID, userID, input.Type, nil)
	c.JSON(http.StatusOK, gin.H{"message": "recorded", "type": input.Type})
}

// ---------------------- INPUT STRUCTS ----------------------
type RegisterInput struct {
	Email    string `json:"email" binding:"required"`
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type LoginInput struct {
	Email    string `json:"email" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type UpdateInput struct {
	Email     string `json:"email"`
	Username  string `json:"username"`
	Password  string `json:"password"`
	Name      string `json:"name"`
	Bio       string `json:"bio"`
	Skills    string `json:"skills"`
	Batch     string `json:"batch"`
	Location  string `json:"location"`
	AvatarURL string `json:"avatar_url"`
	BannerURL string `json:"banner_url"`
}

// ---------------------- USERS ----------------------
func (h *Handler) Me(c *gin.Context) {
	userID := c.GetUint("user_id")

	var user model.User
	if err := h.DB.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	c.JSON(http.StatusOK, user)
}

func (h *Handler) GetUsers(c *gin.Context) {
	var users []model.User
	h.DB.Find(&users)
	c.JSON(http.StatusOK, users)
}

func (h *Handler) GetUser(c *gin.Context) {
	var user model.User
	if err := h.DB.First(&user, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}
	c.JSON(http.StatusOK, user)
}

func (h *Handler) GetUserByUsername(c *gin.Context) {
	username := strings.TrimSpace(c.Param("username"))
	noSpaces := strings.ReplaceAll(strings.ToLower(username), " ", "")
	withUnderscores := strings.ReplaceAll(strings.ToLower(username), " ", "_")

	var user model.User
	// Match case-insensitively by username, name, or formatted variants
	if err := h.DB.Where(
		"LOWER(username) = LOWER(?) OR LOWER(username) = ? OR LOWER(name) = LOWER(?) OR REPLACE(LOWER(username), '_', '') = ? OR REPLACE(LOWER(name), ' ', '') = ?",
		username, withUnderscores, username, noSpaces, noSpaces,
	).First(&user).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	c.JSON(http.StatusOK, user)
}

func (h *Handler) CreateUser(c *gin.Context) {
	var input RegisterInput

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if !h.validateEmail(input.Email) { // 👈 Prefixed with h.
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid email"})
		return
	}

	if !h.validatePassword(input.Password) { // 👈 Prefixed with h.
		c.JSON(http.StatusBadRequest, gin.H{"error": "password too short"})
		return
	}

	if !h.validateUsername(input.Username) { // 👈 Prefixed with h.
		c.JSON(http.StatusBadRequest, gin.H{"error": "username too short"})
		return
	}

	hash, _ := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)

	user := model.User{
		Email:    input.Email,
		Username: input.Username,
		Password: string(hash),
	}

	if err := h.DB.Create(&user).Error; err != nil {
		if strings.Contains(err.Error(), "duplicate") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "user already exists"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, user)
}

func (h *Handler) UpdateUser(c *gin.Context) {
	targetIDStr := c.Param("id")
	targetID, err := strconv.ParseUint(targetIDStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	currentUserID := c.GetUint("user_id")
	var currentUser model.User
	_ = h.DB.Select("role").First(&currentUser, currentUserID)
	isAdmin := currentUser.Role == "admin" || currentUser.Role == "super_admin"

	if currentUserID != uint(targetID) && !isAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "not authorized to update this profile"})
		return
	}

	var user model.User

	if err := h.DB.First(&user, targetID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	var input UpdateInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if input.Email != "" && !h.validateEmail(input.Email) { // 👈 Prefixed with h.
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid email"})
		return
	}

	if input.Username != "" && !h.validateUsername(input.Username) { // 👈 Prefixed with h.
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid username"})
		return
	}

	if input.Password != "" && !h.validatePassword(input.Password) { // 👈 Prefixed with h.
		c.JSON(http.StatusBadRequest, gin.H{"error": "password too short"})
		return
	}

	if input.Email != "" {
		user.Email = input.Email
	}
	if input.Username != "" {
		user.Username = input.Username
	}
	if input.Password != "" {
		hash, _ := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
		user.Password = string(hash)
	}

	if input.Name != "" {
		user.Name = input.Name
	}
	if input.Bio != "" {
		user.Bio = input.Bio
	}
	if input.Skills != "" {
		user.Skills = input.Skills
	}
	if input.Batch != "" {
		user.Batch = input.Batch
	}
	if input.Location != "" {
		user.Location = input.Location
	}
	if input.AvatarURL != "" {
		user.AvatarURL = input.AvatarURL
	}
	if input.BannerURL != "" {
		user.BannerURL = input.BannerURL
	}

	h.DB.Save(&user)

	c.JSON(http.StatusOK, user)
}

func (h *Handler) DeleteUser(c *gin.Context) {
	targetIDStr := c.Param("id")
	targetID, err := strconv.ParseUint(targetIDStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	currentUserID := c.GetUint("user_id")
	var currentUser model.User
	_ = h.DB.Select("role").First(&currentUser, currentUserID)
	isAdmin := currentUser.Role == "admin" || currentUser.Role == "super_admin"

	if currentUserID != uint(targetID) && !isAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "not authorized to delete this user"})
		return
	}

	h.DB.Delete(&model.User{}, targetID)
	c.Status(http.StatusNoContent)
}


func (h *Handler) SearchUsers(c *gin.Context) {
    query := c.Query("q")
    if query == "" {
        c.JSON(http.StatusOK, []model.User{})
        return
    }

    var users []model.User
    // Case-insensitive search matching username OR full name
    err := h.DB.Where("LOWER(username) LIKE LOWER(?) OR LOWER(name) LIKE LOWER(?)", 
        "%"+query+"%", "%"+query+"%").
        Limit(10).
        Find(&users).Error

    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to search users"})
        return
    }

    c.JSON(http.StatusOK, users)
}


// ---------------------- FOLLOW / UNFOLLOW ----------------------

func (h *Handler) FollowUser(c *gin.Context) {
	followerID := c.GetUint("user_id")

	targetIDNum, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}
	targetID := uint(targetIDNum)

	if targetID == followerID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot follow yourself"})
		return
	}

	var target model.User
	if err := h.DB.First(&target, targetID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	var existing model.Follow
	err = h.DB.Where("follower_id = ? AND following_id = ?", followerID, targetID).First(&existing).Error
	if err == nil {
		// Already following -- no-op, no duplicate notification
		c.JSON(http.StatusOK, gin.H{"message": "followed", "following": true})
		return
	}

	follow := model.Follow{FollowerID: followerID, FollowingID: targetID}
	if err := h.DB.Create(&follow).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to follow user"})
		return
	}

	h.createNotification(targetID, followerID, "follow", nil)

	c.JSON(http.StatusOK, gin.H{"message": "followed", "following": true})
}

func (h *Handler) UnfollowUser(c *gin.Context) {
	followerID := c.GetUint("user_id")

	targetIDNum, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}
	targetID := uint(targetIDNum)

	if err := h.DB.Where("follower_id = ? AND following_id = ?", followerID, targetID).
		Delete(&model.Follow{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to unfollow user"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "unfollowed", "following": false})
}

// ---------------------- PROFILE ----------------------

func (h *Handler) GetUserProfile(c *gin.Context) {
	requesterID := c.GetUint("user_id")

	targetIDNum, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}
	targetID := uint(targetIDNum)

	var user model.User
	if err := h.DB.First(&user, targetID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	var followerCount, followingCount, postCount int64
	h.DB.Model(&model.Follow{}).Where("following_id = ?", targetID).Count(&followerCount)
	h.DB.Model(&model.Follow{}).Where("follower_id = ?", targetID).Count(&followingCount)
	h.DB.Model(&model.Post{}).Where("user_id = ? AND hidden_at IS NULL AND (community = 'general' OR community = 'home' OR community = '' OR community IS NULL)", targetID).Count(&postCount)

	var isFollowing bool
	if requesterID != targetID {
		var count int64
		h.DB.Model(&model.Follow{}).
			Where("follower_id = ? AND following_id = ?", requesterID, targetID).
			Count(&count)
		isFollowing = count > 0
	}

	// Fetch communities created by this user/creator
	var createdCommunities []model.Community
	h.DB.Where("created_by_id = ?", targetID).Find(&createdCommunities)
	for i := range createdCommunities {
		var mCount int64
		h.DB.Model(&model.CommunityMember{}).Where("community_id = ? AND status = 'active'", createdCommunities[i].ID).Count(&mCount)
		createdCommunities[i].MemberCount = mCount
	}

	c.JSON(http.StatusOK, gin.H{
		"user":                user,
		"follower_count":      followerCount,
		"following_count":     followingCount,
		"post_count":          postCount,
		"is_following":        isFollowing,
		"is_self":             requesterID == targetID,
		"created_communities": createdCommunities,
	})
}

func (h *Handler) GetUserPosts(c *gin.Context) {
	targetIDNum, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	limit := 10
	page := 1
	if l := c.Query("limit"); l != "" {
		fmt.Sscanf(l, "%d", &limit)
	}
	if p := c.Query("page"); p != "" {
		fmt.Sscanf(p, "%d", &page)
	}
	offset := (page - 1) * limit

	var posts []model.Post
	if err := h.DB.
		Where("user_id = ? AND posts.hidden_at IS NULL AND (posts.community = 'general' OR posts.community = 'home' OR posts.community = '' OR posts.community IS NULL)", uint(targetIDNum)).
		Preload("User", func(db *gorm.DB) *gorm.DB {
			return db.Select("id", "username", "name", "email", "avatar_url")
		}).
		Preload("Comments", func(db *gorm.DB) *gorm.DB {
			return db.Where("comments.hidden_at IS NULL").Order("created_at asc")
		}).
		Preload("Comments.User", func(db *gorm.DB) *gorm.DB {
			return db.Select("id", "username", "name", "email", "avatar_url")
		}).
		Preload("MusicTrack").
		Preload("Parent", func(db *gorm.DB) *gorm.DB {
			return db.Where("posts.hidden_at IS NULL")
		}).
		Preload("Parent.User", func(db *gorm.DB) *gorm.DB {
			return db.Select("id", "username", "name", "email", "avatar_url")
		}).
		Order("created_at desc").
		Limit(limit).
		Offset(offset).
		Find(&posts).Error; err != nil {
	}

	requesterID := c.GetUint("user_id")
	if len(posts) > 0 {
		ids := make([]uint, len(posts))
		var allCommentIDs []uint
		for i, p := range posts {
			ids[i] = p.ID
			for _, cm := range p.Comments {
				allCommentIDs = append(allCommentIDs, cm.ID)
			}
		}
		var likedIDs []uint
		h.DB.Model(&model.Like{}).Where("user_id = ? AND post_id IN ?", requesterID, ids).Pluck("post_id", &likedIDs)
		likedSet := make(map[uint]bool, len(likedIDs))
		for _, id := range likedIDs {
			likedSet[id] = true
		}
		for i := range posts {
			posts[i].LikedByMe = likedSet[posts[i].ID]
		}

		if requesterID > 0 && len(allCommentIDs) > 0 {
			var likedCommentIDs []uint
			h.DB.Model(&model.CommentLike{}).Where("user_id = ? AND comment_id IN ?", requesterID, allCommentIDs).Pluck("comment_id", &likedCommentIDs)
			likedCommentSet := make(map[uint]bool, len(likedCommentIDs))
			for _, cid := range likedCommentIDs {
				likedCommentSet[cid] = true
			}
			for i := range posts {
				for j := range posts[i].Comments {
					posts[i].Comments[j].LikedByMe = likedCommentSet[posts[i].Comments[j].ID]
				}
			}
		}
	}

	c.JSON(http.StatusOK, posts)
}

// ---------------------- LOGIN ----------------------
func (h *Handler) Login(c *gin.Context) {
	var input LoginInput

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	identifier := strings.TrimSpace(input.Email)
	idWithoutSpaces := strings.ReplaceAll(strings.ToLower(identifier), " ", "")
	idWithUnderscores := strings.ReplaceAll(strings.ToLower(identifier), " ", "_")

	var users []model.User
	if err := h.DB.Where(
		"LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?) OR LOWER(username) = ? OR LOWER(name) = LOWER(?) OR REPLACE(LOWER(username), '_', '') = ? OR REPLACE(LOWER(name), ' ', '') = ?",
		identifier, identifier, idWithUnderscores, identifier, idWithoutSpaces, idWithoutSpaces,
	).Find(&users).Error; err != nil || len(users) == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user not found"})
		return
	}

	var authenticatedUser *model.User
	for i := range users {
		if err := bcrypt.CompareHashAndPassword([]byte(users[i].Password), []byte(input.Password)); err == nil {
			authenticatedUser = &users[i]
			break
		}
	}

	if authenticatedUser == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "password mismatch"})
		return
	}

	// Check if user is banned or suspended
	if authenticatedUser.Status == "banned" {
		c.JSON(http.StatusForbidden, gin.H{
			"error":  "Your account has been banned.",
			"code":   "account_banned",
			"reason": authenticatedUser.StatusReason,
		})
		return
	}
	if authenticatedUser.Status == "suspended" && authenticatedUser.SuspendedUntil != nil {
		if time.Now().Before(*authenticatedUser.SuspendedUntil) {
			c.JSON(http.StatusForbidden, gin.H{
				"error":           fmt.Sprintf("Your account is suspended until %s.", authenticatedUser.SuspendedUntil.Format(time.RFC822)),
				"code":            "account_suspended",
				"reason":          authenticatedUser.StatusReason,
				"suspended_until": authenticatedUser.SuspendedUntil,
			})
			return
		}
		// Suspended duration has passed: automatically un-suspend
		h.DB.Model(&model.User{}).Where("id = ?", authenticatedUser.ID).Updates(map[string]interface{}{
			"status":          "active",
			"suspended_until": nil,
			"status_reason":   "",
		})
		authenticatedUser.Status = "active"
		authenticatedUser.SuspendedUntil = nil
	}

	token, err := utils.GenerateToken(authenticatedUser.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"token": token})
}

// ---------------------- FORGOT PASSWORD ----------------------
type ForgotPasswordInput struct {
	Email       string `json:"email" binding:"required"`
	NewPassword string `json:"new_password" binding:"required"`
}

func (h *Handler) ForgotPassword(c *gin.Context) {
	var input ForgotPasswordInput

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Please provide your email or username and a new password"})
		return
	}

	identifier := strings.TrimSpace(input.Email)
	if identifier == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Email or username is required"})
		return
	}

	if !h.validatePassword(input.NewPassword) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "New password must be at least 6 characters long"})
		return
	}

	var users []model.User
	if err := h.DB.Where("LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)", identifier, identifier).Find(&users).Error; err != nil || len(users) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "No account found matching that email or username"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(input.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to encrypt password"})
		return
	}

	for i := range users {
		users[i].Password = string(hash)
		if err := h.DB.Save(&users[i]).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update password"})
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Password updated successfully! You can now log in with your new password.",
	})
}

// ---------------------- RESOURCE ----------------------
func (h *Handler) GetResources(c *gin.Context) {
	var resources []model.Resource
	if err := h.DB.Order("id desc").Limit(50).Find(&resources).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch resources"})
		return
	}
	c.JSON(http.StatusOK, resources)
}

func (h *Handler) GetResource(c *gin.Context) {
	var res model.Resource
	if err := h.DB.First(&res, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "resource not found"})
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) CreateResource(c *gin.Context) {
	userID := c.GetUint("user_id")
	var input struct {
		Title       string `json:"title" binding:"required"`
		Body        string `json:"body"`
		Link        string `json:"link"`
		Description string `json:"description"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res := model.Resource{
		UserID:      userID,
		OwnerID:     userID,
		Name:        input.Title,
		Title:       input.Title,
		Body:        input.Body,
		Link:        input.Link,
		Description: input.Description,
	}
	if err := h.DB.Create(&res).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create resource"})
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *Handler) UpdateResource(c *gin.Context) {
	userID := c.GetUint("user_id")
	var res model.Resource
	if err := h.DB.First(&res, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "resource not found"})
		return
	}
	if res.UserID != userID && res.OwnerID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "not authorized to update this resource"})
		return
	}
	var input struct {
		Title       string `json:"title"`
		Body        string `json:"body"`
		Link        string `json:"link"`
		Description string `json:"description"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if input.Title != "" {
		res.Title = input.Title
		res.Name = input.Title
	}
	if input.Body != "" {
		res.Body = input.Body
	}
	if input.Link != "" {
		res.Link = input.Link
	}
	if input.Description != "" {
		res.Description = input.Description
	}
	h.DB.Save(&res)
	c.JSON(http.StatusOK, res)
}

func (h *Handler) DeleteResource(c *gin.Context) {
	userID := c.GetUint("user_id")
	var res model.Resource
	if err := h.DB.First(&res, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "resource not found"})
		return
	}
	if res.UserID != userID && res.OwnerID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "not authorized to delete this resource"})
		return
	}
	h.DB.Delete(&res)
	c.JSON(http.StatusOK, gin.H{"message": "resource deleted"})
}

// ---------------------- VALIDATION ----------------------
func (h *Handler) validateEmail(email string) bool { // 👈 Attached to *Handler struct
	re := regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)
	return re.MatchString(email)
}

func (h *Handler) validatePassword(password string) bool { // 👈 Attached to *Handler struct
	return len(password) >= 6
}

func (h *Handler) validateUsername(username string) bool { // 👈 Attached to *Handler struct
	return len(username) >= 3
}

// ---------------------- COMMUNITY STATS & ONLINE USERS ----------------------
func (h *Handler) GetCommunityStats(c *gin.Context) {
	var totalUsers int64
	h.DB.Model(&model.User{}).Count(&totalUsers)

	type OnlineUser struct {
		ID        uint   `json:"id"`
		Username  string `json:"username"`
		Name      string `json:"name"`
		AvatarURL string `json:"avatar_url"`
		Status    string `json:"status"`
	}

	onlineList := []OnlineUser{}

	var onlineIDs []uint
	if h.Hub != nil {
		onlineIDs = h.Hub.GetOnlineUserIDs()
	}

	if len(onlineIDs) > 0 {
		var users []model.User
		h.DB.Select("id", "username", "name", "avatar_url", "bio").
			Where("id IN ?", onlineIDs).
			Order("id asc").
			Limit(100).
			Find(&users)

		statuses := []string{
			"Working on Nesty",
			"Building something great",
			"Learning Go",
			"Active now",
			"Reviewing PRs",
			"Exploring Rust",
		}

		for i, u := range users {
			status := statuses[i%len(statuses)]
			if u.Bio != "" && len(u.Bio) < 35 {
				status = u.Bio
			}
			onlineList = append(onlineList, OnlineUser{
				ID:        u.ID,
				Username:  u.Username,
				Name:      u.Name,
				AvatarURL: u.AvatarURL,
				Status:    status,
			})
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"user_count":   totalUsers,
		"total_users":  totalUsers,
		"member_count": totalUsers,
		"online_users": onlineList,
	})
}

// ---------------------- CHAT & DIRECT MESSAGING ----------------------
func (h *Handler) GetChatHistory(c *gin.Context) {
	partnerIDStr := c.Param("partner_id")
	partnerID, err := strconv.ParseUint(partnerIDStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid partner ID"})
		return
	}

	userID := c.GetUint("user_id")

	// Limit and cursor pagination
	limitStr := c.DefaultQuery("limit", "50")
	limit, _ := strconv.Atoi(limitStr)
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	beforeIDStr := c.Query("before_id")

	query := h.DB.Preload("Reactions").Where(
		"((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))",
		userID, uint(partnerID), uint(partnerID), userID,
	)

	if beforeIDStr != "" {
		if beforeID, err := strconv.ParseUint(beforeIDStr, 10, 32); err == nil && beforeID > 0 {
			query = query.Where("id < ?", uint(beforeID))
		}
	}

	messages := make([]model.Message, 0)
	query.Order("id DESC").Limit(limit).Find(&messages)

	// Reverse messages so they are chronologically ascending
	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}

	// Mark all unread incoming messages from this partner as read and delivered
	now := time.Now()
	res := h.DB.Model(&model.Message{}).
		Where("sender_id = ? AND recipient_id = ? AND is_read = false", uint(partnerID), userID).
		Updates(map[string]interface{}{
			"is_read":      true,
			"read_at":      now,
			"is_delivered": true,
			"delivered_at": now,
		})

	_ = h.DB.Model(&model.Message{}).
		Where("sender_id = ? AND recipient_id = ? AND is_delivered = false", uint(partnerID), userID).
		Updates(map[string]interface{}{
			"is_delivered": true,
			"delivered_at": now,
		})

	if res.RowsAffected > 0 {
		readEvt, _ := json.Marshal(gin.H{
			"event":      "message_read",
			"reader_id":  userID,
			"partner_id": uint(partnerID),
			"read_at":    now,
		})
		h.Hub.SendToUser(uint(partnerID), readEvt)
	}

	// Populate quoted messages
	replyIDs := make([]uint, 0)
	for _, m := range messages {
		if m.ReplyToMessageID != nil && *m.ReplyToMessageID > 0 {
			replyIDs = append(replyIDs, *m.ReplyToMessageID)
		}
	}
	if len(replyIDs) > 0 {
		var parentMsgs []model.Message
		h.DB.Unscoped().Where("id IN ?", replyIDs).Find(&parentMsgs)
		parentMap := make(map[uint]model.Message)
		userIDs := make([]uint, 0)
		for _, pm := range parentMsgs {
			parentMap[pm.ID] = pm
			userIDs = append(userIDs, pm.SenderID)
		}
		var users []model.User
		if len(userIDs) > 0 {
			h.DB.Select("id, username, name").Where("id IN ?", userIDs).Find(&users)
		}
		userMap := make(map[uint]model.User)
		for _, u := range users {
			userMap[u.ID] = u
		}
		for i := range messages {
			if messages[i].ReplyToMessageID != nil {
				if pm, exists := parentMap[*messages[i].ReplyToMessageID]; exists {
					senderName := "User"
					username := "user"
					if u, ok := userMap[pm.SenderID]; ok {
						if u.Name != "" {
							senderName = u.Name
						} else {
							senderName = u.Username
						}
						username = u.Username
					}
					isDel := pm.DeletedAt.Valid
					text := pm.Content
					if isDel {
						text = "Original message unavailable"
					}
					messages[i].ReplyToMessage = &model.QuotedMessage{
						ID:         pm.ID,
						SenderID:   pm.SenderID,
						Username:   username,
						SenderName: senderName,
						Content:    text,
						MediaURL:   pm.MediaURL,
						MediaType:  pm.MediaType,
						IsDeleted:  isDel,
					}
				} else {
					messages[i].ReplyToMessage = &model.QuotedMessage{
						ID:        *messages[i].ReplyToMessageID,
						IsDeleted: true,
						Content:   "Original message unavailable",
					}
				}
			}
		}
	}

	c.JSON(http.StatusOK, messages)
}

func (h *Handler) GetConversations(c *gin.Context) {
	userID := c.GetUint("user_id")

	// Get muted partner IDs
	var mutes []model.ConversationMute
	h.DB.Where("user_id = ?", userID).Find(&mutes)
	muteMap := make(map[uint]bool)
	for _, m := range mutes {
		muteMap[m.PartnerID] = true
	}

	// Compute unread counts grouped by sender
	type unreadCountRow struct {
		SenderID uint  `gorm:"column:sender_id"`
		Count    int64 `gorm:"column:count"`
	}
	var unreadRows []unreadCountRow
	h.DB.Model(&model.Message{}).
		Select("sender_id, count(*) as count").
		Where("recipient_id = ? AND is_read = false", userID).
		Group("sender_id").
		Scan(&unreadRows)
	unreadMap := make(map[uint]int64)
	for _, row := range unreadRows {
		unreadMap[row.SenderID] = row.Count
	}

	// Filter: only show users the current user follows
	var follows []model.Follow
	h.DB.Where("follower_id = ?", userID).Find(&follows)
	followingMap := make(map[uint]bool, len(follows))
	for _, f := range follows {
		followingMap[f.FollowingID] = true
	}

	var messages []model.Message
	h.DB.Where("sender_id = ? OR recipient_id = ?", userID, userID).
		Order("id DESC").
		Find(&messages)

	type ConversationItem struct {
		Partner     model.User `json:"partner"`
		LastMessage string     `json:"last_message"`
		LastTime    time.Time  `json:"last_time"`
		MediaType   string     `json:"media_type"`
		IsSender    bool       `json:"is_sender"`
		UnreadCount int64      `json:"unread_count"`
		IsMuted     bool       `json:"is_muted"`
	}

	seen := make(map[uint]bool)
	partnerIDs := make([]uint, 0)
	type latestMsgInfo struct {
		msg      model.Message
		isSender bool
	}
	latestMap := make(map[uint]latestMsgInfo)

	for _, msg := range messages {
		partnerID := msg.RecipientID
		if partnerID == userID {
			partnerID = msg.SenderID
		}
		if partnerID == 0 || partnerID == userID || seen[partnerID] || !followingMap[partnerID] {
			continue
		}
		seen[partnerID] = true
		partnerIDs = append(partnerIDs, partnerID)
		latestMap[partnerID] = latestMsgInfo{
			msg:      msg,
			isSender: msg.SenderID == userID,
		}
	}

	conversations := make([]ConversationItem, 0)
	if len(partnerIDs) > 0 {
		var partners []model.User
		h.DB.Where("id IN ?", partnerIDs).Find(&partners)
		partnerUserMap := make(map[uint]model.User)
		for _, p := range partners {
			partnerUserMap[p.ID] = p
		}

		for _, pid := range partnerIDs {
			if p, ok := partnerUserMap[pid]; ok {
				info := latestMap[pid]
				conversations = append(conversations, ConversationItem{
					Partner:     p,
					LastMessage: info.msg.Content,
					LastTime:    info.msg.CreatedAt,
					MediaType:   info.msg.MediaType,
					IsSender:    info.isSender,
					UnreadCount: unreadMap[pid],
					IsMuted:     muteMap[pid],
				})
			}
		}
	}

	c.JSON(http.StatusOK, conversations)
}

func (h *Handler) SendMessage(c *gin.Context) {
	var input struct {
		RecipientID      uint   `json:"recipient_id" binding:"required"`
		Content          string `json:"content"`
		MediaURL         string `json:"media_url"`
		MediaType        string `json:"media_type"`
		FileName         string `json:"file_name"`
		FileSize         int64  `json:"file_size"`
		ReplyToMessageID *uint  `json:"reply_to_message_id"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	content := strings.TrimSpace(input.Content)
	mediaURL := strings.TrimSpace(input.MediaURL)
	if content == "" && mediaURL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "message must contain text or an attachment"})
		return
	}

	userID := c.GetUint("user_id")

	// Block checking: ensure neither party has blocked the other
	var blockCount int64
	h.DB.Model(&model.Block{}).
		Where("(blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)",
			userID, input.RecipientID, input.RecipientID, userID).
		Count(&blockCount)

	if blockCount > 0 {
		c.JSON(http.StatusForbidden, gin.H{"error": "cannot send messages to this user"})
		return
	}

	isOnline := h.Hub.IsUserOnline(input.RecipientID)
	now := time.Now()
	var deliveredAt *time.Time
	if isOnline {
		deliveredAt = &now
	}

	msg := model.Message{
		SenderID:         userID,
		RecipientID:      input.RecipientID,
		Content:          content,
		MediaURL:         mediaURL,
		MediaType:        input.MediaType,
		FileName:         input.FileName,
		FileSize:         input.FileSize,
		ReplyToMessageID: input.ReplyToMessageID,
		IsDelivered:      isOnline,
		DeliveredAt:      deliveredAt,
		IsRead:           false,
	}

	if err := h.DB.Create(&msg).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save message"})
		return
	}

	// Resolve quote if replied to a message
	if input.ReplyToMessageID != nil && *input.ReplyToMessageID > 0 {
		var parent model.Message
		if err := h.DB.Unscoped().First(&parent, *input.ReplyToMessageID).Error; err == nil {
			senderName := "User"
			username := "user"
			var parentUser model.User
			if err := h.DB.Select("id, username, name").First(&parentUser, parent.SenderID).Error; err == nil {
				if parentUser.Name != "" {
					senderName = parentUser.Name
				} else {
					senderName = parentUser.Username
				}
				username = parentUser.Username
			}
			isDel := parent.DeletedAt.Valid
			text := parent.Content
			if isDel {
				text = "Original message unavailable"
			}
			msg.ReplyToMessage = &model.QuotedMessage{
				ID:         parent.ID,
				SenderID:   parent.SenderID,
				Username:   username,
				SenderName: senderName,
				Content:    text,
				MediaURL:   parent.MediaURL,
				MediaType:  parent.MediaType,
				IsDeleted:  isDel,
			}
		} else {
			msg.ReplyToMessage = &model.QuotedMessage{
				ID:        *input.ReplyToMessageID,
				IsDeleted: true,
				Content:   "Original message unavailable",
			}
		}
	}

	// Deliver live message over WebSocket if recipient is online
	msgJSON, _ := json.Marshal(gin.H{
		"event":   "message",
		"message": msg,
	})
	deliveredLive := h.Hub.SendToUser(input.RecipientID, msgJSON)
	if deliveredLive && !msg.IsDelivered {
		msg.IsDelivered = true
		t := time.Now()
		msg.DeliveredAt = &t
		h.DB.Model(&msg).Updates(map[string]interface{}{"is_delivered": true, "delivered_at": t})
	}
	if msg.IsDelivered {
		delivEvt, _ := json.Marshal(gin.H{
			"event":        "message_delivered",
			"message_id":   msg.ID,
			"sender_id":    userID,
			"recipient_id": input.RecipientID,
			"delivered_at": msg.DeliveredAt,
		})
		h.Hub.SendToUser(userID, delivEvt)
	}

	// Check if conversation is muted by recipient
	var muteCount int64
	h.DB.Model(&model.ConversationMute{}).
		Where("user_id = ? AND partner_id = ?", input.RecipientID, userID).
		Count(&muteCount)

	if muteCount == 0 && userID != input.RecipientID {
		notif := model.Notification{
			UserID:  input.RecipientID,
			ActorID: userID,
			Type:    "message",
			Read:    false,
		}
		_ = h.DB.Create(&notif)
	}

	c.JSON(http.StatusCreated, msg)
}

// EditMessage allows sender to edit content within 24 hours
func (h *Handler) EditMessage(c *gin.Context) {
	msgID := c.Param("id")
	userID := c.GetUint("user_id")

	var msg model.Message
	if err := h.DB.First(&msg, msgID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "message not found"})
		return
	}

	if msg.SenderID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "only the sender can edit this message"})
		return
	}

	if time.Since(msg.CreatedAt) > 24*time.Hour {
		c.JSON(http.StatusBadRequest, gin.H{"error": "messages can only be edited within 24 hours"})
		return
	}

	var input struct {
		Content string `json:"content" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	cleanContent := strings.TrimSpace(input.Content)
	if cleanContent == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "content cannot be empty"})
		return
	}

	now := time.Now()
	msg.Content = cleanContent
	msg.EditedAt = &now
	if err := h.DB.Save(&msg).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to edit message"})
		return
	}

	editJSON, _ := json.Marshal(gin.H{
		"event":        "message_edited",
		"message_id":   msg.ID,
		"content":      msg.Content,
		"edited_at":    now,
		"sender_id":    msg.SenderID,
		"recipient_id": msg.RecipientID,
	})
	h.Hub.SendToUser(msg.RecipientID, editJSON)

	c.JSON(http.StatusOK, msg)
}

// DeleteMessage allows sender or admin to soft delete a message
func (h *Handler) DeleteMessage(c *gin.Context) {
	msgID := c.Param("id")
	userID := c.GetUint("user_id")

	var msg model.Message
	if err := h.DB.First(&msg, msgID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "message not found"})
		return
	}

	var currentUser model.User
	_ = h.DB.Select("role").First(&currentUser, userID)
	isAdmin := currentUser.Role == "admin" || currentUser.Role == "super_admin"

	if msg.SenderID != userID && !isAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "not authorized to delete this message"})
		return
	}

	if err := h.DB.Delete(&msg).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete message"})
		return
	}

	deleteJSON, _ := json.Marshal(gin.H{
		"event":        "message_deleted",
		"message_id":   msg.ID,
		"sender_id":    msg.SenderID,
		"recipient_id": msg.RecipientID,
	})
	h.Hub.SendToUser(msg.RecipientID, deleteJSON)

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ReactToMessage adds or toggles an emoji reaction on a message
func (h *Handler) ReactToMessage(c *gin.Context) {
	msgIDStr := c.Param("id")
	msgID, err := strconv.ParseUint(msgIDStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid message ID"})
		return
	}

	userID := c.GetUint("user_id")

	var msg model.Message
	if err := h.DB.First(&msg, msgID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "message not found"})
		return
	}

	if msg.SenderID != userID && msg.RecipientID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "not authorized to react to this message"})
		return
	}

	var input struct {
		Emoji string `json:"emoji" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	emoji := strings.TrimSpace(input.Emoji)
	if emoji == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "emoji cannot be empty"})
		return
	}

	var existing model.MessageReaction
	if err := h.DB.Where("message_id = ? AND user_id = ?", uint(msgID), userID).First(&existing).Error; err == nil {
		if existing.Emoji == emoji {
			h.DB.Delete(&existing)
			h.broadcastReaction(msg, userID, emoji, true)
			c.JSON(http.StatusOK, gin.H{"removed": true, "emoji": emoji})
			return
		}
		existing.Emoji = emoji
		h.DB.Save(&existing)
		h.broadcastReaction(msg, userID, emoji, false)
		c.JSON(http.StatusOK, existing)
		return
	}

	reaction := model.MessageReaction{
		MessageID: uint(msgID),
		UserID:    userID,
		Emoji:     emoji,
		CreatedAt: time.Now(),
	}
	if err := h.DB.Create(&reaction).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to add reaction"})
		return
	}

	h.broadcastReaction(msg, userID, emoji, false)
	c.JSON(http.StatusCreated, reaction)
}

func (h *Handler) broadcastReaction(msg model.Message, userID uint, emoji string, removed bool) {
	partnerID := msg.RecipientID
	if partnerID == userID {
		partnerID = msg.SenderID
	}
	reactionEvt, _ := json.Marshal(gin.H{
		"event":      "message_reaction",
		"message_id": msg.ID,
		"user_id":    userID,
		"emoji":      emoji,
		"removed":    removed,
	})
	h.Hub.SendToUser(partnerID, reactionEvt)
}

// BlockUser blocks another user from sending messages or calling
func (h *Handler) BlockUser(c *gin.Context) {
	targetParam := c.Param("id")
	targetID, err := strconv.ParseUint(targetParam, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}
	userID := c.GetUint("user_id")
	if userID == uint(targetID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot block yourself"})
		return
	}

	block := model.Block{
		BlockerID: userID,
		BlockedID: uint(targetID),
		CreatedAt: time.Now(),
	}
	_ = h.DB.Where("blocker_id = ? AND blocked_id = ?", userID, uint(targetID)).FirstOrCreate(&block)
	c.JSON(http.StatusOK, gin.H{"blocked": true, "user_id": targetID})
}

// UnblockUser removes a block
func (h *Handler) UnblockUser(c *gin.Context) {
	targetParam := c.Param("id")
	targetID, err := strconv.ParseUint(targetParam, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}
	userID := c.GetUint("user_id")
	h.DB.Where("blocker_id = ? AND blocked_id = ?", userID, uint(targetID)).Delete(&model.Block{})
	c.JSON(http.StatusOK, gin.H{"unblocked": true, "user_id": targetID})
}

// GetBlockedUsers lists blocked users for current user
func (h *Handler) GetBlockedUsers(c *gin.Context) {
	userID := c.GetUint("user_id")
	var blocks []model.Block
	h.DB.Preload("Blocked").Where("blocker_id = ?", userID).Find(&blocks)
	c.JSON(http.StatusOK, blocks)
}

// MuteConversation mutes notifications for a specific conversation partner
func (h *Handler) MuteConversation(c *gin.Context) {
	partnerParam := c.Param("partner_id")
	partnerID, err := strconv.ParseUint(partnerParam, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid partner ID"})
		return
	}
	userID := c.GetUint("user_id")
	mute := model.ConversationMute{
		UserID:    userID,
		PartnerID: uint(partnerID),
		CreatedAt: time.Now(),
	}
	_ = h.DB.Where("user_id = ? AND partner_id = ?", userID, uint(partnerID)).FirstOrCreate(&mute)
	c.JSON(http.StatusOK, gin.H{"muted": true, "partner_id": partnerID})
}

// UnmuteConversation unmutes a conversation
func (h *Handler) UnmuteConversation(c *gin.Context) {
	partnerParam := c.Param("partner_id")
	partnerID, err := strconv.ParseUint(partnerParam, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid partner ID"})
		return
	}
	userID := c.GetUint("user_id")
	h.DB.Where("user_id = ? AND partner_id = ?", userID, uint(partnerID)).Delete(&model.ConversationMute{})
	c.JSON(http.StatusOK, gin.H{"unmuted": true, "partner_id": partnerID})
}

// IsConversationMuted returns mute state
func (h *Handler) IsConversationMuted(c *gin.Context) {
	partnerParam := c.Param("partner_id")
	partnerID, _ := strconv.ParseUint(partnerParam, 10, 32)
	userID := c.GetUint("user_id")
	var count int64
	h.DB.Model(&model.ConversationMute{}).Where("user_id = ? AND partner_id = ?", userID, uint(partnerID)).Count(&count)
	c.JSON(http.StatusOK, gin.H{"is_muted": count > 0})
}

// UpdatePrivacySettings manages online presence and last seen visibility
func (h *Handler) UpdatePrivacySettings(c *gin.Context) {
	userID := c.GetUint("user_id")
	var input struct {
		HideLastSeen *bool `json:"hide_last_seen"`
		HidePresence *bool `json:"hide_presence"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := make(map[string]interface{})
	if input.HideLastSeen != nil {
		updates["hide_last_seen"] = *input.HideLastSeen
	}
	if input.HidePresence != nil {
		updates["hide_presence"] = *input.HidePresence
	}

	if len(updates) > 0 {
		if err := h.DB.Model(&model.User{}).Where("id = ?", userID).Updates(updates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update privacy settings"})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "updates": updates})
}

// DeleteAccount handles account deletion with cascade cleanup
func (h *Handler) DeleteAccount(c *gin.Context) {
	userID := c.GetUint("user_id")
	h.DB.Delete(&model.User{}, userID)
	h.DB.Where("user_id = ?", userID).Delete(&model.Device{})
	h.DB.Where("user_id = ?", userID).Delete(&model.CommunityMember{})
	c.JSON(http.StatusOK, gin.H{"message": "account successfully deleted"})
}

// GetAIRecommendations returns AI-driven person and community recommendations
func (h *Handler) GetAIRecommendations(c *gin.Context) {
	userID := c.GetUint("user_id")
	if h.AI == nil {
		h.AI = ai.NewService()
	}
	recs, err := h.AI.GetRecommendations(h.DB, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, recs)
}

// SummarizeDiscussion summarizes long chat discussions into key takeaways
func (h *Handler) SummarizeDiscussion(c *gin.Context) {
	var input struct {
		Topic    string   `json:"topic"`
		Messages []string `json:"messages" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if h.AI == nil {
		h.AI = ai.NewService()
	}
	summary, err := h.AI.SummarizeDiscussion(input.Messages, input.Topic)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, summary)
}

// ---------------------- CALL & WEBRTC SIGNALING ----------------------
func (h *Handler) CheckUserOnline(c *gin.Context) {
	partnerIDStr := c.Param("id")
	targetID, err := strconv.ParseUint(partnerIDStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}

	online := h.Hub.IsUserOnline(uint(targetID))
	c.JSON(http.StatusOK, gin.H{
		"online":  online,
		"user_id": targetID,
	})
}

// CallEventsStream provides a persistent Server-Sent Events (SSE) stream for native mobile background listeners
func (h *Handler) CallEventsStream(c *gin.Context) {
	userID := c.GetUint("user_id")
	if userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no")

	ch := make(chan []byte, 32)
	h.Hub.RegisterSSE(userID, ch)
	defer h.Hub.UnregisterSSE(userID, ch)

	c.Writer.Flush()

	clientGone := c.Request.Context().Done()
	pingTicker := time.NewTicker(20 * time.Second)
	defer pingTicker.Stop()

	// Initial connected confirmation
	fmt.Fprintf(c.Writer, "data: {\"event\":\"connected\",\"user_id\":%d}\n\n", userID)
	c.Writer.Flush()

	for {
		select {
		case <-clientGone:
			return
		case msg := <-ch:
			fmt.Fprintf(c.Writer, "data: %s\n\n", string(msg))
			c.Writer.Flush()
		case <-pingTicker.C:
			fmt.Fprintf(c.Writer, ": ping\n\n")
			c.Writer.Flush()
		}
	}
}

type CallSignalInput struct {
	ToUserID uint        `json:"to_user_id" binding:"required"`
	Type     string      `json:"type" binding:"required"`
	Data     interface{} `json:"data"`
	Caller   *struct {
		ID        uint   `json:"id"`
		Username  string `json:"username"`
		Name      string `json:"name"`
		AvatarURL string `json:"avatar_url"`
	} `json:"caller"`
}

func (h *Handler) SendCallSignal(c *gin.Context) {
	userID := c.GetUint("user_id")
	var input CallSignalInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	callerID := userID
	callerUsername := ""
	callerName := ""
	callerAvatar := ""

	if input.Caller != nil && input.Caller.ID == userID && input.Caller.Username != "" {
		callerUsername = input.Caller.Username
		callerName = input.Caller.Name
		callerAvatar = input.Caller.AvatarURL
	} else {
		var caller model.User
		h.DB.Select("id", "username", "name", "avatar_url").First(&caller, userID)
		callerUsername = caller.Username
		callerName = caller.Name
		callerAvatar = caller.AvatarURL
	}

	online := h.Hub.IsUserOnline(input.ToUserID)

	payload, _ := json.Marshal(gin.H{
		"event":        "call_signal",
		"type":         input.Type,
		"from_user_id": userID,
		"to_user_id":   input.ToUserID,
		"caller": gin.H{
			"id":         callerID,
			"username":   callerUsername,
			"name":       callerName,
			"avatar_url": callerAvatar,
		},
		"data": input.Data,
	})

	sent := h.Hub.SendToUser(input.ToUserID, payload)

	// Process call signal for push notifications & 30s ring timeout
	h.processCallSignal(userID, input.ToUserID, input.Type, callerName, callerAvatar, input.Data)

	if input.Type == "missed_call" || input.Type == "missed_video_call" {
		h.createNotification(input.ToUserID, userID, input.Type, nil)
	}

	c.JSON(http.StatusOK, gin.H{
		"sent":    sent,
		"online":  online,
		"type":    input.Type,
		"to_user": input.ToUserID,
	})
}

func (h *Handler) processCallSignal(fromUserID, toUserID uint, signalType, callerName, callerAvatar string, data interface{}) {
	callID := ""
	callType := "audio"

	if m, ok := data.(map[string]interface{}); ok {
		if cid, exists := m["callId"].(string); exists && cid != "" {
			callID = cid
		}
		if isVid, exists := m["isVideo"].(bool); exists && isVid {
			callType = "video"
		}
	}
	if signalType == "call_invite_video" || strings.Contains(signalType, "video") {
		callType = "video"
	}
	if callID == "" {
		callID = fmt.Sprintf("call_%d_%d_%d", fromUserID, toUserID, time.Now().UnixMilli())
	}

	switch signalType {
	case "call_invite", "call_invite_video":
		// Send high-priority data push notification (Android FCM / iOS APNs PushKit)
		if h.Push != nil {
			go h.Push.SendCallInvite(toUserID, push.CallPushPayload{
				CallID:          callID,
				CallerID:        fromUserID,
				CallerName:      callerName,
				CallerAvatarURL: callerAvatar,
				CallType:        callType,
			})
		}

		// Ring timeout (about 45 seconds)
		timer := time.AfterFunc(45*time.Second, func() {
			h.callTimers.Delete(callID)

			// Missed call push notification
			if h.Push != nil {
				h.Push.SendMissedCallNotification(toUserID, push.CallPushPayload{
					CallID:          callID,
					CallerID:        fromUserID,
					CallerName:      callerName,
					CallerAvatarURL: callerAvatar,
					CallType:        callType,
				})
			}

			// Broadcast call_ended to both parties
			calleeMsg, _ := json.Marshal(gin.H{
				"event":        "call_signal",
				"type":         "call_ended",
				"from_user_id": 0,
				"to_user_id":   toUserID,
				"data": gin.H{
					"callId": callID,
					"reason": "timeout",
				},
			})
			h.Hub.SendToUser(toUserID, calleeMsg)

			callerMsg, _ := json.Marshal(gin.H{
				"event":        "call_signal",
				"type":         "call_ended",
				"from_user_id": 0,
				"to_user_id":   fromUserID,
				"data": gin.H{
					"callId": callID,
					"reason": "timeout",
				},
			})
			h.Hub.SendToUser(fromUserID, callerMsg)

			// Record missed call in DB
			notifType := "missed_call"
			if callType == "video" {
				notifType = "missed_video_call"
			}
			h.createNotification(toUserID, fromUserID, notifType, nil)
		})
		h.callTimers.Store(callID, timer)

	case "call_accepted":
		if callID != "" {
			if t, ok := h.callTimers.Load(callID); ok {
				if timer, isTimer := t.(*time.Timer); isTimer {
					timer.Stop()
				}
				h.callTimers.Delete(callID)
			}
		}
		// Also stop any lingering timer between these two users
		h.callTimers.Range(func(key, value interface{}) bool {
			kStr, isStr := key.(string)
			if isStr && (strings.Contains(kStr, fmt.Sprintf("%d", toUserID)) || strings.Contains(kStr, fmt.Sprintf("%d", fromUserID))) {
				if timer, isTimer := value.(*time.Timer); isTimer {
					timer.Stop()
				}
				h.callTimers.Delete(key)
			}
			return true
		})

	case "call_ended", "call_declined", "call_busy", "call_cancelled":
		if callID != "" {
			if t, ok := h.callTimers.Load(callID); ok {
				if timer, isTimer := t.(*time.Timer); isTimer {
					timer.Stop()
				}
				h.callTimers.Delete(callID)
			}
		}
		h.callTimers.Range(func(key, value interface{}) bool {
			kStr, isStr := key.(string)
			if isStr && (strings.Contains(kStr, fmt.Sprintf("%d", toUserID)) || strings.Contains(kStr, fmt.Sprintf("%d", fromUserID))) {
				if timer, isTimer := value.(*time.Timer); isTimer {
					timer.Stop()
				}
				h.callTimers.Delete(key)
			}
			return true
		})
		// When caller cancels, send cancel push so callee ringing stops
		if h.Push != nil && callID != "" {
			go h.Push.SendCallCancel(toUserID, callID)
		}
	}
}

// HandleCallSignalHook is invoked by Hub when a targeted signal is sent directly over WebSocket
func (h *Handler) HandleCallSignalHook(fromUserID uint, toUserID uint, raw map[string]interface{}) {
	sigType, _ := raw["type"].(string)
	var callerName, callerAvatar string
	if callerMap, ok := raw["caller"].(map[string]interface{}); ok {
		callerName, _ = callerMap["name"].(string)
		callerAvatar, _ = callerMap["avatar_url"].(string)
	}
	h.processCallSignal(fromUserID, toUserID, sigType, callerName, callerAvatar, raw["data"])
}

// HandleGroupCallStartHook is invoked by Hub when a live group call begins in a community
func (h *Handler) HandleGroupCallStartHook(fromUserID uint, channelID string, raw map[string]interface{}) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[GroupCallNotifications] Recovered from panic in hook: %v", r)
		}
	}()

	// 1. Resolve community from channelID (supports numeric ID or slug)
	var comm model.Community
	var commID uint
	if cid, err := strconv.ParseUint(channelID, 10, 32); err == nil {
		if err := h.DB.First(&comm, cid).Error; err == nil {
			commID = comm.ID
		}
	}
	if commID == 0 {
		if err := h.DB.Where("slug = ?", channelID).First(&comm).Error; err == nil {
			commID = comm.ID
		}
	}
	if commID == 0 {
		return // not a community channel
	}

	// 2. Fetch all active members belonging to this community (excluding the caller)
	var memberIDs []uint
	h.DB.Model(&model.CommunityMember{}).
		Where("community_id = ? AND status = 'active' AND user_id != ?", commID, fromUserID).
		Pluck("user_id", &memberIDs)

	if comm.CreatedByID > 0 && comm.CreatedByID != fromUserID {
		found := false
		for _, id := range memberIDs {
			if id == comm.CreatedByID {
				found = true
				break
			}
		}
		if !found {
			memberIDs = append(memberIDs, comm.CreatedByID)
		}
	}

	if len(memberIDs) == 0 {
		return
	}

	// 3. Load caller info
	var caller model.User
	h.DB.Select("id", "username", "name", "avatar_url").First(&caller, fromUserID)
	callerName := caller.Name
	if callerName == "" {
		callerName = caller.Username
	}
	callType, _ := raw["call_type"].(string)
	if callType == "" {
		callType = "audio"
	}

	// 4. Create in-app notifications and deliver via WebSocket to all community members
	for _, mid := range memberIDs {
		notif := model.Notification{
			UserID:    mid,
			ActorID:   fromUserID,
			Type:      "community_call",
			ChannelID: channelID,
		}
		if err := h.DB.Create(&notif).Error; err == nil {
			notif.Actor = &caller
			payload, _ := json.Marshal(gin.H{
				"event":        "notification",
				"notification": notif,
				"community_call": gin.H{
					"channel_id":    channelID,
					"channel_name":  comm.Name,
					"call_type":     callType,
					"caller_id":     fromUserID,
					"caller_name":   callerName,
					"caller_avatar": caller.AvatarURL,
				},
			})
			h.Hub.SendToUser(mid, payload)
		}

		if h.Push != nil {
			h.Push.SendCommunityCallPush(mid, caller, comm.Name, callType, channelID)
		}
	}
}

// ---------------------- DEVICES & PUSH TOKENS ----------------------
type DeviceRegisterInput struct {
	Token     string `json:"token" binding:"required"`
	Platform  string `json:"platform" binding:"required"` // "android", "ios", "web"
	VoipToken string `json:"voip_token"`
}

func (h *Handler) RegisterDevice(c *gin.Context) {
	userID := c.GetUint("user_id")
	var input DeviceRegisterInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var device model.Device
	err := h.DB.Where("token = ?", input.Token).First(&device).Error
	if err == nil {
		device.UserID = userID
		device.Platform = input.Platform
		if input.VoipToken != "" {
			device.VoipToken = input.VoipToken
		}
		h.DB.Save(&device)
	} else {
		device = model.Device{
			UserID:    userID,
			Token:     input.Token,
			Platform:  input.Platform,
			VoipToken: input.VoipToken,
		}
		if err := h.DB.Create(&device).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to register device"})
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{"message": "device registered", "device": device})
}

func (h *Handler) UnregisterDevice(c *gin.Context) {
	userID := c.GetUint("user_id")
	var input struct {
		Token string `json:"token"`
	}
	_ = c.ShouldBindJSON(&input)

	if input.Token != "" {
		h.DB.Where("token = ? AND user_id = ?", input.Token, userID).Delete(&model.Device{})
	} else {
		h.DB.Where("user_id = ?", userID).Delete(&model.Device{})
	}

	c.JSON(http.StatusOK, gin.H{"message": "device unregistered"})
}

func (h *Handler) Logout(c *gin.Context) {
	userID := c.GetUint("user_id")
	if userID > 0 && h.Hub != nil {
		h.Hub.RemoveUserPresence(userID)
	}

	var input struct {
		Token string `json:"token"`
	}
	_ = c.ShouldBindJSON(&input)

	if input.Token != "" {
		h.DB.Where("token = ? AND user_id = ?", input.Token, userID).Delete(&model.Device{})
	}
	c.JSON(http.StatusOK, gin.H{"message": "logged out"})
}

// Heartbeat refreshes online presence even if the web app or APK is minimized
func (h *Handler) Heartbeat(c *gin.Context) {
	userID := c.GetUint("user_id")
	if userID > 0 && h.Hub != nil {
		h.Hub.TouchUser(userID)
	}
	c.JSON(http.StatusOK, gin.H{
		"status":  "ok",
		"online":  true,
		"user_id": userID,
	})
}

// GetWebRTCConfig returns production ICE server configurations (Google STUN + custom TURN servers if configured)
func (h *Handler) GetWebRTCConfig(c *gin.Context) {
	iceServers := []gin.H{
		{"urls": []string{"stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"}},
	}

	turnURLs := os.Getenv("TURN_URLS")
	turnUsername := os.Getenv("TURN_USERNAME")
	turnCredential := os.Getenv("TURN_CREDENTIAL")
	if turnCredential == "" {
		turnCredential = os.Getenv("TURN_PASSWORD")
	}

	if turnURLs != "" {
		urls := strings.Split(turnURLs, ",")
		turnConfig := gin.H{
			"urls": urls,
		}
		if turnUsername != "" {
			turnConfig["username"] = turnUsername
		}
		if turnCredential != "" {
			turnConfig["credential"] = turnCredential
		}
		iceServers = append(iceServers, turnConfig)
	}

	c.JSON(http.StatusOK, gin.H{
		"iceServers": iceServers,
	})
}

// GetActiveGroupCalls returns all currently ongoing group calls across channels
func (h *Handler) GetActiveGroupCalls(c *gin.Context) {
	if h.Hub == nil {
		c.JSON(http.StatusOK, gin.H{"calls": []interface{}{}})
		return
	}
	calls := h.Hub.GetActiveGroupCalls()
	c.JSON(http.StatusOK, gin.H{
		"calls": calls,
	})
}

// ---------------------- MUSIC TRACKS ----------------------

// GetTracks returns a paginated list of royalty-free tracks, with optional query filtering
func (h *Handler) GetTracks(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	page := 1
	limit := 20

	if p := c.Query("page"); p != "" {
		fmt.Sscanf(p, "%d", &page)
	}
	if l := c.Query("limit"); l != "" {
		fmt.Sscanf(l, "%d", &limit)
	}
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 20
	}
	offset := (page - 1) * limit

	var tracks []model.Track
	var total int64

	dbQuery := h.DB.Model(&model.Track{})
	if q != "" {
		searchPattern := "%" + q + "%"
		dbQuery = dbQuery.Where("title ILIKE ? OR artist ILIKE ?", searchPattern, searchPattern)
	}

	if err := dbQuery.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to count tracks"})
		return
	}

	if err := dbQuery.Order("id asc").Offset(offset).Limit(limit).Find(&tracks).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch tracks"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"tracks": tracks,
		"total":  total,
		"page":   page,
		"limit":  limit,
	})
}

// ---------------------- REELS ----------------------

// CreateReel handles uploading a short-form video reel with optional soundtrack & volume controls
func (h *Handler) CreateReel(c *gin.Context) {
	var input struct {
		VideoURL       string   `json:"video_url"`
		Caption        string   `json:"caption"`
		MusicTrackID   *uint    `json:"music_track_id"`
		MusicSource    string   `json:"music_source"`
		MusicURL       string   `json:"music_url"`
		MusicTitle     string   `json:"music_title"`
		MusicArtist    string   `json:"music_artist"`
		MusicStartSec  float64  `json:"music_start_sec"`
		MuteOriginal   bool     `json:"mute_original"`
		MusicVolume    *float64 `json:"music_volume"`
		OriginalVolume *float64 `json:"original_volume"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	videoURL := strings.TrimSpace(input.VideoURL)
	if videoURL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "video_url is required"})
		return
	}

	// Validate music_track_id if provided
	if input.MusicTrackID != nil && *input.MusicTrackID > 0 {
		var trk model.Track
		if err := h.DB.First(&trk, *input.MusicTrackID).Error; err != nil {
			input.MusicTrackID = nil
		}
	}

	// Validate volume ranges (0.0 to 1.0)
	musicVol := 1.0
	if input.MusicVolume != nil {
		if *input.MusicVolume < 0 || *input.MusicVolume > 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "music_volume must be between 0 and 1"})
			return
		}
		musicVol = *input.MusicVolume
	}

	origVol := 1.0
	if input.OriginalVolume != nil {
		if *input.OriginalVolume < 0 || *input.OriginalVolume > 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "original_volume must be between 0 and 1"})
			return
		}
		origVol = *input.OriginalVolume
	}

	// Validate music_start_sec >= 0
	if input.MusicStartSec < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "music_start_sec must be non-negative"})
		return
	}

	userID := c.GetUint("user_id")
	reel := model.Reel{
		UserID:         userID,
		VideoURL:       videoURL,
		Caption:        input.Caption,
		MusicTrackID:   input.MusicTrackID,
		MusicSource:    input.MusicSource,
		MusicURL:       input.MusicURL,
		MusicTitle:     input.MusicTitle,
		MusicArtist:    input.MusicArtist,
		MusicStartSec:  input.MusicStartSec,
		MuteOriginal:   input.MuteOriginal,
		MusicVolume:    musicVol,
		OriginalVolume: origVol,
	}

	if err := h.DB.Create(&reel).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create reel"})
		return
	}

	h.DB.Preload("User", func(db *gorm.DB) *gorm.DB {
		return db.Select("id", "username", "name", "email", "avatar_url")
	}).Preload("MusicTrack").First(&reel, reel.ID)

	c.JSON(http.StatusCreated, reel)
}

// GetReels returns paginated reels with preloaded user and music soundtrack info
func (h *Handler) GetReels(c *gin.Context) {
	page := 1
	limit := 30
	if p := c.Query("page"); p != "" {
		fmt.Sscanf(p, "%d", &page)
	}
	if l := c.Query("limit"); l != "" {
		fmt.Sscanf(l, "%d", &limit)
	}
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 50 {
		limit = 30
	}
	offset := (page - 1) * limit

	var reels []model.Reel
	if err := h.DB.
		Preload("User", func(db *gorm.DB) *gorm.DB {
			return db.Select("id", "username", "name", "email", "avatar_url")
		}).
		Preload("MusicTrack").
		Order("created_at desc").
		Offset(offset).
		Limit(limit).
		Find(&reels).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch reels"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"reels": reels,
		"page":  page,
		"limit": limit,
	})
}

// ToggleReelLike toggles a like on a reel
func (h *Handler) ToggleReelLike(c *gin.Context) {
	idStr := c.Param("id")
	reelID, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reel ID"})
		return
	}
	var reel model.Reel
	if err := h.DB.First(&reel, reelID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "reel not found"})
		return
	}
	reel.Likes++
	h.DB.Model(&reel).Update("likes", reel.Likes)
	c.JSON(http.StatusOK, gin.H{"likes": reel.Likes, "liked": true})
}

// GetReelComments returns comments for a reel
func (h *Handler) GetReelComments(c *gin.Context) {
	idStr := c.Param("id")
	reelID, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reel ID"})
		return
	}
	var comments []model.ReelComment
	if err := h.DB.Where("reel_id = ?", uint(reelID)).Preload("User").Order("created_at asc").Find(&comments).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load comments"})
		return
	}

	userID := c.GetUint("user_id")
	if userID == 0 {
		authHeader := c.GetHeader("Authorization")
		if strings.HasPrefix(authHeader, "Bearer ") {
			tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
			if claims, err := utils.ParseToken(tokenStr); err == nil {
				userID = claims.UserID
			}
		}
	}

	if userID > 0 && len(comments) > 0 {
		cIDs := make([]uint, len(comments))
		for i, c := range comments {
			cIDs[i] = c.ID
		}
		var likedIDs []uint
		h.DB.Model(&model.ReelCommentLike{}).Where("user_id = ? AND reel_comment_id IN ?", userID, cIDs).Pluck("reel_comment_id", &likedIDs)
		likedMap := make(map[uint]bool, len(likedIDs))
		for _, lid := range likedIDs {
			likedMap[lid] = true
		}
		for i := range comments {
			comments[i].LikedByMe = likedMap[comments[i].ID]
		}
	}

	c.JSON(http.StatusOK, gin.H{"comments": comments})
}

// CreateReelComment creates a comment on a reel
func (h *Handler) CreateReelComment(c *gin.Context) {
	idStr := c.Param("id")
	reelID, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reel ID"})
		return
	}
	userID := c.GetUint("user_id")
	if userID == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req struct {
		Content  string `json:"content"`
		Text     string `json:"text"`
		ParentID *uint  `json:"parent_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid comment data"})
		return
	}
	content := strings.TrimSpace(req.Content)
	if content == "" {
		content = strings.TrimSpace(req.Text)
	}
	if content == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "comment cannot be empty"})
		return
	}

	var reel model.Reel
	if err := h.DB.First(&reel, reelID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "reel not found"})
		return
	}

	comment := model.ReelComment{
		ReelID:   uint(reelID),
		UserID:   userID,
		Content:  content,
		ParentID: req.ParentID,
	}
	if err := h.DB.Create(&comment).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create comment"})
		return
	}

	reel.CommentsCount++
	h.DB.Model(&reel).Update("comments_count", reel.CommentsCount)

	_ = h.DB.Preload("User").First(&comment, comment.ID)

	if req.ParentID != nil && *req.ParentID > 0 {
		var parentComment model.ReelComment
		if err := h.DB.First(&parentComment, *req.ParentID).Error; err == nil {
			if parentComment.UserID != userID {
				h.createNotification(parentComment.UserID, userID, "reel_comment_reply", nil)
			}
		}
	}

	c.JSON(http.StatusCreated, gin.H{
		"comment":        comment,
		"comments_count": reel.CommentsCount,
		"success":        true,
	})
}

// ToggleReelCommentLike toggles like on a reel comment
func (h *Handler) ToggleReelCommentLike(c *gin.Context) {
	idStr := c.Param("id")
	commentID, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reel comment ID"})
		return
	}
	userID := c.GetUint("user_id")

	var comment model.ReelComment
	if err := h.DB.First(&comment, commentID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "reel comment not found"})
		return
	}

	var existing model.ReelCommentLike
	err = h.DB.Where("user_id = ? AND reel_comment_id = ?", userID, commentID).First(&existing).Error
	liked := false
	if err == nil {
		_ = h.DB.Delete(&existing).Error
		liked = false
	} else {
		like := model.ReelCommentLike{
			UserID:        userID,
			ReelCommentID: uint(commentID),
		}
		if err := h.DB.Create(&like).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to like reel comment"})
			return
		}
		liked = true
		if comment.UserID != userID {
			h.createNotification(comment.UserID, userID, "reel_comment_like", nil)
		}
	}

	var count int64
	h.DB.Model(&model.ReelCommentLike{}).Where("reel_comment_id = ?", commentID).Count(&count)
	h.DB.Model(&comment).UpdateColumn("likes", count)

	c.JSON(http.StatusOK, gin.H{"liked": liked, "likes": count})
}

// DeleteReel deletes a reel owned by the user
func (h *Handler) DeleteReel(c *gin.Context) {
	idStr := c.Param("id")
	reelID, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reel ID"})
		return
	}
	userID := c.GetUint("user_id")
	if err := h.DB.Where("id = ? AND user_id = ?", reelID, userID).Delete(&model.Reel{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete reel"})
		return
	}
	_ = h.DB.Where("reel_id = ?", reelID).Delete(&model.ReelComment{}).Error
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// SearchMusic proxies Jamendo API with client_id stored on backend .env
func (h *Handler) SearchMusic(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	genre := strings.TrimSpace(c.Query("genre"))
	tag := strings.TrimSpace(c.Query("tag"))
	if tag != "" && genre == "" {
		genre = tag
	}
	order := strings.TrimSpace(c.Query("order"))
	if order == "" {
		order = "popularity_total"
	}
	limit := 20
	if l := c.Query("limit"); l != "" {
		fmt.Sscanf(l, "%d", &limit)
	}
	if limit < 1 || limit > 50 {
		limit = 20
	}
	offset := 0
	if o := c.Query("offset"); o != "" {
		fmt.Sscanf(o, "%d", &offset)
	}

	clientID := strings.TrimSpace(os.Getenv("JAMENDO_CLIENT_ID"))
	if clientID == "" {
		clientID = "3dce8b55" // fallback
	}

	reqURL := fmt.Sprintf("https://api.jamendo.com/v3.0/tracks/?client_id=%s&format=json&limit=%d&offset=%d&order=%s&audioformat=mp32",
		clientID, limit, offset, order)
	if q != "" {
		reqURL += "&namesearch=" + url.QueryEscape(q)
	}
	if genre != "" {
		reqURL += "&fuzzytags=" + url.QueryEscape(genre)
	}

	type UnifiedTrack struct {
		ID          string  `json:"id"`
		Title       string  `json:"title"`
		Artist      string  `json:"artist"`
		AudioURL    string  `json:"audio_url"`
		CoverURL    *string `json:"cover_url,omitempty"`
		DurationSec int     `json:"duration_sec"`
		Source      string  `json:"source"`
		License     string  `json:"license"`
		Attribution string  `json:"attribution"`
	}

	client := &http.Client{Timeout: 8 * time.Second}
	httpReq, errReq := http.NewRequest("GET", reqURL, nil)
	if errReq == nil {
		httpReq.Header.Set("User-Agent", "Mozilla/5.0 (compatible; Nesty/1.0; +https://nesty.app)")
		httpReq.Header.Set("Accept", "application/json")
		resp, err := client.Do(httpReq)
		if err == nil && resp.StatusCode == http.StatusOK {
			defer resp.Body.Close()
			var jamendoResp struct {
				Headers struct {
					Status string `json:"status"`
					Count  int    `json:"results_count"`
				} `json:"headers"`
				Results []struct {
					ID         string `json:"id"`
					Name       string `json:"name"`
					Duration   int    `json:"duration"`
					ArtistName string `json:"artist_name"`
					AlbumImage string `json:"album_image"`
					Audio      string `json:"audio"`
					LicenseCC  string `json:"license_ccurl"`
				} `json:"results"`
			}

			if err := json.NewDecoder(resp.Body).Decode(&jamendoResp); err == nil && jamendoResp.Headers.Status == "success" {
				tracks := make([]UnifiedTrack, 0, len(jamendoResp.Results))
				for _, item := range jamendoResp.Results {
					if item.Audio == "" {
						continue
					}
					cover := item.AlbumImage
					lic := "Creative Commons (CC BY)"
					if strings.Contains(item.LicenseCC, "nc") {
						lic = "Creative Commons (CC BY-NC)"
					}
					tracks = append(tracks, UnifiedTrack{
						ID:          "jamendo_" + item.ID,
						Title:       item.Name,
						Artist:      item.ArtistName,
						AudioURL:    item.Audio,
						CoverURL:    &cover,
						DurationSec: item.Duration,
						Source:      "jamendo",
						License:     lic,
						Attribution: fmt.Sprintf("Music by %s (Jamendo / %s)", item.ArtistName, lic),
					})
				}
				c.JSON(http.StatusOK, gin.H{
					"tracks": tracks,
					"total":  jamendoResp.Headers.Count,
					"source": "jamendo",
				})
				return
			}
		}
	}

	// Fallback to local DB tracks if Jamendo is unavailable
	var dbTracks []model.Track
	dbQuery := h.DB.Model(&model.Track{})
	if q != "" {
		dbQuery = dbQuery.Where("title ILIKE ? OR artist ILIKE ?", "%"+q+"%", "%"+q+"%")
	}
	dbQuery.Order("id asc").Limit(limit).Find(&dbTracks)

	tracks := make([]UnifiedTrack, 0, len(dbTracks))
	for _, t := range dbTracks {
		tracks = append(tracks, UnifiedTrack{
			ID:          fmt.Sprintf("%d", t.ID),
			Title:       t.Title,
			Artist:      t.Artist,
			AudioURL:    t.AudioURL,
			CoverURL:    t.CoverURL,
			DurationSec: t.DurationSec,
			Source:      "library",
			License:     "Creative Commons / Royalty Free",
			Attribution: fmt.Sprintf("Music: %s - %s", t.Title, t.Artist),
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"tracks": tracks,
		"total":  len(tracks),
		"source": "fallback",
	})
}

// ---------------------- COMMUNITIES ----------------------

// GetCommunities returns all real user-created communities from DB with membership info
func (h *Handler) GetCommunities(c *gin.Context) {
	var communities []model.Community
	if err := h.DB.Order("created_at asc").Find(&communities).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch communities"})
		return
	}

	callerID := uint(0)
	auth := c.GetHeader("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		tokenString := strings.TrimPrefix(auth, "Bearer ")
		if claims, err := utils.ParseToken(tokenString); err == nil {
			callerID = claims.UserID
		}
	}

	userIDs := make([]uint, 0)
	commIDs := make([]uint, 0)
	for _, comm := range communities {
		commIDs = append(commIDs, comm.ID)
		if comm.CreatedByID > 0 {
			userIDs = append(userIDs, comm.CreatedByID)
		}
	}

	uMap := make(map[uint]model.User)
	if len(userIDs) > 0 {
		var users []model.User
		h.DB.Select("id, username, name, avatar_url").Where("id IN ?", userIDs).Find(&users)
		for _, u := range users {
			uMap[u.ID] = u
		}
	}

	// Fetch member counts for all communities
	type countRow struct {
		CommunityID uint  `gorm:"column:community_id"`
		Count       int64 `gorm:"column:count"`
	}
	var countRows []countRow
	if len(commIDs) > 0 {
		h.DB.Table("community_members").
			Select("community_id, count(*) as count").
			Where("community_id IN ? AND status = 'active'", commIDs).
			Group("community_id").
			Scan(&countRows)
	}
	countMap := make(map[uint]int64)
	for _, row := range countRows {
		countMap[row.CommunityID] = row.Count
	}

	// Fetch caller membership status for all communities
	roleMap := make(map[uint]string)
	if callerID > 0 && len(commIDs) > 0 {
		var myMemberships []model.CommunityMember
		h.DB.Where("community_id IN ? AND user_id = ?", commIDs, callerID).Find(&myMemberships)
		for _, m := range myMemberships {
			if m.Status == "pending" {
				roleMap[m.CommunityID] = "pending"
			} else if m.Status == "invited" {
				roleMap[m.CommunityID] = "invited"
			} else {
				roleMap[m.CommunityID] = m.Role
			}
		}
	}

	for i := range communities {
		cid := communities[i].ID
		if u, ok := uMap[communities[i].CreatedByID]; ok {
			userCopy := u
			communities[i].CreatedBy = &userCopy
		}
		if cnt, ok := countMap[cid]; ok {
			communities[i].MemberCount = cnt
		} else {
			// If not in table yet, at least 1 (the creator)
			communities[i].MemberCount = 1
		}

		if role, ok := roleMap[cid]; ok {
			communities[i].CurrentUserRole = role
		} else if callerID > 0 && communities[i].CreatedByID == callerID {
			communities[i].CurrentUserRole = "admin"
		} else {
			communities[i].CurrentUserRole = "none"
		}
	}

	c.JSON(http.StatusOK, gin.H{"communities": communities})
}

// GetCommunity returns details of a single community
func (h *Handler) GetCommunity(c *gin.Context) {
	slug := c.Param("slug")
	var comm model.Community
	if err := h.DB.Where("slug = ? OR id::text = ?", slug, slug).First(&comm).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "community not found"})
		return
	}

	var creator model.User
	if err := h.DB.Select("id, username, name, avatar_url").First(&creator, comm.CreatedByID).Error; err == nil {
		comm.CreatedBy = &creator
	}

	var count int64
	h.DB.Model(&model.CommunityMember{}).Where("community_id = ? AND status = 'active'", comm.ID).Count(&count)
	comm.MemberCount = count

	callerID := uint(0)
	auth := c.GetHeader("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		tokenString := strings.TrimPrefix(auth, "Bearer ")
		if claims, err := utils.ParseToken(tokenString); err == nil {
			callerID = claims.UserID
		}
	}

	if callerID > 0 {
		var m model.CommunityMember
		if err := h.DB.Where("community_id = ? AND user_id = ?", comm.ID, callerID).First(&m).Error; err == nil {
			if m.Status == "pending" {
				comm.CurrentUserRole = "pending"
			} else if m.Status == "invited" {
				comm.CurrentUserRole = "invited"
			} else {
				comm.CurrentUserRole = m.Role
			}
		} else if comm.CreatedByID == callerID {
			comm.CurrentUserRole = "admin"
		} else {
			comm.CurrentUserRole = "none"
		}
	} else {
		comm.CurrentUserRole = "none"
	}

	c.JSON(http.StatusOK, gin.H{"community": comm})
}

// CreateCommunity creates a new user community and makes the creator the admin
func (h *Handler) CreateCommunity(c *gin.Context) {
	var input struct {
		Name             string `json:"name" binding:"required"`
		Description      string `json:"description"`
		BadgeClass       string `json:"badge_class"`
		BannerURL        string `json:"banner_url"`
		RequiresApproval bool   `json:"requires_approval"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	name := strings.TrimSpace(input.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}

	slug := strings.ToLower(name)
	slug = strings.ReplaceAll(slug, " ", "-")
	reg := regexp.MustCompile(`[^a-z0-9\-_]+`)
	slug = reg.ReplaceAllString(slug, "")
	if slug == "" {
		slug = fmt.Sprintf("comm-%d", time.Now().Unix())
	}

	userID := c.GetUint("user_id")
	badge := input.BadgeClass
	if badge == "" {
		badge = "general"
	}

	comm := model.Community{
		Name:             name,
		Slug:             slug,
		Description:      input.Description,
		BadgeClass:       badge,
		BannerURL:        strings.TrimSpace(input.BannerURL),
		RequiresApproval: input.RequiresApproval,
		CreatedByID:      userID,
	}

	if err := h.DB.Create(&comm).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create community"})
		return
	}

	// The person who created the community is automatically the admin of the group
	adminMember := model.CommunityMember{
		CommunityID: comm.ID,
		UserID:      userID,
		Role:        "admin",
		Status:      "active",
	}
	h.DB.Create(&adminMember)

	comm.MemberCount = 1
	comm.CurrentUserRole = "admin"

	var creator model.User
	if err := h.DB.Select("id, username, name, avatar_url").First(&creator, userID).Error; err == nil {
		comm.CreatedBy = &creator
	}
	c.JSON(http.StatusCreated, comm)
}

// JoinCommunity handles a user clicking the Join button
func (h *Handler) JoinCommunity(c *gin.Context) {
	slug := c.Param("slug")
	userID := c.GetUint("user_id")

	var comm model.Community
	if err := h.DB.Where("slug = ? OR id::text = ?", slug, slug).First(&comm).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "community not found"})
		return
	}

	// Check if already in members
	var existing model.CommunityMember
	if err := h.DB.Where("community_id = ? AND user_id = ?", comm.ID, userID).First(&existing).Error; err == nil {
		if existing.Status == "active" {
			c.JSON(http.StatusOK, gin.H{
				"status":  "active",
				"role":    existing.Role,
				"message": "You are already a member of this community.",
			})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"status":  "pending",
			"role":    "member",
			"message": "Your join request is pending approval by an admin.",
		})
		return
	}

	// Determine status: automatic membership or wait for admin approval
	targetStatus := "active"
	targetMessage := "You have joined the community!"
	if comm.RequiresApproval {
		targetStatus = "pending"
		targetMessage = "Your join request has been sent to the group admins for approval."
	}

	member := model.CommunityMember{
		CommunityID: comm.ID,
		UserID:      userID,
		Role:        "member",
		Status:      targetStatus,
	}

	if err := h.DB.Create(&member).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to join community"})
		return
	}

	// If pending, notify admins of the new join request
	if targetStatus == "pending" {
		var applicant model.User
		h.DB.Select("id, username, name").First(&applicant, userID)
		applicantName := applicant.Name
		if applicantName == "" {
			applicantName = applicant.Username
		}

		var admins []model.CommunityMember
		h.DB.Where("community_id = ? AND status = 'active' AND (role = 'admin' OR role = 'co_admin')", comm.ID).Find(&admins)
		for _, admin := range admins {
			notif := model.Notification{
				UserID:  admin.UserID,
				ActorID: userID,
				Type:    "community_join_request",
			}
			h.DB.Create(&notif)
		}
	}

	var newCount int64
	h.DB.Model(&model.CommunityMember{}).Where("community_id = ? AND status = 'active'", comm.ID).Count(&newCount)

	c.JSON(http.StatusOK, gin.H{
		"status":            targetStatus,
		"role":              "member",
		"requires_approval": comm.RequiresApproval,
		"member_count":      newCount,
		"message":           targetMessage,
	})
}

// LeaveCommunity allows a member to leave a community
func (h *Handler) LeaveCommunity(c *gin.Context) {
	slug := c.Param("slug")
	userID := c.GetUint("user_id")

	var comm model.Community
	if err := h.DB.Where("slug = ? OR id::text = ?", slug, slug).First(&comm).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "community not found"})
		return
	}

	var m model.CommunityMember
	if err := h.DB.Where("community_id = ? AND user_id = ?", comm.ID, userID).First(&m).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "you are not a member of this community"})
		return
	}

	if m.Role == "admin" && comm.CreatedByID == userID {
		// Main creator cannot leave without transferring or deleting
		c.JSON(http.StatusBadRequest, gin.H{"error": "The community creator/admin cannot leave the group."})
		return
	}

	h.DB.Delete(&m)

	var newCount int64
	h.DB.Model(&model.CommunityMember{}).Where("community_id = ? AND status = 'active'", comm.ID).Count(&newCount)

	c.JSON(http.StatusOK, gin.H{
		"status":       "none",
		"member_count": newCount,
		"message":      "You have left the community.",
	})
}

// GetCommunityMembers returns active members and, for admins/co-admins, pending join requests
func (h *Handler) GetCommunityMembers(c *gin.Context) {
	slug := c.Param("slug")
	callerID := c.GetUint("user_id")

	var comm model.Community
	if err := h.DB.Where("slug = ? OR id::text = ?", slug, slug).First(&comm).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "community not found"})
		return
	}

	callerRole := "none"
	var callerMembership model.CommunityMember
	if err := h.DB.Where("community_id = ? AND user_id = ? AND status = 'active'", comm.ID, callerID).First(&callerMembership).Error; err == nil {
		callerRole = callerMembership.Role
	} else if comm.CreatedByID == callerID {
		callerRole = "admin"
	}

	var activeMembers []model.CommunityMember
	h.DB.Preload("User", func(db *gorm.DB) *gorm.DB {
		return db.Select("id, username, name, avatar_url, bio")
	}).Where("community_id = ? AND status = 'active'", comm.ID).
		Order("CASE WHEN role = 'admin' THEN 1 WHEN role = 'co_admin' THEN 2 ELSE 3 END, created_at asc").
		Find(&activeMembers)

	var pendingMembers []model.CommunityMember
	if callerRole == "admin" || callerRole == "co_admin" {
		h.DB.Preload("User", func(db *gorm.DB) *gorm.DB {
			return db.Select("id, username, name, avatar_url, bio")
		}).Where("community_id = ? AND status = 'pending'", comm.ID).
			Order("created_at asc").
			Find(&pendingMembers)
	}

	c.JSON(http.StatusOK, gin.H{
		"community_id":      comm.ID,
		"community_name":    comm.Name,
		"requires_approval": comm.RequiresApproval,
		"caller_role":       callerRole,
		"members":           activeMembers,
		"pending":           pendingMembers,
	})
}

// ApproveCommunityMember admits a pending user to the community (admin or co-admin)
func (h *Handler) ApproveCommunityMember(c *gin.Context) {
	slug := c.Param("slug")
	callerID := c.GetUint("user_id")
	targetUserIDStr := c.Param("user_id")

	var comm model.Community
	if err := h.DB.Where("slug = ? OR id::text = ?", slug, slug).First(&comm).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "community not found"})
		return
	}

	// Verify caller is admin or co-admin
	var callerMember model.CommunityMember
	err := h.DB.Where("community_id = ? AND user_id = ? AND status = 'active' AND (role = 'admin' OR role = 'co_admin')", comm.ID, callerID).First(&callerMember).Error
	if err != nil && comm.CreatedByID != callerID {
		c.JSON(http.StatusForbidden, gin.H{"error": "only admins or co-admins can admit members"})
		return
	}

	var targetMember model.CommunityMember
	if err := h.DB.Where("community_id = ? AND user_id = ?", comm.ID, targetUserIDStr).First(&targetMember).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "membership request not found"})
		return
	}

	targetMember.Status = "active"
	if err := h.DB.Save(&targetMember).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to admit member"})
		return
	}

	// Notify the admitted user
	notif := model.Notification{
		UserID:  targetMember.UserID,
		ActorID: callerID,
		Type:    "community_join_approved",
	}
	h.DB.Create(&notif)

	var newCount int64
	h.DB.Model(&model.CommunityMember{}).Where("community_id = ? AND status = 'active'", comm.ID).Count(&newCount)

	c.JSON(http.StatusOK, gin.H{
		"message":      "Member admitted successfully.",
		"member_count": newCount,
	})
}

// RejectCommunityMember declines a pending user's join request (admin or co-admin)
func (h *Handler) RejectCommunityMember(c *gin.Context) {
	slug := c.Param("slug")
	callerID := c.GetUint("user_id")
	targetUserIDStr := c.Param("user_id")

	var comm model.Community
	if err := h.DB.Where("slug = ? OR id::text = ?", slug, slug).First(&comm).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "community not found"})
		return
	}

	// Verify caller is admin or co-admin
	var callerMember model.CommunityMember
	err := h.DB.Where("community_id = ? AND user_id = ? AND status = 'active' AND (role = 'admin' OR role = 'co_admin')", comm.ID, callerID).First(&callerMember).Error
	if err != nil && comm.CreatedByID != callerID {
		c.JSON(http.StatusForbidden, gin.H{"error": "only admins or co-admins can reject membership requests"})
		return
	}

	h.DB.Where("community_id = ? AND user_id = ? AND status = 'pending'", comm.ID, targetUserIDStr).Delete(&model.CommunityMember{})

	c.JSON(http.StatusOK, gin.H{"message": "Join request declined."})
}

// UpdateCommunityMemberRole allows the group admin to make other people co-admins
func (h *Handler) UpdateCommunityMemberRole(c *gin.Context) {
	slug := c.Param("slug")
	callerID := c.GetUint("user_id")
	targetUserIDStr := c.Param("user_id")

	var comm model.Community
	if err := h.DB.Where("slug = ? OR id::text = ?", slug, slug).First(&comm).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "community not found"})
		return
	}

	// Only the main admin can promote/demote co-admins
	var callerMember model.CommunityMember
	err := h.DB.Where("community_id = ? AND user_id = ? AND status = 'active' AND role = 'admin'", comm.ID, callerID).First(&callerMember).Error
	if err != nil && comm.CreatedByID != callerID {
		c.JSON(http.StatusForbidden, gin.H{"error": "only the group admin can assign co-admins"})
		return
	}

	var input struct {
		Role string `json:"role" binding:"required"` // "co_admin" or "member"
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	newRole := input.Role
	if newRole != "co_admin" && newRole != "member" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "role must be 'co_admin' or 'member'"})
		return
	}

	var targetMember model.CommunityMember
	if err := h.DB.Where("community_id = ? AND user_id = ? AND status = 'active'", comm.ID, targetUserIDStr).First(&targetMember).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "member not found in this community"})
		return
	}

	if targetMember.UserID == comm.CreatedByID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot change role of the group creator"})
		return
	}

	targetMember.Role = newRole
	if err := h.DB.Save(&targetMember).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update member role"})
		return
	}

	// Notify the member
	roleLabel := "Co-Admin"
	if newRole == "member" {
		roleLabel = "Member"
	}
	notif := model.Notification{
		UserID:  targetMember.UserID,
		ActorID: callerID,
		Type:    "community_role_updated",
	}
	h.DB.Create(&notif)

	c.JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("User role updated to %s.", roleLabel),
		"role":    newRole,
	})
}

// UpdateCommunitySettings updates community settings like requires_approval
func (h *Handler) UpdateCommunitySettings(c *gin.Context) {
	slug := c.Param("slug")
	callerID := c.GetUint("user_id")

	var comm model.Community
	if err := h.DB.Where("slug = ? OR id::text = ?", slug, slug).First(&comm).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "community not found"})
		return
	}

	// Verify caller membership status
	var callerMember model.CommunityMember
	isMember := false
	if err := h.DB.Where("community_id = ? AND user_id = ? AND status = 'active'", comm.ID, callerID).First(&callerMember).Error; err == nil {
		isMember = true
	}
	isAdmin := comm.CreatedByID == callerID || (isMember && (callerMember.Role == "admin" || callerMember.Role == "co_admin"))

	var input struct {
		RequiresApproval *bool   `json:"requires_approval"`
		Description      *string `json:"description"`
		BannerURL        *string `json:"banner_url"`
		Name             *string `json:"name"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Banner photo can be updated by any active member or creator/admin
	if input.BannerURL != nil {
		if !isMember && !isAdmin {
			c.JSON(http.StatusForbidden, gin.H{"error": "you must be a member of this community to update the banner photo"})
			return
		}
		comm.BannerURL = strings.TrimSpace(*input.BannerURL)
	}

	// Administrative settings require admin or co-admin
	if input.RequiresApproval != nil || input.Description != nil || input.Name != nil {
		if !isAdmin {
			c.JSON(http.StatusForbidden, gin.H{"error": "only admins or co-admins can update group settings"})
			return
		}
		if input.RequiresApproval != nil {
			comm.RequiresApproval = *input.RequiresApproval
		}
		if input.Description != nil {
			comm.Description = strings.TrimSpace(*input.Description)
		}
		if input.Name != nil && strings.TrimSpace(*input.Name) != "" {
			comm.Name = strings.TrimSpace(*input.Name)
		}
	}

	if err := h.DB.Save(&comm).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update settings"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":   "Settings updated successfully.",
		"community": comm,
	})
}

// InviteCommunityMember allows an admin, co-admin, or member to invite another user
func (h *Handler) InviteCommunityMember(c *gin.Context) {
	slug := c.Param("slug")
	callerID := c.GetUint("user_id")

	var comm model.Community
	if err := h.DB.Where("slug = ? OR id::text = ?", slug, slug).First(&comm).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "community not found"})
		return
	}

	var input struct {
		UserID uint `json:"user_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	targetUserID := input.UserID
	if targetUserID == callerID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot invite yourself"})
		return
	}

	var existing model.CommunityMember
	if err := h.DB.Where("community_id = ? AND user_id = ?", comm.ID, targetUserID).First(&existing).Error; err == nil {
		if existing.Status == "active" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "user is already a member of this community"})
			return
		}
		if existing.Status == "invited" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "user has already been invited"})
			return
		}
		// If pending, approve them
		existing.Status = "active"
		h.DB.Save(&existing)
		c.JSON(http.StatusOK, gin.H{"message": "User admitted to community."})
		return
	}

	newMember := model.CommunityMember{
		CommunityID: comm.ID,
		UserID:      targetUserID,
		Role:        "member",
		Status:      "invited",
	}
	if err := h.DB.Create(&newMember).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to send invitation"})
		return
	}

	// Create notification for target user
	notif := model.Notification{
		UserID:  targetUserID,
		ActorID: callerID,
		Type:    "community_invite",
	}
	h.DB.Create(&notif)

	c.JSON(http.StatusOK, gin.H{"message": "Invitation sent successfully."})
}

// SuggestCommunityToFollowers allows the community creator or admin to suggest/invite the community to all their followers
func (h *Handler) SuggestCommunityToFollowers(c *gin.Context) {
	slug := c.Param("slug")
	callerID := c.GetUint("user_id")

	var comm model.Community
	if err := h.DB.Where("slug = ? OR id::text = ?", slug, slug).First(&comm).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "community not found"})
		return
	}

	// Check permission: creator or admin
	if comm.CreatedByID != callerID {
		var role string
		h.DB.Model(&model.CommunityMember{}).
			Where("community_id = ? AND user_id = ? AND status = 'active'", comm.ID, callerID).
			Pluck("role", &role)
		if role != "admin" {
			c.JSON(http.StatusForbidden, gin.H{"error": "only community creator or admin can suggest to followers"})
			return
		}
	}

	// Fetch followers of the caller
	var follows []model.Follow
	h.DB.Where("following_id = ?", callerID).Find(&follows)
	if len(follows) == 0 {
		c.JSON(http.StatusOK, gin.H{
			"message":         "You do not have any followers to suggest this community to yet.",
			"suggested_count": 0,
		})
		return
	}

	// Find existing members / invited users to avoid duplicates
	var existingMembers []model.CommunityMember
	h.DB.Where("community_id = ?", comm.ID).Find(&existingMembers)
	memberMap := make(map[uint]bool, len(existingMembers))
	for _, m := range existingMembers {
		memberMap[m.UserID] = true
	}

	suggestedCount := 0
	for _, f := range follows {
		targetID := f.FollowerID
		if targetID == callerID || memberMap[targetID] {
			continue
		}
		newMember := model.CommunityMember{
			CommunityID: comm.ID,
			UserID:      targetID,
			Role:        "member",
			Status:      "invited",
		}
		if err := h.DB.Create(&newMember).Error; err == nil {
			notif := model.Notification{
				UserID:  targetID,
				ActorID: callerID,
				Type:    "community_invite",
			}
			h.DB.Create(&notif)
			suggestedCount++
			memberMap[targetID] = true
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"message":         fmt.Sprintf("Community suggested to %d follower(s)!", suggestedCount),
		"suggested_count": suggestedCount,
	})
}

// AcceptCommunityInvite accepts an invitation
func (h *Handler) AcceptCommunityInvite(c *gin.Context) {
	slug := c.Param("slug")
	userID := c.GetUint("user_id")

	var comm model.Community
	if err := h.DB.Where("slug = ? OR id::text = ?", slug, slug).First(&comm).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "community not found"})
		return
	}

	var m model.CommunityMember
	if err := h.DB.Where("community_id = ? AND user_id = ? AND status = 'invited'", comm.ID, userID).First(&m).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "no active invitation found"})
		return
	}

	m.Status = "active"
	h.DB.Save(&m)

	var newCount int64
	h.DB.Model(&model.CommunityMember{}).Where("community_id = ? AND status = 'active'", comm.ID).Count(&newCount)

	c.JSON(http.StatusOK, gin.H{
		"message":      "Invitation accepted! Welcome to #" + comm.Name,
		"status":       "active",
		"role":         m.Role,
		"member_count": newCount,
	})
}

// DeclineCommunityInvite declines an invitation
func (h *Handler) DeclineCommunityInvite(c *gin.Context) {
	slug := c.Param("slug")
	userID := c.GetUint("user_id")

	var comm model.Community
	if err := h.DB.Where("slug = ? OR id::text = ?", slug, slug).First(&comm).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "community not found"})
		return
	}

	h.DB.Where("community_id = ? AND user_id = ? AND status = 'invited'", comm.ID, userID).Delete(&model.CommunityMember{})

	c.JSON(http.StatusOK, gin.H{"message": "Invitation declined."})
}