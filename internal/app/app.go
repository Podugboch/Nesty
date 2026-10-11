package app

import (
	"fmt"
	"os"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"piscine-devnest/internal/handlers"
	"piscine-devnest/internal/model"
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
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		PrepareStmt: false, 
	})
	if err != nil {
		return fmt.Errorf("connect db: %w", err)
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
		&model.Message{},
	); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}

	r := gin.Default()

	r.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"http://localhost:5173"},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
	}))

	// WebSocket Hub
	hub := ws.NewHub()
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