import { BaseRepository } from '../core/BaseRepository.js';
import { Roi } from '../models/Roi.js';

/**
 * ที่เก็บขอบเขต ROI และโซนของแต่ละจุดวัด
 */
export class RoiRepository extends BaseRepository {
  /** @param {import('../core/Database.js').Database} db ตัวเชื่อมฐานข้อมูล */
  constructor(db) {
    super(db, 'station_rois');
  }

  /**
   * แปลงแถวดิบเป็นวัตถุ `Roi`
   * @param {object} row แถวจากตาราง `station_rois`
   * @returns {Roi}
   */
  mapRow(row) {
    return new Roi({
      id: row.id,
      stationId: row.station_id,
      name: row.name,
      type: row.type,
      points: RoiRepository.#parseJson(row.points, []),
      zones: RoiRepository.#parseJson(row.zones, []),
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  /**
   * แปลงวัตถุ `Roi` เป็นคู่คอลัมน์-ค่า
   * @param {Roi} roi ขอบเขต ROI
   * @returns {object}
   */
  toRow(roi) {
    return {
      station_id: roi.stationId,
      name: roi.name,
      type: roi.type,
      points: JSON.stringify(roi.points),
      zones: JSON.stringify(roi.zones.map((zone) => zone.toJSON())),
      sort_order: roi.sortOrder,
    };
  }

  /**
   * ROI ทั้งหมดของจุดวัดหนึ่ง เรียงตามลำดับการแสดงผล
   * @param {number} stationId รหัสจุดวัด
   * @returns {Promise<Array<Roi>>}
   */
  async findByStation(stationId) {
    const rows = await this.db.query(
      'SELECT * FROM station_rois WHERE station_id = ? ORDER BY sort_order, id', [stationId],
    );
    return rows.map((row) => this.mapRow(row));
  }

  /**
   * ROI ชนิดวัดระดับตัวแรกของจุดวัด — เป็นตัวที่ถือโซนเตือนภัย
   * @param {number} stationId รหัสจุดวัด
   * @returns {Promise<Roi|null>}
   */
  async findMeasurementRoi(stationId) {
    const row = await this.db.queryOne(
      "SELECT * FROM station_rois WHERE station_id = ? AND type = 'measurement' ORDER BY sort_order, id LIMIT 1",
      [stationId],
    );
    return row ? this.mapRow(row) : null;
  }

  /**
   * แทนที่ ROI ของจุดวัดทั้งชุดใน transaction เดียว
   *
   * เครื่องมือวาด ROI ส่งชุดเต็มมาเสมอ การแทนที่ทั้งชุดจึงตรงไปตรงมากว่าการ diff
   *
   * @param {number} stationId รหัสจุดวัด
   * @param {Array<Roi>} rois ชุด ROI ใหม่
   * @returns {Promise<number>} จำนวน ROI ที่บันทึก
   */
  async replaceForStation(stationId, rois) {
    for (const roi of rois) roi.validate();
    return this.transaction(async (tx) => {
      await tx.execute('DELETE FROM station_rois WHERE station_id = ?', [stationId]);
      for (const [index, roi] of rois.entries()) {
        const row = this.toRow(roi);
        row.station_id = stationId;
        row.sort_order = index;
        await this.insertRow(row, tx);
      }
      return rois.length;
    });
  }

  /**
   * โซนเตือนภัยของจุดวัด (จาก ROI ชนิดวัดระดับ)
   * @param {number} stationId รหัสจุดวัด
   * @returns {Promise<Array<import('../models/Zone.js').Zone>>}
   */
  async zonesForStation(stationId) {
    const roi = await this.findMeasurementRoi(stationId);
    return roi ? roi.zones : [];
  }

  /**
   * แปลงค่า JSON จากฐานข้อมูลอย่างปลอดภัย
   * @param {*} value ค่าดิบ
   * @param {*} fallback ค่าเริ่มต้นเมื่อแปลงไม่ได้
   * @returns {*}
   */
  static #parseJson(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return fallback; }
  }
}
