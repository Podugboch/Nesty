package model

import (
	"time"

	"gorm.io/gorm"
)

type Device struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`

	UserID    uint   `gorm:"index;not null" json:"user_id"`
	Token     string `gorm:"uniqueIndex;not null" json:"token"`
	Platform  string `gorm:"not null" json:"platform"` // "android", "ios", "web"
	VoipToken string `json:"voip_token"`               // iOS PushKit VoIP token
}
