package model

import "time"

type Reel struct {
	ID             uint          `gorm:"primaryKey" json:"id"`
	UserID         uint          `gorm:"index" json:"user_id"`
	User           *User         `gorm:"foreignKey:UserID" json:"user"`
	VideoURL       string        `gorm:"not null" json:"video_url"`
	Caption        string        `json:"caption"`
	Likes          int64         `gorm:"default:0" json:"likes"`
	LikedByMe      bool          `gorm:"-" json:"liked_by_me"`
	CommentsCount  int64         `gorm:"default:0" json:"comments_count"`
	MusicTrackID   *uint         `gorm:"index" json:"music_track_id"`
	MusicTrack     *Track        `gorm:"foreignKey:MusicTrackID" json:"music_track,omitempty"`
	MusicSource    string        `json:"music_source"` // "jamendo", "device", "library"
	MusicURL       string        `json:"music_url"`
	MusicTitle     string        `json:"music_title"`
	MusicArtist    string        `json:"music_artist"`
	MusicStartSec  float64       `gorm:"default:0" json:"music_start_sec"`
	MuteOriginal   bool          `gorm:"default:false" json:"mute_original"`
	MusicVolume    float64       `gorm:"default:1" json:"music_volume"`
	OriginalVolume float64       `gorm:"default:1" json:"original_volume"`
	Comments       []ReelComment `gorm:"foreignKey:ReelID" json:"comments,omitempty"`
	CreatedAt      time.Time     `json:"created_at"`
	UpdatedAt      time.Time     `json:"updated_at"`
}

type ReelComment struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	ReelID    uint      `gorm:"index;not null" json:"reel_id"`
	UserID    uint      `gorm:"index;not null" json:"user_id"`
	User      *User     `gorm:"foreignKey:UserID" json:"user"`
	Content   string    `gorm:"not null" json:"content"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
