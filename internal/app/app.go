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
		&model.Comment{}, 
		&model.Follow{}, 
		&model.Like{}, 
		&model.Notification{},
		&model.Message{},
		&model.Device{},
		&model.Community{},
	); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}

	// Ensure columns and defaults on posts and reels in case existing tables missed them
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

	// Seed initial royalty-free music tracks if empty
	if err := seed.SeedTracks(db); err != nil {
		fmt.Printf("warning: seed tracks: %v\n", err)
	}

	r := gin.Default()

	corsConfig := cors.DefaultConfig()
	corsConfig.AllowAllOrigins = true
	corsConfig.AllowHeaders = []string{"Origin", "Content-Type", "Authorization", "Accept"}
	corsConfig.AllowMethods = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
	r.Use(cors.New(corsConfig))

	// Push service for native wake-up (FCM / APNs PushKit)
	pushSvc := push.NewPushService(db)

	// WebSocket Hub
	hub := ws.NewHub()

	// handler
	h := handlers.NewHandler(db, hub, pushSvc)
	hub.OnCallSignal = h.HandleCallSignalHook
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
	r.GET("/DevNest.apk", func(c *gin.Context) { serveAPK(c, "Nesty.apk") })

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