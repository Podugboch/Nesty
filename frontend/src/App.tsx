import React, { useState, useEffect, useRef, useMemo } from "react";
import { timeAgo } from "./utils/timeAgo";
import { MusicPicker, type MusicTrack } from "./components/MusicPicker";
import { ReelsView } from "./components/ReelsView";
import { ReelCreateView } from "./components/ReelCreateView";
import "./App.css";

const API_URL: string = (() => {
  const envUrl = (import.meta as any).env?.VITE_API_URL;
  if (envUrl) return envUrl.replace(/\/+$/, "");
  if (typeof window !== "undefined") {
    const isCapacitor = !!(window as any).Capacitor?.isNativePlatform?.() || window.location.protocol === "capacitor:";
    if (isCapacitor) {
      return "https://piscine-devnest.onrender.com";
    }
    const host = window.location.hostname;
    const port = window.location.port;
    if ((host === "localhost" || host === "127.0.0.1") && port === "5173") {
      return "http://localhost:8080";
    }
    if ((host === "localhost" || host === "127.0.0.1") && (port === "" || port === "80" || port === "443")) {
      return "https://piscine-devnest.onrender.com";
    }
    return window.location.origin.replace(/\/+$/, "");
  }
  return "https://piscine-devnest.onrender.com";
})();

