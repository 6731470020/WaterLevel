-- ─────────────────────────────────────────────────────────────────────────────
-- 002 · ตารางระบบเข้าสู่ระบบและสิทธิ์ (ฉบับ SQLite)
--
-- ต้องรันหลัง 001 เพราะ user_stations อ้างถึง stations
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  username             TEXT    NOT NULL UNIQUE,
  email                TEXT    NOT NULL UNIQUE,
  password_hash        TEXT    NOT NULL,
  hash_algo            TEXT    NOT NULL DEFAULT 'scrypt',
  full_name            TEXT    NOT NULL,
  phone                TEXT,
  status               TEXT    NOT NULL DEFAULT 'ACTIVE'
                               CHECK (status IN ('ACTIVE','SUSPENDED')),
  is_super_admin       INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_login_count   INTEGER NOT NULL DEFAULT 0,
  locked_until         TEXT,
  last_login_at        TEXT,
  last_login_ip        TEXT,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at           TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at           TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_status ON users (status, deleted_at);

CREATE TABLE IF NOT EXISTS roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  role_key    TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  description TEXT,
  is_system   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS permissions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  permission_key TEXT NOT NULL UNIQUE,
  resource       TEXT NOT NULL,
  action         TEXT NOT NULL,
  description    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_permissions_resource ON permissions (resource);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions (permission_id);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles (role_id);

-- จำกัดสิทธิ์รายจุดวัด: ผู้ใช้ที่ไม่มีแถวเลย = เข้าถึงได้ทุกจุดวัดตามบทบาท
CREATE TABLE IF NOT EXISTS user_stations (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, station_id)
);

CREATE INDEX IF NOT EXISTS idx_user_stations_station ON user_stations (station_id);

CREATE TABLE IF NOT EXISTS sessions (
  sid        TEXT    PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  data       TEXT    NOT NULL,
  ip         TEXT,
  user_agent TEXT,
  expires_at TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT    NOT NULL UNIQUE,
  expires_at TEXT    NOT NULL,
  used_at    TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_reset_user ON password_reset_tokens (user_id);

CREATE TABLE IF NOT EXISTS password_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT    NOT NULL,
  hash_algo     TEXT    NOT NULL DEFAULT 'scrypt',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_password_history_user ON password_history (user_id, created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_label   TEXT NOT NULL,
  action        TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id   TEXT,
  before_data   TEXT,
  after_data    TEXT,
  ip            TEXT,
  user_agent    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_logs (resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs (actor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs (action, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs (created_at);
