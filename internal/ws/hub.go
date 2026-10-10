package ws

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"gorm.io/gorm"

	"piscine-devnest/internal/model"
	"github.com/gin-gonic/gin"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type registration struct {
	conn   *websocket.Conn
	userID uint
}

type userMessage struct {
	userID  uint
	payload []byte
}

type Hub struct {
	db          *gorm.DB
	Clients     map[*websocket.Conn]uint
	BroadcastC  chan []byte
	Register    chan registration
	Unregister  chan *websocket.Conn
	SendToUserC chan userMessage
}

type DirectMessage struct {
	Event       string    `json:"event"`
	ID          uint      `json:"id"`
	SenderID    uint      `json:"sender_id"`
	RecipientID uint      `json:"recipient_id"`
	Content     string    `json:"content"`
	CreatedAt   time.Time `json:"created_at"`
}

func NewHub(db *gorm.DB) *Hub {
	return &Hub{
		db:          db,
		Clients:     make(map[*websocket.Conn]uint),
		BroadcastC:  make(chan []byte),
		Register:    make(chan registration),
		Unregister:  make(chan *websocket.Conn),
		SendToUserC: make(chan userMessage),
	}
}

func (h *Hub) Run() {
	for {
		select {

		case reg := <-h.Register:
			h.Clients[reg.conn] = reg.userID
			log.Printf("WebSocket connected (user %d)\n", reg.userID)

		case conn := <-h.Unregister:
			if _, ok := h.Clients[conn]; ok {
				delete(h.Clients, conn)
				conn.Close()
				log.Println("WebSocket disconnected")
			}

		case payload := <-h.BroadcastC:
			for conn := range h.Clients {
				if err := conn.WriteMessage(websocket.TextMessage, payload); err != nil {
					conn.Close()
					delete(h.Clients, conn)
				}
			}

		case msg := <-h.SendToUserC:
			for conn, uid := range h.Clients {
				if uid != msg.userID {
					continue
				}

				if err := conn.WriteMessage(websocket.TextMessage, msg.payload); err != nil {
					conn.Close()
					delete(h.Clients, conn)
				}
			}
		}
	}
}

func (h *Hub) HandleConnections(w http.ResponseWriter, r *http.Request, userID uint) {

	wsConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("WebSocket upgrade error:", err)
		return
	}

	h.Register <- registration{
		conn:   wsConn,
		userID: userID,
	}

	defer func() {
		h.Unregister <- wsConn
	}()

	for {

		_, raw, err := wsConn.ReadMessage()
		if err != nil {
			break
		}

		var incoming struct {
			Event       string `json:"event"`
			RecipientID uint   `json:"recipient_id"`
			Content     string `json:"content"`
		}

		if err := json.Unmarshal(raw, &incoming); err != nil {
			log.Println("Invalid websocket JSON:", err)
			continue
		}

		// Non-chat events continue to use broadcast.
		if incoming.Event != "chat_message" {
			h.Broadcast(string(raw))
			continue
		}

		content := strings.TrimSpace(incoming.Content)

		if content == "" {
			continue
		}

		if len(content) > 2000 {
			continue
		}

		msgModel := model.Message{
			SenderID:    userID,
			RecipientID: incoming.RecipientID,
			Content:     content,
		}

		if err := h.db.Create(&msgModel).Error; err != nil {
			log.Println("Failed to save message:", err)
			continue
		}

		if userID != incoming.RecipientID {
            notif := model.Notification{
                UserID:  incoming.RecipientID,
                ActorID: userID,
                Type:    "message",
                Read:    false,
            }
            if err := h.db.Create(&notif).Error; err == nil {
                // Preload actor details so the notification component renders the avatar/username instantly
                h.db.Preload("Actor", func(db *gorm.DB) *gorm.DB {
                    return db.Select("id", "username", "name", "avatar_url")
                }).First(&notif, notif.ID)

                if notifPayload, err := json.Marshal(gin.H{"event": "notification", "notification": notif}); err == nil {
                    h.SendToUser(incoming.RecipientID, notifPayload)
                }
            }
        }

		response := DirectMessage{
			Event:       "chat_message",
			ID:          msgModel.ID,
			SenderID:    msgModel.SenderID,
			RecipientID: msgModel.RecipientID,
			Content:     msgModel.Content,
			CreatedAt:   msgModel.CreatedAt,
		}

		payload, err := json.Marshal(response)
		if err != nil {
			log.Println("Failed to marshal message:", err)
			continue
		}

		// Deliver to recipient.
		h.SendToUser(response.RecipientID, payload)

		// Echo back to sender so both clients stay synchronized.
		if response.RecipientID != response.SenderID {
			h.SendToUser(response.SenderID, payload)
		}
	}
}

func (h *Hub) Broadcast(msg string) {
	h.BroadcastC <- []byte(msg)
}

func (h *Hub) SendToUser(userID uint, payload []byte) {
	h.SendToUserC <- userMessage{
		userID:  userID,
		payload: payload,
	}
}