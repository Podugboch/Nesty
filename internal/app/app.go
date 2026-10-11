package app

import (
	"fmt"
	"net/http"
	"os"
	"strings"

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

	corsConfig := cors.DefaultConfig()
	corsConfig.AllowAllOrigins = true
	corsConfig.AllowHeaders = []string{"Origin", "Content-Type", "Authorization", "Accept"}
	corsConfig.AllowMethods = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
	r.Use(cors.New(corsConfig))

	// WebSocket Hub
	hub := ws.NewHub()
	go hub.Run()

	// handler
	h := handlers.NewHandler(db, hub)

	h.RegisterRoutes(r)

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