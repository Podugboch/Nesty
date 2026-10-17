import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type {
  LiveStream,
  LiveGuest,
  HandRaiseItem,
  LiveChatMessageItem,
  FloatingParticle,
  ChatSettings,
} from "../types/live";
import { MeshStreamTransport, type StreamTransport } from "../utils/streamTransport";
import { saveChunkLocally } from "../utils/replayDb";

interface LiveStudioModalProps {
  // If null or live.host_id === user.id => Host mode. If viewer => live stream details
  initialLive?: LiveStream | null;
  currentUser: {
    id: number;
    username: string;
    name?: string;
    avatar_url?: string;
    role?: string;
  } | null;
  apiUrl: string;
  authToken: string;
  wsRef: React.MutableRefObject<WebSocket | null>;
  iceServers?: RTCIceServer[];
  onClose: () => void;
  onStreamEnded?: (liveId: number, recordedBlob?: Blob | null) => void;
  onReport?: (targetType: string, targetId: number) => void;
}

const REACTION_EMOJIS = [
  { type: "heart", emoji: "❤️" },
  { type: "fire", emoji: "🔥" },
  { type: "clap", emoji: "👏" },
  { type: "laugh", emoji: "😂" },
  { type: "wow", emoji: "😮" },
];

export const LiveStudioModal: React.FC<LiveStudioModalProps> = ({
  initialLive,
  currentUser,
  apiUrl,
  authToken,
  wsRef,
  iceServers,
  onClose,
  onStreamEnded,
  onReport,
}) => {
  const isHost = !initialLive || (currentUser && Number(initialLive.host_id) === Number(currentUser.id));
  const [liveData, setLiveData] = useState<LiveStream | null>(initialLive || null);
  const liveDataRef = useRef<LiveStream | null>(initialLive || null);
  useEffect(() => {
    liveDataRef.current = liveData;
  }, [liveData]);

  const [myRole, setMyRole] = useState<"host" | "moderator" | "guest" | "viewer">(
    isHost ? "host" : "viewer"
  );
  const [hostStream, setHostStream] = useState<MediaStream | null>(null);
  const [isAutoplayMuted, setIsAutoplayMuted] = useState(!isHost);
  const [isCleanView, setIsCleanView] = useState(false);

  // PRE-BROADCAST SETUP (Host only)
  const [isPreLive, setIsPreLive] = useState<boolean>(!initialLive);
  const [setupTitle, setSetupTitle] = useState(initialLive?.title || "🔴 Live Broadcast & Hangout");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitleInput, setEditingTitleInput] = useState(initialLive?.title || "🔴 Live Broadcast & Hangout");
  const [settingsTitleInput, setSettingsTitleInput] = useState(initialLive?.title || "🔴 Live Broadcast & Hangout");
  const [setupNotifyFollowers, setSetupNotifyFollowers] = useState(true);
  const [setupSaveReplay, setSetupSaveReplay] = useState(true);
  const [setupChatSettings, setSetupChatSettings] = useState<ChatSettings>({
    chat_enabled: initialLive?.chat_settings?.chat_enabled ?? true,
    slow_mode: initialLive?.chat_settings?.slow_mode ?? 0,
    followers_only: initialLive?.chat_settings?.followers_only ?? false,
    blocked_words: initialLive?.chat_settings?.blocked_words ?? [],
  });
  const [blockedWordInput, setBlockedWordInput] = useState("");
  const [inLiveBlockedWordInput, setInLiveBlockedWordInput] = useState("");

  // Helper to detect blocked words in chat
  const containsBlockedWord = (text: string, blockedList: string[]): boolean => {
    if (!text || !blockedList || blockedList.length === 0) return false;
    const lower = text.toLowerCase();
    const normalized = lower.replace(/[^a-z0-9\s]/g, "");
    return blockedList.some((w) => {
      const clean = w.trim().toLowerCase();
      if (!clean) return false;
      return lower.includes(clean) || normalized.includes(clean);
    });
  };

  // BROADCAST METRICS
  const [viewerCount, setViewerCount] = useState<number>(initialLive?.viewer_count || 1);
  const [streamDuration, setStreamDuration] = useState<number>(0);
  const [totalReactions, setTotalReactions] = useState<number>(initialLive?.total_reactions || 0);

  // MEDIA CONTROLS
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [videoFit, setVideoFit] = useState<"contain" | "cover">("contain");
  const [hostReconnectedNotice, setHostReconnectedNotice] = useState<string | null>(null);

  // MOBILE ORIENTATION (Default to portrait on mobile, toggleable to landscape)
  const isMobile = typeof window !== "undefined" && (window.innerWidth <= 768 || !!(window as any).AndroidCallBridge || !!(window as any).Capacitor?.isNativePlatform?.());
  const [orientationMode, setOrientationMode] = useState<"portrait" | "landscape">("portrait");
  const [isMobilePresentModalOpen, setIsMobilePresentModalOpen] = useState(false);
  const presentFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isMobile) {
      setOrientationMode("portrait");
      if ((window as any).AndroidCallBridge?.setOrientation) {
        (window as any).AndroidCallBridge.setOrientation("portrait");
      } else if ((screen.orientation as any)?.lock) {
        (screen.orientation as any).lock("portrait").catch(() => {});
      }
    }

    return () => {
      if (isMobile) {
        if ((window as any).AndroidCallBridge?.setOrientation) {
          (window as any).AndroidCallBridge.setOrientation("unspecified");
        } else if ((screen.orientation as any)?.unlock) {
          (screen.orientation as any).unlock?.();
        }
      }
    };
  }, [isMobile]);

  const handleToggleOrientation = () => {
    const next = orientationMode === "portrait" ? "landscape" : "portrait";
    setOrientationMode(next);
    if ((window as any).AndroidCallBridge?.setOrientation) {
      (window as any).AndroidCallBridge.setOrientation(next);
    } else if ((screen.orientation as any)?.lock) {
      (screen.orientation as any).lock(next).catch(() => {});
    }
  };

  // STAGE & GUESTS (Max 3 guests)
  const [guests, setGuests] = useState<LiveGuest[]>([]);
  const [handQueue, setHandQueue] = useState<HandRaiseItem[]>([]);
  const [isHandRaised, setIsHandRaised] = useState(false);
  const [stageInviteModal, setStageInviteModal] = useState<{
    liveId: number;
    hostId: number;
    audioOnly: boolean;
  } | null>(null);
  const [stageQueueModalOpen, setStageQueueModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);

  // CHAT
  const [chatMessages, setChatMessages] = useState<LiveChatMessageItem[]>([]);

  // Filter out any messages matching blocked words so they are completely hidden from everyone
  const visibleMessages = useMemo(() => {
    return chatMessages.filter(
      (msg) => !containsBlockedWord(msg.text, setupChatSettings.blocked_words)
    );
  }, [chatMessages, setupChatSettings.blocked_words]);
  const [chatInput, setChatInput] = useState("");
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [slowModeSecondsLeft, setSlowModeSecondsLeft] = useState(0);
  const [chatError, setChatError] = useState<string | null>(null);
  const [activeMessageAction, setActiveMessageAction] = useState<LiveChatMessageItem | null>(null);

  // REACTIONS & PARTICLES
  const [particles, setParticles] = useState<FloatingParticle[]>([]);
  const lastReactionTapRef = useRef<number[]>([]);

  // MEDIA & TRANSPORT REFS
  const hostVideoRef = useRef<HTMLVideoElement | null>(null);
  const localMediaStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const transportRef = useRef<StreamTransport | null>(null);

  // MEDIA RECORDER FOR REPLAY
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const chunkIndexRef = useRef<number>(0);
  const totalRecordedBytesRef = useRef<number>(0);
  const MAX_RECORDING_BYTES = 500 * 1024 * 1024; // 500 MB max

  // Duration timer
  useEffect(() => {
    if (isPreLive) return;
    const interval = setInterval(() => {
      setStreamDuration((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isPreLive]);

  // Slow mode countdown timer
  useEffect(() => {
    if (slowModeSecondsLeft <= 0) return;
    const timer = setInterval(() => {
      setSlowModeSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [slowModeSecondsLeft]);

  // Setup StreamTransport
  const initTransport = useCallback(
    async (streamToSend?: MediaStream, explicitLiveId?: number) => {
      if (!currentUser) return;
      const transport = new MeshStreamTransport(currentUser.id);
      transportRef.current = transport;

      await transport.init(
        {
          onRemoteTrack: (track, stream, peerId) => {
            console.log(`[LiveStudio] Remote ${track.kind} track received from peer ${peerId}`);
            const currentLive = liveDataRef.current || liveData;
            const isHostTrack = currentLive
              ? Number(peerId) === Number(currentLive.host_id)
              : !isHost;

            if (isHostTrack) {
              setHostStream(stream);
              if (hostVideoRef.current) {
                if (hostVideoRef.current.srcObject !== stream) {
                  hostVideoRef.current.srcObject = stream;
                }
                hostVideoRef.current.play().catch((err) => {
                  console.warn("[LiveStudio] Remote stream play error:", err);
                  if (!isHost && hostVideoRef.current) {
                    hostVideoRef.current.muted = true;
                    setIsAutoplayMuted(true);
                    hostVideoRef.current.play().catch(() => {});
                  }
                });
              }
            } else {
              setGuests((prev) =>
                prev.map((g) => (g.user_id === peerId ? { ...g, stream } : g))
              );
            }
          },
          onPeerLeave: (peerId) => {
            setGuests((prev) => prev.filter((g) => g.user_id !== peerId));
          },
          sendSignal: (toUserId, signal) => {
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              const currentLid = explicitLiveId || liveDataRef.current?.id || liveData?.id || 0;
              wsRef.current.send(
                JSON.stringify({
                  event: "live_signal",
                  type: "live_signal",
                  live_id: currentLid,
                  to_user_id: toUserId,
                  ...signal,
                })
              );
            }
          },
        },
        iceServers
      );

      if (streamToSend) {
        await transport.publishStream(streamToSend);
      }
    },
    [currentUser, iceServers, liveData, wsRef, isHost]
  );

  // Periodic stream request retry if viewer hasn't received host stream yet
  useEffect(() => {
    if (isHost || !liveData?.id || hostStream) return;
    const interval = setInterval(() => {
      const hostId = liveDataRef.current?.host_id || liveData.host_id;
      if (hostId && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "live_request_stream",
            live_id: liveData.id,
            to_user_id: hostId,
          })
        );
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [isHost, liveData?.id, hostStream, wsRef]);

  // 1. Setup preview camera stream for host pre-live
  useEffect(() => {
    if (isHost && isPreLive) {
      let active = true;
      navigator.mediaDevices
        ?.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
          audio: { echoCancellation: true, noiseSuppression: true },
        })
        .then((stream) => {
          if (active) {
            localMediaStreamRef.current = stream;
            setHostStream(stream);
            if (hostVideoRef.current) {
              hostVideoRef.current.srcObject = stream;
              hostVideoRef.current.play().catch(() => {});
            }
          }
        })
        .catch((err) => {
          console.warn("Failed to get preview stream:", err);
        });

      return () => {
        active = false;
      };
    }
  }, [isHost, isPreLive]);

  // 2. Ensure host acquires camera/mic if entering an already-active live
  useEffect(() => {
    if (isHost && !isPreLive && !localMediaStreamRef.current) {
      navigator.mediaDevices
        ?.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
          audio: { echoCancellation: true, noiseSuppression: true },
        })
        .then(async (stream) => {
          localMediaStreamRef.current = stream;
          setHostStream(stream);
          if (hostVideoRef.current) {
            hostVideoRef.current.srcObject = stream;
            hostVideoRef.current.play().catch(() => {});
          }
          await initTransport(stream);
        })
        .catch((err) => {
          console.warn("Failed to get host stream for active broadcast:", err);
        });
    }
  }, [isHost, isPreLive, initTransport]);

  // 3. Initialize transport for viewers when entering live
  useEffect(() => {
    if (!isHost && liveData?.id) {
      initTransport();
    }
  }, [isHost, liveData?.id, initTransport]);

  // 4. Continuously ensure hostVideoRef attaches active stream
  useEffect(() => {
    const stream = isHost ? (localMediaStreamRef.current || hostStream) : hostStream;
    if (hostVideoRef.current && stream) {
      if (hostVideoRef.current.srcObject !== stream) {
        hostVideoRef.current.srcObject = stream;
      }
      hostVideoRef.current.play().catch((err) => {
        console.warn("[LiveStudio] Active video play error:", err);
        if (!isHost && hostVideoRef.current) {
          hostVideoRef.current.muted = true;
          setIsAutoplayMuted(true);
          hostVideoRef.current.play().catch(() => {});
        }
      });
    }
  }, [hostStream, isPreLive, isHost]);

  // Send WebSocket join when entering live session
  useEffect(() => {
    if (liveData?.id && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "live_join",
          live_id: liveData.id,
        })
      );
    }

    return () => {
      if (liveData?.id && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "live_leave",
            live_id: liveData.id,
          })
        );
      }
    };
  }, [liveData?.id, wsRef]);

  // WebSocket message listener for Live events
  useEffect(() => {
    const handleWsMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (!data) return;

        // Verify message belongs to this live session
        if (data.live_id && liveData && Number(data.live_id) !== Number(liveData.id)) {
          return;
        }

        switch (data.type) {
          case "live_room_state":
            setViewerCount(data.viewer_count || 1);
            setTotalReactions(data.total_reactions || 0);
            if (data.role) setMyRole(data.role);
            if (data.guests) setGuests(data.guests);
            if (data.hand_queue) setHandQueue(data.hand_queue);
            if (data.chat_settings) setSetupChatSettings(data.chat_settings);

            // Viewer requests stream from host
            if (!isHost && data.host_id && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(
                JSON.stringify({
                  type: "live_request_stream",
                  live_id: liveData?.id || data.live_id,
                  to_user_id: data.host_id,
                })
              );
            }
            break;

          case "live_viewer_joined": {
            const viewerId = Number(data.user_id || data.from_user_id);
            if (isHost && viewerId && viewerId !== Number(currentUser?.id) && transportRef.current) {
              console.log("[LiveStudio] Host initiating WebRTC connection to viewer:", viewerId);
              transportRef.current.connectToPeer(viewerId, true);
            }
            break;
          }

          case "live_viewer_count":
            setViewerCount(data.viewer_count || 1);
            break;

          case "live_reactions_batch":
            if (data.total_reactions) setTotalReactions(data.total_reactions);
            if (data.counts) {
              triggerReactionParticles(data.counts);
            }
            break;

          case "live_title_updated":
            if (data.title) {
              setLiveData((prev) => (prev ? { ...prev, title: data.title } : null));
              setSetupTitle(data.title);
              setEditingTitleInput(data.title);
              setSettingsTitleInput(data.title);
            }
            break;

          case "live_chat_message":
            if (data.message && !containsBlockedWord(data.message.text, setupChatSettings.blocked_words)) {
              setChatMessages((prev) => [...prev, data.message]);
            }
            break;

          case "live_chat_deleted":
            if (data.message_id) {
              setChatMessages((prev) => prev.filter((m) => m.id !== data.message_id));
            }
            break;

          case "live_chat_settings_updated":
            if (data.chat_settings) {
              setSetupChatSettings(data.chat_settings);
            }
            break;

          case "live_hand_queue_update":
            if (data.hand_queue) {
              setHandQueue(data.hand_queue);
            }
            break;

          case "live_stage_guests_update":
            if (data.guests) {
              setGuests(data.guests);
              if ((isHost || myRole === "guest") && transportRef.current) {
                data.guests.forEach((g: LiveGuest) => {
                  if (Number(g.user_id) !== Number(currentUser?.id)) {
                    transportRef.current?.connectToPeer(g.user_id, true);
                  }
                });
              }
            }
            break;

          case "live_stage_invited":
            setStageInviteModal({
              liveId: data.live_id,
              hostId: data.host_id,
              audioOnly: !!data.audio_only,
            });
            break;

          case "live_stage_removed":
            // Demoted back to audience
            if (transportRef.current) {
              transportRef.current.unpublishStream();
            }
            setMyRole("viewer");
            alert("You have been moved back to the audience.");
            break;

          case "live_user_timed_out":
            if (currentUser && Number(data.target_user_id) === Number(currentUser.id)) {
              alert(`You have been timed out from this live for ${data.duration_seconds} seconds.`);
              setSlowModeSecondsLeft(data.duration_seconds || 60);
            }
            break;

          case "live_user_removed":
            alert("You were removed from this live by a moderator.");
            onClose();
            break;

          case "live_role_updated":
            if (currentUser && Number(data.target_user_id) === Number(currentUser.id)) {
              setMyRole(data.role);
            }
            break;

          case "live_host_status":
            if (!data.connected) {
              setHostReconnectedNotice(data.message || "Host disconnected. Waiting up to 60s...");
            } else {
              setHostReconnectedNotice(null);
            }
            break;

          case "live_ended":
            alert("This live stream has ended. Thank you for watching!");
            if (onStreamEnded && liveData) {
              onStreamEnded(liveData.id);
            }
            onClose();
            break;

          case "live_signal": {
            const fromId = Number(data.from_user_id || data.fromUserId);
            if (transportRef.current && fromId) {
              transportRef.current.handleSignal(fromId, data);
            }
            break;
          }

          case "live_error":
            alert(data.message || "Live stream error");
            break;
        }
      } catch (err) {
        console.warn("Live Studio WS parse error:", err);
      }
    };

    const ws = wsRef.current;
    if (ws) {
      ws.addEventListener("message", handleWsMessage);
    }
    return () => {
      if (ws) {
        ws.removeEventListener("message", handleWsMessage);
      }
    };
  }, [liveData, wsRef, currentUser, onStreamEnded, onClose]);

  // Update broadcast title mid-stream
  const handleUpdateTitle = async (newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed || !liveData?.id) return;
    setSetupTitle(trimmed);
    setEditingTitleInput(trimmed);
    setSettingsTitleInput(trimmed);
    setLiveData((prev) => (prev ? { ...prev, title: trimmed } : null));
    setIsEditingTitle(false);

    // 1. WebSocket real-time update to all room members
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "live_update_title",
          live_id: liveData.id,
          title: trimmed,
        })
      );
    }

    // 2. REST API update fallback
    try {
      await fetch(`${apiUrl}/api/lives/${liveData.id}/title`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ title: trimmed }),
      });
    } catch (err) {
      console.warn("[LiveStudio] API title update error:", err);
    }
  };

  // Host starts broadcast
  const handleStartBroadcast = async () => {
    try {
      let stream = localMediaStreamRef.current;
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        localMediaStreamRef.current = stream;
        if (hostVideoRef.current) {
          hostVideoRef.current.srcObject = stream;
        }
      }

      setHostStream(stream);

      // Auto-include any typed blocked word that wasn't committed with Add button
      let finalBlockedWords = [...setupChatSettings.blocked_words];
      if (blockedWordInput.trim()) {
        const cleanNew = blockedWordInput.trim().toLowerCase();
        if (!finalBlockedWords.includes(cleanNew)) {
          finalBlockedWords.push(cleanNew);
        }
        setBlockedWordInput("");
      }
      const finalChatSettings: ChatSettings = {
        ...setupChatSettings,
        blocked_words: finalBlockedWords,
      };
      setSetupChatSettings(finalChatSettings);

      // API request to create live
      const res = await fetch(`${apiUrl}/api/lives`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          title: setupTitle.trim() || "🔴 Live Broadcast",
          notify_followers: setupNotifyFollowers,
          save_replay: setupSaveReplay,
          chat_settings: finalChatSettings,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to start broadcast");
      }

      const created = await res.json();
      liveDataRef.current = created.live;
      setLiveData(created.live);
      setMyRole("host");
      setIsPreLive(false);

      // Initialize media transport with explicit live ID
      await initTransport(stream, created.live.id);

      // Double-check stream attachment to newly mounted active video element
      setTimeout(() => {
        if (hostVideoRef.current && stream) {
          if (hostVideoRef.current.srcObject !== stream) {
            hostVideoRef.current.srcObject = stream;
          }
          hostVideoRef.current.play().catch(() => {});
        }
      }, 60);

      // If save replay was enabled, begin MediaRecorder chunking every 5s
      if (setupSaveReplay && stream) {
        startMediaRecording(created.live.id, stream);
      }
    } catch (err: any) {
      console.error("Start broadcast error:", err);
      alert(err.message || "Camera or microphone permission is required to Go Live.");
    }
  };

  // MediaRecorder chunked recording every 5s
  const startMediaRecording = (liveId: number, stream: MediaStream) => {
    try {
      recordedChunksRef.current = [];
      chunkIndexRef.current = 0;
      totalRecordedBytesRef.current = 0;

      let mimeType = "video/webm;codecs=vp8,opus";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = "video/mp4";
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = "";
        }
      }

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = async (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
          totalRecordedBytesRef.current += e.data.size;

          const idx = chunkIndexRef.current++;

          // 1. Save locally in IndexedDB for resilience
          await saveChunkLocally(liveId, idx, e.data);

          // 2. Upload chunk in background
          const formData = new FormData();
          formData.append("chunk", e.data, `chunk_${idx}.part`);
          formData.append("chunk_index", idx.toString());

          fetch(`${apiUrl}/api/lives/${liveId}/replay/chunk`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${authToken}`,
            },
            body: formData,
          }).catch((err) => {
            console.warn(`[Replay] Failed to upload chunk ${idx}:`, err);
          });

          // Check max recording size
          if (totalRecordedBytesRef.current >= MAX_RECORDING_BYTES) {
            recorder.stop();
            alert("Maximum recording size limit (500 MB) reached. Recording stopped, but live will continue.");
          }
        }
      };

      // Request data every 5000ms (5 seconds)
      recorder.start(5000);
    } catch (err) {
      console.warn("Failed to initialize MediaRecorder:", err);
    }
  };

  // End stream
  const handleEndStream = async () => {
    if (!window.confirm("Are you sure you want to end this live broadcast?")) {
      return;
    }

    // Stop recording if active
    let assembledBlob: Blob | null = null;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      if (recordedChunksRef.current.length > 0) {
        assembledBlob = new Blob(recordedChunksRef.current, {
          type: recordedChunksRef.current[0].type || "video/webm",
        });
      }
    }

    // Stop local tracks
    if (localMediaStreamRef.current) {
      localMediaStreamRef.current.getTracks().forEach((t) => t.stop());
      localMediaStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    if (transportRef.current) {
      transportRef.current.destroy();
    }

    if (liveData?.id) {
      try {
        await fetch(`${apiUrl}/api/lives/${liveData.id}/end`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        });
      } catch {}
    }

    if (onStreamEnded && liveData) {
      onStreamEnded(liveData.id, assembledBlob);
    }
    onClose();
  };

  // Chat sending
  const handleSendChatMessage = () => {
    const text = chatInput.trim();
    if (!text) return;
    if (slowModeSecondsLeft > 0) {
      setChatError(`Slow mode: wait ${slowModeSecondsLeft}s`);
      return;
    }

    if (containsBlockedWord(text, setupChatSettings.blocked_words)) {
      setChatError("Message contains words blocked by the host");
      return;
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && liveData?.id) {
      wsRef.current.send(
        JSON.stringify({
          type: "live_chat",
          live_id: liveData.id,
          text: text,
        })
      );
      setChatInput("");
      setChatError(null);

      if (setupChatSettings.slow_mode > 0 && myRole === "viewer") {
        setSlowModeSecondsLeft(setupChatSettings.slow_mode);
      }
    }
  };

  // Reactions with client rate-limiting
  const handleTapReaction = (reactionType: string) => {
    const now = Date.now();
    const oneSecAgo = now - 1000;

    // Client rate-limit: 5 taps per second
    const taps = lastReactionTapRef.current.filter((t) => t > oneSecAgo);
    if (taps.length >= 5) {
      return;
    }
    taps.push(now);
    lastReactionTapRef.current = taps;

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && liveData?.id) {
      wsRef.current.send(
        JSON.stringify({
          type: "live_reaction",
          live_id: liveData.id,
          reaction: reactionType,
        })
      );
    }

    // Trigger local particle immediately for responsive tactile feel
    const match = REACTION_EMOJIS.find((r) => r.type === reactionType);
    if (match) {
      spawnFloatingParticle(match.emoji);
    }
  };

  const spawnFloatingParticle = (emoji: string) => {
    setParticles((prev) => {
      // Max 30 particles on screen to protect low-end devices
      const trimmed = prev.slice(-29);
      const newParticle: FloatingParticle = {
        id: `${Date.now()}-${Math.random()}`,
        emoji,
        leftPercent: 65 + Math.random() * 25, // Bottom right quadrant
        bottomPercent: 12 + Math.random() * 5,
        scale: 0.8 + Math.random() * 0.4,
        wobbleX: (Math.random() - 0.5) * 40,
      };
      return [...trimmed, newParticle];
    });
  };

  const triggerReactionParticles = (counts: Record<string, number>) => {
    Object.entries(counts).forEach(([rtype, count]) => {
      const match = REACTION_EMOJIS.find((r) => r.type === rtype);
      if (match) {
        const particlesToSpawn = Math.min(count, 4);
        for (let i = 0; i < particlesToSpawn; i++) {
          setTimeout(() => spawnFloatingParticle(match.emoji), i * 80);
        }
      }
    });
  };

  // Clean particles after animation finishes
  useEffect(() => {
    if (particles.length === 0) return;
    const timer = setTimeout(() => {
      setParticles((prev) => prev.slice(1));
    }, 2000);
    return () => clearTimeout(timer);
  }, [particles]);

  // Raise / Lower Hand
  const toggleRaiseHand = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !liveData?.id) return;
    if (isHandRaised) {
      wsRef.current.send(
        JSON.stringify({
          type: "live_hand_lower",
          live_id: liveData.id,
        })
      );
      setIsHandRaised(false);
    } else {
      wsRef.current.send(
        JSON.stringify({
          type: "live_hand_raise",
          live_id: liveData.id,
        })
      );
      setIsHandRaised(true);
    }
  };

  // Accept stage invite
  const handleAcceptStage = async (audioOnly: boolean) => {
    if (!stageInviteModal || !liveData) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: audioOnly ? false : { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
      });

      localMediaStreamRef.current = stream;
      if (transportRef.current) {
        await transportRef.current.publishStream(stream);
      } else {
        await initTransport(stream);
      }

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "live_stage_accept",
            live_id: liveData.id,
            audio_only: audioOnly,
          })
        );
      }

      setMyRole("guest");
      setStageInviteModal(null);
    } catch (err) {
      console.error("Stage join error:", err);
      alert("Camera or microphone permission was denied. Returned to audience.");
      setStageInviteModal(null);
    }
  };

  const handleDeclineStage = () => {
    if (!stageInviteModal || !liveData) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "live_stage_decline",
          live_id: liveData.id,
        })
      );
    }
    setStageInviteModal(null);
  };

  // Leave stage (for guest)
  const handleLeaveStage = () => {
    if (transportRef.current) {
      transportRef.current.unpublishStream();
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && liveData?.id) {
      wsRef.current.send(
        JSON.stringify({
          type: "live_stage_remove",
          live_id: liveData.id,
          target_user_id: currentUser?.id,
        })
      );
    }
    setMyRole("viewer");
  };

  // Start active screen/presentation stream
  const startActiveScreenShare = (scr: MediaStream) => {
    screenStreamRef.current = scr;
    setHostStream(scr);
    if (hostVideoRef.current) {
      hostVideoRef.current.srcObject = scr;
      hostVideoRef.current.play().catch(() => {});
    }
    if (transportRef.current) {
      transportRef.current.publishStream(scr);
    }
    scr.getVideoTracks()[0].onended = () => {
      stopScreenShare();
    };
    setIsScreenSharing(true);
  };

  const stopScreenShare = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    const camStream = localMediaStreamRef.current;
    if (camStream) {
      setHostStream(camStream);
      if (hostVideoRef.current) {
        hostVideoRef.current.srcObject = camStream;
        hostVideoRef.current.play().catch(() => {});
      }
      if (transportRef.current) {
        transportRef.current.publishStream(camStream);
      }
    }
    setIsScreenSharing(false);
  };

  // Screen share toggle
  const handleToggleScreenShare = async () => {
    if (isScreenSharing) {
      stopScreenShare();
      return;
    }

    // 1. Try standard getDisplayMedia (supported on desktop and Android Chrome)
    if (navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === "function") {
      try {
        const scr = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        startActiveScreenShare(scr);
        return;
      } catch (err: any) {
        console.warn("[LiveStudio] getDisplayMedia error:", err);
        if (err.name === "NotAllowedError" || err.name === "AbortError") {
          return;
        }
      }
    }

    // 2. Fallback on mobile/webview: open mobile presentation modal
    setIsMobilePresentModalOpen(true);
  };

  // Mobile Presentation: Rear Camera
  const handlePresentRearCamera = async () => {
    try {
      let rearStream: MediaStream;
      try {
        rearStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { exact: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch {
        rearStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
      }
      setIsMobilePresentModalOpen(false);
      startActiveScreenShare(rearStream);
    } catch (err) {
      alert("Could not access rear camera for presentation.");
    }
  };

  // Mobile Presentation: Document / Slide Image via Canvas Stream
  const handlePresentDocument = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Draw image centered with aspect ratio fitting
        ctx.fillStyle = "#0a0f1d";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const hRatio = canvas.width / img.width;
        const vRatio = canvas.height / img.height;
        const ratio = Math.min(hRatio, vRatio);
        const centerShiftX = (canvas.width - img.width * ratio) / 2;
        const centerShiftY = (canvas.height - img.height * ratio) / 2;
        ctx.drawImage(img, 0, 0, img.width, img.height, centerShiftX, centerShiftY, img.width * ratio, img.height * ratio);

        // Capture 30fps canvas stream as presentation video track
        const canvasStream = (canvas as any).captureStream ? (canvas as any).captureStream(30) : null;
        if (canvasStream) {
          setIsMobilePresentModalOpen(false);
          startActiveScreenShare(canvasStream);
        } else {
          alert("Canvas stream capture is not supported on this browser.");
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  return (
    <div className="live-broadcast-overlay">
      <div className={`live-broadcast-container ${orientationMode === "portrait" ? "mode-portrait" : "mode-landscape"} ${isCleanView ? "clean-view-mode" : ""}`}>
        {/* ===================================================================
            PRE-LIVE SETUP SCREEN (HOST ONLY)
            =================================================================== */}
        {isHost && isPreLive ? (
          <div className="live-pre-setup-view">
            <div className="live-pre-header">
              <span className="live-pre-badge">● PRE-BROADCAST STUDIO</span>
              <h2>Ready to go live on Nesty?</h2>
            </div>

            <div className="live-pre-content-grid">
              {/* CAMERA PREVIEW */}
              <div className="live-pre-video-box">
                <video
                  ref={(el) => {
                    if (el) {
                      const st = localMediaStreamRef.current || hostStream;
                      if (st && el.srcObject !== st) {
                        el.srcObject = st;
                      }
                      if (st) el.play().catch(() => {});
                    }
                  }}
                  autoPlay
                  playsInline
                  muted
                  className="live-pre-video-element"
                />
                <div className="live-pre-video-tag">Camera & Mic Preview</div>
              </div>

              {/* SETTINGS CARD */}
              <div className="live-pre-form-card">
                <div className="live-form-group">
                  <label htmlFor="live-setup-title">Broadcast Topic</label>
                  <input
                    id="live-setup-title"
                    type="text"
                    className="live-setup-input"
                    placeholder="What are you streaming about?"
                    value={setupTitle}
                    onChange={(e) => setSetupTitle(e.target.value)}
                  />
                </div>

                <div className="live-toggles-grid">
                  <label className="live-toggle-row">
                    <div>
                      <strong>Notify Followers</strong>
                      <small>Send in-app & push alert when you go live</small>
                    </div>
                    <input
                      type="checkbox"
                      checked={setupNotifyFollowers}
                      onChange={(e) => setSetupNotifyFollowers(e.target.checked)}
                    />
                  </label>

                  <label className="live-toggle-row">
                    <div>
                      <strong>Save Replay</strong>
                      <small>Keep recording to publish as post/reel afterwards</small>
                    </div>
                    <input
                      type="checkbox"
                      checked={setupSaveReplay}
                      onChange={(e) => setSetupSaveReplay(e.target.checked)}
                    />
                  </label>
                </div>

                {/* CHAT SETTINGS ACCORDION */}
                <div className="live-chat-settings-card">
                  <h4>Chat Settings</h4>
                  <div className="live-settings-row">
                    <span>Chat Enabled</span>
                    <input
                      type="checkbox"
                      checked={setupChatSettings.chat_enabled}
                      onChange={(e) =>
                        setSetupChatSettings({
                          ...setupChatSettings,
                          chat_enabled: e.target.checked,
                        })
                      }
                    />
                  </div>

                  <div className="live-settings-row">
                    <span>Slow Mode</span>
                    <select
                      value={setupChatSettings.slow_mode}
                      onChange={(e) =>
                        setSetupChatSettings({
                          ...setupChatSettings,
                          slow_mode: parseInt(e.target.value, 10),
                        })
                      }
                    >
                      <option value={0}>Off</option>
                      <option value={5}>5 seconds</option>
                      <option value={15}>15 seconds</option>
                      <option value={30}>30 seconds</option>
                    </select>
                  </div>

                  <div className="live-settings-row">
                    <span>Followers Only</span>
                    <input
                      type="checkbox"
                      checked={setupChatSettings.followers_only}
                      onChange={(e) =>
                        setSetupChatSettings({
                          ...setupChatSettings,
                          followers_only: e.target.checked,
                        })
                      }
                    />
                  </div>

                  <div className="live-blocked-words-box">
                    <label>Blocked Words (auto-hidden from chat)</label>
                    <div className="live-blocked-input-row">
                      <input
                        type="text"
                        placeholder="Add blocked word..."
                        value={blockedWordInput}
                        onChange={(e) => setBlockedWordInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && blockedWordInput.trim()) {
                            e.preventDefault();
                            if (!setupChatSettings.blocked_words.includes(blockedWordInput.trim().toLowerCase())) {
                              setSetupChatSettings({
                                ...setupChatSettings,
                                blocked_words: [
                                  ...setupChatSettings.blocked_words,
                                  blockedWordInput.trim().toLowerCase(),
                                ],
                              });
                            }
                            setBlockedWordInput("");
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (blockedWordInput.trim()) {
                            if (!setupChatSettings.blocked_words.includes(blockedWordInput.trim().toLowerCase())) {
                              setSetupChatSettings({
                                ...setupChatSettings,
                                blocked_words: [
                                  ...setupChatSettings.blocked_words,
                                  blockedWordInput.trim().toLowerCase(),
                                ],
                              });
                            }
                            setBlockedWordInput("");
                          }
                        }}
                      >
                        Add
                      </button>
                    </div>

                    <div className="live-tags-wrap">
                      {setupChatSettings.blocked_words.map((w) => (
                        <span key={w} className="live-blocked-tag">
                          {w}
                          <button
                            type="button"
                            onClick={() =>
                              setSetupChatSettings({
                                ...setupChatSettings,
                                blocked_words: setupChatSettings.blocked_words.filter((item) => item !== w),
                              })
                            }
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="live-pre-actions">
                  <button
                    type="button"
                    className="live-cancel-btn"
                    onClick={() => {
                      if (localMediaStreamRef.current) {
                        localMediaStreamRef.current.getTracks().forEach((t) => t.stop());
                      }
                      onClose();
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="live-go-active-btn"
                    onClick={handleStartBroadcast}
                  >
                    Go Live Now
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ===================================================================
              ACTIVE BROADCAST STUDIO (HOST & VIEWER MODES)
              =================================================================== */
          <>
            {/* TOP BAR */}
            <div className="live-top-bar">
              <div className="live-top-left">
                <span className="live-pulsing-badge-large">● LIVE</span>
                <div className="live-title-wrap">
                  {isHost && isEditingTitle ? (
                    <div className="live-title-edit-form">
                      <input
                        type="text"
                        className="live-title-inline-input"
                        value={editingTitleInput}
                        autoFocus
                        placeholder="Live show title..."
                        onChange={(e) => setEditingTitleInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleUpdateTitle(editingTitleInput);
                          } else if (e.key === "Escape") {
                            setIsEditingTitle(false);
                            setEditingTitleInput(liveData?.title || setupTitle);
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="live-title-save-btn"
                        onClick={() => handleUpdateTitle(editingTitleInput)}
                        title="Save Title"
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        className="live-title-cancel-btn"
                        onClick={() => {
                          setIsEditingTitle(false);
                          setEditingTitleInput(liveData?.title || setupTitle);
                        }}
                        title="Cancel"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div className="live-title-display-row">
                      <span
                        className={`live-studio-title ${isHost ? "editable" : ""}`}
                        onClick={() => {
                          if (isHost) {
                            setEditingTitleInput(liveData?.title || setupTitle);
                            setIsEditingTitle(true);
                          }
                        }}
                        title={isHost ? "Click to edit title" : undefined}
                      >
                        {liveData?.title || setupTitle}
                      </span>
                      {isHost && (
                        <button
                          type="button"
                          className="live-title-edit-icon-btn"
                          onClick={() => {
                            setEditingTitleInput(liveData?.title || setupTitle);
                            setIsEditingTitle(true);
                          }}
                          title="Edit Broadcast Title"
                        >
                          ✏️
                        </button>
                      )}
                    </div>
                  )}
                  <span className="live-channel-badge">
                    {isHost ? "Broadcasting to Nesty" : `Hosted by @${liveData?.host?.username || "Host"}`}
                  </span>
                </div>
              </div>

              <div className="live-top-right">
                {liveData?.save_replay && (
                  <div className="live-replay-notice-pill">
                    {isHost ? "🔴 REC" : "📼 Replay will be saved"}
                  </div>
                )}

                <div className="live-viewers-pill">
                  <span>👁️</span>
                  <span className="live-viewers-count">{viewerCount}</span>
                  <span className="live-viewers-label"> watching</span>
                </div>

                <div className="live-duration-pill">
                  ⏱️ {Math.floor(streamDuration / 60).toString().padStart(2, "0")}:
                  {(streamDuration % 60).toString().padStart(2, "0")}
                </div>

                <div className="live-reactions-total-pill">
                  <span>❤️</span>
                  <span>{totalReactions}</span>
                </div>

                <button
                  type="button"
                  className="live-orientation-btn"
                  onClick={handleToggleOrientation}
                  title={`Switch to ${orientationMode === "portrait" ? "Landscape" : "Portrait"}`}
                >
                  {orientationMode === "portrait" ? "🔄 Landscape" : "📱 Portrait"}
                </button>

                {isHost ? (
                  <button
                    type="button"
                    className="live-end-btn"
                    onClick={handleEndStream}
                    title="End Broadcast"
                  >
                    <span className="live-end-btn-text">End Stream</span>
                    <span className="live-end-btn-short">End</span>
                  </button>
                ) : (
                  <div className="live-viewer-top-actions">
                    <button
                      type="button"
                      className="live-report-btn"
                      onClick={() => onReport && liveData && onReport("live", liveData.id)}
                      title="Report stream"
                    >
                      🚩
                    </button>
                    <button
                      type="button"
                      className="live-leave-btn"
                      onClick={onClose}
                      title="Leave Live"
                    >
                      ✕ Leave
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* RECONNECTION GRACE PERIOD BANNER */}
            {hostReconnectedNotice && (
              <div className="live-grace-period-banner">
                <span className="spinner-small" />
                <span>{hostReconnectedNotice}</span>
              </div>
            )}

            {/* MAIN STAGE */}
            <div
              className="live-main-stage"
              onClick={() => {
                if (isCleanView) {
                  setIsCleanView(false);
                }
              }}
            >
              {/* VIDEO GRID (HOST + UP TO 3 GUESTS) */}
              <div className={`live-video-grid count-${guests.length + 1}`}>
                {/* HOST TILE */}
                <div
                  className="live-tile host-tile"
                  onClick={(e) => {
                    const target = e.target as HTMLElement;
                    if (
                      target.closest("button") ||
                      target.closest("input") ||
                      target.closest(".live-unmute-chip")
                    ) {
                      return;
                    }
                    e.stopPropagation();
                    setIsCleanView((prev) => !prev);
                    if (isAutoplayMuted && !isHost && hostVideoRef.current) {
                      hostVideoRef.current.muted = false;
                      setIsAutoplayMuted(false);
                      hostVideoRef.current.play().catch(() => {});
                    }
                  }}
                  title={isCleanView ? "Click to show controls" : "Click to hide controls (Clean View)"}
                  style={{ cursor: "pointer" }}
                >
                  <video
                    ref={(el) => {
                      hostVideoRef.current = el;
                      if (el) {
                        const targetStream = isHost ? (localMediaStreamRef.current || hostStream) : hostStream;
                        if (targetStream && el.srcObject !== targetStream) {
                          el.srcObject = targetStream;
                        }
                        if (targetStream) {
                          el.play().catch((err) => {
                            console.warn("[LiveStudio] Active host video play error:", err);
                            if (!isHost) {
                              el.muted = true;
                              setIsAutoplayMuted(true);
                              el.play().catch(() => {});
                            }
                          });
                        }
                      }
                    }}
                    autoPlay
                    playsInline
                    muted={isHost ? true : isAutoplayMuted}
                    className={`live-video-element ${videoFit === "cover" ? "fit-cover" : "fit-contain"}`}
                  />
                  {isAutoplayMuted && !isHost && (
                    <button
                      className="live-unmute-chip"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (hostVideoRef.current) {
                          hostVideoRef.current.muted = false;
                          setIsAutoplayMuted(false);
                          hostVideoRef.current.play().catch(() => {});
                        }
                      }}
                    >
                      🔊 Tap to Unmute
                    </button>
                  )}
                  {isVideoOff && (
                    <div className="live-video-off-backdrop">
                      <span style={{ fontSize: "48px" }}>📷</span>
                      <span>Camera is Off</span>
                    </div>
                  )}
                  <div className="live-tile-meta">
                    <span className="live-tile-badge host-badge">HOST</span>
                    <span className="live-tile-name">@{liveData?.host?.username || "You"}</span>
                  </div>
                </div>

                {/* GUEST TILES (MAX 3) */}
                {guests.map((guest) => (
                  <div key={guest.user_id} className="live-tile guest-tile">
                    {guest.stream && !guest.audio_only ? (
                      <video
                        autoPlay
                        playsInline
                        ref={(el) => {
                          if (el && guest.stream && el.srcObject !== guest.stream) {
                            el.srcObject = guest.stream;
                          }
                        }}
                        className="live-video-element fit-cover"
                      />
                    ) : (
                      <div className="live-guest-avatar-backdrop">
                        {guest.avatar_url ? (
                          <img src={guest.avatar_url} alt={guest.name} />
                        ) : (
                          <div className="live-guest-fallback-avatar">
                            {guest.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span className="live-guest-audio-only-tag">
                          {guest.audio_only ? "🎙️ Audio Guest" : "Guest"}
                        </span>
                      </div>
                    )}

                    <div className="live-tile-meta">
                      <span className="live-tile-badge guest-badge">GUEST</span>
                      <span className="live-tile-name">@{guest.username}</span>
                      {guest.muted && <span className="live-guest-muted-tag">🔇</span>}
                    </div>

                    {/* HOST CONTROLS FOR GUEST */}
                    {isHost && (
                      <div className="live-guest-mod-menu">
                        <button
                          type="button"
                          onClick={() => {
                            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && liveData?.id) {
                              wsRef.current.send(
                                JSON.stringify({
                                  type: "live_stage_mute",
                                  live_id: liveData.id,
                                  target_user_id: guest.user_id,
                                  muted: !guest.muted,
                                })
                              );
                            }
                          }}
                          title={guest.muted ? "Unmute Guest" : "Mute Guest"}
                        >
                          {guest.muted ? "🔊" : "🔇"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && liveData?.id) {
                              wsRef.current.send(
                                JSON.stringify({
                                  type: "live_stage_remove",
                                  live_id: liveData.id,
                                  target_user_id: guest.user_id,
                                })
                              );
                            }
                          }}
                          title="Move Guest Back to Audience"
                        >
                          Demote
                        </button>
                      </div>
                    )}
                  </div>
                ))}

                {/* FLOATING CONTROLS OVER VIDEO */}
                <div className="live-floating-controls">
                  {isHost ? (
                    <>
                      <button
                        type="button"
                        className={`live-ctrl-btn ${isMuted ? "muted" : ""}`}
                        onClick={() => {
                          if (localMediaStreamRef.current) {
                            localMediaStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = isMuted));
                            setIsMuted(!isMuted);
                          }
                        }}
                        title={isMuted ? "Unmute Mic" : "Mute Mic"}
                      >
                        <span className="live-btn-icon">{isMuted ? "🔇" : "🎤"}</span>
                        <span className="live-btn-text">{isMuted ? "Unmute" : "Mute"}</span>
                      </button>

                      <button
                        type="button"
                        className={`live-ctrl-btn ${isVideoOff ? "muted" : ""}`}
                        onClick={() => {
                          if (localMediaStreamRef.current) {
                            localMediaStreamRef.current.getVideoTracks().forEach((t) => (t.enabled = isVideoOff));
                            setIsVideoOff(!isVideoOff);
                          }
                        }}
                        title={isVideoOff ? "Turn Cam On" : "Turn Cam Off"}
                      >
                        <span className="live-btn-icon">{isVideoOff ? "📷" : "📹"}</span>
                        <span className="live-btn-text">{isVideoOff ? "Cam On" : "Cam Off"}</span>
                      </button>

                      <button
                        type="button"
                        className={`live-ctrl-btn ${isScreenSharing ? "active" : ""}`}
                        onClick={handleToggleScreenShare}
                        title="Share Screen"
                      >
                        <span className="live-btn-icon">🖥️</span>
                        <span className="live-btn-text">{isScreenSharing ? "Stop" : "Share"}</span>
                      </button>

                      <button
                        type="button"
                        className={`live-ctrl-btn ${videoFit === "cover" ? "active" : ""}`}
                        onClick={() => setVideoFit((prev) => (prev === "contain" ? "cover" : "contain"))}
                        title={videoFit === "contain" ? "Fill Screen" : "Fit Screen"}
                      >
                        <span className="live-btn-icon">{videoFit === "contain" ? "↔" : "↕"}</span>
                        <span className="live-btn-text">{videoFit === "contain" ? "Fill" : "Fit"}</span>
                      </button>

                      <button
                        type="button"
                        className={`live-ctrl-btn ${handQueue.length > 0 ? "has-queue" : ""}`}
                        onClick={() => setStageQueueModalOpen(true)}
                        title="Stage Queue & Guest Management"
                      >
                        <span className="live-btn-icon">✋</span>
                        <span className="live-btn-text">Stage ({guests.length}/3)</span>
                        {handQueue.length > 0 && (
                          <span className="live-btn-badge">{handQueue.length}</span>
                        )}
                      </button>

                      <button
                        type="button"
                        className="live-ctrl-btn"
                        onClick={() => setSettingsModalOpen(true)}
                        title="Broadcast Settings"
                      >
                        <span className="live-btn-icon">⚙️</span>
                        <span className="live-btn-text">Settings</span>
                      </button>

                      <button
                        type="button"
                        className={`live-ctrl-btn ${orientationMode === "landscape" ? "active" : ""}`}
                        onClick={handleToggleOrientation}
                        title={`Switch to ${orientationMode === "portrait" ? "Landscape" : "Portrait"}`}
                      >
                        <span className="live-btn-icon">{orientationMode === "portrait" ? "🔄" : "📱"}</span>
                        <span className="live-btn-text">{orientationMode === "portrait" ? "Landscape" : "Portrait"}</span>
                      </button>

                      <button
                        type="button"
                        className="live-ctrl-btn danger live-ctrl-end-btn"
                        onClick={handleEndStream}
                        title="End Broadcast"
                      >
                        <span className="live-btn-icon">🛑</span>
                        <span className="live-btn-text">End</span>
                      </button>
                    </>
                  ) : myRole === "guest" ? (
                    <>
                      <button
                        type="button"
                        className={`live-ctrl-btn ${isMuted ? "muted" : ""}`}
                        onClick={() => {
                          if (localMediaStreamRef.current) {
                            localMediaStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = isMuted));
                            setIsMuted(!isMuted);
                          }
                        }}
                      >
                        <span className="live-btn-icon">{isMuted ? "🔇" : "🎤"}</span>
                        <span className="live-btn-text">{isMuted ? "Unmute" : "Mute"}</span>
                      </button>
                      <button
                        type="button"
                        className={`live-ctrl-btn ${orientationMode === "landscape" ? "active" : ""}`}
                        onClick={handleToggleOrientation}
                        title={`Switch to ${orientationMode === "portrait" ? "Landscape" : "Portrait"}`}
                      >
                        <span className="live-btn-icon">{orientationMode === "portrait" ? "🔄" : "📱"}</span>
                        <span className="live-btn-text">{orientationMode === "portrait" ? "Landscape" : "Portrait"}</span>
                      </button>
                      <button
                        type="button"
                        className="live-ctrl-btn danger"
                        onClick={handleLeaveStage}
                      >
                        <span className="live-btn-icon">🚪</span>
                        <span className="live-btn-text">Leave Stage</span>
                      </button>
                    </>
                  ) : (
                    /* VIEWER CONTROLS */
                    <div className="live-viewer-floating-actions">
                      <button
                        type="button"
                        className={`live-raise-hand-btn ${isHandRaised ? "active" : ""}`}
                        onClick={toggleRaiseHand}
                        title={isHandRaised ? "Lower Hand" : "Raise Hand to Join Stage"}
                      >
                        <span>✋</span>
                        <span>{isHandRaised ? "Hand Raised" : "Raise Hand"}</span>
                      </button>
                      <button
                        type="button"
                        className="live-ctrl-btn"
                        onClick={handleToggleOrientation}
                        title={`Switch to ${orientationMode === "portrait" ? "Landscape" : "Portrait"}`}
                      >
                        <span className="live-btn-icon">{orientationMode === "portrait" ? "🔄" : "📱"}</span>
                        <span className="live-btn-text">{orientationMode === "portrait" ? "Landscape" : "Portrait"}</span>
                      </button>
                      <button
                        type="button"
                        className="live-ctrl-btn danger live-ctrl-leave-btn"
                        onClick={onClose}
                        title="Leave Live"
                      >
                        <span className="live-btn-icon">✕</span>
                        <span className="live-btn-text">Leave</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* FLOATING PARTICLES (MAX 30 PARTICLES, PURE CSS TRANSFORMS) */}
                <div className="live-particles-container">
                  {particles.map((p) => (
                    <div
                      key={p.id}
                      className="live-reaction-particle"
                      style={{
                        left: `${p.leftPercent}%`,
                        bottom: `${p.bottomPercent}%`,
                        transform: `scale(${p.scale}) translateX(${p.wobbleX}px)`,
                      }}
                    >
                      {p.emoji}
                    </div>
                  ))}
                </div>

                {/* VIEWER FLOATING REACTION BAR */}
                {!isHost && (
                  <div className="live-reactions-tap-bar">
                    {REACTION_EMOJIS.map((r) => (
                      <button
                        key={r.type}
                        type="button"
                        className="live-reaction-tap-btn"
                        onClick={() => handleTapReaction(r.type)}
                        title={`Send ${r.type}`}
                      >
                        {r.emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* LIVE CHAT SIDEBAR / BOTTOM SHEET */}
              <div className={`live-chat-panel ${isChatOpen ? "open" : "collapsed"}`}>
                <div
                  className="live-chat-header"
                  onClick={() => setIsChatOpen(!isChatOpen)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="live-chat-header-title">
                    <span>💬 Live Chat</span>
                    <span className="live-chat-badge">{chatMessages.length}</span>
                    {setupChatSettings.slow_mode > 0 && (
                      <span className="live-slow-mode-pill">⏱️ {setupChatSettings.slow_mode}s</span>
                    )}
                    {setupChatSettings.followers_only && (
                      <span className="live-followers-only-pill">🔒 Followers only</span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="live-chat-toggle-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsChatOpen(!isChatOpen);
                    }}
                    title={isChatOpen ? "Hide chat" : "Show chat"}
                  >
                    {isChatOpen ? "▼" : "▲"}
                  </button>
                </div>

                {isChatOpen && (
                  <>
                    <div className="live-chat-messages-scroll">
                      {visibleMessages.length === 0 ? (
                        <div className="live-chat-empty">
                          <span>Welcome to the live chat! Keep the community friendly.</span>
                        </div>
                      ) : (
                        visibleMessages.map((msg) => (
                          <div
                            key={msg.id}
                            className={`live-chat-bubble role-${msg.role}`}
                            onClick={() => setActiveMessageAction(msg)}
                          >
                            <div className="live-chat-user-line">
                              {msg.role === "host" && (
                                <span className="live-chat-role-badge host">HOST</span>
                              )}
                              {msg.role === "moderator" && (
                                <span className="live-chat-role-badge mod">MOD</span>
                              )}
                              {msg.role === "guest" && (
                                <span className="live-chat-role-badge guest">STAGE</span>
                              )}
                              <span className="live-chat-username">@{msg.username}</span>
                              <span className="live-chat-timestamp">{msg.time || "now"}</span>
                            </div>
                            <div className="live-chat-body">{msg.text}</div>
                          </div>
                        ))
                      )}
                    </div>

                    {chatError && <div className="live-chat-error-bar">{chatError}</div>}

                    <div className="live-chat-composer">
                      <input
                        type="text"
                        className="live-chat-input"
                        placeholder={
                          slowModeSecondsLeft > 0
                            ? `Slow mode active (${slowModeSecondsLeft}s remaining)...`
                            : "Say something live..."
                        }
                        value={chatInput}
                        disabled={slowModeSecondsLeft > 0}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleSendChatMessage();
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="live-chat-send-btn"
                        onClick={handleSendChatMessage}
                        disabled={!chatInput.trim() || slowModeSecondsLeft > 0}
                      >
                        Send
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </>
        )}

        {/* ===================================================================
            STAGE INVITE DIALOG (FOR VIEWER INVITED TO STAGE)
            =================================================================== */}
        {stageInviteModal && (
          <div className="live-dialog-backdrop">
            <div className="live-dialog-box">
              <h3>✋ Join the Broadcast Stage</h3>
              <p>
                The host invited you to join the stage as a speaker! You will be on screen with the host.
              </p>
              <div className="live-dialog-actions">
                <button
                  type="button"
                  className="live-dialog-decline-btn"
                  onClick={handleDeclineStage}
                >
                  Decline
                </button>
                <button
                  type="button"
                  className="live-dialog-accept-btn"
                  onClick={() => handleAcceptStage(stageInviteModal.audioOnly)}
                >
                  {stageInviteModal.audioOnly ? "Join with Audio" : "Join with Camera & Mic"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            MESSAGE MODERATION & REPORT MODAL
            =================================================================== */}
        {activeMessageAction && (
          <div
            className="live-dialog-backdrop"
            onClick={() => setActiveMessageAction(null)}
          >
            <div
              className="live-dialog-box mod-menu"
              onClick={(e) => e.stopPropagation()}
            >
              <h4>Message from @{activeMessageAction.username}</h4>
              <p className="mod-msg-quote">"{activeMessageAction.text}"</p>

              <div className="mod-menu-options">
                {/* HOST / MOD CONTROLS */}
                {(myRole === "host" || myRole === "moderator") && (
                  <>
                    <button
                      type="button"
                      className="mod-btn delete"
                      onClick={() => {
                        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && liveData?.id) {
                          wsRef.current.send(
                            JSON.stringify({
                              type: "live_chat_delete",
                              live_id: liveData.id,
                              message_id: activeMessageAction.id,
                            })
                          );
                        }
                        setActiveMessageAction(null);
                      }}
                    >
                      🗑️ Delete Message
                    </button>

                    <button
                      type="button"
                      className="mod-btn timeout"
                      onClick={() => {
                        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && liveData?.id) {
                          wsRef.current.send(
                            JSON.stringify({
                              type: "live_user_timeout",
                              live_id: liveData.id,
                              target_user_id: activeMessageAction.user_id,
                              duration_seconds: 60,
                            })
                          );
                        }
                        setActiveMessageAction(null);
                      }}
                    >
                      ⏳ Timeout (60s)
                    </button>

                    <button
                      type="button"
                      className="mod-btn timeout"
                      onClick={() => {
                        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && liveData?.id) {
                          wsRef.current.send(
                            JSON.stringify({
                              type: "live_user_timeout",
                              live_id: liveData.id,
                              target_user_id: activeMessageAction.user_id,
                              duration_seconds: 300,
                            })
                          );
                        }
                        setActiveMessageAction(null);
                      }}
                    >
                      ⏳ Timeout (5m)
                    </button>

                    <button
                      type="button"
                      className="mod-btn timeout"
                      onClick={() => {
                        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && liveData?.id) {
                          wsRef.current.send(
                            JSON.stringify({
                              type: "live_user_timeout",
                              live_id: liveData.id,
                              target_user_id: activeMessageAction.user_id,
                              duration_seconds: 3600,
                            })
                          );
                        }
                        setActiveMessageAction(null);
                      }}
                    >
                      ⏳ Timeout (1h)
                    </button>

                    <button
                      type="button"
                      className="mod-btn kick"
                      onClick={() => {
                        if (window.confirm(`Permanently remove @${activeMessageAction.username} from this live?`)) {
                          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && liveData?.id) {
                            wsRef.current.send(
                              JSON.stringify({
                                type: "live_user_remove",
                                live_id: liveData.id,
                                target_user_id: activeMessageAction.user_id,
                              })
                            );
                          }
                          setActiveMessageAction(null);
                        }
                      }}
                    >
                      🚫 Remove From Live
                    </button>

                    {myRole === "host" && activeMessageAction.user_id !== liveData?.host_id && (
                      <button
                        type="button"
                        className="mod-btn mod-toggle"
                        onClick={() => {
                          const willBeMod = activeMessageAction.role !== "moderator";
                          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && liveData?.id) {
                            wsRef.current.send(
                              JSON.stringify({
                                type: "live_set_moderator",
                                live_id: liveData.id,
                                target_user_id: activeMessageAction.user_id,
                                is_moderator: willBeMod,
                              })
                            );
                          }
                          setActiveMessageAction(null);
                        }}
                      >
                        🛡️ {activeMessageAction.role === "moderator" ? "Demote Moderator" : "Assign Moderator"}
                      </button>
                    )}
                  </>
                )}

                {/* REPORT BUTTON (ANY VIEWER) */}
                <button
                  type="button"
                  className="mod-btn report"
                  onClick={() => {
                    if (onReport && liveData) {
                      onReport("live_message", liveData.id);
                    }
                    setActiveMessageAction(null);
                  }}
                >
                  🚩 Report Message
                </button>

                <button
                  type="button"
                  className="mod-btn cancel"
                  onClick={() => setActiveMessageAction(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            STAGE QUEUE & GUEST MANAGEMENT MODAL (HOST ONLY)
            =================================================================== */}
        {stageQueueModalOpen && isHost && (
          <div
            className="live-dialog-backdrop"
            onClick={() => setStageQueueModalOpen(false)}
          >
            <div
              className="live-dialog-box stage-queue-box"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="stage-queue-header">
                <h3>✋ Stage Queue & Speakers ({guests.length}/3)</h3>
                <button
                  type="button"
                  onClick={() => setStageQueueModalOpen(false)}
                >
                  ✕
                </button>
              </div>

              <div className="stage-queue-body">
                <h4>Raised Hands ({handQueue.length})</h4>
                {handQueue.length === 0 ? (
                  <p className="empty-queue-hint">No viewers currently have hands raised.</p>
                ) : (
                  <div className="hand-queue-list">
                    {handQueue.map((item) => (
                      <div key={item.user_id} className="hand-queue-item">
                        <div className="hand-user-info">
                          {item.avatar_url ? (
                            <img src={item.avatar_url} alt={item.name} />
                          ) : (
                            <div className="avatar-placeholder">
                              {item.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <strong>{item.name}</strong>
                            <small>@{item.username}</small>
                          </div>
                        </div>

                        <div className="hand-actions">
                          <button
                            type="button"
                            className="accept-audio-btn"
                            disabled={guests.length >= 3}
                            onClick={() => {
                              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && liveData?.id) {
                                wsRef.current.send(
                                  JSON.stringify({
                                    type: "live_stage_invite",
                                    live_id: liveData.id,
                                    target_user_id: item.user_id,
                                    audio_only: true,
                                  })
                                );
                              }
                            }}
                          >
                            Accept (Audio)
                          </button>
                          <button
                            type="button"
                            className="accept-video-btn"
                            disabled={guests.length >= 3}
                            onClick={() => {
                              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && liveData?.id) {
                                wsRef.current.send(
                                  JSON.stringify({
                                    type: "live_stage_invite",
                                    live_id: liveData.id,
                                    target_user_id: item.user_id,
                                    audio_only: false,
                                  })
                                );
                              }
                            }}
                          >
                            Accept (Video)
                          </button>
                          <button
                            type="button"
                            className="decline-btn"
                            onClick={() => {
                              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && liveData?.id) {
                                wsRef.current.send(
                                  JSON.stringify({
                                    type: "live_hand_lower",
                                    live_id: liveData.id,
                                    user_id: item.user_id,
                                  })
                                );
                              }
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            LIVE CHAT SETTINGS MODAL (HOST MID-STREAM)
            =================================================================== */}
        {settingsModalOpen && isHost && (
          <div
            className="live-dialog-backdrop"
            onClick={() => setSettingsModalOpen(false)}
          >
            <div
              className="live-dialog-box"
              onClick={(e) => e.stopPropagation()}
            >
              <h3>⚙️ Live Broadcast Settings</h3>

              {/* TITLE SETTING */}
              <div className="live-settings-card-section">
                <label className="live-field-label">Broadcast Title</label>
                <div className="live-title-setting-row">
                  <input
                    type="text"
                    className="live-setting-input"
                    value={settingsTitleInput}
                    placeholder="Enter broadcast title..."
                    onChange={(e) => setSettingsTitleInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleUpdateTitle(settingsTitleInput);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="live-setting-save-btn"
                    onClick={() => handleUpdateTitle(settingsTitleInput)}
                  >
                    Save Title
                  </button>
                </div>
              </div>

              <div className="live-chat-settings-card">
                <h4>Chat Settings</h4>
                <div className="live-settings-row">
                  <span>Chat Enabled</span>
                  <input
                    type="checkbox"
                    checked={setupChatSettings.chat_enabled}
                    onChange={(e) => {
                      const updated = {
                        ...setupChatSettings,
                        chat_enabled: e.target.checked,
                      };
                      setSetupChatSettings(updated);
                      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && liveData?.id) {
                        wsRef.current.send(
                          JSON.stringify({
                            type: "live_chat_settings",
                            live_id: liveData.id,
                            chat_settings: updated,
                          })
                        );
                      }
                    }}
                  />
                </div>

                <div className="live-settings-row">
                  <span>Slow Mode</span>
                  <select
                    value={setupChatSettings.slow_mode}
                    onChange={(e) => {
                      const updated = {
                        ...setupChatSettings,
                        slow_mode: parseInt(e.target.value, 10),
                      };
                      setSetupChatSettings(updated);
                      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && liveData?.id) {
                        wsRef.current.send(
                          JSON.stringify({
                            type: "live_chat_settings",
                            live_id: liveData.id,
                            chat_settings: updated,
                          })
                        );
                      }
                    }}
                  >
                    <option value={0}>Off</option>
                    <option value={5}>5 seconds</option>
                    <option value={15}>15 seconds</option>
                    <option value={30}>30 seconds</option>
                  </select>
                </div>

                <div className="live-settings-row">
                  <span>Followers Only Chat</span>
                  <input
                    type="checkbox"
                    checked={setupChatSettings.followers_only}
                    onChange={(e) => {
                      const updated = {
                        ...setupChatSettings,
                        followers_only: e.target.checked,
                      };
                      setSetupChatSettings(updated);
                      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && liveData?.id) {
                        wsRef.current.send(
                          JSON.stringify({
                            type: "live_chat_settings",
                            live_id: liveData.id,
                            chat_settings: updated,
                          })
                        );
                      }
                    }}
                  />
                </div>

                {/* BLOCKED WORDS MANAGEMENT IN LIVE */}
                <div className="live-blocked-words-box">
                  <label>Blocked Words (auto-hidden from chat)</label>
                  <div className="live-blocked-input-row">
                    <input
                      type="text"
                      placeholder="Add word to block..."
                      value={inLiveBlockedWordInput}
                      onChange={(e) => setInLiveBlockedWordInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && inLiveBlockedWordInput.trim()) {
                          e.preventDefault();
                          const newWord = inLiveBlockedWordInput.trim().toLowerCase();
                          if (!setupChatSettings.blocked_words.includes(newWord)) {
                            const updated = {
                              ...setupChatSettings,
                              blocked_words: [...setupChatSettings.blocked_words, newWord],
                            };
                            setSetupChatSettings(updated);
                            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && liveData?.id) {
                              wsRef.current.send(
                                JSON.stringify({
                                  type: "live_chat_settings",
                                  live_id: liveData.id,
                                  chat_settings: updated,
                                })
                              );
                            }
                          }
                          setInLiveBlockedWordInput("");
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (inLiveBlockedWordInput.trim()) {
                          const newWord = inLiveBlockedWordInput.trim().toLowerCase();
                          if (!setupChatSettings.blocked_words.includes(newWord)) {
                            const updated = {
                              ...setupChatSettings,
                              blocked_words: [...setupChatSettings.blocked_words, newWord],
                            };
                            setSetupChatSettings(updated);
                            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && liveData?.id) {
                              wsRef.current.send(
                                JSON.stringify({
                                  type: "live_chat_settings",
                                  live_id: liveData.id,
                                  chat_settings: updated,
                                })
                              );
                            }
                          }
                          setInLiveBlockedWordInput("");
                        }
                      }}
                    >
                      Add
                    </button>
                  </div>

                  <div className="live-tags-wrap">
                    {setupChatSettings.blocked_words.map((w) => (
                      <span key={w} className="live-blocked-tag">
                        {w}
                        <button
                          type="button"
                          onClick={() => {
                            const updated = {
                              ...setupChatSettings,
                              blocked_words: setupChatSettings.blocked_words.filter((item) => item !== w),
                            };
                            setSetupChatSettings(updated);
                            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && liveData?.id) {
                              wsRef.current.send(
                                JSON.stringify({
                                  type: "live_chat_settings",
                                  live_id: liveData.id,
                                  chat_settings: updated,
                                })
                              );
                            }
                          }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="live-dialog-actions">
                <button
                  type="button"
                  className="live-dialog-accept-btn"
                  onClick={() => setSettingsModalOpen(false)}
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}

        {/* HIDDEN FILE INPUT FOR DOCUMENT/SLIDE PRESENTATION */}
        <input
          type="file"
          ref={presentFileInputRef}
          accept="image/*"
          style={{ display: "none" }}
          onChange={handlePresentDocument}
        />

        {/* MOBILE PRESENTATION MODAL */}
        {isMobilePresentModalOpen && (
          <div className="live-dialog-backdrop mobile-present-backdrop" onClick={() => setIsMobilePresentModalOpen(false)}>
            <div className="live-dialog-card mobile-present-dialog" onClick={(e) => e.stopPropagation()}>
              <div className="live-dialog-header">
                <h3>📱 Share Screen / Content</h3>
                <button type="button" className="live-dialog-close" onClick={() => setIsMobilePresentModalOpen(false)}>✕</button>
              </div>
              <p className="mobile-present-desc">
                Select how you would like to present content to the live room:
              </p>
              <div className="mobile-present-options">
                <button
                  type="button"
                  className="mobile-present-btn primary"
                  onClick={() => {
                    presentFileInputRef.current?.click();
                  }}
                >
                  <span className="present-opt-icon">📑</span>
                  <div className="present-opt-info">
                    <strong>Share Document / Slide / Image</strong>
                    <small>Broadcast presentation slides, photos, or diagrams</small>
                  </div>
                </button>

                <button
                  type="button"
                  className="mobile-present-btn"
                  onClick={handlePresentRearCamera}
                >
                  <span className="present-opt-icon">📷</span>
                  <div className="present-opt-info">
                    <strong>Share via Back Camera</strong>
                    <small>Point at notes, physical documents, or external screen</small>
                  </div>
                </button>

                {navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === "function" && (
                  <button
                    type="button"
                    className="mobile-present-btn"
                    onClick={async () => {
                      setIsMobilePresentModalOpen(false);
                      try {
                        const scr = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
                        startActiveScreenShare(scr);
                      } catch (err: any) {
                        console.warn("[LiveStudio] Direct getDisplayMedia retry error:", err);
                      }
                    }}
                  >
                    <span className="present-opt-icon">🖥️</span>
                    <div className="present-opt-info">
                      <strong>Device Display Capture</strong>
                      <small>Trigger system screen recording if allowed by OS</small>
                    </div>
                  </button>
                )}
              </div>
              <div className="live-dialog-actions">
                <button
                  type="button"
                  className="live-dialog-cancel-btn"
                  onClick={() => setIsMobilePresentModalOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
