-- ─────────────────────────────────────────────────────────────────────────────
-- 001 · ตารางโดเมนหลัก — จุดวัด, ROI, จุดเทียบค่า, ค่าวัด
--
-- ปรับจากสคีมาเดิมใน data/bangpai.sql ตาม CLAUDE.md ข้อ 7.2
-- ทุกตารางลูกมี Foreign Key และมีดัชนีครบทุกคอลัมน์ที่ใช้กรองบ่อย
-- เวลาเก็บเป็น DATETIME ตามเวลาไทย (การเชื่อมต่อตั้ง timezone='+07:00')
-- ─────────────────────────────────────────────────────────────────────────────

-- จุดวัดระดับน้ำ (เดิม: configs)
CREATE TABLE IF NOT EXISTS stations (
  id                     INT AUTO_INCREMENT PRIMARY KEY,
  slug                   VARCHAR(100)  NOT NULL UNIQUE COMMENT 'ชื่อย่อสำหรับ URL สาธารณะ',
  name                   VARCHAR(255)  NOT NULL COMMENT 'ชื่อจุดวัด',
  description            TEXT          NULL,
  camera_url             VARCHAR(500)  NULL,
  camera_type            ENUM('snapshot','m3u8','mjpeg') NOT NULL DEFAULT 'm3u8',
  image_width            INT           NOT NULL DEFAULT 704,
  image_height           INT           NOT NULL DEFAULT 576,
  latitude               DECIMAL(10,7) NULL,
  longitude              DECIMAL(10,7) NULL,
  is_active              TINYINT(1)    NOT NULL DEFAULT 1,
  alert_zone_keys        JSON          NOT NULL COMMENT 'คีย์โซนที่ต้องแจ้งเตือน — แทน ALERT_ZONES ที่เคยฮาร์ดโค้ด',
  alert_cooldown_minutes INT           NOT NULL DEFAULT 60,
  line_group_id          VARCHAR(100)  NULL COMMENT 'กลุ่ม LINE เฉพาะของจุดวัดนี้',
  pdpa_enabled           TINYINT(1)    NOT NULL DEFAULT 1,
  pdpa_method            VARCHAR(20)   NOT NULL DEFAULT 'blur',
  pdpa_blur_strength     INT           NOT NULL DEFAULT 30,
  pdpa_conf_threshold    DECIMAL(4,2)  NOT NULL DEFAULT 0.30,
  image_retention_days   INT           NOT NULL DEFAULT 90,
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_active (is_active),
  INDEX idx_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ขอบเขต ROI และโซน (แยกออกจาก configs.config_data JSON)
CREATE TABLE IF NOT EXISTS station_rois (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  station_id  INT          NOT NULL,
  name        VARCHAR(255) NOT NULL,
  type        ENUM('measurement','detection') NOT NULL DEFAULT 'measurement',
  points      JSON         NOT NULL COMMENT 'มุมทั้งสี่ [{x,y}×4]',
  zones       JSON         NOT NULL COMMENT 'โซนเตือนภัย 6 ระดับ (เฉพาะชนิด measurement)',
  sort_order  INT          NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_station (station_id, sort_order),
  FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- จุดเทียบค่าพิกเซล↔เมตร (เดิม: pixel_meter_mapping)
CREATE TABLE IF NOT EXISTS calibration_points (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  station_id  INT           NOT NULL,
  pixel       INT           NOT NULL COMMENT 'พิกเซลแกน Y (น้อย = น้ำสูง)',
  meter       DECIMAL(10,2) NOT NULL COMMENT 'ระดับน้ำเป็นเมตร (มาก = น้ำสูง)',
  sort_order  INT           NOT NULL DEFAULT 0,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_station_pixel (station_id, pixel),
  INDEX idx_station_order (station_id, pixel),
  FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ค่าวัดระดับน้ำ (เดิม: water_history)
CREATE TABLE IF NOT EXISTS measurements (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  station_id      INT           NOT NULL,
  measured_at     DATETIME      NOT NULL,
  water_line      INT           NOT NULL COMMENT 'ตำแหน่งผิวน้ำเป็นพิกเซล Y',
  water_level_m   DECIMAL(10,2) NULL COMMENT 'คำนวณตอนบันทึก ไม่คำนวณซ้ำตอนแสดงผล',
  zone_key        VARCHAR(20)   NULL,
  image_path      VARCHAR(500)  NULL,
  thumbnail_path  VARCHAR(500)  NULL,
  processing_time FLOAT         NULL,
  source          ENUM('CRON','MANUAL','LEGACY') NOT NULL DEFAULT 'CRON',
  pdpa_stats      JSON          NULL COMMENT 'หลักฐานการปฏิบัติตาม PDPA',
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_station_time (station_id, measured_at),
  INDEX idx_station_zone (station_id, zone_key, measured_at),
  INDEX idx_measured (measured_at),
  FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- บันทึกการตรวจความผันผวน (เดิม: water_validation_log)
CREATE TABLE IF NOT EXISTS validation_logs (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  station_id      INT         NOT NULL,
  suspected_level INT         NOT NULL,
  confirmed_level INT         NULL COMMENT 'NULL เมื่อยืนยันไม่ผ่าน',
  variation       INT         NOT NULL,
  attempts        INT         NOT NULL DEFAULT 0,
  spread          INT         NOT NULL DEFAULT 0 COMMENT 'ช่วงกระจายของค่าที่วัดซ้ำ',
  success         TINYINT(1)  NOT NULL DEFAULT 0,
  note            VARCHAR(255) NULL,
  created_at      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_station_time (station_id, created_at),
  INDEX idx_success (success, created_at),
  FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- สถานะการแจ้งเตือนล่าสุดรายจุดวัด (ตารางใหม่ — ใช้กันแจ้งเตือนซ้ำ)
CREATE TABLE IF NOT EXISTS station_alert_states (
  id                     INT AUTO_INCREMENT PRIMARY KEY,
  station_id             INT         NOT NULL UNIQUE,
  last_zone_key          VARCHAR(20) NULL,
  last_alerted_zone_key  VARCHAR(20) NULL,
  last_alert_at          DATETIME    NULL,
  last_measured_at       DATETIME    NULL,
  updated_at             DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
