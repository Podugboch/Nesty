package model

import "gorm.io/gorm"

type Message struct {
	gorm.Model

	SenderID    uint   `json:"sender_id" gorm:"not null;index"`
	RecipientID uint   `json:"recipient_id" gorm:"not null;index"`
	Content     string `json:"content" gorm:"type:text"`
	MediaURL    string `json:"media_url,omitempty"`
	MediaType   string `json:"media_type,omitempty"` // "image", "video", "audio", "document"
	FileName    string `json:"file_name,omitempty"`
	FileSize    int64  `json:"file_size,omitempty"`
}
