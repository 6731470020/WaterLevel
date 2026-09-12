-- ─────────────────────────────────────────────────────────────────────────────
-- 002 · ตารางระบบเข้าสู่ระบบและสิทธิ์ (สร้างใหม่ทั้งหมด)
--
-- ระบบเดิมไม่มีการยืนยันตัวตนเลย — api/configs.php?action=delete ลบข้อมูลได้
-- โดยไม่ต้องเข้าสู่ระบบ (CLAUDE.md ข้อ 2.1 ข้อบกพร่องที่ 2)
-- ต้องรันหลัง 001 เพราะ user_stations อ้างถึง stations
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  username             VARCHAR(100)  NOT NULL UNIQUE,
  email                VARCHAR(255)  NOT NULL UNIQUE,
  password_hash        VARCHAR(255)  NOT NULL,
  hash_algo            VARCHAR(20)   NOT NULL DEFAULT 'scrypt' COMMENT 'scrypt | bcrypt (ของเดิมจาก PHP)',
  full_name            VARCHAR(200)  NOT NULL,
  phone                VARCHAR(50)   NULL,
  status               ENUM('ACTIVE','SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
  is_super_admin       TINYINT(1)    NOT NULL DEFAULT 0,
  must_change_password TINYINT(1)    NOT NULL DEFAULT 0,
  failed_login_count   INT           NOT NULL DEFAULT 0,
  locked_until         DATETIME      NULL,
  last_login_at        DATETIME      NULL,
  last_login_ip        VARCHAR(45)   NULL,
  created_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at           DATETIME      NULL,
  INDEX idx_status (status, deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS roles (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  role_key    VARCHAR(50)  NOT NULL UNIQUE COMMENT 'SUPER_ADMIN, ADMIN, OPERATOR, VIEWER',
  name        VARCHAR(100) NOT NULL,
  description VARCHAR(255) NULL,
  is_system   TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1 = บทบาทระบบ ลบไม่ได้',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS permissions (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  permission_key VARCHAR(80)  NOT NULL UNIQUE COMMENT 'รูปแบบ ทรัพยากร.การกระทำ',
  resource       VARCHAR(40)  NOT NULL,
  action         VARCHAR(40)  NOT NULL,
  description    VARCHAR(255) NOT NULL,
  INDEX idx_resource (resource)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       INT NOT NULL,
  permission_id INT NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  INDEX idx_permission (permission_id),
  FOREIGN KEY (role_id)       REFERENCES roles(id)       ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INT NOT NULL,
  role_id INT NOT NULL,
  PRIMARY KEY (user_id, role_id),
  INDEX idx_role (role_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- จำกัดสิทธิ์รายจุดวัด: ผู้ใช้ที่ไม่มีแถวเลย = เข้าถึงได้ทุกจุดวัดตามบทบาท
CREATE TABLE IF NOT EXISTS user_stations (
  user_id    INT NOT NULL,
  station_id INT NOT NULL,
  PRIMARY KEY (user_id, station_id),
  INDEX idx_station (station_id),
  FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
  FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ที่เก็บ session (ใช้โดย MySqlSessionStore แทน Redis)
CREATE TABLE IF NOT EXISTS sessions (
  sid        VARCHAR(128) PRIMARY KEY,
  user_id    INT          NULL,
  data       TEXT         NOT NULL,
  ip         VARCHAR(45)  NULL,
  user_agent VARCHAR(255) NULL,
  expires_at DATETIME     NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id),
  INDEX idx_expires (expires_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT      NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE COMMENT 'sha256 ของ token — ไม่เก็บ token ดิบ',
  expires_at DATETIME NOT NULL,
  used_at    DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ประวัติรหัสผ่านเก่า — ใช้บังคับนโยบาย "ห้ามซ้ำรหัสเดิม 3 ครั้งล่าสุด"
CREATE TABLE IF NOT EXISTS password_history (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT          NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  hash_algo     VARCHAR(20)  NOT NULL DEFAULT 'scrypt',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_time (user_id, created_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  actor_id      INT          NULL COMMENT 'NULL = ระบบ/งานตามเวลา',
  actor_label   VARCHAR(100) NOT NULL,
  action        VARCHAR(80)  NOT NULL,
  resource_type VARCHAR(50)  NOT NULL,
  resource_id   VARCHAR(50)  NULL,
  before_data   JSON         NULL,
  after_data    JSON         NULL,
  ip            VARCHAR(45)  NULL,
  user_agent    VARCHAR(255) NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_resource (resource_type, resource_id),
  INDEX idx_actor (actor_id, created_at),
  INDEX idx_action (action, created_at),
  INDEX idx_created (created_at),
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
