package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"piscine-devnest/internal/app"
	"piscine-devnest/internal/model"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("no .env file found")
	}

	superAdminFlag := flag.String("make-super-admin", "", "Email or username of the user to promote to super_admin")
	flag.Parse()

	if *superAdminFlag != "" {
		identifier := strings.TrimSpace(*superAdminFlag)
		dsn := os.Getenv("DATABASE_URL")
		if dsn == "" {
			log.Fatal("DATABASE_URL is not set")
		}
		db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
		if err != nil {
			log.Fatalf("failed to connect to database: %v", err)
		}
		res := db.Model(&model.User{}).
			Where("LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)", identifier, identifier).
			Updates(map[string]interface{}{
				"role":   "super_admin",
				"status": "active",
			})
		if res.Error != nil {
			log.Fatalf("failed to update user role: %v", res.Error)
		}
		if res.RowsAffected == 0 {
			log.Fatalf("no user found with email or username '%s'", identifier)
		}
		fmt.Printf("✅ Successfully promoted '%s' to super_admin.\n", identifier)
		os.Exit(0)
	}

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
