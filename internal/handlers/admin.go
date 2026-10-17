package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"piscine-devnest/internal/model"
)

// Role levels for hierarchy checks
func roleLevel(r string) int {
	switch strings.ToLower(strings.TrimSpace(r)) {
	case "super_admin":
		return 3
	case "admin":
		return 2
	case "moderator":
		return 1
	default:
		return 0 // "user"
	}
}

// canActOnUser checks that caller strictly outranks target (admins cannot act on other admins or super_admins)
func canActOnUser(callerRole, targetRole string) bool {
	return roleLevel(callerRole) > roleLevel(targetRole)
}

// ---------------------------------------------------------------------------
// MIDDLEWARE: CheckUserStatus
// ---------------------------------------------------------------------------
// Rejects requests from banned users, and from suspended users until suspended_until passes.
func (h *Handler) CheckUserStatus(c *gin.Context) {
	userID := c.GetUint("user_id")
	if userID == 0 {
		c.Next()
		return
	}

	var user model.User
	if err := h.DB.Select("id", "username", "role", "status", "suspended_until", "status_reason").
		First(&user, userID).Error; err != nil {
		c.Next()
		return
	}

	// 1. Check if user is permanently banned
	if user.Status == "banned" {
		c.JSON(http.StatusForbidden, gin.H{
			"error":  "Your account has been banned.",
			"code":   "account_banned",
			"reason": user.StatusReason,
		})
		c.Abort()
		return
	}

	// 2. Check if user is currently suspended
	if user.Status == "suspended" && user.SuspendedUntil != nil {
		now := time.Now()
		if now.Before(*user.SuspendedUntil) {
			c.JSON(http.StatusForbidden, gin.H{
				"error":           fmt.Sprintf("Your account is suspended until %s.", user.SuspendedUntil.Format(time.RFC822)),
				"code":            "account_suspended",
				"reason":          user.StatusReason,
				"suspended_until": user.SuspendedUntil,
			})
			c.Abort()
			return
		}

		// Suspended duration has expired: automatically lift suspension
		h.DB.Model(&model.User{}).Where("id = ?", user.ID).Updates(map[string]interface{}{
			"status":          "active",
			"suspended_until": nil,
			"status_reason":   "",
		})
		user.Status = "active"
		user.SuspendedUntil = nil
	}

	c.Set("caller_user", &user)
	c.Next()
}

// ---------------------------------------------------------------------------
// MIDDLEWARE: RequireRole
// ---------------------------------------------------------------------------
// Enforces minimum role level by checking server database directly (never client token).
func (h *Handler) RequireRole(minRole string) gin.HandlerFunc {
	minLevel := roleLevel(minRole)

	return func(c *gin.Context) {
		userID := c.GetUint("user_id")
		if userID == 0 {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized", "code": "unauthorized"})
			c.Abort()
			return
		}

		var user model.User
		if err := h.DB.First(&user, userID).Error; err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "user not found", "code": "unauthorized"})
			c.Abort()
			return
		}

		// Block banned/suspended admins
		if user.Status == "banned" {
			c.JSON(http.StatusForbidden, gin.H{"error": "account banned", "code": "account_banned"})
			c.Abort()
			return
		}
		if user.Status == "suspended" && user.SuspendedUntil != nil && time.Now().Before(*user.SuspendedUntil) {
			c.JSON(http.StatusForbidden, gin.H{"error": "account suspended", "code": "account_suspended"})
			c.Abort()
			return
		}

		if roleLevel(user.Role) < minLevel {
			c.JSON(http.StatusForbidden, gin.H{
				"error": fmt.Sprintf("Forbidden: this action requires '%s' role or higher.", minRole),
				"code":  "forbidden",
			})
			c.Abort()
			return
		}

		c.Set("caller_user", &user)
		c.Next()
	}
}

