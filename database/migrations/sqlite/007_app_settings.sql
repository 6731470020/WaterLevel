-- ค่าตั้งค่าที่แก้ได้จากหน้าผู้ดูแล
--
-- เดิมค่าช่องทางแจ้งเตือนอยู่ใน `.env` อย่างเดียว ซึ่งแปลว่าผู้ดูแลต้อง SSH เข้าเครื่อง
-- แก้ไฟล์แล้วรีสตาร์ตทุกครั้งที่เปลี่ยนกลุ่ม LINE หรือเพิ่มห้อง Discord
-- ตารางนี้ให้แก้จากหน้าเว็บได้ โดย `.env` ยังทำหน้าที่เป็นค่าตั้งต้น
--
-- `is_secret = 1` คือค่าที่ห้ามส่งกลับไปแสดงบนหน้าเว็บ (โทเคน รหัสผ่าน)
-- หน้าเว็บจะเห็นแค่ว่า "ตั้งค่าไว้แล้ว" กับ 4 ตัวท้ายเท่านั้น
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT    PRIMARY KEY,
  value       TEXT    NOT NULL,
  is_secret   INTEGER NOT NULL DEFAULT 0,
  updated_by  INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
