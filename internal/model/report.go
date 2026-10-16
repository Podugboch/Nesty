package model

import "time"

type Report struct {
	ID         uint       `gorm:"primaryKey" json:"id"`
	ReporterID uint       `gorm:"index;not null" json:"reporter_id"`
	Reporter   *User      `gorm:"foreignKey:ReporterID" json:"reporter,omitempty"`
	TargetType string     `gorm:"size:20;index;not null" json:"target_type"` // "post", "comment", "user"
	TargetID   uint       `gorm:"index;not null" json:"target_id"`
	Reason     string     `gorm:"size:50;not null" json:"reason"`            // "spam", "harassment", "hate", "nudity", "violence", "scam", "other"
	Note       string     `json:"note"`
	Status     string     `gorm:"size:20;default:'open';index" json:"status"` // "open", "resolved", "dismissed"
	ResolvedBy *uint      `gorm:"index" json:"resolved_by,omitempty"`
	Resolver   *User      `gorm:"foreignKey:ResolvedBy" json:"resolver,omitempty"`
	Resolution string     `gorm:"size:50" json:"resolution,omitempty"`        // "dismissed", "remove_content", "suspend_user", "ban_user"
	CreatedAt  time.Time  `gorm:"index" json:"created_at"`
	ResolvedAt *time.Time `json:"resolved_at,omitempty"`

	// Target preview helpers populated for moderation UI
	TargetContent  string `gorm:"-" json:"target_content,omitempty"`
	TargetAuthor   string `gorm:"-" json:"target_author,omitempty"`
	TargetAuthorID uint   `gorm:"-" json:"target_author_id,omitempty"`
	TargetDetails  string `gorm:"-" json:"target_details,omitempty"`
}
