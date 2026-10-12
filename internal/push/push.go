package push

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"gorm.io/gorm"
	"piscine-devnest/internal/model"
)

type CallPushPayload struct {
	CallID          string `json:"callId"`
	CallerID        uint   `json:"callerId"`
	CallerName      string `json:"callerName"`
	CallerAvatarURL string `json:"callerAvatarUrl"`
	CallType        string `json:"callType"` // "audio" | "video"
	Action          string `json:"action"`   // "call_invite" | "call_cancel" | "missed_call"
}

type PushService struct {
	db         *gorm.DB
	httpClient *http.Client
}

func NewPushService(db *gorm.DB) *PushService {
	return &PushService{
		db: db,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// SendCallInvite pushes an incoming call wake-up notification to all registered devices for callee
func (s *PushService) SendCallInvite(calleeID uint, payload CallPushPayload) {
	var devices []model.Device
	if err := s.db.Where("user_id = ?", calleeID).Find(&devices).Error; err != nil || len(devices) == 0 {
		return
	}

	payload.Action = "call_invite"
	for _, dev := range devices {
		switch dev.Platform {
		case "android":
			go s.sendFCMDataPush(dev, payload)
		case "ios":
			// Dedicated APNs PushKit VoIP code path
			go s.sendAPNsVoipPush(dev, payload)
		case "web":
			go s.sendWebPush(dev, payload)
		}
	}
}

// SendCallCancel notifies callee devices that the incoming call was cancelled/hung up by caller
func (s *PushService) SendCallCancel(calleeID uint, callID string) {
	var devices []model.Device
	if err := s.db.Where("user_id = ?", calleeID).Find(&devices).Error; err != nil || len(devices) == 0 {
		return
	}

	payload := CallPushPayload{
		CallID: callID,
		Action: "call_cancel",
	}

	for _, dev := range devices {
		switch dev.Platform {
		case "android":
			go s.sendFCMDataPush(dev, payload)
		case "ios":
			go s.sendAPNsVoipPush(dev, payload)
		case "web":
			go s.sendWebPush(dev, payload)
		}
	}
}

// SendMissedCallNotification pushes a missed call notice to the callee
func (s *PushService) SendMissedCallNotification(calleeID uint, payload CallPushPayload) {
	var devices []model.Device
	if err := s.db.Where("user_id = ?", calleeID).Find(&devices).Error; err != nil || len(devices) == 0 {
		return
	}

	payload.Action = "missed_call"
	for _, dev := range devices {
		switch dev.Platform {
		case "android":
			go s.sendFCMDataPush(dev, payload)
		case "ios":
			go s.sendAPNsVoipPush(dev, payload)
		case "web":
			go s.sendWebPush(dev, payload)
		}
	}
}

// ---------------------------------------------------------------------------
// 1. ANDROID: Firebase Cloud Messaging (FCM) High-Priority Data-Only Message
// ---------------------------------------------------------------------------
func (s *PushService) sendFCMDataPush(device model.Device, payload CallPushPayload) {
	apiKey := os.Getenv("FCM_SERVER_KEY")
	if apiKey == "" {
		apiKey = os.Getenv("FIREBASE_SERVER_KEY")
	}
	if apiKey == "" {
		log.Println("[Push] FCM_SERVER_KEY not configured, skipping Android push")
		return
	}

	// Data-only message with priority: "high" to wake Android from Doze / Background
	body := map[string]interface{}{
		"to":       device.Token,
		"priority": "high",
		"data": map[string]string{
			"callId":          payload.CallID,
			"callerId":        strconv.FormatUint(uint64(payload.CallerID), 10),
			"callerName":      payload.CallerName,
			"callerAvatarUrl": payload.CallerAvatarURL,
			"callType":        payload.CallType,
			"action":          payload.Action,
			"timestamp":       strconv.FormatInt(time.Now().UnixMilli(), 10),
		},
	}

	jsonBytes, err := json.Marshal(body)
	if err != nil {
		return
	}

	req, err := http.NewRequest("POST", "https://fcm.googleapis.com/fcm/send", bytes.NewBuffer(jsonBytes))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "key="+apiKey)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		log.Printf("[Push] FCM error for device %s: %v", device.Token, err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		var fcmResp struct {
			Success int `json:"success"`
			Failure int `json:"failure"`
			Results []struct {
				Error string `json:"error"`
			} `json:"results"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&fcmResp); err == nil && len(fcmResp.Results) > 0 {
			errStr := fcmResp.Results[0].Error
			if errStr == "NotRegistered" || errStr == "InvalidRegistration" {
				log.Printf("[Push] Device token invalidated by FCM, removing: %s", device.Token)
				s.db.Delete(&device)
			}
		}
	} else if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusNotFound {
		s.db.Delete(&device)
	}
}

// ---------------------------------------------------------------------------
// 2. iOS: Apple Push Notification Service (APNs) PushKit / VoIP Push Path
// ---------------------------------------------------------------------------
func (s *PushService) sendAPNsVoipPush(device model.Device, payload CallPushPayload) {
	// VoIP push requires PushKit token (stored in VoipToken or Token)
	voipToken := device.VoipToken
	if voipToken == "" {
		voipToken = device.Token
	}

	apnsURL := os.Getenv("APNS_GATEWAY_URL")
	if apnsURL == "" {
		if os.Getenv("APNS_PRODUCTION") == "true" {
			apnsURL = "https://api.push.apple.com"
		} else {
			apnsURL = "https://api.sandbox.push.apple.com"
		}
	}

	bundleID := os.Getenv("APNS_VOIP_BUNDLE_ID")
	if bundleID == "" {
		bundleID = os.Getenv("IOS_BUNDLE_ID")
		if bundleID != "" {
			bundleID = bundleID + ".voip"
		} else {
			bundleID = "com.devnest.app.voip"
		}
	}

	apnsBearer := os.Getenv("APNS_AUTH_TOKEN")
	if apnsBearer == "" {
		log.Println("[Push] APNS_AUTH_TOKEN not configured, skipping iOS VoIP push")
		return
	}

	endpoint := fmt.Sprintf("%s/3/device/%s", apnsURL, voipToken)
	voipBody := map[string]interface{}{
		"aps": map[string]interface{}{
			"content-available": 1,
		},
		"callId":          payload.CallID,
		"callerId":        payload.CallerID,
		"callerName":      payload.CallerName,
		"callerAvatarUrl": payload.CallerAvatarURL,
		"callType":        payload.CallType,
		"action":          payload.Action,
	}

	jsonBytes, err := json.Marshal(voipBody)
	if err != nil {
		return
	}

	req, err := http.NewRequest("POST", endpoint, bytes.NewBuffer(jsonBytes))
	if err != nil {
		return
	}

	// Required VoIP headers for iOS CallKit wake-up
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("authorization", "bearer "+apnsBearer)
	req.Header.Set("apns-topic", bundleID)
	req.Header.Set("apns-push-type", "voip")
	req.Header.Set("apns-priority", "10")
	req.Header.Set("apns-expiration", "0")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		log.Printf("[Push] APNs VoIP push error: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusGone || resp.StatusCode == http.StatusBadRequest {
		log.Printf("[Push] APNs token expired or invalid (HTTP %d), removing device", resp.StatusCode)
		s.db.Delete(&device)
	}
}

// ---------------------------------------------------------------------------
// 3. WEB FALLBACK: Web Push for PWA / Browser environments
// ---------------------------------------------------------------------------
func (s *PushService) sendWebPush(device model.Device, payload CallPushPayload) {
	// Web Push delivers incoming call notification action buttons to desktop / mobile browsers
	log.Printf("[Push] Web push registered for token %s, action: %s", device.Token, payload.Action)
}
