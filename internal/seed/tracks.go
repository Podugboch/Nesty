package seed

import (
	"log"

	"gorm.io/gorm"
	"piscine-devnest/internal/model"
)

// ============================================================================
// ROYALTY-FREE MUSIC SEED FILE FOR NESTY
// ============================================================================
// To replace placeholder tracks with your own royalty-free audio files:
// 1. Upload your audio files (e.g. .mp3, .ogg, .wav) to Supabase Storage,
//    an S3 bucket, CDN, or host them under /frontend/public/audio/.
// 2. Update or append entries in the DefaultRoyaltyFreeTracks slice below.
// 3. Audio files must be accessible via public CORS-enabled HTTP/HTTPS URLs.
// ============================================================================

func ptrString(s string) *string {
	return &s
}

var DefaultRoyaltyFreeTracks = []model.Track{
	{
		Title:       "Coffee Shop Deep Focus",
		Artist:      "Nesty Beats",
		AudioURL:    "https://actions.google.com/sounds/v1/ambiences/coffee_shop.ogg",
		CoverURL:    ptrString("https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=400&auto=format&fit=crop&q=80"),
		DurationSec: 165,
	},
	{
		Title:       "Rainy Night Coding",
		Artist:      "Sarah Chen",
		AudioURL:    "https://actions.google.com/sounds/v1/weather/light_rain.ogg",
		CoverURL:    ptrString("https://images.unsplash.com/photo-1515694346937-94d85e41e6f0?w=400&auto=format&fit=crop&q=80"),
		DurationSec: 190,
	},
	{
		Title:       "Synthwave Pulse 1984",
		Artist:      "Alex Synth",
		AudioURL:    "https://actions.google.com/sounds/v1/science_fiction/scifi_pulse.ogg",
		CoverURL:    ptrString("https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=400&auto=format&fit=crop&q=80"),
		DurationSec: 170,
	},
	{
		Title:       "Melodic Harmony Groove",
		Artist:      "SoundHelix",
		AudioURL:    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
		CoverURL:    ptrString("https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&auto=format&fit=crop&q=80"),
		DurationSec: 372,
	},
	{
		Title:       "Electronic Uplift Energy",
		Artist:      "Cyber Sound",
		AudioURL:    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
		CoverURL:    ptrString("https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=400&auto=format&fit=crop&q=80"),
		DurationSec: 425,
	},
	{
		Title:       "Midnight Acoustic Journey",
		Artist:      "Leo Guitar",
		AudioURL:    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
		CoverURL:    ptrString("https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=400&auto=format&fit=crop&q=80"),
		DurationSec: 342,
	},
	{
		Title:       "Deep Space Bassline",
		Artist:      "Cloud Nine",
		AudioURL:    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3",
		CoverURL:    ptrString("https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=400&auto=format&fit=crop&q=80"),
		DurationSec: 302,
	},
	{
		Title:       "Atmospheric Lo-Fi Breeze",
		Artist:      "Urban Chill",
		AudioURL:    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3",
		CoverURL:    ptrString("https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=400&auto=format&fit=crop&q=80"),
		DurationSec: 260,
	},
	{
		Title:       "Sunset Dream Piano",
		Artist:      "Aria Keys",
		AudioURL:    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-9.mp3",
		CoverURL:    ptrString("https://images.unsplash.com/photo-1520523839898-507127027581?w=400&auto=format&fit=crop&q=80"),
		DurationSec: 320,
	},
	{
		Title:       "Horizon Echoes Ambient",
		Artist:      "Nesty Ambient",
		AudioURL:    "https://actions.google.com/sounds/v1/science_fiction/force_field_hum.ogg",
		CoverURL:    ptrString("https://images.unsplash.com/photo-1534447677768-be436bb09401?w=400&auto=format&fit=crop&q=80"),
		DurationSec: 180,
	},
}

// SeedTracks populates the tracks table if it is currently empty.
func SeedTracks(db *gorm.DB) error {
	var count int64
	if err := db.Model(&model.Track{}).Count(&count).Error; err != nil {
		return err
	}

	if count == 0 {
		log.Println("Seeding tracks table with initial royalty-free music...")
		for _, track := range DefaultRoyaltyFreeTracks {
			t := track
			if err := db.Create(&t).Error; err != nil {
				log.Printf("Failed to seed track %s: %v\n", track.Title, err)
			}
		}
		log.Printf("Seeded %d royalty-free tracks into database.\n", len(DefaultRoyaltyFreeTracks))
	}

	return nil
}