// Helper to write an audit log entry in the same transaction
func (h *Handler) logAuditTx(tx *gorm.DB, adminID uint, action, targetType string, targetID uint, reason string, metadata map[string]interface{}) error {
	metaJSON, _ := json.Marshal(metadata)
	audit := model.AuditLog{
		AdminID:    adminID,
		Action:     action,
		TargetType: targetType,
		TargetID:   targetID,
		Reason:     reason,
		Metadata:   string(metaJSON),
		CreatedAt:  time.Now(),
	}
	return tx.Create(&audit).Error
}

// ---------------------------------------------------------------------------
// 1. ADMIN USERS MANAGEMENT
// ---------------------------------------------------------------------------

// AdminGetUsers lists users with filtering, search, and pagination
func (h *Handler) AdminGetUsers(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 20
	}
	offset := (page - 1) * limit

	q := strings.TrimSpace(c.Query("q"))
	statusFilter := strings.TrimSpace(c.Query("status"))
	roleFilter := strings.TrimSpace(c.Query("role"))

	query := h.DB.Model(&model.User{})

	if q != "" {
		like := "%" + strings.ToLower(q) + "%"
		query = query.Where("LOWER(username) LIKE ? OR LOWER(name) LIKE ? OR LOWER(email) LIKE ?", like, like, like)
	}
	if statusFilter != "" && statusFilter != "all" {
		query = query.Where("status = ?", statusFilter)
	}
	if roleFilter != "" && roleFilter != "all" {
		query = query.Where("role = ?", roleFilter)
	}

	var total int64
	query.Count(&total)

	var users []model.User
	if err := query.
		Select("id", "username", "name", "email", "avatar_url", "role", "status", "suspended_until", "status_reason", "created_at", "last_seen_at").
		Order("id desc").
		Limit(limit).
		Offset(offset).
		Find(&users).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query users"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"users": users,
		"total": total,
		"page":  page,
		"limit": limit,
	})
}

