-- ─────────────────────────────────────────────────────────────────────────────
-- 001 · ตารางโดเมนหลัก (ฉบับ SQLite) — จุดวัด, ROI, จุดเทียบค่า, ค่าวัด
--
-- ความต่างจากฉบับ MySQL:
-- - INTEGER PRIMARY KEY AUTOINCREMENT แทน INT AUTO_INCREMENT
-- - TEXT แทน VARCHAR/JSON/ENUM (SQLite ไม่มีชนิดเหล่านี้ ใช้ CHECK คุมค่าแทน)
-- - REAL แทน DECIMAL/FLOAT
-- - ไม่มี ENGINE / CHARSET (SQLite เป็น UTF-8 อยู่แล้ว)
-- - เวลาเก็บเป็น TEXT รูปแบบ 'YYYY-MM-DD HH:MM:SS' ตามเวลาไทย
--   ซึ่งเปรียบเทียบเรียงลำดับได้ตรงกับลำดับเวลาจริง
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stations (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  slug                   TEXT    NOT NULL UNIQUE,
  name                   TEXT    NOT NULL,
  description            TEXT,
  camera_url             TEXT,
  camera_type            TEXT    NOT NULL DEFAULT 'm3u8'
                                 CHECK (camera_type IN ('snapshot','m3u8','mjpeg')),
  image_width            INTEGER NOT NULL DEFAULT 704,
  image_height           INTEGER NOT NULL DEFAULT 576,
  latitude               REAL,
  longitude              REAL,
  is_active              INTEGER NOT NULL DEFAULT 1,
  alert_zone_keys        TEXT    NOT NULL DEFAULT '[]',
  alert_cooldown_minutes INTEGER NOT NULL DEFAULT 60,
  line_group_id          TEXT,
  pdpa_enabled           INTEGER NOT NULL DEFAULT 1,
  pdpa_method            TEXT    NOT NULL DEFAULT 'blur',
  pdpa_blur_strength     INTEGER NOT NULL DEFAULT 30,
  pdpa_conf_threshold    REAL    NOT NULL DEFAULT 0.30,
  image_retention_days   INTEGER NOT NULL DEFAULT 90,
  created_at             TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at             TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_stations_active ON stations (is_active);

CREATE TABLE IF NOT EXISTS station_rois (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id  INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  type        TEXT    NOT NULL DEFAULT 'measurement'
                      CHECK (type IN ('measurement','detection')),
  points      TEXT    NOT NULL,
  zones       TEXT    NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_rois_station ON station_rois (station_id, sort_order);

CREATE TABLE IF NOT EXISTS calibration_points (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id  INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  pixel       INTEGER NOT NULL,
  meter       REAL    NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (station_id, pixel)
);

CREATE INDEX IF NOT EXISTS idx_calibration_station ON calibration_points (station_id, pixel);

CREATE TABLE IF NOT EXISTS measurements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id      INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  measured_at     TEXT    NOT NULL,
  water_line      INTEGER NOT NULL,
  water_level_m   REAL,
  zone_key        TEXT,
  image_path      TEXT,
  thumbnail_path  TEXT,
  processing_time REAL,
  source          TEXT    NOT NULL DEFAULT 'CRON'
                          CHECK (source IN ('CRON','MANUAL','LEGACY')),
  pdpa_stats      TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_measurements_station_time ON measurements (station_id, measured_at);
CREATE INDEX IF NOT EXISTS idx_measurements_station_zone ON measurements (station_id, zone_key, measured_at);
CREATE INDEX IF NOT EXISTS idx_measurements_time ON measurements (measured_at);

CREATE TABLE IF NOT EXISTS validation_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id      INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  suspected_level INTEGER NOT NULL,
  confirmed_level INTEGER,
  variation       INTEGER NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  spread          INTEGER NOT NULL DEFAULT 0,
  success         INTEGER NOT NULL DEFAULT 0,
  note            TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_validation_station ON validation_logs (station_id, created_at);
CREATE INDEX IF NOT EXISTS idx_validation_success ON validation_logs (success, created_at);

CREATE TABLE IF NOT EXISTS station_alert_states (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id            INTEGER NOT NULL UNIQUE REFERENCES stations(id) ON DELETE CASCADE,
  last_zone_key         TEXT,
  last_alerted_zone_key TEXT,
  last_alert_at         TEXT,
  last_measured_at      TEXT,
  updated_at            TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
