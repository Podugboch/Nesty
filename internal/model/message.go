package model

import (
	"time"

	"gorm.io/gorm"
)

type MessageReaction struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	MessageID uint      `gorm:"not null;uniqueIndex:idx_msg_user_reaction,priority:1;constraint:OnDelete:CASCADE" json:"message_id"`
	UserID    uint      `gorm:"not null;uniqueIndex:idx_msg_user_reaction,priority:2" json:"user_id"`
	Emoji     string    `gorm:"type:varchar(16);not null" json:"emoji"`
	CreatedAt time.Time `json:"created_at"`
}

type QuotedMessage struct {
	ID         uint   `json:"id"`
	SenderID   uint   `json:"sender_id"`
	Username   string `json:"username"`
	SenderName string `json:"sender_name"`
	Content    string `json:"content"`
	MediaURL   string `json:"media_url,omitempty"`
	MediaType  string `json:"media_type,omitempty"`
	IsDeleted  bool   `json:"is_deleted"`
}

type Message struct {
	ID        uint           `gorm:"primaryKey" json:"id"`
	CreatedAt time.Time      `json:"created_at" gorm:"index:idx_msg_sender_created,priority:2;index:idx_msg_recipient_created,priority:2"`
	UpdatedAt time.Time      `json:"updated_at,omitempty"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"deleted_at,omitempty"`

	SenderID         uint              `json:"sender_id" gorm:"not null;index;index:idx_msg_sender_created,priority:1"`
	RecipientID      uint              `json:"recipient_id" gorm:"not null;index;index:idx_msg_recipient_created,priority:1"`
	Content          string            `json:"content" gorm:"type:text"`
	MediaURL         string            `json:"media_url,omitempty"`
	MediaType        string            `json:"media_type,omitempty"` // "image", "video", "audio", "document"
	FileName         string            `json:"file_name,omitempty"`
	FileSize         int64             `json:"file_size,omitempty"`
	IsDelivered      bool              `gorm:"default:false;index" json:"is_delivered"`
	DeliveredAt      *time.Time        `json:"delivered_at,omitempty"`
	IsRead           bool              `gorm:"default:false;index" json:"is_read"`
	ReadAt           *time.Time        `json:"read_at,omitempty"`
	EditedAt         *time.Time        `json:"edited_at,omitempty"`
	ReplyToMessageID *uint             `json:"reply_to_message_id,omitempty" gorm:"index"`
	ReplyToMessage   *QuotedMessage    `json:"reply_to_message,omitempty" gorm:"-"`
	Reactions        []MessageReaction `gorm:"foreignKey:MessageID;constraint:OnDelete:CASCADE" json:"reactions,omitempty"`
}
