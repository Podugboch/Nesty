import React, { useState, useRef, useEffect } from "react";
import { MusicPicker, type MusicTrack } from "./MusicPicker";

interface ReelCreateViewProps {
  apiUrl?: string;
  token?: string;
  onNavigate: (path: string) => void;
}

export const ReelCreateView: React.FC<ReelCreateViewProps> = ({
  apiUrl = "",
  token = "",
  onNavigate,
}) => {
  // 5 Steps: 1: pick/record, 2: preview, 3: sound, 4: caption, 5: share
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Video state
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [videoError, setVideoError] = useState<string | null>(null);

  // Sound step state
  const [muteOriginal, setMuteOriginal] = useState<boolean>(false);
  const [selectedMusic, setSelectedMusic] = useState<MusicTrack | null>(null);
  const [musicPickerOpen, setMusicPickerOpen] = useState<boolean>(false);
  const [musicVolume, setMusicVolume] = useState<number>(1);
  const [originalVolume, setOriginalVolume] = useState<number>(1);
  const [musicStartSec, setMusicStartSec] = useState<number>(0);

  // Caption step state
  const [caption, setCaption] = useState<string>("");

  // Share step state & upload progress
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [shareError, setShareError] = useState<string | null>(null);

  // Synchronized audition refs in Sound step
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlayingAudition, setIsPlayingAudition] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      if (videoPreviewUrl) {
        URL.revokeObjectURL(videoPreviewUrl);
      }
    };
  }, [videoPreviewUrl]);

  // Handle Video Selection / Record
  const handleVideoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVideoError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate type
    if (!file.type.startsWith("video/") && !/\.(mp4|mov|webm|m4v|3gp)$/i.test(file.name)) {
      setVideoError("Please select a valid video file (MP4, WebM, MOV)");
      return;
    }

    // Validate size (100 MB max)
    if (file.size > 100 * 1024 * 1024) {
      setVideoError("Video file size exceeds the 100 MB limit. Please choose a smaller video.");
      return;
    }

    if (videoPreviewUrl) {
      URL.revokeObjectURL(videoPreviewUrl);
    }

    const previewUrl = URL.createObjectURL(file);
    setVideoFile(file);
    setVideoPreviewUrl(previewUrl);

    // Read duration
    const tempVid = document.createElement("video");
    tempVid.src = previewUrl;
    tempVid.onloadedmetadata = () => {
      if (tempVid.duration && !isNaN(tempVid.duration)) {
        setVideoDuration(Math.round(tempVid.duration));
      }
    };

    // Auto advance to Preview step
    setCurrentStep(2);
  };

  // Drag and drop video
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setVideoError(null);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("video/")) {
      setVideoError("Please drop a valid video file.");
      return;
    }

    if (file.size > 100 * 1024 * 1024) {
      setVideoError("Video file size exceeds 100 MB.");
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setVideoFile(file);
    setVideoPreviewUrl(previewUrl);
    setCurrentStep(2);
  };

  // Sound Audition Synced Play/Pause
  const toggleAuditionPlay = () => {
    const vid = previewVideoRef.current;
    const aud = previewAudioRef.current;
    if (!vid) return;

    if (vid.paused) {
      vid.volume = muteOriginal ? 0 : originalVolume;
      vid.play().catch(() => {});
      if (aud && selectedMusic) {
        aud.currentTime = musicStartSec + vid.currentTime;
        aud.volume = musicVolume;
        aud.play().catch(() => {});
      }
      setIsPlayingAudition(true);
    } else {
      vid.pause();
      if (aud) aud.pause();
      setIsPlayingAudition(false);
    }
  };

  // Cancel Confirmation
  const handleCancel = () => {
    if (videoFile || caption.trim()) {
      if (window.confirm("Discard this reel and leave?")) {
        onNavigate("/reels");
      }
    } else {
      onNavigate("/reels");
    }
  };

  // Step 5: Upload & Share Reel
  const handleShareReel = async () => {
    if (!videoFile) {
      setShareError("No video selected");
      return;
    }

    setIsSubmitting(true);
    setShareError(null);
    setUploadProgress(10);

    try {
      const cleanBaseUrl = (apiUrl || "").replace(/\/+$/, "");
      const uploadEndpoint = cleanBaseUrl ? `${cleanBaseUrl}/api/upload` : "/api/upload";
      const reelsEndpoint = cleanBaseUrl ? `${cleanBaseUrl}/api/reels` : "/api/reels";

      // 1. Upload Video File with progress (via XHR with fetch fallback)
      const formData = new FormData();
      formData.append("file", videoFile);

      const authToken = token || localStorage.getItem("token");

      let uploadedUrl: string | null = null;
      try {
        uploadedUrl = await new Promise<string>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              const percent = Math.round((event.loaded / event.total) * 75);
              setUploadProgress(Math.max(10, percent));
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const res = JSON.parse(xhr.responseText);
                const url = res.url || res.media_url || res.file_url;
                if (url) resolve(url);
                else reject(new Error("Upload response missing video URL"));
              } catch (e) {
                reject(new Error("Failed to parse upload response from server"));
              }
            } else {
              let msg = `Video upload failed (HTTP ${xhr.status})`;
              try {
                const errData = JSON.parse(xhr.responseText);
                if (errData.error) msg = errData.error;
              } catch (_) {}
              reject(new Error(msg));
            }
          };

          xhr.onerror = () => reject(new Error("xhr_network_error"));
          xhr.ontimeout = () => reject(new Error("xhr_timeout"));

          xhr.open("POST", uploadEndpoint);
          if (authToken) {
            xhr.setRequestHeader("Authorization", `Bearer ${authToken}`);
          }
          xhr.send(formData);
        });
      } catch (uploadErr: any) {
        // If XHR failed due to network error or timeout, attempt standard fetch() fallback
        if (uploadErr?.message === "xhr_network_error" || uploadErr?.message === "xhr_timeout") {
          console.warn("XHR upload network error, falling back to fetch...", uploadErr);
          setUploadProgress(50);
          const fetchHeaders: Record<string, string> = {};
          if (authToken) {
            fetchHeaders["Authorization"] = `Bearer ${authToken}`;
          }
          try {
            const fetchRes = await fetch(uploadEndpoint, {
              method: "POST",
              headers: fetchHeaders,
              body: formData,
            });
            if (fetchRes.ok) {
              const data = await fetchRes.json();
              uploadedUrl = data.url || data.media_url || data.file_url;
              if (!uploadedUrl) {
                throw new Error("Upload response missing video URL");
              }
            } else {
              const errData = await fetchRes.json().catch(() => ({}));
              throw new Error(errData.error || `Video upload failed (HTTP ${fetchRes.status})`);
            }
          } catch (fetchErr: any) {
            throw new Error(
              fetchErr.message && !fetchErr.message.includes("fetch")
                ? fetchErr.message
                : "Unable to reach server during video upload. Please check your internet connection and try again."
            );
          }
        } else {
          throw uploadErr;
        }
      }

      setUploadProgress(85);

      // 2. Submit Reel metadata to POST /api/reels
      const reelPayload: Record<string, any> = {
        video_url: uploadedUrl,
        caption: caption.trim(),
        mute_original: muteOriginal,
        music_start_sec: musicStartSec,
        music_volume: musicVolume,
        original_volume: muteOriginal ? 0 : originalVolume,
      };

      if (selectedMusic) {
        if (typeof selectedMusic.id === "number") {
          reelPayload.music_track_id = selectedMusic.id;
        }
        reelPayload.music_source = selectedMusic.source || "library";
        reelPayload.music_url = selectedMusic.audio_url;
        reelPayload.music_title = selectedMusic.title;
        reelPayload.music_artist = selectedMusic.artist;
      }

      const createRes = await fetch(reelsEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(reelPayload),
      });

      if (!createRes.ok) {
        const errJson = await createRes.json().catch(() => ({}));
        throw new Error(errJson.error || `Failed to create reel (HTTP ${createRes.status})`);
      }

      setUploadProgress(100);

      // Brief delay to display 100% complete then redirect to /reels
      setTimeout(() => {
        onNavigate("/reels");
      }, 500);
    } catch (err: any) {
      setShareError(err.message || "Failed to share reel. Please try again.");
      setIsSubmitting(false);
    }
  };

  const formatSec = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  return (
    <div className="reel-create-page">
      {/* Top Header */}
      <header className="reel-create-header">
        <button
          type="button"
          className="reel-create-cancel-btn"
          onClick={handleCancel}
          disabled={isSubmitting}
        >
          Cancel
        </button>

        <h3 className="reel-create-title">Create Reel</h3>

        <div className="reel-create-header-spacer" />
      </header>

      {/* 5-Step Stepper Indicator */}
      <div className="reel-create-stepper">
        {[
          { num: 1, label: "Video" },
          { num: 2, label: "Preview" },
          { num: 3, label: "Sound" },
          { num: 4, label: "Caption" },
          { num: 5, label: "Share" },
        ].map((s) => (
          <div
            key={s.num}
            className={`reel-stepper-step ${currentStep === s.num ? "active" : currentStep > s.num ? "completed" : ""}`}
            onClick={() => {
              if (!isSubmitting && videoFile && s.num <= currentStep) {
                setCurrentStep(s.num as any);
              }
            }}
          >
            <div className="reel-stepper-dot">
              {currentStep > s.num ? "✓" : s.num}
            </div>
            <span className="reel-stepper-label">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="reel-create-content-container">
        {/* ===================================================================
            STEP 1: PICK / RECORD VIDEO
            =================================================================== */}
        {currentStep === 1 && (
          <div className="reel-step-box step-pick">
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: "none" }}
              accept="video/*"
              onChange={handleVideoFileChange}
            />

            <div
              className="reel-upload-dropzone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="reel-upload-icon-circle">
                <span>📹</span>
              </div>
              <h3>Choose or record a video</h3>
              <p>Supports MP4, WebM, QuickTime (Max 100 MB)</p>

              {videoError && (
                <div className="reel-create-error-banner">
                  ⚠️ {videoError}
                </div>
              )}

              <div className="reel-pick-buttons-row">
                <button
                  type="button"
                  className="reel-prime-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                >
                  Browse Video
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            STEP 2: PREVIEW VIDEO
            =================================================================== */}
        {currentStep === 2 && videoPreviewUrl && (
          <div className="reel-step-box step-preview">
            <div className="reel-preview-stage">
              <video
                src={videoPreviewUrl}
                controls
                playsInline
                className="reel-preview-video"
              />
            </div>

            <div className="reel-preview-details-bar">
              <span>Duration: ~{videoDuration ? formatSec(videoDuration) : "Ready"}</span>
              <button
                type="button"
                className="reel-ghost-btn"
                onClick={() => {
                  fileInputRef.current?.click();
                }}
              >
                Change Video
              </button>
            </div>

            <div className="reel-nav-buttons-bar">
              <button
                type="button"
                className="reel-ghost-btn"
                onClick={() => setCurrentStep(1)}
              >
                ← Back
              </button>
              <button
                type="button"
                className="reel-prime-btn"
                onClick={() => setCurrentStep(3)}
              >
                Next: Audio & Sound →
              </button>
            </div>
          </div>
        )}

        {/* ===================================================================
            STEP 3: SOUND STEP
            =================================================================== */}
        {currentStep === 3 && (
          <div className="reel-step-box step-sound">
            <div className="reel-sound-stage">
              {/* Mini synchronized player preview */}
              <div className="reel-sound-mini-preview">
                {videoPreviewUrl && (
                  <video
                    ref={previewVideoRef}
                    src={videoPreviewUrl}
                    playsInline
                    loop
                    className="reel-sound-mini-video"
                    onClick={toggleAuditionPlay}
                  />
                )}
                {selectedMusic && (
                  <audio
                    ref={previewAudioRef}
                    src={selectedMusic.audio_url}
                    loop
                    style={{ display: "none" }}
                  />
                )}
                <button
                  type="button"
                  className="reel-sound-audition-btn"
                  onClick={toggleAuditionPlay}
                >
                  {isPlayingAudition ? "⏸ Pause Mix" : "▶ Preview Mix"}
                </button>
              </div>

              {/* Sound Controls Column */}
              <div className="reel-sound-controls-card">
                {/* 1. Original Sound Toggle */}
                <div className="sound-toggle-row">
                  <div className="sound-toggle-label">
                    <span className="sound-toggle-title">Original Sound</span>
                    <span className="sound-toggle-sub">
                      {muteOriginal ? "Off (muted)" : "On (include video audio)"}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={`switch-toggle-btn ${!muteOriginal ? "active" : ""}`}
                    onClick={() => setMuteOriginal(!muteOriginal)}
                    title={muteOriginal ? "Turn on original sound" : "Mute original sound"}
                  >
                    <span className="switch-toggle-knob" />
                  </button>
                </div>

                {/* 2. Add / Change Music Track */}
                <div className="reel-music-track-section">
                  <label className="reel-section-label">Background Music</label>
                  {selectedMusic ? (
                    <div className="composer-selected-music-badge">
                      <div className="composer-music-disc">🎵</div>
                      <div className="composer-music-info">
                        <span className="composer-music-title">{selectedMusic.title}</span>
                        <span className="composer-music-artist">
                          {selectedMusic.artist}
                          {selectedMusic.source === "jamendo" && " • Jamendo"}
                          {selectedMusic.source === "device" && " • My Device"}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="composer-music-change-btn"
                        onClick={() => setMusicPickerOpen(true)}
                      >
                        Change
                      </button>
                      <button
                        type="button"
                        className="composer-music-remove-btn"
                        onClick={() => setSelectedMusic(null)}
                        title="Remove music"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="reel-add-music-cta-btn"
                      onClick={() => setMusicPickerOpen(true)}
                    >
                      <span>🎵</span>
                      <span>Add Music (Library or Device)</span>
                    </button>
                  )}
                </div>

                {/* 3. Song Start Position Slider */}
                {selectedMusic && (
                  <div className="reel-start-sec-group">
                    <div className="slider-header-row">
                      <span className="volume-slider-name">Music Start Offset</span>
                      <span className="volume-slider-val">{formatSec(musicStartSec)}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max={Math.max(10, (selectedMusic.duration_sec || 60) - (videoDuration || 15))}
                      step="1"
                      value={musicStartSec}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setMusicStartSec(val);
                        if (previewAudioRef.current) {
                          previewAudioRef.current.currentTime = val;
                        }
                      }}
                      className="volume-slider-input"
                    />
                    <span className="slider-hint">
                      Slide to select which part of the track plays first
                    </span>
                  </div>
                )}

                {/* 4. Volume Sliders */}
                <div className="volume-slider-group">
                  {selectedMusic && (
                    <div className="volume-slider-row">
                      <span className="volume-slider-name">Music Volume</span>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={musicVolume}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          setMusicVolume(v);
                          if (previewAudioRef.current) previewAudioRef.current.volume = v;
                        }}
                        className="volume-slider-input"
                      />
                      <span className="volume-slider-val">{Math.round(musicVolume * 100)}%</span>
                    </div>
                  )}

                  {!muteOriginal && (
                    <div className="volume-slider-row">
                      <span className="volume-slider-name">Original Audio Volume</span>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={originalVolume}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          setOriginalVolume(v);
                          if (previewVideoRef.current) previewVideoRef.current.volume = v;
                        }}
                        className="volume-slider-input"
                      />
                      <span className="volume-slider-val">{Math.round(originalVolume * 100)}%</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="reel-nav-buttons-bar">
              <button
                type="button"
                className="reel-ghost-btn"
                onClick={() => setCurrentStep(2)}
              >
                ← Back to Preview
              </button>
              <button
                type="button"
                className="reel-prime-btn"
                onClick={() => setCurrentStep(4)}
              >
                Next: Caption →
              </button>
            </div>
          </div>
        )}

        {/* ===================================================================
            STEP 4: CAPTION STEP
            =================================================================== */}
        {currentStep === 4 && (
          <div className="reel-step-box step-caption">
            <div className="reel-caption-card">
              <label className="reel-section-label">Write a Caption</label>
              <textarea
                className="reel-caption-textarea"
                rows={4}
                placeholder="What's this reel about? Add hashtags like #nesty #coding #tech..."
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                maxLength={500}
                autoFocus
              />
              <div className="reel-caption-meta">
                <div className="reel-hashtag-suggestions">
                  {["#nesty", "#tech", "#coding", "#creators", "#viral"].map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className="reel-hashtag-pill"
                      onClick={() => setCaption((prev) => `${prev} ${tag}`.trim())}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
                <span className="reel-char-counter">{caption.length} / 500</span>
              </div>
            </div>

            <div className="reel-nav-buttons-bar">
              <button
                type="button"
                className="reel-ghost-btn"
                onClick={() => setCurrentStep(3)}
              >
                ← Back to Sound
              </button>
              <button
                type="button"
                className="reel-prime-btn"
                onClick={() => setCurrentStep(5)}
              >
                Review & Share →
              </button>
            </div>
          </div>
        )}

        {/* ===================================================================
            STEP 5: SHARE STEP (UPLOAD PROGRESS & SUBMIT)
            =================================================================== */}
        {currentStep === 5 && (
          <div className="reel-step-box step-share">
            <div className="reel-share-summary-card">
              <h3>Ready to publish your reel?</h3>
              <p>Your reel will be visible to everyone on Nesty.</p>

              <div className="reel-summary-preview-row">
                {videoPreviewUrl && (
                  <video
                    src={videoPreviewUrl}
                    className="reel-summary-thumb"
                    muted
                  />
                )}
                <div className="reel-summary-info">
                  <div className="reel-summary-caption">
                    {caption.trim() ? caption : "No caption provided"}
                  </div>
                  <div className="reel-summary-audio-pill">
                    <span>♪</span>
                    <span>
                      {selectedMusic
                        ? `${selectedMusic.title} – ${selectedMusic.artist}`
                        : muteOriginal
                        ? "Muted Audio"
                        : "Original Sound"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Progress Bar during submit */}
              {isSubmitting && (
                <div className="reel-upload-progress-wrap">
                  <div className="reel-progress-label-row">
                    <span>Uploading & Publishing Reel...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="reel-progress-track">
                    <div
                      className="reel-progress-fill"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {shareError && (
                <div className="reel-create-error-banner">
                  ⚠️ {shareError}
                </div>
              )}

              <div className="reel-share-action-buttons">
                <button
                  type="button"
                  className="reel-ghost-btn"
                  disabled={isSubmitting}
                  onClick={() => setCurrentStep(4)}
                >
                  ← Edit Caption
                </button>
                <button
                  type="button"
                  className="reel-share-now-btn"
                  disabled={isSubmitting}
                  onClick={handleShareReel}
                >
                  {isSubmitting ? `Publishing (${uploadProgress}%)...` : "🚀 Share Reel Now"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Dual Source Music Picker Modal */}
      <MusicPicker
        isOpen={musicPickerOpen}
        onClose={() => setMusicPickerOpen(false)}
        onSelectTrack={(track) => setSelectedMusic(track)}
        onRemoveMusic={() => setSelectedMusic(null)}
        selectedTrackId={selectedMusic?.id}
        apiUrl={apiUrl}
        token={token}
      />
    </div>
  );
};
