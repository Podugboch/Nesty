/**
 * StreamTransport Media Abstraction Layer
 * Allows Nesty's Live Studio to seamlessly swap between native WebRTC Peer-to-Peer (Mesh)
 * and a future Selective Forwarding Unit (SFU) like LiveKit or Pion without rewriting studio features.
 */

export interface StreamTransportEvents {
  onRemoteTrack: (track: MediaStreamTrack, stream: MediaStream, peerId: number) => void;
  onPeerLeave: (peerId: number) => void;
  onConnectionStateChange?: (peerId: number, state: RTCPeerConnectionState) => void;
  sendSignal: (toUserId: number, signal: any) => void;
}

export interface StreamTransport {
  init(events: StreamTransportEvents, iceServers?: RTCIceServer[]): Promise<void>;
  publishStream(stream: MediaStream): Promise<void>;
  unpublishStream(): void;
  getLocalStream(): MediaStream | null;
  connectToPeer(peerId: number, isInitiator: boolean): Promise<void>;
  handleSignal(fromUserId: number, signal: any): Promise<void>;
  closePeer(peerId: number): void;
  destroy(): void;
}

export class MeshStreamTransport implements StreamTransport {
  private events: StreamTransportEvents | null = null;
  private iceServers: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" },
    { urls: "stun:stun.services.mozilla.com" },
  ];
  private localStream: MediaStream | null = null;
  private peers: Map<number, RTCPeerConnection> = new Map();
  private candidateQueues: Map<number, RTCIceCandidateInit[]> = new Map();
  private currentUserId: number = 0;

  constructor(currentUserId: number) {
    this.currentUserId = currentUserId;
  }

  async init(events: StreamTransportEvents, iceServers?: RTCIceServer[]): Promise<void> {
    this.events = events;
    if (iceServers && iceServers.length > 0) {
      this.iceServers = iceServers;
    }
  }

  async publishStream(stream: MediaStream): Promise<void> {
    this.localStream = stream;

    // Update all existing peer connections with new tracks
    this.peers.forEach((pc) => {
      const senders = pc.getSenders();
      stream.getTracks().forEach((track) => {
        const sender = senders.find((s) => s.track && s.track.kind === track.kind);
        if (sender) {
          sender.replaceTrack(track).catch(() => {});
        } else {
          try {
            pc.addTrack(track, stream);
          } catch {}
        }
      });
    });
  }

  unpublishStream(): void {
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    this.peers.forEach((pc) => {
      pc.getSenders().forEach((s) => {
        if (s.track) {
          try {
            pc.removeTrack(s);
          } catch {}
        }
      });
    });
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  private getOrCreatePeer(peerId: number): RTCPeerConnection {
    let pc = this.peers.get(peerId);
    if (pc && pc.signalingState !== "closed") {
      return pc;
    }

    pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      bundlePolicy: "balanced",
      rtcpMuxPolicy: "require",
    });

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        try {
          pc!.addTrack(track, this.localStream!);
        } catch {}
      });
    }

    // Ensure transceivers are configured to receive remote tracks
    const senders = pc.getSenders();
    if (!senders.some((s) => s.track && s.track.kind === "audio")) {
      try {
        pc.addTransceiver("audio", { direction: "sendrecv" });
      } catch {}
    }
    if (!senders.some((s) => s.track && s.track.kind === "video")) {
      try {
        pc.addTransceiver("video", { direction: "sendrecv" });
      } catch {}
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && this.events) {
        this.events.sendSignal(peerId, {
          event: "live_signal",
          type: "live_signal",
          signal_type: "ice-candidate",
          candidate: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      if (this.events) {
        const notifyTrack = () => {
          let tracks: MediaStreamTrack[] = [];
          if (event.streams && event.streams[0]) {
            tracks = event.streams[0].getTracks();
          } else {
            tracks = [event.track];
          }
          const stream = new MediaStream(tracks);
          this.events?.onRemoteTrack(event.track, stream, peerId);
        };

        event.track.onunmute = notifyTrack;
        notifyTrack();
      }
    };

    pc.onconnectionstatechange = () => {
      if (this.events && this.events.onConnectionStateChange) {
        this.events.onConnectionStateChange(peerId, pc!.connectionState);
      }
      if (pc!.connectionState === "failed" || pc!.connectionState === "closed") {
        if (this.events) {
          this.events.onPeerLeave(peerId);
        }
      }
    };

    this.peers.set(peerId, pc);
    return pc;
  }

  async connectToPeer(peerId: number, isInitiator: boolean): Promise<void> {
    if (peerId === this.currentUserId || !peerId) return;

    const pc = this.getOrCreatePeer(peerId);

    if (isInitiator) {
      try {
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
        await pc.setLocalDescription(offer);

        if (this.events) {
          this.events.sendSignal(peerId, {
            event: "live_signal",
            type: "live_signal",
            signal_type: "offer",
            sdp: offer,
          });
        }
      } catch (err) {
        console.error(`[MeshTransport] Error creating offer for peer ${peerId}:`, err);
      }
    }
  }

  async handleSignal(fromUserId: number, signal: any): Promise<void> {
    if (!fromUserId || fromUserId === this.currentUserId) return;

    const signalType = signal.signal_type || signal.type;
    const pc = this.getOrCreatePeer(fromUserId);

    try {
      if (signalType === "offer") {
        // Glare resolution
        if (pc.signalingState === "have-local-offer") {
          const isPolite = this.currentUserId < fromUserId;
          if (!isPolite) {
            console.warn(`[MeshTransport] Glare offer ignored from peer ${fromUserId} (impolite)`);
            return;
          }
          await pc.setLocalDescription({ type: "rollback" });
        }

        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));

        // Flush queued candidates
        const queued = this.candidateQueues.get(fromUserId) || [];
        for (const cand of queued) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(cand));
          } catch {}
        }
        this.candidateQueues.delete(fromUserId);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        if (this.events) {
          this.events.sendSignal(fromUserId, {
            event: "live_signal",
            type: "live_signal",
            signal_type: "answer",
            sdp: answer,
          });
        }
      } else if (signalType === "answer") {
        if (pc.signalingState === "have-local-offer") {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));

          const queued = this.candidateQueues.get(fromUserId) || [];
          for (const cand of queued) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch {}
          }
          this.candidateQueues.delete(fromUserId);
        }
      } else if (signalType === "ice-candidate" || signalType === "candidate") {
        const candidate = signal.candidate;
        if (candidate) {
          if (pc.remoteDescription && pc.remoteDescription.type) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } else {
            const list = this.candidateQueues.get(fromUserId) || [];
            list.push(candidate);
            this.candidateQueues.set(fromUserId, list);
          }
        }
      }
    } catch (err) {
      console.error(`[MeshTransport] Signal error from peer ${fromUserId}:`, err);
    }
  }

  closePeer(peerId: number): void {
    const pc = this.peers.get(peerId);
    if (pc) {
      try {
        pc.close();
      } catch {}
      this.peers.delete(peerId);
      this.candidateQueues.delete(peerId);
      if (this.events) {
        this.events.onPeerLeave(peerId);
      }
    }
  }

  destroy(): void {
    this.unpublishStream();
    this.peers.forEach((pc) => {
      try {
        pc.close();
      } catch {}
    });
    this.peers.clear();
    this.candidateQueues.clear();
    this.events = null;
  }
}
