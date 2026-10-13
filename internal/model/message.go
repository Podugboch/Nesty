package model

import (
	"time"

	"gorm.io/gorm"
)

type Message struct {
	ID        uint           `gorm:"primaryKey" json:"id"`
	CreatedAt time.Time      `json:"created_at" gorm:"index:idx_msg_sender_created,priority:2;index:idx_msg_recipient_created,priority:2"`
	UpdatedAt time.Time      `json:"updated_at,omitempty"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"deleted_at,omitempty"`

	SenderID    uint   `json:"sender_id" gorm:"not null;index;index:idx_msg_sender_created,priority:1"`
	RecipientID uint   `json:"recipient_id" gorm:"not null;index;index:idx_msg_recipient_created,priority:1"`
	Content     string `json:"content" gorm:"type:text"`
	MediaURL    string `json:"media_url,omitempty"`
	MediaType   string `json:"media_type,omitempty"` // "image", "video", "audio", "document"
	FileName    string `json:"file_name,omitempty"`
	FileSize    int64  `json:"file_size,omitempty"`
}
