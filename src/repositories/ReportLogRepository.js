import { BaseRepository } from '../core/BaseRepository.js';

/**
 * ที่เก็บประวัติการส่งรายงาน (เดิม: `report_history`)
 *
 * ไม่มีโมเดลเฉพาะเพราะเป็นบันทึกประกอบล้วน ๆ
 */
export class ReportLogRepository extends BaseRepository {
  /** @param {import('../core/Database.js').Database} db ตัวเชื่อมฐานข้อมูล */
  constructor(db) {
    super(db, 'report_logs');
  }

  /**
   * แปลงแถวดิบเป็นวัตถุธรรมดา
   * @param {object} row แถวจากตาราง `report_logs`
   * @returns {object}
   */
  mapRow(row) {
    return {
      id: Number(row.id),
      stationId: Number(row.station_id),
      reportType: row.report_type,
      reportDate: row.report_date,
      status: row.status,
      sentAt: row.sent_at,
      recipients: ReportLogRepository.#parseJson(row.recipients),
      createdAt: row.created_at,
    };
  }

  /**
   * บันทึกการส่งรายงานหนึ่งครั้ง
   * @param {object} data ข้อมูลการส่ง
   * @param {number} data.stationId รหัสจุดวัด
   * @param {string} data.reportDate วันที่รายงาน
   * @param {string} [data.reportType='DAILY'] ชนิดรายงาน
   * @param {string} [data.status='SENT'] สถานะ
   * @param {Array<string>} [data.recipients] รายชื่อผู้รับ
   * @param {object|null} [data.messageContent] เนื้อหาที่ส่ง
   * @returns {Promise<number>} รหัสแถวที่สร้าง
   */
  async record(data) {
    return this.insertRow({
      station_id: data.stationId,
      report_type: data.reportType ?? 'DAILY',
      report_date: data.reportDate,
      message_content: data.messageContent ? JSON.stringify(data.messageContent) : null,
      recipients: data.recipients ? JSON.stringify(data.recipients) : null,
      status: data.status ?? 'SENT',
      sent_at: data.status === 'FAILED' ? null : new Date(),
    });
  }

  /**
   * ประวัติการส่งรายงานของจุดวัด
   * @param {number} stationId รหัสจุดวัด
   * @param {number} [limit=30] จำนวนรายการ
   * @returns {Promise<Array<object>>}
   */
  async findByStation(stationId, limit = 30) {
    const rows = await this.db.query(
      'SELECT * FROM report_logs WHERE station_id = ? ORDER BY id DESC LIMIT ?',
      [stationId, Number(limit)],
    );
    return rows.map((row) => this.mapRow(row));
  }

  /**
   * แปลงค่า JSON จากฐานข้อมูลอย่างปลอดภัย
   * @param {*} value ค่าดิบ
   * @returns {*|null}
   */
  static #parseJson(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return null; }
  }
}
