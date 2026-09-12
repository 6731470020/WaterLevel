-- จุดเทียบค่าที่สร้างจากโซนเตือนภัยอัตโนมัติ
--
-- ขอบบนของโซนแต่ละโซนคือพิกเซล Y ที่ผู้ดูแลรู้ระดับน้ำจริงอยู่แล้ว
-- (เช่น "โซนวิกฤตมากเริ่มที่ 2.50 เมตร") จึงใช้เป็นจุดเทียบค่าได้ทันที
-- คอลัมน์นี้บอกว่าแถวนั้นมาจากโซนไหน — NULL คือจุดที่ผู้ดูแลกรอกเอง
ALTER TABLE calibration_points ADD COLUMN zone_key TEXT NULL;

-- โซนหนึ่งเป็นเจ้าของจุดเทียบค่าได้ไม่เกินหนึ่งจุดต่อจุดวัด
-- (ดัชนีบางส่วน จึงไม่กระทบจุดที่กรอกเองซึ่ง zone_key เป็น NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_calibration_zone
  ON calibration_points (station_id, zone_key) WHERE zone_key IS NOT NULL;
