package model

import "time"

type Community struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	Name        string    `gorm:"not null" json:"name"`
	Slug        string    `gorm:"uniqueIndex;not null" json:"slug"`
	Description string    `json:"description"`
	BadgeClass  string    `json:"badge_class"`
	CreatedByID uint      `json:"created_by_id"`
	CreatedBy   *User     `gorm:"-" json:"created_by,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}
