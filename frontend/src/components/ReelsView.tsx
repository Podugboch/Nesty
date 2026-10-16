import React, { useState, useEffect, useRef, useCallback } from "react";

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

  const handleShare = (r: ReelItem) => {
    const shareUrl = `${window.location.origin}/reels`;
    if (navigator.share) {
      navigator.share({
        title: `${getAuthorName(r)} on Nesty Reels`,
        text: r.caption || "Watch this reel on Nesty!",
        url: shareUrl,
      }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(shareUrl);
      alert("Reel link copied to clipboard!");
    }
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
            onClick={() => fetchReels(true)}
            disabled={refreshing || loading}
            title="Refresh Reels Feed"
            aria-label="Refresh Reels"
          >
            <span
              className={refreshing ? "reels-spin-anim" : ""}
              style={{ display: "inline-block", fontSize: "14px" }}
            >
              ↻
            </span>
            <span className="reels-header-refresh-text">
              {refreshing ? "Refreshing..." : "Refresh"}
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

            return (
              <div
                key={reel.id || idx}
                className={`reel-fullscreen-slide ${isCurrent ? "active-slide" : ""}`}
              >
                {/* Clickable video canvas with tap play/pause */}
                <div
                  className="reel-media-wrapper"
                  onClick={() => togglePlayPause(idx)}
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
                    onClick={() => setActiveCommentsReel(reel)}
                    title="Comments"
                  >
                    <span className="reel-action-icon">💬</span>
                    <span className="reel-action-label">{commentCount}</span>
                  </button>

                  {/* Share Button */}
                  <button
                    type="button"
                    className="reel-action-btn"
                    onClick={() => handleShare(reel)}
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



      {/* Comments Bottom Sheet Drawer */}
      {activeCommentsReel && (
        <div
          className="reels-comments-overlay"
          onClick={() => setActiveCommentsReel(null)}
        >
          <div
            className="reels-comments-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="reels-comments-header">
              <h4>Comments ({commentsList.length})</h4>
              <button
                type="button"
                className="reels-comments-close-btn"
                onClick={() => setActiveCommentsReel(null)}
              >
                ✕
              </button>
            </div>

            <div className="reels-comments-list">
              {commentsList.length === 0 ? (
                <div className="reels-comments-empty">
                  <span>💬</span>
                  <p>No comments yet. Start the conversation!</p>
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
              className="reels-comment-input-bar"
              onSubmit={(e) => {
                e.preventDefault();
                if (!commentText.trim()) return;
                setCommentsList((prev) => [
                  ...prev,
                  {
                    id: Date.now(),
                    user: "you",
                    text: commentText.trim(),
                    time: "Just now",
                  },
                ]);
                setCommentText("");
              }}
            >
              <input
                type="text"
                placeholder="Add a comment..."
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                className="reels-comment-field"
              />
              <button
                type="submit"
                className="reels-comment-post-btn"
                disabled={!commentText.trim()}
              >
                Post
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
