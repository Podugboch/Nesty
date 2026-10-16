package handlers

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"piscine-devnest/internal/model"
)

// TestRoleHierarchy verifies the role levels and that admins cannot act on higher or equal roles
func TestRoleHierarchy(t *testing.T) {
	tests := []struct {
		name       string
		callerRole string
		targetRole string
		expected   bool
	}{
		// Super Admin checks
		{"super_admin acts on user", "super_admin", "user", true},
		{"super_admin acts on moderator", "super_admin", "moderator", true},
		{"super_admin acts on admin", "super_admin", "admin", true},
		{"super_admin acts on super_admin (forbidden)", "super_admin", "super_admin", false},

		// Admin checks
		{"admin acts on user", "admin", "user", true},
		{"admin acts on moderator", "admin", "moderator", true},
		{"admin acts on admin (forbidden)", "admin", "admin", false},
		{"admin acts on super_admin (forbidden)", "admin", "super_admin", false},

		// Moderator checks
		{"moderator acts on user", "moderator", "user", true},
		{"moderator acts on moderator (forbidden)", "moderator", "moderator", false},
		{"moderator acts on admin (forbidden)", "moderator", "admin", false},
		{"moderator acts on super_admin (forbidden)", "moderator", "super_admin", false},

		// Regular User checks
		{"user acts on user (forbidden)", "user", "user", false},
		{"user acts on moderator (forbidden)", "user", "moderator", false},
		{"user acts on admin (forbidden)", "user", "admin", false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := canActOnUser(tc.callerRole, tc.targetRole)
			if result != tc.expected {
				t.Errorf("canActOnUser(%q, %q) = %v; want %v", tc.callerRole, tc.targetRole, result, tc.expected)
			}
		})
	}
}

// TestRoleLevels verifies numeric mapping for role hierarchies
func TestRoleLevels(t *testing.T) {
	if roleLevel("super_admin") != 3 {
		t.Errorf("expected super_admin to be 3, got %d", roleLevel("super_admin"))
	}
	if roleLevel("admin") != 2 {
		t.Errorf("expected admin to be 2, got %d", roleLevel("admin"))
	}
	if roleLevel("moderator") != 1 {
		t.Errorf("expected moderator to be 1, got %d", roleLevel("moderator"))
	}
	if roleLevel("user") != 0 {
		t.Errorf("expected user to be 0, got %d", roleLevel("user"))
	}
	if roleLevel("UNKNOWN") != 0 {
		t.Errorf("expected unknown role to default to 0, got %d", roleLevel("UNKNOWN"))
	}
}

// TestRequireRoleUnauthorizedMissingUser verifies RequireRole rejects unauthenticated requests
func TestRequireRoleUnauthorizedMissingUser(t *testing.T) {
	gin.SetMode(gin.TestMode)

	h := &Handler{DB: nil}
	router := gin.New()
	router.GET("/test-role", h.RequireRole("admin"), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/test-role", nil)
	router.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected status %d for missing user_id, got %d", http.StatusUnauthorized, w.Code)
	}
}

// TestRequireRoleWithDatabase tests database role enforcement when DATABASE_URL is available
func TestRequireRoleWithDatabase(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("Skipping DB-dependent test: DATABASE_URL not set")
		return
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{PrepareStmt: false})
	if err != nil {
		t.Skipf("Skipping DB-dependent test: database connection failed: %v", err)
		return
	}

	_ = db.AutoMigrate(&model.User{})

	gin.SetMode(gin.TestMode)
	h := &Handler{DB: db}

	// Create temporary test users
	testUsers := []model.User{
		{
			Email:    "test_admin_mod@example.com",
			Username: "test_admin_mod",
			Password: "hashedpassword",
			Role:     "moderator",
			Status:   "active",
		},
		{
			Email:    "test_admin_adm@example.com",
			Username: "test_admin_adm",
			Password: "hashedpassword",
			Role:     "admin",
			Status:   "active",
		},
		{
			Email:    "test_admin_banned@example.com",
			Username: "test_admin_banned",
			Password: "hashedpassword",
			Role:     "admin",
			Status:   "banned",
		},
	}

	for i := range testUsers {
		_ = db.Where("email = ?", testUsers[i].Email).Delete(&model.User{}).Error
		if err := db.Create(&testUsers[i]).Error; err != nil {
			t.Skipf("Failed to create test user: %v", err)
			return
		}
		defer db.Delete(&testUsers[i])
	}

	router := gin.New()
	router.GET("/mod-endpoint", func(c *gin.Context) {
		c.Set("user_id", testUsers[0].ID) // moderator
		c.Next()
	}, h.RequireRole("moderator"), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	router.GET("/admin-endpoint", func(c *gin.Context) {
		c.Set("user_id", testUsers[0].ID) // moderator trying to access admin
		c.Next()
	}, h.RequireRole("admin"), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	router.GET("/banned-endpoint", func(c *gin.Context) {
		c.Set("user_id", testUsers[2].ID) // banned admin trying to access admin
		c.Next()
	}, h.RequireRole("admin"), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	// 1. Moderator accessing moderator route -> OK (200)
	w1 := httptest.NewRecorder()
	req1, _ := http.NewRequest(http.MethodGet, "/mod-endpoint", nil)
	router.ServeHTTP(w1, req1)
	if w1.Code != http.StatusOK {
		t.Errorf("moderator accessing mod route: expected 200, got %d", w1.Code)
	}

	// 2. Moderator accessing admin route -> Forbidden (403)
	w2 := httptest.NewRecorder()
	req2, _ := http.NewRequest(http.MethodGet, "/admin-endpoint", nil)
	router.ServeHTTP(w2, req2)
	if w2.Code != http.StatusForbidden {
		t.Errorf("moderator accessing admin route: expected 403, got %d", w2.Code)
	}

	// 3. Banned user accessing admin route -> Forbidden (403)
	w3 := httptest.NewRecorder()
	req3, _ := http.NewRequest(http.MethodGet, "/banned-endpoint", nil)
	router.ServeHTTP(w3, req3)
	if w3.Code != http.StatusForbidden {
		t.Errorf("banned admin accessing admin route: expected 403, got %d", w3.Code)
	}
}
