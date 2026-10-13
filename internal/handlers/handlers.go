package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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

	"piscine-devnest/internal/model"
	"piscine-devnest/internal/push"
	"piscine-devnest/internal/storage"
	"piscine-devnest/internal/utils"
	"piscine-devnest/internal/ws"
)

type Handler struct {
	DB         *gorm.DB
	Hub        *ws.Hub
	Push       *push.PushService
	callTimers sync.Map
}

// Constructor
func NewHandler(db *gorm.DB, hub *ws.Hub, pushSvc *push.PushService) *Handler {
	return &Handler{
		DB:   db,
		Hub:  hub,
		Push: pushSvc,
	}
}

// ---------------------- ROUTES ----------------------
func (h *Handler) RegisterRoutes(r *gin.Engine) {
	api := r.Group("/api")

	// PUBLIC ROUTES
	api.GET("/ping", h.Ping)
	api.POST("/users", h.CreateUser)
	api.POST("/register", h.CreateUser)
	api.POST("/login", h.Login)
	api.POST("/forgot-password", h.ForgotPassword)
	api.GET("/community-stats", h.GetCommunityStats)
	api.GET("/community/stats", h.GetCommunityStats)

	// PROTECTED ROUTES
	protected := api.Group("/", utils.JWTMiddleware())
	{
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

		// CALL & WEBRTC SIGNALING
		protected.GET("/call/online/:id", h.CheckUserOnline)
		protected.POST("/call/signal", h.SendCallSignal)

		// DEVICE PUSH TOKENS
		protected.POST("/devices", h.RegisterDevice)
		protected.DELETE("/devices", h.UnregisterDevice)
		protected.POST("/logout", h.Logout)

		// HEARTBEAT & PRESENCE
		protected.POST("/heartbeat", h.Heartbeat)
		protected.GET("/heartbeat", h.Heartbeat)
		protected.POST("/users/heartbeat", h.Heartbeat)
	}

	// Direct root fallbacks for mobile / devices
	r.POST("/devices", utils.JWTMiddleware(), h.RegisterDevice)
	r.DELETE("/devices", utils.JWTMiddleware(), h.UnregisterDevice)
	r.POST("/logout", utils.JWTMiddleware(), h.Logout)
	r.POST("/heartbeat", utils.JWTMiddleware(), h.Heartbeat)
	r.GET("/heartbeat", utils.JWTMiddleware(), h.Heartbeat)

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
func (h *Handler) CreatePost(c *gin.Context) {
	var input struct {
		Content   string `json:"content"`
		MediaURL  string `json:"media_url"`
		Community string `json:"community"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	comm := strings.TrimSpace(input.Community)
	if comm == "" {
		comm = "general"
	}

	userID := c.GetUint("user_id")
	post := model.Post{
		UserID:    userID,
		Content:   input.Content,
		MediaURL:  input.MediaURL,
		Community: comm,
	}

	if err := h.DB.Create(&post).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create post"})
		return
	}

	h.DB.Preload("User", func(db *gorm.DB) *gorm.DB {
		return db.Select("id", "username", "name", "email", "avatar_url")
	}).First(&post, post.ID)

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
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	ext := filepath.Ext(header.Filename)
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
		Preload("User", func(db *gorm.DB) *gorm.DB {
			return db.Select("id", "username", "name", "email", "avatar_url")
		}).
		Preload("Comments.User", func(db *gorm.DB) *gorm.DB {
			return db.Select("id", "username", "name", "email", "avatar_url")
		}).
		Preload("Parent").
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
	if community != "" && community != "all" {
		if community == "general" {
			query = query.Where("community = ? OR community IS NULL OR community = ''", "general")
		} else {
			query = query.Where("community = ?", community)
		}
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
		for i, p := range posts {
			ids[i] = p.ID
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

	// 2. Create the repost
	// A repost has no media of its own and optional comment/text content (like a quote retweet), 
	// or it can just be a pure repost with empty content.
	var input struct {
		Content string `json:"content"`
	}
	_ = c.ShouldBindJSON(&input) // optional: allows quote reposts!

	repost := model.Post{
		UserID:   userID,
		Content:  input.Content,
		ParentID: &targetPostID,
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
		Content string `json:"content" binding:"required"`
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

	comment := model.Comment{
		PostID:  postID,
		UserID:  userID,
		Content: req.Content,
	}

	if err := h.DB.Create(&comment).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save comment"})
		return
	}

	h.DB.Preload("User", func(db *gorm.DB) *gorm.DB {
		return db.Select("id", "username", "name", "email", "avatar_url")
	}).First(&comment, comment.ID)

	h.createNotification(post.UserID, userID, "comment", &postID)
	h.processMentions(comment.Content, userID, postID)

	c.JSON(http.StatusOK, comment)
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
	var user model.User

	if err := h.DB.First(&user, c.Param("id")).Error; err != nil {
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
	h.DB.Delete(&model.User{}, c.Param("id"))
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
	h.DB.Model(&model.Post{}).Where("user_id = ?", targetID).Count(&postCount)

	var isFollowing bool
	if requesterID != targetID {
		var count int64
		h.DB.Model(&model.Follow{}).
			Where("follower_id = ? AND following_id = ?", requesterID, targetID).
			Count(&count)
		isFollowing = count > 0
	}

	c.JSON(http.StatusOK, gin.H{
		"user":            user,
		"follower_count":  followerCount,
		"following_count": followingCount,
		"post_count":      postCount,
		"is_following":    isFollowing,
		"is_self":         requesterID == targetID,
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
		Where("user_id = ?", uint(targetIDNum)).
		Preload("User", func(db *gorm.DB) *gorm.DB {
			return db.Select("id", "username", "name", "email", "avatar_url")
		}).
		Preload("Comments.User", func(db *gorm.DB) *gorm.DB {
			return db.Select("id", "username", "name", "email", "avatar_url")
		}).
		Preload("Parent"). // 👈 ADD THIS
		Preload("Parent.User", func(db *gorm.DB) *gorm.DB { // 👈 AND THIS
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
		for i, p := range posts {
			ids[i] = p.ID
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

// ---------------------- RESOURCE (EMPTY FOR NOW) ----------------------
func (h *Handler) GetResources(c *gin.Context)   {}
func (h *Handler) GetResource(c *gin.Context)    {}
func (h *Handler) CreateResource(c *gin.Context) {}
func (h *Handler) UpdateResource(c *gin.Context) {}
func (h *Handler) DeleteResource(c *gin.Context) {}

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
			"Working on DevNest",
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
	messages := make([]model.Message, 0)
	h.DB.Where("(sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)",
		userID, uint(partnerID), uint(partnerID), userID).
		Order("created_at ASC").
		Find(&messages)

	c.JSON(http.StatusOK, messages)
}

func (h *Handler) GetConversations(c *gin.Context) {
	userID := c.GetUint("user_id")

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
	}

	seen := make(map[uint]bool)
	conversations := make([]ConversationItem, 0)

	for _, msg := range messages {
		partnerID := msg.RecipientID
		if partnerID == userID {
			partnerID = msg.SenderID
		}
		if partnerID == 0 || partnerID == userID || seen[partnerID] {
			continue
		}
		seen[partnerID] = true

		var partner model.User
		if err := h.DB.First(&partner, partnerID).Error; err == nil {
			conversations = append(conversations, ConversationItem{
				Partner:     partner,
				LastMessage: msg.Content,
				LastTime:    msg.CreatedAt,
				MediaType:   msg.MediaType,
				IsSender:    msg.SenderID == userID,
			})
		}
	}

	c.JSON(http.StatusOK, conversations)
}

func (h *Handler) SendMessage(c *gin.Context) {
	var input struct {
		RecipientID uint   `json:"recipient_id" binding:"required"`
		Content     string `json:"content"`
		MediaURL    string `json:"media_url"`
		MediaType   string `json:"media_type"`
		FileName    string `json:"file_name"`
		FileSize    int64  `json:"file_size"`
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
	msg := model.Message{
		SenderID:    userID,
		RecipientID: input.RecipientID,
		Content:     content,
		MediaURL:    mediaURL,
		MediaType:   input.MediaType,
		FileName:    input.FileName,
		FileSize:    input.FileSize,
	}

	if err := h.DB.Create(&msg).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save message"})
		return
	}

	// Deliver live message over WebSocket if recipient is online
	msgJSON, _ := json.Marshal(gin.H{
		"event":   "message",
		"message": msg,
	})
	h.Hub.SendToUser(input.RecipientID, msgJSON)

	if userID != input.RecipientID {
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