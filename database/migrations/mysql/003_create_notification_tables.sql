-- ─────────────────────────────────────────────────────────────────────────────
-- 003 · ตารางแจ้งเตือน รายงาน ภาพจับเฟรม LINE และใบอนุญาต
-- ─────────────────────────────────────────────────────────────────────────────

-- ภาพจับเฟรมสำหรับแนบไปกับการแจ้งเตือน (เดิม: broadcast_captures)
CREATE TABLE IF NOT EXISTS capture_snapshots (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  station_id      INT           NOT NULL,
  water_line      INT           NOT NULL,
  water_level_m   DECIMAL(10,2) NULL,
  zone_key        VARCHAR(20)   NULL,
  processing_time FLOAT         NULL,
  image_path      VARCHAR(500)  NULL,
  thumbnail_path  VARCHAR(500)  NULL,
  pdpa_stats      JSON          NULL,
  capture_type    ENUM('BROADCAST','REPORT','MANUAL') NOT NULL DEFAULT 'BROADCAST',
  triggered_by    INT           NULL COMMENT 'NULL = ระบบ',
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_station_time (station_id, created_at),
  FOREIGN KEY (station_id)   REFERENCES stations(id) ON DELETE CASCADE,
  FOREIGN KEY (triggered_by) REFERENCES users(id)    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- บันทึกการส่งข้อความทุกครั้ง ทั้งสำเร็จและล้มเหลว (เดิม: broadcast_history)
CREATE TABLE IF NOT EXISTS broadcast_logs (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  station_id      INT          NULL,
  message_type    ENUM('ALERT','REPORT','TEST','REPLY') NOT NULL DEFAULT 'ALERT',
  zone_key        VARCHAR(20)  NULL,
  channel         VARCHAR(20)  NULL COMMENT 'line | console',
  target          VARCHAR(100) NULL COMMENT 'รหัสกลุ่ม/ผู้ใช้ปลายทาง',
  message_content JSON         NULL,
  status          ENUM('PENDING','SENT','FAILED') NOT NULL DEFAULT 'PENDING',
  response        JSON         NULL,
  error_message   VARCHAR(500) NULL,
  sent_at         DATETIME     NULL,
  triggered_by    INT          NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_station_time (station_id, created_at),
  INDEX idx_status (status, created_at),
  INDEX idx_type (message_type, created_at),
  FOREIGN KEY (station_id)   REFERENCES stations(id) ON DELETE CASCADE,
  FOREIGN KEY (triggered_by) REFERENCES users(id)    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- รายงานประจำวัน — upsert ด้วยคีย์ (station_id, report_date)
CREATE TABLE IF NOT EXISTS daily_reports (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  station_id        INT           NOT NULL,
  report_date       DATE          NOT NULL,
  highest_pixel     INT           NULL COMMENT 'พิกเซลน้อยที่สุดของวัน = ระดับน้ำสูงสุด',
  lowest_pixel      INT           NULL COMMENT 'พิกเซลมากที่สุดของวัน = ระดับน้ำต่ำสุด',
  highest_meter     DECIMAL(10,2) NULL,
  lowest_meter      DECIMAL(10,2) NULL,
  highest_at        TIME          NULL,
  lowest_at         TIME          NULL,
  current_meter     DECIMAL(10,2) NULL COMMENT 'ค่าล่าสุดของวัน',
  measurement_count INT           NOT NULL DEFAULT 0,
  image_path        VARCHAR(500)  NULL,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_station_date (station_id, report_date),
  INDEX idx_date (report_date),
  FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ประวัติการส่งรายงาน (เดิม: report_history)
CREATE TABLE IF NOT EXISTS report_logs (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  station_id      INT          NOT NULL,
  report_type     VARCHAR(50)  NOT NULL DEFAULT 'DAILY',
  report_date     DATE         NOT NULL,
  message_content JSON         NULL,
  recipients      JSON         NULL,
  status          ENUM('PENDING','SENT','FAILED') NOT NULL DEFAULT 'PENDING',
  sent_at         DATETIME     NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_station_date (station_id, report_date),
  FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS line_groups (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  group_id       VARCHAR(100) NOT NULL UNIQUE,
  type           VARCHAR(20)  NOT NULL DEFAULT 'group',
  display_name   VARCHAR(255) NULL,
  status         VARCHAR(20)  NOT NULL DEFAULT 'active',
  joined_at      DATETIME     NULL DEFAULT CURRENT_TIMESTAMP,
  last_active_at DATETIME     NULL DEFAULT CURRENT_TIMESTAMP,
  left_at        DATETIME     NULL,
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS line_users (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  line_user_id   VARCHAR(100) NOT NULL UNIQUE,
  display_name   VARCHAR(255) NULL,
  status         VARCHAR(20)  NOT NULL DEFAULT 'active',
  followed_at    DATETIME     NULL DEFAULT CURRENT_TIMESTAMP,
  last_active_at DATETIME     NULL DEFAULT CURRENT_TIMESTAMP,
  unfollowed_at  DATETIME     NULL,
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS licenses (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  license_key   VARCHAR(255) NOT NULL UNIQUE,
  expired_at    DATETIME     NOT NULL,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  contact_email VARCHAR(255) NULL,
  contact_phone VARCHAR(50)  NULL,
  contact_line  VARCHAR(50)  NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_active (is_active, expired_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
