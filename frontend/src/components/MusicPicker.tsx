import React, { useState, useEffect, useRef } from "react";

export interface MusicTrack {
  id?: number | string;
  title: string;
  artist: string;
  audio_url: string;
  cover_url?: string | null;
  duration_sec: number;
  source?: string; // "jamendo" | "device" | "library"
  attribution?: string;
  license?: string;
}

interface MusicPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTrack: (track: MusicTrack) => void;
  onRemoveMusic?: () => void;
  selectedTrackId?: number | string | null;
  apiUrl?: string;
  token?: string;
}

const GENRE_TAGS = [
  { label: "Trending", value: "" },
  { label: "Chillout", value: "chillout" },
  { label: "Electronic", value: "electronic" },
  { label: "Hip-Hop", value: "hiphop" },
  { label: "Pop", value: "pop" },
  { label: "Rock", value: "rock" },
  { label: "Ambient", value: "ambient" },
  { label: "Acoustic", value: "acoustic" },
];

export const MusicPicker: React.FC<MusicPickerProps> = ({
  isOpen,
  onClose,
  onSelectTrack,
  onRemoveMusic,
  selectedTrackId,
  apiUrl = "",
  token = "",
}) => {
  const [activeTab, setActiveTab] = useState<"library" | "device">("library");

  // Library (Jamendo) State
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGenre, setSelectedGenre] = useState("");
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Audition preview state (max 30 seconds)
  const [previewingTrackId, setPreviewingTrackId] = useState<string | number | null>(null);
  const auditionAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // My Device Upload State
  const [deviceFile, setDeviceFile] = useState<File | null>(null);
  const [deviceTitle, setDeviceTitle] = useState("");
  const [deviceArtist, setDeviceArtist] = useState("");
  const [deviceDuration, setDeviceDuration] = useState(0);
  const [isUploadingDeviceAudio, setIsUploadingDeviceAudio] = useState(false);
  const [deviceAudioPreviewUrl, setDeviceAudioPreviewUrl] = useState<string | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopPreview = () => {
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    if (auditionAudioRef.current) {
      auditionAudioRef.current.pause();
      auditionAudioRef.current.src = "";
    }
    setPreviewingTrackId(null);
  };

  // Fetch tracks from backend Jamendo proxy
  useEffect(() => {
    if (!isOpen || activeTab !== "library") {
      stopPreview();
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (searchQuery.trim()) {
          params.append("q", searchQuery.trim());
        }
        if (selectedGenre) {
          params.append("genre", selectedGenre);
        }
        params.append("limit", "25");

        const url = `${apiUrl}/api/music/search?${params.toString()}`;
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Failed to load music tracks (HTTP ${res.status})`);
        }
        const data = await res.json();
        if (isMounted) {
          const trackList = Array.isArray(data) ? data : data.tracks || [];
          setTracks(trackList);
          setLoading(false);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || "Failed to load music tracks");
          setLoading(false);
        }
      }
    }, 280);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [isOpen, activeTab, searchQuery, selectedGenre, apiUrl]);

  const toggleTrackPreview = (track: MusicTrack) => {
    const trackKey = track.id || track.audio_url;
    if (previewingTrackId === trackKey) {
      stopPreview();
      return;
    }

    stopPreview();

    try {
      const audio = new Audio(track.audio_url);
      audio.volume = 0.85;
      audio.play().catch((err) => {
        console.warn("Audio preview blocked or failed:", err);
      });

      audio.onended = () => {
        stopPreview();
      };

      auditionAudioRef.current = audio;
      setPreviewingTrackId(trackKey);

      // Max 30 seconds preview limit
      previewTimerRef.current = setTimeout(() => {
        stopPreview();
      }, 30000);
    } catch (e) {
      console.warn("Preview audio error:", e);
      stopPreview();
    }
  };

  const handleSelect = (track: MusicTrack) => {
    stopPreview();
    onSelectTrack(track);
    onClose();
  };

  const handleRemove = () => {
    stopPreview();
    if (onRemoveMusic) {
      onRemoveMusic();
    }
    onClose();
  };

  // Device file handling
  const handleDeviceFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDeviceError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate audio file
    if (!file.type.startsWith("audio/") && !/\.(mp3|wav|m4a|ogg|aac|flac)$/i.test(file.name)) {
      setDeviceError("Please select a valid audio file (.mp3, .m4a, .wav, .ogg)");
      return;
    }

    // 25MB max size
    if (file.size > 25 * 1024 * 1024) {
      setDeviceError("Audio file exceeds the maximum 25 MB limit");
      return;
    }

    setDeviceFile(file);
    const cleanName = file.name.replace(/\.[^/.]+$/, "");
    setDeviceTitle(cleanName);
    setDeviceArtist("My Audio");

    const objectUrl = URL.createObjectURL(file);
    setDeviceAudioPreviewUrl(objectUrl);

    // Read audio duration
    const tempAudio = new Audio(objectUrl);
    tempAudio.onloadedmetadata = () => {
      if (tempAudio.duration && !isNaN(tempAudio.duration)) {
        setDeviceDuration(Math.round(tempAudio.duration));
      }
    };
  };

  const handleUploadAndUseDeviceTrack = async () => {
    if (!deviceFile) {
      setDeviceError("Please pick an audio file first");
      return;
    }

    setIsUploadingDeviceAudio(true);
    setDeviceError(null);

    try {
      const formData = new FormData();
      formData.append("file", deviceFile);

      const headers: Record<string, string> = {};
      const authToken = token || localStorage.getItem("token");
      if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }

      const res = await fetch(`${apiUrl}/api/upload`, {
        method: "POST",
        headers,
        body: formData,
      });

      if (!res.ok) {
        throw new Error(`Upload failed with status ${res.status}`);
      }

      const data = await res.json();
      const uploadedUrl = data.url || data.media_url || data.file_url;
      if (!uploadedUrl) {
        throw new Error("Invalid response from server upload");
      }

      const unifiedTrack: MusicTrack = {
        title: deviceTitle.trim() || deviceFile.name,
        artist: deviceArtist.trim() || "Local Device",
        audio_url: uploadedUrl,
        duration_sec: deviceDuration || 60,
        source: "device",
        attribution: `Original device audio by ${deviceArtist.trim() || "User"}`,
      };

      handleSelect(unifiedTrack);
    } catch (err: any) {
      setDeviceError(err.message || "Failed to upload device audio file");
    } finally {
      setIsUploadingDeviceAudio(false);
    }
  };

  const formatDuration = (sec: number) => {
    if (!sec || isNaN(sec)) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  if (!isOpen) return null;

  return (
    <div
      className="music-picker-overlay"
      onClick={() => {
        stopPreview();
        onClose();
      }}
    >
      <div
        className="music-picker-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Select Soundtrack"
      >
        {/* Header */}
        <div className="music-picker-header">
          <div className="music-picker-header-title">
            <span className="music-picker-header-icon">🎵</span>
            <div>
              <h3>Choose Soundtrack</h3>
              <p>Add background music to your post or reel</p>
            </div>
          </div>
          <button
            type="button"
            className="music-picker-close-btn"
            onClick={() => {
              stopPreview();
              onClose();
            }}
            aria-label="Close music picker"
          >
            ✕
          </button>
        </div>

        {/* Tab Navigation: Library (Jamendo) vs My Device */}
        <div className="music-picker-tabs">
          <button
            type="button"
            className={`music-picker-tab-btn ${activeTab === "library" ? "active" : ""}`}
            onClick={() => {
              stopPreview();
              setActiveTab("library");
            }}
          >
            <span>🎶</span>
            <span>Music Library (Jamendo)</span>
          </button>
          <button
            type="button"
            className={`music-picker-tab-btn ${activeTab === "device" ? "active" : ""}`}
            onClick={() => {
              stopPreview();
              setActiveTab("device");
            }}
          >
            <span>📱</span>
            <span>My Device</span>
          </button>
        </div>

        {/* TAB 1: LIBRARY (JAMENDO CC MUSIC) */}
        {activeTab === "library" && (
          <>
            {/* Search input & Remove action */}
            <div className="music-picker-search-bar">
              <div className="music-search-field-wrap">
                <span className="music-search-icon">🔍</span>
                <input
                  type="text"
                  className="music-search-input"
                  placeholder="Search by song title or artist..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="music-search-clear-btn"
                    onClick={() => setSearchQuery("")}
                    title="Clear search"
                  >
                    ✕
                  </button>
                )}
              </div>

              {selectedTrackId && onRemoveMusic && (
                <button
                  type="button"
                  className="music-remove-current-btn"
                  onClick={handleRemove}
                  title="Remove current music attachment"
                >
                  <span>🗑️</span>
                  <span>Remove Music</span>
                </button>
              )}
            </div>

            {/* Genre filter tags */}
            <div className="music-genre-tags-row">
              {GENRE_TAGS.map((g) => (
                <button
                  key={g.label}
                  type="button"
                  className={`music-genre-tag-pill ${selectedGenre === g.value ? "active" : ""}`}
                  onClick={() => {
                    setSelectedGenre(g.value);
                  }}
                >
                  {g.label}
                </button>
              ))}
            </div>

            {/* Track listing body */}
            <div className="music-picker-body">
              {loading && (
                <div className="music-picker-state-wrap">
                  <div className="music-picker-spinner" />
                  <span>Loading royalty-free tracks...</span>
                </div>
              )}

              {!loading && error && (
                <div className="music-picker-state-wrap error">
                  <span style={{ fontSize: "28px" }}>⚠️</span>
                  <p>{error}</p>
                  <button
                    type="button"
                    className="music-picker-retry-btn"
                    onClick={() => setSearchQuery((q) => q + " ")}
                  >
                    Try Again
                  </button>
                </div>
              )}

              {!loading && !error && tracks.length === 0 && (
                <div className="music-picker-state-wrap empty">
                  <span style={{ fontSize: "36px" }}>🎼</span>
                  <h4>No tracks found</h4>
                  <p>
                    {searchQuery
                      ? `No tracks matching "${searchQuery}". Try a different keyword.`
                      : "No tracks are currently available."}
                  </p>
                </div>
              )}

              {!loading && !error && tracks.length > 0 && (
                <div className="music-tracks-scroll-list">
                  {tracks.map((track) => {
                    const trackKey = track.id || track.audio_url;
                    const isPreviewing = previewingTrackId === trackKey;
                    const isSelected = selectedTrackId === track.id || selectedTrackId === trackKey;

                    return (
                      <div
                        key={trackKey}
                        className={`music-track-card ${isSelected ? "selected" : ""} ${isPreviewing ? "previewing" : ""}`}
                      >
                        {/* Cover art with tap-to-audition */}
                        <div
                          className="music-track-cover"
                          onClick={() => toggleTrackPreview(track)}
                          title={isPreviewing ? "Pause 30s preview" : "Preview 30s"}
                        >
                          {track.cover_url ? (
                            <img src={track.cover_url} alt="" className="music-track-img" />
                          ) : (
                            <div className="music-track-fallback-cover">
                              <span>♪</span>
                            </div>
                          )}
                          <div className={`music-preview-overlay ${isPreviewing ? "active" : ""}`}>
                            {isPreviewing ? "⏸" : "▶"}
                          </div>
                        </div>

                        {/* Track info & attribution */}
                        <div
                          className="music-track-meta"
                          onClick={() => toggleTrackPreview(track)}
                          style={{ cursor: "pointer" }}
                        >
                          <div className="music-track-name-row">
                            <span className="music-track-name">{track.title}</span>
                            {isSelected && <span className="music-selected-badge">Current</span>}
                          </div>
                          <div className="music-track-sub-row">
                            <span className="music-track-artist">{track.artist}</span>
                            <span className="music-track-dot">·</span>
                            <span className="music-track-duration">{formatDuration(track.duration_sec)}</span>
                            {isPreviewing && <span className="music-previewing-tag">30s Previewing...</span>}
                          </div>
                          {track.license && (
                            <div className="music-track-license-badge">
                              <span>CC</span>
                              <span>{track.license}</span>
                            </div>
                          )}
                        </div>

                        {/* Action button */}
                        <div className="music-track-btn-wrap">
                          <button
                            type="button"
                            className={`music-use-sound-btn ${isSelected ? "chosen" : ""}`}
                            onClick={() => handleSelect(track)}
                            title="Use this sound"
                          >
                            {isSelected ? "Selected" : "Use Sound"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer attribution notice */}
            <div className="music-picker-footer">
              <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                Free, legal background music powered by Jamendo API (Creative Commons).
              </span>
              {onRemoveMusic && selectedTrackId && (
                <button
                  type="button"
                  className="music-footer-remove-link"
                  onClick={handleRemove}
                >
                  Remove sound
                </button>
              )}
            </div>
          </>
        )}

        {/* TAB 2: MY DEVICE (UPLOAD LOCAL AUDIO FILE) */}
        {activeTab === "device" && (
          <div className="music-device-tab-body">
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: "none" }}
              accept="audio/*,.mp3,.m4a,.wav,.ogg,.aac"
              onChange={handleDeviceFileChange}
            />

            {!deviceFile ? (
              <div
                className="music-device-dropzone"
                onClick={() => fileInputRef.current?.click()}
              >
                <span className="music-device-upload-icon">📁</span>
                <h4>Choose an audio file from your device</h4>
                <p>Supports MP3, M4A, WAV, OGG (Max 25 MB)</p>
                <button
                  type="button"
                  className="music-device-pick-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                >
                  Browse Device Files
                </button>
              </div>
            ) : (
              <div className="music-device-selected-card">
                <div className="music-device-file-header">
                  <span className="music-device-file-icon">🎵</span>
                  <div className="music-device-file-meta">
                    <span className="music-device-filename">{deviceFile.name}</span>
                    <span className="music-device-filesize">
                      {(deviceFile.size / (1024 * 1024)).toFixed(1)} MB
                      {deviceDuration > 0 ? ` • ${formatDuration(deviceDuration)}` : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="music-device-change-btn"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Change
                  </button>
                </div>

                {deviceAudioPreviewUrl && (
                  <div className="music-device-audio-player">
                    <audio
                      src={deviceAudioPreviewUrl}
                      controls
                      style={{ width: "100%", height: "36px", marginTop: "10px" }}
                    />
                  </div>
                )}

                <div className="music-device-fields">
                  <div>
                    <label className="music-device-label">Track Title</label>
                    <input
                      type="text"
                      className="music-search-input"
                      value={deviceTitle}
                      onChange={(e) => setDeviceTitle(e.target.value)}
                      placeholder="My Song Title"
                    />
                  </div>

                  <div>
                    <label className="music-device-label">Artist / Credit</label>
                    <input
                      type="text"
                      className="music-search-input"
                      value={deviceArtist}
                      onChange={(e) => setDeviceArtist(e.target.value)}
                      placeholder="Artist Name or Your Name"
                    />
                  </div>
                </div>

                {deviceError && (
                  <div className="music-device-error">
                    ⚠️ {deviceError}
                  </div>
                )}

                <div className="music-device-actions">
                  <button
                    type="button"
                    className="music-use-sound-btn chosen"
                    disabled={isUploadingDeviceAudio}
                    onClick={handleUploadAndUseDeviceTrack}
                    style={{ width: "100%", padding: "12px", fontSize: "14px", fontWeight: 700 }}
                  >
                    {isUploadingDeviceAudio ? "Uploading Audio..." : "Use This Song"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