// AdminGetUser returns detailed info, activity, post count, and report count for a single user
func (h *Handler) AdminGetUser(c *gin.Context) {
	targetID, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	var user model.User
	if err := h.DB.
		Select("id", "username", "name", "email", "avatar_url", "banner_url", "bio", "skills", "location", "batch", "role", "status", "suspended_until", "status_reason", "created_at", "last_seen_at").
		First(&user, targetID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	var postCount int64
	h.DB.Model(&model.Post{}).Where("user_id = ?", user.ID).Count(&postCount)

	var commentCount int64
	h.DB.Model(&model.Comment{}).Where("user_id = ?", user.ID).Count(&commentCount)

	var reportCount int64
	h.DB.Model(&model.Report{}).Where("target_type = 'user' AND target_id = ?", user.ID).Count(&reportCount)

	// Fetch recent posts
	var recentPosts []model.Post
	h.DB.Where("user_id = ?", user.ID).Order("created_at desc").Limit(5).Find(&recentPosts)

	c.JSON(http.StatusOK, gin.H{
		"user":          user,
		"post_count":    postCount,
		"comment_count": commentCount,
		"report_count":  reportCount,
		"recent_posts":  recentPosts,
	})
}

// AdminSuspendUser temporarily suspends a user
func (h *Handler) AdminSuspendUser(c *gin.Context) {
	adminID := c.GetUint("user_id")
	targetID, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	var input struct {
		Reason        string `json:"reason" binding:"required"`
		DurationHours int    `json:"duration_hours"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "reason is required"})
		return
	}

	if input.DurationHours <= 0 {
		input.DurationHours = 24 // default 24h
	}

	var caller model.User
	if err := h.DB.First(&caller, adminID).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "admin not found"})
		return
	}

	var target model.User
	if err := h.DB.First(&target, targetID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "target user not found"})
		return
	}

	// Hierarchy check: admins cannot act on other admins or super_admins
	if !canActOnUser(caller.Role, target.Role) {
		c.JSON(http.StatusForbidden, gin.H{
			"error": "Forbidden: you cannot suspend a user with equal or higher role privileges.",
			"code":  "forbidden_hierarchy",
		})
		return
	}

	until := time.Now().Add(time.Duration(input.DurationHours) * time.Hour)

	// Transaction to update user and write audit log atomically
	tx := h.DB.Begin()
	if err := tx.Model(&target).Updates(map[string]interface{}{
		"status":          "suspended",
		"suspended_until": &until,
		"status_reason":   input.Reason,
	}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to suspend user"})
		return
	}

	if err := h.logAuditTx(tx, caller.ID, "suspend_user", "user", target.ID, input.Reason, map[string]interface{}{
		"duration_hours":  input.DurationHours,
		"suspended_until": until,
		"target_username": target.Username,
	}); err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to record audit log"})
		return
	}

	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to commit transaction"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":         fmt.Sprintf("User @%s has been suspended until %s.", target.Username, until.Format(time.RFC822)),
		"status":          "suspended",
		"suspended_until": until,
	})
}

// AdminBanUser permanently bans a user
func (h *Handler) AdminBanUser(c *gin.Context) {
	adminID := c.GetUint("user_id")
	targetID, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	var input struct {
		Reason   string `json:"reason" binding:"required"`
		Password string `json:"password"` // optional verification
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "reason is required"})
		return
	}

	var caller model.User
	if err := h.DB.First(&caller, adminID).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "admin not found"})
		return
	}

	// Verify admin password if provided
	if input.Password != "" {
		if err := bcrypt.CompareHashAndPassword([]byte(caller.Password), []byte(input.Password)); err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "incorrect password confirmation"})
			return
		}
	}

	var target model.User
	if err := h.DB.First(&target, targetID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "target user not found"})
		return
	}

	// Hierarchy check: admins cannot act on other admins or super_admins
	if !canActOnUser(caller.Role, target.Role) {
		c.JSON(http.StatusForbidden, gin.H{
			"error": "Forbidden: you cannot ban a user with equal or higher role privileges.",
			"code":  "forbidden_hierarchy",
		})
		return
	}

	tx := h.DB.Begin()
	if err := tx.Model(&target).Updates(map[string]interface{}{
		"status":          "banned",
		"suspended_until": nil,
		"status_reason":   input.Reason,
	}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to ban user"})
		return
	}

	if err := h.logAuditTx(tx, caller.ID, "ban_user", "user", target.ID, input.Reason, map[string]interface{}{
		"target_username": target.Username,
	}); err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to record audit log"})
		return
	}

	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to commit transaction"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("User @%s has been permanently banned.", target.Username),
		"status":  "banned",
	})
}

// AdminRestoreUser restores a suspended or banned user back to active status
func (h *Handler) AdminRestoreUser(c *gin.Context) {
	adminID := c.GetUint("user_id")
	targetID, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	var input struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&input)

	var caller model.User
	if err := h.DB.First(&caller, adminID).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "admin not found"})
		return
	}

	var target model.User
	if err := h.DB.First(&target, targetID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "target user not found"})
		return
	}

	if !canActOnUser(caller.Role, target.Role) {
		c.JSON(http.StatusForbidden, gin.H{
			"error": "Forbidden: you cannot restore a user with equal or higher role privileges.",
			"code":  "forbidden_hierarchy",
		})
		return
	}

	tx := h.DB.Begin()
	if err := tx.Model(&target).Updates(map[string]interface{}{
		"status":          "active",
		"suspended_until": nil,
		"status_reason":   "",
	}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to restore user"})
		return
	}

	reason := input.Reason
	if reason == "" {
		reason = "Restored by admin"
	}

	if err := h.logAuditTx(tx, caller.ID, "restore_user", "user", target.ID, reason, map[string]interface{}{
		"target_username": target.Username,
	}); err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to record audit log"})
		return
	}

	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to commit transaction"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("User @%s has been restored to active status.", target.Username),
		"status":  "active",
	})
}

// AdminUpdateUserRole updates a user's role (Super Admin only)
func (h *Handler) AdminUpdateUserRole(c *gin.Context) {
	superAdminID := c.GetUint("user_id")
	targetID, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	// Super Admin cannot change their own role to prevent lockout
	if uint(targetID) == superAdminID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "you cannot change your own role"})
		return
	}

	var input struct {
		Role     string `json:"role" binding:"required"`
		Password string `json:"password" binding:"required"` // re-enter password required
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "new role and password are required"})
		return
	}

	validRoles := map[string]bool{
		"user":        true,
		"moderator":   true,
		"admin":       true,
		"super_admin": true,
	}
	if !validRoles[input.Role] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid role specified"})
		return
	}

	var superAdmin model.User
	if err := h.DB.First(&superAdmin, superAdminID).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "admin not found"})
		return
	}

	// Verify super_admin password before role modification
	if err := bcrypt.CompareHashAndPassword([]byte(superAdmin.Password), []byte(input.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "incorrect password confirmation"})
		return
	}

	var target model.User
	if err := h.DB.First(&target, targetID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "target user not found"})
		return
	}

	oldRole := target.Role

	tx := h.DB.Begin()
	if err := tx.Model(&target).Update("role", input.Role).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update role"})
		return
	}

	if err := h.logAuditTx(tx, superAdmin.ID, "change_role", "user", target.ID, fmt.Sprintf("Changed role from %s to %s", oldRole, input.Role), map[string]interface{}{
		"target_username": target.Username,
		"old_role":        oldRole,
		"new_role":        input.Role,
	}); err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to record audit log"})
		return
	}

	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to commit transaction"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": fmt.Sprintf("Role for @%s updated from '%s' to '%s'.", target.Username, oldRole, input.Role),
		"role":    input.Role,
	})
}

// ---------------------------------------------------------------------------
// 2. REPORTS QUEUE & MODERATION
// ---------------------------------------------------------------------------

// AdminGetReports lists reports with filtering and content preview
func (h *Handler) AdminGetReports(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 20
	}
	offset := (page - 1) * limit

	statusFilter := strings.TrimSpace(c.Query("status"))
	typeFilter := strings.TrimSpace(c.Query("target_type"))

	query := h.DB.Model(&model.Report{})

	if statusFilter != "" && statusFilter != "all" {
		query = query.Where("status = ?", statusFilter)
	}
	if typeFilter != "" && typeFilter != "all" {
		query = query.Where("target_type = ?", typeFilter)
	}

	var total int64
	query.Count(&total)

	var reports []model.Report
	if err := query.
		Preload("Reporter", func(db *gorm.DB) *gorm.DB {
			return db.Select("id", "username", "name", "avatar_url")
		}).
		Preload("Resolver", func(db *gorm.DB) *gorm.DB {
			return db.Select("id", "username", "name")
		}).
		Order("CASE WHEN status = 'open' THEN 0 ELSE 1 END, created_at desc").
		Limit(limit).
		Offset(offset).
		Find(&reports).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query reports"})
		return
	}

	// Enrich preview content for moderators
	for i := range reports {
		r := &reports[i]
		switch r.TargetType {
		case "post":
			var post model.Post
			if err := h.DB.Preload("User").First(&post, r.TargetID).Error; err == nil {
				r.TargetContent = post.Content
				if post.User != nil {
					r.TargetAuthor = post.User.Username
					r.TargetAuthorID = post.User.ID
				}
				if post.HiddenAt != nil {
					r.TargetDetails = "(Content currently hidden)"
				}
			} else {
				r.TargetContent = "[Post deleted or not found]"
			}
		case "comment":
			var comment model.Comment
			if err := h.DB.Preload("User").First(&comment, r.TargetID).Error; err == nil {
				r.TargetContent = comment.Content
				if comment.User != nil {
					r.TargetAuthor = comment.User.Username
					r.TargetAuthorID = comment.User.ID
				}
				if comment.HiddenAt != nil {
					r.TargetDetails = "(Comment currently hidden)"
				}
			} else {
				r.TargetContent = "[Comment deleted or not found]"
			}
		case "user":
			var targetUser model.User
			if err := h.DB.Select("id", "username", "name", "bio", "status").First(&targetUser, r.TargetID).Error; err == nil {
				r.TargetContent = fmt.Sprintf("User: @%s (%s)", targetUser.Username, targetUser.Name)
				r.TargetAuthor = targetUser.Username
				r.TargetAuthorID = targetUser.ID
				r.TargetDetails = fmt.Sprintf("Status: %s", targetUser.Status)
			} else {
				r.TargetContent = "[User not found]"
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"reports": reports,
		"total":   total,
		"page":    page,
		"limit":   limit,
	})
}

// AdminResolveReport handles actions: dismiss, remove_content, suspend_user, ban_user
func (h *Handler) AdminResolveReport(c *gin.Context) {
	adminID := c.GetUint("user_id")
	reportID, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid report id"})
		return
	}

	var input struct {
		Action        string `json:"action" binding:"required"` // 'dismiss', 'remove_content', 'suspend_user', 'ban_user'
		Note          string `json:"note"`
		DurationHours int    `json:"duration_hours"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "action is required"})
		return
	}

	var caller model.User
	if err := h.DB.First(&caller, adminID).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "admin not found"})
		return
	}

	var report model.Report
	if err := h.DB.First(&report, reportID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "report not found"})
		return
	}

	// Moderators can only dismiss or remove content
	callerLvl := roleLevel(caller.Role)
	if (input.Action == "suspend_user" || input.Action == "ban_user") && callerLvl < 2 {
		c.JSON(http.StatusForbidden, gin.H{
			"error": "Forbidden: suspending or banning users requires Administrator privileges.",
			"code":  "forbidden",
		})
		return
	}

	tx := h.DB.Begin()

	now := time.Now()
	report.Status = "resolved"
	report.ResolvedBy = &caller.ID
	report.ResolvedAt = &now
	report.Resolution = input.Action
	if input.Note != "" {
		report.Note = report.Note + "\n[Resolution Note]: " + input.Note
	}

	switch input.Action {
	case "dismiss":
		report.Status = "dismissed"
		report.Resolution = "dismissed"

	case "remove_content":
		if report.TargetType == "post" {
			tx.Model(&model.Post{}).Where("id = ?", report.TargetID).Updates(map[string]interface{}{
				"hidden_at": now,
				"hidden_by": caller.ID,
			})
		} else if report.TargetType == "comment" {
			tx.Model(&model.Comment{}).Where("id = ?", report.TargetID).Updates(map[string]interface{}{
				"hidden_at": now,
				"hidden_by": caller.ID,
			})
		}

	case "suspend_user":
		var targetUserID uint
		if report.TargetType == "user" {
			targetUserID = report.TargetID
		} else if report.TargetType == "post" {
			var post model.Post
			if err := h.DB.Select("user_id").First(&post, report.TargetID).Error; err == nil {
				targetUserID = post.UserID
			}
			tx.Model(&model.Post{}).Where("id = ?", report.TargetID).Updates(map[string]interface{}{
				"hidden_at": now,
				"hidden_by": caller.ID,
			})
		} else if report.TargetType == "comment" {
			var comment model.Comment
			if err := h.DB.Select("user_id").First(&comment, report.TargetID).Error; err == nil {
				targetUserID = comment.UserID
			}
			tx.Model(&model.Comment{}).Where("id = ?", report.TargetID).Updates(map[string]interface{}{
				"hidden_at": now,
				"hidden_by": caller.ID,
			})
		}

		if targetUserID > 0 {
			var targetUser model.User
			if err := tx.First(&targetUser, targetUserID).Error; err == nil {
				if !canActOnUser(caller.Role, targetUser.Role) {
					tx.Rollback()
					c.JSON(http.StatusForbidden, gin.H{"error": "cannot suspend a user with equal or higher role"})
					return
				}
				hours := input.DurationHours
				if hours <= 0 {
					hours = 24
				}
				until := now.Add(time.Duration(hours) * time.Hour)
				tx.Model(&targetUser).Updates(map[string]interface{}{
					"status":          "suspended",
					"suspended_until": &until,
					"status_reason":   fmt.Sprintf("Suspended via Report #%d (%s)", report.ID, report.Reason),
				})
			}
		}

	case "ban_user":
		var targetUserID uint
		if report.TargetType == "user" {
			targetUserID = report.TargetID
		} else if report.TargetType == "post" {
			var post model.Post
			if err := h.DB.Select("user_id").First(&post, report.TargetID).Error; err == nil {
				targetUserID = post.UserID
			}
			tx.Model(&model.Post{}).Where("id = ?", report.TargetID).Updates(map[string]interface{}{
				"hidden_at": now,
				"hidden_by": caller.ID,
			})
		} else if report.TargetType == "comment" {
			var comment model.Comment
			if err := h.DB.Select("user_id").First(&comment, report.TargetID).Error; err == nil {
				targetUserID = comment.UserID
			}
			tx.Model(&model.Comment{}).Where("id = ?", report.TargetID).Updates(map[string]interface{}{
				"hidden_at": now,
				"hidden_by": caller.ID,
			})
		}

		if targetUserID > 0 {
			var targetUser model.User
			if err := tx.First(&targetUser, targetUserID).Error; err == nil {
				if !canActOnUser(caller.Role, targetUser.Role) {
					tx.Rollback()
					c.JSON(http.StatusForbidden, gin.H{"error": "cannot ban a user with equal or higher role"})
					return
				}
				tx.Model(&targetUser).Updates(map[string]interface{}{
					"status":          "banned",
					"suspended_until": nil,
					"status_reason":   fmt.Sprintf("Banned via Report #%d (%s)", report.ID, report.Reason),
				})
			}
		}

	default:
		tx.Rollback()
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid resolution action"})
		return
	}

	if err := tx.Save(&report).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save report"})
		return
	}

	if err := h.logAuditTx(tx, caller.ID, "resolve_report", "report", report.ID, input.Action, map[string]interface{}{
		"target_type": report.TargetType,
		"target_id":   report.TargetID,
		"action":      input.Action,
		"note":        input.Note,
	}); err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to record audit log"})
		return
	}

	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to commit transaction"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":    "Report has been resolved successfully.",
		"status":     report.Status,
		"resolution": report.Resolution,
	})
}

