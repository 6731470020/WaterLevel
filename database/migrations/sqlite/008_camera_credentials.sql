-- ชื่อผู้ใช้และรหัสผ่านของกล้อง เก็บแยกจาก URL
--
-- กล้อง IP หลายรุ่น (เช่น Axis) ต้องยืนยันตัวตนแบบ Digest ซึ่งใส่ในรูปแบบ
-- `http://user:pass@host/...` ไม่ได้ — รูปแบบนั้นพาได้เฉพาะ Basic
--
-- ที่สำคัญกว่านั้น: `camera_url` ถูกพิมพ์ลงหน้าสาธารณะเพื่อให้เบราว์เซอร์ต่อกล้อง
-- ถ้ารหัสผ่านอยู่ใน URL มันจะรั่วสู่ทุกคนที่กด View Source แยกออกมาเก็บที่นี่
-- แล้วให้เซิร์ฟเวอร์เป็นตัวกลางแทน รหัสผ่านจึงไม่เคยออกจากเครื่องเซิร์ฟเวอร์
ALTER TABLE stations ADD COLUMN camera_username TEXT NULL;
ALTER TABLE stations ADD COLUMN camera_password TEXT NULL;
