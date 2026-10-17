export interface ChatSettings {
  chat_enabled: boolean;
  slow_mode: number; // 0 = off, 5, 15, 30 seconds
  followers_only: boolean;
  blocked_words: string[];
}

export interface LiveHost {
  id: number;
  username: string;
  name?: string;
  avatar_url?: string;
  status?: string;
}

export interface LiveStream {
  id: number;
  host_id: number;
  host?: LiveHost;
  title: string;
  status: "live" | "ended";
  started_at: string;
  ended_at?: string | null;
  chat_settings?: ChatSettings;
  notify_followers: boolean;
  save_replay: boolean;
  viewer_count: number;
  total_reactions: number;
}

export interface LiveGuest {
  user_id: number;
  username: string;
  name: string;
  avatar_url?: string;
  audio_only: boolean;
  video_off: boolean;
  muted: boolean;
  stream?: MediaStream;
}

export interface HandRaiseItem {
  user_id: number;
  username: string;
  name: string;
  avatar_url?: string;
  raised_at: string;
}

export interface LiveChatMessageItem {
  id: string;
  live_id: number;
  user_id: number;
  username: string;
  name: string;
  avatar_url?: string;
  text: string;
  role: "host" | "moderator" | "guest" | "viewer";
  created_at?: string;
  time?: string;
}

export interface FloatingParticle {
  id: string;
  emoji: string;
  leftPercent: number;
  bottomPercent: number;
  scale: number;
  wobbleX: number;
}

export interface StoredReplayChunk {
  live_id: number;
  chunk_index: number;
  blob: Blob;
  timestamp: number;
}
