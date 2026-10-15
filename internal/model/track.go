package model

import "time"

type Track struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	Title       string    `gorm:"not null;index" json:"title"`
	Artist      string    `gorm:"not null;index" json:"artist"`
	AudioURL    string    `gorm:"not null" json:"audio_url"`
	CoverURL    *string   `json:"cover_url"`
	DurationSec int       `gorm:"not null;default:0" json:"duration_sec"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}