// ---------------------------------------------------------------------------
// 3. CONTENT MODERATION (SOFT-DELETE / HIDE & RESTORE)
// ---------------------------------------------------------------------------

// AdminHideContent soft-deletes a post or comment so normal users cannot see it
func (h *Handler) AdminHideContent(c *gin.Context) {
	adminID := c.GetUint("user_id")
	contentType := strings.ToLower(c.Param("type"))
	contentID, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid content id"})
		return
	}

	var input struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&input)
	if input.Reason == "" {
		input.Reason = "Violation of community standards"
	}

	now := time.Now()
	tx := h.DB.Begin()

	if contentType == "post" {
		var post model.Post
		if err := tx.First(&post, contentID).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusNotFound, gin.H{"error": "post not found"})
			return
		}
		if err := tx.Model(&post).Updates(map[string]interface{}{
			"hidden_at": now,
			"hidden_by": adminID,
		}).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hide post"})
			return
		}
	} else if contentType == "comment" {
		var comment model.Comment
		if err := tx.First(&comment, contentID).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusNotFound, gin.H{"error": "comment not found"})
			return
		}
		if err := tx.Model(&comment).Updates(map[string]interface{}{
			"hidden_at": now,
			"hidden_by": adminID,
		}).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hide comment"})
			return
		}
	} else {
		tx.Rollback()
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid content type; must be 'post' or 'comment'"})
		return
	}

	if err := h.logAuditTx(tx, adminID, "hide_content", contentType, uint(contentID), input.Reason, map[string]interface{}{
		"content_type": contentType,
		"content_id":   contentID,
	}); err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to record audit log"})
		return
	}

	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to commit transaction"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": fmt.Sprintf("%s has been hidden from public view.", strings.Title(contentType))})
}

