package model

import "time"

// Notification represents a single alert delivered to UserID, triggered by
// ActorID doing something (like, comment, follow). PostID is set for
// like/comment notifications and nil for follows.
type Notification struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    uint      `gorm:"index;not null" json:"user_id"`
	ActorID   uint      `gorm:"not null" json:"actor_id"`
	Actor     *User     `gorm:"foreignKey:ActorID" json:"actor"`
	Type      string    `gorm:"not null" json:"type"` // "like" | "comment" | "follow" | "repost" | "mention" | "message" | "missed_call" | "missed_video_call"
	PostID    *uint     `json:"post_id,omitempty"`
	Read      bool      `gorm:"default:false" json:"read"`
	CreatedAt time.Time `json:"created_at"`
}