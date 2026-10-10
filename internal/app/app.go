package app

import (
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"piscine-devnest/internal/handlers"
	"piscine-devnest/internal/model"
	"piscine-devnest/internal/ws"
)

func Run() error {
	dsn := os.Getenv("DATABASE_URL")
	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		jwtSecret = "dev-secret"
	}

	var db *gorm.DB
	var err error

	if dsn == "" || strings.HasPrefix(dsn, "sqlite") {
		dbPath := "devnest.db"
		if strings.HasPrefix(dsn, "sqlite://") {
			dbPath = strings.TrimPrefix(dsn, "sqlite://")
		} else if strings.HasPrefix(dsn, "sqlite:") {
			dbPath = strings.TrimPrefix(dsn, "sqlite:")
		}
		log.Printf("Using local SQLite database: %s", dbPath)
		db, err = gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
		if err != nil {
			return fmt.Errorf("connect sqlite: %w", err)
		}
	} else {
		log.Println("Attempting to connect to PostgreSQL...")
		db, err = gorm.Open(postgres.Open(dsn), &gorm.Config{
			PrepareStmt: false,
		})

		var pingErr error
		if err == nil {
			sqlDB, dbErr := db.DB()
			if dbErr != nil {
				pingErr = dbErr
			} else {
				pingErr = sqlDB.Ping()
			}
		}

		if err != nil || pingErr != nil {
			connErr := err
			if connErr == nil {
				connErr = pingErr
			}
			log.Printf("[WARN] Could not connect to PostgreSQL (%v).", connErr)
			log.Println("[INFO] Falling back to local SQLite (devnest.db) for smooth localhost development.")
			db, err = gorm.Open(sqlite.Open("devnest.db"), &gorm.Config{})
			if err != nil {
				return fmt.Errorf("connect fallback sqlite: %w", err)
			}
		} else {
			log.Println("Connected to PostgreSQL successfully.")
		}
	}

	// 2. FIXED: Added &model.Comment{} to migrate and create the missing table (fixes SQLSTATE 42P01)
	if err := db.AutoMigrate(
		&model.User{},
		&model.Resource{},
		&model.Connection{},
		&model.Post{},  
		&model.Comment{}, 
		&model.Follow{}, 
		&model.Like{}, 
		&model.Notification{}, 
		&model.Message{},// 👈 Added this line
	); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}

	r := gin.Default()

	r.Use(cors.New(cors.Config{
		AllowOriginFunc: func(origin string) bool {
			return true // Seamless CORS support across localhost, 127.0.0.1, LAN IPs, and tunnels
		},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
	}))

	// WebSocket Hub
	hub := ws.NewHub(db)
	go hub.Run()

	// handler
	h := handlers.NewHandler(db, hub)

	h.RegisterRoutes(r)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	return r.Run(":" + port)
}