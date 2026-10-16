-- Migration 001: Add admin, moderation, reports, and audit logging system to Nesty
-- Safe to execute against existing databases

-- 1. Add roles, status, and suspension tracking to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS role varchar(20) DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status varchar(20) DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_until timestamptz NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status_reason text DEFAULT '';

-- Populate default values for existing users if NULL
UPDATE users SET role = 'user' WHERE role IS NULL OR role = '';
UPDATE users SET status = 'active' WHERE status IS NULL OR status = '';

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- 2. Add soft-delete / hide tracking for posts and comments
ALTER TABLE posts ADD COLUMN IF NOT EXISTS hidden_at timestamptz NULL;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS hidden_by bigint NULL;
CREATE INDEX IF NOT EXISTS idx_posts_hidden_at ON posts(hidden_at);

ALTER TABLE comments ADD COLUMN IF NOT EXISTS hidden_at timestamptz NULL;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS hidden_by bigint NULL;
CREATE INDEX IF NOT EXISTS idx_comments_hidden_at ON comments(hidden_at);

-- 3. Create reports table
CREATE TABLE IF NOT EXISTS reports (
    id bigserial PRIMARY KEY,
    reporter_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type varchar(20) NOT NULL, -- 'post', 'comment', 'user'
    target_id bigint NOT NULL,
    reason varchar(50) NOT NULL,      -- 'spam', 'harassment', 'hate', 'nudity', 'violence', 'scam', 'other'
    note text DEFAULT '',
    status varchar(20) DEFAULT 'open', -- 'open', 'resolved', 'dismissed'
    resolved_by bigint NULL REFERENCES users(id) ON DELETE SET NULL,
    resolution varchar(50) DEFAULT '', -- 'dismissed', 'remove_content', 'suspend_user', 'ban_user'
    created_at timestamptz DEFAULT NOW(),
    resolved_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at);

-- Enforce at most one OPEN report per user per target to eliminate spam
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_report_per_user_target 
ON reports(reporter_id, target_type, target_id) 
WHERE status = 'open';

-- 4. Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id bigserial PRIMARY KEY,
    admin_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action varchar(50) NOT NULL,       -- 'suspend_user', 'ban_user', 'restore_user', 'change_role', 'hide_content', 'restore_content', 'resolve_report'
    target_type varchar(20) DEFAULT '',
    target_id bigint DEFAULT 0,
    reason text DEFAULT '',
    metadata text DEFAULT '{}',
    created_at timestamptz DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_id ON audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
