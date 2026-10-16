package model

import "time"

type AuditLog struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	AdminID    uint      `gorm:"index;not null" json:"admin_id"`
	Admin      *User     `gorm:"foreignKey:AdminID" json:"admin,omitempty"`
	Action     string    `gorm:"size:50;index;not null" json:"action"`
	TargetType string    `gorm:"size:20;index" json:"target_type"`
	TargetID   uint      `gorm:"index" json:"target_id"`
	Reason     string    `json:"reason"`
	Metadata   string    `gorm:"type:text" json:"metadata"` // JSON string representation
	CreatedAt  time.Time `gorm:"index" json:"created_at"`
}
