import { BaseRepository } from '../core/BaseRepository.js';

/**
 * ที่เก็บภาพจับเฟรมสำหรับแนบไปกับการแจ้งเตือนและรายงาน
 *
 * ไม่มีโมเดลเฉพาะเพราะเป็นข้อมูลประกอบล้วน ๆ ที่ไม่มีตรรกะทางธุรกิจของตัวเอง
 * `mapRow()` จึงคืนวัตถุธรรมดาที่จัดชื่อฟิลด์เป็น camelCase แล้ว
 */
export class CaptureRepository extends BaseRepository {
  /** @param {import('../core/Database.js').Database} db ตัวเชื่อมฐานข้อมูล */
  constructor(db) {
    super(db, 'capture_snapshots');
  }

  /**
   * แปลงแถวดิบเป็นวัตถุธรรมดา
   * @param {object} row แถวจากตาราง `capture_snapshots`
   * @returns {object}
   */
  mapRow(row) {
    return {
      id: Number(row.id),
      stationId: Number(row.station_id),
      waterLine: Number(row.water_line),
      waterLevelM: row.water_level_m === null ? null : Number(row.water_level_m),
      zoneKey: row.zone_key,
      processingTime: row.processing_time,
      imageUrl: row.image_path ? `/storage/${row.image_path}` : null,
      thumbnailUrl: row.thumbnail_path ? `/storage/${row.thumbnail_path}` : null,
      imagePath: row.image_path,
      captureType: row.capture_type,
      triggeredBy: row.triggered_by,
      createdAt: row.created_at,
    };
  }

  /**
   * บันทึกภาพจับเฟรมหนึ่งรายการ
   * @param {object} data ข้อมูลภาพ
   * @param {number} data.stationId รหัสจุดวัด
   * @param {number} data.waterLine ตำแหน่งผิวน้ำเป็นพิกเซล
   * @param {number|null} [data.waterLevelM] ระดับน้ำเป็นเมตร
   * @param {string|null} [data.zoneKey] คีย์โซน
   * @param {string|null} [data.imagePath] พาธไฟล์ภาพ
   * @param {string} [data.captureType='BROADCAST'] ชนิดการจับภาพ
   * @param {number|null} [data.triggeredBy] รหัสผู้ใช้ที่สั่ง
   * @returns {Promise<number>} รหัสแถวที่สร้าง
   */
  async record(data) {
    return this.insertRow({
      station_id: data.stationId,
      water_line: data.waterLine,
      water_level_m: data.waterLevelM ?? null,
      zone_key: data.zoneKey ?? null,
      processing_time: data.processingTime ?? null,
      image_path: data.imagePath ?? null,
      thumbnail_path: data.thumbnailPath ?? null,
      pdpa_stats: data.pdpaStats ? JSON.stringify(data.pdpaStats) : null,
      capture_type: data.captureType ?? 'BROADCAST',
      triggered_by: data.triggeredBy ?? null,
    });
  }

  /**
   * ภาพจับเฟรมล่าสุดของจุดวัด
   * @param {number} stationId รหัสจุดวัด
   * @returns {Promise<object|null>}
   */
  async findLatest(stationId) {
    const row = await this.db.queryOne(
      'SELECT * FROM capture_snapshots WHERE station_id = ? ORDER BY id DESC LIMIT 1', [stationId],
    );
    return row ? this.mapRow(row) : null;
  }

  /**
   * ภาพจับเฟรมที่เก่ากว่ากำหนด — ใช้โดย `RetentionJob`
   * @param {number} days จำนวนวัน
   * @param {number} [limit=500] จำนวนรายการต่อรอบ
   * @returns {Promise<Array<object>>}
   */
  async findExpired(days, limit = 500) {
    const cutoff = new Date(Date.now() - Number(days) * 86400000);
    const rows = await this.db.query(
      `SELECT id, image_path, thumbnail_path FROM capture_snapshots
       WHERE image_path IS NOT NULL AND created_at < ?
       ORDER BY id LIMIT ?`,
      [cutoff, Number(limit)],
    );
    return rows.map((row) => ({
      id: Number(row.id),
      imagePath: row.image_path,
      thumbnailPath: row.thumbnail_path,
    }));
  }

  /**
   * ล้างการอ้างอิงไฟล์ภาพหลังลบไฟล์จริงแล้ว
   * @param {Array<number>} ids รหัสแถว
   * @returns {Promise<number>} จำนวนแถวที่อัปเดต
   */
  async clearImagePaths(ids) {
    if (!ids?.length) return 0;
    const placeholders = ids.map(() => '?').join(', ');
    const result = await this.db.execute(
      `UPDATE capture_snapshots SET image_path = NULL, thumbnail_path = NULL WHERE id IN (${placeholders})`,
      ids,
    );
    return result.affectedRows;
  }
}