// AdminRestoreContent restores a soft-deleted post or comment
func (h *Handler) AdminRestoreContent(c *gin.Context) {
	adminID := c.GetUint("user_id")
	contentType := strings.ToLower(c.Param("type"))
	contentID, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid content id"})
		return
	}

	var input struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&input)
	if input.Reason == "" {
		input.Reason = "Restored after moderator review"
	}

	tx := h.DB.Begin()

	if contentType == "post" {
		var post model.Post
		if err := tx.First(&post, contentID).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusNotFound, gin.H{"error": "post not found"})
			return
		}
		if err := tx.Model(&post).Updates(map[string]interface{}{
			"hidden_at": nil,
			"hidden_by": nil,
		}).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to restore post"})
			return
		}
	} else if contentType == "comment" {
		var comment model.Comment
		if err := tx.First(&comment, contentID).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusNotFound, gin.H{"error": "comment not found"})
			return
		}
		if err := tx.Model(&comment).Updates(map[string]interface{}{
			"hidden_at": nil,
			"hidden_by": nil,
		}).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to restore comment"})
			return
		}
	} else {
		tx.Rollback()
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid content type; must be 'post' or 'comment'"})
		return
	}

	if err := h.logAuditTx(tx, adminID, "restore_content", contentType, uint(contentID), input.Reason, map[string]interface{}{
		"content_type": contentType,
		"content_id":   contentID,
	}); err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to record audit log"})
		return
	}

	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to commit transaction"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": fmt.Sprintf("%s has been restored to public view.", strings.Title(contentType))})
}

