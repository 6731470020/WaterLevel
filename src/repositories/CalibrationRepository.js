import { BaseRepository } from '../core/BaseRepository.js';
import { CalibrationPoint } from '../models/CalibrationPoint.js';

/**
 * ที่เก็บจุดเทียบค่าพิกเซล↔เมตร
 */
export class CalibrationRepository extends BaseRepository {
  /** @param {import('../core/Database.js').Database} db ตัวเชื่อมฐานข้อมูล */
  constructor(db) {
    super(db, 'calibration_points');
  }

  /**
   * แปลงแถวดิบเป็นวัตถุ `CalibrationPoint`
   * @param {object} row แถวจากตาราง `calibration_points`
   * @returns {CalibrationPoint}
   */
  mapRow(row) {
    return new CalibrationPoint({
      id: row.id,
      stationId: row.station_id,
      pixel: row.pixel,
      meter: row.meter,
      sortOrder: row.sort_order,
      zoneKey: row.zone_key ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  /**
   * แปลงวัตถุ `CalibrationPoint` เป็นคู่คอลัมน์-ค่า
   * @param {CalibrationPoint} point จุดเทียบค่า
   * @returns {object}
   */
  toRow(point) {
    return {
      station_id: point.stationId,
      pixel: point.pixelValue,
      meter: point.meterValue,
      sort_order: point.sortOrder,
      zone_key: point.zoneKey,
    };
  }

  /**
   * จุดเทียบค่าทั้งหมดของจุดวัด เรียงตามพิกเซลจากน้อยไปมาก
   * @param {number} stationId รหัสจุดวัด
   * @returns {Promise<Array<CalibrationPoint>>}
   */
  async findByStation(stationId) {
    const rows = await this.db.query(
      'SELECT * FROM calibration_points WHERE station_id = ? ORDER BY pixel ASC', [stationId],
    );
    return rows.map((row) => this.mapRow(row));
  }

  /**
   * แทนที่จุดเทียบค่าของจุดวัดทั้งชุด
   * @param {number} stationId รหัสจุดวัด
   * @param {Array<CalibrationPoint>} points ชุดจุดเทียบค่าใหม่
   * @returns {Promise<number>} จำนวนจุดที่บันทึก
   */
  async replaceForStation(stationId, points) {
    for (const point of points) point.validate();
    return this.transaction(async (tx) => {
      // ลบเฉพาะจุดที่ผู้ดูแลกรอกเอง — จุดที่มาจากโซนมีเจ้าของอยู่แล้ว
      // ถ้าลบทิ้งที่นี่ มันจะกลับมาใหม่ตอนบันทึก ROI ครั้งถัดไป ผู้ใช้จะงงว่าแก้ไม่ติด
      await tx.execute(
        'DELETE FROM calibration_points WHERE station_id = ? AND zone_key IS NULL', [stationId],
      );
      for (const point of points) {
        const row = this.toRow(point);
        row.station_id = stationId;
        row.zone_key = null;
        await this.insertRow(row, tx);
      }
      await this.#renumber(stationId, tx);
      return points.length;
    });
  }

  /**
   * ปรับจุดเทียบค่าที่มาจากโซนให้ตรงกับโซนชุดใหม่
   *
   * โซนคือเจ้าของจุดของตัวเอง เมื่อผู้ดูแลย้ายโซนหรือลบค่าเมตรออก จุดเก่าต้องหายตาม
   * จึงล้างจุดที่มาจากโซนทั้งหมดแล้วสร้างใหม่ในธุรกรรมเดียว
   *
   * ถ้าพิกเซลของโซนไปชนกับจุดที่กรอกเองไว้ (ตาราง UNIQUE `(station_id, pixel)`)
   * โซนจะชนะ แต่ต้องรายงานกลับไปว่าทับจุดไหนไปบ้าง ห้ามเงียบ
   *
   * @param {number} stationId รหัสจุดวัด
   * @param {Array<CalibrationPoint>} zonePoints จุดที่สร้างจากโซน (ต้องมี `zoneKey`)
   * @returns {Promise<{saved: number, replacedManual: Array<number>}>} จำนวนที่บันทึกและพิกเซลที่ทับจุดกรอกเอง
   */
  async syncZonePoints(stationId, zonePoints) {
    for (const point of zonePoints) point.validate();
    return this.transaction(async (tx) => {
      await tx.execute(
        'DELETE FROM calibration_points WHERE station_id = ? AND zone_key IS NOT NULL', [stationId],
      );

      const replacedManual = [];
      for (const point of zonePoints) {
        const clash = await tx.query(
          'SELECT pixel FROM calibration_points WHERE station_id = ? AND pixel = ?',
          [stationId, point.pixelValue],
        );
        if (clash.length) {
          replacedManual.push(point.pixelValue);
          await tx.execute(
            'DELETE FROM calibration_points WHERE station_id = ? AND pixel = ?',
            [stationId, point.pixelValue],
          );
        }
        const row = this.toRow(point);
        row.station_id = stationId;
        await this.insertRow(row, tx);
      }

      await this.#renumber(stationId, tx);
      return { saved: zonePoints.length, replacedManual };
    });
  }

  /**
   * เรียง `sort_order` ใหม่ตามพิกเซลจากน้อยไปมากทั้งจุดวัด
   * @param {number} stationId รหัสจุดวัด
   * @param {object} tx ธุรกรรมที่กำลังเปิดอยู่
   * @returns {Promise<void>}
   */
  async #renumber(stationId, tx) {
    const rows = await tx.query(
      'SELECT id FROM calibration_points WHERE station_id = ? ORDER BY pixel ASC', [stationId],
    );
    for (const [index, row] of rows.entries()) {
      await tx.execute('UPDATE calibration_points SET sort_order = ? WHERE id = ?',
        [index + 1, row.id]);
    }
  }

  /**
   * นับจำนวนจุดเทียบค่าของแต่ละจุดวัด — ใช้เตือนเมื่อจุดไม่ครบ 2 จุด
   * @returns {Promise<Map<number, number>>} รหัสจุดวัด → จำนวนจุด
   */
  async countByStation() {
    const rows = await this.db.query(
      'SELECT station_id, COUNT(*) AS total FROM calibration_points GROUP BY station_id',
    );
    return new Map(rows.map((row) => [Number(row.station_id), Number(row.total)]));
  }
}
