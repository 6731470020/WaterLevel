import { BaseRepository } from '../core/BaseRepository.js';
import { DailyReport } from '../models/DailyReport.js';

/**
 * ที่เก็บรายงานประจำวัน — บันทึกแบบ upsert ด้วยคีย์ `(station_id, report_date)`
 */
export class DailyReportRepository extends BaseRepository {
  /** @param {import('../core/Database.js').Database} db ตัวเชื่อมฐานข้อมูล */
  constructor(db) {
    super(db, 'daily_reports');
  }

  /**
   * แปลงแถวดิบเป็นวัตถุ `DailyReport`
   * @param {object} row แถวจากตาราง `daily_reports`
   * @returns {DailyReport}
   */
  mapRow(row) {
    return new DailyReport({
      id: row.id,
      stationId: row.station_id,
      reportDate: row.report_date,
      highestPixel: row.highest_pixel,
      lowestPixel: row.lowest_pixel,
      highestMeter: row.highest_meter,
      lowestMeter: row.lowest_meter,
      highestAt: row.highest_at,
      lowestAt: row.lowest_at,
      currentMeter: row.current_meter,
      measurementCount: row.measurement_count,
      imagePath: row.image_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  /**
   * แปลงวัตถุ `DailyReport` เป็นคู่คอลัมน์-ค่า
   * @param {DailyReport} report รายงาน
   * @returns {object}
   */
  toRow(report) {
    return {
      station_id: report.stationId,
      report_date: report.reportDate,
      highest_pixel: report.highestPixel?.value ?? null,
      lowest_pixel: report.lowestPixel?.value ?? null,
      highest_meter: report.highestMeter?.value ?? null,
      lowest_meter: report.lowestMeter?.value ?? null,
      highest_at: report.highestAt,
      lowest_at: report.lowestAt,
      current_meter: report.currentMeter?.value ?? null,
      measurement_count: report.measurementCount,
      image_path: report.imagePath,
    };
  }

  /**
   * บันทึกหรืออัปเดตรายงานของวันนั้น
   * @param {DailyReport} report รายงาน
   * @returns {Promise<DailyReport>} รายงานที่อ่านกลับมาจากฐานข้อมูล
   */
  async upsert(report) {
    report.validate();
    const id = await this.upsertRow(
      this.toRow(report),
      [
        'highest_pixel', 'lowest_pixel', 'highest_meter', 'lowest_meter',
        'highest_at', 'lowest_at', 'current_meter', 'measurement_count', 'image_path',
      ],
      ['station_id', 'report_date'],
    );
    return this.findById(id);
  }

  /**
   * ค้นรายงานของจุดวัดในวันที่ระบุ
   * @param {number} stationId รหัสจุดวัด
   * @param {string} reportDate วันที่ (`YYYY-MM-DD`)
   * @returns {Promise<DailyReport|null>}
   */
  async findByStationAndDate(stationId, reportDate) {
    const row = await this.db.queryOne(
      'SELECT * FROM daily_reports WHERE station_id = ? AND report_date = ? LIMIT 1',
      [stationId, reportDate],
    );
    return row ? this.mapRow(row) : null;
  }

  /**
   * ค้นรายงานตามตัวกรอง พร้อมแบ่งหน้า
   * @param {{stationIds?: Array<number>|null, stationId?: number|null, from?: string|null, to?: string|null, limit?: number, offset?: number}} [filters={}]
   * @returns {Promise<{items: Array<DailyReport>, total: number}>}
   */
  async search({ stationIds = null, stationId = null, from = null, to = null, limit = 50, offset = 0 } = {}) {
    const conditions = [];
    const params = [];
    if (stationId !== null && stationId !== '') {
      conditions.push('station_id = ?');
      params.push(Number(stationId));
    } else if (Array.isArray(stationIds)) {
      if (!stationIds.length) return { items: [], total: 0 };
      conditions.push(`station_id IN (${stationIds.map(() => '?').join(', ')})`);
      params.push(...stationIds);
    }
    if (from) { conditions.push('report_date >= ?'); params.push(from); }
    if (to) { conditions.push('report_date <= ?'); params.push(to); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const totalRow = await this.db.queryOne(`SELECT COUNT(*) AS total FROM daily_reports ${where}`, params);
    const rows = await this.db.query(
      `SELECT * FROM daily_reports ${where} ORDER BY report_date DESC, station_id LIMIT ? OFFSET ?`,
      [...params, Number(limit), Number(offset)],
    );
    return { items: rows.map((row) => this.mapRow(row)), total: Number(totalRow?.total ?? 0) };
  }
}
