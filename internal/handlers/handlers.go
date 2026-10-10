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
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"piscine-devnest/internal/model"
	"piscine-devnest/internal/storage"
	"piscine-devnest/internal/utils"
	"piscine-devnest/internal/ws"
)

type Handler struct {
	DB  *gorm.DB
	Hub *ws.Hub
}

// Constructor
func NewHandler(db *gorm.DB, hub *ws.Hub) *Handler {
	return &Handler{DB: db, Hub: hub}
}

// ---------------------- ROUTES ----------------------
func (h *Handler) RegisterRoutes(r *gin.Engine) {
	// Root redirect to frontend UI so opening localhost:8080 leads smoothly to the app
	r.GET("/", func(c *gin.Context) {
		c.Redirect(http.StatusTemporaryRedirect, "http://localhost:5173")
	})
	r.GET("/favicon.ico", func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	api := r.Group("/api")

	// PUBLIC ROUTES
	api.GET("/ping", h.Ping)
	api.POST("/users", h.CreateUser)
	api.POST("/register", h.CreateUser)
	api.POST("/login", h.Login)
	api.POST("/forgot-password", h.ForgotPassword)

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

		// COMMUNITY
		protected.GET("/community/stats", h.GetCommunityStats)

		// LIKES & COMMENTS ✅ REGISTERED SMOOTHLY
		protected.POST("/posts/:id/like", h.LikePost)
		protected.POST("/posts/:id/comments", h.AddComment)

		//NOTIFICATION
		protected.GET("/notifications", h.GetNotifications)
		protected.POST("/notifications/:id/read", h.MarkNotificationRead)
		protected.POST("/notifications/read-all", h.MarkAllNotificationsRead)

		protected.GET("/messages/:partner_id", h.GetChatHistory)

		// MEDIA UPLOAD
		protected.POST("/upload", h.UploadMedia)
	}

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

	limit := 10
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


	if c.Query("following") == "true" {
		var followingIDs []uint
		h.DB.Model(&model.Follow{}).Where("follower_id = ?", userID).Pluck("following_id", &followingIDs)
		followingIDs = append(followingIDs, userID) // include your own posts too
		query = query.Where("user_id IN ?", followingIDs)
	}

	if comm := c.Query("community"); comm != "" && comm != "all" {
		if comm == "general" {
			query = query.Where("community = ? OR community = '' OR community IS NULL", "general")
		} else {
			query = query.Where("community = ?", comm)
		}
	}

	if err := query.
		Order("created_at desc").
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

	currentUserID := c.GetUint("user_id")
	if post.UserID != currentUserID {
		c.JSON(http.StatusForbidden, gin.H{
			"error": "unauthorized to edit this post",
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

	currentUserID := c.GetUint("user_id")
	if post.UserID != currentUserID {
		c.JSON(http.StatusForbidden, gin.H{
			"error": "unauthorized to delete this post",
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

func (h *Handler) GetChatHistory(c *gin.Context) {
    partnerIDStr := c.Param("partner_id")
    partnerID, err := strconv.ParseUint(partnerIDStr, 10, 32)
    if err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": "invalid partner ID"})
        return
    }

    // Use GetUint consistent with your other methods
    userID := c.GetUint("user_id") 

    var messages []model.Message
    // Fetch messages where (sender == user && recipient == partner) OR (sender == partner && recipient == user)
    h.DB.Where("(sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)", 
        userID, uint(partnerID), uint(partnerID), userID).
        Order("created_at ASC").
        Find(&messages)

    c.JSON(http.StatusOK, messages)
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
	username := c.Param("username")

	var user model.User
	// Using LOWER() for a bulletproof case-insensitive match (crucial for clickable mentions)
	if err := h.DB.Where("LOWER(username) = LOWER(?)", username).First(&user).Error; err != nil {
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
	currentUserID := c.GetUint("user_id")
	targetID, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil || uint(targetID) != currentUserID {
		c.JSON(http.StatusForbidden, gin.H{"error": "unauthorized to update this user"})
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

	user.Name = input.Name
	user.Bio = input.Bio
	user.Skills = input.Skills
	user.Batch = input.Batch
	user.Location = input.Location
	user.AvatarURL = input.AvatarURL
	user.BannerURL = input.BannerURL

	h.DB.Save(&user)

	c.JSON(http.StatusOK, user)
}

func (h *Handler) DeleteUser(c *gin.Context) {
	currentUserID := c.GetUint("user_id")
	targetID, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil || uint(targetID) != currentUserID {
		c.JSON(http.StatusForbidden, gin.H{"error": "unauthorized to delete this user"})
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

	var user model.User
	identifier := strings.TrimSpace(input.Email)

	if err := h.DB.Where("LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)", identifier, identifier).First(&user).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user not found"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(input.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "password mismatch"})
		return
	}

	token, err := utils.GenerateToken(user.ID)
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

	var user model.User
	if err := h.DB.Where("LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)", identifier, identifier).First(&user).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No account found matching that email or username"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(input.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to encrypt password"})
		return
	}

	user.Password = string(hash)
	if err := h.DB.Save(&user).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update password"})
		return
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
	var totalMembers int64
	h.DB.Model(&model.User{}).Count(&totalMembers)
	if totalMembers < 128 {
		totalMembers = 128
	}

	var users []model.User
	h.DB.Select("id", "username", "name", "avatar_url", "bio").Order("id asc").Limit(10).Find(&users)

	type OnlineUser struct {
		ID        uint   `json:"id"`
		Username  string `json:"username"`
		Name      string `json:"name"`
		AvatarURL string `json:"avatar_url"`
		Status    string `json:"status"`
	}

	fallbackUsers := []OnlineUser{
		{Username: "Jaytricks", Name: "Jaytricks", Status: "Working on DevNest"},
		{Username: "piscine_builder", Name: "piscine_builder", Status: "Building something great"},
		{Username: "codewith_ella", Name: "codewith_ella", Status: "Learning Go"},
		{Username: "devking", Name: "devking", Status: "Just chatting"},
	}

	statuses := []string{
		"Working on DevNest",
		"Building something great",
		"Learning Go",
		"Just chatting",
		"Reviewing PRs",
		"Exploring Rust",
	}

	var onlineList []OnlineUser
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

	for i := len(onlineList); i < len(fallbackUsers); i++ {
		onlineList = append(onlineList, fallbackUsers[i])
	}

	c.JSON(http.StatusOK, gin.H{
		"member_count": totalMembers,
		"online_users": onlineList,
	})
}