const WS_BASE_URL: string = (() => {
  const envWs = (import.meta as any).env?.VITE_WS_URL;
  if (envWs) return envWs.replace(/\/+$/, "");
  if (typeof window !== "undefined") {
    const isCapacitor = !!(window as any).Capacitor?.isNativePlatform?.() || window.location.protocol === "capacitor:";
    if (isCapacitor) {
      return "wss://piscine-devnest.onrender.com";
    }
    const host = window.location.hostname;
    const port = window.location.port;
    if ((host === "localhost" || host === "127.0.0.1") && port === "5173") {
      return `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${host}:8080`;
    }
    if ((host === "localhost" || host === "127.0.0.1") && (port === "" || port === "80" || port === "443")) {
      return "wss://piscine-devnest.onrender.com";
    }
    return `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
  }
  return "wss://piscine-devnest.onrender.com";
})();


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
  is_following?: boolean;
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
  music_track_id?: number | null;
  music_track?: MusicTrack | null;
  music_start_sec?: number;
  mute_original?: boolean;
  music_volume?: number;
  original_volume?: number;
};

type ReelItem = {
  id: string | number;
  userId: number;
  username: string;
  name?: string;
  avatarUrl?: string;
  videoUrl: string;
  caption: string;
  likes: number;
  likedByMe?: boolean;
  commentsCount: number;
  audioTitle?: string;
  music_track_id?: number | null;
  music_track?: MusicTrack | null;
  music_start_sec?: number;
  mute_original?: boolean;
  music_volume?: number;
  original_volume?: number;
};

// ---------------------------------------------------------------------------
// FEED POST PLAYBACK COMPONENT (VIDEO/AUDIO SYNC & IMAGE SOUNDTRACK)
// ---------------------------------------------------------------------------
const PostPlaybackMedia: React.FC<{
  post: Post;
  activePlayingPostId: number | null;
  setActivePlayingPostId: (id: number | null) => void;
}> = ({ post, activePlayingPostId, setActivePlayingPostId }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);

  const hasMusic = !!post.music_track;
  const isVideo = !!(post.media_url && post.media_url.match(/\.(mp4|webm|mov|ogg)/i));
  const isImage = !!(post.media_url && !isVideo && post.media_url !== "photo_placeholder");

  // Keep audio volume in sync
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = post.music_volume != null ? Math.max(0, Math.min(1, post.music_volume)) : 1;
    }
  }, [post.music_volume]);

  // Keep video volume and mute state in sync
  useEffect(() => {
    if (videoRef.current) {
      const origVol = post.original_volume != null ? Math.max(0, Math.min(1, post.original_volume)) : 1;
      videoRef.current.volume = origVol;
      videoRef.current.muted = post.mute_original || origVol === 0;
    }
  }, [post.original_volume, post.mute_original]);

  // Pause if another post becomes active
  useEffect(() => {
    if (activePlayingPostId !== null && activePlayingPostId !== post.id) {
      if (videoRef.current && !videoRef.current.paused) {
        videoRef.current.pause();
      }
      if (audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause();
        setIsPlayingAudio(false);
      }
    }
  }, [activePlayingPostId, post.id]);

  // IntersectionObserver to pause when scrolled out of view, and for image posts play when in view
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            // Scrolled out of view
            if (videoRef.current && !videoRef.current.paused) {
              videoRef.current.pause();
            }
            if (audioRef.current && !audioRef.current.paused) {
              audioRef.current.pause();
              setIsPlayingAudio(false);
            }
          } else {
            // Scrolled into view
            if (isImage && hasMusic && (activePlayingPostId === null || activePlayingPostId === post.id)) {
              if (audioRef.current && audioRef.current.paused) {
                audioRef.current.currentTime = post.music_start_sec || 0;
                audioRef.current.play().then(() => {
                  setActivePlayingPostId(post.id);
                  setIsPlayingAudio(true);
                }).catch(() => {});
              }
            }
          }
        });
      },
      { threshold: 0.5 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [isImage, hasMusic, activePlayingPostId, post.id, post.music_start_sec, setActivePlayingPostId]);

  // Sync video and audio
  const handleVideoPlay = () => {
    setActivePlayingPostId(post.id);
    if (audioRef.current && hasMusic) {
      const targetTime = (post.music_start_sec || 0) + (videoRef.current?.currentTime || 0);
      audioRef.current.currentTime = targetTime;
      audioRef.current.play().catch(() => {});
      setIsPlayingAudio(true);
    }
  };

  const handleVideoPause = () => {
    if (audioRef.current && hasMusic) {
      audioRef.current.pause();
      setIsPlayingAudio(false);
    }
  };

  const handleVideoSeeked = () => {
    if (audioRef.current && hasMusic && videoRef.current) {
      const targetTime = (post.music_start_sec || 0) + videoRef.current.currentTime;
      audioRef.current.currentTime = targetTime;
    }
  };

  const toggleImageAudio = () => {
    if (!audioRef.current) return;
    if (audioRef.current.paused) {
      audioRef.current.currentTime = post.music_start_sec || 0;
      audioRef.current.play().then(() => {
        setActivePlayingPostId(post.id);
        setIsPlayingAudio(true);
      }).catch(() => {});
    } else {
      audioRef.current.pause();
      setIsPlayingAudio(false);
    }
  };

  return (
    <div ref={containerRef} className="post-media-with-audio-wrap">
      {/* ♪ Title – Artist Soundtrack Badge */}
      {hasMusic && post.music_track && (
        <div
          className="post-soundtrack-pill"
          onClick={isImage ? toggleImageAudio : undefined}
          style={{ cursor: isImage ? "pointer" : "default" }}
          title={isImage ? (isPlayingAudio ? "Click to pause music" : "Click to play music") : undefined}
        >
          <span className="post-soundtrack-note">♪</span>
          <span className="post-soundtrack-text">
            {post.music_track.title} – {post.music_track.artist}
          </span>
          {isImage && (
            <span style={{ fontSize: "11px", marginLeft: "4px", opacity: 0.8 }}>
              {isPlayingAudio ? "⏸" : "▶"}
            </span>
          )}
        </div>
      )}

      {/* Hidden audio element for music soundtrack */}
      {hasMusic && post.music_track && (
        <audio
          ref={audioRef}
          src={post.music_track.audio_url}
          loop
          preload="auto"
          style={{ display: "none" }}
        />
      )}

      {/* Media: Video or Image */}
      {isVideo && (
        <div className="post-media-container">
          <video
            ref={videoRef}
            src={post.media_url}
            controls
            playsInline
            onPlay={handleVideoPlay}
            onPause={handleVideoPause}
            onSeeked={handleVideoSeeked}
          />
        </div>
      )}

      {isImage && (
        <div className="post-media-container">
          <img src={post.media_url} alt="Attachment" />
        </div>
      )}
    </div>
  );
};


type QuotedMsg = {
  id: number;
  sender_id: number;
  username: string;
  sender_name: string;
  content: string;
  media_url?: string;
  media_type?: string;
  is_deleted?: boolean;
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
  reply_to_message_id?: number | null;
  reply_to_message?: QuotedMsg | null;
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
  createdById?: number;
  requiresApproval?: boolean;
  memberCount?: number;
  currentUserRole?: "admin" | "co_admin" | "member" | "pending" | "invited" | "none";
};

type CommunityMemberItem = {
  id: number;
  community_id: number;
  user_id: number;
  role: "admin" | "co_admin" | "member";
  status: "active" | "pending" | "invited";
  created_at?: string;
  user?: User;
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
  // NAVIGATION & COMMUNITIES (HOME IS NOT A COMMUNITY - IT'S THE ALGORITHMIC FEED)
  // -----------------------------
  // URL Route Synchronization
  const [page, setPage] = useState<"feed" | "create" | "profile" | "reels" | "reels_create">(() => {
    if (typeof window !== "undefined") {
      const path = window.location.pathname;
      if (path === "/reels") return "reels";
      if (path === "/reels/create") return "reels_create";
      if (path.startsWith("/profile") || path.startsWith("/u/")) return "profile";
    }
    return "feed";
  });

  const navigateTo = (path: string) => {
    if (typeof window !== "undefined") {
      window.history.pushState({}, "", path);
      if (path === "/reels") {
        setPage("reels");
      } else if (path === "/reels/create") {
        setPage("reels_create");
      } else if (path === "/" || path === "") {
        setPage("feed");
        setSelectedCommunity("home");
      }
    }
  };

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      if (path === "/reels") {
        setPage("reels");
      } else if (path === "/reels/create") {
        setPage("reels_create");
      } else if (path === "/" || path === "") {
        setPage("feed");
        setSelectedCommunity("home");
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const [selectedCommunity, setSelectedCommunity] = useState<string>("home");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Algorithmic feed controls:
  const [feedTab, setFeedTab] = useState<"for_you" | "following" | "trending" | "latest">("for_you");
  const [feedFilterMedia, setFeedFilterMedia] = useState<boolean>(false);

  // Real user-created communities (no seeded/fake communities)
  const [communities, setCommunities] = useState<CommunityChannel[]>([]);

  const fetchCommunities = async () => {
    try {
      const headers: Record<string, string> = {};
      const authToken = token || localStorage.getItem("token");
      if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

      const res = await fetch(`${API_URL}/api/communities`, { headers });
      if (res.ok) {
        const data = await res.json();
        const list: CommunityChannel[] = (data.communities || []).map((c: any) => ({
          id: c.slug || String(c.id),
          name: c.name,
          badgeClass: c.badge_class || "custom",
          subtitle: c.description || `Community channel for ${c.name}`,
          createdById: c.created_by_id,
          requiresApproval: !!c.requires_approval,
          memberCount: c.member_count || 1,
          currentUserRole: c.current_user_role || "none",
        }));
        setCommunities(list);
      }
    } catch (err) {
      console.error("Failed to fetch communities:", err);
    }
  };

  useEffect(() => {
    fetchCommunities();
  }, [token]);

  const [createCommModalOpen, setCreateCommModalOpen] = useState(false);
  const [newCommName, setNewCommName] = useState("");
  const [newCommDescription, setNewCommDescription] = useState("");
  const [newCommRequiresApproval, setNewCommRequiresApproval] = useState(false);

  // Track communities searched/viewed by user
  const [searchedCommunityIds, setSearchedCommunityIds] = useState<Set<string>>(new Set());

  // Incoming community call broadcast notification
  const [incomingCommunityCall, setIncomingCommunityCall] = useState<{
    channelId: string;
    channelName: string;
    callType: "audio" | "video";
    callerName: string;
    callerAvatar?: string;
  } | null>(null);

  // Manage Community Modal state (for Admins & Co-Admins)
  const [manageCommModalOpen, setManageCommModalOpen] = useState(false);
  const [manageCommSlug, setManageCommSlug] = useState("");
  const [manageCommMembers, setManageCommMembers] = useState<CommunityMemberItem[]>([]);
  const [manageCommPending, setManageCommPending] = useState<CommunityMemberItem[]>([]);
  const [manageCommLoading, setManageCommLoading] = useState(false);
  const [manageCommRequiresApproval, setManageCommRequiresApproval] = useState(false);
  const [manageTab, setManageTab] = useState<"pending" | "members" | "invite">("pending");
  const [inviteSearchQuery, setInviteSearchQuery] = useState("");
  const [inviteSearchResults, setInviteSearchResults] = useState<User[]>([]);


  const handleAcceptCommunityInvite = async (slug: string) => {
    try {
      const authToken = token || localStorage.getItem("token");
      const res = await fetch(`${API_URL}/api/communities/${slug}/accept-invite`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        alert("Invitation accepted! Welcome to the community.");
        fetchCommunities();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Failed to accept invitation.");
      }
    } catch (err) {
      console.error("Failed to accept invite", err);
    }
  };

  const handleDeclineCommunityInvite = async (slug: string) => {
    if (!window.confirm("Are you sure you want to decline this invitation?")) return;
    try {
      const authToken = token || localStorage.getItem("token");
      const res = await fetch(`${API_URL}/api/communities/${slug}/decline-invite`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        alert("Invitation declined.");
        fetchCommunities();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Failed to decline invitation.");
      }
    } catch (err) {
      console.error("Failed to decline invite", err);
    }
  };

  const handleInviteCommunityMember = async (slug: string, targetUserId: number) => {
    try {
      const authToken = token || localStorage.getItem("token");
      const res = await fetch(`${API_URL}/api/communities/${slug}/invite`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ user_id: targetUserId }),
      });
      if (res.ok) {
        alert("Invitation sent successfully!");
        setInviteSearchQuery("");
        setInviteSearchResults([]);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Failed to send invitation.");
      }
    } catch (err) {
      console.error("Failed to invite member", err);
      alert("Network error inviting member.");
    }
  };

  const handleJoinCommunity = async (slug: string) => {
    const authToken = token || localStorage.getItem("token");
    if (!authToken) {
      alert("Please log in to join this community.");
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/communities/${slug}/join`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        alert(data.message || "Successfully submitted join request.");
        setCommunities((prev) =>
          prev.map((c) =>
            c.id === slug
              ? {
                  ...c,
                  currentUserRole: data.status === "active" ? "member" : "pending",
                  memberCount: data.member_count ?? (data.status === "active" ? (c.memberCount || 1) + 1 : c.memberCount),
                }
              : c
          )
        );
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Failed to join community.");
      }
    } catch (err) {
      console.error("Failed to join community", err);
      alert("Network error joining community. Please try again.");
    }
  };

  const handleLeaveCommunity = async (slug: string) => {
    if (!window.confirm("Are you sure you want to leave this community?")) return;
    const authToken = token || localStorage.getItem("token");
    if (!authToken) return;
    try {
      const res = await fetch(`${API_URL}/api/communities/${slug}/leave`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        alert(data.message || "You have left the community.");
        setCommunities((prev) =>
          prev.map((c) =>
            c.id === slug
              ? {
                  ...c,
                  currentUserRole: "none",
                  memberCount: Math.max(1, (c.memberCount || 2) - 1),
                }
              : c
          )
        );
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Failed to leave community.");
      }
    } catch (err) {
      console.error("Failed to leave community", err);
    }
  };

  const openManageCommunity = async (slug: string) => {
    setManageCommSlug(slug);
    setManageCommModalOpen(true);
    setManageCommLoading(true);
    const comm = communities.find((c) => c.id === slug);
    if (comm) {
      setManageCommRequiresApproval(!!comm.requiresApproval);
    }

    const authToken = token || localStorage.getItem("token");
    if (!authToken) {
      setManageCommLoading(false);
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/communities/${slug}/members`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setManageCommMembers(data.members || []);
        setManageCommPending(data.pending || []);
        setManageCommRequiresApproval(!!data.requires_approval);
        if ((data.pending || []).length > 0) {
          setManageTab("pending");
        } else {
          setManageTab("members");
        }
      }
    } catch (err) {
      console.error("Failed to load community members:", err);
    } finally {
      setManageCommLoading(false);
    }
  };

  const handleApproveMember = async (slug: string, targetUserId: number) => {
    const authToken = token || localStorage.getItem("token");
    if (!authToken) return;
    try {
      const res = await fetch(`${API_URL}/api/communities/${slug}/members/${targetUserId}/approve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        const approvedItem = manageCommPending.find((p) => p.user_id === targetUserId);
        setManageCommPending((prev) => prev.filter((p) => p.user_id !== targetUserId));
        if (approvedItem) {
          setManageCommMembers((prev) => [
            ...prev,
            { ...approvedItem, status: "active", role: "member" },
          ]);
        }
        setCommunities((prev) =>
          prev.map((c) =>
            c.id === slug ? { ...c, memberCount: data.member_count ?? (c.memberCount || 1) + 1 } : c
          )
        );
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Failed to approve member.");
      }
    } catch (err) {
      console.error("Failed to approve member:", err);
    }
  };

  const handleRejectMember = async (slug: string, targetUserId: number) => {
    const authToken = token || localStorage.getItem("token");
    if (!authToken) return;
    try {
      const res = await fetch(`${API_URL}/api/communities/${slug}/members/${targetUserId}/reject`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        setManageCommPending((prev) => prev.filter((p) => p.user_id !== targetUserId));
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Failed to reject join request.");
      }
    } catch (err) {
      console.error("Failed to reject member:", err);
    }
  };

  const handleToggleMemberRole = async (slug: string, targetUserId: number, newRole: "co_admin" | "member") => {
    const authToken = token || localStorage.getItem("token");
    if (!authToken) return;
    try {
      const res = await fetch(`${API_URL}/api/communities/${slug}/members/${targetUserId}/role`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ role: newRole }),
      });
      if (res.ok) {
        const data = await res.json();
        alert(data.message || `Role updated to ${newRole}`);
        setManageCommMembers((prev) =>
          prev.map((m) => (m.user_id === targetUserId ? { ...m, role: newRole } : m))
        );
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Failed to update role.");
      }
    } catch (err) {
      console.error("Failed to update role:", err);
    }
  };

  const handleUpdateCommunitySettings = async (slug: string, requiresApproval: boolean) => {
    const authToken = token || localStorage.getItem("token");
    if (!authToken) return;
    setManageCommRequiresApproval(requiresApproval);
    try {
      const res = await fetch(`${API_URL}/api/communities/${slug}/settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ requires_approval: requiresApproval }),
      });
      if (res.ok) {
        setCommunities((prev) =>
          prev.map((c) => (c.id === slug ? { ...c, requiresApproval } : c))
        );
      }
    } catch (err) {
      console.error("Failed to update community settings:", err);
    }
  };

  // -----------------------------
  // REELS STATE (NO FAKE / MOCK ACCOUNTS)
  // -----------------------------
  const [reelsList, setReelsList] = useState<ReelItem[]>([]);
  const [activeReelIndex, setActiveReelIndex] = useState(0);
  const [createReelModalOpen, setCreateReelModalOpen] = useState(false);
  const [newReelVideoUrl, setNewReelVideoUrl] = useState("");
  const [newReelCaption, setNewReelCaption] = useState("");
  const [newReelAudio, setNewReelAudio] = useState("");
  const [newReelFile, setNewReelFile] = useState<File | null>(null);
  const [newReelPreview, setNewReelPreview] = useState<string | null>(null);
  const [isSubmittingReel, setIsSubmittingReel] = useState(false);

  // Music & Volume states for Reel Composer
  const [selectedReelMusic, setSelectedReelMusic] = useState<MusicTrack | null>(null);
  const [reelMusicPickerOpen, setReelMusicPickerOpen] = useState(false);
  const [reelMuteOriginal, setReelMuteOriginal] = useState(false);
  const [reelMusicVolume, setReelMusicVolume] = useState(1);
  const [reelOriginalVolume, setReelOriginalVolume] = useState(1);

  // Music state for Post Composer
  const [selectedPostMusic, setSelectedPostMusic] = useState<MusicTrack | null>(null);
  const [postMusicPickerOpen, setPostMusicPickerOpen] = useState(false);

  // Active audio source tracking
  const [activePlayingPostId, setActivePlayingPostId] = useState<number | null>(null);

  const [reelCommentsModalOpen, setReelCommentsModalOpen] = useState(false);
  const [activeReelComments, setActiveReelComments] = useState<{ id: string; user: string; text: string; time: string }[]>([]);
  const [newReelComment, setNewReelComment] = useState("");

  // GO LIVE STATE
  const [liveStudioOpen, setLiveStudioOpen] = useState(false);
  const [liveStreamTitle, setLiveStreamTitle] = useState("🔴 Live Stream & Hangout");
  const [liveStreamViewers, setLiveStreamViewers] = useState(0);
  const [liveStreamSeconds, setLiveStreamSeconds] = useState(0);
  const [isLiveMuted, setIsLiveMuted] = useState(false);
  const [isLiveVideoOff, setIsLiveVideoOff] = useState(false);
  const [liveChatMessages, setLiveChatMessages] = useState<{ id: string; user: string; text: string; time: string }[]>([]);
  const [liveChatInput, setLiveChatInput] = useState("");
  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const liveStreamMediaRef = useRef<MediaStream | null>(null);

  // Quoted message state for messaging
  const [replyingToMessage, setReplyingToMessage] = useState<ChatMessage | null>(null);

  // GROUP CALL STATE (WEBRTC MULTI-PEER MESH)
  interface GroupCallParticipant {
    id: number | string;
    name: string;
    username: string;
    isSpeaking?: boolean;
    avatarUrl?: string;
    stream?: MediaStream;
  }

  const [activeGroupCalls, setActiveGroupCalls] = useState<Record<string, any>>({});
  const [groupCallState, setGroupCallState] = useState<{
    channelId: string;
    channelName: string;
    type: "audio" | "video";
    startTime: number;
    isMuted: boolean;
    isVideoOff: boolean;
    isScreenSharing: boolean;
    participants: GroupCallParticipant[];
  } | null>(null);

  const groupCallStateRef = useRef<{
    channelId: string;
    channelName: string;
    type: "audio" | "video";
    startTime: number;
    isMuted: boolean;
    isVideoOff: boolean;
    isScreenSharing: boolean;
    participants: GroupCallParticipant[];
  } | null>(null);

  const groupLocalVideoRef = useRef<HTMLVideoElement | null>(null);
  const groupLocalStreamRef = useRef<MediaStream | null>(null);
  const groupPeersRef = useRef<Map<number, RTCPeerConnection>>(new Map());
  const groupCandidatesQueueRef = useRef<Map<number, RTCIceCandidateInit[]>>(new Map());
  const [groupCallDuration, setGroupCallDuration] = useState(0);

  // Keep groupCallStateRef in sync with groupCallState
  useEffect(() => {
    groupCallStateRef.current = groupCallState;
  }, [groupCallState]);

  // -----------------------------
  // SEARCH
  // -----------------------------
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [searchFocused, setSearchFocused] = useState(false);

  // Communities visible on the user's dashboard:
  // Must be:
  // 1) A community the user is a member/admin/co-admin of, OR
  // 2) A community the user is invited to join (or pending approval), OR
  // 3) A community the user searched for or opened
  const dashboardCommunities = useMemo(() => {
    return communities.filter((c) => {
      // Actively searching in the search bar
      if (searchQuery.trim().length > 0) {
        const q = searchQuery.toLowerCase();
        if (c.name.toLowerCase().includes(q) || (c.subtitle && c.subtitle.toLowerCase().includes(q))) {
          return true;
        }
      }
      // Searched or opened in this session
      if (searchedCommunityIds.has(c.id) || selectedCommunity === c.id) {
        return true;
      }
      // Creator
      if (user && c.createdById === user.id) {
        return true;
      }
      // Member, Admin, Co-admin
      if (c.currentUserRole === "admin" || c.currentUserRole === "co_admin" || c.currentUserRole === "member") {
        return true;
      }
      // Invited or Pending
      if (c.currentUserRole === "invited" || c.currentUserRole === "pending") {
        return true;
      }
      return false;
    });
  }, [communities, searchQuery, searchedCommunityIds, selectedCommunity, user]);

  const matchingCommunities = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return communities.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.subtitle && c.subtitle.toLowerCase().includes(q))
    );
  }, [communities, searchQuery]);

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
  const [apkModalOpen, setApkModalOpen] = useState(false);
  const [callDiagModalOpen, setCallDiagModalOpen] = useState(false);
  const [permissionsModalOpen, setPermissionsModalOpen] = useState(false);
  const [messagesInboxOpen, setMessagesInboxOpen] = useState(false);
  const [conversationsList, setConversationsList] = useState<Array<{
    partner: User;
    last_message: string;
    last_time: string;
    media_type?: string;
    is_sender?: boolean;
  }>>([]);
  const [allUsersList, setAllUsersList] = useState<User[]>([]);
  const [messagesSearchQuery, setMessagesSearchQuery] = useState("");
  const [isMessagesInboxLoading, setIsMessagesInboxLoading] = useState(false);
  const [callPermissionsStatus, setCallPermissionsStatus] = useState<{
    notificationsEnabled: boolean;
    channelImportance: number;
    channelValid: boolean;
    canUseFullScreenIntent: boolean;
    isIgnoringBatteryOptimizations: boolean;
    brand: string;
  } | null>(null);
  const [batteryTipDismissed, setBatteryTipDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("devnest_dismiss_battery_tip") === "true";
    } catch {
      return false;
    }
  });
  const [isDevMode, setIsDevMode] = useState<boolean>(() => {
    try {
      return window.location.search.includes("dev=1") ||
        window.location.search.includes("dev=true") ||
        localStorage.getItem("devnest_dev_mode") === "true";
    } catch {
      return false;
    }
  });
  const [devClicks, setDevClicks] = useState<number>(0);

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
  const connectionFailureTimeoutRef = useRef<any>(null);
  const screenWakeLockRef = useRef<any>(null);
  const titleFlashIntervalRef = useRef<any>(null);
  const originalTitleRef = useRef<string>("Nesty");
  const dynamicIceServersRef = useRef<RTCIceServer[] | null>(null);

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
    // Dynamically discover production ICE/TURN servers from backend
    fetch(`${API_URL}/api/webrtc/config`)
      .then((res) => res.json())
      .then((data) => {
        if (data && Array.isArray(data.iceServers) && data.iceServers.length > 0) {
          dynamicIceServersRef.current = data.iceServers;
        }
      })
      .catch(() => {});

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

  const openMessagesInbox = async () => {
    setMessagesInboxOpen(true);
    setIsMessagesInboxLoading(true);
    try {
      if (token) {
        const [convRes, usersRes] = await Promise.all([
          fetch(`${API_URL}/api/conversations`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null),
          fetch(`${API_URL}/api/users`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null),
        ]);
        if (convRes && convRes.ok) {
          const data = await convRes.json();
          setConversationsList(Array.isArray(data) ? data : []);
        }
        if (usersRes && usersRes.ok) {
          const uData = await usersRes.json();
          setAllUsersList(Array.isArray(uData) ? uData.filter((u: User) => u.id !== user?.id) : []);
        }
      }
    } catch (err) {
      console.error("Error opening messages inbox:", err);
    } finally {
      setIsMessagesInboxLoading(false);
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

    const replyingSnapshot = replyingToMessage;
    setReplyingToMessage(null);

    const tempMsg: ChatMessage = {
      sender_id: user?.id || 0,
      recipient_id: activeChatPartner.id,
      content,
      media_url: uploadedUrl || (filePreview || undefined),
      media_type: mediaType || undefined,
      file_name: fileName || undefined,
      file_size: fileSize || undefined,
      created_at: new Date().toISOString(),
      reply_to_message_id: replyingSnapshot?.id || null,
      reply_to_message: replyingSnapshot
        ? {
            id: replyingSnapshot.id || 0,
            sender_id: replyingSnapshot.sender_id,
            username:
              replyingSnapshot.sender_id === user?.id
                ? user?.username || "You"
                : activeChatPartner.username,
            sender_name:
              replyingSnapshot.sender_id === user?.id
                ? user?.name || user?.username || "You"
                : activeChatPartner.name || activeChatPartner.username,
            content: replyingSnapshot.content,
            media_url: replyingSnapshot.media_url,
            media_type: replyingSnapshot.media_type,
          }
        : null,
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
          reply_to_message_id: replyingSnapshot?.id || null,
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

  const restoreMobileScreenLock = () => {
    if (typeof document !== "undefined" && document.fullscreenElement && document.exitFullscreen) {
      try {
        document.exitFullscreen().catch(() => {});
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

  const stopAllCallAlerts = () => {
    if (ringtoneCleanupRef.current) {
      ringtoneCleanupRef.current();
      ringtoneCleanupRef.current = null;
    }
    if (incomingCallNotifRef.current) {
      incomingCallNotifRef.current.close();
      incomingCallNotifRef.current = null;
    }
    if (titleFlashIntervalRef.current) {
      clearInterval(titleFlashIntervalRef.current);
      titleFlashIntervalRef.current = null;
      if (originalTitleRef.current) {
        document.title = originalTitleRef.current;
      }
    }
    if (callRingTimeoutRef.current) {
      clearTimeout(callRingTimeoutRef.current);
      callRingTimeoutRef.current = null;
    }
    if (screenWakeLockRef.current) {
      try {
        screenWakeLockRef.current.release();
      } catch {}
      screenWakeLockRef.current = null;
    }
    try {
      if ((window as any).AndroidCallBridge && (window as any).AndroidCallBridge.stopCallAlerts) {
        (window as any).AndroidCallBridge.stopCallAlerts();
      }
    } catch {}
  };

  // WebRTC media & peer connection setup
  const cleanupMediaAndCall = () => {
    stopAllCallAlerts();
    try {
      if ((window as any).AndroidCallBridge && (window as any).AndroidCallBridge.onCallEnded) {
        (window as any).AndroidCallBridge.onCallEnded();
      }
    } catch {}
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }
    lossStreakRef.current = 0;
    iceRestartCountRef.current = 0;
    clearTimeout(callDisconnectTimeoutRef.current);
    clearTimeout(callRingTimeoutRef.current);
    if (connectionFailureTimeoutRef.current) {
      clearTimeout(connectionFailureTimeoutRef.current);
      connectionFailureTimeoutRef.current = null;
    }

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

  const tuneBitrate = (pc: RTCPeerConnection, targetBitrate: number = 2500000) => {
    currentMaxBitrateRef.current = targetBitrate;
    try {
      const senders = pc.getSenders();
      // Video sender parameters: Full HD 1080p maxBitrate ~2500000 (or 1000000 adapted), maxFramerate 30, degradationPreference "maintain-framerate"
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

        // If packet loss stays above 8% for two checks, lower maxBitrate to 1000000. Raise it back to 2500000 when loss clears.
        if (lossRate > 8) {
          lossStreakRef.current += 1;
          if (lossStreakRef.current >= 2 && currentMaxBitrateRef.current > 1000000) {
            tuneBitrate(pc, 1000000);
          }
        } else {
          if (lossStreakRef.current > 0) {
            lossStreakRef.current = 0;
            if (currentMaxBitrateRef.current < 2500000) {
              tuneBitrate(pc, 2500000);
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

      // Video constraints: Full HD 1080p (1920x1080), 30-60 fps, facingMode
      const videoConstraints: MediaTrackConstraints = {
        facingMode: { ideal: targetFacing },
        width: { ideal: 1920, max: 1920 },
        height: { ideal: 1080, max: 1080 },
        frameRate: { ideal: 30, max: 60 },
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
              video: { facingMode: targetFacing, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 60 } },
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
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          frameRate: { ideal: 30, max: 60 },
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

    // Call REST endpoint only if WS delivery failed
    if (!wsDelivered) {
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

    const defaultStunServers: RTCIceServer[] = [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun3.l.google.com:19302" },
      { urls: "stun:stun4.l.google.com:19302" },
      { urls: "stun:stun.cloudflare.com:3478" },
      { urls: "stun:global.stun.twilio.com:3478" },
      { urls: "stun:stun.services.mozilla.com" },
      { urls: "stun:stun.nextcloud.com:443" },
    ];

    let iceServers: RTCIceServer[] = dynamicIceServersRef.current && dynamicIceServersRef.current.length > 0
      ? dynamicIceServersRef.current
      : defaultStunServers;

    if (turnUrl) {
      const cleanUrl = turnUrl.replace(/^(turn:)/, "").replace(/\?.*$/, "");
      iceServers = [
        ...iceServers,
        {
          urls: [
            `turn:${cleanUrl}?transport=udp`,
            `turn:${cleanUrl}?transport=tcp`,
          ],
          username: turnUsername,
          credential: turnCredential,
        },
      ];
    }

    const pc = new RTCPeerConnection({
      iceServers,
      bundlePolicy: "balanced",
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

    const handleConnectionHealthy = () => {
      if (connectionFailureTimeoutRef.current) {
        clearTimeout(connectionFailureTimeoutRef.current);
        connectionFailureTimeoutRef.current = null;
      }
      setActiveCall((prev) => (prev ? { ...prev, status: "connected", statusText: "Connected" } : null));
      iceRestartCountRef.current = 0;
      tuneBitrate(pc, 2500000);
      startStatsMonitor(pc);
    };

    const handleConnectionDegraded = (_reason: string) => {
      if (import.meta.env.DEV) {
        console.log("[WebRTC] Connection degraded:", _reason);
      }
      // The call can only be terminated by either party or terminated by a huge network issue (35s+)
      setActiveCall((prev) => (prev && prev.status !== "ended" ? { ...prev, statusText: "Reconnecting..." } : prev));

      // Attempt background ICE renegotiation
      if (activeCallRef.current?.isCaller) {
        if (iceRestartCountRef.current < 4) {
          iceRestartCountRef.current += 1;
          try {
            pc.restartIce();
            pc.createOffer({ iceRestart: true }).then((newOffer) => {
              pc.setLocalDescription(newOffer).then(() => {
                sendCallSignal("webrtc_offer", targetUserId, {
                  sdp: newOffer,
                  isVideo: activeCallRef.current?.isVideo,
                });
              });
            }).catch(() => {});
          } catch {}
        }
      } else {
        // If receiver: ask caller to renegotiate ICE
        sendCallSignal("ice_restart_request", targetUserId);
      }

      // Prolonged network failure timer (35 seconds of continuous complete failure)
      if (!connectionFailureTimeoutRef.current) {
        connectionFailureTimeoutRef.current = setTimeout(() => {
          if (pc.connectionState === "failed" || pc.iceConnectionState === "failed") {
            setActiveCall((prev) => (prev ? { ...prev, status: "ended", statusText: "Network disconnected" } : null));
            setTimeout(() => cleanupMediaAndCall(), 2500);
          }
        }, 35000);
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (import.meta.env.DEV) {
        console.log("[WebRTC] ICE Connection State:", pc.iceConnectionState);
      }
      if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
        handleConnectionHealthy();
      } else if (pc.iceConnectionState === "disconnected") {
        handleConnectionDegraded("ice_disconnected");
      } else if (pc.iceConnectionState === "failed") {
        handleConnectionDegraded("ice_failed");
      }
    };

    if ("onconnectionstatechange" in pc) {
      pc.onconnectionstatechange = () => {
        if (import.meta.env.DEV) {
          console.log("[WebRTC] Peer Connection State:", pc.connectionState);
        }
        if (pc.connectionState === "connected") {
          handleConnectionHealthy();
        } else if (pc.connectionState === "disconnected") {
          handleConnectionDegraded("conn_disconnected");
        } else if (pc.connectionState === "failed") {
          handleConnectionDegraded("conn_failed");
        }
      };
    }

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
    try {
      if ((window as any).AndroidCallBridge && (window as any).AndroidCallBridge.takeOverLockScreen) {
        (window as any).AndroidCallBridge.takeOverLockScreen();
      }
    } catch {}

    const callingCall: CallState = {
      partner: targetUser,
      status: "calling",
      statusText: "Calling...",
      duration: 0,
      isVideo: video,
      isMuted: false,
      isSpeaker: true,
      isCaller: true,
    };
    activeCallRef.current = callingCall;
    setActiveCall(callingCall);

    // Start outgoing telephone ring tone
    ringtoneCleanupRef.current = startCallerRingtone();

    // Prepare local camera and mic immediately
    if (video) {
      await setupLocalMedia(true, facingMode);
    } else {
      await setupLocalMedia(false);
    }

    // Set ringing status
    const ringingCall: CallState = {
      ...callingCall,
      status: "ringing",
      statusText: "🔔 Ringing...",
    };
    activeCallRef.current = ringingCall;
    setActiveCall(ringingCall);

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
      const endedState: CallState = {
        ...ringingCall,
        status: "ended",
        statusText: "No answer",
      };
      activeCallRef.current = endedState;
      setActiveCall(endedState);
      setTimeout(() => {
        activeCallRef.current = null;
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
      const endedState: CallState = { ...activeCall, status: "ended", statusText: "Call ended" };
      activeCallRef.current = endedState;
      setActiveCall(endedState);
      setTimeout(() => {
        activeCallRef.current = null;
        setActiveCall(null);
        cleanupMediaAndCall();
      }, 600);
    }
  };

  const declineIncomingCall = () => {
    const inc = incomingCallRef.current || incomingCall;
    if (!inc) return;
    stopAllCallAlerts();
    try {
      if ((window as any).AndroidCallBridge && (window as any).AndroidCallBridge.onCallEnded) {
        (window as any).AndroidCallBridge.onCallEnded();
      }
    } catch {}
    sendCallSignal("call_declined", inc.caller.id);

    const caller = inc.caller;
    const isVid = inc.isVideo;
    incomingCallRef.current = null;
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
    const inc = incomingCallRef.current || incomingCall;
    if (!inc) return;
    stopAllCallAlerts();
    incomingCallRef.current = null;
    requestMobileScreenTakeover();
    try {
      if ((window as any).AndroidCallBridge && (window as any).AndroidCallBridge.takeOverLockScreen) {
        (window as any).AndroidCallBridge.takeOverLockScreen();
      }
    } catch {}

    const partner = inc.caller;
    const isVideo = inc.isVideo;
    const callId = inc.callId;
    setIncomingCall(null);

    // Picked up! Now set call as connected and start duration
    const connectedCall: CallState = {
      partner,
      status: "connected",
      statusText: "Connected",
      duration: 0,
      isVideo,
      isMuted: false,
      isSpeaker: true,
      isCaller: false,
    };
    activeCallRef.current = connectedCall;
    setActiveCall(connectedCall);

    // Automatically turn device camera on if it's a video call!
    await setupLocalMedia(isVideo, "user");
    createPeerConnection(partner.id, isVideo);
    sendCallSignal("call_accepted", partner.id, { isVideo, callId });
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
      const incoming = incomingCallRef.current;
      const active = activeCallRef.current;
      const newCallId = signal.data?.callId;

      // 1. Ignore duplicate invites if already ringing for this call or from this caller
      if (incoming && (incoming.caller.id === fromUserId || (newCallId && incoming.callId === newCallId))) {
        return;
      }

      // 2. Ignore duplicate invites if already in an active call with this caller
      if (active && active.partner.id === fromUserId && active.status !== "ended") {
        return;
      }

      // 3. Only reject with call_busy if currently in an active, connected call with a DIFFERENT user
      if (active && active.partner.id !== fromUserId && active.status === "connected") {
        sendCallSignal("call_busy", fromUserId, { callId: newCallId });
        return;
      }

      const callerUser: User = signal.caller || {
        id: fromUserId,
        username: `User_${fromUserId}`,
        email: "",
      };
      const isVideo = !!signal.data?.isVideo;
      const callId = newCallId || `call_${Date.now()}_${fromUserId}`;
      const incomingObj: IncomingCallState = {
        caller: callerUser,
        isVideo,
        callId,
      };
      incomingCallRef.current = incomingObj;
      setIncomingCall(incomingObj);

      // 1. Acquire screen wake lock so display does not turn off
      try {
        if ("wakeLock" in navigator && (navigator as any).wakeLock) {
          (navigator as any).wakeLock.request("screen").then((lock: any) => {
            screenWakeLockRef.current = lock;
          }).catch(() => {});
        }
      } catch {}

      // 2. Disturb Android screen natively (PowerManager WakeLock + foreground call alert)
      try {
        const isFg = !document.hidden && document.visibilityState === "visible";
        if ((window as any).AndroidCallBridge && (window as any).AndroidCallBridge.onIncomingCall) {
          (window as any).AndroidCallBridge.onIncomingCall(callId, String(fromUserId), callerUser.name || callerUser.username, isVideo ? "video" : "audio", isFg);
        } else {
          if (!isFg) {
            const ifr = document.createElement("iframe");
            ifr.style.display = "none";
            ifr.src = `devnest://call?action=incoming&callId=${encodeURIComponent(callId)}&callerId=${fromUserId}&callType=${isVideo ? "video" : "audio"}`;
            document.body.appendChild(ifr);
            setTimeout(() => ifr.remove(), 1000);
          }
        }
      } catch {}

      // 3. Audio ringtone synthesizer
      if (ringtoneCleanupRef.current) ringtoneCleanupRef.current();
      ringtoneCleanupRef.current = startIncomingRingtone();

      // 4. Tab title visual disturbance (flashing title)
      if (titleFlashIntervalRef.current) clearInterval(titleFlashIntervalRef.current);
      let flashState = false;
      originalTitleRef.current = document.title;
      titleFlashIntervalRef.current = setInterval(() => {
        flashState = !flashState;
        document.title = flashState
          ? `🚨 INCOMING CALL FROM @${callerUser.username}!`
          : `📞 TAP TO ANSWER NOW!`;
      }, 500);

      // 5. System Notification (requireInteraction: true forces it to disturb and stay on screen)
      if (typeof window !== "undefined" && "Notification" in window) {
        if (Notification.permission === "granted") {
          try {
            const notifTitle = isVideo
              ? `📹 Incoming Video Call from ${callerUser.name || callerUser.username}`
              : `📞 Incoming Voice Call from ${callerUser.name || callerUser.username}`;
            const sysNotif = new Notification(notifTitle, {
              body: "Nesty • Tap to answer immediately",
              icon: callerUser.avatar_url || "/nesty-logo.png",
              tag: "devnest-incoming-call",
              requireInteraction: true,
              renotify: true,
              vibrate: [800, 400, 800, 400, 800, 400, 1200],
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

      // 6. Ring timeout 48s
      if (callRingTimeoutRef.current) clearTimeout(callRingTimeoutRef.current);
      callRingTimeoutRef.current = setTimeout(() => {
        if (incomingCallRef.current) {
          stopAllCallAlerts();
          incomingCallRef.current = null;
          setIncomingCall(null);
        }
      }, 48000);
    } else if (signal.type === "call_accepted") {
      const active = activeCallRef.current;
      if (!active || active.partner.id !== fromUserId) {
        return;
      }
      stopAllCallAlerts();
      clearTimeout(callDisconnectTimeoutRef.current);

      const connState: CallState = {
        ...active,
        status: "connected",
        statusText: "Connected",
        duration: 0,
      };
      activeCallRef.current = connState;
      setActiveCall(connState);

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
      stopAllCallAlerts();
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
        activeCallRef.current = null;
        setActiveCall(null);
        cleanupMediaAndCall();
      }, 2000);
    } else if (signal.type === "call_busy") {
      const active = activeCallRef.current;
      if (!active || active.partner.id !== fromUserId) {
        return;
      }
      if (active.status === "connected") {
        // We are already connected; ignore spurious busy signals
        return;
      }
      stopAllCallAlerts();
      clearTimeout(callDisconnectTimeoutRef.current);
      playDisconnectTone();
      const endedState: CallState = {
        ...active,
        status: "ended",
        statusText: "User is busy on another call",
      };
      activeCallRef.current = endedState;
      setActiveCall(endedState);
      setTimeout(() => {
        activeCallRef.current = null;
        setActiveCall(null);
        cleanupMediaAndCall();
      }, 2500);
    } else if (signal.type === "call_timeout") {
      stopAllCallAlerts();
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
              icon: caller.avatar_url || "/nesty-logo.png",
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
    } else if (signal.type === "ice_restart_request") {
      const pc = peerConnectionRef.current;
      if (pc && pc.signalingState !== "closed") {
        try {
          pc.restartIce();
          const newOffer = await pc.createOffer({ iceRestart: true });
          await pc.setLocalDescription(newOffer);
          sendCallSignal("webrtc_offer", fromUserId, {
            sdp: newOffer,
            isVideo: activeCallRef.current?.isVideo,
          });
        } catch (err) {
          console.warn("ICE restart renegotiation error:", err);
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
      const active = activeCallRef.current;
      const incoming = incomingCallRef.current;
      // Guard against cross-user ended signals: only process if server timeout (fromUserId === 0) or matches active partner or incoming caller
      if (!incoming && (!active || (fromUserId !== 0 && active.partner.id !== fromUserId))) {
        return;
      }
      stopAllCallAlerts();
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
              icon: caller.avatar_url || "/nesty-logo.png",
              tag: `missed-call-${Date.now()}`,
            });
          } catch {}
        }
      }
      setIncomingCall(null);
      incomingCallRef.current = null;
      if (active) {
        const endedState: CallState = {
          ...active,
          status: "ended",
          statusText: "Call ended",
        };
        activeCallRef.current = endedState;
        setActiveCall(endedState);
      }
      setTimeout(() => {
        activeCallRef.current = null;
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
      const isAndroidNative = !!(window as any).AndroidCallBridge;
      const isCapacitor = !!(window as any).Capacitor?.isNativePlatform?.();

      if (isAndroidNative) {
        platform = "android";
        try {
          const nativeToken = (window as any).AndroidCallBridge.getDeviceToken?.();
          if (nativeToken) {
            deviceToken = nativeToken;
          }
          if (authToken) {
            (window as any).AndroidCallBridge.setAuthToken?.(authToken, API_URL);
          }
        } catch {}
      } else if (isCapacitor) {
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
        deviceToken = (isAndroidNative || isCapacitor ? "android_" : "web_") + Math.random().toString(36).substring(2) + "_" + Date.now();
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

  // Register device push token and sync native auth on auth mount
  useEffect(() => {
    if (!token) return;
    if ((window as any).AndroidCallBridge?.setAuthToken) {
      try {
        (window as any).AndroidCallBridge.setAuthToken(token, API_URL);
      } catch {}
    }
    fetchNotifications();
    registerDevicePushToken(token);
  }, [token]);

  // Deep-link / native intent handler when incoming call notification is tapped
  useEffect(() => {
    const processCallAction = (action: string, cId: string, callerIdStr: string, callType?: string, callerName?: string) => {
      console.log("[CallLog] Processing native call action:", action, cId, callerIdStr, callType, callerName);
      if (action === "incoming") {
        const callerNum = parseInt(callerIdStr || "0", 10) || 0;
        handleIncomingCallSignal({
          type: "call_invite",
          from_user_id: callerNum,
          caller: { id: callerNum, username: callerName || `User_${callerNum}`, email: "", name: callerName || "Nesty User" },
          data: { isVideo: callType !== "audio", callId: cId },
        });
      } else if (action === "answer") {
        if (incomingCallRef.current || incomingCall) {
          acceptIncomingCall();
        } else {
          const callerNum = parseInt(callerIdStr || "0", 10) || 0;
          const callerUser: User = { id: callerNum, username: callerName || `User_${callerNum}`, email: "", name: callerName || "Nesty User" };
          const isVideo = callType !== "audio";
          const incObj = { caller: callerUser, isVideo, callId: cId };
          incomingCallRef.current = incObj;
          setIncomingCall(incObj);
          setTimeout(() => {
            acceptIncomingCall();
          }, 400);
        }
      } else if (action === "decline") {
        declineIncomingCall();
        if (callerIdStr) {
          const cNum = parseInt(callerIdStr, 10);
          if (!isNaN(cNum)) sendCallSignal("call_declined", cNum, { callId: cId });
        }
      }
    };

    (window as any).handleNativeCallAction = (action: string, cId: string, callerIdStr: string, callType?: string, callerName?: string) => {
      processCallAction(action, cId, callerIdStr, callType, callerName);
    };

    // Check if Android bridge has any pending call from lock-screen takeover
    try {
      if ((window as any).AndroidCallBridge && (window as any).AndroidCallBridge.getPendingCallAction) {
        const pendingStr = (window as any).AndroidCallBridge.getPendingCallAction();
        if (pendingStr) {
          const pending = JSON.parse(pendingStr);
          if (pending.action) {
            processCallAction(pending.action, pending.callId, pending.callerId, pending.callType, pending.callerName);
          }
        }
      }
    } catch {}

    const params = new URLSearchParams(window.location.search);
    const action = params.get("action");
    const callId = params.get("callId");
    const callerIdStr = params.get("callerId");
    const callType = params.get("callType");
    const callerName = params.get("callerName");
    if (action && (callId || callerIdStr)) {
      processCallAction(action, callId || "", callerIdStr || "", callType || undefined, callerName || undefined);
    }

    if ((window as any).Capacitor?.Plugins?.App) {
      try {
        (window as any).Capacitor.Plugins.App.addListener("appUrlOpen", (data: any) => {
          try {
            const url = new URL(data.url);
            const act = url.searchParams.get("action");
            const cId = url.searchParams.get("callId");
            const caller = url.searchParams.get("callerId");
            const cType = url.searchParams.get("callType");
            const cName = url.searchParams.get("callerName");
            if (act) processCallAction(act, cId || "", caller || "", cType || undefined, cName || undefined);
          } catch {}
        });
      } catch {}
    }

    // Check if permissions onboarding modal should be displayed on first run
    try {
      const onboarded = localStorage.getItem("devnest_permissions_onboarded");
      if (!onboarded && token) {
        setPermissionsModalOpen(true);
      }
    } catch {}

    return () => {
      delete (window as any).handleNativeCallAction;
    };
  }, []);

  // Check native Android call channels, notification permissions & Android 14 full-screen intent
  const checkCallPermissions = () => {
    console.log("[CallLog] Checking incoming call permissions & channels...");
    if ((window as any).AndroidCallBridge && (window as any).AndroidCallBridge.checkNotificationPermissions) {
      try {
        const jsonStr = (window as any).AndroidCallBridge.checkNotificationPermissions();
        const parsed = JSON.parse(jsonStr);
        console.log("[CallLog] Native call permissions check result:", parsed);
        setCallPermissionsStatus(parsed);
        return parsed;
      } catch (err) {
        console.error("[CallLog] Error checking native call permissions:", err);
      }
    }
    return null;
  };

  useEffect(() => {
    (window as any).__triggerTestIncomingCall = (callType: "audio" | "video" = "video", delaySeconds: number = 5) => {
      console.log(`[CallLog] Triggering test incoming call (delay: ${delaySeconds}s, type: ${callType})`);
      if ((window as any).AndroidCallBridge && (window as any).AndroidCallBridge.testIncomingCall) {
        (window as any).AndroidCallBridge.testIncomingCall("Nesty Test Caller", callType, delaySeconds);
      } else {
        setTimeout(() => {
          handleIncomingCallSignal({
            type: "call_invite",
            from_user_id: 999,
            caller: { id: 999, username: "test_caller", email: "", name: "Nesty Test Caller" },
            data: { isVideo: callType !== "audio", callId: `test_call_${Date.now()}` },
          });
        }, delaySeconds * 1000);
      }
    };
    return () => {
      delete (window as any).__triggerTestIncomingCall;
    };
  }, []);

  const handleBrandLogoClick = () => {
    const next = devClicks + 1;
    if (next >= 5) {
      const newDevState = !isDevMode;
      setIsDevMode(newDevState);
      setDevClicks(0);
      try {
        localStorage.setItem("devnest_dev_mode", newDevState ? "true" : "false");
      } catch {}
      alert(newDevState ? "🛠️ Dev Mode Activated! Call diagnostics & test tools enabled." : "Dev Mode Deactivated.");
    } else {
      setDevClicks(next);
      setTimeout(() => setDevClicks(0), 3000);
    }
  };

  // Request notification permissions early and verify native channels
  useEffect(() => {
    if (token) {
      if ((window as any).AndroidCallBridge) {
        if ((window as any).AndroidCallBridge.ensureChannelsCreated) {
          (window as any).AndroidCallBridge.ensureChannelsCreated();
        }
        const status = checkCallPermissions();
        if (status && (!status.notificationsEnabled || !status.channelValid || !status.canUseFullScreenIntent)) {
          // If native calling alerts cannot wake screen, open diagnostic setup modal
          setCallDiagModalOpen(true);
        }
      } else if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
    }
  }, [token]);

  // -----------------------------
  // PERSISTENT WEBSOCKET & BACKGROUND KEEPALIVE
  // Keeps the user online even when the web app or APK is minimized!
  // -----------------------------
  useEffect(() => {
    if (!token) return;
    let isSubscribed = true;
    let reconnectTimeout: any = null;
    let worker: Worker | null = null;
    let lastHttpHeartbeat = 0;

    const sendHttpHeartbeat = () => {
      if (!tokenRef.current) return;
      try {
        fetch(`${API_URL}/api/heartbeat`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tokenRef.current}`,
            "Content-Type": "application/json",
          },
          keepalive: true,
        }).catch(() => {});
      } catch {}
    };

    // Hold Web Lock to prevent browser from aggressively terminating background execution
    if (typeof navigator !== "undefined" && "locks" in navigator) {
      navigator.locks.request("devnest_presence_lock", () => {
        return new Promise<void>(() => {});
      }).catch(() => {});
    }

    // Start Android native background calling listener if running inside APK
    try {
      if ((window as any).AndroidCallBridge && (window as any).AndroidCallBridge.startBackgroundListener) {
        (window as any).AndroidCallBridge.startBackgroundListener();
      }
    } catch {}

    const connectWs = () => {
      if (!isSubscribed) return;
      try {
        const ws = new WebSocket(`${WS_BASE_URL}/ws?token=${token}`);
        wsRef.current = ws;

        ws.onopen = () => {
          try {
            ws.send(JSON.stringify({ type: "ping" }));
            ws.send(JSON.stringify({ type: "group_call_query" }));
          } catch {}
          sendHttpHeartbeat();
          fetchCommunityStats();
          fetchActiveGroupCalls();
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "pong") return;
            if (data.event === "presence" || data.type === "presence") {
              fetchCommunityStats();
              return;
            }
            if (data.event === "group_call_broadcast" || (data.type && data.type.startsWith("group_call_"))) {
              handleGroupCallBroadcast(data);
              return;
            }
            if (data.event === "group_call_signal") {
              handleGroupCallSignal(data);
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
                      body: `Missed call from ${callerName}. Tap to open Nesty.`,
                      icon: data.notification.actor?.avatar_url || "/nesty-logo.png",
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
          if (isSubscribed) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = setTimeout(connectWs, 2000);
          }
        };

        ws.onerror = (err) => {
          console.warn("[WS] Error", err);
          ws.close();
        };
      } catch (e) {
        if (isSubscribed) {
          clearTimeout(reconnectTimeout);
          reconnectTimeout = setTimeout(connectWs, 3000);
        }
      }
    };

    connectWs();
    sendHttpHeartbeat();

    // Spawn an inline Web Worker keepalive timer.
    // Unlike window.setInterval, Web Workers are not throttled when tabs/apps are minimized!
    try {
      const workerBlob = new Blob([
        `let timer = null;
         self.onmessage = function(e) {
           if (e.data === 'start') {
             if (timer) clearInterval(timer);
             timer = setInterval(function() { self.postMessage('tick'); }, 10000);
           } else if (e.data === 'stop') {
             if (timer) clearInterval(timer);
             timer = null;
           }
         };`
      ], { type: "application/javascript" });
      const workerUrl = URL.createObjectURL(workerBlob);
      worker = new Worker(workerUrl);
      worker.onmessage = () => {
        if (!isSubscribed) return;
        const now = Date.now();
        // Ping active WebSocket
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          try {
            wsRef.current.send(JSON.stringify({ type: "ping" }));
          } catch {}
        } else if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
          connectWs();
        }

        // Send HTTP heartbeat every 20 seconds
        if (now - lastHttpHeartbeat >= 20000) {
          lastHttpHeartbeat = now;
          sendHttpHeartbeat();
        }
      };
      worker.postMessage("start");
    } catch {
      // Fallback timer if Web Workers unavailable
      const fallbackTimer = setInterval(() => {
        if (!isSubscribed) return;
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          try { wsRef.current.send(JSON.stringify({ type: "ping" })); } catch {}
        } else if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
          connectWs();
        }
        sendHttpHeartbeat();
      }, 15000);
      reconnectTimeout = fallbackTimer;
    }

    // Immediately restore connection and heartbeat whenever app/tab gains focus or changes visibility
    const handleVisibilityOrFocus = () => {
      sendHttpHeartbeat();
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        connectWs();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityOrFocus);
    window.addEventListener("focus", handleVisibilityOrFocus);
    window.addEventListener("pageshow", handleVisibilityOrFocus);

    return () => {
      isSubscribed = false;
      clearTimeout(reconnectTimeout);
      if (worker) {
        worker.postMessage("stop");
        worker.terminate();
      }
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
      window.removeEventListener("focus", handleVisibilityOrFocus);
      window.removeEventListener("pageshow", handleVisibilityOrFocus);
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
  // FETCH FEED POSTS (HOME FETCHES ALL POSTS PLATFORM-WIDE)
  // -----------------------------
  const fetchPosts = async (pageNum: number = 1, comm = selectedCommunity) => {
    if (!token) return;
    try {
      const isGlobal = !comm || comm === "all" || comm === "home";
      const commParam = isGlobal ? "" : `&community=${encodeURIComponent(comm)}`;
      const res = await fetch(
        `${API_URL}/api/posts?page=${pageNum}&limit=50${commParam}`,
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
  // ALGORITHMIC HOME FEED MULTI-FACTOR RANKING
  // Controlling factors:
  // 1. Time decay / Recency: 1 / (1 + ageHours * 0.12)
  // 2. Engagement velocity: likes * 2.5 + comments * 4.0
  // 3. Affinity: user follows author (+20) or author is self (+15)
  // 4. Content richness: media present (+8, video +12)
  // -----------------------------
  const displayedPosts = useMemo((): Post[] => {
    if (selectedCommunity !== "home") {
      return posts.filter((p) => p.community === selectedCommunity || !selectedCommunity);
    }

    let list = [...posts];

    if (feedFilterMedia) {
      list = list.filter((p) => !!p.media_url);
    }

    if (feedTab === "latest") {
      return list.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    }

    if (feedTab === "following") {
      return list
        .filter((p) => p.user?.is_following || Number(p.user?.id) === Number(user?.id))
        .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    }

    if (feedTab === "trending") {
      return list.sort((a, b) => {
        const aEng = (a.likes || 0) * 3 + (a.comments?.length || 0) * 5;
        const bEng = (b.likes || 0) * 3 + (b.comments?.length || 0) * 5;
        return bEng - aEng;
      });
    }

    // Default "for_you" Tab: Multi-factor Algorithmic Ranking
    const now = Date.now();
    return list.sort((a, b) => {
      const ageA = Math.max(0, (now - new Date(a.created_at || 0).getTime()) / (1000 * 3600));
      const ageB = Math.max(0, (now - new Date(b.created_at || 0).getTime()) / (1000 * 3600));

      const decayA = 1 / (1 + ageA * 0.12);
      const decayB = 1 / (1 + ageB * 0.12);

      const mediaA = a.media_url ? (a.media_url.match(/\.(mp4|webm|mov)$/i) ? 12 : 8) : 0;
      const mediaB = b.media_url ? (b.media_url.match(/\.(mp4|webm|mov)$/i) ? 12 : 8) : 0;

      const affinityA = a.user?.is_following ? 20 : (Number(a.user?.id) === Number(user?.id) ? 15 : 0);
      const affinityB = b.user?.is_following ? 20 : (Number(b.user?.id) === Number(user?.id) ? 15 : 0);

      const engA = (a.likes || 0) * 2.5 + (a.comments?.length || 0) * 4.0;
      const engB = (b.likes || 0) * 2.5 + (b.comments?.length || 0) * 4.0;

      const scoreA = (10 + engA + mediaA + affinityA) * decayA;
      const scoreB = (10 + engB + mediaB + affinityB) * decayB;

      return scoreB - scoreA;
    });
  }, [posts, selectedCommunity, feedTab, feedFilterMedia, user]);

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
          community: selectedCommunity === "home" ? "" : (selectedCommunity || ""),
          music_track_id: selectedPostMusic ? selectedPostMusic.id : null,
          music_start_sec: 0,
          mute_original: selectedPostMusic ? true : false,
          music_volume: 1,
          original_volume: selectedPostMusic ? 0 : 1,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const newPostObj: Post = {
          ...data,
          likes: 0,
          comments: [],
          user: data.user && data.user.username ? data.user : user || { id: 0, username: "Anonymous", email: "" },
          music_track: data.music_track || selectedPostMusic || null,
        };
        setPosts((prev) => [newPostObj, ...prev]);
        setNewPost("");
        setSelectedFile(null);
        setMediaPreview(null);
        setSelectedPostMusic(null);
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
  // REELS HANDLERS
  // -----------------------------
  const handlePublishReel = async () => {
    if (!newReelCaption.trim() && !newReelFile && !newReelVideoUrl) {
      alert("Please choose a video or enter a URL, and write a caption for your reel.");
      return;
    }
    setIsSubmittingReel(true);
    let finalVideoUrl = newReelVideoUrl || "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4";

    if (newReelFile) {
      try {
        const formData = new FormData();
        formData.append("file", newReelFile);
        const res = await fetch(`${API_URL}/api/upload`, {
          method: "POST",
          headers: { Authorization: `Bearer ${localStorage.getItem("token") || token}` },
          body: formData,
        });
        if (res.ok) {
          const data = await res.json();
          if (data.url) finalVideoUrl = data.url;
        }
      } catch (e) {
        console.warn("Upload fallback to preview/sample", e);
        if (newReelPreview) finalVideoUrl = newReelPreview;
      }
    }

    let createdRemoteReel: any = null;
    try {
      const res = await fetch(`${API_URL}/api/reels`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token") || token}`,
        },
        body: JSON.stringify({
          video_url: finalVideoUrl,
          caption: newReelCaption || "New Reel on Nesty! 🎬 #nesty #developer",
          music_track_id: selectedReelMusic ? selectedReelMusic.id : null,
          music_start_sec: 0,
          mute_original: reelMuteOriginal,
          music_volume: reelMusicVolume,
          original_volume: reelOriginalVolume,
        }),
      });
      if (res.ok) {
        createdRemoteReel = await res.json();
      }
    } catch (err) {
      console.warn("Failed to save reel to backend, using local copy", err);
    }

    const newReel: ReelItem = {
      id: createdRemoteReel?.id || `reel-${Date.now()}`,
      userId: user?.id || 1,
      username: user?.username || "You",
      name: user?.name || user?.username || "You",
      avatarUrl: user?.avatar_url,
      videoUrl: finalVideoUrl,
      caption: newReelCaption || "New Reel on Nesty! 🎬 #nesty #developer",
      likes: 1,
      likedByMe: true,
      commentsCount: 0,
      audioTitle: selectedReelMusic
        ? `${selectedReelMusic.title} • ${selectedReelMusic.artist}`
        : newReelAudio || `Original Audio • ${user?.username || "You"}`,
      music_track_id: selectedReelMusic ? (Number(selectedReelMusic.id) || null) : null,
      music_track: selectedReelMusic,
      music_start_sec: 0,
      mute_original: reelMuteOriginal,
      music_volume: reelMusicVolume,
      original_volume: reelOriginalVolume,
    };

    setReelsList([newReel, ...reelsList]);
    setActiveReelIndex(0);
    setCreateReelModalOpen(false);
    setNewReelCaption("");
    setNewReelAudio("");
    setNewReelFile(null);
    setNewReelPreview(null);
    setNewReelVideoUrl("");
    setSelectedReelMusic(null);
    setReelMuteOriginal(false);
    setReelMusicVolume(1);
    setReelOriginalVolume(1);
    setIsSubmittingReel(false);
  };

  // Load remote reels from API
  useEffect(() => {
    const fetchReels = async () => {
      try {
        const res = await fetch(`${API_URL}/api/reels`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.reels && data.reels.length > 0) {
            const mapped: ReelItem[] = data.reels.map((r: any) => ({
              id: r.id,
              userId: r.user_id,
              username: r.user?.username || "nester",
              name: r.user?.name || r.user?.username || "Nester",
              avatarUrl: r.user?.avatar_url || "",
              videoUrl: r.video_url,
              caption: r.caption,
              likes: r.likes || 0,
              likedByMe: r.liked_by_me || false,
              commentsCount: r.comments_count || 0,
              audioTitle: r.music_track ? `${r.music_track.title} • ${r.music_track.artist}` : `Original Audio • ${r.user?.username || "Nester"}`,
              music_track_id: r.music_track_id,
              music_track: r.music_track,
              music_start_sec: r.music_start_sec || 0,
              mute_original: r.mute_original || false,
              music_volume: r.music_volume ?? 1,
              original_volume: r.original_volume ?? 1,
            }));
            setReelsList(mapped);
          }
        }
      } catch (e) {
        console.warn("Could not load remote reels:", e);
      }
    };
    fetchReels();
  }, []);

  const handleAddReelComment = () => {
    if (!newReelComment.trim()) return;
    const commentObj = {
      id: Date.now().toString(),
      user: user?.username || "You",
      text: newReelComment.trim(),
      time: "Just now",
    };
    setActiveReelComments((prev) => [...prev, commentObj]);
    setReelsList((prev) =>
      prev.map((r, i) =>
        i === activeReelIndex ? { ...r, commentsCount: r.commentsCount + 1 } : r
      )
    );
    setNewReelComment("");
  };

  // -----------------------------
  // GO LIVE HANDLERS
  // -----------------------------
  const startLiveStream = async () => {
    try {
      requestMobileScreenTakeover();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      liveStreamMediaRef.current = stream;
      setLiveStudioOpen(true);
      setLiveStreamSeconds(0);
      setLiveStreamViewers(Math.floor(Math.random() * 8) + 6);

      setTimeout(() => {
        if (liveVideoRef.current) {
          liveVideoRef.current.srcObject = stream;
        }
      }, 150);

      // Broadcast live event on WebSocket
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            event: "broadcast",
            type: "user_went_live",
            user_id: user?.id,
            username: user?.username,
            title: liveStreamTitle,
          })
        );
      }
    } catch (err) {
      console.error("Failed to start live stream", err);
      alert("Camera or microphone permission is required to Go Live.");
    }
  };

  const stopLiveStream = () => {
    if (liveStreamMediaRef.current) {
      liveStreamMediaRef.current.getTracks().forEach((track) => track.stop());
      liveStreamMediaRef.current = null;
    }
    setLiveStudioOpen(false);
    restoreMobileScreenLock();
  };

  const sendLiveChatMessage = () => {
    if (!liveChatInput.trim()) return;
    const newMsg = {
      id: Date.now().toString(),
      user: user?.username || "You",
      text: liveChatInput.trim(),
      time: "Just now",
    };
    setLiveChatMessages((prev) => [...prev, newMsg]);
    setLiveChatInput("");
  };

  // -----------------------------
  // GROUP CALL WEBRTC MESH IMPLEMENTATION
  // -----------------------------
  const fetchActiveGroupCalls = async () => {
    try {
      const res = await fetch(`${API_URL}/api/group-calls/active`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.calls)) {
          const map: Record<string, any> = {};
          data.calls.forEach((c: any) => {
            if (c && c.channel_id) map[c.channel_id] = c;
          });
          setActiveGroupCalls(map);
        }
      }
    } catch (err) {
      console.error("Failed to fetch active group calls", err);
    }
  };

  const createGroupPeerConnection = (targetUserId: number, channelId: string): RTCPeerConnection => {
    let existingPc = groupPeersRef.current.get(targetUserId);
    if (existingPc && existingPc.signalingState !== "closed") {
      return existingPc;
    }

    const defaultStunServers = [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:global.stun.twilio.com:3478" },
      { urls: "stun:stun.services.mozilla.com" },
    ];

    let iceServers: RTCIceServer[] = dynamicIceServersRef.current && dynamicIceServersRef.current.length > 0
      ? dynamicIceServersRef.current
      : defaultStunServers;

    const turnUrl = import.meta.env.VITE_TURN_URL || "";
    const turnUsername = import.meta.env.VITE_TURN_USERNAME || "";
    const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL || "";

    if (turnUrl) {
      const cleanUrl = turnUrl.replace(/^(turn:)/, "").replace(/\?.*$/, "");
      iceServers = [
        ...iceServers,
        {
          urls: [`turn:${cleanUrl}?transport=udp`, `turn:${cleanUrl}?transport=tcp`],
          username: turnUsername,
          credential: turnCredential,
        },
      ];
    }

    const pc = new RTCPeerConnection({
      iceServers,
      bundlePolicy: "balanced",
      rtcpMuxPolicy: "require",
    });

    // Attach local stream tracks to this peer
    if (groupLocalStreamRef.current) {
      groupLocalStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, groupLocalStreamRef.current!);
      });
    }

    // Ensure audio & video transceivers are configured
    const senders = pc.getSenders();
    const hasAudio = senders.some((s) => s.track && s.track.kind === "audio");
    const hasVideo = senders.some((s) => s.track && s.track.kind === "video");
    if (!hasAudio) {
      try { pc.addTransceiver("audio", { direction: "sendrecv" }); } catch {}
    }
    if (!hasVideo) {
      try { pc.addTransceiver("video", { direction: "sendrecv" }); } catch {}
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            event: "group_call_signal",
            signal_type: "ice-candidate",
            to_user_id: targetUserId,
            channel_id: channelId,
            candidate: event.candidate,
          })
        );
      }
    };

    pc.ontrack = (event) => {
      setGroupCallState((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          participants: prev.participants.map((p) => {
            if (Number(p.id) !== Number(targetUserId)) return p;
            let currentStream = p.stream;
            if (event.streams && event.streams[0]) {
              currentStream = event.streams[0];
            } else if (currentStream) {
              if (!currentStream.getTracks().some((t) => t.id === event.track.id)) {
                currentStream.addTrack(event.track);
              }
            } else {
              currentStream = new MediaStream([event.track]);
            }
            return { ...p, stream: currentStream };
          }),
        };
      });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        console.warn(`[Group Call] Peer ${targetUserId} connectionState: ${pc.connectionState}`);
      }
    };

    groupPeersRef.current.set(targetUserId, pc);
    return pc;
  };

  const createAndSendOfferToPeer = async (targetUserId: number, channelId: string) => {
    try {
      const myId = Number(userRef.current?.id || user?.id || 0);
      if (!targetUserId || !myId || Number(targetUserId) === myId) return;

      const pc = createGroupPeerConnection(targetUserId, channelId);
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      await pc.setLocalDescription(offer);

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            event: "group_call_signal",
            signal_type: "offer",
            to_user_id: targetUserId,
            channel_id: channelId,
            sdp: offer,
            name: userRef.current?.name || userRef.current?.username || user?.name || user?.username,
            username: userRef.current?.username || user?.username,
            avatar_url: userRef.current?.avatar_url || user?.avatar_url,
          })
        );
      }
    } catch (err) {
      console.error(`[Group Call] Error creating offer for peer ${targetUserId}`, err);
    }
  };

  const handleIncomingGroupOffer = async (
    fromUserId: number,
    sdp: RTCSessionDescriptionInit,
    channelId: string,
    callerMeta?: { name?: string; username?: string; avatar_url?: string }
  ) => {
    try {
      const myId = Number(userRef.current?.id || user?.id || 0);
      if (!fromUserId || !myId || Number(fromUserId) === myId) return;

      // Ensure participant is in list
      setGroupCallState((prev) => {
        if (!prev) return null;
        if (prev.participants.some((p) => Number(p.id) === Number(fromUserId))) return prev;
        return {
          ...prev,
          participants: [
            ...prev.participants,
            {
              id: fromUserId,
              name: callerMeta?.name || callerMeta?.username || `User #${fromUserId}`,
              username: callerMeta?.username || `user_${fromUserId}`,
              avatarUrl: callerMeta?.avatar_url,
            },
          ],
        };
      });

      const pc = createGroupPeerConnection(fromUserId, channelId);
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));

      // Flush queued candidates
      const queued = groupCandidatesQueueRef.current.get(fromUserId) || [];
      for (const cand of queued) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch {}
      }
      groupCandidatesQueueRef.current.delete(fromUserId);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            event: "group_call_signal",
            signal_type: "answer",
            to_user_id: fromUserId,
            channel_id: channelId,
            sdp: answer,
            name: userRef.current?.name || userRef.current?.username || user?.name || user?.username,
            username: userRef.current?.username || user?.username,
            avatar_url: userRef.current?.avatar_url || user?.avatar_url,
          })
        );
      }
    } catch (err) {
      console.error(`[Group Call] Error handling offer from peer ${fromUserId}`, err);
    }
  };

  const handleIncomingGroupAnswer = async (fromUserId: number, sdp: RTCSessionDescriptionInit) => {
    try {
      const myId = Number(userRef.current?.id || user?.id || 0);
      if (!fromUserId || !myId || Number(fromUserId) === myId) return;

      const pc = groupPeersRef.current.get(fromUserId);
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));

      // Flush queued candidates
      const queued = groupCandidatesQueueRef.current.get(fromUserId) || [];
      for (const cand of queued) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch {}
      }
      groupCandidatesQueueRef.current.delete(fromUserId);
    } catch (err) {
      console.error(`[Group Call] Error handling answer from peer ${fromUserId}`, err);
    }
  };

  const handleIncomingGroupIce = async (fromUserId: number, candidate: RTCIceCandidateInit) => {
    try {
      const myId = Number(userRef.current?.id || user?.id || 0);
      if (!fromUserId || !myId || Number(fromUserId) === myId) return;

      const pc = groupPeersRef.current.get(fromUserId);
      if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } else {
        const list = groupCandidatesQueueRef.current.get(fromUserId) || [];
        list.push(candidate);
        groupCandidatesQueueRef.current.set(fromUserId, list);
      }
    } catch (err) {
      console.warn(`[Group Call] Error adding ICE candidate from ${fromUserId}`, err);
    }
  };

  const handleGroupCallBroadcast = async (data: any) => {
    if (data.type === "group_call_list") {
      if (Array.isArray(data.calls)) {
        const map: Record<string, any> = {};
        data.calls.forEach((c: any) => {
          if (c && c.channel_id) map[c.channel_id] = c;
        });
        setActiveGroupCalls(map);
      }
      return;
    }

    if (data.type === "group_call_start" || data.type === "group_call_join") {
      const channelId = data.channel_id;
      if (!channelId) return;

      const fromId = Number(data.from_user_id);
      const myId = Number(userRef.current?.id || user?.id || 0);

      setActiveGroupCalls((prev) => {
        const existing = prev[channelId] || {
          channel_id: channelId,
          channel_name: data.channel_name || channelId,
          call_type: data.call_type || "audio",
          participants: {},
        };
        const parts = { ...existing.participants };
        if (fromId) {
          parts[fromId] = {
            user_id: fromId,
            name: data.name,
            username: data.username,
            avatar_url: data.avatar_url,
          };
        }
        return {
          ...prev,
          [channelId]: { ...existing, participants: parts },
        };
      });

      // If current user is in this channel's call and this broadcast is from someone else:
      const currentCall = groupCallStateRef.current;
      if (currentCall && currentCall.channelId === channelId) {
        // STRICT: Never add self to remote participants, never send offer to self!
        if (fromId && myId && fromId !== myId) {
          setGroupCallState((prev) => {
            if (!prev) return null;
            if (prev.participants.some((p) => Number(p.id) === fromId)) return prev;
            return {
              ...prev,
              participants: [
                ...prev.participants,
                {
                  id: fromId,
                  name: data.name || `@${data.username}`,
                  username: data.username || `user_${fromId}`,
                  avatarUrl: data.avatar_url,
                },
              ],
            };
          });

          // Existing member initiates offer to newly joined participant
          createAndSendOfferToPeer(fromId, channelId);
        }
      } else if (fromId && myId && fromId !== myId && !currentCall) {
        // Community member broadcast: notify online community members who aren't in the call yet
        const isMember = communities.some(
          (c) =>
            c.id === channelId &&
            (c.currentUserRole === "admin" ||
              c.currentUserRole === "co_admin" ||
              c.currentUserRole === "member" ||
              c.createdById === myId)
        );
        if (isMember) {
          setIncomingCommunityCall({
            channelId,
            channelName: data.channel_name || channelId,
            callType: data.call_type || "audio",
            callerName: data.name || data.username || "Community Member",
            callerAvatar: data.avatar_url,
          });
          try {
            startIncomingRingtone();
          } catch {}
        }
      }
      return;
    }

    if (data.type === "group_call_leave") {
      const channelId = data.channel_id;
      const fromId = Number(data.from_user_id);
      if (!channelId || !fromId) return;

      setActiveGroupCalls((prev) => {
        const existing = prev[channelId];
        if (!existing) return prev;
        const parts = { ...existing.participants };
        delete parts[fromId];
        if (Object.keys(parts).length === 0) {
          const next = { ...prev };
          delete next[channelId];
          return next;
        }
        return {
          ...prev,
          [channelId]: { ...existing, participants: parts },
        };
      });

      setIncomingCommunityCall((prev) => (prev && prev.channelId === channelId ? null : prev));

      const currentCall = groupCallStateRef.current;
      if (currentCall && currentCall.channelId === channelId) {
        const pc = groupPeersRef.current.get(fromId);
        if (pc) {
          try { pc.close(); } catch {}
          groupPeersRef.current.delete(fromId);
        }
        setGroupCallState((prev) =>
          prev ? { ...prev, participants: prev.participants.filter((p) => Number(p.id) !== fromId) } : null
        );
      }
    }
  };

  const handleGroupCallSignal = async (data: any) => {
    const fromId = Number(data.from_user_id);
    const myId = Number(userRef.current?.id || user?.id || 0);
    if (!fromId || !myId || fromId === myId) return;

    if (data.signal_type === "offer") {
      await handleIncomingGroupOffer(fromId, data.sdp, data.channel_id, {
        name: data.name,
        username: data.username,
        avatar_url: data.avatar_url,
      });
      return;
    }

    if (data.signal_type === "answer") {
      await handleIncomingGroupAnswer(fromId, data.sdp);
      return;
    }

    if (data.signal_type === "ice-candidate" && data.candidate) {
      await handleIncomingGroupIce(fromId, data.candidate);
      return;
    }
  };

  const startGroupCall = async (type: "audio" | "video", targetChannelId?: string) => {
    try {
      requestMobileScreenTakeover();
      const targetId = targetChannelId || (selectedCommunity !== "home" ? selectedCommunity : "coding-help");
      const activeComm = communities.find((c) => c.id === targetId) || communities[0];
      const myId = Number(userRef.current?.id || user?.id || 0);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: type === "video" ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } : false,
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      groupLocalStreamRef.current = stream;

      // Check if there are already other participants registered in this channel (filter out self!)
      const existingCall = activeGroupCalls[activeComm.id];
      const initialParticipants: GroupCallParticipant[] = [];
      if (existingCall && existingCall.participants) {
        Object.values(existingCall.participants).forEach((p: any) => {
          const uid = Number(p.user_id || p.id);
          if (uid && myId && uid !== myId) {
            initialParticipants.push({
              id: uid,
              name: p.name || p.username || `User #${uid}`,
              username: p.username || `user_${uid}`,
              avatarUrl: p.avatar_url,
            });
          }
        });
      }

      const stateObj = {
        channelId: activeComm.id,
        channelName: activeComm.name,
        type,
        startTime: Date.now(),
        isMuted: false,
        isVideoOff: type === "audio",
        isScreenSharing: false,
        participants: initialParticipants,
      };

      groupCallStateRef.current = stateObj;
      setGroupCallState(stateObj);

      // Announce call start/join to WebSocket hub
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            event: "group_call_broadcast",
            type: initialParticipants.length > 0 ? "group_call_join" : "group_call_start",
            channel_id: activeComm.id,
            channel_name: activeComm.name,
            call_type: type,
            from_user_id: myId,
            name: userRef.current?.name || userRef.current?.username || user?.name || user?.username,
            username: userRef.current?.username || user?.username,
            avatar_url: userRef.current?.avatar_url || user?.avatar_url,
          })
        );
      }

      setTimeout(() => {
        if (groupLocalVideoRef.current && type === "video") {
          groupLocalVideoRef.current.srcObject = stream;
        }
      }, 150);

      // Initiate connection to any existing members
      initialParticipants.forEach((p) => {
        createAndSendOfferToPeer(Number(p.id), activeComm.id);
      });
    } catch (err) {
      console.error("Failed to start group call", err);
      alert("Unable to access microphone or camera for group call.");
    }
  };

  const joinGroupCall = (channelId: string, _channelName: string, callType: "audio" | "video") => {
    startGroupCall(callType, channelId);
  };

  const leaveGroupCall = () => {
    const currentCall = groupCallStateRef.current;
    if (currentCall && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          event: "group_call_broadcast",
          type: "group_call_leave",
          channel_id: currentCall.channelId,
          from_user_id: user?.id,
        })
      );
    }

    if (groupLocalStreamRef.current) {
      groupLocalStreamRef.current.getTracks().forEach((track) => track.stop());
      groupLocalStreamRef.current = null;
    }

    groupPeersRef.current.forEach((pc) => {
      try { pc.close(); } catch {}
    });
    groupPeersRef.current.clear();
    groupCandidatesQueueRef.current.clear();

    groupCallStateRef.current = null;
    setGroupCallState(null);
    restoreMobileScreenLock();
  };

  const toggleGroupMute = () => {
    if (!groupCallState || !groupLocalStreamRef.current) return;
    const newMuted = !groupCallState.isMuted;
    groupLocalStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = !newMuted));
    setGroupCallState({ ...groupCallState, isMuted: newMuted });
  };

  const toggleGroupVideo = () => {
    if (!groupCallState || !groupLocalStreamRef.current) return;
    const newOff = !groupCallState.isVideoOff;
    groupLocalStreamRef.current.getVideoTracks().forEach((t) => (t.enabled = !newOff));
    setGroupCallState({ ...groupCallState, isVideoOff: newOff });
  };

  const toggleGroupScreenShare = async () => {
    if (!groupCallState) return;
    try {
      if (!groupCallState.isScreenSharing) {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];
        if (groupLocalVideoRef.current) {
          groupLocalVideoRef.current.srcObject = screenStream;
        }
        screenTrack.onended = () => {
          if (groupLocalStreamRef.current && groupLocalVideoRef.current) {
            groupLocalVideoRef.current.srcObject = groupLocalStreamRef.current;
          }
          setGroupCallState((prev) => (prev ? { ...prev, isScreenSharing: false } : null));
        };
        setGroupCallState({ ...groupCallState, isScreenSharing: true });
      } else {
        if (groupLocalStreamRef.current && groupLocalVideoRef.current) {
          groupLocalVideoRef.current.srcObject = groupLocalStreamRef.current;
        }
        setGroupCallState({ ...groupCallState, isScreenSharing: false });
      }
    } catch {}
  };

  useEffect(() => {
    let timer: any = null;
    if (liveStudioOpen) {
      timer = setInterval(() => {
        setLiveStreamSeconds((s) => s + 1);
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [liveStudioOpen]);

  useEffect(() => {
    let timer: any = null;
    if (groupCallState) {
      timer = setInterval(() => {
        setGroupCallDuration((d) => d + 1);
      }, 1000);
    } else {
      setGroupCallDuration(0);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [groupCallState]);

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
      try {
        if ((window as any).AndroidCallBridge && (window as any).AndroidCallBridge.stopBackgroundListener) {
          (window as any).AndroidCallBridge.stopBackgroundListener();
        }
      } catch {}
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

  // Active channel
  const activeChannel = communities.find((c) => c.id === selectedCommunity) || communities[0];

  return (
    <div className={`nesty-app ${page === "reels" || page === "reels_create" ? "dedicated-reels-mode" : ""}`}>
      {page === "reels" ? (
        <ReelsView
          apiUrl={API_URL}
          token={token || ""}
          currentUserId={user?.id}
          onNavigate={navigateTo}
          onOpenProfile={openProfile}
        />
      ) : page === "reels_create" ? (
        <ReelCreateView
          apiUrl={API_URL}
          token={token || ""}
          onNavigate={navigateTo}
        />
      ) : (
        <>
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
            navigateTo("/");
            setPage("feed");
            setSelectedCommunity("home");
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
            onClick={() => openMessagesInbox()}
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
            handleBrandLogoClick();
            navigateTo("/");
            setPage("feed");
            setSelectedCommunity("home");
            setMobileMenuOpen(false);
          }}
        >
          {/* Logo container left blank per instruction: "leave the logo blank until I come up with one." */}
          <img src="/nesty-logo.png" alt="Nesty" className="brand-logo-img" />
          <div className="brand-text-col">
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span className="brand-title">Nesty</span>
            </div>
            <span className="brand-subtitle">Easy Connection</span>
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

          {searchFocused && (searchResults.length > 0 || matchingCommunities.length > 0) && (
            <div className="sidebar-search-results">
              {matchingCommunities.length > 0 && (
                <>
                  <div style={{ padding: "6px 12px 2px", fontSize: "10px", fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.5px" }}>
                    COMMUNITIES
                  </div>
                  {matchingCommunities.map((c) => (
                    <div
                      key={c.id}
                      className="search-result-row"
                      onMouseDown={() => {
                        setSearchedCommunityIds((prev) => new Set(prev).add(c.id));
                        setSelectedCommunity(c.id);
                        setPage("feed");
                        setSearchQuery("");
                      }}
                    >
                      <div className="featured-icon-badge purple" style={{ width: "24px", height: "24px", fontSize: "12px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "6px" }}>
                        #
                      </div>
                      <div className="search-user-meta">
                        <span className="search-user-name">{c.name}</span>
                        <span className="search-user-handle">
                          {c.memberCount} {c.memberCount === 1 ? "member" : "members"}
                          {c.currentUserRole !== "none" ? ` • ${c.currentUserRole}` : " • Click to join"}
                        </span>
                      </div>
                    </div>
                  ))}
                </>
              )}
              {searchResults.length > 0 && (
                <>
                  {matchingCommunities.length > 0 && <div className="mobile-divider" style={{ margin: "4px 0" }} />}
                  <div style={{ padding: "6px 12px 2px", fontSize: "10px", fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.5px" }}>
                    PEOPLE
                  </div>
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
                </>
              )}
            </div>
          )}
        </div>

        {/* MAIN NAVIGATION GROUP */}
        <div className="sidebar-nav-group">
          <button
            data-nav="home"
            className={`nav-item-btn ${page === "feed" && selectedCommunity === "home" ? "active" : ""}`}
            onClick={() => {
              navigateTo("/");
              setPage("feed");
              setSelectedCommunity("home");
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
            data-nav="reels"
            className={`nav-item-btn ${(page as string) === "reels" ? "active" : ""}`}
            onClick={() => {
              navigateTo("/reels");
              setPage("reels");
              setMobileMenuOpen(false);
            }}
          >
            <span className="nav-item-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
                <line x1="7" y1="2" x2="7" y2="22" />
                <line x1="17" y1="2" x2="17" y2="22" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <line x1="2" y1="7" x2="7" y2="7" />
                <line x1="2" y1="17" x2="7" y2="17" />
                <line x1="17" y1="17" x2="22" y2="17" />
                <line x1="17" y1="7" x2="22" y2="7" />
              </svg>
            </span>
            <span>Reels</span>
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
              openMessagesInbox();
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
            data-nav="mobile-apk"
            className="nav-item-btn"
            onClick={() => {
              setApkModalOpen(true);
              setMobileMenuOpen(false);
            }}
          >
            <span className="nav-item-icon">📱</span>
            <span>Get Android APK</span>
            <span className="nav-unread-badge" style={{ background: "#2563eb", marginLeft: "auto", fontSize: "10px", padding: "2px 6px" }}>
              QR
            </span>
          </button>

          <button
            data-nav="call-diag"
            className="nav-item-btn"
            onClick={() => {
              checkCallPermissions();
              setPermissionsModalOpen(true);
              setMobileMenuOpen(false);
            }}
          >
            <span className="nav-item-icon">⚙️</span>
            <span>App Permissions</span>
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
          {dashboardCommunities.length === 0 ? (
            <div style={{ padding: "8px 12px", fontSize: "12px", color: "var(--text-muted)" }}>
              No communities yet. Search or create one!
            </div>
          ) : (
            dashboardCommunities.map((comm) => (
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
                {comm.currentUserRole === "invited" && (
                  <span style={{ marginLeft: "auto", fontSize: "10px", background: "rgba(16, 185, 129, 0.15)", color: "#10b981", padding: "2px 6px", borderRadius: "999px", fontWeight: 600 }}>
                    Invited
                  </span>
                )}
                {activeGroupCalls[comm.id] && (
                  <span style={{ marginLeft: "auto", fontSize: "10px", color: "#ef4444", fontWeight: 700 }}>
                    🔴 LIVE
                  </span>
                )}
              </button>
            ))
          )}

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

            {/* ANDROID APP DOWNLOAD & QR CODE */}
            <button
              type="button"
              className="drawer-menu-item-btn"
              onClick={() => {
                setApkModalOpen(true);
                setMobileMenuOpen(false);
              }}
            >
              <div className="drawer-menu-item-left">
                <span className="drawer-menu-icon">📱</span>
                <span className="drawer-menu-title">Download APK & QR Barcode</span>
              </div>
              <span className="drawer-menu-chevron" style={{ fontSize: "14px" }}>›</span>
            </button>

            {/* CALL SETUP & DIAGNOSTICS */}
            <button
              type="button"
              className="drawer-menu-item-btn"
              onClick={() => {
                checkCallPermissions();
                setCallDiagModalOpen(true);
                setMobileMenuOpen(false);
              }}
            >
              <div className="drawer-menu-item-left">
                <span className="drawer-menu-icon">⚙️</span>
                <span className="drawer-menu-title">Call Setup & Diagnostics</span>
              </div>
              <span className="drawer-menu-chevron" style={{ fontSize: "14px" }}>›</span>
            </button>

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
                    Connect, share moments, and explore vibrant communities with friends on Nesty.
                  </p>
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
                  {dashboardCommunities.length === 0 ? (
                    <div style={{ padding: "12px 14px", fontSize: "12px", color: "var(--text-sub)", textAlign: "center" }}>
                      No communities joined yet. Search or create one!
                    </div>
                  ) : (
                    dashboardCommunities.map((c) => (
                      <div
                        key={c.id}
                        className="featured-channel-row"
                        onClick={() => {
                          setSelectedCommunity(c.id);
                          setPage("feed");
                          setMobileMenuOpen(false);
                        }}
                      >
                        <div className="featured-icon-badge purple">#</div>
                        <div className="featured-channel-text">
                          <span className="featured-channel-title">{c.name}</span>
                          <span className="featured-channel-sub">{c.subtitle}</span>
                        </div>
                        {activeGroupCalls[c.id] && (
                          <span style={{ fontSize: "11px", color: "#ef4444", fontWeight: 700, marginRight: "4px" }}>🔴 LIVE</span>
                        )}
                        <span className="featured-chevron">›</span>
                      </div>
                    ))
                  )}
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

        {/* ONE-TIME OEM BATTERY OPTIMIZATION TIP */}
        {!batteryTipDismissed && callPermissionsStatus && !callPermissionsStatus.isIgnoringBatteryOptimizations && (
          <div style={{
            margin: "12px 16px",
            padding: "12px 16px",
            background: "rgba(245, 158, 11, 0.12)",
            border: "1px solid rgba(245, 158, 11, 0.35)",
            borderRadius: "12px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "20px" }}>🔋</span>
              <div>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#f59e0b" }}>
                  Keep Calls Ringing in Background ({callPermissionsStatus.brand ? callPermissionsStatus.brand.toUpperCase() : "Device"})
                </div>
                <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
                  Allow unrestricted battery usage so incoming call alerts can wake your screen even when locked.
                </div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
              <button
                className="edit-profile-pill-btn"
                style={{ fontSize: "12px", padding: "5px 10px", background: "#f59e0b", color: "#000", fontWeight: 700, border: "none" }}
                onClick={() => {
                  if ((window as any).AndroidCallBridge?.openBatteryOptimizationSettings) {
                    (window as any).AndroidCallBridge.openBatteryOptimizationSettings();
                  }
                }}
              >
                Settings
              </button>
              <button
                className="edit-profile-pill-btn"
                style={{ fontSize: "12px", padding: "5px 8px" }}
                onClick={() => {
                  setBatteryTipDismissed(true);
                  try { localStorage.setItem("devnest_dismiss_battery_tip", "true"); } catch {}
                }}
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* VIEW 1: HOME & COMMUNITY FEED */}
        {page === "feed" && (
          <>
            {/* HOME ALGORITHMIC FEED HEADER (NO COMMUNITY/GENERAL TAG) VS COMMUNITY GROUP HEADER */}
            {selectedCommunity === "home" ? (
              <div className="home-algorithmic-header">
                <div className="home-algo-top">
                  <div className="home-algo-tabs">
                    <button
                      type="button"
                      className={`home-algo-tab-btn ${feedTab === "for_you" ? "active" : ""}`}
                      onClick={() => setFeedTab("for_you")}
                    >
                      <span>✨ For You</span>
                    </button>
                    <button
                      type="button"
                      className={`home-algo-tab-btn ${feedTab === "following" ? "active" : ""}`}
                      onClick={() => setFeedTab("following")}
                    >
                      <span>👥 Following</span>
                    </button>
                    <button
                      type="button"
                      className={`home-algo-tab-btn ${feedTab === "trending" ? "active" : ""}`}
                      onClick={() => setFeedTab("trending")}
                    >
                      <span>🔥 Trending</span>
                    </button>
                    <button
                      type="button"
                      className={`home-algo-tab-btn ${feedTab === "latest" ? "active" : ""}`}
                      onClick={() => setFeedTab("latest")}
                    >
                      <span>🕒 Latest</span>
                    </button>
                  </div>

                  <div className="home-algo-controls">
                    <button
                      type="button"
                      className={`home-algo-pill-btn ${feedFilterMedia ? "active" : ""}`}
                      onClick={() => setFeedFilterMedia(!feedFilterMedia)}
                      title="Filter only posts with photos or videos"
                    >
                      <span>📷 Media</span>
                      {feedFilterMedia && <span>✓</span>}
                    </button>
                  </div>
                </div>

                <div className="home-algo-meta-bar">
                  <span className="home-algo-badge">
                    <span className="home-algo-badge-dot" />
                    {feedTab === "for_you"
                      ? "Smart Feed • Ranked by engagement velocity, author affinity & recency"
                      : feedTab === "following"
                      ? "Following Feed • Real-time posts from people you follow"
                      : feedTab === "trending"
                      ? "Trending Feed • Top discussed & liked posts"
                      : "Chronological Feed • Newest posts across Nesty"}
                  </span>
                  <span>{displayedPosts.length} posts</span>
                </div>
              </div>
            ) : (
              /* COMMUNITY GROUP HEADER WITH AUDIO & VIDEO GROUP CALL BUTTONS (ONLY RENDERED INSIDE GROUPS) */
              <div className="community-group-header-card">
                <div className="group-header-left">
                  <div className={`group-header-badge ${activeChannel?.badgeClass || "coding"}`}>
                    #
                  </div>
                  <div className="group-header-details">
                    <div className="group-header-title-line">
                      <h1 className="group-header-name">{activeChannel?.name || "Community Channel"}</h1>
                      <div className="group-header-badges-row">
                        {activeChannel?.currentUserRole === "admin" && (
                          <span className="comm-role-pill admin">👑 Admin</span>
                        )}
                        {activeChannel?.currentUserRole === "co_admin" && (
                          <span className="comm-role-pill co-admin">🛡️ Co-Admin</span>
                        )}
                        {activeChannel?.currentUserRole === "member" && (
                          <span className="comm-role-pill member">✓ Member</span>
                        )}
                        {activeChannel?.currentUserRole === "pending" && (
                          <span className="comm-role-pill pending">⏳ Pending Approval</span>
                        )}
                        <span className="group-members-chip">
                          👥 {activeChannel?.memberCount || 1} {activeChannel?.memberCount === 1 ? "member" : "members"}
                        </span>
                        <span className="group-online-chip">
                          <span className="group-online-dot" />
                          {liveUserCount} online
                        </span>
                      </div>
                    </div>
                    <p className="group-header-desc">{activeChannel?.subtitle || "Community Channel"}</p>

                    {/* Active call indicator in community group */}
                    {activeChannel && activeGroupCalls[activeChannel.id] && (
                      <div className="group-call-active-banner">
                        <span className="group-call-live-indicator">
                          <span className="group-call-live-dot" />
                          🔴 Group {activeGroupCalls[activeChannel.id].call_type === "video" ? "Video" : "Audio"} Call Active
                          {activeGroupCalls[activeChannel.id].participants &&
                            ` • ${Object.keys(activeGroupCalls[activeChannel.id].participants).length} connected`}
                        </span>
                        <button
                          type="button"
                          className="group-call-join-btn"
                          onClick={() =>
                            joinGroupCall(
                              activeChannel.id,
                              activeChannel.name,
                              activeGroupCalls[activeChannel.id].call_type || "audio"
                            )
                          }
                        >
                          Join Call
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="chat-header-actions" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  {activeChannel && (activeChannel.currentUserRole === "admin" || activeChannel.currentUserRole === "co_admin") ? (
                    <button
                      type="button"
                      className="comm-action-btn manage-btn"
                      onClick={() => openManageCommunity(activeChannel.id)}
                      title="Manage Community & Requests"
                    >
                      ⚙️ Manage
                    </button>
                  ) : activeChannel?.currentUserRole === "member" ? (
                    <button
                      type="button"
                      className="comm-action-btn leave-btn"
                      onClick={() => handleLeaveCommunity(activeChannel.id)}
                      title="Leave this community"
                    >
                      Joined • Leave
                    </button>
                  ) : activeChannel?.currentUserRole === "pending" ? (
                    <button
                      type="button"
                      className="comm-action-btn pending-btn"
                      disabled
                      title="Waiting for an admin to admit you"
                    >
                      ⏳ Request Sent
                    </button>
                  ) : activeChannel?.currentUserRole === "invited" ? (
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button
                        type="button"
                        className="comm-action-btn join-btn"
                        onClick={() => handleAcceptCommunityInvite(activeChannel.id)}
                        title="Accept Invitation to join"
                      >
                        ✓ Accept
                      </button>
                      <button
                        type="button"
                        className="comm-action-btn leave-btn"
                        onClick={() => handleDeclineCommunityInvite(activeChannel.id)}
                        title="Decline Invitation"
                      >
                        Decline
                      </button>
                    </div>
                  ) : activeChannel ? (
                    <button
                      type="button"
                      className="comm-action-btn join-btn"
                      onClick={() => handleJoinCommunity(activeChannel.id)}
                      title="Join this community"
                    >
                      + Join
                    </button>
                  ) : null}

                  <button
                    type="button"
                    className="chat-header-icon-btn"
                    onClick={() => {
                      if (activeChannel?.currentUserRole !== "admin" && activeChannel?.currentUserRole !== "co_admin" && activeChannel?.currentUserRole !== "member") {
                        alert("Please join this community to participate in group voice calls.");
                        return;
                      }
                      startGroupCall("audio", activeChannel?.id);
                    }}
                    title={`Voice Call in #${activeChannel?.name}`}
                  >
                    📞
                  </button>
                  <button
                    type="button"
                    className="chat-header-icon-btn"
                    onClick={() => {
                      if (activeChannel?.currentUserRole !== "admin" && activeChannel?.currentUserRole !== "co_admin" && activeChannel?.currentUserRole !== "member") {
                        alert("Please join this community to participate in group video calls.");
                        return;
                      }
                      startGroupCall("video", activeChannel?.id);
                    }}
                    title={`Video Call in #${activeChannel?.name}`}
                  >
                    📹
                  </button>
                </div>
              </div>
            )}

            {/* CONDITIONAL POST CREATOR: NON-MEMBERS SEE JOIN PROMPT, MEMBERS SEE CREATOR */}
            {selectedCommunity !== "home" && activeChannel && activeChannel.currentUserRole !== "admin" && activeChannel.currentUserRole !== "co_admin" && activeChannel.currentUserRole !== "member" ? (
              <div className="community-join-prompt-card">
                <div className="join-prompt-left">
                  <div className="join-prompt-icon">🔒</div>
                  <div className="join-prompt-content">
                    <h4>Join #{activeChannel.name} to participate</h4>
                    <p>
                      {activeChannel.currentUserRole === "pending"
                        ? "Your request to join this community is awaiting approval from an admin. Once admitted, you can create posts and participate in calls."
                        : activeChannel.requiresApproval
                        ? "This community requires admin approval. Click 'Join Community' to submit an admission request to the admins."
                        : "Join this community to share posts, ask questions, and chat with members."}
                    </p>
                  </div>
                </div>
                {activeChannel.currentUserRole === "pending" ? (
                  <button className="join-comm-action-btn pending" disabled>
                    ⏳ Waiting for Admin Approval
                  </button>
                ) : (
                  <button
                    className="join-comm-action-btn"
                    onClick={() => handleJoinCommunity(activeChannel.id)}
                  >
                    + Join Community
                  </button>
                )}
              </div>
            ) : (
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

                {selectedPostMusic && (
                  <div className="composer-selected-music-badge">
                    <div className="composer-music-disc">🎵</div>
                    <div className="composer-music-info">
                      <span className="composer-music-title">{selectedPostMusic.title}</span>
                      <span className="composer-music-artist">{selectedPostMusic.artist}</span>
                    </div>
                    <button
                      type="button"
                      className="composer-music-change-btn"
                      onClick={() => setPostMusicPickerOpen(true)}
                    >
                      Change
                    </button>
                    <button
                      type="button"
                      className="composer-music-remove-btn"
                      onClick={() => setSelectedPostMusic(null)}
                      title="Remove music"
                    >
                      ✕
                    </button>
                  </div>
                )}

                <div className="inline-creator-actions">
                  <div className="inline-attach-tools">
                    <label className="tool-attach-btn" style={{ cursor: "pointer" }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                      type="button"
                      className={`tool-attach-btn ${selectedPostMusic ? "active" : ""}`}
                      onClick={() => setPostMusicPickerOpen(true)}
                      title="Add background music"
                    >
                      <span>🎵</span>
                      <span>{selectedPostMusic ? "Music Added" : "Add Music"}</span>
                    </button>

                    <button
                      className="tool-attach-btn"
                      onClick={() => {
                        const url = prompt("Enter Link URL:");
                        if (url) setNewPost((prev) => `${prev} ${url}`);
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                      </svg>
                      <span>Link</span>
                    </button>

                    <button
                      className="tool-attach-btn"
                      onClick={() => alert("Poll creation dialog")}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                    <span>{uploadingMedia ? "Posting..." : "Post"}</span>
                  </button>
                </div>
              </div>
            )}
            {/* POSTS FEED LIST */}
            <div className="nesty-posts-feed">
              {displayedPosts.length === 0 ? (
                <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--text-muted)" }}>
                  <p style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-h)" }}>No posts found in this feed view.</p>
                  <p style={{ fontSize: "13px", marginTop: "4px" }}>
                    {feedTab === "following"
                      ? "You haven't followed anyone yet, or people you follow haven't posted. Try '✨ For You'!"
                      : feedFilterMedia
                      ? "No posts with media found matching your filters."
                      : "Be the first to post something to Nesty!"}
                  </p>
                </div>
              ) : (
                displayedPosts.map((post: Post) => {
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

                    {/* MEDIA, PHOTO PLACEHOLDER OR AUDIO SOUNDTRACK */}
                    {post.media_url || post.music_track ? (
                      post.media_url === "photo_placeholder" ? (
                        <div className="mock-photo-placeholder">
                          Photo
                        </div>
                      ) : (
                        <PostPlaybackMedia
                          post={post}
                          activePlayingPostId={activePlayingPostId}
                          setActivePlayingPostId={setActivePlayingPostId}
                        />
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
                        {(post.comments || []).map((c: Comment) => (
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
              }))}
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
                            type="button"
                            className="profile-golive-btn"
                            onClick={startLiveStream}
                            title="Go Live & Broadcast to Nesty Community"
                          >
                            <span className="live-pulsing-badge">●</span>
                            <span>Go Live</span>
                          </button>
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

                        {post.media_url || post.music_track ? (
                          post.media_url === "photo_placeholder" ? (
                            <div className="mock-photo-placeholder">Photo</div>
                          ) : (
                            <PostPlaybackMedia
                              post={post}
                              activePlayingPostId={activePlayingPostId}
                              setActivePlayingPostId={setActivePlayingPostId}
                            />
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

            {selectedPostMusic && (
              <div className="composer-selected-music-badge">
                <div className="composer-music-disc">🎵</div>
                <div className="composer-music-info">
                  <span className="composer-music-title">{selectedPostMusic.title}</span>
                  <span className="composer-music-artist">{selectedPostMusic.artist}</span>
                </div>
                <button
                  type="button"
                  className="composer-music-change-btn"
                  onClick={() => setPostMusicPickerOpen(true)}
                >
                  Change
                </button>
                <button
                  type="button"
                  className="composer-music-remove-btn"
                  onClick={() => setSelectedPostMusic(null)}
                  title="Remove music"
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
                type="button"
                className={`attach-media-pill-btn ${selectedPostMusic ? "active" : ""}`}
                onClick={() => setPostMusicPickerOpen(true)}
              >
                <span>🎵</span>
                <span>{selectedPostMusic ? "Music Added" : "Add music"}</span>
              </button>

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
            Connect, share moments, and explore vibrant communities with friends on Nesty.
          </p>
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

        {/* CARD 2: COMMUNITIES */}
        {dashboardCommunities.length > 0 && (
          <div className="featured-widget">
            <h4 className="featured-heading">Your Communities</h4>
            <div className="featured-channels-list">
              {dashboardCommunities.map((comm) => (
                <div
                  key={comm.id}
                  className="featured-channel-row"
                  onClick={() => {
                    setSelectedCommunity(comm.id);
                    setPage("feed");
                  }}
                >
                  <div className="featured-icon-badge purple">#</div>
                  <div className="featured-channel-text">
                    <span className="featured-channel-title">{comm.name}</span>
                    <span className="featured-channel-sub">{comm.subtitle}</span>
                  </div>
                  {activeGroupCalls[comm.id] && (
                    <span style={{ fontSize: "11px", color: "#ef4444", fontWeight: 700, marginRight: "4px" }}>🔴 LIVE</span>
                  )}
                  <span className="featured-chevron">›</span>
                </div>
              ))}
            </div>
          </div>
        )}

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
    </>
  )}

  {/* CREATE COMMUNITY MODAL */}
      {createCommModalOpen && (
        <div className="modal-overlay-nesty" onClick={() => setCreateCommModalOpen(false)}>
          <div className="modal-content-card" style={{ maxWidth: "480px" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: "8px", color: "var(--text-h)" }}>Create New Community</h3>
            <p style={{ fontSize: "13.5px", color: "var(--text-muted)", marginBottom: "16px" }}>
              Start a new focused community channel. As the creator, you will automatically be the group's admin.
            </p>
            <input
              className="auth-input"
              placeholder="e.g. Algorithms, DevOps, Python..."
              value={newCommName}
              onChange={(e) => setNewCommName(e.target.value)}
              style={{ marginBottom: "12px" }}
            />
            <textarea
              className="auth-input"
              placeholder="Community description / topics (optional)"
              value={newCommDescription}
              onChange={(e) => setNewCommDescription(e.target.value)}
              style={{ marginBottom: "16px", minHeight: "65px", resize: "vertical" }}
            />

            <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", marginBottom: "20px", cursor: "pointer", fontSize: "13px", color: "var(--text-h)" }}>
              <input
                type="checkbox"
                checked={newCommRequiresApproval}
                onChange={(e) => setNewCommRequiresApproval(e.target.checked)}
                style={{ width: "18px", height: "18px", accentColor: "#10b981", cursor: "pointer", marginTop: "2px" }}
              />
              <div>
                <strong>Require Admin Approval to Join</strong>
                <p style={{ margin: "2px 0 0 0", fontSize: "12px", color: "var(--text-muted)" }}>
                  When enabled, users who click Join must wait for an admin or co-admin to admit them. When disabled, members join automatically.
                </p>
              </div>
            </label>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                className="edit-profile-pill-btn"
                onClick={() => setCreateCommModalOpen(false)}
              >
                Cancel
              </button>
              <button
                className="post-pill-submit"
                onClick={async () => {
                  if (!newCommName.trim()) return;
                  const name = newCommName.trim();
                  const slug = name.toLowerCase().replace(/\s+/g, "-");
                  const desc = newCommDescription.trim() || `Discussions and updates for ${name}`;
                  const newChannel: CommunityChannel = {
                    id: slug,
                    name,
                    badgeClass: "custom",
                    subtitle: desc,
                    requiresApproval: newCommRequiresApproval,
                    memberCount: 1,
                    currentUserRole: "admin",
                  };
                  setCommunities((prev) => [...prev, newChannel]);
                  setSelectedCommunity(slug);
                  setPage("feed");
                  setNewCommName("");
                  setNewCommDescription("");
                  setNewCommRequiresApproval(false);
                  setCreateCommModalOpen(false);

                  try {
                    const authToken = token || localStorage.getItem("token");
                    const res = await fetch(`${API_URL}/api/communities`, {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${authToken}`,
                      },
                      body: JSON.stringify({
                        name,
                        description: desc,
                        badge_class: "custom",
                        requires_approval: newCommRequiresApproval,
                      }),
                    });
                    if (res.ok) {
                      const data = await res.json();
                      const created = data.community || data;
                      setCommunities((prev) =>
                        prev.map((c) =>
                          c.id === slug
                            ? {
                                id: created.slug || String(created.id),
                                name: created.name,
                                badgeClass: created.badge_class || "custom",
                                subtitle: created.description || desc,
                                createdById: created.created_by_id,
                                requiresApproval: !!created.requires_approval,
                                memberCount: 1,
                                currentUserRole: "admin",
                              }
                            : c
                        )
                      );
                    }
                  } catch (err) {
                    console.error("Failed to persist community:", err);
                  }
                }}
              >
                Create Community
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MANAGE COMMUNITY MODAL (ADMINS & CO-ADMINS) */}
      {manageCommModalOpen && (
        <div className="modal-overlay-nesty" onClick={() => setManageCommModalOpen(false)}>
          <div className="modal-content-card manage-comm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="manage-comm-header">
              <div>
                <h3>Manage #{activeChannel?.name || "Community"}</h3>
                <p className="manage-comm-sub">Review membership requests, assign co-admins, and configure group settings.</p>
              </div>
              <button className="manage-close-btn" onClick={() => setManageCommModalOpen(false)}>✕</button>
            </div>

            {/* ADMISSION SETTING CARD */}
            <div className="manage-setting-card">
              <div className="manage-setting-info">
                <strong>Admission Policy</strong>
                <span>
                  {manageCommRequiresApproval
                    ? "Approval Required: users who click Join must be admitted by an admin or co-admin."
                    : "Automatic: anyone who clicks Join becomes an active member immediately."}
                </span>
              </div>
              <label className="manage-toggle-label">
                <input
                  type="checkbox"
                  checked={manageCommRequiresApproval}
                  onChange={(e) => handleUpdateCommunitySettings(manageCommSlug, e.target.checked)}
                />
                <span>Require Admin Approval</span>
              </label>
            </div>

            {/* TABS: PENDING REQUESTS, MEMBERS, INVITE */}
            <div className="manage-comm-tabs">
              <button
                className={`manage-tab-btn ${manageTab === "pending" ? "active" : ""}`}
                onClick={() => setManageTab("pending")}
              >
                <span>Pending Requests</span>
                {manageCommPending.length > 0 && (
                  <span className="manage-pending-badge">{manageCommPending.length}</span>
                )}
              </button>
              <button
                className={`manage-tab-btn ${manageTab === "members" ? "active" : ""}`}
                onClick={() => setManageTab("members")}
              >
                <span>Members ({manageCommMembers.length})</span>
              </button>
              <button
                className={`manage-tab-btn ${manageTab === "invite" ? "active" : ""}`}
                onClick={() => setManageTab("invite")}
              >
                <span>+ Invite Users</span>
              </button>
            </div>

            <div className="manage-comm-body">
              {manageCommLoading ? (
                <div style={{ textAlign: "center", padding: "30px", color: "var(--text-muted)" }}>Loading members...</div>
              ) : manageTab === "pending" ? (
                manageCommPending.length === 0 ? (
                  <div className="manage-empty-state">
                    <span>🎉</span>
                    <p>No pending membership requests.</p>
                  </div>
                ) : (
                  <div className="manage-members-list">
                    {manageCommPending.map((item) => (
                      <div key={item.id} className="manage-member-row">
                        <div className="manage-member-user" onClick={() => item.user?.id && openProfile(item.user.id)}>
                          {item.user?.avatar_url ? (
                            <img src={item.user.avatar_url} alt="" className="manage-avatar" />
                          ) : (
                            <div className="manage-avatar-placeholder">
                              {(item.user?.name || item.user?.username || "U")[0].toUpperCase()}
                            </div>
                          )}
                          <div className="manage-member-names">
                            <span className="manage-name">{item.user?.name || item.user?.username}</span>
                            <span className="manage-username">@{item.user?.username}</span>
                          </div>
                        </div>
                        <div className="manage-member-actions">
                          <button
                            className="admit-btn"
                            onClick={() => handleApproveMember(manageCommSlug, item.user_id)}
                          >
                            ✓ Admit
                          </button>
                          <button
                            className="decline-btn"
                            onClick={() => handleRejectMember(manageCommSlug, item.user_id)}
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : manageTab === "members" ? (
                <div className="manage-members-list">
                  {manageCommMembers.map((item) => {
                    const isCreator = activeChannel?.createdById === item.user_id;
                    const isCallerAdmin = activeChannel?.currentUserRole === "admin";
                    const isItemCoAdmin = item.role === "co_admin";

                    return (
                      <div key={item.id} className="manage-member-row">
                        <div className="manage-member-user" onClick={() => item.user?.id && openProfile(item.user.id)}>
                          {item.user?.avatar_url ? (
                            <img src={item.user.avatar_url} alt="" className="manage-avatar" />
                          ) : (
                            <div className="manage-avatar-placeholder">
                              {(item.user?.name || item.user?.username || "U")[0].toUpperCase()}
                            </div>
                          )}
                          <div className="manage-member-names">
                            <span className="manage-name">
                              {item.user?.name || item.user?.username}
                              {item.user_id === user?.id && <span className="manage-you-tag"> (You)</span>}
                            </span>
                            <span className="manage-username">@{item.user?.username}</span>
                          </div>
                        </div>

                        <div className="manage-member-actions">
                          <span className={`manage-role-tag ${item.role}`}>
                            {item.role === "admin" ? "👑 Admin" : item.role === "co_admin" ? "🛡️ Co-Admin" : "Member"}
                          </span>

                          {/* The Admin of the group can make other people co-admins */}
                          {isCallerAdmin && !isCreator && item.user_id !== user?.id && (
                            <button
                              className={`role-toggle-btn ${isItemCoAdmin ? "demote" : "promote"}`}
                              onClick={() =>
                                handleToggleMemberRole(
                                  manageCommSlug,
                                  item.user_id,
                                  isItemCoAdmin ? "member" : "co_admin"
                                )
                              }
                            >
                              {isItemCoAdmin ? "Remove Co-Admin" : "Make Co-Admin"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="manage-invite-section" style={{ padding: "8px 0" }}>
                  <div style={{ marginBottom: "12px" }}>
                    <input
                      type="text"
                      className="auth-input"
                      placeholder="Search Nesters by username or name to invite..."
                      value={inviteSearchQuery}
                      onChange={async (e) => {
                        const val = e.target.value;
                        setInviteSearchQuery(val);
                        if (!val.trim()) {
                          setInviteSearchResults([]);
                          return;
                        }
                        try {
                          const res = await fetch(`${API_URL}/api/users/search?q=${encodeURIComponent(val)}`, {
                            headers: { Authorization: `Bearer ${token}` },
                          });
                          if (res.ok) {
                            const data = await res.json();
                            setInviteSearchResults(data || []);
                          }
                        } catch {}
                      }}
                      style={{ fontSize: "13px", padding: "9px 12px", width: "100%", boxSizing: "border-box" }}
                    />
                  </div>
                  {inviteSearchResults.length === 0 ? (
                    <div className="manage-empty-state">
                      <p>{inviteSearchQuery ? "No Nesters found." : "Type above to search and invite users to this community."}</p>
                    </div>
                  ) : (
                    <div className="manage-members-list">
                      {inviteSearchResults.map((u) => {
                        const isAlreadyMember = manageCommMembers.some((m) => m.user_id === u.id);
                        return (
                          <div key={u.id} className="manage-member-row">
                            <div className="manage-member-user" onClick={() => openProfile(u.id)}>
                              {u.avatar_url ? (
                                <img src={u.avatar_url} alt="" className="manage-avatar" />
                              ) : (
                                <div className="manage-avatar-placeholder">
                                  {(u.name || u.username || "U")[0].toUpperCase()}
                                </div>
                              )}
                              <div className="manage-member-names">
                                <span className="manage-name">{u.name || u.username}</span>
                                <span className="manage-username">@{u.username}</span>
                              </div>
                            </div>
                            <div className="manage-member-actions">
                              {isAlreadyMember ? (
                                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Already Member</span>
                              ) : (
                                <button
                                  type="button"
                                  className="admit-btn"
                                  onClick={() => handleInviteCommunityMember(manageCommSlug, u.id)}
                                >
                                  ✉️ Invite
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
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
            <button
              className="chat-header-icon-btn"
              title="All Messages"
              style={{ marginRight: "6px", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}
              onClick={() => {
                setActiveChatPartner(null);
                openMessagesInbox();
              }}
            >
              ←
            </button>
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
                  <div
                    key={msg.id || (msg as any).ID || i}
                    id={`chat-msg-${msg.id || (msg as any).ID || i}`}
                    className={`chat-msg-row ${isMine ? "outgoing" : "incoming"}`}
                  >
                    {!isMine && (
                      <button
                        type="button"
                        className="chat-msg-reply-action-btn"
                        onClick={() => setReplyingToMessage(msg)}
                        title="Reply to message"
                      >
                        ↩
                      </button>
                    )}
                    <div className="chat-msg-bubble">
                      {msg.reply_to_message && (
                        <div
                          className="chat-msg-quote-bubble"
                          onClick={() => {
                            const target = document.getElementById(`chat-msg-${msg.reply_to_message?.id}`);
                            if (target) {
                              target.scrollIntoView({ behavior: "smooth", block: "center" });
                              target.classList.add("highlighted-quote");
                              setTimeout(() => target.classList.remove("highlighted-quote"), 2000);
                            }
                          }}
                          title="Click to jump to quoted message"
                        >
                          <span className="chat-msg-quote-sender">
                            {msg.reply_to_message.is_deleted
                              ? "Original message"
                              : `@${msg.reply_to_message.username || msg.reply_to_message.sender_name}`}
                          </span>
                          <p className="chat-msg-quote-snippet">
                            {msg.reply_to_message.is_deleted ? (
                              <span className="chat-msg-quote-unavailable">Original message unavailable</span>
                            ) : (
                              msg.reply_to_message.content || (msg.reply_to_message.media_url ? "📷 Attachment" : "Message")
                            )}
                          </p>
                        </div>
                      )}
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
                    {isMine && (
                      <button
                        type="button"
                        className="chat-msg-reply-action-btn"
                        onClick={() => setReplyingToMessage(msg)}
                        title="Reply to message"
                      >
                        ↩
                      </button>
                    )}
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
            {/* REPLY PREVIEW BAR */}
            {replyingToMessage && (
              <div className="chat-reply-preview-bar">
                <div className="chat-reply-preview-info">
                  <span className="chat-reply-preview-user">
                    Replying to @{replyingToMessage.sender_id === user?.id ? (user?.username || "You") : (activeChatPartner.username || "User")}
                  </span>
                  <span className="chat-reply-preview-text">
                    {replyingToMessage.content || (replyingToMessage.media_url ? "📷 Attachment" : "Message")}
                  </span>
                </div>
                <button
                  type="button"
                  className="chat-reply-preview-cancel"
                  onClick={() => setReplyingToMessage(null)}
                  title="Cancel reply"
                >
                  ✕
                </button>
              </div>
            )}

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
        <div className="call-overlay">
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

      {/* GET APK & QR CODE MODAL */}
      {apkModalOpen && (
        <div className="modal-overlay-nesty" onClick={() => setApkModalOpen(false)}>
          <div className="modal-content-card" style={{ maxWidth: "420px", textAlign: "center", padding: "28px 24px" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "22px" }}>📱</span>
                <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "var(--text-h)" }}>Nesty Android APK</h3>
              </div>
              <button
                className="edit-profile-pill-btn"
                onClick={() => setApkModalOpen(false)}
                title="Close"
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: "0 0 16px 0", lineHeight: "1.5" }}>
              Scan this QR barcode with your phone's camera to download and install Nesty directly:
            </p>

            <div className="apk-qr-frame" style={{ width: "200px", height: "200px", margin: "0 auto 16px auto", padding: "10px", background: "#ffffff", borderRadius: "16px", border: "2px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <img
                src="/devnest-apk-qr.png"
                alt="Scan barcode to download Nesty APK"
                style={{ width: "180px", height: "180px", display: "block", objectFit: "contain" }}
                onError={(e) => {
                  e.currentTarget.onerror = null;
                  e.currentTarget.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAXIAAAFyAQAAAADAX2ykAAACtklEQVR4nO2cTYrkMAyFn8aBXjrQB5ijJEdPjtI3sJcDDm8WlpwEZvqHSaXLg7woUuVvIRCSnySnhPjKWn98CQecd975h/JZdM31aYDMti0zANsf7rHH+Yv5QJIkEEmSvwTAVt0N5AGYSJLpLnucv5rX4MwDROSFAAKx/izAOgI1xOcb7XH+IXws+rDKAExvw/G3b7DH+UfwW83PWMdAdfK32uP8P/MkC/SsTYGYEkCmTTR+I8nlRnucv5Lfqjw+/R4oMwKrz1cRERnvssf56/gBiHuLo4DIAIECIO5fb7PH+Wt5kCkQU62PCrjUXBxOH5HElAK5PJv9zr+/hurVdUwg8gCZ3oaqmPd8LVPaBiLfYY/z1/IgU9NX8fwBAIgkJhZ4/HbJ1/xcszITaq+qimggWM7euWez3/kPVu1N8lAV2c5kjrfGJd2/3fGH/KxJGoFWBAdTzrvmejb7nf8MLzICMucXAlHnC1ywicrp2vi4zx7nr+I1fhcE6lM9cLU02uWW5+cueU3NC2BjwMNxfBZZ0f3bH6+n7sSzTAZaEEN3XT/3yKvftIm1e9pci0hL0q6vOuSbdG4VUGydykNr0uvffvn8Qqyj3rXClDax0G3j/jFQb3I8of3Ov7f06hVakk7HctiC2PuTnfLasKrF7V4GRVIrpVja/Tr3b3+8xa85VLWyLY1a49y/vfHWcLYx0a6qbBJsnPcne+QP9zeIPEKmNAqRhwJkAYFQgPxqUuvZ7Hf+g/XngREAjWnTXK6vuuStv0HaJZ3Wem79SWtM+/nbH6/3r+pUsLYhYXL6sILr5/+BD5S55WdN1wVcsPn92D7509sJ+bVglVCgqmoTO4pDkXvscf5a/nz+2qSwTgXt6EV7xdDzc498e38hD8AuqJqw5oLNdp/Rfuf/vsT/n8F557vlfwOGZ2vbLPzC/QAAAABJRU5ErkJggg==";
                }}
              />
            </div>

            <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "18px" }}>
              Point camera to scan • 6.7 MB APK
            </div>

            <a
              href="/Nesty.apk"
              download="Nesty.apk"
              className="apk-download-direct-btn"
              style={{ width: "100%", justifyContent: "center" }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>Download Nesty.apk Directly</span>
            </a>
          </div>
        </div>
      )}

      {/* =====================================================================
          MESSAGES OVERVIEW & CONVERSATIONS INBOX MODAL
          ===================================================================== */}
      {messagesInboxOpen && (
        <div className="modal-overlay-nesty" onClick={() => setMessagesInboxOpen(false)}>
          <div
            className="modal-content-card"
            style={{
              maxWidth: "520px",
              width: "100%",
              padding: "0",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              maxHeight: "82vh",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "20px" }}>💬</span>
                <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 700, color: "var(--text-h)" }}>Messages</h3>
              </div>
              <button
                className="edit-profile-pill-btn"
                style={{ fontSize: "14px", padding: "4px 10px", background: "transparent", border: "none", cursor: "pointer", color: "var(--text-muted)" }}
                onClick={() => setMessagesInboxOpen(false)}
                title="Close"
              >
                ✕
              </button>
            </div>

            {/* Search filter input */}
            <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", background: "var(--surface-subtle, rgba(255,255,255,0.02))" }}>
              <input
                type="text"
                placeholder="Search conversations or users..."
                value={messagesSearchQuery}
                onChange={(e) => setMessagesSearchQuery(e.target.value)}
                style={{
                  width: "100%",
                  padding: "9px 14px",
                  borderRadius: "10px",
                  border: "1px solid var(--border)",
                  background: "var(--surface, #1e293b)",
                  color: "var(--text, #f8fafc)",
                  fontSize: "13.5px",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* Conversations & Users List */}
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: "16px" }}>
              {isMessagesInboxLoading ? (
                <div style={{ textAlign: "center", padding: "30px", color: "var(--text-muted)", fontSize: "13px" }}>
                  Loading conversations & users...
                </div>
              ) : (
                <>
                  {/* Recent Conversations */}
                  {conversationsList.length > 0 && (
                    <div>
                      <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-muted)", marginBottom: "8px", paddingLeft: "4px" }}>
                        Recent Conversations
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        {conversationsList
                          .filter((conv) => {
                            if (!messagesSearchQuery.trim()) return true;
                            const q = messagesSearchQuery.toLowerCase();
                            const p = conv.partner;
                            return (
                              (p.name && p.name.toLowerCase().includes(q)) ||
                              (p.username && p.username.toLowerCase().includes(q)) ||
                              (conv.last_message && conv.last_message.toLowerCase().includes(q))
                            );
                          })
                          .map((conv) => {
                            const p = conv.partner;
                            const isOnline = communityStats.online_users.some((ou) => ou.id === p.id);
                            return (
                              <div
                                key={p.id}
                                onClick={() => {
                                  setMessagesInboxOpen(false);
                                  startChatWithUser(p);
                                }}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "12px",
                                  padding: "10px 12px",
                                  borderRadius: "10px",
                                  cursor: "pointer",
                                  transition: "background 0.15s ease",
                                  background: "var(--surface-subtle, rgba(255,255,255,0.03))",
                                  border: "1px solid var(--border)",
                                }}
                              >
                                {/* Avatar with online dot */}
                                <div style={{ position: "relative", width: "42px", height: "42px", flexShrink: 0 }}>
                                  {p.avatar_url ? (
                                    <img src={p.avatar_url} alt="" style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} />
                                  ) : (
                                    <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: "#047857", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "16px" }}>
                                      {(p.username || "U").charAt(0).toUpperCase()}
                                    </div>
                                  )}
                                  {isOnline && (
                                    <span
                                      style={{
                                        position: "absolute",
                                        bottom: 0,
                                        right: 0,
                                        width: "11px",
                                        height: "11px",
                                        borderRadius: "50%",
                                        background: "#10b981",
                                        border: "2px solid var(--surface, #1e293b)",
                                      }}
                                    />
                                  )}
                                </div>

                                {/* Text info */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                                    <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-h)" }} className="truncate">
                                      {p.name || p.username}
                                    </span>
                                    <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                                      {conv.last_time ? timeAgo(conv.last_time) : ""}
                                    </span>
                                  </div>
                                  <div style={{ fontSize: "12.5px", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {conv.is_sender ? "You: " : ""}{conv.last_message || (conv.media_type ? `[${conv.media_type}]` : "Active chat")}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}

                  {/* All Users / Start a Conversation */}
                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-muted)", marginBottom: "8px", paddingLeft: "4px" }}>
                      {conversationsList.length > 0 ? "All Members" : "Select someone to chat with"}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      {allUsersList
                        .filter((u) => {
                          if (!messagesSearchQuery.trim()) return true;
                          const q = messagesSearchQuery.toLowerCase();
                          return (
                            (u.name && u.name.toLowerCase().includes(q)) ||
                            (u.username && u.username.toLowerCase().includes(q))
                          );
                        })
                        .sort((a, b) => {
                          const aOnline = communityStats.online_users.some((ou) => ou.id === a.id);
                          const bOnline = communityStats.online_users.some((ou) => ou.id === b.id);
                          if (aOnline && !bOnline) return -1;
                          if (!aOnline && bOnline) return 1;
                          return 0;
                        })
                        .map((u) => {
                          const isOnline = communityStats.online_users.some((ou) => ou.id === u.id);
                          return (
                            <div
                              key={u.id}
                              onClick={() => {
                                setMessagesInboxOpen(false);
                                startChatWithUser(u);
                              }}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "12px",
                                padding: "8px 12px",
                                borderRadius: "10px",
                                cursor: "pointer",
                                transition: "background 0.15s ease",
                                background: "transparent",
                              }}
                              className="chat-conversation-item"
                            >
                              <div style={{ position: "relative", width: "38px", height: "38px", flexShrink: 0 }}>
                                {u.avatar_url ? (
                                  <img src={u.avatar_url} alt="" style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} />
                                ) : (
                                  <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: "#2563eb", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "15px" }}>
                                    {(u.username || "U").charAt(0).toUpperCase()}
                                  </div>
                                )}
                                {isOnline && (
                                  <span
                                    style={{
                                      position: "absolute",
                                      bottom: 0,
                                      right: 0,
                                      width: "10px",
                                      height: "10px",
                                      borderRadius: "50%",
                                      background: "#10b981",
                                      border: "2px solid var(--surface, #1e293b)",
                                    }}
                                  />
                                )}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--text-h)" }} className="truncate">
                                  {u.name || u.username}
                                </div>
                                <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                                  @{u.username} {isOnline ? "• Online now" : ""}
                                </div>
                              </div>
                              <button
                                className="edit-profile-pill-btn"
                                style={{ fontSize: "11px", padding: "4px 10px", background: "#059669", color: "#fff", border: "none" }}
                              >
                                Chat
                              </button>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          APP & CALLING PERMISSIONS SETUP (ONBOARDING & SETTINGS)
          ===================================================================== */}
      {(permissionsModalOpen || callDiagModalOpen) && (
        <div className="modal-overlay-nesty" onClick={() => { setPermissionsModalOpen(false); setCallDiagModalOpen(false); }}>
          <div className="modal-content-card" style={{ maxWidth: "480px", textAlign: "left", padding: "26px 24px" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "22px" }}>🔔</span>
                <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "var(--text-h)" }}>App & Calling Permissions</h3>
              </div>
              <button
                className="edit-profile-pill-btn"
                onClick={() => {
                  try { localStorage.setItem("devnest_permissions_onboarded", "true"); } catch {}
                  setPermissionsModalOpen(false);
                  setCallDiagModalOpen(false);
                }}
                title="Close"
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: "0 0 16px 0", lineHeight: "1.5" }}>
              Please allow these permissions so voice & video calls, messages, and notifications work reliably — even when your phone is locked or the app is closed.
            </p>

            {/* STATUS LIST */}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "20px" }}>
              {/* 1. System Notifications */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--bg-subtle, rgba(255,255,255,0.03))", borderRadius: "10px", border: "1px solid var(--border-color, #334155)" }}>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 600 }}>System Notifications</div>
                  <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                    {callPermissionsStatus?.notificationsEnabled ? "✅ Allowed" : "Receive incoming call alerts & chat notifications"}
                  </div>
                </div>
                <button
                  className="edit-profile-pill-btn"
                  style={{ fontSize: "11px", padding: "5px 12px", background: "#2563eb", color: "#fff", border: "none", fontWeight: 600 }}
                  onClick={() => {
                    if ((window as any).AndroidCallBridge?.openNotificationSettings) {
                      (window as any).AndroidCallBridge.openNotificationSettings();
                    } else if (typeof window !== "undefined" && "Notification" in window) {
                      Notification.requestPermission();
                    }
                  }}
                >
                  {callPermissionsStatus?.notificationsEnabled ? "Settings" : "Allow"}
                </button>
              </div>

              {/* 2. Microphone & Camera */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--bg-subtle, rgba(255,255,255,0.03))", borderRadius: "10px", border: "1px solid var(--border-color, #334155)" }}>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 600 }}>Microphone & Camera</div>
                  <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                    Required for talking and appearing on video calls
                  </div>
                </div>
                <button
                  className="edit-profile-pill-btn"
                  style={{ fontSize: "11px", padding: "5px 12px", background: "#059669", color: "#fff", border: "none", fontWeight: 600 }}
                  onClick={async () => {
                    try {
                      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
                      stream.getTracks().forEach((t) => t.stop());
                      alert("Microphone and Camera permissions granted!");
                    } catch (e: any) {
                      alert("Please grant Microphone & Camera permissions in device settings.");
                    }
                  }}
                >
                  Allow
                </button>
              </div>

              {/* 3. High-Priority Call Ring Channel */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--bg-subtle, rgba(255,255,255,0.03))", borderRadius: "10px", border: "1px solid var(--border-color, #334155)" }}>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 600 }}>Ringtone & Vibration Channel</div>
                  <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                    {callPermissionsStatus?.channelValid ? "✅ High Priority & Looping Ringtone" : "⚠️ Channel muted or low priority"}
                  </div>
                </div>
                <button
                  className="edit-profile-pill-btn"
                  style={{ fontSize: "11px", padding: "5px 12px" }}
                  onClick={() => {
                    if ((window as any).AndroidCallBridge?.openChannelSettings) {
                      (window as any).AndroidCallBridge.openChannelSettings("incoming_calls_v3");
                    }
                  }}
                >
                  Configure
                </button>
              </div>

              {/* 4. Full-Screen Intent (Android 14+) */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--bg-subtle, rgba(255,255,255,0.03))", borderRadius: "10px", border: "1px solid var(--border-color, #334155)" }}>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 600 }}>Full-Screen Lock Takeover</div>
                  <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                    {callPermissionsStatus?.canUseFullScreenIntent ? "✅ Screen wake & lock takeover allowed" : "Wake screen on incoming calls"}
                  </div>
                </div>
                <button
                  className="edit-profile-pill-btn"
                  style={{ fontSize: "11px", padding: "5px 12px", background: "#7c3aed", color: "#fff", border: "none", fontWeight: 600 }}
                  onClick={() => {
                    if ((window as any).AndroidCallBridge?.openFullScreenIntentSettings) {
                      (window as any).AndroidCallBridge.openFullScreenIntentSettings();
                    }
                  }}
                >
                  Configure
                </button>
              </div>

              {/* 5. Battery Optimization */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--bg-subtle, rgba(255,255,255,0.03))", borderRadius: "10px", border: "1px solid var(--border-color, #334155)" }}>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 600 }}>Background Activity & Battery</div>
                  <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                    {callPermissionsStatus?.isIgnoringBatteryOptimizations ? "✅ Unrestricted background activity" : "Prevent phone from killing Nesty in background"}
                  </div>
                </div>
                <button
                  className="edit-profile-pill-btn"
                  style={{ fontSize: "11px", padding: "5px 12px", background: "#f59e0b", color: "#000", border: "none", fontWeight: 700 }}
                  onClick={() => {
                    if ((window as any).AndroidCallBridge?.openBatteryOptimizationSettings) {
                      (window as any).AndroidCallBridge.openBatteryOptimizationSettings();
                    }
                  }}
                >
                  Battery Settings
                </button>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                className="edit-profile-pill-btn"
                style={{ width: "100%", padding: "10px", background: "#2563eb", color: "#fff", border: "none", fontWeight: 700, borderRadius: "10px", fontSize: "14px" }}
                onClick={() => {
                  try { localStorage.setItem("devnest_permissions_onboarded", "true"); } catch {}
                  setPermissionsModalOpen(false);
                  setCallDiagModalOpen(false);
                }}
              >
                Continue to Nesty
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: CREATE REEL MODAL
          ===================================================================== */}
      {createReelModalOpen && (
        <div className="modal-overlay-nesty" onClick={() => setCreateReelModalOpen(false)}>
          <div className="modal-card-nesty reels-create-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-nesty">
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "20px" }}>🎬</span>
                <h3 className="modal-title-nesty">Create New Reel</h3>
              </div>
              <button
                className="edit-profile-pill-btn"
                style={{ padding: "4px 8px" }}
                onClick={() => setCreateReelModalOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body-nesty" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 700, marginBottom: "6px", color: "var(--text-h)" }}>
                  Video Source (Upload Video File or Paste MP4/WebM URL)
                </label>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <label className="edit-profile-pill-btn" style={{ cursor: "pointer", background: "var(--surface)", border: "1px dashed var(--border)" }}>
                    📁 Select Video File
                    <input
                      type="file"
                      accept="video/mp4,video/webm,video/ogg,video/quicktime"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        setNewReelFile(file);
                        if (file) {
                          setNewReelPreview(URL.createObjectURL(file));
                          setNewReelVideoUrl("");
                        }
                      }}
                    />
                  </label>
                  <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>or URL:</span>
                  <input
                    type="text"
                    className="nesty-input-field"
                    placeholder="https://.../video.mp4"
                    value={newReelVideoUrl}
                    onChange={(e) => {
                      setNewReelVideoUrl(e.target.value);
                      if (e.target.value) {
                        setNewReelPreview(e.target.value);
                        setNewReelFile(null);
                      }
                    }}
                    style={{ flex: 1, minWidth: "160px", padding: "8px 12px", fontSize: "13px" }}
                  />
                </div>
              </div>

              {newReelPreview && (
                <div style={{ position: "relative", borderRadius: "12px", overflow: "hidden", maxHeight: "240px", background: "#000", display: "flex", justifyContent: "center" }}>
                  <video
                    src={newReelPreview}
                    controls
                    playsInline
                    style={{ maxHeight: "240px", maxWidth: "100%", borderRadius: "12px" }}
                  />
                  <button
                    style={{ position: "absolute", top: "8px", right: "8px", background: "rgba(0,0,0,0.7)", color: "#fff", border: "none", borderRadius: "50%", width: "24px", height: "24px", cursor: "pointer" }}
                    onClick={() => { setNewReelPreview(null); setNewReelFile(null); setNewReelVideoUrl(""); }}
                  >
                    ✕
                  </button>
                </div>
              )}

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 700, marginBottom: "6px", color: "var(--text-h)" }}>
                  Caption & Hashtags
                </label>
                <textarea
                  className="nesty-input-field"
                  rows={3}
                  placeholder="Tell Nesters what this reel is about... #coding #fullstack"
                  value={newReelCaption}
                  onChange={(e) => setNewReelCaption(e.target.value)}
                  style={{ width: "100%", padding: "10px", fontSize: "13px", resize: "none" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 700, marginBottom: "6px", color: "var(--text-h)" }}>
                  🎵 Background Music & Audio Controls
                </label>

                {selectedReelMusic ? (
                  <div className="composer-selected-music-badge" style={{ marginBottom: "10px" }}>
                    <div className="composer-music-disc">🎵</div>
                    <div className="composer-music-info">
                      <span className="composer-music-title">{selectedReelMusic.title}</span>
                      <span className="composer-music-artist">{selectedReelMusic.artist}</span>
                    </div>
                    <button
                      type="button"
                      className="composer-music-change-btn"
                      onClick={() => setReelMusicPickerOpen(true)}
                    >
                      Change
                    </button>
                    <button
                      type="button"
                      className="composer-music-remove-btn"
                      onClick={() => setSelectedReelMusic(null)}
                      title="Remove music"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="edit-profile-pill-btn"
                    style={{ width: "100%", padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", marginBottom: "10px", background: "rgba(99, 102, 241, 0.12)", border: "1px dashed var(--primary, #6366f1)", color: "#a5b4fc" }}
                    onClick={() => setReelMusicPickerOpen(true)}
                  >
                    <span>🎵</span>
                    <span>Add Music Track</span>
                  </button>
                )}

                <div className="reel-composer-audio-box">
                  <div className="sound-toggle-row">
                    <div className="sound-toggle-label">
                      <span className="sound-toggle-title">Original Sound</span>
                      <span className="sound-toggle-sub">
                        {reelMuteOriginal ? "Muted (remove original audio)" : "Original audio enabled"}
                      </span>
                    </div>
                    <button
                      type="button"
                      className={`switch-toggle-btn ${!reelMuteOriginal ? "active" : ""}`}
                      onClick={() => setReelMuteOriginal(!reelMuteOriginal)}
                      title={reelMuteOriginal ? "Enable original sound" : "Mute original sound"}
                    >
                      <span className="switch-toggle-knob" />
                    </button>
                  </div>

                  {selectedReelMusic && (
                    <div className="volume-slider-group">
                      <div className="volume-slider-row">
                        <span className="volume-slider-name">Music Volume</span>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={reelMusicVolume}
                          onChange={(e) => setReelMusicVolume(parseFloat(e.target.value))}
                          className="volume-slider-input"
                        />
                        <span className="volume-slider-val">{Math.round(reelMusicVolume * 100)}%</span>
                      </div>

                      {!reelMuteOriginal && (
                        <div className="volume-slider-row">
                          <span className="volume-slider-name">Original Volume</span>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={reelOriginalVolume}
                            onChange={(e) => setReelOriginalVolume(parseFloat(e.target.value))}
                            className="volume-slider-input"
                          />
                          <span className="volume-slider-val">{Math.round(reelOriginalVolume * 100)}%</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px" }}>
                <button
                  type="button"
                  className="edit-profile-pill-btn"
                  onClick={() => setCreateReelModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="post-pill-submit"
                  disabled={isSubmittingReel || (!newReelFile && !newReelVideoUrl.trim() && !newReelPreview)}
                  onClick={handlePublishReel}
                >
                  {isSubmittingReel ? "Posting..." : "🚀 Publish Reel"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: REEL COMMENTS DRAWER
          ===================================================================== */}
      {reelCommentsModalOpen && (
        <div className="modal-overlay-nesty" onClick={() => setReelCommentsModalOpen(false)}>
          <div className="modal-card-nesty reels-comments-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-nesty">
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span>💬</span>
                <h3 className="modal-title-nesty">Comments ({activeReelComments.length})</h3>
              </div>
              <button
                className="edit-profile-pill-btn"
                style={{ padding: "4px 8px" }}
                onClick={() => setReelCommentsModalOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body-nesty" style={{ display: "flex", flexDirection: "column", height: "360px" }}>
              <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px", paddingRight: "4px" }}>
                {activeReelComments.length === 0 ? (
                  <div style={{ textAlign: "center", color: "var(--text-muted)", marginTop: "40px" }}>
                    No comments yet. Be the first to comment!
                  </div>
                ) : (
                  activeReelComments.map((c) => (
                    <div key={c.id} style={{ display: "flex", gap: "10px", alignItems: "flex-start", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                      <div className="avatar-with-dot" style={{ width: "32px", height: "32px", fontSize: "12px", flexShrink: 0 }}>
                        {c.user.charAt(0).toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontWeight: 700, fontSize: "13px", color: "var(--text-h)" }}>@{c.user}</span>
                          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{c.time}</span>
                        </div>
                        <p style={{ margin: "2px 0 0 0", fontSize: "13px", color: "var(--text)" }}>{c.text}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div style={{ display: "flex", gap: "8px", paddingTop: "12px", borderTop: "1px solid var(--border)" }}>
                <input
                  type="text"
                  className="nesty-input-field"
                  placeholder="Add a comment..."
                  value={newReelComment}
                  onChange={(e) => setNewReelComment(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleAddReelComment();
                    }
                  }}
                  style={{ flex: 1, padding: "8px 12px", fontSize: "13px" }}
                />
                <button
                  type="button"
                  className="post-pill-submit"
                  disabled={!newReelComment.trim()}
                  onClick={handleAddReelComment}
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: LIVE BROADCAST STUDIO (GO LIVE)
          ===================================================================== */}
      {liveStudioOpen && (
        <div className="live-broadcast-overlay">
          <div className="live-broadcast-container">
            {/* TOP BAR */}
            <div className="live-top-bar">
              <div className="live-top-left">
                <span className="live-pulsing-badge-large">● LIVE</span>
                <div className="live-title-wrap">
                  <input
                    type="text"
                    className="live-studio-title-input"
                    value={liveStreamTitle}
                    onChange={(e) => setLiveStreamTitle(e.target.value)}
                    placeholder="Enter Live Stream Topic..."
                  />
                  <span className="live-channel-badge">Broadcasting to Nesty</span>
                </div>
              </div>

              <div className="live-top-right">
                <div className="live-viewers-pill">
                  <span>👁️</span>
                  <span>{liveStreamViewers} watching</span>
                </div>
                <div className="live-duration-pill">
                  ⏱️ {Math.floor(liveStreamSeconds / 60).toString().padStart(2, "0")}:
                  {(liveStreamSeconds % 60).toString().padStart(2, "0")}
                </div>
                <button
                  type="button"
                  className="live-end-btn"
                  onClick={stopLiveStream}
                  title="End Broadcast"
                >
                  End Stream
                </button>
              </div>
            </div>

            {/* MAIN STAGE */}
            <div className="live-main-stage">
              {/* VIDEO VIEWER */}
              <div className="live-video-box">
                <video
                  ref={liveVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="live-video-element"
                />
                {isLiveVideoOff && (
                  <div className="live-video-off-backdrop">
                    <span style={{ fontSize: "56px" }}>📷</span>
                    <span>Camera is Paused</span>
                  </div>
                )}

                {/* BOTTOM FLOATING CONTROLS OVER VIDEO */}
                <div className="live-floating-controls">
                  <button
                    type="button"
                    className={`live-ctrl-btn ${isLiveMuted ? "muted" : ""}`}
                    onClick={() => {
                      if (liveStreamMediaRef.current) {
                        const tracks = liveStreamMediaRef.current.getAudioTracks();
                        tracks.forEach((t) => (t.enabled = isLiveMuted));
                        setIsLiveMuted(!isLiveMuted);
                      }
                    }}
                    title={isLiveMuted ? "Unmute Mic" : "Mute Mic"}
                  >
                    {isLiveMuted ? "🔇 Unmute" : "🎤 Mute"}
                  </button>

                  <button
                    type="button"
                    className={`live-ctrl-btn ${isLiveVideoOff ? "muted" : ""}`}
                    onClick={() => {
                      if (liveStreamMediaRef.current) {
                        const tracks = liveStreamMediaRef.current.getVideoTracks();
                        tracks.forEach((t) => (t.enabled = isLiveVideoOff));
                        setIsLiveVideoOff(!isLiveVideoOff);
                      }
                    }}
                    title={isLiveVideoOff ? "Turn Camera On" : "Turn Camera Off"}
                  >
                    {isLiveVideoOff ? "📷 Start Video" : "📹 Stop Video"}
                  </button>

                  <button
                    type="button"
                    className="live-ctrl-btn"
                    onClick={async () => {
                      try {
                        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                        if (liveVideoRef.current) {
                          liveVideoRef.current.srcObject = screenStream;
                        }
                        screenStream.getVideoTracks()[0].onended = () => {
                          if (liveStreamMediaRef.current && liveVideoRef.current) {
                            liveVideoRef.current.srcObject = liveStreamMediaRef.current;
                          }
                        };
                      } catch {}
                    }}
                    title="Share Screen with Viewers"
                  >
                    🖥️ Share Screen
                  </button>
                </div>
              </div>

              {/* LIVE CHAT SIDEBAR */}
              <div className="live-chat-panel">
                <div className="live-chat-header">
                  <span>💬 Live Stream Chat</span>
                  <span className="live-chat-badge">{liveChatMessages.length} msgs</span>
                </div>

                <div className="live-chat-messages-scroll">
                  {liveChatMessages.map((msg) => (
                    <div key={msg.id} className="live-chat-bubble">
                      <div className="live-chat-user-line">
                        <span className="live-chat-username">@{msg.user}</span>
                        <span className="live-chat-timestamp">{msg.time}</span>
                      </div>
                      <div className="live-chat-body">{msg.text}</div>
                    </div>
                  ))}
                </div>

                <div className="live-chat-composer">
                  <input
                    type="text"
                    className="live-chat-input"
                    placeholder="Say something live..."
                    value={liveChatInput}
                    onChange={(e) => setLiveChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendLiveChatMessage();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="live-chat-send-btn"
                    onClick={sendLiveChatMessage}
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          FLOATING INCOMING COMMUNITY CALL BANNER
          ===================================================================== */}
      {incomingCommunityCall && !groupCallState && (
        <div className="community-call-banner-top">
          <div className="comm-call-banner-content">
            <span className="comm-call-pulse">🔴</span>
            <div className="comm-call-banner-text">
              <span className="comm-call-channel-tag">#{incomingCommunityCall.channelName}</span>
              <span className="comm-call-sub-text">
                {incomingCommunityCall.callerName} started a Group {incomingCommunityCall.callType === "video" ? "Video" : "Voice"} Call
              </span>
            </div>
          </div>
          <div className="comm-call-banner-btns">
            <button
              type="button"
              className="comm-call-join-btn"
              onClick={() => {
                const call = incomingCommunityCall;
                setIncomingCommunityCall(null);
                joinGroupCall(call.channelId, call.channelName, call.callType);
              }}
            >
              {incomingCommunityCall.callType === "video" ? "📹 Join Video" : "📞 Join Audio"}
            </button>
            <button
              type="button"
              className="comm-call-dismiss-btn"
              onClick={() => setIncomingCommunityCall(null)}
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: GROUP CALL (AUDIO & VIDEO)
          ===================================================================== */}
      {groupCallState && (
        <div className="group-call-overlay">
          <div className="group-call-container">
            {/* HEADER */}
            <div className="group-call-header">
              <div className="group-call-header-info">
                <span className="group-call-badge">
                  {groupCallState.type === "video" ? "📹" : "📞"}
                </span>
                <div>
                  <h3 className="group-call-title">
                    #{groupCallState.channelName} • Group {groupCallState.type === "video" ? "Video" : "Audio"} Call
                  </h3>
                  <span className="group-call-meta">
                    ⏱️ {Math.floor(groupCallDuration / 60).toString().padStart(2, "0")}:
                    {(groupCallDuration % 60).toString().padStart(2, "0")} • {groupCallState.participants.length + 1} connected
                  </span>
                </div>
              </div>

              <button
                type="button"
                className="group-call-leave-btn"
                onClick={leaveGroupCall}
                title="Leave Group Call"
              >
                Leave Call
              </button>
            </div>

            {/* CALL PARTICIPANTS GRID */}
            <div className={`group-call-grid count-${groupCallState.participants.length + 1}`}>
              {/* LOCAL PARTICIPANT TILE */}
              <div className="group-call-tile local-tile">
                {groupCallState.type === "video" && !groupCallState.isVideoOff ? (
                  <video
                    ref={groupLocalVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="group-call-video-feed"
                  />
                ) : (
                  <div className="group-call-avatar-placeholder">
                    <div className="group-call-avatar-circle">
                      {user?.avatar_url ? (
                        <img src={user.avatar_url} alt="" />
                      ) : (
                        (user?.username || "You").charAt(0).toUpperCase()
                      )}
                    </div>
                  </div>
                )}
                <div className="group-call-tile-overlay">
                  <span className="group-participant-name">You {groupCallState.isScreenSharing ? "(Sharing Screen)" : ""}</span>
                  {groupCallState.isMuted && <span className="group-tile-muted">🔇</span>}
                </div>
              </div>

              {/* REMOTE PARTICIPANTS TILES */}
              {groupCallState.participants.map((p, idx) => (
                <div key={p.id || idx} className="group-call-tile remote-tile">
                  {p.stream && groupCallState.type === "video" ? (
                    <VideoFeed stream={p.stream} isMuted={false} className="group-call-video-feed" />
                  ) : (
                    <div className="group-call-avatar-placeholder">
                      {p.stream && (
                        <audio
                          autoPlay
                          playsInline
                          ref={(el) => {
                            if (el && el.srcObject !== p.stream) el.srcObject = p.stream!;
                          }}
                        />
                      )}
                      <div className="group-call-avatar-circle remote-pulse">
                        {p.avatarUrl ? (
                          <img src={p.avatarUrl} alt="" />
                        ) : (
                          (p.username || "N").charAt(0).toUpperCase()
                        )}
                      </div>
                      <div className="speaking-wave-indicator">
                        <span className="wave-bar bar-1" />
                        <span className="wave-bar bar-2" />
                        <span className="wave-bar bar-3" />
                      </div>
                    </div>
                  )}
                  <div className="group-call-tile-overlay">
                    <span className="group-participant-name">{p.name || `@${p.username}`}</span>
                    <span className="group-tile-tag">Active</span>
                  </div>
                </div>
              ))}
            </div>

            {/* CONTROLS DOCK */}
            <div className="group-call-dock">
              <button
                type="button"
                className={`group-dock-btn ${groupCallState.isMuted ? "active" : ""}`}
                onClick={toggleGroupMute}
                title={groupCallState.isMuted ? "Unmute Mic" : "Mute Mic"}
              >
                <span className="dock-btn-icon">{groupCallState.isMuted ? "🔇" : "🎤"}</span>
                <span className="dock-btn-text">{groupCallState.isMuted ? "Unmute" : "Mute"}</span>
              </button>

              {groupCallState.type === "video" && (
                <button
                  type="button"
                  className={`group-dock-btn ${groupCallState.isVideoOff ? "active" : ""}`}
                  onClick={toggleGroupVideo}
                  title={groupCallState.isVideoOff ? "Turn Camera On" : "Turn Camera Off"}
                >
                  <span className="dock-btn-icon">{groupCallState.isVideoOff ? "📷" : "📹"}</span>
                  <span className="dock-btn-text">{groupCallState.isVideoOff ? "Camera On" : "Camera Off"}</span>
                </button>
              )}

              <button
                type="button"
                className={`group-dock-btn ${groupCallState.isScreenSharing ? "active" : ""}`}
                onClick={toggleGroupScreenShare}
                title="Share Screen"
              >
                <span className="dock-btn-icon">🖥️</span>
                <span className="dock-btn-text">{groupCallState.isScreenSharing ? "Stop Share" : "Share Screen"}</span>
              </button>

              <button
                type="button"
                className="group-dock-btn end-call-btn"
                onClick={leaveGroupCall}
                title="Leave Call"
              >
                <span className="dock-btn-icon">🛑</span>
                <span className="dock-btn-text">Leave</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MUSIC PICKER MODAL FOR POSTS */}
      <MusicPicker
        isOpen={postMusicPickerOpen}
        onClose={() => setPostMusicPickerOpen(false)}
        onSelectTrack={(track) => setSelectedPostMusic(track)}
        onRemoveMusic={() => setSelectedPostMusic(null)}
        selectedTrackId={selectedPostMusic?.id}
        apiUrl={API_URL}
      />

      {/* MUSIC PICKER MODAL FOR REELS */}
      <MusicPicker
        isOpen={reelMusicPickerOpen}
        onClose={() => setReelMusicPickerOpen(false)}
        onSelectTrack={(track) => setSelectedReelMusic(track)}
        onRemoveMusic={() => setSelectedReelMusic(null)}
        selectedTrackId={selectedReelMusic?.id}
        apiUrl={API_URL}
      />
    </div>
  );
}