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
		log.Printf("[CallLog] [Push] No registered push devices found for calleeID=%d", calleeID)
		return
	}

	payload.Action = "call_invite"
	log.Printf("[CallLog] [Push] Dispatching call_invite for callId=%s caller=%s to %d device(s)", payload.CallID, payload.CallerName, len(devices))
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

	log.Printf("[CallLog] [Push] Dispatching call_cancel for callId=%s to %d device(s)", callID, len(devices))
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
	log.Printf("[CallLog] [Push] Dispatching missed_call for callId=%s to %d device(s)", payload.CallID, len(devices))
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
// Strictly data-only (NO "notification" block), priority: "high", 30s short TTL.
// Ensures Android system tray does NOT intercept, allowing native DevNestFirebaseMessagingService
// onMessageReceived to handle the payload even when the app is backgrounded or killed.
func (s *PushService) sendFCMDataPush(device model.Device, payload CallPushPayload) {
	apiKey := os.Getenv("FCM_SERVER_KEY")
	if apiKey == "" {
		apiKey = os.Getenv("FIREBASE_SERVER_KEY")
	}
	if apiKey == "" {
		log.Println("[CallLog] [Push] FCM_SERVER_KEY not configured, skipping Android FCM push")
		return
	}

	log.Printf("[CallLog] [Push] Sending FCM data-only push: action=%s, callId=%s, deviceToken=%.16s...", payload.Action, payload.CallID, device.Token)

	// Strictly data-only payload: NO "notification" block!
	body := map[string]interface{}{
		"to":           device.Token,
		"priority":     "high",
		"time_to_live": 30, // 30-second TTL
		"android": map[string]interface{}{
			"priority": "high",
			"ttl":      "30s",
		},
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
		log.Printf("[CallLog] [Push] JSON marshal error: %v", err)
		return
	}

	req, err := http.NewRequest("POST", "https://fcm.googleapis.com/fcm/send", bytes.NewBuffer(jsonBytes))
	if err != nil {
		log.Printf("[CallLog] [Push] NewRequest error: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "key="+apiKey)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		log.Printf("[CallLog] [Push] FCM HTTP error for device %.16s...: %v", device.Token, err)
		return
	}
	defer resp.Body.Close()

	log.Printf("[CallLog] [Push] FCM response HTTP %d for callId=%s", resp.StatusCode, payload.CallID)

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
				log.Printf("[CallLog] [Push] Device token invalidated by FCM, deleting record: %.16s...", device.Token)
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
// Dedicated PushKit VoIP push. Delivers directly to iOS CallKit for native incoming call UI.
func (s *PushService) sendAPNsVoipPush(device model.Device, payload CallPushPayload) {
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
		log.Println("[CallLog] [Push] APNS_AUTH_TOKEN not configured, skipping iOS VoIP push")
		return
	}

	log.Printf("[CallLog] [Push] Sending APNs VoIP PushKit push: action=%s, callId=%s, token=%.16s...", payload.Action, payload.CallID, voipToken)

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
		log.Printf("[CallLog] [Push] APNs VoIP push error: %v", err)
		return
	}
	defer resp.Body.Close()

	log.Printf("[CallLog] [Push] APNs response HTTP %d for callId=%s", resp.StatusCode, payload.CallID)

	if resp.StatusCode == http.StatusGone || resp.StatusCode == http.StatusBadRequest {
		log.Printf("[CallLog] [Push] APNs token expired or invalid (HTTP %d), removing device", resp.StatusCode)
		s.db.Delete(&device)
	}
}

// ---------------------------------------------------------------------------
// 3. WEB FALLBACK: Web Push for PWA / Browser environments
// ---------------------------------------------------------------------------
func (s *PushService) sendWebPush(device model.Device, payload CallPushPayload) {
	log.Printf("[CallLog] [Push] Web push registered for token %.16s..., action: %s", device.Token, payload.Action)
}
