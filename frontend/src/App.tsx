import React, { useState, useEffect, useRef } from "react";
import { timeAgo } from "./utils/timeAgo";
import "./App.css";

const API_URL: string = (import.meta as any).env?.VITE_API_URL ||
  (typeof window !== "undefined" && window.location.hostname === "localhost" && window.location.port === "5173"
    ? "http://localhost:8080"
    : (typeof window !== "undefined" ? window.location.origin : "http://localhost:8080"));

const WS_BASE_URL: string = (import.meta as any).env?.VITE_WS_URL ||
  (typeof window !== "undefined" && window.location.hostname === "localhost" && window.location.port === "5173"
    ? `${typeof window !== "undefined" && window.location.protocol === "https:" ? "wss:" : "ws:"}//${typeof window !== "undefined" ? window.location.hostname : "localhost"}:8080`
    : (typeof window !== "undefined" ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}` : "ws://localhost:8080"));


type User = {
  id: number;
  username: string;
  email: string;
  name?: string;
  bio?: string;
  skills?: string;
  location?: string;
  avatar_url?: string;
  banner_url?: string;
};

type Comment = {
  id: number;
  post_id: number;
  content: string;
  created_at: string;
  user?: User;
};

type Post = {
  id: number;
  content: string;
  media_url?: string;
  community?: string;
  created_at?: string;
  user?: User;
  likes: number;
  liked_by_me?: boolean;
  comments?: Comment[];
  parent_id?: number;
  parent?: Post;
};


type ChatMessage = {
  id?: number;
  sender_id: number;
  recipient_id: number;
  content: string;
  media_url?: string;
  media_type?: string;
  file_name?: string;
  file_size?: number;
  created_at?: string;
};

type CallState = {
  partner: User;
  status: "calling" | "ringing" | "connected" | "ended";
  statusText?: string;
  duration: number;
  isVideo: boolean;
  isMuted: boolean;
  isSpeaker: boolean;
  isCaller?: boolean;
};

type IncomingCallState = {
  caller: User;
  isVideo: boolean;
  callId?: string;
};

type Notification = {
  id: number;
  user_id: number;
  actor_id: number;
  actor?: User;
  type: "like" | "comment" | "follow" | "mention" | "repost" | "missed_call" | "missed_video_call";
  post_id?: number;
  read: boolean;
  created_at: string;
};

type FollowListUser = {
  id: number;
  username: string;
  name?: string;
  avatar_url?: string;
  is_following?: boolean;
};

type CommunityChannel = {
  id: string;
  name: string;
  badgeClass: string;
  subtitle: string;
};

// Isolated duration timer: updates every 1s internally without re-rendering App or <video> elements!
const CallDurationTimer = React.memo(({ isConnected }: { isConnected: boolean }) => {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!isConnected) {
      setSeconds(0);
      return;
    }
    setSeconds(0);
    const interval = setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isConnected]);

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return <span>{`${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`}</span>;
});

// Isolated video component: sets srcObject only when stream reference changes, preventing frame drops!
const VideoFeed = React.memo(({
  stream,
  isMuted = false,
  className,
  style,
  onClick,
  title,
}: {
  stream: MediaStream | null;
  isMuted?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
  title?: string;
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = !!isMuted;
    if (el.srcObject !== stream) {
      el.srcObject = stream;
    }
    if (stream) {
      el.play().catch(() => {});
    }
  }, [stream, isMuted]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={isMuted}
      className={className}
      style={{
        ...style,
        objectFit: "cover",
      }}
      onClick={onClick}
      title={title}
    />
  );
});

export default function App() {
  // -----------------------------
  // AUTH STATES
  // -----------------------------
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register" | "forgot">("login");
  const [username, setUsername] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);

  const [token, setToken] = useState<string | null>(
    localStorage.getItem("token")
  );
  const [user, setUser] = useState<User | null>(null);

  // -----------------------------
  // THEME (LIGHT / DARK)
  // -----------------------------
  const getSystemTheme = (): "dark" | "light" =>
    window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";

  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = localStorage.getItem("theme");
    return saved === "dark" || saved === "light" ? saved : getSystemTheme();
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem("theme", next);
      return next;
    });
  };

  // -----------------------------
  // NAVIGATION & COMMUNITIES
  // -----------------------------
  const [page, setPage] = useState<"feed" | "create" | "profile">("feed");
  const [selectedCommunity, setSelectedCommunity] = useState<string>("general");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [communities, setCommunities] = useState<CommunityChannel[]>([
    { id: "general", name: "General", badgeClass: "general", subtitle: "Chat, share, and grow together." },
    { id: "coding-help", name: "Coding Help", badgeClass: "coding", subtitle: "Stuck? Get help from the community." },
    { id: "showcase", name: "Project Showcase", badgeClass: "showcase", subtitle: "Show off what you're building." },
    { id: "opportunities", name: "Opportunities", badgeClass: "opportunities", subtitle: "Jobs, Internships and more." },
    { id: "study-buddies", name: "Study Buddies", badgeClass: "study", subtitle: "Find study partners and collaborate." },
  ]);

  const [createCommModalOpen, setCreateCommModalOpen] = useState(false);
  const [newCommName, setNewCommName] = useState("");

  // -----------------------------
  // SEARCH
  // -----------------------------
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [searchFocused, setSearchFocused] = useState(false);

  // -----------------------------
  // NOTIFICATIONS
  // -----------------------------
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(3);
  const [notifOpen, setNotifOpen] = useState(false);

  // -----------------------------
  // COMMUNITY STATS & ONLINE USERS
  // -----------------------------
  const [liveUserCount, setLiveUserCount] = useState<number>(0);
  const [communityStats, setCommunityStats] = useState<{
    user_count?: number;
    total_users?: number;
    member_count?: number;
    online_users: Array<{ id?: number; username: string; name?: string; avatar_url?: string; status?: string }>;
  }>({
    user_count: 0,
    online_users: [],
  });

  // -----------------------------
  // CHAT, CALL & SCROLL CONTROLS
  // -----------------------------
  const [activeChatPartner, setActiveChatPartner] = useState<User | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInputText, setChatInputText] = useState("");
  const [chatSelectedFile, setChatSelectedFile] = useState<File | null>(null);
  const [chatFilePreview, setChatFilePreview] = useState<string | null>(null);
  const [isChatUploading, setIsChatUploading] = useState(false);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatFileInputRef = useRef<HTMLInputElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const activeChatPartnerRef = useRef<User | null>(null);

  const [activeCall, setActiveCall] = useState<CallState | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCallState | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [onlineModalOpen, setOnlineModalOpen] = useState(false);

  // WebRTC & Calling Audio / Video Refs
  const wsRef = useRef<WebSocket | null>(null);
  const activeCallRef = useRef<CallState | null>(null);
  const incomingCallRef = useRef<IncomingCallState | null>(null);
  const userRef = useRef<User | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const ringtoneCleanupRef = useRef<(() => void) | null>(null);
  const callDisconnectTimeoutRef = useRef<any>(null);
  const callRingTimeoutRef = useRef<any>(null);
  const iceQueueRef = useRef<any[]>([]);
  const incomingCallNotifRef = useRef<any>(null);
  const tokenRef = useRef<string | null>(null);
  const statsIntervalRef = useRef<any>(null);
  const lossStreakRef = useRef<number>(0);
  const currentMaxBitrateRef = useRef<number>(800000);
  const lastPacketsLostRef = useRef<number>(0);
  const lastPacketsReceivedRef = useRef<number>(0);
  const iceRestartCountRef = useRef<number>(0);

  // Hamburger drawer accordion state
  const [showOverview, setShowOverview] = useState(false);
  const [showFeatured, setShowFeatured] = useState(false);
  const [showOnline, setShowOnline] = useState(false);

  // Pull-to-refresh state
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isPullingRef = useRef(false);

  const sidebarLeftRef = useRef<HTMLElement>(null);
  const centerFeedRef = useRef<HTMLElement>(null);
  const sidebarRightRef = useRef<HTMLElement>(null);

  // -----------------------------
  // POSTS & FEED
  // -----------------------------
  const [posts, setPosts] = useState<Post[]>([]);
  const [newPost, setNewPost] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);

  const [activeDropdown, setActiveDropdown] = useState<number | null>(null);
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [editText, setEditText] = useState("");
  const [expandedComments, setExpandedComments] = useState<Record<number, boolean>>({});
  const [commentInputs, setCommentInputs] = useState<Record<number, string>>({});

  // -----------------------------
  // PROFILE VIEW
  // -----------------------------
  const [viewedUserId, setViewedUserId] = useState<number | null>(null);
  const [profileData, setProfileData] = useState<{
    user: User;
    follower_count: number;
    following_count: number;
    post_count: number;
    is_following: boolean;
    is_self: boolean;
  } | null>(null);
  const [profilePosts, setProfilePosts] = useState<Post[]>([]);
  const [followBusy, setFollowBusy] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [profileForm, setProfileForm] = useState({
    username: "",
    name: "",
    bio: "",
    skills: "",
    location: "",
    avatar_url: "",
    banner_url: "",
  });

  const AVATAR_PRESETS = [
    { label: "Developer", url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&q=80" },
    { label: "Engineer", url: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&q=80" },
    { label: "Designer", url: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&q=80" },
    { label: "Cyberpunk", url: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400&q=80" },
    { label: "Pixel Cat", url: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=400&q=80" },
  ];

  const WALLPAPER_PRESETS = [
    { label: "Mint Flow", url: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1200&q=80" },
    { label: "Dark Tech", url: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=1200&q=80" },
    { label: "Matrix Code", url: "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=1200&q=80" },
    { label: "Neon Horizon", url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&q=80" },
    { label: "Deep Cosmic", url: "https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?w=1200&q=80" },
  ];

  const uploadImageFile = async (file: File): Promise<string | null> => {
    if (!token) return null;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch(`${API_URL}/api/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        return data.url;
      }
    } catch (err) {
      console.error("Upload failed", err);
    }
    // Fallback Data URL
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  };

  const handleAvatarFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    const url = await uploadImageFile(file);
    if (url) {
      setProfileForm((prev) => ({ ...prev, avatar_url: url }));
    }
    setUploadingAvatar(false);
  };

  const handleBannerFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingBanner(true);
    const url = await uploadImageFile(file);
    if (url) {
      setProfileForm((prev) => ({ ...prev, banner_url: url }));
    }
    setUploadingBanner(false);
  };

  const handleQuickAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.id) return;
    const url = await uploadImageFile(file);
    if (url) {
      try {
        const res = await fetch(`${API_URL}/api/users/${user.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ avatar_url: url }),
        });
        if (res.ok) {
          const updated = await res.json();
          setUser(updated);
          fetchProfile(user.id);
        }
      } catch (err) {
        console.error(err);
      }
    }
  };

  const handleQuickBannerChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.id) return;
    const url = await uploadImageFile(file);
    if (url) {
      try {
        const res = await fetch(`${API_URL}/api/users/${user.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ banner_url: url }),
        });
        if (res.ok) {
          const updated = await res.json();
          setUser(updated);
          fetchProfile(user.id);
        }
      } catch (err) {
        console.error(err);
      }
    }
  };

  // -----------------------------
  // FOLLOWERS MODAL
  // -----------------------------
  const [followListModal, setFollowListModal] = useState<{ type: "followers" | "following"; userId: number } | null>(null);
  const [followListUsers, setFollowListUsers] = useState<FollowListUser[]>([]);
  const [followListLoading, setFollowListLoading] = useState(false);

  // -----------------------------
  // FETCH NOTIFICATIONS
  // -----------------------------
  
  const fetchCommunityStats = async () => {
    try {
      const res = await fetch(`${API_URL}/api/community-stats`);
      if (res.ok) {
        const data = await res.json();
        setCommunityStats(data);
        const count = data.user_count ?? data.total_users ?? data.member_count ?? (data.online_users?.length || 0);
        setLiveUserCount(count);
      }
    } catch (err) {
      console.error("Failed to fetch community stats:", err);
    }
  };

  useEffect(() => {
    fetchCommunityStats();
    const interval = setInterval(fetchCommunityStats, 8000);
    const handleVisibility = () => {
      if (!document.hidden) {
        fetchCommunityStats();
      }
    };
    window.addEventListener("focus", handleVisibility);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", handleVisibility);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const handleChatFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setChatSelectedFile(file);
    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = () => {
        setChatFilePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      setChatFilePreview(null);
    }
    e.target.value = "";
  };

  const removeChatSelectedFile = () => {
    setChatSelectedFile(null);
    setChatFilePreview(null);
    if (chatFileInputRef.current) {
      chatFileInputRef.current.value = "";
    }
  };

  const startChatWithUser = async (targetUser: User) => {
    setActiveChatPartner(targetUser);
    activeChatPartnerRef.current = targetUser;
    removeChatSelectedFile();
    setIsChatLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/messages/${targetUser.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setChatMessages(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error("Failed to load messages:", err);
    } finally {
      setIsChatLoading(false);
    }
  };

  const sendChatMessage = async () => {
    const hasText = !!chatInputText.trim();
    const hasFile = !!chatSelectedFile;
    if ((!hasText && !hasFile) || !activeChatPartner || !token || isChatUploading) return;

    const content = chatInputText.trim();
    const fileToSend = chatSelectedFile;
    const filePreview = chatFilePreview;

    setChatInputText("");
    removeChatSelectedFile();

    let uploadedUrl = "";
    let mediaType = "";
    let fileName = "";
    let fileSize = 0;

    if (fileToSend) {
      setIsChatUploading(true);
      fileName = fileToSend.name;
      fileSize = fileToSend.size;

      // Determine media type
      if (fileToSend.type.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(fileName)) {
        mediaType = "image";
      } else if (fileToSend.type.startsWith("video/") || /\.(mp4|webm|mov|mkv)$/i.test(fileName)) {
        mediaType = "video";
      } else if (fileToSend.type.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac)$/i.test(fileName)) {
        mediaType = "audio";
      } else {
        mediaType = "document";
      }

      try {
        const formData = new FormData();
        formData.append("file", fileToSend);
        const uploadRes = await fetch(`${API_URL}/api/upload`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          uploadedUrl = uploadData.url;
        } else {
          const errText = await uploadRes.text();
          console.error("Upload failed in chat:", uploadRes.status, errText);
        }
      } catch (upErr) {
        console.error("Upload exception in chat", upErr);
      } finally {
        setIsChatUploading(false);
      }
    }

    if (fileToSend && !uploadedUrl) {
      alert("Failed to upload attachment. Please check your network and try again.");
      return;
    }

    const tempMsg: ChatMessage = {
      sender_id: user?.id || 0,
      recipient_id: activeChatPartner.id,
      content,
      media_url: uploadedUrl || (filePreview || undefined),
      media_type: mediaType || undefined,
      file_name: fileName || undefined,
      file_size: fileSize || undefined,
      created_at: new Date().toISOString(),
    };
    setChatMessages((prev) => [...prev, tempMsg]);

    try {
      const res = await fetch(`${API_URL}/api/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          recipient_id: activeChatPartner.id,
          content,
          media_url: uploadedUrl,
          media_type: mediaType,
          file_name: fileName,
          file_size: fileSize,
        }),
      });
      if (res.ok) {
        const savedMsg = await res.json();
        setChatMessages((prev) =>
          prev.map((m) => (m === tempMsg ? savedMsg : m))
        );
      } else {
        const errText = await res.text();
        console.error("Send message error:", res.status, errText);
        setChatMessages((prev) => prev.filter((m) => m !== tempMsg));
        alert("Failed to send message.");
      }
    } catch (err) {
      console.error("Failed to send message:", err);
      setChatMessages((prev) => prev.filter((m) => m !== tempMsg));
      alert("Network error sending message.");
    }
  };

  useEffect(() => {
    if (activeChatPartner) {
      chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages, activeChatPartner]);

  useEffect(() => {
    if (!activeChatPartner || !token) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/api/messages/${activeChatPartner.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            setChatMessages(data);
          }
        }
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [activeChatPartner, token]);

  // Keep refs in sync with state
  useEffect(() => {
    activeChatPartnerRef.current = activeChatPartner;
  }, [activeChatPartner]);

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  useEffect(() => {
    incomingCallRef.current = incomingCall;
  }, [incomingCall]);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  // Request phone screen takeover on mobile
  const requestMobileScreenTakeover = () => {
    if (typeof window !== "undefined" && window.innerWidth <= 768) {
      try {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen().catch(() => {});
        }
      } catch {}
    }
  };

  // Vibrate mobile device when an incoming call is received
  useEffect(() => {
    if (!incomingCall) return;
    let vibTimer: any;
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate([600, 300, 600, 300, 600, 300, 1000]);
        vibTimer = setInterval(() => {
          navigator.vibrate([600, 300, 600, 300, 600, 300, 1000]);
        }, 3400);
      } catch {}
    }
    return () => {
      if (vibTimer) clearInterval(vibTimer);
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try {
          navigator.vibrate(0);
        } catch {}
      }
    };
  }, [incomingCall]);

  // Ringtone synthesizer functions using Web Audio API
  const startCallerRingtone = (): (() => void) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return () => {};
      const audioCtx = new AudioCtx();
      if (audioCtx.state === "suspended") {
        audioCtx.resume().catch(() => {});
      }
      let isPlaying = true;
      let timer: any;

      const ring = () => {
        if (!isPlaying || audioCtx.state === "closed") return;
        try {
          const osc1 = audioCtx.createOscillator();
          const osc2 = audioCtx.createOscillator();
          const gain = audioCtx.createGain();

          osc1.type = "sine";
          osc2.type = "sine";
          osc1.frequency.setValueAtTime(440, audioCtx.currentTime);
          osc2.frequency.setValueAtTime(480, audioCtx.currentTime);

          gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.8);

          osc1.connect(gain);
          osc2.connect(gain);
          gain.connect(audioCtx.destination);

          osc1.start();
          osc2.start();
          osc1.stop(audioCtx.currentTime + 1.8);
          osc2.stop(audioCtx.currentTime + 1.8);
        } catch {}

        timer = setTimeout(ring, 3800);
      };

      ring();

      return () => {
        isPlaying = false;
        clearTimeout(timer);
        try {
          audioCtx.close();
        } catch {}
      };
    } catch {
      return () => {};
    }
  };

  const startIncomingRingtone = (): (() => void) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return () => {};
      const audioCtx = new AudioCtx();
      if (audioCtx.state === "suspended") {
        audioCtx.resume().catch(() => {});
      }
      let isPlaying = true;
      let timer: any;

      const chime = () => {
        if (!isPlaying || audioCtx.state === "closed") return;
        try {
          const freqs = [523.25, 659.25, 783.99, 1046.5];
          [0, 0.2, 0.4, 0.6].forEach((delay, idx) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = "triangle";
            osc.frequency.setValueAtTime(freqs[idx % 4], audioCtx.currentTime + delay);
            gain.gain.setValueAtTime(0.12, audioCtx.currentTime + delay);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + delay + 0.35);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(audioCtx.currentTime + delay);
            osc.stop(audioCtx.currentTime + delay + 0.35);
          });
        } catch {}

        timer = setTimeout(chime, 2200);
      };

      chime();

      return () => {
        isPlaying = false;
        clearTimeout(timer);
        try {
          audioCtx.close();
        } catch {}
      };
    } catch {
      return () => {};
    }
  };

  const playDisconnectTone = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const audioCtx = new AudioCtx();
      if (audioCtx.state === "suspended") {
        audioCtx.resume().catch(() => {});
      }
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(420, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.28);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.28);
      setTimeout(() => {
        try {
          audioCtx.close();
        } catch {}
      }, 350);
    } catch {}
  };

  // WebRTC media & peer connection setup
  const cleanupMediaAndCall = () => {
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }
    lossStreakRef.current = 0;
    iceRestartCountRef.current = 0;
    if (ringtoneCleanupRef.current) {
      ringtoneCleanupRef.current();
      ringtoneCleanupRef.current = null;
    }
    clearTimeout(callDisconnectTimeoutRef.current);
    clearTimeout(callRingTimeoutRef.current);

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        try { track.stop(); } catch {}
      });
      localStreamRef.current = null;
    }
    setLocalStream(null);

    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach((track) => {
        try { track.stop(); } catch {}
      });
      remoteStreamRef.current = null;
    }
    setRemoteStream(null);
    iceQueueRef.current = [];

    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.close();
      } catch {}
      peerConnectionRef.current = null;
    }

    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
  };

  const tuneBitrate = (pc: RTCPeerConnection, targetBitrate: number = 800000) => {
    currentMaxBitrateRef.current = targetBitrate;
    try {
      const senders = pc.getSenders();
      // Video sender parameters: maxBitrate ~800000 (or 400000 adapted), maxFramerate 30, degradationPreference "maintain-framerate"
      const videoSender = senders.find((s) => s.track && s.track.kind === "video");
      if (videoSender && videoSender.getParameters) {
        const params = videoSender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        params.encodings[0].maxBitrate = targetBitrate;
        params.encodings[0].maxFramerate = 30;
        (params as any).degradationPreference = "maintain-framerate";
        videoSender.setParameters(params).catch(() => {});
      }

      // Audio Opus sender: maxBitrate ~32000
      const audioSender = senders.find((s) => s.track && s.track.kind === "audio");
      if (audioSender && audioSender.getParameters) {
        const aParams = audioSender.getParameters();
        if (!aParams.encodings || aParams.encodings.length === 0) {
          aParams.encodings = [{}];
        }
        aParams.encodings[0].maxBitrate = 32000;
        audioSender.setParameters(aParams).catch(() => {});
      }
    } catch {}
  };

  const startStatsMonitor = (pc: RTCPeerConnection) => {
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
    }
    lossStreakRef.current = 0;
    lastPacketsLostRef.current = 0;
    lastPacketsReceivedRef.current = 0;

    statsIntervalRef.current = setInterval(async () => {
      if (!pc || pc.signalingState === "closed") {
        clearInterval(statsIntervalRef.current);
        return;
      }
      try {
        const stats = await pc.getStats();
        let fps = 0;
        let packetsLost = 0;
        let packetsReceived = 0;
        let jitter = 0;
        let rtt = 0;
        let candidateType = "unknown";

        stats.forEach((report) => {
          if (report.type === "inbound-rtp" && report.kind === "video") {
            fps = report.framesPerSecond || 0;
            packetsLost = report.packetsLost || 0;
            packetsReceived = report.packetsReceived || 0;
            jitter = report.jitter || 0;
          } else if (report.type === "candidate-pair" && report.state === "succeeded") {
            rtt = report.currentRoundTripTime || report.roundTripTime || 0;
            const localCandidate = stats.get(report.localCandidateId);
            if (localCandidate) {
              candidateType = localCandidate.candidateType || "unknown";
            }
          }
        });

        const deltaLost = Math.max(0, packetsLost - lastPacketsLostRef.current);
        const deltaRecv = Math.max(0, packetsReceived - lastPacketsReceivedRef.current);
        lastPacketsLostRef.current = packetsLost;
        lastPacketsReceivedRef.current = packetsReceived;

        const totalDelta = deltaLost + deltaRecv;
        const lossRate = totalDelta > 0 ? (deltaLost / totalDelta) * 100 : 0;

        if (import.meta.env.DEV) {
          console.log("[WebRTC Dev Stats (3s)]", {
            framesPerSecond: fps,
            packetsLost,
            lossRate: `${lossRate.toFixed(1)}%`,
            jitter: `${(jitter * 1000).toFixed(1)}ms`,
            roundTripTime: `${(rtt * 1000).toFixed(1)}ms`,
            candidateType,
            maxBitrate: currentMaxBitrateRef.current,
          });
        }

        // If packet loss stays above 8% for two checks, lower maxBitrate to 400000. Raise it back when loss clears.
        if (lossRate > 8) {
          lossStreakRef.current += 1;
          if (lossStreakRef.current >= 2 && currentMaxBitrateRef.current > 400000) {
            tuneBitrate(pc, 400000);
          }
        } else {
          if (lossStreakRef.current > 0) {
            lossStreakRef.current = 0;
            if (currentMaxBitrateRef.current < 800000) {
              tuneBitrate(pc, 800000);
            }
          }
        }
      } catch {}
    }, 3000);
  };

  const setupLocalMedia = async (video: boolean, requestedFacing?: "user" | "environment"): Promise<MediaStream | null> => {
    try {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => {
          try { t.stop(); } catch {}
        });
      }

      // Audio constraints separate with echo cancellation, noise suppression, AGC
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };

      const targetFacing = requestedFacing || facingMode;

      // Video constraints: ideal 640x480 (max 640x480), frameRate ideal 24, max 30, facingMode
      const videoConstraints: MediaTrackConstraints = {
        facingMode: { ideal: targetFacing },
        width: { ideal: 640, max: 640 },
        height: { ideal: 480, max: 480 },
        frameRate: { ideal: 24, max: 30 },
      };

      let stream: MediaStream | null = null;
      if (video) {
        try {
          // Acquire both audio and video in ONE unified session for hardware synchronization
          stream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints,
            video: videoConstraints,
          });
        } catch (vErr) {
          console.warn("Unified getUserMedia failed, trying relaxed video fallback:", vErr);
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: audioConstraints,
              video: { facingMode: targetFacing, frameRate: { ideal: 24, max: 30 } },
            });
          } catch (vErr2) {
            console.warn("Fallback video failed, falling back to audio only:", vErr2);
            try {
              stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
            } catch (aErr) {
              console.error("Audio getUserMedia failed:", aErr);
            }
          }
        }
      } else {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
        } catch (aErr) {
          console.error("Audio getUserMedia failed:", aErr);
        }
      }

      if (stream && stream.getTracks().length > 0) {
        localStreamRef.current = stream;
        setLocalStream(stream);

        // Update senders on existing peer connection if active
        if (peerConnectionRef.current) {
          const senders = peerConnectionRef.current.getSenders();
          stream.getTracks().forEach((track) => {
            const sender = senders.find((s) => s.track && s.track.kind === track.kind);
            if (sender) {
              sender.replaceTrack(track).catch(() => {});
            } else {
              peerConnectionRef.current?.addTrack(track, stream!);
            }
          });
        }
      }
      return stream;
    } catch (err) {
      console.warn("Could not acquire media stream directly", err);
      return null;
    }
  };

  const flipCamera = async () => {
    const nextFacing = facingMode === "user" ? "environment" : "user";
    setFacingMode(nextFacing);

    if (!localStreamRef.current) return;

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: nextFacing },
          width: { ideal: 640, max: 640 },
          height: { ideal: 480, max: 480 },
          frameRate: { ideal: 24, max: 30 },
        },
        audio: false,
      });

      const newVideoTrack = newStream.getVideoTracks()[0];
      if (!newVideoTrack) return;

      const oldVideoTracks = localStreamRef.current.getVideoTracks();
      oldVideoTracks.forEach((t) => {
        t.stop();
        localStreamRef.current?.removeTrack(t);
      });

      localStreamRef.current.addTrack(newVideoTrack);
      setLocalStream(new MediaStream(localStreamRef.current.getTracks()));

      if (peerConnectionRef.current) {
        const videoSender = peerConnectionRef.current.getSenders().find((s) => s.track && s.track.kind === "video");
        if (videoSender) {
          await videoSender.replaceTrack(newVideoTrack);
        }
      }
    } catch (err) {
      console.warn("Camera flip fallback setup:", err);
      await setupLocalMedia(true, nextFacing);
    }
  };

  const sendCallSignal = async (type: string, toUserId: number, data?: any) => {
    const callerInfo = user
      ? {
          id: user.id,
          username: user.username,
          name: user.name || user.username,
          avatar_url: user.avatar_url || "",
        }
      : undefined;

    const payload = {
      event: "call_signal",
      type,
      to_user_id: toUserId,
      caller: callerInfo,
      data,
    };

    // Immediate WebSocket delivery for zero delay
    let wsDelivered = false;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify(payload));
        wsDelivered = true;
      } catch (wsErr) {
        console.warn("WS send error, falling back to REST", wsErr);
      }
    }

    // Call REST endpoint for invites (or if WS delivery failed)
    if (!wsDelivered || type === "call_invite") {
      try {
        const res = await fetch(`${API_URL}/api/call/signal`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            type,
            to_user_id: toUserId,
            caller: callerInfo,
            data,
          }),
        });
        if (res.ok) {
          const resData = await res.json();
          return { ...resData, sent: true };
        }
      } catch (err) {
        console.error("Signal REST error", err);
      }
    }

    return { sent: wsDelivered };
  };

  const sendMissedCallNotification = async (toUserId: number, isVideo: boolean = false) => {
    const callType = isVideo ? "missed_video_call" : "missed_call";
    try {
      await fetch(`${API_URL}/api/notifications/call`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenRef.current || token}`,
        },
        body: JSON.stringify({
          to_user_id: toUserId,
          type: callType,
        }),
      });
    } catch (err) {
      console.warn("Failed to record missed call notification", err);
    }
  };

  const createPeerConnection = (targetUserId: number, isVideo: boolean = false): RTCPeerConnection => {
    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.close();
      } catch {}
    }

    const turnUrl = import.meta.env.VITE_TURN_URL || "";
    const turnUsername = import.meta.env.VITE_TURN_USERNAME || "";
    const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL || "";

    const iceServers: RTCIceServer[] = [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun3.l.google.com:19302" },
      { urls: "stun:stun.cloudflare.com:3478" },
      { urls: "stun:global.stun.twilio.com:3478" },
    ];

    if (turnUrl) {
      const cleanUrl = turnUrl.replace(/^(turn:)/, "").replace(/\?.*$/, "");
      iceServers.push({
        urls: [
          `turn:${cleanUrl}?transport=udp`,
          `turn:${cleanUrl}?transport=tcp`,
        ],
        username: turnUsername,
        credential: turnCredential,
      });
    }

    const pc = new RTCPeerConnection({
      iceServers,
      iceCandidatePoolSize: 10,
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
    });

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    // Ensure audio and video transceivers are configured with proper direction
    const senders = pc.getSenders();
    const hasAudio = senders.some((s) => s.track && s.track.kind === "audio");
    const hasVideo = senders.some((s) => s.track && s.track.kind === "video");
    if (!hasAudio) {
      try { pc.addTransceiver("audio", { direction: "sendrecv" }); } catch {}
    }
    if (isVideo && !hasVideo) {
      try { pc.addTransceiver("video", { direction: "sendrecv" }); } catch {}
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendCallSignal("ice_candidate", targetUserId, { candidate: event.candidate });
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (import.meta.env.DEV) {
        console.log("[WebRTC] ICE Connection State:", pc.iceConnectionState);
      }
      if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
        setActiveCall((prev) => (prev ? { ...prev, status: "connected", statusText: "Connected" } : null));
        iceRestartCountRef.current = 0;
        tuneBitrate(pc, 800000);
        startStatsMonitor(pc);
      } else if (pc.iceConnectionState === "disconnected") {
        setActiveCall((prev) => (prev ? { ...prev, statusText: "Reconnecting..." } : null));
        if (iceRestartCountRef.current === 0) {
          iceRestartCountRef.current = 1;
          try {
            pc.restartIce();
          } catch {}
          setTimeout(() => {
            if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
              setActiveCall((prev) => (prev ? { ...prev, status: "ended", statusText: "Connection lost" } : null));
              setTimeout(() => cleanupMediaAndCall(), 2000);
            }
          }, 7000);
        }
      } else if (pc.iceConnectionState === "failed") {
        if (iceRestartCountRef.current === 0) {
          iceRestartCountRef.current = 1;
          try {
            pc.restartIce();
          } catch {
            setActiveCall((prev) => (prev ? { ...prev, status: "ended", statusText: "Connection lost" } : null));
            setTimeout(() => cleanupMediaAndCall(), 2000);
          }
        } else {
          setActiveCall((prev) => (prev ? { ...prev, status: "ended", statusText: "Connection lost" } : null));
          setTimeout(() => cleanupMediaAndCall(), 2000);
        }
      }
    };

    pc.ontrack = (event) => {
      let rStream = remoteStreamRef.current;
      if (!rStream) {
        rStream = event.streams[0] || new MediaStream();
        remoteStreamRef.current = rStream;
      }
      if (!rStream.getTracks().some((t) => t.id === event.track.id)) {
        rStream.addTrack(event.track);
      }
      setRemoteStream(rStream);

      // Bind remote audio element for clean, unmuted audio output without video echo
      if (remoteAudioRef.current && remoteAudioRef.current.srcObject !== rStream) {
        remoteAudioRef.current.srcObject = rStream;
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.play().catch(() => {});
      }
    };

    peerConnectionRef.current = pc;
    return pc;
  };

  const startCallWithUser = async (targetUser: User, video: boolean = false) => {
    cleanupMediaAndCall();
    requestMobileScreenTakeover();

    setActiveCall({
      partner: targetUser,
      status: "calling",
      statusText: "Calling...",
      duration: 0,
      isVideo: video,
      isMuted: false,
      isSpeaker: true,
      isCaller: true,
    });

    // Start outgoing telephone ring tone
    ringtoneCleanupRef.current = startCallerRingtone();

    // Prepare local camera and mic immediately
    if (video) {
      await setupLocalMedia(true, facingMode);
    } else {
      await setupLocalMedia(false);
    }

    // Set ringing status
    setActiveCall((prev) => (prev ? { ...prev, status: "ringing", statusText: "🔔 Ringing..." } : null));

    // Send call invite to callee
    await sendCallSignal("call_invite", targetUser.id, {
      isVideo: video,
      callId: `${Date.now()}-${user?.id}`,
    });

    // Ring steadily for 45s (gives recipient plenty of time to receive push notification, unlock, and answer)
    callDisconnectTimeoutRef.current = setTimeout(() => {
      if (ringtoneCleanupRef.current) {
        ringtoneCleanupRef.current();
        ringtoneCleanupRef.current = null;
      }
      playDisconnectTone();
      sendCallSignal("call_timeout", targetUser.id);
      sendMissedCallNotification(targetUser.id, video);
      setActiveCall((prev) =>
        prev
          ? {
              ...prev,
              status: "ended",
              statusText: "No answer",
            }
          : null
      );
      setTimeout(() => {
        setActiveCall(null);
        cleanupMediaAndCall();
      }, 2000);
    }, 45000);
  };

  const endCall = () => {
    if (activeCall) {
      if (activeCall.isCaller && (activeCall.status === "calling" || activeCall.status === "ringing")) {
        sendMissedCallNotification(activeCall.partner.id, activeCall.isVideo);
      }
      sendCallSignal("call_ended", activeCall.partner.id);
      playDisconnectTone();
      setActiveCall((prev) => (prev ? { ...prev, status: "ended", statusText: "Call ended" } : null));
      setTimeout(() => {
        setActiveCall(null);
        cleanupMediaAndCall();
      }, 600);
    }
  };

  const declineIncomingCall = () => {
    if (!incomingCall) return;
    if (ringtoneCleanupRef.current) {
      ringtoneCleanupRef.current();
      ringtoneCleanupRef.current = null;
    }
    if (incomingCallNotifRef.current) {
      incomingCallNotifRef.current.close();
      incomingCallNotifRef.current = null;
    }
    sendCallSignal("call_declined", incomingCall.caller.id);

    const caller = incomingCall.caller;
    const isVid = incomingCall.isVideo;
    setIncomingCall(null);

    // Record as missed call locally so user sees immediate history
    const missedNotif: Notification = {
      id: Date.now(),
      user_id: user?.id || 0,
      actor_id: caller.id,
      actor: caller,
      type: isVid ? "missed_video_call" : "missed_call",
      read: false,
      created_at: new Date().toISOString(),
    };
    setNotifications((prev) => [missedNotif, ...prev]);
    setUnreadCount((prev) => prev + 1);
  };

  const acceptIncomingCall = async () => {
    if (!incomingCall) return;
    if (ringtoneCleanupRef.current) {
      ringtoneCleanupRef.current();
      ringtoneCleanupRef.current = null;
    }
    if (incomingCallNotifRef.current) {
      incomingCallNotifRef.current.close();
      incomingCallNotifRef.current = null;
    }
    requestMobileScreenTakeover();

    const partner = incomingCall.caller;
    const isVideo = incomingCall.isVideo;
    setIncomingCall(null);

    // Picked up! Now set call as connected and start duration
    setActiveCall({
      partner,
      status: "connected",
      statusText: "Connected",
      duration: 0,
      isVideo,
      isMuted: false,
      isSpeaker: true,
      isCaller: false,
    });

    // Automatically turn device camera on if it's a video call!
    await setupLocalMedia(isVideo, "user");
    createPeerConnection(partner.id, isVideo);
    sendCallSignal("call_accepted", partner.id, { isVideo });
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      audioTracks.forEach((t) => (t.enabled = !t.enabled));
    }
    setActiveCall((prev) => (prev ? { ...prev, isMuted: !prev.isMuted } : null));
  };

  const toggleVideo = async () => {
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      if (videoTracks.length > 0) {
        const nextEnabled = !videoTracks[0].enabled;
        videoTracks.forEach((t) => (t.enabled = nextEnabled));
        setActiveCall((prev) => (prev ? { ...prev, isVideo: nextEnabled } : null));
        return;
      }
    }
    // If no video track yet, acquire camera
    try {
      const stream = await setupLocalMedia(true, facingMode);
      if (stream) {
        setActiveCall((prev) => (prev ? { ...prev, isVideo: true } : null));
      }
    } catch (err) {
      console.warn("Could not toggle video on", err);
    }
  };

  const toggleSpeaker = () => {
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = !remoteAudioRef.current.muted;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.muted = !remoteVideoRef.current.muted;
    }
    setActiveCall((prev) => (prev ? { ...prev, isSpeaker: !prev.isSpeaker } : null));
  };

  // Handle incoming call signaling events over WebSocket
  const handleIncomingCallSignal = async (signal: any) => {
    const currentActiveCall = activeCallRef.current;
    const fromUserId = signal.from_user_id;

    if (signal.type === "call_invite") {
      if ((currentActiveCall && currentActiveCall.status !== "ended") || incomingCallRef.current) {
        sendCallSignal("call_busy", fromUserId);
        return;
      }
      const callerUser: User = signal.caller || {
        id: fromUserId,
        username: `User_${fromUserId}`,
        email: "",
      };
      const isVideo = !!signal.data?.isVideo;
      setIncomingCall({
        caller: callerUser,
        isVideo,
        callId: signal.data?.callId,
      });
      if (ringtoneCleanupRef.current) ringtoneCleanupRef.current();
      ringtoneCleanupRef.current = startIncomingRingtone();

      if (callRingTimeoutRef.current) clearTimeout(callRingTimeoutRef.current);
      callRingTimeoutRef.current = setTimeout(() => {
        if (incomingCallRef.current) {
          if (ringtoneCleanupRef.current) {
            ringtoneCleanupRef.current();
            ringtoneCleanupRef.current = null;
          }
          if (incomingCallNotifRef.current) {
            incomingCallNotifRef.current.close();
            incomingCallNotifRef.current = null;
          }
          setIncomingCall(null);
        }
      }, 48000);

      // Show system notification when app is backgrounded
      if (typeof window !== "undefined" && "Notification" in window) {
        if (Notification.permission === "granted") {
          try {
            const notifTitle = isVideo
              ? `📹 Incoming Video Call from ${callerUser.name || callerUser.username}`
              : `📞 Incoming Voice Call from ${callerUser.name || callerUser.username}`;
            const sysNotif = new Notification(notifTitle, {
              body: "DevNest • Tap to answer immediately",
              icon: callerUser.avatar_url || "/favicon.ico",
              tag: "devnest-incoming-call",
              requireInteraction: true,
              vibrate: [600, 300, 600, 300, 600, 300, 1000],
            } as any);
            sysNotif.onclick = () => {
              window.focus();
              requestMobileScreenTakeover();
              sysNotif.close();
            };
            incomingCallNotifRef.current = sysNotif;
          } catch (e) {
            console.warn("Could not show system call notification", e);
          }
        } else if (Notification.permission === "default") {
          Notification.requestPermission().catch(() => {});
        }
      }
    } else if (signal.type === "call_accepted") {
      if (ringtoneCleanupRef.current) {
        ringtoneCleanupRef.current();
        ringtoneCleanupRef.current = null;
      }
      if (incomingCallNotifRef.current) {
        incomingCallNotifRef.current.close();
        incomingCallNotifRef.current = null;
      }
      clearTimeout(callDisconnectTimeoutRef.current);

      setActiveCall((prev) =>
        prev
          ? {
              ...prev,
              status: "connected",
              statusText: "Connected",
              duration: 0,
            }
          : null
      );

      // Caller sets up media and creates WebRTC Offer
      const isVideo = !!signal.data?.isVideo || !!currentActiveCall?.isVideo;
      if (!localStreamRef.current) {
        await setupLocalMedia(isVideo, "user");
      }
      const pc = createPeerConnection(fromUserId, isVideo);
      try {
        const offer = await pc.createOffer();
        if (offer.sdp) {
          offer.sdp = offer.sdp.replace(/(a=fmtp:\d+ .*)/g, (line) =>
            line.toLowerCase().includes("opus") && !line.includes("usedtx=1") ? `${line};usedtx=1` : line
          );
        }
        await pc.setLocalDescription(offer);
        sendCallSignal("webrtc_offer", fromUserId, { sdp: offer, isVideo });
      } catch (err) {
        console.error("Failed to create offer", err);
      }
    } else if (signal.type === "call_declined") {
      if (ringtoneCleanupRef.current) {
        ringtoneCleanupRef.current();
        ringtoneCleanupRef.current = null;
      }
      if (incomingCallNotifRef.current) {
        incomingCallNotifRef.current.close();
        incomingCallNotifRef.current = null;
      }
      clearTimeout(callDisconnectTimeoutRef.current);
      playDisconnectTone();
      setActiveCall((prev) =>
        prev
          ? {
              ...prev,
              status: "ended",
              statusText: "Call declined",
            }
          : null
      );
      setTimeout(() => {
        setActiveCall(null);
        cleanupMediaAndCall();
      }, 2000);
    } else if (signal.type === "call_busy") {
      if (ringtoneCleanupRef.current) {
        ringtoneCleanupRef.current();
        ringtoneCleanupRef.current = null;
      }
      if (incomingCallNotifRef.current) {
        incomingCallNotifRef.current.close();
        incomingCallNotifRef.current = null;
      }
      clearTimeout(callDisconnectTimeoutRef.current);
      playDisconnectTone();
      setActiveCall((prev) =>
        prev
          ? {
              ...prev,
              status: "ended",
              statusText: "User is busy on another call",
            }
          : null
      );
      setTimeout(() => {
        setActiveCall(null);
        cleanupMediaAndCall();
      }, 2500);
    } else if (signal.type === "call_timeout") {
      if (ringtoneCleanupRef.current) {
        ringtoneCleanupRef.current();
        ringtoneCleanupRef.current = null;
      }
      if (incomingCallNotifRef.current) {
        incomingCallNotifRef.current.close();
        incomingCallNotifRef.current = null;
      }
      playDisconnectTone();
      if (incomingCallRef.current) {
        const caller = incomingCallRef.current.caller;
        const isVid = incomingCallRef.current.isVideo;
        const missedNotif: Notification = {
          id: Date.now(),
          user_id: userRef.current?.id || 0,
          actor_id: caller.id,
          actor: caller,
          type: isVid ? "missed_video_call" : "missed_call",
          read: false,
          created_at: new Date().toISOString(),
        };
        setNotifications((prev) => [missedNotif, ...prev]);
        setUnreadCount((prev) => prev + 1);

        if (document.hidden && "Notification" in window && Notification.permission === "granted") {
          try {
            new Notification(isVid ? "📹❌ Missed Video Call" : "📵 Missed Audio Call", {
              body: `Missed call from ${caller.name || caller.username}. Tap to call back.`,
              icon: caller.avatar_url || "/favicon.ico",
              tag: `missed-call-${Date.now()}`,
            });
          } catch {}
        }
      }
      setIncomingCall(null);
    } else if (signal.type === "webrtc_offer") {
      const isVideo = !!signal.data?.isVideo || !!currentActiveCall?.isVideo;
      if (!localStreamRef.current) {
        await setupLocalMedia(isVideo, "user");
      }
      let pc = peerConnectionRef.current;
      if (!pc) {
        pc = createPeerConnection(fromUserId, isVideo);
      }
      if (pc && signal.data?.sdp) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.data.sdp));
          // Drain queued ICE candidates
          while (iceQueueRef.current.length > 0) {
            const cand = iceQueueRef.current.shift();
            try {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch {}
          }
          const answer = await pc.createAnswer();
          if (answer.sdp) {
            answer.sdp = answer.sdp.replace(/(a=fmtp:\d+ .*)/g, (line) =>
              line.toLowerCase().includes("opus") && !line.includes("usedtx=1") ? `${line};usedtx=1` : line
            );
          }
          await pc.setLocalDescription(answer);
          tuneBitrate(pc, 800000);
          sendCallSignal("webrtc_answer", fromUserId, { sdp: answer, isVideo });
        } catch (err) {
          console.error("Failed to handle offer", err);
        }
      }
    } else if (signal.type === "webrtc_answer") {
      const pc = peerConnectionRef.current;
      if (pc && signal.data?.sdp) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.data.sdp));
          // Drain queued ICE candidates
          while (iceQueueRef.current.length > 0) {
            const cand = iceQueueRef.current.shift();
            try {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch {}
          }
          tuneBitrate(pc, 800000);
        } catch (err) {
          console.error("Failed to set remote description answer", err);
        }
      }
    } else if (signal.type === "ice_candidate") {
      const pc = peerConnectionRef.current;
      if (signal.data?.candidate) {
        if (pc && pc.remoteDescription && pc.remoteDescription.type) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(signal.data.candidate));
          } catch (err) {
            console.error("Failed to add ice candidate", err);
          }
        } else {
          iceQueueRef.current.push(signal.data.candidate);
        }
      }
    } else if (signal.type === "call_ended") {
      if (ringtoneCleanupRef.current) {
        ringtoneCleanupRef.current();
        ringtoneCleanupRef.current = null;
      }
      if (incomingCallNotifRef.current) {
        incomingCallNotifRef.current.close();
        incomingCallNotifRef.current = null;
      }
      playDisconnectTone();
      if (incomingCallRef.current) {
        const caller = incomingCallRef.current.caller;
        const isVid = incomingCallRef.current.isVideo;
        const missedNotif: Notification = {
          id: Date.now(),
          user_id: userRef.current?.id || 0,
          actor_id: caller.id,
          actor: caller,
          type: isVid ? "missed_video_call" : "missed_call",
          read: false,
          created_at: new Date().toISOString(),
        };
        setNotifications((prev) => [missedNotif, ...prev]);
        setUnreadCount((prev) => prev + 1);

        if (document.hidden && "Notification" in window && Notification.permission === "granted") {
          try {
            new Notification(isVid ? "📹❌ Missed Video Call" : "📵 Missed Audio Call", {
              body: `Missed call from ${caller.name || caller.username}. Tap to call back.`,
              icon: caller.avatar_url || "/favicon.ico",
              tag: `missed-call-${Date.now()}`,
            });
          } catch {}
        }
      }
      setIncomingCall(null);
      setActiveCall((prev) =>
        prev
          ? {
              ...prev,
              status: "ended",
              statusText: "Call ended",
            }
          : null
      );
      setTimeout(() => {
        setActiveCall(null);
        cleanupMediaAndCall();
      }, 1500);
    }
  };

  // Safe binding for remote audio only (video is managed jitter-free by VideoFeed component)
  useEffect(() => {
    if (remoteAudioRef.current && remoteStream) {
      if (remoteAudioRef.current.srcObject !== remoteStream) {
        remoteAudioRef.current.srcObject = remoteStream;
      }
      remoteAudioRef.current.play().catch(() => {});
    }
  }, [remoteStream]);

  const fetchNotifications = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/notifications`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        if (data.unread_count !== undefined) {
          setUnreadCount(data.unread_count);
        }
      }
    } catch (err) {
      console.error("Failed to fetch notifications", err);
    }
  };

  const registerDevicePushToken = async (authToken: string) => {
    try {
      let deviceToken = localStorage.getItem("devnest_device_token");
      let platform = "web";
      const isCapacitor = !!(window as any).Capacitor?.isNativePlatform?.();

      if (isCapacitor) {
        platform = (window as any).Capacitor.getPlatform() || "android";
        if ((window as any).PushNotifications) {
          try {
            const perm = await (window as any).PushNotifications.requestPermissions();
            if (perm.receive === "granted") {
              await (window as any).PushNotifications.register();
            }
          } catch {}
        }
      }

      if (!deviceToken) {
        deviceToken = (isCapacitor ? "mobile_" : "web_") + Math.random().toString(36).substring(2) + "_" + Date.now();
        localStorage.setItem("devnest_device_token", deviceToken);
      }

      await fetch(`${API_URL}/api/devices`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          token: deviceToken,
          platform,
        }),
      });
    } catch (err) {
      console.warn("Device token registration warning:", err);
    }
  };

  const unregisterDevicePushToken = async (authToken: string) => {
    const deviceToken = localStorage.getItem("devnest_device_token");
    if (deviceToken && authToken) {
      try {
        await fetch(`${API_URL}/api/devices`, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ token: deviceToken }),
        });
      } catch {}
    }
  };

  // Register device push token on auth mount
  useEffect(() => {
    if (!token) return;
    fetchNotifications();
    registerDevicePushToken(token);
  }, [token]);

  // Deep-link / native intent handler when incoming call notification is tapped
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const action = params.get("action");
    const callId = params.get("callId");
    const callerIdStr = params.get("callerId");
    if (action === "answer" && callerIdStr) {
      setTimeout(() => {
        acceptIncomingCall();
      }, 500);
    } else if (action === "decline" && callerIdStr) {
      const callerId = parseInt(callerIdStr, 10);
      if (!isNaN(callerId)) {
        sendCallSignal("call_declined", callerId, { callId });
      }
    }

    if ((window as any).Capacitor?.Plugins?.App) {
      try {
        (window as any).Capacitor.Plugins.App.addListener("appUrlOpen", (data: any) => {
          try {
            const url = new URL(data.url);
            const act = url.searchParams.get("action");
            const cId = url.searchParams.get("callId");
            const caller = url.searchParams.get("callerId");
            if (act === "answer") {
              acceptIncomingCall();
            } else if (act === "decline" && caller) {
              const cNum = parseInt(caller, 10);
              if (!isNaN(cNum)) sendCallSignal("call_declined", cNum, { callId: cId });
            }
          } catch {}
        });
      } catch {}
    }
  }, []);

  // -----------------------------
  // WEBSOCKET FOR NOTIFICATIONS & CALL SIGNALING
  // -----------------------------
  useEffect(() => {
    if (!token) return;
    let isSubscribed = true;
    let reconnectTimeout: any = null;
    let pingInterval: any = null;

    const connectWs = () => {
      if (!isSubscribed) return;
      try {
        const ws = new WebSocket(`${WS_BASE_URL}/ws?token=${token}`);
        wsRef.current = ws;

        ws.onopen = () => {
          // Heartbeat keepalive every 20s
          if (pingInterval) clearInterval(pingInterval);
          pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "ping" }));
            }
          }, 20000);
          fetchCommunityStats();
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "pong") return;
            if (data.event === "presence" || data.type === "presence") {
              fetchCommunityStats();
              return;
            }
            if (data.event === "message" && data.message) {
              const incoming = data.message;
              if (
                activeChatPartnerRef.current &&
                (incoming.sender_id === activeChatPartnerRef.current.id || incoming.recipient_id === activeChatPartnerRef.current.id)
              ) {
                setChatMessages((prev) => {
                  if (prev.some((m) => m.id === incoming.id)) return prev;
                  return [...prev, incoming];
                });
              }
              return;
            }
            if (data.event === "notification" && data.notification) {
              setNotifications((prev) => [data.notification, ...prev]);
              setUnreadCount((prev) => prev + 1);

              if (data.notification.type === "missed_call" || data.notification.type === "missed_video_call") {
                if (document.hidden && "Notification" in window && Notification.permission === "granted") {
                  const isVid = data.notification.type === "missed_video_call";
                  const callerName = data.notification.actor?.name || data.notification.actor?.username || "Someone";
                  try {
                    new Notification(isVid ? "📹❌ Missed Video Call" : "📵 Missed Audio Call", {
                      body: `Missed call from ${callerName}. Tap to open DevNest.`,
                      icon: data.notification.actor?.avatar_url || "/favicon.ico",
                      tag: `missed-call-${data.notification.id || Date.now()}`,
                    });
                  } catch {}
                }
              }
            } else if (
              data.event === "call_signal" ||
              (data.type && (data.type.startsWith("call_") || data.type.startsWith("webrtc_") || data.type === "ice_candidate"))
            ) {
              handleIncomingCallSignal(data);
            }
          } catch (err) {
            console.error("Failed to parse WS message", err);
          }
        };

        ws.onclose = () => {
          clearInterval(pingInterval);
          if (isSubscribed) {
            reconnectTimeout = setTimeout(connectWs, 2000);
          }
        };

        ws.onerror = (err) => {
          console.warn("[WS] Error", err);
          ws.close();
        };
      } catch (e) {
        if (isSubscribed) {
          reconnectTimeout = setTimeout(connectWs, 3000);
        }
      }
    };

    connectWs();

    return () => {
      isSubscribed = false;
      clearTimeout(reconnectTimeout);
      clearInterval(pingInterval);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [token]);

  // -----------------------------
  // FETCH COMMUNITY STATS
  // -----------------------------
  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/api/community/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setCommunityStats(data);
        }
      })
      .catch((err) => console.warn("Failed to load community stats", err));
  }, [token]);

  // -----------------------------
  // FETCH USER PROFILE ("ME")
  // -----------------------------
  const fetchMe = async (jwt: string): Promise<User | null> => {
    try {
      const res = await fetch(`${API_URL}/api/me`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (res.ok) {
        const data: User = await res.json();
        setUser(data);
        return data;
      } else {
        localStorage.removeItem("token");
        setToken(null);
        return null;
      }
    } catch {
      localStorage.removeItem("token");
      setToken(null);
      return null;
    }
  };

  useEffect(() => {
    if (token) {
      fetchMe(token);
    }
  }, [token]);

  // -----------------------------
  // FETCH FEED POSTS
  // -----------------------------
  const fetchPosts = async (pageNum: number = 1, comm = selectedCommunity) => {
    if (!token) return;
    try {
      const commParam = comm && comm !== "all" ? `&community=${encodeURIComponent(comm)}` : "";
      const res = await fetch(
        `${API_URL}/api/posts?page=${pageNum}&limit=30${commParam}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (res.ok) {
        const data: Post[] = await res.json();

        // Only real posts from the database - zero system-induced fake likes
        const fetchedPosts = data || [];

        const dedupe = (arr: Post[]) => {
          const seen = new Set<number>();
          return arr.filter((p) => {
            if (seen.has(p.id)) return false;
            seen.add(p.id);
            return true;
          });
        };

        if (pageNum === 1) {
          setPosts(dedupe(fetchedPosts));
        } else {
          setPosts((prev) => dedupe([...prev, ...fetchedPosts]));
        }
      }
    } catch (err) {
      console.error("Could not fetch live feed.", err);
    }
  };

  useEffect(() => {
    if (!token) return;
    fetchPosts(1, selectedCommunity);
  }, [selectedCommunity, token]);

  // -----------------------------
  // USER SEARCH AUTOCOMPLETE
  // -----------------------------
  useEffect(() => {
    if (!token) return;
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const delayDebounce = setTimeout(async () => {
      try {
        const res = await fetch(`${API_URL}/api/users/search?q=${encodeURIComponent(searchQuery)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data || []);
        }
      } catch (err) {
        console.error("Search error", err);
      }
    }, 250);

    return () => clearTimeout(delayDebounce);
  }, [searchQuery, token]);

  // -----------------------------
  // CLOSE DROPDOWNS ON OUTSIDE CLICK
  // -----------------------------
  useEffect(() => {
    const closeAllDropdowns = () => {
      setActiveDropdown(null);
    };
    window.addEventListener("click", closeAllDropdowns);
    return () => window.removeEventListener("click", closeAllDropdowns);
  }, []);

  // -----------------------------
  // NOTIFICATIONS HELPERS
  // -----------------------------
  const markNotificationRead = async (id: number) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnreadCount((prev) => Math.max(0, prev - 1));
    try {
      await fetch(`${API_URL}/api/notifications/${id}/read`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      console.error("Failed to mark notification read", err);
    }
  };

  const markAllNotificationsRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    try {
      await fetch(`${API_URL}/api/notifications/read-all`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      console.error("Failed to mark all notifications read", err);
    }
  };

  const notificationText = (n: Notification) => {
    const name = n.actor?.name || n.actor?.username || "Someone";
    if (n.type === "like") return `${name} liked your post`;
    if (n.type === "comment") return `${name} commented on your post`;
    if (n.type === "follow") return `${name} started following you`;
    if (n.type === "mention") return `${name} mentioned you in a post`;
    if (n.type === "repost") return `${name} reposted your post`;
    if (n.type === "missed_call") return `Missed audio call from @${n.actor?.username || name}`;
    if (n.type === "missed_video_call") return `Missed video call from @${n.actor?.username || name}`;
    return `${name} interacted with your post`;
  };

  // -----------------------------
  // POST ACTIONS: CREATE, LIKE, DELETE
  // -----------------------------
  const createPost = async () => {
    if (!newPost.trim() && !selectedFile) return;
    setUploadingMedia(true);

    try {
      let uploadedUrl = "";
      if (selectedFile) {
        const formData = new FormData();
        formData.append("file", selectedFile);

        const uploadRes = await fetch(`${API_URL}/api/upload`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });

        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          uploadedUrl = uploadData.url;
        }
      }

      const res = await fetch(`${API_URL}/api/posts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          content: newPost,
          media_url: uploadedUrl,
          community: selectedCommunity || "general",
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const newPostObj: Post = {
          ...data,
          likes: 0,
          comments: [],
          user: data.user && data.user.username ? data.user : user || { id: 0, username: "Anonymous", email: "" },
        };
        setPosts((prev) => [newPostObj, ...prev]);
        setNewPost("");
        setSelectedFile(null);
        setMediaPreview(null);
        setPage("feed");
      } else {
        alert("Failed to publish post.");
      }
    } catch (err) {
      console.error("Error creating post", err);
    } finally {
      setUploadingMedia(false);
    }
  };

  const handleLike = async (postId: number) => {
    try {
      const res = await fetch(`${API_URL}/api/posts/${postId}/like`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setPosts((prev) =>
          prev.map((p) => (p.id === postId ? { ...p, likes: data.likes, liked_by_me: data.liked } : p))
        );
        setProfilePosts((prev) =>
          prev.map((p) => (p.id === postId ? { ...p, likes: data.likes, liked_by_me: data.liked } : p))
        );
      }
    } catch (err) {
      console.error("Like error", err);
    }
  };

  const handleSharePost = async (post: Post) => {
    const postUrl = `${window.location.origin}/?post=${post.id}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Nesty Post",
          text: post.content,
          url: postUrl,
        });
        return;
      } catch (err: any) {
        if (err.name === "AbortError") return;
      }
    }
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(postUrl);
        alert("Post link copied to clipboard!");
      } else {
        prompt("Copy post link:", postUrl);
      }
    } catch {
      prompt("Copy post link:", postUrl);
    }
  };

  const deletePost = async (id: number) => {
    if (!confirm("Are you sure you want to delete this post?")) return;
    try {
      const res = await fetch(`${API_URL}/api/posts/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setPosts((prev) => prev.filter((p) => p.id !== id));
        setProfilePosts((prev) => prev.filter((p) => p.id !== id));
      }
    } catch (err) {
      console.error("Delete error", err);
    }
  };

  const handleAddComment = async (postId: number) => {
    const text = commentInputs[postId];
    if (!text || !text.trim()) return;

    try {
      const res = await fetch(`${API_URL}/api/posts/${postId}/comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content: text.trim() }),
      });

      if (res.ok) {
        const commentData = await res.json();
        const newComment: Comment = {
          ...commentData,
          user: commentData.user || user || { id: 0, username: "You", email: "" },
        };
        setPosts((prev) =>
          prev.map((p) =>
            p.id === postId ? { ...p, comments: [...(p.comments || []), newComment] } : p
          )
        );
        setProfilePosts((prev) =>
          prev.map((p) =>
            p.id === postId ? { ...p, comments: [...(p.comments || []), newComment] } : p
          )
        );
        setCommentInputs((prev) => ({ ...prev, [postId]: "" }));
      }
    } catch (err) {
      console.error("Add comment error", err);
    }
  };

  // -----------------------------
  // PROFILE VIEW LOGIC
  // -----------------------------
  const openMyProfile = () => {
    setProfileData(null);
    setProfilePosts([]);
    const myId = user?.id;
    setViewedUserId(myId || null);
    setPage("profile");
    setMobileMenuOpen(false);

    if (myId) {
      fetchProfile(myId);
    } else if (token) {
      fetchMe(token).then((me) => {
        if (me?.id) {
          setViewedUserId(me.id);
          fetchProfile(me.id);
        }
      });
    }
  };

  const openProfile = (userId: number) => {
    setProfileData(null);
    setProfilePosts([]);
    setViewedUserId(userId);
    setPage("profile");
    setMobileMenuOpen(false);
    fetchProfile(userId);
  };

  const handleLogout = () => {
    if (confirm("Are you sure you want to log out?")) {
      if (token) {
        unregisterDevicePushToken(token);
      }
      localStorage.removeItem("token");
      setToken(null);
      setUser(null);
      setPage("feed");
      setMobileMenuOpen(false);
      cleanupMediaAndCall();
    }
  };
  (window as any).handleLogout = handleLogout;

  const fetchProfile = async (userId: number) => {
    try {
      const [profileRes, postsRes] = await Promise.all([
        fetch(`${API_URL}/api/users/${userId}/profile`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_URL}/api/users/${userId}/posts?page=1&limit=30`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (profileRes.ok) {
        const data = await profileRes.json();
        setProfileData(data);
      }
      if (postsRes.ok) {
        const data = await postsRes.json();
        setProfilePosts(data || []);
      }
    } catch (err) {
      console.error("Failed to load profile", err);
    }
  };

  useEffect(() => {
    if (page !== "profile" || !token) return;
    const targetId = viewedUserId ?? user?.id;
    if (targetId) fetchProfile(targetId);
  }, [page, viewedUserId, token]);

  // Pull-to-refresh handler
  const triggerRefresh = async () => {
    setIsRefreshing(true);
    setPullDistance(52);
    try {
      const promises: Promise<any>[] = [
        fetchPosts(1, selectedCommunity),
        fetchNotifications(),
        fetchCommunityStats(),
      ];
      if (page === "profile") {
        const targetId = viewedUserId ?? user?.id;
        if (targetId) {
          promises.push(fetchProfile(targetId));
        }
      }
      await Promise.allSettled(promises);
    } catch (e) {
      console.error("Refresh error:", e);
    } finally {
      setTimeout(() => {
        setIsRefreshing(false);
        setPullDistance(0);
      }, 500);
    }
  };

  useEffect(() => {
    let startY = 0;
    let startX = 0;
    let pulling = false;

    const onStart = (clientY: number, clientX: number) => {
      const scrollY = centerFeedRef.current ? centerFeedRef.current.scrollTop : window.scrollY;
      if (scrollY <= 4 && !mobileMenuOpen && !isRefreshing) {
        startY = clientY;
        startX = clientX;
        pulling = true;
        isPullingRef.current = true;
      }
    };

    const onMove = (clientY: number, clientX: number, cancelable: boolean, prevent: () => void) => {
      if (!pulling || isRefreshing) return;
      const diffY = clientY - startY;
      const diffX = Math.abs(clientX - startX);
      const scrollY = centerFeedRef.current ? centerFeedRef.current.scrollTop : window.scrollY;

      if (diffY > 0 && diffY > diffX && scrollY <= 4) {
        const dist = Math.min(diffY * 0.42, 65);
        setPullDistance(dist);
        if (cancelable && diffY > 8) {
          prevent();
        }
      } else if (diffY < 0) {
        pulling = false;
        isPullingRef.current = false;
        setPullDistance(0);
      }
    };

    const onEnd = () => {
      if (!pulling) return;
      pulling = false;
      isPullingRef.current = false;
      setPullDistance((current) => {
        if (current >= 45) {
          triggerRefresh();
          return 50;
        }
        return 0;
      });
    };

    const handleTouchStart = (e: TouchEvent) => onStart(e.touches[0].clientY, e.touches[0].clientX);
    const handleTouchMove = (e: TouchEvent) =>
      onMove(e.touches[0].clientY, e.touches[0].clientX, e.cancelable, () => e.preventDefault());
    const handleTouchEnd = () => onEnd();

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [mobileMenuOpen, isRefreshing, page, viewedUserId, user, selectedCommunity]);

  const toggleFollow = async () => {
    if (!profileData || profileData.is_self) return;
    setFollowBusy(true);
    const targetId = profileData.user.id;
    try {
      const res = await fetch(`${API_URL}/api/users/${targetId}/follow`, {
        method: profileData.is_following ? "DELETE" : "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setProfileData((prev) =>
          prev
            ? {
                ...prev,
                is_following: !prev.is_following,
                follower_count: prev.is_following ? prev.follower_count - 1 : prev.follower_count + 1,
              }
            : null
        );
      }
    } catch (err) {
      console.error("Failed to toggle follow", err);
    } finally {
      setFollowBusy(false);
    }
  };

  useEffect(() => {
    if (!followListModal || !token) return;
    setFollowListLoading(true);
    fetch(`${API_URL}/api/users/${followListModal.userId}/${followListModal.type}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setFollowListUsers(data || []))
      .catch(() => setFollowListUsers([]))
      .finally(() => setFollowListLoading(false));
  }, [followListModal, token]);

  // -----------------------------
  // AUTH LOGIC
  // -----------------------------
  const login = async () => {
    setAuthError(null);
    setAuthSuccess(null);
    if (!email.trim() || !password) {
      setAuthError("Please enter your email or username and password.");
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem("token", data.token);
        setToken(data.token);
        fetchMe(data.token);
      } else {
        const msg =
          data.error === "user not found"
            ? "No account found with this email or username. Don't have an account? Click 'Sign Up' below."
            : data.error === "password mismatch"
            ? "Incorrect password. If you forgot your password, click 'Forgot Password?' below to reset it."
            : data.error || "Login failed";
        setAuthError(msg);
      }
    } catch {
      setAuthError("Cannot connect to server  Please ensure the backend is running.");
    }
  };

  const handleRegister = async () => {
    setAuthError(null);
    setAuthSuccess(null);
    if (!username.trim() || !email.trim() || !password) {
      setAuthError("Please fill out all fields.");
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, username: username.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setAuthSuccess("Registration successful! You can now sign in.");
        setAuthMode("login");
      } else {
        setAuthError(data.error || "Registration failed");
      }
    } catch {
      setAuthError("Cannot connect to server ");
    }
  };

  const handleForgotPassword = async () => {
    setAuthError(null);
    setAuthSuccess(null);
    if (!email.trim() || !password) {
      setAuthError("Please enter your email or username and your new password.");
      return;
    }
    if (password !== confirmPassword) {
      setAuthError("Passwords do not match");
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), new_password: password }),
      });
      const data = await res.json();
      if (res.ok) {
        setAuthSuccess("Password updated successfully! You can now sign in with your new password.");
        setAuthMode("login");
      } else {
        setAuthError(data.error || "Reset failed");
      }
    } catch {
      setAuthError("Cannot connect to server ");
    }
  };

  // -----------------------------
  // TEXT FORMATTING WITH MENTIONS
  // -----------------------------
  const renderWithMentions = (text: string) => {
    const parts = text.split(/(@[a-zA-Z0-9_]+)/g);
    return parts.map((part, i) => {
      if (part.startsWith("@")) {
        const cleanUsername = part.substring(1);
        return (
          <span
            key={i}
            style={{ color: "#047857", fontWeight: 600, cursor: "pointer" }}
            onClick={(e) => {
              e.stopPropagation();
              fetch(`${API_URL}/api/users/by-username/${cleanUsername}`, {
                headers: { Authorization: `Bearer ${token}` },
              })
                .then((r) => r.json())
                .then((u) => u.id && openProfile(u.id))
                .catch(() => alert(`User @${cleanUsername} not found`));
            }}
          >
            {part}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  // -----------------------------
  // RENDER AUTH VIEW (WHEN NOT LOGGED IN)
  // -----------------------------
  if (!token) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          {/* Logo container left blank per instruction: "leave the logo blank until I come up with one." */}
          <img src="/nesty-logo.png" alt="Nesty" className="auth-brand-logo-img" />
          <h1 className="auth-title">Nesty</h1>
          <p className="auth-subtitle">
            {authMode === "login"
              ? "A space for Piscine candidates to build, learn and grow"
              : authMode === "register"
              ? "Create your developer profile"
              : "Reset your account password"}
          </p>

          {authError && <div className="auth-alert auth-alert-error">{authError}</div>}
          {authSuccess && <div className="auth-alert auth-alert-success">{authSuccess}</div>}

          {authMode === "register" && (
            <input
              className="auth-input"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          )}

          <input
            className="auth-input"
            placeholder={authMode === "register" ? "Email" : "Email or Username"}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <div className="password-input-wrapper">
            <input
              className="auth-input"
              placeholder={authMode === "forgot" ? "New Password" : "Password"}
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (authMode === "login") login();
                  else if (authMode === "register") handleRegister();
                  else handleForgotPassword();
                }
              }}
            />
            <button
              type="button"
              className="password-toggle-btn"
              onClick={() => setShowPassword(!showPassword)}
              title={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? "🙈" : "👁️"}
            </button>
          </div>

          {authMode === "forgot" && (
            <div className="password-input-wrapper">
              <input
                className="auth-input"
                placeholder="Confirm New Password"
                type={showConfirmPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              >
                {showConfirmPassword ? "🙈" : "👁️"}
              </button>
            </div>
          )}

          <button
            className="auth-submit-btn"
            onClick={
              authMode === "login"
                ? login
                : authMode === "register"
                ? handleRegister
                : handleForgotPassword
            }
          >
            {authMode === "login" ? "Sign In" : authMode === "register" ? "Create Account" : "Reset Password"}
          </button>

          <div className="auth-toggle-row">
            {authMode === "login" ? (
              <>
                <span>Don't have an account?</span>
                <button
                  className="auth-link-btn"
                  onClick={() => {
                    setAuthError(null);
                    setAuthSuccess(null);
                    setAuthMode("register");
                  }}
                >
                  Sign Up
                </button>
                <span>·</span>
                <button
                  className="auth-link-btn"
                  onClick={() => {
                    setAuthError(null);
                    setAuthSuccess(null);
                    setAuthMode("forgot");
                  }}
                >
                  Forgot Password?
                </button>
              </>
            ) : (
              <>
                <span>Already have an account?</span>
                <button
                  className="auth-link-btn"
                  onClick={() => {
                    setAuthError(null);
                    setAuthSuccess(null);
                    setAuthMode("login");
                  }}
                >
                  Sign In
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Active channel title and subtitle
  const activeChannel = communities.find((c) => c.id === selectedCommunity) || communities[0];
  const pageTitle = page === "profile" ? "Profile" : page === "create" ? "Create Post" : activeChannel.name;
  const pageSub =
    page === "profile"
      ? "Your page on Nesty"
      : page === "create"
      ? "Share a win, bug, idea, or question."
      : activeChannel.subtitle;

  return (
    <div className="nesty-app">
      {/* MOBILE TOP BAR */}
      <div className="mobile-top-bar">
        <button
          className="hamburger-btn"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle Menu"
        >
          {mobileMenuOpen ? "✕" : "☰"}
        </button>
        <div
          className="mobile-bar-title"
          onClick={() => {
            setPage("feed");
            setSelectedCommunity("general");
            setMobileMenuOpen(false);
          }}
        >
          <img src="/nesty-logo.png" alt="Nesty" className="mobile-bar-logo" />
          <span>Nesty</span>
        </div>
        <div className="mobile-bar-actions">
          <button
            className="mobile-bar-icon-btn"
            title="Messages"
            onClick={() => {
              const partner = communityStats.online_users.find((u) => u.id && u.id !== user?.id);
              if (partner && partner.id) {
                startChatWithUser({ id: partner.id, username: partner.username, email: "" });
              } else {
                setMobileMenuOpen(true);
              }
            }}
          >
            💬
          </button>
          <button
            className="mobile-bar-icon-btn"
            title="Notifications"
            onClick={() => setNotifOpen(!notifOpen)}
          >
            🔔
            {unreadCount > 0 && <span className="mobile-badge-count">{unreadCount}</span>}
          </button>
        </div>
      </div>

      {/* MOBILE BACKDROP OVERLAY */}
      {mobileMenuOpen && (
        <div
          className="mobile-drawer-backdrop"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* =====================================================================
          1. LEFT COLUMN: NAVIGATION SIDEBAR (FOREST SLATE THEME)
          ===================================================================== */}
      <aside ref={sidebarLeftRef} className={`nesty-sidebar-left ${mobileMenuOpen ? "open-drawer" : ""}`}>
        {/* BRAND HEADER */}
        <div
          className="brand-header"
          onClick={() => {
            setPage("feed");
            setSelectedCommunity("general");
            setMobileMenuOpen(false);
          }}
        >
          {/* Logo container left blank per instruction: "leave the logo blank until I come up with one." */}
          <img src="/nesty-logo.png" alt="Nesty" className="brand-logo-img" />
          <div className="brand-text-col">
            <span className="brand-title">Nesty</span>
            <span className="brand-subtitle">Build · Learn · Grow</span>
          </div>
        </div>

        {/* SEARCH INPUT WITH ⌘K */}
        <div className="sidebar-search-box">
          <span className="search-icon-left">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <input
            className="sidebar-search-input"
            placeholder="Search Nesty..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
          />
          <span className="search-shortcut-badge">⌘K</span>

          {searchFocused && searchResults.length > 0 && (
            <div className="sidebar-search-results">
              {searchResults.map((u) => (
                <div
                  key={u.id}
                  className="search-result-row"
                  onMouseDown={() => {
                    openProfile(u.id);
                    setSearchQuery("");
                  }}
                >
                  <div className="search-avatar-mini">
                    {u.avatar_url ? <img src={u.avatar_url} alt="" /> : u.username.charAt(0).toUpperCase()}
                  </div>
                  <div className="search-user-meta">
                    <span className="search-user-name">{u.name || u.username}</span>
                    <span className="search-user-handle">@{u.username}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* MAIN NAVIGATION GROUP */}
        <div className="sidebar-nav-group">
          <button
            data-nav="home"
            className={`nav-item-btn ${page === "feed" && selectedCommunity === "general" ? "active" : ""}`}
            onClick={() => {
              setPage("feed");
              setSelectedCommunity("general");
              setMobileMenuOpen(false);
            }}
          >
            <span className="nav-item-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </span>
            <span>Home</span>
          </button>

          <button
            data-nav="feed"
            className={`nav-item-btn ${page === "feed" && selectedCommunity !== "general" ? "active" : ""}`}
            onClick={() => {
              setPage("feed");
              setMobileMenuOpen(false);
            }}
          >
            <span className="nav-item-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </span>
            <span>Feed</span>
          </button>

          <button
            data-nav="create"
            className={`nav-item-btn ${page === "create" ? "active" : ""}`}
            onClick={() => {
              setPage("create");
              setMobileMenuOpen(false);
            }}
          >
            <span className="nav-item-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </span>
            <span>Create Post</span>
          </button>

          <button
            data-nav="profile"
            className={`nav-item-btn ${page === "profile" && (viewedUserId === user?.id || viewedUserId === null) ? "active" : ""}`}
            onClick={openMyProfile}
          >
            <span className="nav-item-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </span>
            <span>Profile</span>
          </button>

          <button
            data-nav="messages"
            className="nav-item-btn"
            onClick={() => {
              const partner = communityStats.online_users.find((u) => u.id && u.id !== user?.id);
              if (partner && partner.id) {
                startChatWithUser({ id: partner.id, username: partner.username, email: "", avatar_url: partner.avatar_url, name: partner.name });
              } else {
                setOnlineModalOpen(true);
              }
              setMobileMenuOpen(false);
            }}
          >
            <span className="nav-item-icon">💬</span>
            <span>Messages</span>
          </button>

          <button
            data-nav="notifications"
            className="nav-item-btn"
            onClick={() => setNotifOpen(!notifOpen)}
          >
            <span className="nav-item-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </span>
            <span>Notifications</span>
            {unreadCount > 0 && <span className="nav-unread-badge">{unreadCount}</span>}
          </button>

          <button
            data-nav="online"
            className="nav-item-btn"
            onClick={() => {
              setOnlineModalOpen(true);
              setMobileMenuOpen(false);
            }}
          >
            <span className="nav-item-icon">🟢</span>
            <span>Online Nesters</span>
            <span className="nav-unread-badge" style={{ background: "#059669", marginLeft: "auto" }}>
              {communityStats.online_users.length}
            </span>
          </button>

          <button
            data-nav="logout"
            className="nav-item-btn logout-nav-item"
            onClick={handleLogout}
          >
            <span className="nav-item-icon">🚪</span>
            <span>Log Out</span>
          </button>
        </div>

        {/* COMMUNITIES LIST */}
        <div className="communities-section">
          <div className="sidebar-section-label">COMMUNITIES</div>
          {communities.map((comm) => (
            <button
              key={comm.id}
              className={`comm-item-btn ${page === "feed" && selectedCommunity === comm.id ? "active" : ""}`}
              onClick={() => {
                setSelectedCommunity(comm.id);
                setPage("feed");
                setMobileMenuOpen(false);
              }}
            >
              <span className={`comm-badge ${comm.badgeClass}`}>#</span>
              <span>{comm.name}</span>
            </button>
          ))}

          <button
            className="create-comm-btn"
            onClick={() => setCreateCommModalOpen(true)}
          >
            <span>+</span>
            <span>Create Community</span>
          </button>

          {/* COMMUNITY OVERVIEW, FEATURED CHANNELS, ONLINE NOW (CLICK TO VIEW DETAILS) */}
          <div className="drawer-accordion-group">
            <div className="mobile-divider" style={{ margin: "12px 0 8px 0" }} />

            {/* ANDROID APP DOWNLOAD */}
            <a
              href="/DevNest.apk"
              download="DevNest.apk"
              className="drawer-menu-item-btn"
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <div className="drawer-menu-item-left">
                <span className="drawer-menu-icon">📱</span>
                <span className="drawer-menu-title">Download Android App</span>
              </div>
              <span className="drawer-menu-chevron" style={{ fontSize: "14px" }}>↓</span>
            </a>

            {/* 1. COMMUNITY OVERVIEW */}
            <button
              type="button"
              className={`drawer-menu-item-btn ${showOverview ? "expanded" : ""}`}
              onClick={() => setShowOverview(!showOverview)}
            >
              <div className="drawer-menu-item-left">
                <span className="drawer-menu-icon">🌐</span>
                <span className="drawer-menu-title">Community overview</span>
              </div>
              <span className="drawer-menu-chevron">{showOverview ? "▾" : "›"}</span>
            </button>
            {showOverview && (
              <div className="drawer-accordion-content">
                <div className="community-widget-card mobile-comm-card">
                  <div className="community-widget-top">
                    <img src="/nesty-logo.png" alt="Nesty" className="community-widget-logo-img" />
                    <span className="community-widget-name">Nesty</span>
                  </div>
                  <p className="community-widget-desc">
                    A space for Piscine candidates to share victories, discoveries and coding questions.
                  </p>
                  <div className="community-widget-members">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                    <span>{liveUserCount} users</span>
                  </div>
                  <button
                    className="invite-friends-btn"
                    onClick={() => {
                      navigator.clipboard?.writeText(window.location.origin);
                      alert("Invite link copied to clipboard!");
                    }}
                  >
                    + Invite friends
                  </button>
                </div>
              </div>
            )}

            {/* 2. FEATURED CHANNELS */}
            <button
              type="button"
              className={`drawer-menu-item-btn ${showFeatured ? "expanded" : ""}`}
              onClick={() => setShowFeatured(!showFeatured)}
            >
              <div className="drawer-menu-item-left">
                <span className="drawer-menu-icon">⭐</span>
                <span className="drawer-menu-title">Featured channels</span>
              </div>
              <span className="drawer-menu-chevron">{showFeatured ? "▾" : "›"}</span>
            </button>
            {showFeatured && (
              <div className="drawer-accordion-content">
                <div className="featured-channels-list">
                  <div
                    className="featured-channel-row"
                    onClick={() => {
                      setSelectedCommunity("coding-help");
                      setPage("feed");
                      setMobileMenuOpen(false);
                    }}
                  >
                    <div className="featured-icon-badge purple">&lt;/&gt;</div>
                    <div className="featured-channel-text">
                      <span className="featured-channel-title">Coding Help</span>
                      <span className="featured-channel-sub">Get community help</span>
                    </div>
                    <span className="featured-chevron">›</span>
                  </div>
                  <div
                    className="featured-channel-row"
                    onClick={() => {
                      setSelectedCommunity("showcase");
                      setPage("feed");
                      setMobileMenuOpen(false);
                    }}
                  >
                    <div className="featured-icon-badge violet">💡</div>
                    <div className="featured-channel-text">
                      <span className="featured-channel-title">Project Showcase</span>
                      <span className="featured-channel-sub">Show what you build</span>
                    </div>
                    <span className="featured-chevron">›</span>
                  </div>
                  <div
                    className="featured-channel-row"
                    onClick={() => {
                      setSelectedCommunity("opportunities");
                      setPage("feed");
                      setMobileMenuOpen(false);
                    }}
                  >
                    <div className="featured-icon-badge orange">💼</div>
                    <div className="featured-channel-text">
                      <span className="featured-channel-title">Opportunities</span>
                      <span className="featured-channel-sub">Jobs & internships</span>
                    </div>
                    <span className="featured-chevron">›</span>
                  </div>
                </div>
              </div>
            )}

            {/* 3. ONLINE NOW */}
            <button
              type="button"
              className={`drawer-menu-item-btn ${showOnline ? "expanded" : ""}`}
              onClick={() => {
                setShowOnline(!showOnline);
              }}
            >
              <div className="drawer-menu-item-left">
                <span className="drawer-menu-icon">🟢</span>
                <span className="drawer-menu-title">Online now</span>
                <span className="nav-unread-badge" style={{ marginLeft: "8px" }}>
                  {communityStats.online_users.length}
                </span>
              </div>
              <span className="drawer-menu-chevron">{showOnline ? "▾" : "›"}</span>
            </button>
            {showOnline && (
              <div className="drawer-accordion-content online-drawer-accordion-content">
                <div className="online-users-list mobile-online-list">
                  {communityStats.online_users.length === 0 ? (
                    <div style={{ padding: "16px 12px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
                      No nesters online right now
                    </div>
                  ) : (
                    communityStats.online_users.map((u, i) => {
                      const bgColors = ["#134e40", "#78350f", "#b45309", "#334155", "#047857"];
                      const bgColor = bgColors[i % bgColors.length];
                      return (
                        <div key={u.id || i} className="online-user-item">
                          <div
                            className="online-user-item-left"
                            style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0, cursor: "pointer", overflow: "hidden" }}
                            onClick={() => {
                              if (u.id) {
                                openProfile(u.id);
                                setMobileMenuOpen(false);
                              }
                            }}
                          >
                            <div className="online-user-avatar" style={{ background: bgColor }}>
                              {u.avatar_url ? (
                                <img
                                  src={u.avatar_url}
                                  alt={u.username}
                                  className="online-avatar-img"
                                  style={{ width: "40px", height: "40px", borderRadius: "50%", objectFit: "cover", flexShrink: 0, maxWidth: "100%" }}
                                />
                              ) : (
                                <span className="online-avatar-initial">{u.username.charAt(0).toUpperCase()}</span>
                              )}
                              <span className="online-dot-badge" />
                            </div>
                            <div className="online-user-meta" style={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
                              <span className="online-user-name" style={{ display: "block", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                                {u.name || u.username} {u.id === user?.id ? " (You)" : ""}
                              </span>
                            </div>
                          </div>
                          {u.id && u.id !== user?.id && (
                            <div className="online-user-item-actions" style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                              <button
                                className="scroll-ctrl-btn"
                                style={{ padding: "4px 6px", fontSize: "11px", minWidth: "26px", height: "26px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                                title={`Chat with ${u.username}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startChatWithUser({ id: u.id!, username: u.username, email: "" });
                                  setMobileMenuOpen(false);
                                }}
                              >
                                💬
                              </button>
                              <button
                                className="scroll-ctrl-btn"
                                style={{ padding: "4px 6px", fontSize: "11px", minWidth: "26px", height: "26px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                                title={`Call ${u.username}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startCallWithUser({ id: u.id!, username: u.username, email: "", avatar_url: u.avatar_url, name: u.name }, false);
                                  setMobileMenuOpen(false);
                                }}
                              >
                                📞
                              </button>
                              <button
                                className="scroll-ctrl-btn"
                                style={{ padding: "4px 6px", fontSize: "11px", minWidth: "26px", height: "26px", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                                title={`Video call ${u.username}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startCallWithUser({ id: u.id!, username: u.username, email: "", avatar_url: u.avatar_url, name: u.name }, true);
                                  setMobileMenuOpen(false);
                                }}
                              >
                                📹
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* FOOTER: DARK MODE SWITCH & USER CARD */}
        <div className="sidebar-footer-wrap">
          <div className="dark-mode-toggle-row">
            <span className="dark-mode-label">🌙 Dark mode</span>
            <button
              className={`theme-switch-btn ${theme === "dark" ? "on" : ""}`}
              onClick={toggleTheme}
              aria-label="Toggle Dark Mode"
            >
              <div className="theme-switch-thumb" />
            </button>
          </div>

          <div
            className="sidebar-user-card"
            onClick={openMyProfile}
          >
            <div className="sidebar-user-avatar">
              {user?.avatar_url ? (
                <img src={user.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                (user?.username || "J").charAt(0).toUpperCase()
              )}
            </div>
            <div className="user-card-info">
              <span className="user-card-name">{user?.name || user?.username || "Jaytricks"}</span>
              <span className="user-card-handle">@{user?.username || "jaytricks"}</span>
            </div>
          </div>
        </div>
      </aside>

      {/* NOTIFICATIONS FLYOUT WITH BACKGROUND BLUR */}
      {notifOpen && (
        <>
          <div
            className="notifications-backdrop-blur"
            onClick={() => setNotifOpen(false)}
            aria-label="Close notifications"
          />
          <div className="notifications-flyout">
            <div className="notif-header">
              <b>Notifications</b>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {unreadCount > 0 && (
                  <button
                    className="edit-profile-pill-btn"
                    style={{ padding: "4px 10px", fontSize: "12px" }}
                    onClick={markAllNotificationsRead}
                  >
                    Mark all read
                  </button>
                )}
                <button
                  className="edit-profile-pill-btn"
                  style={{ padding: "4px 8px", fontSize: "12px" }}
                  onClick={() => setNotifOpen(false)}
                  title="Close"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="notif-list-container">
              {notifications.length === 0 ? (
                <div style={{ padding: "16px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
                  No notifications yet.
                </div>
              ) : (
                notifications.map((n) => {
                  const isMissedAudio = n.type === "missed_call";
                  const isMissedVideo = n.type === "missed_video_call";
                  const isMissed = isMissedAudio || isMissedVideo;

                  return (
                    <div
                      key={n.id}
                      className={`notif-row-item ${n.read ? "" : "unread"} ${isMissed ? "missed-call-row" : ""}`}
                      onClick={() => {
                        markNotificationRead(n.id);
                        if (n.actor_id) openProfile(n.actor_id);
                      }}
                    >
                      <div className="search-avatar-mini" style={{ position: "relative" }}>
                        {n.actor?.avatar_url ? (
                          <img src={n.actor.avatar_url} alt="" />
                        ) : (
                          (n.actor?.username || "?").charAt(0).toUpperCase()
                        )}
                        {isMissed && (
                          <span className={`missed-badge-icon ${isMissedVideo ? "video" : "audio"}`}>
                            {isMissedVideo ? "📹" : "📞"}
                          </span>
                        )}
                      </div>
                      <div style={{ flex: 1, fontSize: "13px", minWidth: 0 }}>
                        <div style={{ fontWeight: isMissed ? 600 : 400, color: isMissed ? "var(--text)" : "inherit" }}>
                          {notificationText(n)}
                        </div>
                        <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px", display: "flex", alignItems: "center", gap: "6px" }}>
                          <span>{timeAgo(n.created_at)}</span>
                          {isMissed && (
                            <span className={`missed-pill-tag ${isMissedVideo ? "video" : "audio"}`}>
                              {isMissedVideo ? "Missed Video Call" : "Missed Audio Call"}
                            </span>
                          )}
                        </div>
                      </div>
                      {isMissed && n.actor && (
                        <button
                          className={`notif-call-back-btn ${isMissedVideo ? "video" : "audio"}`}
                          title={isMissedVideo ? "Video call back" : "Audio call back"}
                          onClick={(e) => {
                            e.stopPropagation();
                            markNotificationRead(n.id);
                            setNotifOpen(false);
                            startCallWithUser(n.actor!, isMissedVideo);
                          }}
                        >
                          {isMissedVideo ? "📹 Call back" : "📞 Call back"}
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}

      {/* =====================================================================
          2. CENTER COLUMN: COMMUNITY FEED / PROFILE / CREATE POST
          ===================================================================== */}
      <main ref={centerFeedRef} className="nesty-center-feed">
        {/* PULL TO REFRESH INDICATOR */}
        <div
          className={`pull-to-refresh-banner ${isRefreshing ? "refreshing" : ""}`}
          style={{
            height: `${pullDistance}px`,
            opacity: pullDistance > 8 ? 1 : 0,
            transition: isPullingRef.current ? "none" : "all 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          <div className="pull-to-refresh-pill">
            <span className={`pull-to-refresh-spinner ${isRefreshing ? "spin" : ""}`}>
              {isRefreshing ? "⏳" : pullDistance >= 45 ? "↻" : "↓"}
            </span>
            <span className="pull-to-refresh-text">
              {isRefreshing
                ? "Refreshing..."
                : pullDistance >= 45
                ? "Release to refresh"
                : "Pull down to refresh"}
            </span>
          </div>
        </div>

        {/* TOP BAR */}
        <div className="feed-top-bar">
          <div className="feed-top-left">
            <div
              className={`feed-top-badge ${
                page === "profile" ? "profile-badge" : page === "create" ? "create-badge" : ""
              }`}
            >
              {page === "profile" ? "👤" : page === "create" ? "✏️" : "#"}
            </div>
            <div className="feed-top-titles">
              <h1 className="feed-top-title">{pageTitle}</h1>
              <span className="feed-top-sub">{pageSub}</span>
            </div>
          </div>

          <div className="feed-top-right">
            <div className="members-pill">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span>{liveUserCount} users</span>
            </div>
            <button className="top-action-icon-btn" title="Search">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
            <button className="top-action-icon-btn" title="Options">
              ···
            </button>
          </div>
        </div>

        {/* VIEW 1: HOME & COMMUNITY FEED */}
        {page === "feed" && (
          <>
            {/* INLINE QUICK POST CREATOR */}
            <div className="inline-creator-card">
              <div className="inline-creator-top">
                <div className="avatar-with-dot">
                  {user?.avatar_url ? (
                    <img src={user.avatar_url} alt="" />
                  ) : (
                    (user?.username || "J").charAt(0).toUpperCase()
                  )}
                  <span className="online-dot" />
                </div>
                <input
                  className="inline-input-pill"
                  placeholder="What's on your mind, Nesters?"
                  value={newPost}
                  onChange={(e) => setNewPost(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      createPost();
                    }
                  }}
                />
              </div>

              {mediaPreview && (
                <div style={{ position: "relative", marginBottom: "12px", borderRadius: "12px", overflow: "hidden" }}>
                  <img src={mediaPreview} alt="" style={{ width: "100%", maxHeight: "240px", objectFit: "cover" }} />
                  <button
                    style={{ position: "absolute", top: "8px", right: "8px", background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", borderRadius: "50%", width: "24px", height: "24px", cursor: "pointer" }}
                    onClick={() => { setSelectedFile(null); setMediaPreview(null); }}
                  >
                    ✕
                  </button>
                </div>
              )}

              <div className="inline-creator-actions">
                <div className="inline-attach-tools">
                  <label className="tool-attach-btn" style={{ cursor: "pointer" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                    <span>Image</span>
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        setSelectedFile(file);
                        if (file) setMediaPreview(URL.createObjectURL(file));
                      }}
                    />
                  </label>

                  <button
                    className="tool-attach-btn"
                    onClick={() => setNewPost((prev) => prev + "```\n// Code snippet\n```")}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="16 18 22 12 16 6" />
                      <polyline points="8 6 2 12 8 18" />
                    </svg>
                    <span>Code</span>
                  </button>

                  <button
                    className="tool-attach-btn"
                    onClick={() => {
                      const url = prompt("Enter Link URL:");
                      if (url) setNewPost((prev) => `${prev} ${url}`);
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                    <span>Link</span>
                  </button>

                  <button
                    className="tool-attach-btn"
                    onClick={() => alert("Poll creation dialog")}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="20" x2="18" y2="10" />
                      <line x1="12" y1="20" x2="12" y2="4" />
                      <line x1="6" y1="20" x2="6" y2="14" />
                    </svg>
                    <span>Poll</span>
                  </button>
                </div>

                <button
                  className="post-pill-submit"
                  onClick={createPost}
                  disabled={uploadingMedia || (!newPost.trim() && !selectedFile)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                  <span>{uploadingMedia ? "Posting..." : "Post"}</span>
                </button>
              </div>
            </div>

            {/* POSTS FEED LIST */}
            <div className="nesty-posts-feed">
              {posts.map((post) => {
                const displayName = post.user?.name || post.user?.username || "piscine_builder";
                const handle = post.user?.username || "piscine_builder";
                const isMyPost = user?.id && post.user?.id === user.id;

                return (
                  <article key={post.id} className="post-card-nesty">
                    <div className="post-header-nesty">
                      <div
                        className="avatar-with-dot"
                        style={{ cursor: "pointer", width: "42px", height: "42px" }}
                        onClick={() => post.user?.id && openProfile(post.user.id)}
                      >
                        {post.user?.avatar_url ? (
                          <img src={post.user.avatar_url} alt="" />
                        ) : (
                          handle.charAt(0).toUpperCase()
                        )}
                        <span className="online-dot" />
                      </div>

                      <div className="post-header-author-info">
                        <span
                          className="author-display-name"
                          onClick={() => post.user?.id && openProfile(post.user.id)}
                        >
                          {displayName}
                        </span>
                        <span className="verified-dot-green" title="Verified" />
                        <span
                          className="author-handle"
                          onClick={() => post.user?.id && openProfile(post.user.id)}
                        >
                          @{handle}
                        </span>
                        <span className="post-date-ago">
                          · {post.created_at ? timeAgo(post.created_at) : "39m ago"}
                        </span>
                      </div>

                      <button
                        className="post-options-menu-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveDropdown(activeDropdown === post.id ? null : post.id);
                        }}
                      >
                        ···
                      </button>

                      {activeDropdown === post.id && (
                        <div className="dropdown-menu-nesty" onClick={(e) => e.stopPropagation()}>
                          {isMyPost && (
                            <>
                              <button
                                className="dropdown-item-btn"
                                onClick={() => {
                                  setEditingPost(post);
                                  setEditText(post.content);
                                  setActiveDropdown(null);
                                }}
                              >
                                ✏️ Edit Post
                              </button>
                              <button
                                className="dropdown-item-btn danger"
                                onClick={() => {
                                  deletePost(post.id);
                                  setActiveDropdown(null);
                                }}
                              >
                                🗑️ Delete
                              </button>
                            </>
                          )}
                          <button
                            className="dropdown-item-btn"
                            onClick={() => {
                              navigator.clipboard.writeText(window.location.href);
                              alert("Post link copied to clipboard!");
                              setActiveDropdown(null);
                            }}
                          >
                            📋 Copy Link
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="post-content-body">
                      {renderWithMentions(post.content)}
                    </div>

                    {/* MEDIA OR PHOTO PLACEHOLDER */}
                    {post.media_url ? (
                      post.media_url === "photo_placeholder" ? (
                        <div className="mock-photo-placeholder">
                          Photo
                        </div>
                      ) : (
                        <div className="post-media-container">
                          {post.media_url.match(/\.(mp4|webm|mov)/i) ? (
                            <video src={post.media_url} controls />
                          ) : (
                            <img src={post.media_url} alt="Attachment" />
                          )}
                        </div>
                      )
                    ) : null}

                    {/* ACTION BAR */}
                    <div className="post-actions-bar">
                      <button
                        className={`action-pill-btn ${post.liked_by_me ? "liked" : ""}`}
                        onClick={() => handleLike(post.id)}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill={post.liked_by_me ? "#ef4444" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                        </svg>
                        <span>{post.likes || 0}</span>
                      </button>

                      <button
                        className="action-pill-btn"
                        onClick={() =>
                          setExpandedComments((prev) => ({
                            ...prev,
                            [post.id]: !prev[post.id],
                          }))
                        }
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                        <span>{post.comments?.length || 0}</span>
                      </button>

                      <button
                        className="action-pill-btn"
                        title="Share post"
                        onClick={() => handleSharePost(post)}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="7" y1="17" x2="17" y2="7" />
                          <polyline points="7 7 17 7 17 17" />
                        </svg>
                      </button>
                    </div>

                    {/* EXPANDABLE COMMENTS */}
                    {expandedComments[post.id] && (
                      <div className="comments-section-nesty">
                        {(post.comments || []).map((c) => (
                          <div key={c.id} className="comment-row">
                            <div
                              className="comment-avatar"
                              style={{ cursor: "pointer" }}
                              onClick={() => c.user?.id && openProfile(c.user.id)}
                            >
                              {c.user?.avatar_url ? (
                                <img src={c.user.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                              ) : (
                                (c.user?.username || "?").charAt(0).toUpperCase()
                              )}
                            </div>
                            <div className="comment-bubble">
                              <span
                                className="comment-author-name"
                                style={{ cursor: "pointer" }}
                                onClick={() => c.user?.id && openProfile(c.user.id)}
                              >
                                @{c.user?.username || "builder"}
                              </span>
                              <span>{c.content}</span>
                            </div>
                          </div>
                        ))}

                        <div className="comment-form-row">
                          <input
                            className="comment-input-pill"
                            placeholder="Write a constructive reply..."
                            value={commentInputs[post.id] || ""}
                            onChange={(e) =>
                              setCommentInputs((prev) => ({ ...prev, [post.id]: e.target.value }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleAddComment(post.id);
                            }}
                          />
                          <button
                            className="comment-submit-btn"
                            onClick={() => handleAddComment(post.id)}
                          >
                            Reply
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </>
        )}

        {/* VIEW 2: PROFILE PAGE */}
        {page === "profile" && (() => {
          const isViewingSelf = viewedUserId === null || (user?.id && viewedUserId === user.id) || !!profileData?.is_self;
          const displayUser = isViewingSelf ? (profileData?.user || user) : profileData?.user;
          const bannerUrl = isViewingSelf ? (profileData?.user?.banner_url || user?.banner_url) : profileData?.user?.banner_url;
          const avatarUrl = isViewingSelf ? (profileData?.user?.avatar_url || user?.avatar_url) : profileData?.user?.avatar_url;
          const displayName = displayUser?.name || displayUser?.username || (isViewingSelf ? (user?.name || user?.username || "Your Profile") : "Loading profile...");
          const handle = displayUser?.username || (isViewingSelf ? (user?.username || "") : "");
          const bio = displayUser?.bio ?? (isViewingSelf ? (user?.bio || "Aspiring Full-Stack Engineer") : "");
          const location = displayUser?.location ?? (isViewingSelf ? (user?.location || "Otukpo, Nigeria") : "");

          return (
            <div className="profile-view-wrapper">
              <div className="profile-card-nesty">
                {/* MINT COVER BANNER */}
                <div
                  className="profile-cover-mint"
                  style={
                    bannerUrl
                      ? {
                          backgroundImage: `url(${bannerUrl})`,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                        }
                      : undefined
                  }
                >
                  {isViewingSelf && (
                    <label className="edit-cover-floating-btn" title="Change Wallpaper">
                      📷 Change Wallpaper
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: "none" }}
                        onChange={handleQuickBannerChange}
                      />
                    </label>
                  )}

                  {/* OVERLAPPING AVATAR */}
                  <div className="profile-avatar-big">
                    {avatarUrl ? (
                      <img src={avatarUrl} alt="" />
                    ) : (
                      (handle || "U").charAt(0).toUpperCase()
                    )}
                    {isViewingSelf && (
                      <label className="avatar-edit-overlay-icon" title="Change Profile Picture">
                        📷
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: "none" }}
                          onChange={handleQuickAvatarChange}
                        />
                      </label>
                    )}
                  </div>
                </div>

                <div className="profile-details-section">
                  <div className="profile-edit-btn-wrap">
                    <div className="profile-action-buttons">
                      {!isViewingSelf ? (
                        <>
                          <button
                            className="profile-chat-btn"
                            onClick={() => {
                              const partner = profileData?.user || { id: viewedUserId || 0, username: handle || "Nester", email: "" };
                              startChatWithUser(partner);
                            }}
                          >
                            💬 Chat
                          </button>
                          <button
                            className="profile-call-btn"
                            onClick={() => {
                              const partner = profileData?.user || { id: viewedUserId || 0, username: handle || "Nester", email: "" };
                              startCallWithUser(partner, false);
                            }}
                          >
                            📞 Call
                          </button>
                          <button
                            className="profile-videocall-btn"
                            onClick={() => {
                              const partner = profileData?.user || { id: viewedUserId || 0, username: handle || "Nester", email: "" };
                              startCallWithUser(partner, true);
                            }}
                          >
                            📹 Video
                          </button>
                          <button
                            className="post-pill-submit"
                            disabled={followBusy}
                            onClick={toggleFollow}
                          >
                            {followBusy ? "..." : profileData?.is_following ? "Following" : "Follow"}
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="edit-profile-pill-btn"
                            onClick={() => {
                              setProfileForm({
                                username: user?.username || profileData?.user?.username || "",
                                name: user?.name || profileData?.user?.name || "",
                                bio: user?.bio || profileData?.user?.bio || "Aspiring Full-Stack Engineer",
                                skills: user?.skills || profileData?.user?.skills || "Go, React, TypeScript",
                                location: user?.location || profileData?.user?.location || "Otukpo, Nigeria",
                                avatar_url: user?.avatar_url || profileData?.user?.avatar_url || "",
                                banner_url: user?.banner_url || profileData?.user?.banner_url || "",
                              });
                              setEditingProfile(true);
                            }}
                          >
                            Edit Profile
                          </button>
                          <button
                            className="profile-chat-btn"
                            onClick={() => {
                              const partner = communityStats.online_users.find((u) => u.id && u.id !== user?.id);
                              if (partner && partner.id) {
                                startChatWithUser({ id: partner.id, username: partner.username, email: "", avatar_url: partner.avatar_url, name: partner.name });
                              } else {
                                setOnlineModalOpen(true);
                              }
                            }}
                          >
                            💬 Messages & Calls
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <h2 className="profile-user-name">{displayName}</h2>
                  {handle && <div className="profile-user-handle">@{handle}</div>}

                  {bio && <div className="profile-bio-text">{bio}</div>}

                  {location && (
                    <div className="profile-location-text">
                      <span>📍</span>
                      <span>{location}</span>
                    </div>
                  )}

                  {/* STATS ROW */}
                  <div className="profile-stats-row">
                    <div className="stat-item">
                      <b>{profileData?.post_count ?? profilePosts.length}</b> Posts
                    </div>
                    <div
                      className="stat-item"
                      style={{ cursor: "pointer" }}
                      onClick={() => {
                        if (displayUser?.id) {
                          setFollowListModal({ type: "followers", userId: displayUser.id });
                        }
                      }}
                    >
                      <b>{profileData?.follower_count ?? 0}</b> Followers
                    </div>
                    <div
                      className="stat-item"
                      style={{ cursor: "pointer" }}
                      onClick={() => {
                        if (displayUser?.id) {
                          setFollowListModal({ type: "following", userId: displayUser.id });
                        }
                      }}
                    >
                      <b>{profileData?.following_count ?? 0}</b> Following
                    </div>
                  </div>
                </div>
              </div>

              {/* USER POSTS FEED TIMELINE */}
              <div className="nesty-posts-feed">
                {profilePosts.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--text-muted)", fontSize: "14px", background: "var(--card-bg)", borderRadius: "14px", border: "1px solid var(--border-color)", margin: "16px 0" }}>
                    No posts yet from this user.
                  </div>
                ) : (
                  profilePosts.map((post) => {
                    const postDisplayName = post.user?.name || post.user?.username || displayName;
                    const postHandle = post.user?.username || handle;

                    return (
                      <article key={post.id} className="post-card-nesty">
                        <div className="post-header-nesty">
                          <div
                            className="avatar-with-dot"
                            style={{ width: "42px", height: "42px", cursor: "pointer" }}
                            onClick={() => post.user?.id && openProfile(post.user.id)}
                          >
                            {post.user?.avatar_url ? (
                              <img src={post.user.avatar_url} alt="" />
                            ) : (
                              (postHandle || "U").charAt(0).toUpperCase()
                            )}
                            <span className="online-dot" />
                          </div>
                          <div className="post-header-author-info">
                            <span
                              className="author-display-name"
                              style={{ cursor: "pointer" }}
                              onClick={() => post.user?.id && openProfile(post.user.id)}
                            >
                              {postDisplayName}
                            </span>
                            <span className="verified-dot-green" />
                            <span
                              className="author-handle"
                              style={{ cursor: "pointer" }}
                              onClick={() => post.user?.id && openProfile(post.user.id)}
                            >
                              @{postHandle}
                            </span>
                            <span className="post-date-ago">· {post.created_at ? timeAgo(post.created_at) : "1h ago"}</span>
                          </div>
                        </div>

                        <div className="post-content-body">{renderWithMentions(post.content)}</div>

                        {post.media_url ? (
                          post.media_url === "photo_placeholder" ? (
                            <div className="mock-photo-placeholder">Photo</div>
                          ) : (
                            <div className="post-media-container">
                              <img src={post.media_url} alt="" />
                            </div>
                          )
                        ) : null}

                        <div className="post-actions-bar">
                          <button
                            className={`action-pill-btn ${post.liked_by_me ? "liked" : ""}`}
                            onClick={() => handleLike(post.id)}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill={post.liked_by_me ? "#ef4444" : "none"} stroke="currentColor" strokeWidth="2">
                              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                            </svg>
                            <span>{post.likes ?? 0}</span>
                          </button>
                          <button
                            className="action-pill-btn"
                            onClick={() =>
                              setExpandedComments((prev) => ({
                                ...prev,
                                [post.id]: !prev[post.id],
                              }))
                            }
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                            </svg>
                            <span>{post.comments?.length ?? 0}</span>
                          </button>
                          <button
                            className="action-pill-btn"
                            title="Share post"
                            onClick={() => handleSharePost(post)}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <line x1="7" y1="17" x2="17" y2="7" />
                              <polyline points="7 7 17 7 17 17" />
                            </svg>
                          </button>
                        </div>

                        {/* EXPANDABLE COMMENTS */}
                        {expandedComments[post.id] && (
                          <div className="comments-section-nesty">
                            {(post.comments || []).map((c) => (
                              <div key={c.id} className="comment-row">
                                <div
                                  className="comment-avatar"
                                  style={{ cursor: "pointer" }}
                                  onClick={() => c.user?.id && openProfile(c.user.id)}
                                >
                                  {c.user?.avatar_url ? (
                                    <img src={c.user.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                  ) : (
                                    (c.user?.username || "?").charAt(0).toUpperCase()
                                  )}
                                </div>
                                <div className="comment-bubble">
                                  <span
                                    className="comment-author-name"
                                    style={{ cursor: "pointer" }}
                                    onClick={() => c.user?.id && openProfile(c.user.id)}
                                  >
                                    @{c.user?.username || "builder"}
                                  </span>
                                  <span>{c.content}</span>
                                </div>
                              </div>
                            ))}

                            <div className="comment-form-row">
                              <input
                                className="comment-input-pill"
                                placeholder="Write a constructive reply..."
                                value={commentInputs[post.id] || ""}
                                onChange={(e) =>
                                  setCommentInputs((prev) => ({ ...prev, [post.id]: e.target.value }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleAddComment(post.id);
                                }}
                              />
                              <button
                                className="comment-submit-btn"
                                onClick={() => handleAddComment(post.id)}
                              >
                                Reply
                              </button>
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })
                )}
              </div>
            </div>
          );
        })()}

        {/* VIEW 3: DEDICATED CREATE POST PAGE (MATCHING SCREENSHOT 3) */}
        {page === "create" && (
          <div className="dedicated-create-card">
            <div className="composer-top-row">
              <div className="avatar-with-dot">
                {user?.avatar_url ? (
                  <img src={user.avatar_url} alt="" />
                ) : (
                  (user?.username || "J").charAt(0).toUpperCase()
                )}
                <span className="online-dot" />
              </div>
              <textarea
                className="composer-textarea"
                placeholder="Share a win, bug, idea, or question..."
                value={newPost}
                onChange={(e) => setNewPost(e.target.value)}
              />
            </div>

            {mediaPreview && (
              <div style={{ marginBottom: "16px", borderRadius: "12px", overflow: "hidden", position: "relative" }}>
                <img src={mediaPreview} alt="" style={{ width: "100%", maxHeight: "320px", objectFit: "cover" }} />
                <button
                  style={{ position: "absolute", top: "10px", right: "10px", background: "rgba(0,0,0,0.6)", color: "#fff", border: "none", borderRadius: "50%", width: "26px", height: "26px", cursor: "pointer" }}
                  onClick={() => { setSelectedFile(null); setMediaPreview(null); }}
                >
                  ✕
                </button>
              </div>
            )}

            <div className="composer-bottom-bar">
              <label className="attach-media-pill-btn">
                <span>📎</span>
                <span>Attach media</span>
                <input
                  type="file"
                  accept="image/*,video/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    setSelectedFile(file);
                    if (file) setMediaPreview(URL.createObjectURL(file));
                  }}
                />
              </label>

              <button
                className="publish-pill-btn"
                disabled={uploadingMedia || (!newPost.trim() && !selectedFile)}
                onClick={createPost}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
                <span>{uploadingMedia ? "Publishing..." : "Publish"}</span>
              </button>
            </div>
          </div>
        )}

        {/* PERSONAL SCROLL CONTROLS FOR CENTER FEED */}
        <div className="center-scroll-bar-ctrl">
          <button
            className="scroll-ctrl-btn"
            onClick={() => centerFeedRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
            title="Scroll to top of feed"
          >
            ▲ Top
          </button>
          <button
            className="scroll-ctrl-btn"
            onClick={() => centerFeedRef.current?.scrollBy({ top: 600, behavior: "smooth" })}
            title="Scroll down messages"
          >
            ▼ More
          </button>
        </div>
      </main>

      {/* =====================================================================
          3. RIGHT COLUMN: WIDGETS SIDEBAR (NESTY CARD, FEATURED, ONLINE NOW)
          ===================================================================== */}
      <aside ref={sidebarRightRef} className="nesty-sidebar-right">
        {/* CARD 1: NESTY COMMUNITY CARD (FOREST GREEN) */}
        <div className="nesty-community-widget">
          {/* Logo container left blank per instruction: "leave the logo blank until I come up with one." */}
          <img src="/nesty-logo.png" alt="Nesty" className="community-widget-logo-img" />
          <h3 className="community-widget-title">Nesty</h3>
          <p className="community-widget-desc">
            A space for Piscine candidates to share victories, discoveries and coding questions.
          </p>
          <div className="community-widget-members">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <span>{liveUserCount} users</span>
          </div>
          <button
            className="invite-friends-btn"
            onClick={() => {
              navigator.clipboard.writeText(window.location.origin);
              alert("Invite link copied to clipboard!");
            }}
          >
            <span>+</span>
            <span>Invite friends</span>
          </button>
        </div>

        {/* CARD: MOBILE APP BARCODE DOWNLOAD */}
        <div className="apk-download-widget">
          <div className="apk-widget-badge">
            <span>📱</span>
            <span>Android App</span>
          </div>
          <h4 className="apk-widget-title">Get DevNest on Mobile</h4>
          <p className="apk-widget-desc">
            Scan this barcode with your phone camera to download the APK directly:
          </p>

          <div className="apk-qr-container">
            <div className="apk-qr-frame">
              <img
                src="/devnest-apk-qr.png"
                alt="Scan barcode to download DevNest APK"
                className="apk-qr-image"
              />
            </div>
            <div className="apk-qr-label">
              <span className="apk-qr-dot" />
              <span>Point phone camera to scan • 6.5 MB</span>
            </div>
          </div>

          <a
            href="/DevNest.apk"
            download="DevNest.apk"
            className="apk-download-direct-btn"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>Download APK Directly</span>
          </a>
        </div>

        {/* CARD 2: FEATURED CHANNELS */}
        <div className="featured-widget">
          <h4 className="featured-heading">Featured</h4>
          <div className="featured-channels-list">
            <div
              className="featured-channel-row"
              onClick={() => {
                setSelectedCommunity("coding-help");
                setPage("feed");
              }}
            >
              <div className="featured-icon-badge purple">&lt;/&gt;</div>
              <div className="featured-channel-text">
                <span className="featured-channel-title">Coding Help</span>
                <span className="featured-channel-sub">Stuck? Get help from the community.</span>
              </div>
              <span className="featured-chevron">›</span>
            </div>

            <div
              className="featured-channel-row"
              onClick={() => {
                setSelectedCommunity("showcase");
                setPage("feed");
              }}
            >
              <div className="featured-icon-badge violet">💡</div>
              <div className="featured-channel-text">
                <span className="featured-channel-title">Project Showcase</span>
                <span className="featured-channel-sub">Show off what you're building.</span>
              </div>
              <span className="featured-chevron">›</span>
            </div>

            <div
              className="featured-channel-row"
              onClick={() => {
                setSelectedCommunity("opportunities");
                setPage("feed");
              }}
            >
              <div className="featured-icon-badge orange">💼</div>
              <div className="featured-channel-text">
                <span className="featured-channel-title">Opportunities</span>
                <span className="featured-channel-sub">Jobs, Internships and more.</span>
              </div>
              <span className="featured-chevron">›</span>
            </div>
          </div>
        </div>

        {/* CARD 3: ONLINE NOW */}
        <div className="online-widget">
          <div className="online-widget-header">
            <span className="online-widget-title">Online now</span>
            <span
              className="online-widget-seeall"
              onClick={() => setOnlineModalOpen(true)}
            >
              See all
            </span>
          </div>

          <div className="online-users-list">
            {communityStats.online_users.length === 0 ? (
              <div style={{ padding: "16px 12px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
                No nesters online right now
              </div>
            ) : (
              communityStats.online_users.map((u, i) => {
                const bgColors = ["#134e40", "#78350f", "#b45309", "#334155", "#047857"];
                const bgColor = bgColors[i % bgColors.length];

                return (
                  <div
                    key={u.id || i}
                    className="online-user-item"
                    onClick={() => u.id && openProfile(u.id)}
                  >
                    <div
                      className="online-user-avatar"
                      style={{ background: bgColor }}
                    >
                      {u.avatar_url ? (
                        <img src={u.avatar_url} alt="" style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} />
                      ) : (
                        u.username.charAt(0).toUpperCase()
                      )}
                      <span className="online-user-dot" />
                    </div>
                    <div className="online-user-info" style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                      <span className="online-user-name" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>
                        {u.name || u.username} {u.id === user?.id ? " (You)" : ""}
                      </span>
                    </div>
                    {u.id && u.id !== user?.id && (
                      <div style={{ display: "flex", gap: "4px" }} onClick={(e) => e.stopPropagation()}>
                        <button
                          className="scroll-ctrl-btn"
                          style={{ padding: "3px 8px", fontSize: "11px" }}
                          title={`Chat with ${u.username}`}
                          onClick={() => startChatWithUser({ id: u.id!, username: u.username, email: "" })}
                        >
                          💬
                        </button>
                        <button
                          className="scroll-ctrl-btn"
                          style={{ padding: "3px 8px", fontSize: "11px" }}
                          title={`Call ${u.username}`}
                          onClick={() => startCallWithUser({ id: u.id!, username: u.username, email: "", avatar_url: u.avatar_url, name: u.name }, false)}
                        >
                          📞
                        </button>
                        <button
                          className="scroll-ctrl-btn"
                          style={{ padding: "3px 8px", fontSize: "11px" }}
                          title={`Video call ${u.username}`}
                          onClick={() => startCallWithUser({ id: u.id!, username: u.username, email: "", avatar_url: u.avatar_url, name: u.name }, true)}
                        >
                          📹
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* PERSONAL SCROLL CONTROLS FOR RIGHT SIDEBAR */}
        <div className="sidebar-scroll-bar-ctrl">
          <button
            className="scroll-ctrl-btn"
            onClick={() => sidebarRightRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
            title="Scroll to top"
          >
            ▲ Top
          </button>
          <button
            className="scroll-ctrl-btn"
            onClick={() => sidebarRightRef.current?.scrollBy({ top: 400, behavior: "smooth" })}
            title="Scroll down"
          >
            ▼ More
          </button>
        </div>
      </aside>

      {/* CREATE COMMUNITY MODAL */}
      {createCommModalOpen && (
        <div className="modal-overlay-nesty" onClick={() => setCreateCommModalOpen(false)}>
          <div className="modal-content-card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: "12px", color: "var(--text-h)" }}>Create New Community</h3>
            <p style={{ fontSize: "13.5px", color: "var(--text-muted)", marginBottom: "16px" }}>
              Start a new focused channel for questions, tracks, or local meetups.
            </p>
            <input
              className="auth-input"
              placeholder="e.g. Algorithms, DevOps, Python..."
              value={newCommName}
              onChange={(e) => setNewCommName(e.target.value)}
              style={{ marginBottom: "16px" }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                className="edit-profile-pill-btn"
                onClick={() => setCreateCommModalOpen(false)}
              >
                Cancel
              </button>
              <button
                className="post-pill-submit"
                onClick={() => {
                  if (!newCommName.trim()) return;
                  const slug = newCommName.toLowerCase().replace(/\s+/g, "-");
                  const newChannel: CommunityChannel = {
                    id: slug,
                    name: newCommName.trim(),
                    badgeClass: "custom",
                    subtitle: `Discussions and updates for ${newCommName.trim()}`,
                  };
                  setCommunities((prev) => [...prev, newChannel]);
                  setSelectedCommunity(slug);
                  setPage("feed");
                  setNewCommName("");
                  setCreateCommModalOpen(false);
                }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT PROFILE MODAL */}
      {editingProfile && (
        <div className="modal-overlay-nesty" onClick={() => setEditingProfile(false)}>
          <div className="modal-content-card" style={{ maxWidth: "520px", maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3 style={{ margin: 0, color: "var(--text-h)" }}>Edit Profile</h3>
              <button className="edit-profile-pill-btn" style={{ padding: "4px 8px", fontSize: "12px" }} onClick={() => setEditingProfile(false)}>✕</button>
            </div>

            {/* 1. WALLPAPER / COVER BANNER SECTION */}
            <div className="profile-edit-section">
              <label className="profile-edit-label">Wallpaper / Cover Banner</label>
              <div
                className="profile-edit-banner-preview"
                style={{
                  backgroundImage: profileForm.banner_url ? `url(${profileForm.banner_url})` : undefined,
                  backgroundColor: profileForm.banner_url ? "transparent" : "var(--surface-subtle)",
                }}
              >
                {!profileForm.banner_url && <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>Default Wallpaper</span>}
                <label className="edit-cover-upload-pill">
                  {uploadingBanner ? "Uploading..." : "📁 Upload Wallpaper"}
                  <input type="file" accept="image/*" style={{ display: "none" }} onChange={handleBannerFileChange} disabled={uploadingBanner} />
                </label>
              </div>

              <input
                className="auth-input"
                placeholder="Or paste wallpaper image URL..."
                value={profileForm.banner_url}
                onChange={(e) => setProfileForm({ ...profileForm, banner_url: e.target.value })}
                style={{ marginBottom: "6px", fontSize: "12px" }}
              />

              <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>Wallpaper Presets:</div>
              <div className="preset-chips-row">
                {WALLPAPER_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    className={`preset-chip-btn ${profileForm.banner_url === p.url ? "selected" : ""}`}
                    onClick={() => setProfileForm({ ...profileForm, banner_url: p.url })}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mobile-divider" style={{ margin: "16px 0" }} />

            {/* 2. PROFILE PICTURE / AVATAR SECTION */}
            <div className="profile-edit-section">
              <label className="profile-edit-label">Profile Picture</label>
              <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "8px" }}>
                <div className="profile-edit-avatar-preview">
                  {profileForm.avatar_url ? (
                    <img src={profileForm.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <div style={{ width: "100%", height: "100%", background: "#134e40", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px", fontWeight: "bold" }}>
                      {(profileForm.username || "J").charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <label className="edit-avatar-upload-btn">
                    {uploadingAvatar ? "Uploading..." : "📁 Upload New Photo"}
                    <input type="file" accept="image/*" style={{ display: "none" }} onChange={handleAvatarFileChange} disabled={uploadingAvatar} />
                  </label>
                  <input
                    className="auth-input"
                    placeholder="Or paste avatar image URL..."
                    value={profileForm.avatar_url}
                    onChange={(e) => setProfileForm({ ...profileForm, avatar_url: e.target.value })}
                    style={{ marginTop: "6px", fontSize: "12px" }}
                  />
                </div>
              </div>

              <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>Avatar Presets:</div>
              <div className="preset-chips-row">
                {AVATAR_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    className={`preset-chip-btn ${profileForm.avatar_url === p.url ? "selected" : ""}`}
                    onClick={() => setProfileForm({ ...profileForm, avatar_url: p.url })}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mobile-divider" style={{ margin: "16px 0" }} />

            {/* 3. PROFILE INFO FIELDS */}
            <label className="profile-edit-label">Name</label>
            <input
              className="auth-input"
              placeholder="Display name"
              value={profileForm.name}
              onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
              style={{ marginBottom: "12px" }}
            />

            <label className="profile-edit-label">Username</label>
            <input
              className="auth-input"
              placeholder="Username handle"
              value={profileForm.username}
              onChange={(e) => setProfileForm({ ...profileForm, username: e.target.value })}
              style={{ marginBottom: "12px" }}
            />

            <label className="profile-edit-label">Bio</label>
            <input
              className="auth-input"
              placeholder="Short bio"
              value={profileForm.bio}
              onChange={(e) => setProfileForm({ ...profileForm, bio: e.target.value })}
              style={{ marginBottom: "12px" }}
            />

            <label className="profile-edit-label">Skills</label>
            <input
              className="auth-input"
              placeholder="e.g. Go, React, Python"
              value={profileForm.skills}
              onChange={(e) => setProfileForm({ ...profileForm, skills: e.target.value })}
              style={{ marginBottom: "12px" }}
            />

            <label className="profile-edit-label">Location</label>
            <input
              className="auth-input"
              placeholder="City, Country"
              value={profileForm.location}
              onChange={(e) => setProfileForm({ ...profileForm, location: e.target.value })}
              style={{ marginBottom: "18px" }}
            />

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button className="edit-profile-pill-btn" onClick={() => setEditingProfile(false)}>
                Cancel
              </button>
              <button
                className="post-pill-submit"
                onClick={async () => {
                  try {
                    const res = await fetch(`${API_URL}/api/users/${user?.id}`, {
                      method: "PUT",
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                      },
                      body: JSON.stringify({
                        name: profileForm.name || profileForm.username,
                        username: profileForm.username,
                        bio: profileForm.bio,
                        skills: profileForm.skills,
                        location: profileForm.location,
                        avatar_url: profileForm.avatar_url,
                        banner_url: profileForm.banner_url,
                      }),
                    });
                    if (res.ok) {
                      const updated = await res.json();
                      setUser(updated);
                      if (user?.id) fetchProfile(user.id);
                      setEditingProfile(false);
                    }
                  } catch (err) {
                    console.error("Failed to update profile", err);
                  }
                }}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT POST MODAL */}
      {editingPost && (
        <div className="modal-overlay-nesty" onClick={() => setEditingPost(null)}>
          <div className="modal-content-card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: "12px", color: "var(--text-h)" }}>Edit Post</h3>
            <textarea
              className="composer-textarea"
              style={{ minHeight: "120px", border: "1px solid var(--border)", borderRadius: "10px", padding: "10px", marginBottom: "14px" }}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button className="edit-profile-pill-btn" onClick={() => setEditingPost(null)}>Cancel</button>
              <button
                className="post-pill-submit"
                onClick={async () => {
                  try {
                    const res = await fetch(`${API_URL}/api/posts/${editingPost.id}`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                      body: JSON.stringify({ content: editText })
                    });
                    if (res.ok) {
                      setPosts(prev => prev.map(p => p.id === editingPost.id ? { ...p, content: editText } : p));
                      setEditingPost(null);
                    }
                  } catch (err) { console.error(err); }
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}


      {/* =====================================================================
          CHAT DRAWER & MESSAGING MODAL
          ===================================================================== */}
      {activeChatPartner && (
        <div className="chat-drawer-overlay">
          <div className="chat-drawer-header">
            <div
              className="chat-partner-info"
              style={{ cursor: "pointer" }}
              title={`View @${activeChatPartner.username}'s profile`}
              onClick={() => {
                if (activeChatPartner.id) {
                  openProfile(activeChatPartner.id);
                  setActiveChatPartner(null);
                }
              }}
            >
              <div className="chat-partner-avatar">
                {activeChatPartner.avatar_url ? (
                  <img src={activeChatPartner.avatar_url} alt="" style={{ width: "100%", height: "100%", borderRadius: "50%" }} />
                ) : (
                  (activeChatPartner.username || "U").charAt(0).toUpperCase()
                )}
              </div>
              <div className="chat-partner-details">
                <span className="chat-partner-name">{activeChatPartner.name || activeChatPartner.username}</span>
                <span className="chat-partner-status">Active now</span>
              </div>
            </div>
            <div className="chat-header-actions">
              <button
                className="chat-header-icon-btn"
                title="Voice Call"
                onClick={() => startCallWithUser(activeChatPartner, false)}
              >
                📞
              </button>
              <button
                className="chat-header-icon-btn"
                title="Video Call"
                onClick={() => startCallWithUser(activeChatPartner, true)}
              >
                📹
              </button>
              <button
                className="chat-header-icon-btn"
                title="Close chat"
                onClick={() => setActiveChatPartner(null)}
              >
                ✕
              </button>
            </div>
          </div>

          <div className="chat-messages-container">
            {isChatLoading ? (
              <div style={{ textAlign: "center", padding: "20px", color: "var(--text-muted)", fontSize: "13px" }}>
                Loading conversation...
              </div>
            ) : chatMessages.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-muted)", fontSize: "13px" }}>
                Say hi to @{activeChatPartner.username}! 👋 Start the conversation.
              </div>
            ) : (
              chatMessages.map((msg, i) => {
                const isMine = msg.sender_id === user?.id;
                const mediaUrl = msg.media_url || (msg as any).MediaURL;
                const mediaType = msg.media_type || (msg as any).MediaType;
                const fileName = msg.file_name || (msg as any).FileName;
                const fileSize = msg.file_size || (msg as any).FileSize;
                const timestamp = msg.created_at || (msg as any).CreatedAt;
                return (
                  <div key={msg.id || (msg as any).ID || i} className={`chat-msg-row ${isMine ? "outgoing" : "incoming"}`}>
                    <div className="chat-msg-bubble">
                      {mediaUrl && (
                        <>
                          {mediaType === "image" ? (
                            <a href={mediaUrl} target="_blank" rel="noopener noreferrer">
                              <img
                                src={mediaUrl}
                                alt={fileName || "Attachment"}
                                className="chat-msg-media-img"
                              />
                            </a>
                          ) : mediaType === "video" ? (
                            <video
                              src={mediaUrl}
                              controls
                              playsInline
                              className="chat-msg-media-video"
                            />
                          ) : mediaType === "audio" ? (
                            <audio
                              src={mediaUrl}
                              controls
                              className="chat-msg-media-audio"
                            />
                          ) : (
                            <a
                              href={mediaUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              download={fileName}
                              className="chat-msg-doc-pill"
                            >
                              <span className="doc-icon">📄</span>
                              <div className="doc-info">
                                <span className="doc-name">{fileName || "Document"}</span>
                                <span className="doc-size">
                                  {fileSize
                                    ? `${(fileSize / 1024).toFixed(0)} KB`
                                    : "Download"}
                                </span>
                              </div>
                              <span className="doc-dl-icon">⬇</span>
                            </a>
                          )}
                        </>
                      )}
                      {msg.content && <div>{msg.content}</div>}
                      {timestamp && (
                        <span className="chat-msg-time">{timeAgo(timestamp)}</span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={chatBottomRef} />
          </div>

          <form
            className="chat-drawer-footer"
            onSubmit={(e) => {
              e.preventDefault();
              sendChatMessage();
            }}
          >
            {/* Hidden file input for media & docs */}
            <input
              type="file"
              ref={chatFileInputRef}
              style={{ display: "none" }}
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.csv"
              onChange={handleChatFileSelect}
            />

            {/* Selected file preview pill */}
            {chatSelectedFile && (
              <div className="chat-file-preview">
                <div className="chat-file-preview-info">
                  {chatFilePreview ? (
                    <img src={chatFilePreview} alt="Preview" className="chat-file-preview-thumb" />
                  ) : (
                    <span className="chat-file-preview-icon">
                      {chatSelectedFile.type.startsWith("video/")
                        ? "🎥"
                        : chatSelectedFile.type.startsWith("audio/")
                        ? "🎵"
                        : "📄"}
                    </span>
                  )}
                  <div className="chat-file-preview-meta">
                    <span className="chat-file-preview-name">{chatSelectedFile.name}</span>
                    <span className="chat-file-preview-size">
                      {(chatSelectedFile.size / 1024).toFixed(0)} KB
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="chat-file-preview-remove"
                  onClick={removeChatSelectedFile}
                  title="Remove attachment"
                >
                  ✕
                </button>
              </div>
            )}

            <div className="chat-drawer-footer-row">
              <button
                type="button"
                className="chat-attach-btn"
                title="Attach media or document"
                onClick={() => chatFileInputRef.current?.click()}
                disabled={isChatUploading}
              >
                📎
              </button>
              <input
                type="text"
                className="chat-drawer-input"
                placeholder={
                  isChatUploading
                    ? "Uploading attachment..."
                    : `Message @${activeChatPartner.username}...`
                }
                value={chatInputText}
                onChange={(e) => setChatInputText(e.target.value)}
                autoFocus
                disabled={isChatUploading}
              />
              <button
                type="submit"
                className="chat-drawer-send-btn"
                disabled={(!chatInputText.trim() && !chatSelectedFile) || isChatUploading}
              >
                {isChatUploading ? "..." : "Send"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* =====================================================================
          INCOMING CALL MODAL
          ===================================================================== */}
      {incomingCall && (
        <div className="incoming-call-overlay" onClick={requestMobileScreenTakeover}>
          <div className="incoming-call-card" onClick={(e) => { e.stopPropagation(); requestMobileScreenTakeover(); }}>
            <div
              className="call-avatar-wrapper"
              style={{ cursor: "pointer" }}
              onClick={() => incomingCall.caller.id && openProfile(incomingCall.caller.id)}
            >
              <div className="call-pulse-ring" style={{ borderColor: "#22c55e" }} />
              <div className="call-avatar-img">
                {incomingCall.caller.avatar_url ? (
                  <img
                    src={incomingCall.caller.avatar_url}
                    alt=""
                    style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }}
                  />
                ) : (
                  (incomingCall.caller.username || "U").charAt(0).toUpperCase()
                )}
              </div>
            </div>

            <div
              className="call-user-name"
              style={{ cursor: "pointer" }}
              onClick={() => incomingCall.caller.id && openProfile(incomingCall.caller.id)}
            >
              {incomingCall.caller.name || incomingCall.caller.username}
            </div>
            <div
              className="call-user-handle"
              style={{ cursor: "pointer" }}
              onClick={() => incomingCall.caller.id && openProfile(incomingCall.caller.id)}
            >
              @{incomingCall.caller.username}
            </div>

            <div className="incoming-call-badge">
              {incomingCall.isVideo ? "📹 Incoming Video Call..." : "📞 Incoming Voice Call..."}
            </div>

            <div className="incoming-call-actions">
              <div className="incoming-action-wrapper">
                <button
                  className="incoming-action-btn decline"
                  title="Decline Call"
                  onClick={declineIncomingCall}
                >
                  ✕
                </button>
                <span className="incoming-action-label">Decline</span>
              </div>

              <div className="incoming-action-wrapper">
                <button
                  className="incoming-action-btn accept"
                  title="Answer Call"
                  onClick={acceptIncomingCall}
                >
                  {incomingCall.isVideo ? "📹" : "📞"}
                </button>
                <span className="incoming-action-label">{incomingCall.isVideo ? "Answer Video" : "Answer"}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          ACTIVE CALL OVERLAY & REAL WEBRTC VIDEO / VOICE CALL MODAL
          ===================================================================== */}
      {activeCall && (
        <div className="call-overlay" onClick={endCall}>
          {/* Real Audio playback element */}
          <audio ref={remoteAudioRef} autoPlay playsInline />

          <div
            className={`call-modal-card ${activeCall.isVideo && activeCall.status === "connected" ? "video-active" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              requestMobileScreenTakeover();
            }}
          >
            {!(activeCall.isVideo && activeCall.status === "connected") ? (
              <>
                <div
                  className="call-avatar-wrapper"
                  style={{ cursor: "pointer" }}
                  onClick={() => activeCall.partner.id && openProfile(activeCall.partner.id)}
                >
                  {activeCall.status === "ringing" && <div className="call-pulse-ring" />}
                  <div className="call-avatar-img">
                    {activeCall.partner.avatar_url ? (
                      <img src={activeCall.partner.avatar_url} alt="" style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} />
                    ) : (
                      (activeCall.partner.username || "U").charAt(0).toUpperCase()
                    )}
                  </div>
                </div>

                <div
                  className="call-user-name"
                  style={{ cursor: "pointer" }}
                  onClick={() => activeCall.partner.id && openProfile(activeCall.partner.id)}
                >
                  {activeCall.partner.name || activeCall.partner.username}
                </div>
                <div
                  className="call-user-handle"
                  style={{ cursor: "pointer" }}
                  onClick={() => activeCall.partner.id && openProfile(activeCall.partner.id)}
                >
                  @{activeCall.partner.username}
                </div>

                <div className={`call-status-badge ${activeCall.status === "connected" ? "connected" : ""}`}>
                  {activeCall.status === "calling" && (activeCall.statusText || "Calling...")}
                  {activeCall.status === "ringing" && (activeCall.statusText || "🔔 Ringing...")}
                  {activeCall.status === "connected" && (
                    <>Connected • <CallDurationTimer isConnected={activeCall.status === "connected"} /></>
                  )}
                  {activeCall.status === "ended" && (activeCall.statusText || "Call ended")}
                </div>
              </>
            ) : (
              <div className="call-video-header-overlay">
                <div
                  style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}
                  onClick={() => activeCall.partner.id && openProfile(activeCall.partner.id)}
                >
                  <div className="search-avatar-mini">
                    {activeCall.partner.avatar_url ? (
                      <img src={activeCall.partner.avatar_url} alt="" />
                    ) : (
                      (activeCall.partner.username || "U").charAt(0).toUpperCase()
                    )}
                  </div>
                  <div style={{ textAlign: "left" }}>
                    <div style={{ fontWeight: 600, fontSize: "14px", color: "#ffffff" }}>
                      {activeCall.partner.name || activeCall.partner.username}
                    </div>
                    <div style={{ fontSize: "11px", color: "#38bdf8" }}>
                      Connected • <CallDurationTimer isConnected={activeCall.status === "connected"} />
                    </div>
                  </div>
                </div>
                <button
                  className="call-ctrl-btn"
                  style={{ width: "38px", height: "38px", fontSize: "14px" }}
                  title="Flip camera"
                  onClick={flipCamera}
                >
                  🔄
                </button>
              </div>
            )}

            {/* If Video Call: real WebRTC remote video feed + local PIP video */}
            {activeCall.isVideo ? (
              <div className="call-video-grid">
                <VideoFeed
                  stream={remoteStream}
                  isMuted={true}
                  className="call-video-element"
                  style={{ display: activeCall.status === "connected" ? "block" : "none" }}
                />

                {activeCall.status !== "connected" && (
                  <div className="call-calling-preview-container">
                    <VideoFeed
                      stream={localStream}
                      isMuted={true}
                      className="call-calling-preview-video"
                      style={{ transform: facingMode === "user" ? "scaleX(-1)" : "none" }}
                    />
                    <div className="call-calling-preview-overlay">
                      <span className="call-calling-tag">
                        📹 {activeCall.status === "calling" ? "Calling..." : "🔔 Ringing..."}
                      </span>
                      <span className="call-calling-sub">Connecting with @{activeCall.partner.username}</span>
                    </div>
                  </div>
                )}

                {activeCall.status === "connected" && (
                  <div className="call-video-pip" onClick={flipCamera} title="Click to flip camera">
                    <VideoFeed
                      stream={localStream}
                      isMuted={true}
                      className="call-video-pip-element"
                      style={{ transform: facingMode === "user" ? "scaleX(-1)" : "none" }}
                    />
                    <span className="pip-flip-badge" title="Flip camera">🔄</span>
                  </div>
                )}
              </div>
            ) : (
              /* If Voice Call: audio waveform visualizer */
              <div className="audio-waves-container">
                <div className="wave-bar" style={{ animationDelay: "0.1s" }} />
                <div className="wave-bar" style={{ animationDelay: "0.3s" }} />
                <div className="wave-bar" style={{ animationDelay: "0.2s" }} />
                <div className="wave-bar" style={{ animationDelay: "0.5s" }} />
                <div className="wave-bar" style={{ animationDelay: "0.4s" }} />
                <div className="wave-bar" style={{ animationDelay: "0.2s" }} />
                <div className="wave-bar" style={{ animationDelay: "0.3s" }} />
              </div>
            )}

            <div className="call-actions-row">
              <button
                className={`call-ctrl-btn ${activeCall.isMuted ? "active" : ""}`}
                title={activeCall.isMuted ? "Unmute" : "Mute"}
                onClick={toggleMute}
              >
                {activeCall.isMuted ? "🔇" : "🎤"}
              </button>
              <button
                className={`call-ctrl-btn ${activeCall.isVideo ? "active" : ""}`}
                title={activeCall.isVideo ? "Turn off video" : "Turn on video"}
                onClick={toggleVideo}
              >
                {activeCall.isVideo ? "📹" : "📷"}
              </button>
              {activeCall.isVideo && (
                <button
                  className="call-ctrl-btn"
                  title={`Flip Camera (${facingMode === "user" ? "Switch to Back Camera" : "Switch to Front Camera"})`}
                  onClick={flipCamera}
                >
                  🔄
                </button>
              )}
              <button
                className={`call-ctrl-btn ${activeCall.isSpeaker ? "active" : ""}`}
                title={activeCall.isSpeaker ? "Speaker On" : "Speaker Off"}
                onClick={toggleSpeaker}
              >
                {activeCall.isSpeaker ? "🔊" : "🔈"}
              </button>
              <button
                className="call-ctrl-btn end-call"
                title="End Call"
                onClick={endCall}
              >
                📞
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ONLINE NESTERS MODAL */}
      {onlineModalOpen && (
        <div className="modal-overlay-nesty" onClick={() => setOnlineModalOpen(false)}>
          <div className="modal-content-card online-nesters-modal" onClick={(e) => e.stopPropagation()}>
            <div className="online-modal-header">
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "22px" }}>🟢</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 700, color: "var(--text-h)" }}>Online Nesters</h3>
                  <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                    {communityStats.online_users.length} active now
                  </span>
                </div>
              </div>
              <button className="edit-profile-pill-btn" onClick={() => setOnlineModalOpen(false)}>✕</button>
            </div>

            <div className="online-modal-list">
              {communityStats.online_users.length === 0 ? (
                <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--text-muted)", fontSize: "14px" }}>
                  No nesters online right now
                </div>
              ) : (
                communityStats.online_users.map((u, i) => (
                  <div key={u.id || i} className="online-modal-user-card">
                    <div
                      className="online-modal-user-left"
                      onClick={() => {
                        if (u.id) {
                          openProfile(u.id);
                          setOnlineModalOpen(false);
                        }
                      }}
                    >
                      <div className="online-user-avatar" style={{ background: "#047857" }}>
                        {u.avatar_url ? (
                          <img
                            src={u.avatar_url}
                            alt={u.username}
                            className="online-avatar-img"
                            style={{ width: "40px", height: "40px", borderRadius: "50%", objectFit: "cover", flexShrink: 0, maxWidth: "100%" }}
                          />
                        ) : (
                          <span className="online-avatar-initial">{u.username.charAt(0).toUpperCase()}</span>
                        )}
                        <span className="online-dot-badge" />
                      </div>
                      <div className="online-user-meta">
                        <span className="online-user-name">
                          {u.name || u.username} {u.id === user?.id ? " (You)" : ""}
                        </span>
                      </div>
                    </div>

                    {u.id && u.id !== user?.id && (
                      <div className="online-modal-user-actions">
                        <button
                          className="online-action-btn chat"
                          title={`Chat with ${u.username}`}
                          onClick={() => {
                            startChatWithUser({ id: u.id!, username: u.username, email: "", avatar_url: u.avatar_url, name: u.name });
                            setOnlineModalOpen(false);
                          }}
                        >
                          💬 Chat
                        </button>
                        <button
                          className="online-action-btn voice"
                          title={`Voice Call ${u.username}`}
                          onClick={() => {
                            startCallWithUser({ id: u.id!, username: u.username, email: "", avatar_url: u.avatar_url, name: u.name }, false);
                            setOnlineModalOpen(false);
                          }}
                        >
                          📞 Voice
                        </button>
                        <button
                          className="online-action-btn video"
                          title={`Video Call ${u.username}`}
                          onClick={() => {
                            startCallWithUser({ id: u.id!, username: u.username, email: "", avatar_url: u.avatar_url, name: u.name }, true);
                            setOnlineModalOpen(false);
                          }}
                        >
                          📹 Video
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* FOLLOWERS / FOLLOWING MODAL */}
      {followListModal && (
        <div className="modal-overlay-nesty" onClick={() => setFollowListModal(null)}>
          <div className="modal-content-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <h3 style={{ textTransform: "capitalize", color: "var(--text-h)" }}>{followListModal.type}</h3>
              <button className="edit-profile-pill-btn" onClick={() => setFollowListModal(null)}>✕</button>
            </div>
            {followListLoading ? (
              <p>Loading...</p>
            ) : followListUsers.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>No {followListModal.type} yet.</p>
            ) : (
              <div style={{ maxHeight: "300px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px" }}>
                {followListUsers.map((fu) => (
                  <div key={fu.id} style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }} onClick={() => { openProfile(fu.id); setFollowListModal(null); }}>
                    <div className="search-avatar-mini">{fu.username.charAt(0).toUpperCase()}</div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "13.5px" }}>{fu.name || fu.username}</div>
                      <div style={{ color: "var(--text-muted)", fontSize: "11.5px" }}>@{fu.username}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}