// ---------------------------------------------------------------------------
// 4. ADMIN STATS & ANALYTICS
// ---------------------------------------------------------------------------

// AdminGetStats computes system metrics and 7-day trend arrays
func (h *Handler) AdminGetStats(c *gin.Context) {
	now := time.Now()
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	dayAgo := now.Add(-24 * time.Hour)

	var totalUsers int64
	h.DB.Model(&model.User{}).Count(&totalUsers)

	var newUsersToday int64
	h.DB.Model(&model.User{}).Where("created_at >= ?", midnight).Count(&newUsersToday)

	var dau int64
	h.DB.Model(&model.User{}).Where("last_seen_at >= ?", dayAgo).Count(&dau)

	var postsToday int64
	h.DB.Model(&model.Post{}).Where("created_at >= ?", midnight).Count(&postsToday)

	var commentsToday int64
	h.DB.Model(&model.Comment{}).Where("created_at >= ?", midnight).Count(&commentsToday)

	var openReports int64
	h.DB.Model(&model.Report{}).Where("status = 'open'").Count(&openReports)

	var callsToday int64
	h.DB.Model(&model.Notification{}).Where("type LIKE '%call%' AND created_at >= ?", midnight).Count(&callsToday)

	// Build 7-day signups and posts trend arrays for simple charts
	type DayData struct {
		Date  string `json:"date"`
		Count int64  `json:"count"`
	}

	var signups7d []DayData
	var posts7d []DayData

	for i := 6; i >= 0; i-- {
		start := midnight.AddDate(0, 0, -i)
		end := start.Add(24 * time.Hour)
		dayLabel := start.Format("Jan 02")

		var signupsCount int64
		h.DB.Model(&model.User{}).Where("created_at >= ? AND created_at < ?", start, end).Count(&signupsCount)
		signups7d = append(signups7d, DayData{Date: dayLabel, Count: signupsCount})

		var postCount int64
		h.DB.Model(&model.Post{}).Where("created_at >= ? AND created_at < ?", start, end).Count(&postCount)
		posts7d = append(posts7d, DayData{Date: dayLabel, Count: postCount})
	}

	c.JSON(http.StatusOK, gin.H{
		"total_users":     totalUsers,
		"new_users_today": newUsersToday,
		"dau":             dau,
		"posts_today":     postsToday,
		"comments_today":  commentsToday,
		"calls_today":     callsToday,
		"open_reports":    openReports,
		"signups_7d":      signups7d,
		"posts_7d":        posts7d,
	})
}

