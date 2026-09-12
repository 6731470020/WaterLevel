-- ค่าตั้งค่าที่แก้ได้จากหน้าผู้ดูแล
--
-- เดิมค่าช่องทางแจ้งเตือนอยู่ใน `.env` อย่างเดียว ซึ่งแปลว่าผู้ดูแลต้อง SSH เข้าเครื่อง
-- แก้ไฟล์แล้วรีสตาร์ตทุกครั้งที่เปลี่ยนกลุ่ม LINE หรือเพิ่มห้อง Discord
-- ตารางนี้ให้แก้จากหน้าเว็บได้ โดย `.env` ยังทำหน้าที่เป็นค่าตั้งต้น
CREATE TABLE IF NOT EXISTS app_settings (
  `key`       VARCHAR(80)  NOT NULL PRIMARY KEY,
  value       TEXT         NOT NULL,
  is_secret   TINYINT(1)   NOT NULL DEFAULT 0,
  updated_by  INT          NULL,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
