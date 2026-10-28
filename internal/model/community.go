package model

import "time"

type Community struct {
	ID               uint              `gorm:"primaryKey" json:"id"`
	Name             string            `gorm:"not null" json:"name"`
	Slug             string            `gorm:"uniqueIndex;not null" json:"slug"`
	Description      string            `json:"description"`
	BadgeClass       string            `json:"badge_class"`
	BannerURL        string            `json:"banner_url"`
	RequiresApproval bool              `gorm:"default:false" json:"requires_approval"`
	CreatedByID      uint              `json:"created_by_id"`
	CreatedBy        *User             `gorm:"-" json:"created_by,omitempty"`
	Members          []CommunityMember `gorm:"foreignKey:CommunityID;constraint:OnDelete:CASCADE" json:"members,omitempty"`
	MemberCount      int64             `gorm:"-" json:"member_count"`
	CurrentUserRole  string            `gorm:"-" json:"current_user_role,omitempty"` // "admin", "co_admin", "member", "pending", "none"
	CreatedAt        time.Time         `json:"created_at"`
	UpdatedAt        time.Time         `json:"updated_at"`
}

type CommunityMember struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	CommunityID uint      `gorm:"index;not null" json:"community_id"`
	UserID      uint      `gorm:"index;not null" json:"user_id"`
	User        *User     `gorm:"foreignKey:UserID" json:"user,omitempty"`
	Role        string    `gorm:"type:varchar(20);default:'member'" json:"role"` // "admin", "co_admin", "member"
	Status      string    `gorm:"type:varchar(20);default:'active'" json:"status"` // "active", "pending"
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}
