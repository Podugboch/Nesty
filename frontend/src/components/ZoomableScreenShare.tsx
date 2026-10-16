import React, { useState, useRef, useEffect, useCallback } from "react";

interface ZoomableScreenShareProps {
  stream: MediaStream | null;
  sharerName?: string;
  isMuted?: boolean;
  className?: string;
  onExpandFullscreen?: () => void;
  isFullscreen?: boolean;
  onCloseFullscreen?: () => void;
}

export const ZoomableScreenShare: React.FC<ZoomableScreenShareProps> = ({
  stream,
  sharerName = "Screen Share",
  isMuted = false,
  className = "",
  onExpandFullscreen,
  isFullscreen = false,
  onCloseFullscreen,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Zoom & Pan state
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [fitMode, setFitMode] = useState<"contain" | "cover">("contain");
  const [showControls, setShowControls] = useState(true);

  // Touch tracking refs
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const initialTouchDistRef = useRef<number | null>(null);
  const initialScaleRef = useRef(1);
  const lastTapTimeRef = useRef(0);
  const hideControlsTimerRef = useRef<any>(null);

  // Bind video stream
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

  // Auto-hide controls after inactivity on fullscreen
  const triggerShowControls = useCallback(() => {
    setShowControls(true);
    if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
    hideControlsTimerRef.current = setTimeout(() => {
      if (scale === 1 && !isFullscreen) {
        setShowControls(true);
      } else {
        setShowControls(false);
      }
    }, 4000);
  }, [scale, isFullscreen]);

  // Keep pan within bounds
  const clampPosition = useCallback(
    (x: number, y: number, currentScale: number) => {
      if (currentScale <= 1) return { x: 0, y: 0 };
      const container = containerRef.current;
      if (!container) return { x, y };
      const { clientWidth: width, clientHeight: height } = container;
      const maxX = ((width * (currentScale - 1)) / 2) + 60;
      const maxY = ((height * (currentScale - 1)) / 2) + 60;
      return {
        x: Math.max(-maxX, Math.min(maxX, x)),
        y: Math.max(-maxY, Math.min(maxY, y)),
      };
    },
    []
  );

  // Zoom helpers
  const zoomIn = () => {
    setScale((prev) => {
      const next = Math.min(prev + 0.5, 4);
      triggerShowControls();
      return next;
    });
  };

  const zoomOut = () => {
    setScale((prev) => {
      const next = Math.max(prev - 0.5, 1);
      if (next === 1) setPosition({ x: 0, y: 0 });
      triggerShowControls();
      return next;
    });
  };

  const resetZoom = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
    setFitMode("contain");
    triggerShowControls();
  };

  const toggleFitMode = () => {
    setFitMode((prev) => (prev === "contain" ? "cover" : "contain"));
    triggerShowControls();
  };

  // Touch Handlers for Pinch & Pan
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    triggerShowControls();
    if (e.touches.length === 2) {
      // 2 fingers: pinch gesture start
      isDraggingRef.current = false;
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      initialTouchDistRef.current = dist;
      initialScaleRef.current = scale;
    } else if (e.touches.length === 1) {
      // 1 finger: double tap check or pan start
      const now = Date.now();
      const timeSinceLastTap = now - lastTapTimeRef.current;
      if (timeSinceLastTap < 300) {
        // Double tap toggles zoom
        if (scale > 1.2) {
          resetZoom();
        } else {
          setScale(2.5);
          const touch = e.touches[0];
          const rect = containerRef.current?.getBoundingClientRect();
          if (rect) {
            const offsetX = (rect.width / 2 - (touch.clientX - rect.left)) * 1.5;
            const offsetY = (rect.height / 2 - (touch.clientY - rect.top)) * 1.5;
            setPosition(clampPosition(offsetX, offsetY, 2.5));
          }
        }
        lastTapTimeRef.current = 0;
        return;
      }
      lastTapTimeRef.current = now;

      if (scale > 1) {
        isDraggingRef.current = true;
        dragStartRef.current = {
          x: e.touches[0].clientX - position.x,
          y: e.touches[0].clientY - position.y,
        };
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2 && initialTouchDistRef.current !== null) {
      // Pinch to zoom
      e.preventDefault();
      const currentDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const factor = currentDist / initialTouchDistRef.current;
      const nextScale = Math.min(Math.max(1, initialScaleRef.current * factor), 4);
      setScale(nextScale);
      if (nextScale <= 1) {
        setPosition({ x: 0, y: 0 });
      }
    } else if (e.touches.length === 1 && isDraggingRef.current && scale > 1) {
      // Pan
      e.preventDefault();
      const newX = e.touches[0].clientX - dragStartRef.current.x;
      const newY = e.touches[0].clientY - dragStartRef.current.y;
      setPosition(clampPosition(newX, newY, scale));
    }
  };

  const handleTouchEnd = () => {
    isDraggingRef.current = false;
    initialTouchDistRef.current = null;
  };

  // Mouse Handlers for Desktop Drag & Wheel Zoom
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (scale > 1 && e.button === 0) {
      isDraggingRef.current = true;
      dragStartRef.current = {
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      };
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    triggerShowControls();
    if (isDraggingRef.current && scale > 1) {
      const newX = e.clientX - dragStartRef.current.x;
      const newY = e.clientY - dragStartRef.current.y;
      setPosition(clampPosition(newX, newY, scale));
    }
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    triggerShowControls();
    const delta = -e.deltaY * 0.002;
    setScale((prev) => {
      const next = Math.min(Math.max(1, prev + delta), 4);
      if (next === 1) setPosition({ x: 0, y: 0 });
      return next;
    });
  };

  return (
    <div
      ref={containerRef}
      className={`screen-share-zoom-container ${isFullscreen ? "fullscreen-theater" : ""} ${className}`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
      style={{ touchAction: scale > 1 ? "none" : "auto" }}
    >
      {/* Scalable video wrapper */}
      <div
        className="screen-share-viewport"
        style={{
          transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
          transformOrigin: "center center",
          transition: isDraggingRef.current ? "none" : "transform 0.15s ease-out",
          cursor: scale > 1 ? (isDraggingRef.current ? "grabbing" : "grab") : "default",
        }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isMuted}
          aria-label={sharerName}
          title={sharerName}
          className={`screen-share-video-tag ${fitMode === "cover" ? "fit-fill" : "fit-contain"}`}
        />
      </div>

      {/* Floating Zoom & Resolution Tool Dock */}
      <div className={`screen-share-toolbar ${showControls ? "visible" : "hidden"}`}>
        <div className="screen-share-controls-left">
          <span className="screen-share-zoom-badge">
            {Math.round(scale * 100)}%
          </span>

          <button
            type="button"
            className="screen-share-ctrl-btn"
            onClick={zoomIn}
            title="Zoom In (+)"
          >
            ➕
          </button>

          <button
            type="button"
            className="screen-share-ctrl-btn"
            onClick={zoomOut}
            title="Zoom Out (-)"
            disabled={scale <= 1}
          >
            ➖
          </button>

          {scale > 1 && (
            <button
              type="button"
              className="screen-share-ctrl-btn reset-btn"
              onClick={resetZoom}
              title="Reset Zoom (1x)"
            >
              ↺ 1x
            </button>
          )}

          <button
            type="button"
            className={`screen-share-ctrl-btn fit-btn ${fitMode === "cover" ? "active" : ""}`}
            onClick={toggleFitMode}
            title={fitMode === "contain" ? "Fit to Width" : "Fit to Screen"}
          >
            {fitMode === "contain" ? "↔ Fit Width" : "↕ Fit Screen"}
          </button>
        </div>

        <div className="screen-share-controls-right">
          {onExpandFullscreen && !isFullscreen && (
            <button
              type="button"
              className="screen-share-ctrl-btn fullscreen-btn"
              onClick={onExpandFullscreen}
              title="Expand to Fullscreen Theater"
            >
              ⛶ Maximize
            </button>
          )}

          {isFullscreen && onCloseFullscreen && (
            <button
              type="button"
              className="screen-share-ctrl-btn close-fullscreen-btn"
              onClick={onCloseFullscreen}
              title="Exit Fullscreen"
            >
              ✕ Exit
            </button>
          )}
        </div>
      </div>

      {/* Mobile Hint Overlay when Zoomed or Idle */}
      {scale > 1 && (
        <div className="screen-share-drag-hint">
          <span>🖐️ Drag to pan • Pinch to zoom</span>
        </div>
      )}
    </div>
  );
};
