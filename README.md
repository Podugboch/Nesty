# Nesty

🚀 **Live Deployment on Render**: [https://piscine-devnest.onrender.com](https://piscine-devnest.onrender.com)

Project Overview: Nesty
Project Name:

Nesty

Project Type:

Social Networking & Collaboration App for Learn2Earn Piscine Candidates and Graduates

Purpose / Objective:

To create a dedicated platform where Learn2Earn Piscine candidates can connect, share knowledge, collaborate, and build a supportive community during and after the Piscine program. The app aims to:

Enable candidates to link up with peers.

Allow candidates to chat privately or in groups.

Provide a profile directory to explore other candidates’ skills and experience.

Facilitate resource and knowledge sharing, such as notes, tips, and project guidance.

Target Users:

Current and past Learn2Earn Piscine candidates.

Developers seeking mentorship, collaboration, or networking.

Key Features:

User Authentication & Profiles:

Sign-up / Log-in via email, social accounts, or Learn2Earn credentials.

Create a profile with photo, bio, skills, project interests, and contact info.

Profiles visible in a searchable directory.

Networking & Directory:

Browse, search, and filter candidates by skills, batch, or location.

Send connection/friend requests to other candidates.

Chat System:

Private messaging between candidates.

Group chats based on Piscine batch, skill sets, or topics.

Push notifications for new messages.

Resource Sharing:

Share notes, code snippets, or links within chats or a shared resource section.

Option to like/comment on shared resources.

Admin / Moderation Panel:

Approve or remove accounts, manage reports.

Maintain community guidelines and monitor content.

Optional Features (Phase 2):

Mentorship matching between experienced and new candidates.

Event calendar for workshops, deadlines, or coding challenges.

Gamification: badges or reputation points for active contributors.

Technology Stack (Suggested):

Frontend:

React Native (for cross-platform mobile app)

Tailwind CSS / Styled Components

Backend:

Golang (Go) for APIs and business logic

Supabase / Firebase for database, authentication, and real-time chat

Database:

PostgreSQL (or Supabase-managed database)

Real-time Communication:

WebSockets / Firebase Realtime DB for messaging

Hosting / Deployment:

Vercel / Netlify for frontend (if web app)

Supabase / Render / AWS for backend

Expected Outcome:

A fully functional mobile/web app connecting all Piscine candidates.

Easier knowledge exchange and peer support.

Creation of a community-driven learning environment.





piscine-devnest/
│
├── main.go             # Entry point
├── go.mod              # Module file
├── config/
│   └── config.go       # Database & environment configs
├── models/
│   └── user.go         # User model
│   └── message.go      # Chat model
│   └── resource.go     # Shared resources model
├── controllers/
│   └── userController.go
│   └── chatController.go
│   └── resourceController.go
├── routes/
│   └── routes.go
├── middlewares/
│   └── auth.go         # JWT authentication
├── utils/
│   └── hash.go         # Password hashing
│   └── response.go     # Standardized API responses
└── db/
    └── db.go           # Database connection



