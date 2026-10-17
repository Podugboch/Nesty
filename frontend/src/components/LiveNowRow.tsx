import React from "react";
import type { LiveStream } from "../types/live";

interface LiveNowRowProps {
  lives: LiveStream[];
  onSelectLive: (live: LiveStream) => void;
  onGoLiveClick: () => void;
  currentUserId?: number;
}

export const LiveNowRow: React.FC<LiveNowRowProps> = ({
  lives,
  onSelectLive,
  onGoLiveClick,
  currentUserId,
}) => {
  // If no active lives and not logged in, don't show empty row
  if (lives.length === 0 && !currentUserId) {
    return null;
  }

  return (
    <div className="live-now-container">
      <div className="live-now-header">
        <div className="live-now-title-group">
          <span className="live-now-pulse-dot" />
          <span className="live-now-title">LIVE NOW</span>
          {lives.length > 0 && (
            <span className="live-now-count-badge">{lives.length}</span>
          )}
        </div>
      </div>

      <div className="live-now-scroll">
        {/* CREATE / GO LIVE TILE */}
        {currentUserId && (
          <button
            type="button"
            className="live-now-card create-card"
            onClick={onGoLiveClick}
            title="Start your live broadcast"
          >
            <div className="live-now-avatar-ring create-ring">
              <span className="live-now-create-icon">+</span>
            </div>
            <span className="live-now-host-name">Go Live</span>
            <span className="live-now-meta-sub">Start Stream</span>
          </button>
        )}

        {/* ACTIVE BROADCAST TILES */}
        {lives.map((live) => {
          const host = live.host;
          const hostName = host?.name || host?.username || `User #${live.host_id}`;
          const isMyLive = currentUserId && Number(live.host_id) === Number(currentUserId);

          return (
            <button
              key={live.id}
              type="button"
              className={`live-now-card ${isMyLive ? "is-my-live" : ""}`}
              onClick={() => onSelectLive(live)}
              title={`${live.title} by @${host?.username || hostName}`}
            >
              <div className="live-now-avatar-ring">
                {host?.avatar_url ? (
                  <img
                    src={host.avatar_url}
                    alt={hostName}
                    className="live-now-avatar-img"
                  />
                ) : (
                  <div className="live-now-avatar-fallback">
                    {hostName.charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="live-now-live-badge">LIVE</span>
              </div>

              <div className="live-now-info">
                <span className="live-now-host-name">
                  {isMyLive ? "Your Stream" : hostName}
                </span>
                <div className="live-now-viewers-pill">
                  <span>👁️</span>
                  <span>{live.viewer_count || 1}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
