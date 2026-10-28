package app

import (
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"piscine-devnest/internal/handlers"
	"piscine-devnest/internal/model"
	"piscine-devnest/internal/push"
	"piscine-devnest/internal/seed"
	"piscine-devnest/internal/ws"
)

func Run() error {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return fmt.Errorf("DATABASE_URL is not set")
	}

	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		jwtSecret = "dev-secret"
	}

	// 1. FIXED: Set PrepareStmt to false to stop the "SQLSTATE 42P05 already exists" crash
	var db *gorm.DB
	var err error
	for attempts := 1; attempts <= 5; attempts++ {
		db, err = gorm.Open(postgres.Open(dsn), &gorm.Config{
			PrepareStmt: false,
		})
		if err == nil {
			break
		}
		time.Sleep(1 * time.Second)
	}
	if err != nil {
		return fmt.Errorf("connect db: %w", err)
	}

	// High-performance connection pool configuration to prevent DB saturation
	if sqlDB, err := db.DB(); err == nil {
		sqlDB.SetMaxOpenConns(50)
		sqlDB.SetMaxIdleConns(25)
		sqlDB.SetConnMaxLifetime(5 * time.Minute)
		sqlDB.SetConnMaxIdleTime(2 * time.Minute)
	}

	// 2. FIXED: Added &model.Comment{} and &model.Device{} to migrate
	if err := db.AutoMigrate(
		&model.User{},
		&model.Resource{},
		&model.Connection{},
		&model.Track{},
		&model.Post{},  
		&model.Reel{},
		&model.ReelComment{},
		&model.ReelCommentLike{},
		&model.Comment{}, 
		&model.CommentLike{},
		&model.Follow{}, 
		&model.Like{}, 
		&model.Notification{},
		&model.Message{},
		&model.MessageReaction{},
		&model.Block{},
		&model.ConversationMute{},
		&model.Device{},
		&model.Community{},
		&model.CommunityMember{},
		&model.Report{},
		&model.AuditLog{},
		&model.Live{},
		&model.LiveRole{},
		&model.LiveBan{},
		&model.LiveReplay{},
	); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}

	// Live broadcast studio schema guarantees
	_ = db.Exec("CREATE TABLE IF NOT EXISTS lives (id bigserial PRIMARY KEY, host_id bigint NOT NULL, title text NOT NULL DEFAULT '', status varchar(20) NOT NULL DEFAULT 'live', started_at timestamptz DEFAULT NOW(), ended_at timestamptz NULL, chat_settings text DEFAULT '{\"chat_enabled\":true,\"slow_mode\":0,\"followers_only\":false,\"blocked_words\":[]}', notify_followers boolean DEFAULT true, save_replay boolean DEFAULT false, viewer_count int DEFAULT 0, total_reactions int DEFAULT 0, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW())").Error
	_ = db.Exec("CREATE INDEX IF NOT EXISTS idx_lives_status ON lives(status)").Error
	_ = db.Exec("CREATE INDEX IF NOT EXISTS idx_lives_started_at ON lives(started_at)").Error
	_ = db.Exec("CREATE INDEX IF NOT EXISTS idx_lives_host_id ON lives(host_id)").Error

	_ = db.Exec("CREATE TABLE IF NOT EXISTS live_roles (id bigserial PRIMARY KEY, live_id bigint NOT NULL, user_id bigint NOT NULL, role varchar(20) NOT NULL DEFAULT 'viewer', created_at timestamptz DEFAULT NOW())").Error
	_ = db.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_live_roles_unique ON live_roles(live_id, user_id)").Error

	_ = db.Exec("CREATE TABLE IF NOT EXISTS live_bans (id bigserial PRIMARY KEY, live_id bigint NOT NULL, user_id bigint NOT NULL, until timestamptz NULL, reason text DEFAULT '', created_at timestamptz DEFAULT NOW())").Error
	_ = db.Exec("CREATE INDEX IF NOT EXISTS idx_live_bans_lookup ON live_bans(live_id, user_id)").Error

	_ = db.Exec("CREATE TABLE IF NOT EXISTS live_replays (id bigserial PRIMARY KEY, live_id bigint NOT NULL, storage_path text DEFAULT '', status varchar(20) NOT NULL DEFAULT 'recording', post_id bigint NULL, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW())").Error
	_ = db.Exec("CREATE INDEX IF NOT EXISTS idx_live_replays_live_id ON live_replays(live_id)").Error
	_ = db.Exec("CREATE INDEX IF NOT EXISTS idx_live_replays_status ON live_replays(status)").Error
	_ = db.Exec("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS live_id bigint").Error
	_ = db.Exec("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS channel_id text").Error
	_ = db.Exec("CREATE INDEX IF NOT EXISTS idx_notifications_live_id ON notifications(live_id)").Error

	_ = db.Exec("CREATE TABLE IF NOT EXISTS reel_comments (id bigserial PRIMARY KEY, reel_id bigint NOT NULL, user_id bigint NOT NULL, content text NOT NULL, created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW())").Error
	_ = db.Exec("CREATE INDEX IF NOT EXISTS idx_reel_comments_reel_id ON reel_comments(reel_id)").Error
	_ = db.Exec("CREATE INDEX IF NOT EXISTS idx_reel_comments_user_id ON reel_comments(user_id)").Error

	// Comment replies and likes schema guarantees
	_ = db.Exec("ALTER TABLE comments ADD COLUMN IF NOT EXISTS parent_id bigint").Error
	_ = db.Exec("ALTER TABLE comments ADD COLUMN IF NOT EXISTS likes bigint DEFAULT 0").Error
	_ = db.Exec("CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id)").Error
	_ = db.Exec("CREATE TABLE IF NOT EXISTS comment_likes (id bigserial PRIMARY KEY, user_id bigint NOT NULL, comment_id bigint NOT NULL, created_at timestamptz DEFAULT NOW())").Error
	_ = db.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_comment_like ON comment_likes(user_id, comment_id)").Error

	_ = db.Exec("ALTER TABLE reel_comments ADD COLUMN IF NOT EXISTS parent_id bigint").Error
	_ = db.Exec("ALTER TABLE reel_comments ADD COLUMN IF NOT EXISTS likes bigint DEFAULT 0").Error
	_ = db.Exec("CREATE INDEX IF NOT EXISTS idx_reel_comments_parent_id ON reel_comments(parent_id)").Error
	_ = db.Exec("CREATE TABLE IF NOT EXISTS reel_comment_likes (id bigserial PRIMARY KEY, user_id bigint NOT NULL, reel_comment_id bigint NOT NULL, created_at timestamptz DEFAULT NOW())").Error
	_ = db.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_reel_comment_like ON reel_comment_likes(user_id, reel_comment_id)").Error

	// Ensure columns and defaults on posts, reels, communities, and community_members
	_ = db.Exec("ALTER TABLE posts ADD COLUMN IF NOT EXISTS music_track_id bigint").Error
	_ = db.Exec("ALTER TABLE posts ADD COLUMN IF NOT EXISTS music_source text").Error
	_ = db.Exec("ALTER TABLE posts ADD COLUMN IF NOT EXISTS music_url text").Error
	_ = db.Exec("ALTER TABLE posts ADD COLUMN IF NOT EXISTS music_title text").Error
	_ = db.Exec("ALTER TABLE posts ADD COLUMN IF NOT EXISTS music_artist text").Error
	_ = db.Exec("ALTER TABLE posts ADD COLUMN IF NOT EXISTS music_start_sec double precision DEFAULT 0").Error
	_ = db.Exec("ALTER TABLE posts ADD COLUMN IF NOT EXISTS mute_original boolean DEFAULT false").Error
	_ = db.Exec("ALTER TABLE posts ADD COLUMN IF NOT EXISTS music_volume double precision DEFAULT 1").Error
	_ = db.Exec("ALTER TABLE posts ADD COLUMN IF NOT EXISTS original_volume double precision DEFAULT 1").Error

	_ = db.Exec("ALTER TABLE reels ADD COLUMN IF NOT EXISTS music_track_id bigint").Error
	_ = db.Exec("ALTER TABLE reels ADD COLUMN IF NOT EXISTS music_source text").Error
	_ = db.Exec("ALTER TABLE reels ADD COLUMN IF NOT EXISTS music_url text").Error
	_ = db.Exec("ALTER TABLE reels ADD COLUMN IF NOT EXISTS music_title text").Error
	_ = db.Exec("ALTER TABLE reels ADD COLUMN IF NOT EXISTS music_artist text").Error
	_ = db.Exec("ALTER TABLE reels ADD COLUMN IF NOT EXISTS music_start_sec double precision DEFAULT 0").Error
	_ = db.Exec("ALTER TABLE reels ADD COLUMN IF NOT EXISTS mute_original boolean DEFAULT false").Error
	_ = db.Exec("ALTER TABLE reels ADD COLUMN IF NOT EXISTS music_volume double precision DEFAULT 1").Error
	_ = db.Exec("ALTER TABLE reels ADD COLUMN IF NOT EXISTS original_volume double precision DEFAULT 1").Error

	_ = db.Exec("ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_message_id bigint").Error

	_ = db.Exec("ALTER TABLE communities ADD COLUMN IF NOT EXISTS requires_approval boolean DEFAULT false").Error
	_ = db.Exec("CREATE TABLE IF NOT EXISTS community_members (id bigserial PRIMARY KEY, community_id bigint NOT NULL, user_id bigint NOT NULL, role varchar(20) DEFAULT 'member', status varchar(20) DEFAULT 'active', created_at timestamptz DEFAULT NOW(), updated_at timestamptz DEFAULT NOW())").Error
	_ = db.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_community_member_unique ON community_members (community_id, user_id)").Error

	// Admin system schema guarantees
	_ = db.Exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS role varchar(20) DEFAULT 'user'").Error
	_ = db.Exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS status varchar(20) DEFAULT 'active'").Error
	_ = db.Exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_until timestamptz NULL").Error
	_ = db.Exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS status_reason text DEFAULT ''").Error
	_ = db.Exec("UPDATE users SET role = 'user' WHERE role IS NULL OR role = ''").Error
	_ = db.Exec("UPDATE users SET status = 'active' WHERE status IS NULL OR status = ''").Error
	_ = db.Exec("CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)").Error
	_ = db.Exec("CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)").Error

	_ = db.Exec("ALTER TABLE posts ADD COLUMN IF NOT EXISTS hidden_at timestamptz NULL").Error
	_ = db.Exec("ALTER TABLE posts ADD COLUMN IF NOT EXISTS hidden_by bigint NULL").Error
	_ = db.Exec("CREATE INDEX IF NOT EXISTS idx_posts_hidden_at ON posts(hidden_at)").Error

	_ = db.Exec("ALTER TABLE comments ADD COLUMN IF NOT EXISTS hidden_at timestamptz NULL").Error
	_ = db.Exec("ALTER TABLE comments ADD COLUMN IF NOT EXISTS hidden_by bigint NULL").Error
	_ = db.Exec("CREATE INDEX IF NOT EXISTS idx_comments_hidden_at ON comments(hidden_at)").Error

	_ = db.Exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_report_per_user_target ON reports(reporter_id, target_type, target_id) WHERE status = 'open'").Error

	// Optional initial super_admin provisioning via environment variable
	if initialAdmin := strings.TrimSpace(os.Getenv("INITIAL_SUPER_ADMIN")); initialAdmin != "" {
		res := db.Model(&model.User{}).
			Where("LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)", initialAdmin, initialAdmin).
			Updates(map[string]interface{}{
				"role":   "super_admin",
				"status": "active",
			})
		if res.RowsAffected > 0 {
			fmt.Printf("✅ Initial super_admin active for: %s\n", initialAdmin)
		}
	}
	// Automatically seed the creator of each community as its admin
	_ = db.Exec(`
		INSERT INTO community_members (community_id, user_id, role, status, created_at, updated_at)
		SELECT c.id, c.created_by_id, 'admin', 'active', NOW(), NOW()
		FROM communities c
		WHERE c.created_by_id > 0
		ON CONFLICT (community_id, user_id) DO NOTHING
	`).Error

	// Seed initial royalty-free music tracks if empty
	if err := seed.SeedTracks(db); err != nil {
		fmt.Printf("warning: seed tracks: %v\n", err)
	}

	r := gin.Default()
	// Allow large file uploads (up to 100 MiB) without dropping connections
	r.MaxMultipartMemory = 100 << 20

	corsConfig := cors.DefaultConfig()
	corsConfig.AllowAllOrigins = true
	corsConfig.AllowHeaders = []string{"Origin", "Content-Type", "Authorization", "Accept", "X-Requested-With", "Range"}
	corsConfig.AllowMethods = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
	r.Use(cors.New(corsConfig))

	// Push service for native wake-up (FCM / APNs PushKit)
	pushSvc := push.NewPushService(db)

	// WebSocket Hub
	hub := ws.NewHub()

	// handler
	h := handlers.NewHandler(db, hub, pushSvc)
	hub.OnCallSignal = h.HandleCallSignalHook
	hub.OnGroupCallStart = h.HandleGroupCallStartHook
	go hub.Run()

	h.RegisterRoutes(r)

	// Direct robust static routes for APK and QR code
	serveAPK := func(c *gin.Context, filename string) {
		candidates := []string{
			"./frontend/dist/Nesty.apk", "./frontend/public/Nesty.apk", "./Nesty.apk",
			"./frontend/dist/DevNest.apk", "./frontend/public/DevNest.apk", "./DevNest.apk",
		}
		for _, p := range candidates {
			if _, err := os.Stat(p); err == nil {
				c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))
				c.File(p)
				return
			}
		}
		c.JSON(http.StatusNotFound, gin.H{"error": "APK not found"})
	}

	r.GET("/Nesty.apk", func(c *gin.Context) { serveAPK(c, "Nesty.apk") })
	r.HEAD("/Nesty.apk", func(c *gin.Context) { serveAPK(c, "Nesty.apk") })
	r.GET("/DevNest.apk", func(c *gin.Context) { serveAPK(c, "Nesty.apk") })
	r.HEAD("/DevNest.apk", func(c *gin.Context) { serveAPK(c, "Nesty.apk") })

	r.GET("/devnest-apk-qr.png", func(c *gin.Context) {
		candidates := []string{"./frontend/dist/devnest-apk-qr.png", "./frontend/public/devnest-apk-qr.png", "./devnest-apk-qr.png"}
		for _, p := range candidates {
			if _, err := os.Stat(p); err == nil {
				c.File(p)
				return
			}
		}
		c.JSON(http.StatusNotFound, gin.H{"error": "devnest-apk-qr.png not found"})
	})
	r.GET("/nesty-apk-qr.png", func(c *gin.Context) {
		candidates := []string{"./frontend/dist/nesty-apk-qr.png", "./frontend/public/nesty-apk-qr.png", "./nesty-apk-qr.png", "./frontend/dist/devnest-apk-qr.png"}
		for _, p := range candidates {
			if _, err := os.Stat(p); err == nil {
				c.File(p)
				return
			}
		}
		c.JSON(http.StatusNotFound, gin.H{"error": "nesty-apk-qr.png not found"})
	})

	// Serve static frontend if dist exists (e.g. production deployment on Render)
	distPath := "./frontend/dist"
	if _, err := os.Stat(distPath); err == nil {
		r.Static("/assets", distPath+"/assets")
		r.StaticFile("/favicon.svg", distPath+"/favicon.svg")
		r.StaticFile("/nesty-logo.png", distPath+"/nesty-logo.png")

		r.NoRoute(func(c *gin.Context) {
			path := c.Request.URL.Path
			if strings.HasPrefix(path, "/api") || strings.HasPrefix(path, "/ws") {
				c.JSON(http.StatusNotFound, gin.H{"error": "route not found"})
				return
			}
			c.File(distPath + "/index.html")
		})
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	return r.Run(":" + port)
}