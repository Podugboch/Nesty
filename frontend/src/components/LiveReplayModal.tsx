import React, { useState, useEffect, useRef } from "react";
import { clearLocalReplay, assembleLocalReplayBlob } from "../utils/replayDb";

interface LiveReplayModalProps {
  liveId: number;
  streamTitle: string;
  initialBlob?: Blob | null;
  initialVideoUrl?: string | null;
  apiUrl: string;
  authToken: string;
  onClose: () => void;
  onPublished: () => void;
}

export const LiveReplayModal: React.FC<LiveReplayModalProps> = ({
  liveId,
  streamTitle,
  initialBlob,
  initialVideoUrl,
  apiUrl,
  authToken,
  onClose,
  onPublished,
}) => {
  const [videoBlob, setVideoBlob] = useState<Blob | null>(initialBlob || null);
  const [videoUrl, setVideoUrl] = useState<string>(initialVideoUrl || "");
  const [caption, setCaption] = useState<string>(`Replay: ${streamTitle}`);
  const [publishType, setPublishType] = useState<"post" | "reel">("post");
  const [thumbnailDataUrl, setThumbnailDataUrl] = useState<string | null>(null);
  const [isCapturingThumb, setIsCapturingThumb] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);

  // If no blob was passed directly, load from IndexedDB or server
  useEffect(() => {
    let active = true;
    if (!initialBlob && !initialVideoUrl && liveId) {
      assembleLocalReplayBlob(liveId).then((blob) => {
        if (active && blob) {
          setVideoBlob(blob);
          const objUrl = URL.createObjectURL(blob);
          setVideoUrl(objUrl);
        }
      });
    } else if (initialBlob) {
      const objUrl = URL.createObjectURL(initialBlob);
      setVideoUrl(objUrl);
      return () => {
        URL.revokeObjectURL(objUrl);
      };
    }
    return () => {
      active = false;
    };
  }, [liveId, initialBlob, initialVideoUrl]);

  // Capture frame from current video position as thumbnail
  const captureThumbnailFromVideo = () => {
    if (!videoRef.current) return;
    setIsCapturingThumb(true);
    try {
      const vid = videoRef.current;
      const canvas = document.createElement("canvas");
      canvas.width = vid.videoWidth || 640;
      canvas.height = vid.videoHeight || 360;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        setThumbnailDataUrl(dataUrl);
      }
    } catch (err) {
      console.warn("Failed to capture thumbnail from video:", err);
    } finally {
      setIsCapturingThumb(false);
    }
  };

  const uploadBlob = async (blob: Blob, filename: string): Promise<string> => {
    const formData = new FormData();
    formData.append("file", blob, filename);
    const res = await fetch(`${apiUrl}/api/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      body: formData,
    });
    if (!res.ok) {
      throw new Error(`Upload failed with status ${res.status}`);
    }
    const data = await res.json();
    return data.url || data.media_url || data.public_url || "";
  };

  const handlePublish = async () => {
    if (!caption.trim()) {
      setErrorMsg("Please enter a caption for your replay.");
      return;
    }

    setIsPublishing(true);
    setErrorMsg(null);
    try {
      let finalVideoUrl = videoUrl;

      // 1. If video is a local blob (blob: URL), upload it first
      if (videoBlob) {
        setStatusText("Uploading live replay video...");
        const ext = videoBlob.type.includes("mp4") ? "mp4" : "webm";
        finalVideoUrl = await uploadBlob(videoBlob, `replay_${liveId}.${ext}`);
      }

      // 2. Upload thumbnail if captured
      let finalThumbUrl = "";
      if (thumbnailDataUrl) {
        setStatusText("Uploading thumbnail...");
        const thumbRes = await fetch(thumbnailDataUrl);
        const thumbBlob = await thumbRes.blob();
        finalThumbUrl = await uploadBlob(thumbBlob, `thumb_${liveId}.jpg`);
      }

      // 3. Publish replay via backend endpoint
      setStatusText(publishType === "reel" ? "Creating Reel..." : "Creating Post...");
      const res = await fetch(`${apiUrl}/api/lives/${liveId}/replay/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          publish_type: publishType,
          caption: caption.trim(),
          video_url: finalVideoUrl,
          thumbnail_url: finalThumbUrl,
          community: "home",
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to publish replay");
      }

      // 4. Clean up local IndexedDB chunks
      await clearLocalReplay(liveId);
      onPublished();
    } catch (err: any) {
      console.error("Publish replay error:", err);
      setErrorMsg(err.message || "Failed to publish replay.");
    } finally {
      setIsPublishing(false);
      setStatusText("");
    }
  };

  const handleDiscard = async () => {
    if (window.confirm("Are you sure you want to discard this live stream replay? This cannot be undone.")) {
      try {
        await fetch(`${apiUrl}/api/lives/${liveId}/replay/finish`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ action: "discard" }),
        });
        await clearLocalReplay(liveId);
      } catch {}
      onClose();
    }
  };

  return (
    <div className="live-replay-modal-backdrop">
      <div className="live-replay-modal-container">
        <div className="live-replay-header">
          <div className="live-replay-title-wrap">
            <span className="live-replay-badge">📼 REPLAY READY</span>
            <h2>Save & Share Broadcast</h2>
          </div>
          <button
            type="button"
            className="live-replay-close-btn"
            onClick={onClose}
            title="Close"
          >
            ✕
          </button>
        </div>

        <div className="live-replay-body">
          {/* VIDEO PREVIEW SECTION */}
          <div className="live-replay-preview-card">
            {videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
                controls
                playsInline
                className="live-replay-video-element"
                onLoadedData={captureThumbnailFromVideo}
              />
            ) : (
              <div className="live-replay-loading-placeholder">
                <div className="spinner" />
                <span>Assembling recording chunks...</span>
              </div>
            )}

            <div className="live-replay-thumb-bar">
              <button
                type="button"
                className="live-replay-thumb-btn"
                onClick={captureThumbnailFromVideo}
                disabled={isCapturingThumb}
              >
                📸 Set Current Frame as Cover
              </button>
              {thumbnailDataUrl && (
                <div className="live-replay-thumb-preview">
                  <img src={thumbnailDataUrl} alt="Thumbnail preview" />
                  <span>Cover chosen</span>
                </div>
              )}
            </div>
          </div>

          {/* METADATA FORM */}
          <div className="live-replay-form-section">
            <div className="live-replay-form-group">
              <label htmlFor="replay-caption">Caption</label>
              <textarea
                id="replay-caption"
                className="live-replay-textarea"
                rows={3}
                placeholder="Write a caption for your live replay..."
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
              />
            </div>

            <div className="live-replay-form-group">
              <label>Publish Destination</label>
              <div className="live-replay-type-selector">
                <button
                  type="button"
                  className={`live-type-btn ${publishType === "post" ? "active" : ""}`}
                  onClick={() => setPublishType("post")}
                >
                  <span className="type-icon">📰</span>
                  <div className="type-meta">
                    <strong>Nesty Feed Post</strong>
                    <small>Visible in main feed & profile</small>
                  </div>
                </button>
                <button
                  type="button"
                  className={`live-type-btn ${publishType === "reel" ? "active" : ""}`}
                  onClick={() => setPublishType("reel")}
                >
                  <span className="type-icon">🎬</span>
                  <div className="type-meta">
                    <strong>Nesty Reel</strong>
                    <small>Vertical short-form format</small>
                  </div>
                </button>
              </div>
            </div>

            {errorMsg && <div className="live-replay-error">{errorMsg}</div>}
            {statusText && <div className="live-replay-status">{statusText}</div>}

            <div className="live-replay-actions">
              <button
                type="button"
                className="live-replay-discard-btn"
                onClick={handleDiscard}
                disabled={isPublishing}
              >
                Discard Replay
              </button>
              <button
                type="button"
                className="live-replay-publish-btn"
                onClick={handlePublish}
                disabled={isPublishing || (!videoBlob && !videoUrl)}
              >
                {isPublishing ? "Publishing..." : "Publish Replay"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