// ---------------------------------------------------------------------------
// 5. AUDIT LOG (SUPER ADMIN ONLY)
// ---------------------------------------------------------------------------

// AdminGetAuditLog returns paginated log of administrative actions
func (h *Handler) AdminGetAuditLog(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 100 {
		limit = 20
	}
	offset := (page - 1) * limit

	actionFilter := strings.TrimSpace(c.Query("action"))
	adminIDFilter := strings.TrimSpace(c.Query("admin_id"))

	query := h.DB.Model(&model.AuditLog{})

	if actionFilter != "" && actionFilter != "all" {
		query = query.Where("action = ?", actionFilter)
	}
	if adminIDFilter != "" {
		query = query.Where("admin_id = ?", adminIDFilter)
	}

	var total int64
	query.Count(&total)

	var logs []model.AuditLog
	if err := query.
		Preload("Admin", func(db *gorm.DB) *gorm.DB {
			return db.Select("id", "username", "name")
		}).
		Order("id desc").
		Limit(limit).
		Offset(offset).
		Find(&logs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query audit log"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"logs":  logs,
		"total": total,
		"page":  page,
		"limit": limit,
	})
}

// ---------------------------------------------------------------------------
// 6. NORMAL USER ENDPOINT: CREATE REPORT
// ---------------------------------------------------------------------------

