-- ═══════════════════════════════════════════════════════════
-- Assistant DB Schema — Neon Free Tier (tối giản 3 bảng)
-- Chạy trên Neon SQL Editor để tạo/update tables
-- ═══════════════════════════════════════════════════════════

-- Bảng chính: lưu uid + credentials từng người
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key TEXT UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  name TEXT NOT NULL,

  -- Lark credentials & tokens
  lark_app_id TEXT,
  lark_app_secret TEXT,
  lark_redirect_uri TEXT,
  lark_access_token TEXT,
  lark_refresh_token TEXT,
  lark_token_expires_at BIGINT DEFAULT 0,
  lark_connected BOOLEAN DEFAULT false,
  lark_user_id TEXT,
  lark_calendar_enabled BOOLEAN DEFAULT true,

  -- Google credentials & tokens (Calendar + Drive dùng chung)
  google_client_id TEXT,
  google_client_secret TEXT,
  google_redirect_uri TEXT,
  google_access_token TEXT,
  google_refresh_token TEXT,
  google_token_expires_at BIGINT DEFAULT 0,
  google_connected BOOLEAN DEFAULT false,
  google_calendar_enabled BOOLEAN DEFAULT true,
  google_drive_enabled BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Mapping events Google ↔ Lark (cho sync 2 chiều)
CREATE TABLE IF NOT EXISTS event_map (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  google_event_id TEXT,
  lark_event_id TEXT,
  synced_at BIGINT,
  UNIQUE(user_id, google_event_id),
  UNIQUE(user_id, lark_event_id)
);

-- Trạng thái sync (key-value per user)
CREATE TABLE IF NOT EXISTS sync_state (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  val TEXT,
  PRIMARY KEY (user_id, key)
);

-- ═══ Cột mới (chạy nếu bảng users đã tồn tại) ═══
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_drive_enabled BOOLEAN DEFAULT false;
