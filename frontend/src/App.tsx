import { useState, useEffect } from "react";
import { timeAgo } from "./utils/timeAgo";
import "./App.css";

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

type Notification = {
  id: number;
  user_id: number;
  actor_id: number;
  actor?: User;
  type: "like" | "comment" | "follow" | "mention" | "repost";
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
  const [communityStats, setCommunityStats] = useState<{
    member_count: number;
    online_users: Array<{ id?: number; username: string; name?: string; avatar_url?: string; status?: string }>;
  }>({
    member_count: 128,
    online_users: [
      { username: "Jaytricks", name: "Jaytricks", status: "Working on DevNest" },
      { username: "piscine_builder", name: "piscine_builder", status: "Building something great" },
      { username: "codewith_ella", name: "codewith_ella", status: "Learning Go" },
      { username: "devking", name: "devking", status: "Just chatting" },
    ],
  });

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
  const [profileForm, setProfileForm] = useState({
    username: "",
    bio: "",
    skills: "",
    location: "",
  });

  // -----------------------------
  // FOLLOWERS MODAL
  // -----------------------------
  const [followListModal, setFollowListModal] = useState<{ type: "followers" | "following"; userId: number } | null>(null);
  const [followListUsers, setFollowListUsers] = useState<FollowListUser[]>([]);
  const [followListLoading, setFollowListLoading] = useState(false);

  // -----------------------------
  // FETCH NOTIFICATIONS
  // -----------------------------
  const fetchNotifications = async () => {
    if (!token) return;
    try {
      const res = await fetch("http://localhost:8080/api/notifications", {
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

  useEffect(() => {
    if (!token) return;
    fetchNotifications();
  }, [token]);

  // -----------------------------
  // WEBSOCKET FOR NOTIFICATIONS
  // -----------------------------
  useEffect(() => {
    if (!token || !user) return;
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsHost = window.location.hostname || "localhost";
    const ws = new WebSocket(`${wsProtocol}//${wsHost}:8080/ws?token=${token}`);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event === "notification" && data.notification) {
          setNotifications((prev) => [data.notification, ...prev]);
          setUnreadCount((prev) => prev + 1);
        }
      } catch (err) {
        console.error("Failed to parse WS message", err);
      }
    };

    return () => {
      ws.close();
    };
  }, [token, user?.id]);

  // -----------------------------
  // FETCH COMMUNITY STATS
  // -----------------------------
  useEffect(() => {
    if (!token) return;
    fetch("http://localhost:8080/api/community/stats", {
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
  const fetchMe = async (jwt: string) => {
    try {
      const res = await fetch("http://localhost:8080/api/me", {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data);
      } else {
        localStorage.removeItem("token");
        setToken(null);
      }
    } catch {
      localStorage.removeItem("token");
      setToken(null);
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
        `http://localhost:8080/api/posts?page=${pageNum}&limit=15${commParam}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (res.ok) {
        const data: Post[] = await res.json();

        // Baseline reference posts matching the user screenshots
        let fetchedPosts = data || [];
        if (pageNum === 1 && fetchedPosts.length === 0) {
          fetchedPosts = [
            {
              id: 9001,
              content: "Hello Piscine community! DevNest is alive and kicking!",
              likes: 12,
              created_at: new Date(Date.now() - 39 * 60000).toISOString(),
              user: {
                id: 101,
                username: "piscine_builder",
                name: "piscine_builder",
                email: "builder@piscine.dev",
              },
              comments: [
                { id: 1, post_id: 9001, content: "Looking amazing! Can't wait to test it.", created_at: new Date().toISOString(), user: { id: 102, username: "devking", email: "" } }
              ],
            },
            {
              id: 9002,
              content: "We have set a new milestone today!",
              likes: 28,
              created_at: new Date(Date.now() - 60 * 60000).toISOString(),
              media_url: "photo_placeholder",
              user: {
                id: user?.id || 1,
                username: user?.username || "Jaytricks",
                name: user?.name || "Jaytricks",
                email: user?.email || "jay@devnest.org",
              },
              comments: [
                { id: 2, post_id: 9002, content: "Congrats team DevNest!", created_at: new Date().toISOString(), user: { id: 103, username: "codewith_ella", email: "" } }
              ],
            },
            {
              id: 9003,
              content: "Just diving deep into Go channels and WebSockets. The concurrency model is fantastic!",
              likes: 19,
              created_at: new Date(Date.now() - 180 * 60000).toISOString(),
              user: {
                id: 104,
                username: "devking",
                name: "devking",
                email: "devking@devnest.org",
              },
              comments: [],
            },
          ];
        }

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
        const res = await fetch(`http://localhost:8080/api/users/search?q=${encodeURIComponent(searchQuery)}`, {
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
      await fetch(`http://localhost:8080/api/notifications/${id}/read`, {
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
      await fetch("http://localhost:8080/api/notifications/read-all", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      console.error("Failed to mark all notifications read", err);
    }
  };

  const notificationText = (n: Notification) => {
    const name = n.actor?.username || "Someone";
    if (n.type === "like") return `${name} liked your post`;
    if (n.type === "comment") return `${name} commented on your post`;
    if (n.type === "follow") return `${name} started following you`;
    if (n.type === "mention") return `${name} mentioned you in a post`;
    if (n.type === "repost") return `${name} reposted your post`;
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

        const uploadRes = await fetch("http://localhost:8080/api/upload", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });

        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          uploadedUrl = uploadData.url;
        }
      }

      const res = await fetch("http://localhost:8080/api/posts", {
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
      const res = await fetch(`http://localhost:8080/api/posts/${postId}/like`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setPosts((prev) =>
          prev.map((p) => (p.id === postId ? { ...p, likes: data.likes, liked_by_me: data.liked } : p))
        );
      }
    } catch (err) {
      console.error("Like error", err);
    }
  };

  const deletePost = async (id: number) => {
    if (!confirm("Are you sure you want to delete this post?")) return;
    try {
      const res = await fetch(`http://localhost:8080/api/posts/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setPosts((prev) => prev.filter((p) => p.id !== id));
      }
    } catch (err) {
      console.error("Delete error", err);
    }
  };

  const handleAddComment = async (postId: number) => {
    const text = commentInputs[postId];
    if (!text || !text.trim()) return;

    try {
      const res = await fetch(`http://localhost:8080/api/posts/${postId}/comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content: text }),
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
        setCommentInputs((prev) => ({ ...prev, [postId]: "" }));
      }
    } catch (err) {
      console.error("Add comment error", err);
    }
  };

  // -----------------------------
  // PROFILE VIEW LOGIC
  // -----------------------------
  const openProfile = (userId: number) => {
    setViewedUserId(userId);
    setPage("profile");
    setMobileMenuOpen(false);
  };

  const fetchProfile = async (userId: number) => {
    try {
      const [profileRes, postsRes] = await Promise.all([
        fetch(`http://localhost:8080/api/users/${userId}/profile`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`http://localhost:8080/api/users/${userId}/posts?page=1&limit=30`, {
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

  const toggleFollow = async () => {
    if (!profileData || profileData.is_self) return;
    setFollowBusy(true);
    const targetId = profileData.user.id;
    try {
      const res = await fetch(`http://localhost:8080/api/users/${targetId}/follow`, {
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
    fetch(`http://localhost:8080/api/users/${followListModal.userId}/${followListModal.type}`, {
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
    try {
      const res = await fetch("http://localhost:8080/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem("token", data.token);
        setToken(data.token);
        fetchMe(data.token);
      } else {
        alert(data.error || "Login failed");
      }
    } catch {
      alert("Cannot connect to server at http://localhost:8080");
    }
  };

  const handleRegister = async () => {
    try {
      const res = await fetch("http://localhost:8080/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, username }),
      });
      const data = await res.json();
      if (res.ok) {
        alert("Registration successful! Please log in.");
        setAuthMode("login");
      } else {
        alert(data.error || "Registration failed");
      }
    } catch {
      alert("Cannot connect to server at http://localhost:8080");
    }
  };

  const handleForgotPassword = async () => {
    if (password !== confirmPassword) {
      alert("Passwords do not match");
      return;
    }
    try {
      const res = await fetch("http://localhost:8080/api/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, new_password: password }),
      });
      const data = await res.json();
      if (res.ok) {
        alert("Password updated successfully! You can now log in.");
        setAuthMode("login");
      } else {
        alert(data.error || "Reset failed");
      }
    } catch {
      alert("Cannot connect to server at http://localhost:8080");
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
              fetch(`http://localhost:8080/api/users/by-username/${cleanUsername}`, {
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
          <div className="auth-brand-logo-empty" />
          <h1 className="auth-title">Nesty</h1>
          <p className="auth-subtitle">
            {authMode === "login"
              ? "A space for Piscine candidates to build, learn and grow"
              : authMode === "register"
              ? "Create your developer profile"
              : "Reset your account password"}
          </p>

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
                <button className="auth-link-btn" onClick={() => setAuthMode("register")}>
                  Sign Up
                </button>
                <span>·</span>
                <button className="auth-link-btn" onClick={() => setAuthMode("forgot")}>
                  Forgot Password?
                </button>
              </>
            ) : (
              <>
                <span>Already have an account?</span>
                <button className="auth-link-btn" onClick={() => setAuthMode("login")}>
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
        <button className="hamburger-btn" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
          ☰
        </button>
        <div className="mobile-bar-title" onClick={() => { setPage("feed"); setSelectedCommunity("general"); }}>
          Nesty
        </div>
      </div>

      {/* =====================================================================
          1. LEFT COLUMN: NAVIGATION SIDEBAR (FOREST SLATE THEME)
          ===================================================================== */}
      <aside className={`nesty-sidebar-left ${mobileMenuOpen ? "open-drawer" : ""}`}>
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
          <div className="brand-logo-empty" title="Nesty" />
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
            onClick={() => {
              if (user?.id) openProfile(user.id);
              else setPage("profile");
            }}
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
            onClick={() => user?.id && openProfile(user.id)}
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
            <span
              className="user-card-settings"
              title="Logout"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm("Do you want to log out?")) {
                  localStorage.removeItem("token");
                  setToken(null);
                  setUser(null);
                }
              }}
            >
              ⚙️
            </span>
          </div>
        </div>
      </aside>

      {/* NOTIFICATIONS FLYOUT */}
      {notifOpen && (
        <div className="notifications-flyout">
          <div className="notif-header">
            <b>Notifications</b>
            {unreadCount > 0 && (
              <button
                className="edit-profile-pill-btn"
                style={{ padding: "4px 10px", fontSize: "12px" }}
                onClick={markAllNotificationsRead}
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="notif-list-container">
            {notifications.length === 0 ? (
              <div style={{ padding: "16px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
                No notifications yet.
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`notif-row-item ${n.read ? "" : "unread"}`}
                  onClick={() => {
                    markNotificationRead(n.id);
                    if (n.actor_id) openProfile(n.actor_id);
                  }}
                >
                  <div className="search-avatar-mini">
                    {n.actor?.avatar_url ? (
                      <img src={n.actor.avatar_url} alt="" />
                    ) : (
                      (n.actor?.username || "?").charAt(0).toUpperCase()
                    )}
                  </div>
                  <div style={{ flex: 1, fontSize: "13px" }}>
                    <div>{notificationText(n)}</div>
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                      {timeAgo(n.created_at)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          2. CENTER COLUMN: COMMUNITY FEED / PROFILE / CREATE POST
          ===================================================================== */}
      <main className="nesty-center-feed">
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
              <span>{communityStats.member_count} members</span>
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
                        onClick={() => {
                          if (navigator.share) {
                            navigator.share({ title: "Nesty Post", text: post.content, url: window.location.href });
                          } else {
                            navigator.clipboard.writeText(window.location.href);
                            alert("Post link copied to clipboard!");
                          }
                        }}
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
                            <div className="comment-avatar">
                              {c.user?.avatar_url ? (
                                <img src={c.user.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                              ) : (
                                (c.user?.username || "?").charAt(0).toUpperCase()
                              )}
                            </div>
                            <div className="comment-bubble">
                              <span className="comment-author-name">@{c.user?.username || "builder"}</span>
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

        {/* VIEW 2: PROFILE PAGE (MATCHING SCREENSHOT 2) */}
        {page === "profile" && (
          <div className="profile-view-wrapper">
            <div className="profile-card-nesty">
              {/* MINT COVER BANNER */}
              <div
                className="profile-cover-mint"
                style={
                  profileData?.user.banner_url
                    ? { backgroundImage: `url(${profileData.user.banner_url})` }
                    : undefined
                }
              >
                {/* OVERLAPPING AVATAR */}
                <div className="profile-avatar-big">
                  {profileData?.user.avatar_url ? (
                    <img src={profileData.user.avatar_url} alt="" />
                  ) : (
                    (profileData?.user.username || user?.username || "J").charAt(0).toUpperCase()
                  )}
                </div>
              </div>

              <div className="profile-details-section">
                <div className="profile-edit-btn-wrap">
                  {profileData?.is_self || (!profileData && viewedUserId === user?.id) ? (
                    <button
                      className="edit-profile-pill-btn"
                      onClick={() => {
                        setProfileForm({
                          username: profileData?.user.username || user?.username || "",
                          bio: profileData?.user.bio || user?.bio || "Aspiring Full-Stack Engineer",
                          skills: profileData?.user.skills || user?.skills || "Go, React, TypeScript",
                          location: profileData?.user.location || user?.location || "Otukpo, Nigeria",
                        });
                        setEditingProfile(true);
                      }}
                    >
                      Edit Profile
                    </button>
                  ) : (
                    <button
                      className="post-pill-submit"
                      disabled={followBusy}
                      onClick={toggleFollow}
                    >
                      {followBusy ? "..." : profileData?.is_following ? "Following" : "Follow"}
                    </button>
                  )}
                </div>

                <h2 className="profile-user-name">
                  {profileData?.user.name || profileData?.user.username || user?.name || user?.username || "Jaytricks"}
                </h2>
                <div className="profile-user-handle">
                  @{profileData?.user.username || user?.username || "jaytricks"}
                </div>

                <div className="profile-bio-text">
                  {profileData?.user.bio || user?.bio || "Aspiring Full-Stack Engineer"}
                </div>

                <div className="profile-location-text">
                  <span>📍</span>
                  <span>{profileData?.user.location || user?.location || "Otukpo, Nigeria"}</span>
                </div>

                {/* STATS ROW */}
                <div className="profile-stats-row">
                  <div className="stat-item">
                    <b>{profileData?.post_count ?? 23}</b> Posts
                  </div>
                  <div
                    className="stat-item"
                    style={{ cursor: "pointer" }}
                    onClick={() => {
                      if (profileData?.user.id) {
                        setFollowListModal({ type: "followers", userId: profileData.user.id });
                      }
                    }}
                  >
                    <b>{profileData?.follower_count ?? 1}</b> Followers
                  </div>
                  <div
                    className="stat-item"
                    style={{ cursor: "pointer" }}
                    onClick={() => {
                      if (profileData?.user.id) {
                        setFollowListModal({ type: "following", userId: profileData.user.id });
                      }
                    }}
                  >
                    <b>{profileData?.following_count ?? 1}</b> Following
                  </div>
                </div>
              </div>
            </div>

            {/* USER POSTS FEED TIMELINE */}
            <div className="nesty-posts-feed">
              {(profilePosts.length > 0 ? profilePosts : posts).map(
                (post) => {
                  const displayName = post.user?.name || post.user?.username || "Jaytricks";
                  const handle = post.user?.username || "jaytricks";

                  return (
                    <article key={post.id} className="post-card-nesty">
                      <div className="post-header-nesty">
                        <div className="avatar-with-dot" style={{ width: "42px", height: "42px" }}>
                          {post.user?.avatar_url ? (
                            <img src={post.user.avatar_url} alt="" />
                          ) : (
                            handle.charAt(0).toUpperCase()
                          )}
                          <span className="online-dot" />
                        </div>
                        <div className="post-header-author-info">
                          <span className="author-display-name">{displayName}</span>
                          <span className="verified-dot-green" />
                          <span className="author-handle">@{handle}</span>
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
                        <button className="action-pill-btn" onClick={() => handleLike(post.id)}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                          </svg>
                          <span>{post.likes || 28}</span>
                        </button>
                        <button className="action-pill-btn">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                          </svg>
                          <span>{post.comments?.length || 6}</span>
                        </button>
                        <button className="action-pill-btn">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="7" y1="17" x2="17" y2="7" />
                            <polyline points="7 7 17 7 17 17" />
                          </svg>
                        </button>
                      </div>
                    </article>
                  );
                }
              )}
            </div>
          </div>
        )}

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
      </main>

      {/* =====================================================================
          3. RIGHT COLUMN: WIDGETS SIDEBAR (NESTY CARD, FEATURED, ONLINE NOW)
          ===================================================================== */}
      <aside className="nesty-sidebar-right">
        {/* CARD 1: NESTY COMMUNITY CARD (FOREST GREEN) */}
        <div className="nesty-community-widget">
          {/* Logo container left blank per instruction: "leave the logo blank until I come up with one." */}
          <div className="community-widget-logo-empty" title="Nesty" />
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
            <span>{communityStats.member_count} members</span>
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
              onClick={() => alert("Showing all active Nesters")}
            >
              See all
            </span>
          </div>

          <div className="online-users-list">
            {communityStats.online_users.map((u, i) => {
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
                  <div className="online-user-info">
                    <span className="online-user-name">{u.name || u.username}</span>
                    <span className="online-user-status">{u.status || "Building something great"}</span>
                  </div>
                </div>
              );
            })}
          </div>
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
          <div className="modal-content-card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: "14px", color: "var(--text-h)" }}>Edit Profile</h3>

            <label style={{ fontSize: "12px", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>
              Name / Username
            </label>
            <input
              className="auth-input"
              value={profileForm.username}
              onChange={(e) => setProfileForm({ ...profileForm, username: e.target.value })}
              style={{ marginBottom: "12px" }}
            />

            <label style={{ fontSize: "12px", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>
              Bio
            </label>
            <input
              className="auth-input"
              value={profileForm.bio}
              onChange={(e) => setProfileForm({ ...profileForm, bio: e.target.value })}
              style={{ marginBottom: "12px" }}
            />

            <label style={{ fontSize: "12px", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>
              Location
            </label>
            <input
              className="auth-input"
              value={profileForm.location}
              onChange={(e) => setProfileForm({ ...profileForm, location: e.target.value })}
              style={{ marginBottom: "16px" }}
            />

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button className="edit-profile-pill-btn" onClick={() => setEditingProfile(false)}>
                Cancel
              </button>
              <button
                className="post-pill-submit"
                onClick={async () => {
                  try {
                    const res = await fetch(`http://localhost:8080/api/users/${user?.id}`, {
                      method: "PUT",
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                      },
                      body: JSON.stringify({
                        name: profileForm.username,
                        bio: profileForm.bio,
                        location: profileForm.location,
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
                Save
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
                    const res = await fetch(`http://localhost:8080/api/posts/${editingPost.id}`, {
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