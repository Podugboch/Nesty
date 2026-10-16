package model

import (
	"time"
)

type Comment struct {
	ID        uint       `gorm:"primaryKey" json:"id"`
	PostID    uint       `gorm:"index;constraint:OnDelete:CASCADE" json:"post_id"`
	UserID    uint       `gorm:"index" json:"user_id"`
	User      *User      `gorm:"foreignKey:UserID" json:"user"`
	Content   string     `gorm:"not null" json:"content"`
	ParentID  *uint      `gorm:"index" json:"parent_id,omitempty"`
	Likes     int64      `gorm:"default:0" json:"likes"`
	LikedByMe bool       `gorm:"-" json:"liked_by_me"`
	CreatedAt time.Time  `json:"created_at"`
	HiddenAt  *time.Time `gorm:"index" json:"hidden_at,omitempty"`
	HiddenBy  *uint      `json:"hidden_by,omitempty"`
}

type CommentLike struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    uint      `gorm:"not null;index:idx_user_comment_like,unique" json:"user_id"`
	CommentID uint      `gorm:"not null;index:idx_user_comment_like,unique;constraint:OnDelete:CASCADE" json:"comment_id"`
	CreatedAt time.Time `json:"created_at"`
}

type Post struct {
	ID             uint       `gorm:"primaryKey" json:"id"`
	UserID         uint       `gorm:"index" json:"user_id"`
	User           *User      `gorm:"foreignKey:UserID" json:"user"`
	Content        string     `json:"content"`
	MediaURL       string     `json:"media_url"`
	Community      string     `gorm:"default:'general';index" json:"community"`
	Likes          int64      `gorm:"default:0" json:"likes"`
	CommentsCount  int64      `gorm:"default:0" json:"comments_count"`
	LikedByMe      bool       `gorm:"-" json:"liked_by_me"`
	Comments       []Comment  `gorm:"foreignKey:PostID" json:"comments"`
	CreatedAt      time.Time  `json:"created_at"`
	ParentID       *uint      `json:"parent_id"`
	Parent         *Post      `json:"parent" gorm:"foreignKey:ParentID"`
	MusicTrackID   *uint      `gorm:"index" json:"music_track_id"`
	MusicTrack     *Track     `gorm:"foreignKey:MusicTrackID" json:"music_track,omitempty"`
	MusicSource    string     `json:"music_source"` // "jamendo", "device", "library"
	MusicURL       string     `json:"music_url"`
	MusicTitle     string     `json:"music_title"`
	MusicArtist    string     `json:"music_artist"`
	MusicStartSec  float64    `gorm:"default:0" json:"music_start_sec"`
	MuteOriginal   bool       `gorm:"default:false" json:"mute_original"`
	MusicVolume    float64    `gorm:"default:1" json:"music_volume"`
	OriginalVolume float64    `gorm:"default:1" json:"original_volume"`
	HiddenAt       *time.Time `gorm:"index" json:"hidden_at,omitempty"`
	HiddenBy       *uint      `json:"hidden_by,omitempty"`
}