// CreateReport allows normal users to report a post, comment, or user
func (h *Handler) CreateReport(c *gin.Context) {
	reporterID := c.GetUint("user_id")

	var input struct {
		TargetType string `json:"target_type" binding:"required"` // 'post', 'comment', 'user'
		TargetID   uint   `json:"target_id" binding:"required"`
		Reason     string `json:"reason" binding:"required"`      // 'spam', 'harassment', 'hate', 'nudity', 'violence', 'scam', 'other'
		Note       string `json:"note"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "target_type, target_id, and reason are required"})
		return
	}

	targetType := strings.ToLower(strings.TrimSpace(input.TargetType))
	if targetType != "post" && targetType != "comment" && targetType != "user" && targetType != "live" && targetType != "live_message" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "target_type must be 'post', 'comment', 'user', 'live', or 'live_message'"})
		return
	}

	validReasons := map[string]bool{
		"spam":       true,
		"harassment": true,
		"hate":       true,
		"nudity":     true,
		"violence":   true,
		"scam":       true,
		"other":      true,
	}
	if !validReasons[strings.ToLower(input.Reason)] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reason specified"})
		return
	}

	// Verify target exists
	switch targetType {
	case "post":
		var post model.Post
		if err := h.DB.First(&post, input.TargetID).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "reported post does not exist"})
			return
		}
	case "comment":
		var comment model.Comment
		if err := h.DB.First(&comment, input.TargetID).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "reported comment does not exist"})
			return
		}
	case "user":
		if input.TargetID == reporterID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "you cannot report yourself"})
			return
		}
		var user model.User
		if err := h.DB.First(&user, input.TargetID).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "reported user does not exist"})
			return
		}
	case "live", "live_message":
		var live model.Live
		if err := h.DB.First(&live, input.TargetID).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "reported live stream does not exist"})
			return
		}
	}

	// Rule: One open report per user per target
	var existing model.Report
	if err := h.DB.Where(
		"reporter_id = ? AND target_type = ? AND target_id = ? AND status = 'open'",
		reporterID, targetType, input.TargetID,
	).First(&existing).Error; err == nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "You already have an open report pending review for this item.",
			"code":  "duplicate_report",
		})
		return
	}

	report := model.Report{
		ReporterID: reporterID,
		TargetType: targetType,
		TargetID:   input.TargetID,
		Reason:     strings.ToLower(input.Reason),
		Note:       strings.TrimSpace(input.Note),
		Status:     "open",
		CreatedAt:  time.Now(),
	}

	if err := h.DB.Create(&report).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to submit report"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message":   "Thank you. Your report has been submitted to the moderation team.",
		"report_id": report.ID,
	})
}
