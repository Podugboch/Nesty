package model

import (
	"encoding/json"
	"time"
)

// ChatSettings represents real-time chat configuration for an active broadcast
type ChatSettings struct {
	ChatEnabled   bool     `json:"chat_enabled"`
	SlowMode      int      `json:"slow_mode"` // 0 = off, 5, 15, 30 seconds
	FollowersOnly bool     `json:"followers_only"`
	BlockedWords  []string `json:"blocked_words"`
}

// Live represents a live broadcast stream
type Live struct {
	ID              uint       `gorm:"primaryKey" json:"id"`
	HostID          uint       `gorm:"index;not null" json:"host_id"`
	Host            *User      `gorm:"foreignKey:HostID" json:"host,omitempty"`
	Title           string     `gorm:"not null;default:''" json:"title"`
	Status          string     `gorm:"size:20;default:'live';index" json:"status"` // "live", "ended"
	StartedAt       time.Time  `gorm:"index" json:"started_at"`
	EndedAt         *time.Time `json:"ended_at,omitempty"`
	ChatSettingsRaw string     `gorm:"column:chat_settings;type:text" json:"-"`
	NotifyFollowers bool       `gorm:"default:true" json:"notify_followers"`
	SaveReplay      bool       `gorm:"default:false" json:"save_replay"`
	ViewerCount     int        `gorm:"default:0" json:"viewer_count"`
	TotalReactions  int        `gorm:"default:0" json:"total_reactions"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`

	// Parsed chat settings exposed to JSON
	ParsedChatSettings *ChatSettings `gorm:"-" json:"chat_settings,omitempty"`
}

func (l *Live) GetChatSettings() ChatSettings {
	if l.ParsedChatSettings != nil {
		if l.ParsedChatSettings.BlockedWords == nil {
			l.ParsedChatSettings.BlockedWords = []string{}
		}
		return *l.ParsedChatSettings
	}
	var cs ChatSettings
	cs.ChatEnabled = true
	cs.BlockedWords = []string{}
	if l.ChatSettingsRaw != "" {
		_ = json.Unmarshal([]byte(l.ChatSettingsRaw), &cs)
	}
	if cs.BlockedWords == nil {
		cs.BlockedWords = []string{}
	}
	return cs
}

func (l *Live) SetChatSettings(cs ChatSettings) {
	bytes, err := json.Marshal(cs)
	if err == nil {
		l.ChatSettingsRaw = string(bytes)
		l.ParsedChatSettings = &cs
	}
}

// LiveRole tracks roles within a live: "host", "moderator", "guest", "viewer"
type LiveRole struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	LiveID    uint      `gorm:"index;not null" json:"live_id"`
	UserID    uint      `gorm:"index;not null" json:"user_id"`
	Role      string    `gorm:"size:20;not null;default:'viewer'" json:"role"`
	User      *User     `gorm:"foreignKey:UserID" json:"user,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// LiveBan tracks temporary timeouts or permanent bans from a specific live
type LiveBan struct {
	ID        uint       `gorm:"primaryKey" json:"id"`
	LiveID    uint       `gorm:"index;not null" json:"live_id"`
	UserID    uint       `gorm:"index;not null" json:"user_id"`
	Until     *time.Time `json:"until,omitempty"` // nil = permanent ban from this live
	Reason    string     `json:"reason"`
	CreatedAt time.Time  `json:"created_at"`
}

// LiveReplay tracks chunked recording uploads and published replay post
type LiveReplay struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	LiveID      uint      `gorm:"index;not null" json:"live_id"`
	StoragePath string    `gorm:"type:text" json:"storage_path"`
	Status      string    `gorm:"size:20;default:'recording';index" json:"status"` // "recording", "ready", "published", "discarded"
	PostID      *uint     `gorm:"index" json:"post_id,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}
