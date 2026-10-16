import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";

export interface ReelTrack {
  id?: number | string;
  title: string;
  artist: string;
  audio_url: string;
  cover_url?: string | null;
  duration_sec?: number;
  source?: string;
}

export interface ReelAuthor {
  id: number;
  username: string;
  name?: string;
  avatar_url?: string;
}

export interface ReelItem {
  id: number | string;
  user_id?: number;
  userId?: number;
  user?: ReelAuthor;
  username?: string;
  name?: string;
  avatarUrl?: string;
  video_url?: string;
  videoUrl?: string;
  caption?: string;
  likes?: number;
  liked_by_me?: boolean;
  likedByMe?: boolean;
  comments_count?: number;
  commentsCount?: number;
  music_track_id?: number | null;
  music_track?: ReelTrack | null;
  music_source?: string;
  music_url?: string;
  music_title?: string;
  music_artist?: string;
  music_start_sec?: number;
  mute_original?: boolean;
  music_volume?: number;
  original_volume?: number;
  audioTitle?: string;
  created_at?: string;
}

interface ReelsViewProps {
  apiUrl?: string;
  token?: string;
  currentUserId?: number;
  onNavigate: (path: string) => void;
  onOpenProfile: (userId: number) => void;
}

export const ReelsView: React.FC<ReelsViewProps> = ({
  apiUrl = "",
  token = "",
  currentUserId: _currentUserId,
  onNavigate,
  onOpenProfile,
}) => {
  const [reels, setReels] = useState<ReelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const [userInteracted, setUserInteracted] = useState(false);
  const [pausedMap, setPausedMap] = useState<Record<number, boolean>>({});
  const [pausePulseIndex, setPausePulseIndex] = useState<number | null>(null);

  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const isPullingRef = useRef(false);

  // Comments drawer
  const [activeCommentsReel, setActiveCommentsReel] = useState<ReelItem | null>(null);
  const [commentText, setCommentText] = useState("");
  const [commentsList, setCommentsList] = useState<Array<{ id: number | string; user: string; text: string; time: string }>>([]);

  // Share modal state
  const [shareModalReel, setShareModalReel] = useState<ReelItem | null>(null);
  const [shareTab, setShareTab] = useState<"nesty" | "platforms">("nesty");
  const [nestyUsers, setNestyUsers] = useState<Array<{ id: number; username: string; name?: string; avatar_url?: string }>>([]);
  const [nestyUserSearch, setNestyUserSearch] = useState("");
  const [sentUserIds, setSentUserIds] = useState<Record<number, boolean>>({});
  const [copiedLink, setCopiedLink] = useState(false);

  const filteredNestyUsers = useMemo(() => {
    if (!nestyUserSearch.trim()) return nestyUsers;
    const q = nestyUserSearch.toLowerCase();
    return nestyUsers.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        (u.name && u.name.toLowerCase().includes(q))
    );
  }, [nestyUsers, nestyUserSearch]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRefs = useRef<Map<number, HTMLVideoElement>>(new Map());
  const audioRefs = useRef<Map<number, HTMLAudioElement>>(new Map());

  // Fetch reels from backend
  const fetchReels = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const headers: Record<string, string> = {};
      const authToken = token || localStorage.getItem("token");
      if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }
      const res = await fetch(`${apiUrl}/api/reels?limit=40`, { headers });
      if (!res.ok) {
        throw new Error(`Failed to load reels (HTTP ${res.status})`);
      }
      const data = await res.json();
      const list: ReelItem[] = data.reels || (Array.isArray(data) ? data : []);
      setReels(list);
    } catch (err: any) {
      if (!isRefresh) {
        setError(err.message || "Failed to load reels. Check your connection.");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
      setPullDistance(0);
    }
  }, [apiUrl, token]);

  useEffect(() => {
    fetchReels();
  }, [fetchReels]);

  // Pull-to-refresh touch gesture for mobile
  useEffect(() => {
    let startY = 0;
    let startX = 0;
    let pulling = false;

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      const scrollY = containerRef.current ? containerRef.current.scrollTop : 0;
      if (scrollY <= 2 && activeIndex === 0 && !refreshing) {
        startY = touch.clientY;
        startX = touch.clientX;
        pulling = true;
        isPullingRef.current = true;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!pulling || refreshing) return;
      const touch = e.touches[0];
      const diffY = touch.clientY - startY;
      const diffX = Math.abs(touch.clientX - startX);
      const scrollY = containerRef.current ? containerRef.current.scrollTop : 0;

      if (diffY > 0 && diffY > diffX && scrollY <= 2) {
        const dist = Math.min(diffY * 0.45, 75);
        setPullDistance(dist);
        if (e.cancelable && diffY > 10) {
          e.preventDefault();
        }
      } else if (diffY < 0) {
        pulling = false;
        isPullingRef.current = false;
        setPullDistance(0);
      }
    };

    const onTouchEnd = () => {
      if (!pulling) return;
      pulling = false;
      isPullingRef.current = false;
      setPullDistance((curr) => {
        if (curr >= 45) {
          fetchReels(true);
          return 50;
        }
        return 0;
      });
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener("touchstart", onTouchStart, { passive: true });
      container.addEventListener("touchmove", onTouchMove, { passive: false });
      container.addEventListener("touchend", onTouchEnd, { passive: true });
    }
    return () => {
      if (container) {
        container.removeEventListener("touchstart", onTouchStart);
        container.removeEventListener("touchmove", onTouchMove);
        container.removeEventListener("touchend", onTouchEnd);
      }
    };
  }, [activeIndex, refreshing, fetchReels]);

  // Sync scroll snap to active index
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, clientHeight } = containerRef.current;
    if (clientHeight <= 0) return;
    const newIdx = Math.round(scrollTop / clientHeight);
    if (newIdx !== activeIndex && newIdx >= 0 && newIdx < reels.length) {
      setActiveIndex(newIdx);
    }
  };

  // Keyboard navigation (Up/Down arrow, Space for play/pause, M for mute)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        scrollToIndex(activeIndex + 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        scrollToIndex(activeIndex - 1);
      } else if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        togglePlayPause(activeIndex);
      } else if (e.key.toLowerCase() === "m") {
        e.preventDefault();
        toggleMute();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeIndex, reels.length, isMuted]);

  const scrollToIndex = (idx: number) => {
    if (idx < 0 || idx >= reels.length || !containerRef.current) return;
    const targetY = idx * containerRef.current.clientHeight;
    containerRef.current.scrollTo({ top: targetY, behavior: "smooth" });
    setActiveIndex(idx);
  };

  const toggleMute = () => {
    setUserInteracted(true);
    setIsMuted((prev) => !prev);
  };

  const togglePlayPause = (idx: number) => {
    setUserInteracted(true);
    const vid = videoRefs.current.get(idx);
    const aud = audioRefs.current.get(idx);
    if (!vid) return;

    if (vid.paused) {
      vid.play().catch(() => {});
      if (aud) {
        aud.currentTime = (reels[idx]?.music_start_sec || 0) + vid.currentTime;
        aud.play().catch(() => {});
      }
      setPausedMap((prev) => ({ ...prev, [idx]: false }));
    } else {
      vid.pause();
      if (aud) aud.pause();
      setPausedMap((prev) => ({ ...prev, [idx]: true }));
    }

    setPausePulseIndex(idx);
    setTimeout(() => setPausePulseIndex(null), 500);
  };

  // Autoplay the active reel and pause all others
  useEffect(() => {
    if (reels.length === 0) return;

    reels.forEach((r, idx) => {
      const vid = videoRefs.current.get(idx);
      const aud = audioRefs.current.get(idx);

      if (idx === activeIndex) {
        if (vid) {
          vid.currentTime = 0;
          const origVol = r.original_volume != null ? r.original_volume : 1;
          vid.volume = origVol;
          vid.muted = isMuted || !!r.mute_original || origVol === 0;

          vid.play().catch((err) => {
            console.warn("Autoplay was prevented:", err);
          });
        }

        if (aud) {
          const musicVol = r.music_volume != null ? r.music_volume : 1;
          aud.currentTime = r.music_start_sec || 0;
          aud.volume = musicVol;
          aud.muted = isMuted || musicVol === 0;
          aud.play().catch(() => {});
        }
        setPausedMap((prev) => ({ ...prev, [idx]: false }));
      } else {
        if (vid) {
          vid.pause();
          vid.currentTime = 0;
        }
        if (aud) {
          aud.pause();
          aud.currentTime = 0;
        }
      }
    });
  }, [activeIndex, reels, isMuted]);

  // Synchronize audio with video time updates
  const handleVideoTimeUpdate = (idx: number) => {
    if (idx !== activeIndex) return;
    const vid = videoRefs.current.get(idx);
    const aud = audioRefs.current.get(idx);
    const r = reels[idx];
    if (vid && aud && r) {
      const targetOffset = (r.music_start_sec || 0) + vid.currentTime;
      if (Math.abs(aud.currentTime - targetOffset) > 0.4) {
        aud.currentTime = targetOffset;
      }
    }
  };

  // Like toggle
  const toggleLike = async (idx: number) => {
    const r = reels[idx];
    if (!r) return;
    const newLiked = !r.liked_by_me && !r.likedByMe;
    const countDiff = newLiked ? 1 : -1;

    setReels((prev) =>
      prev.map((item, i) =>
        i === idx
          ? {
              ...item,
              liked_by_me: newLiked,
              likedByMe: newLiked,
              likes: Math.max(0, (item.likes || 0) + countDiff),
            }
          : item
      )
    );

    try {
      const authToken = token || localStorage.getItem("token");
      await fetch(`${apiUrl}/api/reels/${r.id}/like`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
      });
    } catch {}
  };

  // Comments fetching
  useEffect(() => {
    if (!activeCommentsReel) {
      setCommentsList([]);
      setCommentText("");
      return;
    }
    const fetchComments = async () => {
      try {
        const authToken = token || localStorage.getItem("token");
        const headers: Record<string, string> = {};
        if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
        const res = await fetch(`${apiUrl}/api/reels/${activeCommentsReel.id}/comments`, { headers });
        if (res.ok) {
          const data = await res.json();
          const list = Array.isArray(data) ? data : data.comments || [];
          setCommentsList(list.map((c: any) => ({
            id: c.id,
            user: c.user?.username || c.username || "User",
            text: c.content || c.text || "",
            time: "Recently",
          })));
        }
      } catch {}
    };
    fetchComments();
  }, [activeCommentsReel, apiUrl, token]);

  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim() || !activeCommentsReel) return;
    const text = commentText.trim();
    const tempComment = {
      id: Date.now(),
      user: "you",
      text,
      time: "Just now",
    };
    setCommentsList((prev) => [...prev, tempComment]);
    setCommentText("");

    // Optimistically update commentsCount on active reel
    setReels((prev) =>
      prev.map((r) =>
        r.id === activeCommentsReel.id
          ? { ...r, comments_count: (r.comments_count || r.commentsCount || 0) + 1 }
          : r
      )
    );

    try {
      const authToken = token || localStorage.getItem("token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
      await fetch(`${apiUrl}/api/reels/${activeCommentsReel.id}/comments`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: text, text }),
      });
    } catch {}
  };

  // Share: fetch users
  useEffect(() => {
    if (!shareModalReel) return;
    const fetchShareUsers = async () => {
      try {
        const authToken = token || localStorage.getItem("token");
        const headers: Record<string, string> = {};
        if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
        const res = await fetch(`${apiUrl}/api/users`, { headers });
        if (res.ok) {
          const data = await res.json();
          const list = Array.isArray(data) ? data : data.users || [];
          setNestyUsers(list.slice(0, 30));
        }
      } catch {}
    };
    fetchShareUsers();
  }, [shareModalReel, apiUrl, token]);

  const handleSendToNestyUser = async (targetUser: { id: number; username: string }) => {
    if (!shareModalReel) return;
    try {
      const authToken = token || localStorage.getItem("token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
      const reelUrl = `${window.location.origin}/reels`;
      const caption = shareModalReel.caption ? ` "${shareModalReel.caption}"` : "";
      const msgText = `🎬 Check out this reel by @${getAuthorHandle(shareModalReel)}${caption}: ${reelUrl}`;
      await fetch(`${apiUrl}/api/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          partner_id: targetUser.id,
          text: msgText,
        }),
      });
      setSentUserIds((prev) => ({ ...prev, [targetUser.id]: true }));
    } catch {
      navigator.clipboard?.writeText(`${window.location.origin}/reels`);
      setSentUserIds((prev) => ({ ...prev, [targetUser.id]: true }));
    }
  };

  const handleCopyLink = () => {
    const url = `${window.location.origin}/reels`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url);
    }
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleShareExternal = (platform: "whatsapp" | "twitter" | "telegram" | "linkedin" | "facebook" | "system") => {
    const url = `${window.location.origin}/reels`;
    const author = shareModalReel ? `${getAuthorName(shareModalReel)} (@${getAuthorHandle(shareModalReel)})` : "Nesty";
    const title = `Watch ${author}'s reel on Nesty!`;
    const text = shareModalReel?.caption ? `${shareModalReel.caption} — ${title}` : title;

    if (platform === "system") {
      if (navigator.share) {
        navigator.share({ title, text, url }).catch(() => {});
        return;
      }
      handleCopyLink();
      return;
    }

    let shareUrl = "";
    if (platform === "whatsapp") {
      shareUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(text + " " + url)}`;
    } else if (platform === "twitter") {
      shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    } else if (platform === "telegram") {
      shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
    } else if (platform === "facebook") {
      shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
    } else if (platform === "linkedin") {
      shareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
    }

    if (shareUrl) {
      window.open(shareUrl, "_blank", "noopener,noreferrer");
    }
  };

  const handleHeaderRefresh = () => {
    fetchReels(true);
    if (containerRef.current) {
      containerRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
    setActiveIndex(0);
  };

  const getAuthorName = (r: ReelItem): string => {
    return r.user?.name || r.name || r.user?.username || r.username || "Nesty Creator";
  };

  const getAuthorHandle = (r: ReelItem): string => {
    return r.user?.username || r.username || "creator";
  };

  const getAuthorAvatar = (r: ReelItem): string => {
    return r.user?.avatar_url || r.avatarUrl || "";
  };

  const getAuthorId = (r: ReelItem): number | undefined => {
    return r.user?.id || r.user_id || r.userId;
  };

  const getSoundtrackTitle = (r: ReelItem): string => {
    if (r.music_title) {
      return `${r.music_title}${r.music_artist ? ` – ${r.music_artist}` : ""}`;
    }
    if (r.music_track) {
      return `${r.music_track.title} – ${r.music_track.artist}`;
    }
    if (r.audioTitle) {
      return r.audioTitle;
    }
    return `Original Audio • @${getAuthorHandle(r)}`;
  };

  const getMusicAudioUrl = (r: ReelItem): string | null => {
    return r.music_url || r.music_track?.audio_url || null;
  };

  return (
    <div className="reels-dedicated-page">
      {/* Top Floating Navigation Header */}
      <header className="reels-page-header">
        <button
          type="button"
          className="reels-header-back-btn"
          onClick={() => onNavigate("/")}
          title="Back to Home Feed"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span className="reels-header-back-text">Home</span>
        </button>

        <div className="reels-header-title-badge">
          <span className="reels-header-icon">🎬</span>
          <span className="reels-header-text">Reels</span>
        </div>

        <div className="reels-header-right-actions">
          {/* Refresh Button */}
          <button
            type="button"
            className={`reels-header-refresh-btn ${refreshing ? "spinning" : ""}`}
            onClick={handleHeaderRefresh}
            disabled={refreshing || loading}
            title="Refresh reels and go to top"
            aria-label="Refresh reels"
          >
            <span
              className={refreshing ? "reels-spin-anim" : ""}
              style={{ display: "inline-block", fontSize: "16px" }}
            >
              ↻
            </span>
          </button>

          <button
            type="button"
            className="reels-header-sound-btn"
            onClick={toggleMute}
            title={isMuted ? "Tap to Unmute" : "Mute Sound"}
          >
            {isMuted ? "🔇" : "🔊"}
          </button>

          <button
            type="button"
            className="reels-header-create-btn"
            onClick={() => onNavigate("/reels/create")}
            title="Create a new reel"
          >
            <span style={{ fontSize: "16px", fontWeight: "bold" }}>+</span>
            <span>Create</span>
          </button>
        </div>
      </header>

      {/* Pull-To-Refresh Indicator Banner */}
      {(pullDistance > 0 || refreshing) && (
        <div
          className="reels-pull-indicator"
          style={{
            top: `${60 + (refreshing ? 18 : pullDistance)}px`,
            opacity: refreshing || pullDistance > 10 ? 1 : 0,
          }}
        >
          <span
            className={refreshing ? "reels-spin-anim" : ""}
            style={{ fontSize: "15px", display: "inline-block" }}
          >
            {refreshing ? "⏳" : pullDistance >= 45 ? "↻" : "↓"}
          </span>
          <span>
            {refreshing
              ? "Refreshing reels..."
              : pullDistance >= 45
              ? "Release to refresh"
              : "Pull down to refresh"}
          </span>
        </div>
      )}

      {/* Loading Skeletons */}
      {loading && (
        <div className="reels-skeleton-feed">
          <div className="reels-skeleton-card">
            <div className="reels-skeleton-spinner" />
            <span>Loading Reels...</span>
          </div>
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <div className="reels-empty-view">
          <span style={{ fontSize: "52px" }}>⚠️</span>
          <h3>Could not load reels</h3>
          <p>{error}</p>
          <button
            type="button"
            className="reels-action-prime-btn"
            onClick={() => fetchReels()}
          >
            Try Again
          </button>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && reels.length === 0 && (
        <div className="reels-empty-view">
          <span style={{ fontSize: "60px" }}>🎬</span>
          <h2>No reels yet</h2>
          <p>Be the first to share a video tip, project demo, or creative clip with Nesty!</p>
          <button
            type="button"
            className="reels-action-prime-btn"
            onClick={() => onNavigate("/reels/create")}
          >
            + Create the First Reel
          </button>
        </div>
      )}

      {/* Main Full-Screen Vertical Feed */}
      {!loading && !error && reels.length > 0 && (
        <div
          ref={containerRef}
          className="reels-snap-viewport"
          onScroll={handleScroll}
        >
          {reels.map((reel, idx) => {
            const videoSrc = reel.video_url || reel.videoUrl || "";
            const musicSrc = getMusicAudioUrl(reel);
            const isCurrent = idx === activeIndex;
            const isPaused = pausedMap[idx] || false;
            const isLiked = reel.liked_by_me || reel.likedByMe;
            const likeCount = reel.likes || 0;
            const commentCount = reel.comments_count || reel.commentsCount || 0;
            const authorId = getAuthorId(reel);

            // Preload next reel
            const shouldPreload = Math.abs(idx - activeIndex) <= 1;

            const isCommentsOpen = isCurrent && activeCommentsReel != null && activeCommentsReel.id === reel.id;

            return (
              <div
                key={reel.id || idx}
                className={`reel-fullscreen-slide ${isCurrent ? "active-slide" : ""} ${isCommentsOpen ? "comments-mode-active" : ""}`}
              >
                {/* Clickable video canvas with tap play/pause (or click to close comments) */}
                <div
                  className="reel-media-wrapper"
                  onClick={() => {
                    if (isCommentsOpen) {
                      setActiveCommentsReel(null);
                    } else {
                      togglePlayPause(idx);
                    }
                  }}
                  title={isCommentsOpen ? "Click video to close comments" : undefined}
                >
                  <video
                    ref={(el) => {
                      if (el) videoRefs.current.set(idx, el);
                      else videoRefs.current.delete(idx);
                    }}
                    src={videoSrc}
                    className="reel-fullscreen-video"
                    loop
                    playsInline
                    preload={shouldPreload ? "auto" : "metadata"}
                    muted={isMuted || !!reel.mute_original || reel.original_volume === 0}
                    onTimeUpdate={() => handleVideoTimeUpdate(idx)}
                    onEnded={() => {
                      const aud = audioRefs.current.get(idx);
                      if (aud) {
                        aud.currentTime = reel.music_start_sec || 0;
                        aud.play().catch(() => {});
                      }
                    }}
                  />

                  {/* Synced background soundtrack if present */}
                  {musicSrc && (
                    <audio
                      ref={(el) => {
                        if (el) audioRefs.current.set(idx, el);
                        else audioRefs.current.delete(idx);
                      }}
                      src={musicSrc}
                      loop
                      preload={shouldPreload ? "auto" : "none"}
                      muted={isMuted || reel.music_volume === 0}
                      style={{ display: "none" }}
                    />
                  )}

                  {/* Big Play / Pause Overlay Icon Pulse */}
                  {pausePulseIndex === idx && (
                    <div className="reel-play-pause-pulse">
                      <span>{isPaused ? "⏸" : "▶"}</span>
                    </div>
                  )}

                  {/* Browser Autoplay Unmute Prompt Banner */}
                  {isCurrent && isMuted && !userInteracted && (
                    <div
                      className="reel-tap-unmute-chip"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleMute();
                      }}
                    >
                      <span>🔇 Tap to unmute sound</span>
                    </div>
                  )}
                </div>

                {/* Comments Docked Box Under Smaller Video Frame */}
                {isCommentsOpen && (
                  <div
                    className="reels-comments-dock"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="reels-comments-dock-header">
                      <div className="reels-comments-dock-title">
                        <span>💬</span>
                        <span>Comments ({commentsList.length || commentCount})</span>
                      </div>
                      <button
                        type="button"
                        className="reels-comments-dock-close"
                        onClick={() => setActiveCommentsReel(null)}
                        title="Close comments"
                      >
                        ✕
                      </button>
                    </div>

                    <div className="reels-comments-dock-list">
                      {commentsList.length === 0 ? (
                        <div style={{ textAlign: "center", padding: "28px 12px", color: "var(--text-muted, #94a3b8)" }}>
                          <span style={{ fontSize: "28px", display: "block", marginBottom: "6px" }}>💬</span>
                          <p style={{ margin: 0, fontSize: "13px" }}>No comments yet. Start the conversation!</p>
                        </div>
                      ) : (
                        commentsList.map((c) => (
                          <div key={c.id} className="reels-comment-row">
                            <div className="reels-comment-avatar">
                              {c.user.charAt(0).toUpperCase()}
                            </div>
                            <div className="reels-comment-body">
                              <span className="reels-comment-user">@{c.user}</span>
                              <p className="reels-comment-text">{c.text}</p>
                              <span className="reels-comment-time">{c.time}</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    <form
                      className="reels-comments-dock-input-bar"
                      onSubmit={handlePostComment}
                    >
                      <input
                        type="text"
                        placeholder="Add a comment..."
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        className="reels-comments-dock-input"
                        autoFocus
                      />
                      <button
                        type="submit"
                        className="reels-comments-dock-submit"
                        disabled={!commentText.trim()}
                      >
                        Post
                      </button>
                    </form>
                  </div>
                )}

                {/* Right Side Vertical Action Bar */}
                <aside className="reel-vertical-actions">
                  {/* Creator Avatar */}
                  <div
                    className="reel-avatar-bubble"
                    onClick={() => authorId && onOpenProfile(authorId)}
                    title={`View @${getAuthorHandle(reel)}`}
                  >
                    {getAuthorAvatar(reel) ? (
                      <img src={getAuthorAvatar(reel)} alt="" className="reel-avatar-img" />
                    ) : (
                      <div className="reel-avatar-fallback">
                        {getAuthorHandle(reel).charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className="reel-avatar-add-icon">+</span>
                  </div>

                  {/* Like Button */}
                  <button
                    type="button"
                    className={`reel-action-btn ${isLiked ? "liked" : ""}`}
                    onClick={() => toggleLike(idx)}
                    title={isLiked ? "Unlike" : "Like"}
                  >
                    <span className="reel-action-icon">{isLiked ? "❤️" : "🤍"}</span>
                    <span className="reel-action-label">{likeCount}</span>
                  </button>

                  {/* Comment Button */}
                  <button
                    type="button"
                    className="reel-action-btn"
                    onClick={() => {
                      if (activeCommentsReel?.id === reel.id) {
                        setActiveCommentsReel(null);
                      } else {
                        setActiveCommentsReel(reel);
                      }
                    }}
                    title="Comments"
                  >
                    <span className="reel-action-icon">💬</span>
                    <span className="reel-action-label">{commentCount}</span>
                  </button>

                  {/* Share Button */}
                  <button
                    type="button"
                    className="reel-action-btn"
                    onClick={() => setShareModalReel(reel)}
                    title="Share Reel"
                  >
                    <span className="reel-action-icon">↗</span>
                    <span className="reel-action-label">Share</span>
                  </button>

                  {/* Mute Toggle Icon */}
                  <button
                    type="button"
                    className="reel-action-btn"
                    onClick={toggleMute}
                    title={isMuted ? "Unmute" : "Mute"}
                  >
                    <span className="reel-action-icon">{isMuted ? "🔇" : "🔊"}</span>
                    <span className="reel-action-label">{isMuted ? "Muted" : "Sound"}</span>
                  </button>

                  {/* Spinning Audio Vinyl Disc */}
                  <div className={`reel-vinyl-disc ${isPaused || isMuted ? "paused" : ""}`}>
                    <span className="reel-vinyl-note">♪</span>
                  </div>
                </aside>

                {/* Bottom Overlay: Creator info, caption, soundtrack label */}
                <div className="reel-bottom-overlay">
                  <div
                    className="reel-author-line"
                    onClick={() => authorId && onOpenProfile(authorId)}
                  >
                    <span className="reel-author-handle">@{getAuthorHandle(reel)}</span>
                    <span className="reel-verified-tick">✓</span>
                    <span className="reel-counter-badge">
                      {idx + 1} / {reels.length}
                    </span>
                  </div>

                  {reel.caption && (
                    <p className="reel-caption-paragraph">{reel.caption}</p>
                  )}

                  {/* ♪ Title – Artist Soundtrack Pill */}
                  <div className="reel-soundtrack-marquee-pill">
                    <span className="reel-soundtrack-note">♪</span>
                    <span className="reel-soundtrack-text">
                      {getSoundtrackTitle(reel)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Share Modal Dialog */}
      {shareModalReel && (
        <div className="reels-share-overlay" onClick={() => setShareModalReel(null)}>
          <div className="reels-share-modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="reels-share-header">
              <div className="reels-share-title">
                <span>↗</span>
                <span>Share Reel</span>
              </div>
              <button
                type="button"
                className="reels-share-close-btn"
                onClick={() => setShareModalReel(null)}
              >
                ✕
              </button>
            </div>

            <div className="reels-share-tabs">
              <button
                type="button"
                className={`reels-share-tab-btn ${shareTab === "nesty" ? "active" : ""}`}
                onClick={() => setShareTab("nesty")}
              >
                Share to Nesty Users
              </button>
              <button
                type="button"
                className={`reels-share-tab-btn ${shareTab === "platforms" ? "active" : ""}`}
                onClick={() => setShareTab("platforms")}
              >
                Share Across Platforms
              </button>
            </div>

            {shareTab === "nesty" ? (
              <>
                <div className="reels-share-search-box">
                  <input
                    type="text"
                    placeholder="Search Nesty user by name or handle..."
                    value={nestyUserSearch}
                    onChange={(e) => setNestyUserSearch(e.target.value)}
                    className="reels-share-search-input"
                    autoFocus
                  />
                </div>
                <div className="reels-share-users-list">
                  {filteredNestyUsers.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "30px 10px", color: "var(--text-muted, #94a3b8)", fontSize: "13px" }}>
                      No users found.
                    </div>
                  ) : (
                    filteredNestyUsers.map((u) => {
                      const isSent = !!sentUserIds[u.id];
                      return (
                        <div key={u.id} className="reels-share-user-row">
                          <div className="reels-share-user-info">
                            <div className="reels-share-user-avatar">
                              {u.avatar_url ? (
                                <img src={u.avatar_url} alt="" />
                              ) : (
                                u.username.charAt(0).toUpperCase()
                              )}
                            </div>
                            <div>
                              <span className="reels-share-user-name">{u.name || u.username}</span>
                              <span className="reels-share-user-handle">@{u.username}</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            className={`reels-share-send-btn ${isSent ? "sent" : ""}`}
                            onClick={() => handleSendToNestyUser(u)}
                            disabled={isSent}
                          >
                            {isSent ? "Sent ✓" : "Send"}
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            ) : (
              <div className="reels-share-platforms-grid">
                <button
                  type="button"
                  className="reels-share-platform-btn"
                  onClick={() => handleShareExternal("whatsapp")}
                >
                  <div className="reels-share-platform-icon" style={{ background: "#25D366", color: "#fff" }}>
                    💬
                  </div>
                  <span>WhatsApp</span>
                </button>

                <button
                  type="button"
                  className="reels-share-platform-btn"
                  onClick={() => handleShareExternal("twitter")}
                >
                  <div className="reels-share-platform-icon" style={{ background: "#000", color: "#fff", border: "1px solid rgba(255,255,255,0.2)" }}>
                    𝕏
                  </div>
                  <span>X (Twitter)</span>
                </button>

                <button
                  type="button"
                  className="reels-share-platform-btn"
                  onClick={() => handleShareExternal("telegram")}
                >
                  <div className="reels-share-platform-icon" style={{ background: "#229ED9", color: "#fff" }}>
                    ✈️
                  </div>
                  <span>Telegram</span>
                </button>

                <button
                  type="button"
                  className="reels-share-platform-btn"
                  onClick={() => handleShareExternal("facebook")}
                >
                  <div className="reels-share-platform-icon" style={{ background: "#1877F2", color: "#fff" }}>
                    📘
                  </div>
                  <span>Facebook</span>
                </button>

                <button
                  type="button"
                  className="reels-share-platform-btn"
                  onClick={() => handleShareExternal("linkedin")}
                >
                  <div className="reels-share-platform-icon" style={{ background: "#0A66C2", color: "#fff" }}>
                    💼
                  </div>
                  <span>LinkedIn</span>
                </button>

                <button
                  type="button"
                  className="reels-share-platform-btn"
                  onClick={handleCopyLink}
                >
                  <div className="reels-share-platform-icon" style={{ background: copiedLink ? "#10b981" : "#475569", color: "#fff" }}>
                    {copiedLink ? "✓" : "📋"}
                  </div>
                  <span>{copiedLink ? "Copied!" : "Copy Link"}</span>
                </button>

                <button
                  type="button"
                  className="reels-share-platform-btn"
                  onClick={() => handleShareExternal("system")}
                >
                  <div className="reels-share-platform-icon" style={{ background: "#6366f1", color: "#fff" }}>
                    ↗
                  </div>
                  <span>More...</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
