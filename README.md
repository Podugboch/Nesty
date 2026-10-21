# Nesty — Easy Connection

<div align="center">

![Nesty Logo](frontend/public/nesty-logo.png)

**Next-Generation Real-Time Social, Voice/Video Calling & Short-Form Video Platform**

[![Go Version](https://img.shields.io/badge/Go-1.25-00ADD8?style=flat&logo=go)](https://golang.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?style=flat&logo=typescript)](https://www.typescriptlang.org)
[![WebRTC](https://img.shields.io/badge/WebRTC-Real--Time-333333?style=flat&logo=webrtc)](https://webrtc.org)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=flat&logo=docker)](https://www.docker.com)
[![Render](https://img.shields.io/badge/Deploy-Render-46E3B7?style=flat&logo=render)](https://piscine-devnest.onrender.com)

🚀 **Live Deployment**: [https://piscine-devnest.onrender.com](https://piscine-devnest.onrender.com)

</div>

---

## 📖 Overview

**Nesty** is a modern, high-performance social networking and real-time collaboration platform designed for seamless peer-to-peer connection. Built with a robust Go backend and a responsive React/TypeScript frontend, Nesty unites short-form video reels, high-definition voice and video calls, dynamic community channels, live broadcast streaming, and direct messaging in a single, unified experience.

---

## ✨ Key Features

### 📞 Real-Time Voice & 1080p Video Calling
- **WebRTC P2P Calling**: Direct, ultra-low-latency 1-on-1 audio and video calls.
- **Community Group Calls**: Audio and video group conferencing embedded inside community channels with multi-track broadcasting and automatic mesh renegotiation.
- **Background Call Delivery**: Android lock screen takeover via full-screen intent and native `CallStyle` ring notifications; iOS CallKit integration.
- **Screen Sharing**: Broadcast high-fps desktop and application windows directly in group calls.

### 📱 Reels & Short-Form Media
- **Swipeable Vertical Feed**: Fast, full-screen vertical video scroll with smooth snap transitions.
- **Jamendo Music Integration**: Explore, preview, and license soundtrack audio with independent audio track mixing and video mute controls.
- **Interactive Comments Dock**: Slide-up comments drawer with synchronized video minimization for seamless discussion.
- **Cross-Platform Sharing**: Instant share sheet supporting direct messaging to Nesty peers or native system sharing.
- **Pull-to-Refresh**: Intuitive pull gesture and top refresh navigation for instant feed updates.

### 🎥 Live Broadcast Studio
- **Live Video Streaming**: Broadcast directly to the Nesty network with real-time camera controls.
- **Screen Share**: Broadcast code, presentations, or live coding sessions.
- **Live Chat Stream**: Synchronized real-time chat with active audience participant counts.

### 👥 Communities & Anti-Spam Dashboard
- **Custom Channels**: Create topic-specific channels (General, Coding Help, Showcase, Opportunities, Study Buddies).
- **Spam-Free Dashboard**: Users only see communities they belong to, created, were invited to, or actively searched for.
- **Role Hierarchy**: Creator, Admin, Co-Admin, and Member roles with member admission and co-admin elevation.
- **Invitation Flow**: Search any Nester by handle or name to send invitations with instant Accept/Decline management.

### 💬 Real-Time Direct Messaging
- **WebSocket Hub**: Instant messaging with delivery receipts and typing indicators.
- **Rich Attachments**: Upload photos, videos, and project documents directly in conversation.
- **Message Reply-To**: Context-aware quoting and reply thread navigation.

### ⚡ 100k Concurrent User Scale Architecture
- **Distributed Pub/Sub**: Redis-backed clustering for WebSocket broadcast across multiple container instances.
- **Database Connection Pooling**: Optimized PostgreSQL connection management with GORM.
- **TURN/STUN Relay**: Integrated Coturn NAT-traversal for symmetric firewall environments.

---

## 🛠️ Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend** | React 19, TypeScript, Vite, WebRTC API, Canvas & Web Audio API, CSS3 Variables |
| **Backend** | Go (Golang) 1.25, Gin Web Framework, GORM ORM, Gorilla WebSocket |
| **Database & Cache** | PostgreSQL (Supabase), Redis Pub/Sub & Key-Value Store |
| **Media & CDN** | Supabase Storage (S3-compatible bucket), Jamendo Licensing API |
| **Mobile Integration** | Android Native (`CallNotificationService`, `TelecomManager`, `CallStyle`), iOS Swift (`CallKit`, `PushKit`) |
| **DevOps & Hosting** | Multi-Stage Dockerfile, Alpine Linux, Render Web Service |

---

## 📂 Repository Structure

```
.
├── cmd/
│   └── server/
│       └── main.go                  # Main Go application entry point
├── frontend/
│   ├── public/                      # Static assets & brand icons
│   ├── src/
│   │   ├── components/              # ReelsView, ReelCreateView, MusicPicker, etc.
│   │   ├── utils/                   # Time formatting, token helpers
│   │   ├── App.tsx                  # Core application & real-time WebSocket client
│   │   ├── App.css                  # Modern responsive styling & dark/light theme
│   │   ├── ErrorBoundary.tsx        # UI crash boundary
│   │   └── main.tsx                 # React DOM bootstrap
│   ├── index.html                   # HTML entry point with viewport configuration
│   ├── vite.config.ts               # Vite production bundling setup
│   └── package.json                 # Frontend dependencies & scripts
├── internal/
│   ├── app/                         # App lifecycle, database connection & routing setup
│   ├── handlers/                    # REST API route handlers (Auth, Feed, Reels, Communities)
│   ├── model/                       # GORM database schemas & relations
│   ├── push/                        # Push notification services & device registry
│   ├── seed/                        # Initial soundtrack & system channel seeds
│   ├── storage/                     # Supabase object storage upload helpers
│   ├── utils/                       # JWT authentication, bcrypt hashing & validators
│   └── ws/                          # Real-time WebSocket hub & WebRTC signaling
├── mobile/
│   ├── android/                     # Android native calling bridge & background listeners
│   └── ios/                         # iOS CallKit integration & AppDelegate
├── Dockerfile                       # Multi-stage production Docker build (Node + Go)
├── render.yaml                      # Infrastructure-as-code blueprint for Render
├── go.mod                           # Go module definitions & dependencies
└── README.md                        # Project documentation
```

---

## 🚀 Getting Started

### Prerequisites
- [Go 1.22+](https://go.dev/dl/)
- [Node.js 20+](https://nodejs.org/) & `npm`
- [Docker](https://www.docker.com/) (optional, for containerized run)
- PostgreSQL database (or [Supabase](https://supabase.com/))

### 1. Clone the Repository
```bash
git clone https://github.com/Podugboch/Nesty.git
cd Nesty
```

### 2. Environment Variables
Create a `.env` file in the project root:
```env
PORT=8080
DATABASE_URL=postgresql://user:password@host:5432/database?sslmode=require
JWT_SECRET=your_super_secret_jwt_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your_supabase_service_role_key
JAMENDO_CLIENT_ID=your_jamendo_client_id
```

### 3. Run Backend (Development)
```bash
go run cmd/server/main.go
```
The backend starts at `http://localhost:8080`.

### 4. Run Frontend (Development)
```bash
cd frontend
npm install
npm run dev
```
The Vite development server runs at `http://localhost:5173`.

---

## 🐳 Docker Deployment

Build and run the production image locally using Docker:

```bash
# Build multi-stage image
docker build -t nesty:latest .

# Run container
docker run -p 8080:8080 --env-file .env nesty:latest
```

---

## 🔒 Security & Privacy

- **Password Hashing**: Industry-standard `bcrypt` password encryption with salting.
- **JWT Authorization**: Stateless, expiring JSON Web Tokens validated on all protected endpoints.
- **P2P Encryption**: WebRTC audio and video streams are encrypted end-to-end via DTLS-SRTP.
- **Scoped Permissions**: Fine-grained role checks (Creator, Admin, Co-Admin, Member) on community moderation actions.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
Badge hunt
