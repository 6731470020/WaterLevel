-- ─────────────────────────────────────────────────────────────────────────────
-- 004 · ทริกเกอร์ปรับปรุง updated_at อัตโนมัติ (เฉพาะ SQLite)
--
-- MySQL มี `ON UPDATE CURRENT_TIMESTAMP` ในตัว แต่ SQLite ไม่มี
-- จึงต้องสร้างทริกเกอร์เองเพื่อให้พฤติกรรมตรงกันทั้งสองค่าย
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TRIGGER IF NOT EXISTS trg_stations_updated_at
AFTER UPDATE ON stations FOR EACH ROW
BEGIN
  UPDATE stations SET updated_at = datetime('now','localtime') WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_station_rois_updated_at
AFTER UPDATE ON station_rois FOR EACH ROW
BEGIN
  UPDATE station_rois SET updated_at = datetime('now','localtime') WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_calibration_points_updated_at
AFTER UPDATE ON calibration_points FOR EACH ROW
BEGIN
  UPDATE calibration_points SET updated_at = datetime('now','localtime') WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_users_updated_at
AFTER UPDATE ON users FOR EACH ROW
BEGIN
  UPDATE users SET updated_at = datetime('now','localtime') WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_daily_reports_updated_at
AFTER UPDATE ON daily_reports FOR EACH ROW
BEGIN
  UPDATE daily_reports SET updated_at = datetime('now','localtime') WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_licenses_updated_at
AFTER UPDATE ON licenses FOR EACH ROW
BEGIN
  UPDATE licenses SET updated_at = datetime('now','localtime') WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_alert_states_updated_at
AFTER UPDATE ON station_alert_states FOR EACH ROW
BEGIN
  UPDATE station_alert_states SET updated_at = datetime('now','localtime') WHERE id = OLD.id;
END;
