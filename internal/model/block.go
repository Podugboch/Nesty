package model

import (
	"time"
)

type Block struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	BlockerID uint      `gorm:"not null;uniqueIndex:idx_blocker_blocked,priority:1" json:"blocker_id"`
	BlockedID uint      `gorm:"not null;uniqueIndex:idx_blocker_blocked,priority:2" json:"blocked_id"`
	CreatedAt time.Time `json:"created_at"`
	Blocked   *User     `gorm:"foreignKey:BlockedID" json:"blocked_user,omitempty"`
}

type ConversationMute struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    uint      `gorm:"not null;uniqueIndex:idx_user_mute,priority:1" json:"user_id"`
	PartnerID uint      `gorm:"not null;uniqueIndex:idx_user_mute,priority:2" json:"partner_id"`
	CreatedAt time.Time `json:"created_at"`
}
