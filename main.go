package main

import (
	"log"

	"github.com/joho/godotenv"
	"piscine-devnest/internal/app"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("no .env file found")
	}

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}

