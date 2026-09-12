-- ─────────────────────────────────────────────────────────────────────────────
-- 003 · ตารางแจ้งเตือน รายงาน ภาพจับเฟรม LINE และใบอนุญาต (ฉบับ SQLite)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS capture_snapshots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id      INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  water_line      INTEGER NOT NULL,
  water_level_m   REAL,
  zone_key        TEXT,
  processing_time REAL,
  image_path      TEXT,
  thumbnail_path  TEXT,
  pdpa_stats      TEXT,
  capture_type    TEXT    NOT NULL DEFAULT 'BROADCAST'
                          CHECK (capture_type IN ('BROADCAST','REPORT','MANUAL')),
  triggered_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_captures_station ON capture_snapshots (station_id, created_at);

CREATE TABLE IF NOT EXISTS broadcast_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id      INTEGER REFERENCES stations(id) ON DELETE CASCADE,
  message_type    TEXT    NOT NULL DEFAULT 'ALERT'
                          CHECK (message_type IN ('ALERT','REPORT','TEST','REPLY')),
  zone_key        TEXT,
  channel         TEXT,
  target          TEXT,
  message_content TEXT,
  status          TEXT    NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING','SENT','FAILED')),
  response        TEXT,
  error_message   TEXT,
  sent_at         TEXT,
  triggered_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_broadcast_station ON broadcast_logs (station_id, created_at);
CREATE INDEX IF NOT EXISTS idx_broadcast_status ON broadcast_logs (status, created_at);
CREATE INDEX IF NOT EXISTS idx_broadcast_type ON broadcast_logs (message_type, created_at);

CREATE TABLE IF NOT EXISTS daily_reports (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id        INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  report_date       TEXT    NOT NULL,
  highest_pixel     INTEGER,
  lowest_pixel      INTEGER,
  highest_meter     REAL,
  lowest_meter      REAL,
  highest_at        TEXT,
  lowest_at         TEXT,
  current_meter     REAL,
  measurement_count INTEGER NOT NULL DEFAULT 0,
  image_path        TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (station_id, report_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_reports_date ON daily_reports (report_date);

CREATE TABLE IF NOT EXISTS report_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id      INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  report_type     TEXT    NOT NULL DEFAULT 'DAILY',
  report_date     TEXT    NOT NULL,
  message_content TEXT,
  recipients      TEXT,
  status          TEXT    NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING','SENT','FAILED')),
  sent_at         TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_report_logs_station ON report_logs (station_id, report_date);

CREATE TABLE IF NOT EXISTS line_groups (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id       TEXT NOT NULL UNIQUE,
  type           TEXT NOT NULL DEFAULT 'group',
  display_name   TEXT,
  status         TEXT NOT NULL DEFAULT 'active',
  joined_at      TEXT DEFAULT (datetime('now','localtime')),
  last_active_at TEXT DEFAULT (datetime('now','localtime')),
  left_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_line_groups_status ON line_groups (status);

CREATE TABLE IF NOT EXISTS line_users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  line_user_id   TEXT NOT NULL UNIQUE,
  display_name   TEXT,
  status         TEXT NOT NULL DEFAULT 'active',
  followed_at    TEXT DEFAULT (datetime('now','localtime')),
  last_active_at TEXT DEFAULT (datetime('now','localtime')),
  unfollowed_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_line_users_status ON line_users (status);

CREATE TABLE IF NOT EXISTS licenses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  license_key   TEXT    NOT NULL UNIQUE,
  expired_at    TEXT    NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  contact_email TEXT,
  contact_phone TEXT,
  contact_line  TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_licenses_active ON licenses (is_active, expired_at);
