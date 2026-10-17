-- Migration 002: Live Broadcast Studio (lives, live_roles, live_bans, live_replays)
-- Safe to execute against existing databases

CREATE TABLE IF NOT EXISTS lives (
    id bigserial PRIMARY KEY,
    host_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title text NOT NULL DEFAULT '',
    status varchar(20) NOT NULL DEFAULT 'live', -- 'live', 'ended'
    started_at timestamptz DEFAULT NOW(),
    ended_at timestamptz NULL,
    chat_settings text DEFAULT '{"chat_enabled":true,"slow_mode":0,"followers_only":false,"blocked_words":[]}',
    notify_followers boolean DEFAULT true,
    save_replay boolean DEFAULT false,
    viewer_count int DEFAULT 0,
    total_reactions int DEFAULT 0,
    created_at timestamptz DEFAULT NOW(),
    updated_at timestamptz DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lives_status ON lives(status);
CREATE INDEX IF NOT EXISTS idx_lives_started_at ON lives(started_at);
CREATE INDEX IF NOT EXISTS idx_lives_host_id ON lives(host_id);

CREATE TABLE IF NOT EXISTS live_roles (
    id bigserial PRIMARY KEY,
    live_id bigint NOT NULL REFERENCES lives(id) ON DELETE CASCADE,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role varchar(20) NOT NULL DEFAULT 'viewer', -- 'host', 'moderator', 'guest', 'viewer'
    created_at timestamptz DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_live_roles_unique ON live_roles(live_id, user_id);
CREATE INDEX IF NOT EXISTS idx_live_roles_live_id ON live_roles(live_id);
CREATE INDEX IF NOT EXISTS idx_live_roles_user_id ON live_roles(user_id);

CREATE TABLE IF NOT EXISTS live_bans (
    id bigserial PRIMARY KEY,
    live_id bigint NOT NULL REFERENCES lives(id) ON DELETE CASCADE,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    until timestamptz NULL, -- NULL means permanent ban from this live; timestamp means timeout
    reason text DEFAULT '',
    created_at timestamptz DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_live_bans_lookup ON live_bans(live_id, user_id);

CREATE TABLE IF NOT EXISTS live_replays (
    id bigserial PRIMARY KEY,
    live_id bigint NOT NULL REFERENCES lives(id) ON DELETE CASCADE,
    storage_path text DEFAULT '',
    status varchar(20) NOT NULL DEFAULT 'recording', -- 'recording', 'ready', 'published', 'discarded'
    post_id bigint NULL REFERENCES posts(id) ON DELETE SET NULL,
    created_at timestamptz DEFAULT NOW(),
    updated_at timestamptz DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_live_replays_live_id ON live_replays(live_id);
CREATE INDEX IF NOT EXISTS idx_live_replays_status ON live_replays(status);

-- Optional live_id reference on notifications for go-live alerts
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS live_id bigint NULL REFERENCES lives(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_notifications_live_id ON notifications(live_id);
