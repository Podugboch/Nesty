package model

import "gorm.io/gorm"

type Message struct {
	gorm.Model

	SenderID    uint   `json:"sender_id" gorm:"not null;index"`
	RecipientID uint   `json:"recipient_id" gorm:"not null;index"`
	Content     string `json:"content" gorm:"type:text;not null"`
}
