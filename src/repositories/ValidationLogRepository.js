import { BaseRepository } from '../core/BaseRepository.js';
import { ValidationLog } from '../models/ValidationLog.js';

/**
 * ที่เก็บบันทึกการตรวจความผันผวน
 *
 * ต้องบันทึกทุกครั้งที่เข้าโหมดยืนยัน ไม่ว่าผลจะผ่านหรือไม่ (CLAUDE.md ข้อ 6.4)
 */
export class ValidationLogRepository extends BaseRepository {
  /** @param {import('../core/Database.js').Database} db ตัวเชื่อมฐานข้อมูล */
  constructor(db) {
    super(db, 'validation_logs');
  }

  /**
   * แปลงแถวดิบเป็นวัตถุ `ValidationLog`
   * @param {object} row แถวจากตาราง `validation_logs`
   * @returns {ValidationLog}
   */
  mapRow(row) {
    return new ValidationLog({
      id: row.id,
      stationId: row.station_id,
      suspectedLevel: row.suspected_level,
      confirmedLevel: row.confirmed_level,
      variation: row.variation,
      attempts: row.attempts,
      spread: row.spread,
      success: Boolean(row.success),
      note: row.note,
      createdAt: row.created_at,
    });
  }

  /**
   * แปลงวัตถุ `ValidationLog` เป็นคู่คอลัมน์-ค่า
   * @param {ValidationLog} log บันทึก
   * @returns {object}
   */
  toRow(log) {
    return {
      station_id: log.stationId,
      suspected_level: log.suspectedLevel,
      confirmed_level: log.confirmedLevel,
      variation: log.variation,
      attempts: log.attempts,
      spread: log.spread,
      success: log.success ? 1 : 0,
      note: log.note,
    };
  }

  /**
   * บันทึกล่าสุดของจุดวัด
   * @param {number} stationId รหัสจุดวัด
   * @param {number} [limit=20] จำนวนรายการ
   * @returns {Promise<Array<ValidationLog>>}
   */
  async findByStation(stationId, limit = 20) {
    const rows = await this.db.query(
      'SELECT * FROM validation_logs WHERE station_id = ? ORDER BY id DESC LIMIT ?',
      [stationId, Number(limit)],
    );
    return rows.map((row) => this.mapRow(row));
  }

  /**
   * สรุปจำนวนครั้งที่ยืนยันผ่าน/ไม่ผ่านในช่วงเวลาหนึ่ง
   * @param {number} days จำนวนวันย้อนหลัง
   * @returns {Promise<{total: number, succeeded: number, failed: number}>}
   */
  async summary(days = 7) {
    const since = new Date(Date.now() - Number(days) * 86400000);
    const row = await this.db.queryOne(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS succeeded,
              SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failed
       FROM validation_logs
       WHERE created_at >= ?`,
      [since],
    );
    return {
      total: Number(row?.total ?? 0),
      succeeded: Number(row?.succeeded ?? 0),
      failed: Number(row?.failed ?? 0),
    };
  }
}
