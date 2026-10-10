package model

import (
    "time"
)

type Comment struct {
    ID        uint      `gorm:"primaryKey" json:"id"`
    PostID    uint      `gorm:"index;constraint:OnDelete:CASCADE" json:"post_id"`
    UserID    uint      `gorm:"index" json:"user_id"`
    User      *User     `gorm:"foreignKey:UserID" json:"user"` 
    Content   string    `gorm:"not null" json:"content"`
    CreatedAt time.Time `json:"created_at"`
}

type Post struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    uint      `gorm:"index" json:"user_id"`
	User      *User     `gorm:"foreignKey:UserID" json:"user"`
	Content   string    `json:"content"`
	MediaURL  string    `json:"media_url"`
	Community string    `gorm:"default:'general';index" json:"community"`
	Likes     int64     `gorm:"default:0" json:"likes"`
	LikedByMe bool      `gorm:"-" json:"liked_by_me"` 
	Comments  []Comment `gorm:"foreignKey:PostID" json:"comments"`
	CreatedAt time.Time `json:"created_at"`
	ParentID  *uint     `json:"parent_id"`
	Parent    *Post     `json:"parent" gorm:"foreignKey:ParentID"`
}