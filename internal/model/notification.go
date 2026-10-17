package model

import "time"

// Notification represents a single alert delivered to UserID, triggered by
// ActorID doing something (like, comment, follow). PostID is set for
// like/comment notifications and nil for follows.
type Notification struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    uint      `gorm:"index;not null;index:idx_notif_user_read,priority:1" json:"user_id"`
	ActorID   uint      `gorm:"not null" json:"actor_id"`
	Actor     *User     `gorm:"foreignKey:ActorID" json:"actor"`
	Type      string    `gorm:"not null" json:"type"` // "like" | "comment" | "follow" | "repost" | "mention" | "message" | "missed_call" | "missed_video_call" | "live_started" | "community_call"
	PostID    *uint     `json:"post_id,omitempty"`
	LiveID    *uint     `json:"live_id,omitempty"`
	ChannelID string    `gorm:"size:100" json:"channel_id,omitempty"`
	Read      bool      `gorm:"default:false;index:idx_notif_user_read,priority:2" json:"read"`
	CreatedAt time.Time `gorm:"index:idx_notif_user_read,priority:3" json:"created_at"`
}