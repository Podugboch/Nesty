package model

import (
	"time"

	"gorm.io/gorm"
)

type User struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	Username string `gorm:"uniqueIndex;not null" json:"username"`
	Email    string `gorm:"uniqueIndex;not null" json:"email"`
	Password string `gorm:"not null" json:"-"`

	Name      string `json:"name"`
	Bio       string `json:"bio"`
	Skills    string `json:"skills"`
	Batch     string `json:"batch"`
	Location   string     `json:"location"`
	AvatarURL  string     `json:"avatar_url"`
	BannerURL  string     `json:"banner_url"`
	LastSeenAt *time.Time `gorm:"index" json:"last_seen_at,omitempty"`
}