import { BaseRepository } from '../core/BaseRepository.js';
import { Measurement } from '../models/Measurement.js';

/**
 * ที่เก็บค่าวัดระดับน้ำ — ตารางที่มีข้อมูลมากที่สุดในระบบ
 *
 * คำสั่งกราฟใช้ดัชนี `(station_id, measured_at)` และลดความละเอียดด้วย SQL
 * เมื่อช่วงเวลากว้างเกิน 7 วัน (CLAUDE.md ข้อ 13)
 */
export class MeasurementRepository extends BaseRepository {
  /** @param {import('../core/Database.js').Database} db ตัวเชื่อมฐานข้อมูล */
  constructor(db) {
    super(db, 'measurements');
  }

  /**
   * แปลงแถวดิบเป็นวัตถุ `Measurement`
   * @param {object} row แถวจากตาราง `measurements`
   * @returns {Measurement}
   */
  mapRow(row) {
    return new Measurement({
      id: row.id,
      stationId: row.station_id,
      measuredAt: row.measured_at,
      waterLine: row.water_line,
      waterLevelM: row.water_level_m,
      zoneKey: row.zone_key,
      imagePath: row.image_path,
      thumbnailPath: row.thumbnail_path,
      processingTime: row.processing_time,
      source: row.source,
      quality: row.quality,
      pdpaStats: row.pdpa_stats,
      createdAt: row.created_at,
    });
  }

  /**
   * แปลงวัตถุ `Measurement` เป็นคู่คอลัมน์-ค่า
   * @param {Measurement} measurement ค่าวัด
   * @returns {object}
   */
  toRow(measurement) {
    return {
      station_id: measurement.stationId,
      measured_at: measurement.measuredAt,
      water_line: measurement.waterLine.value,
      water_level_m: measurement.waterLevelM?.value ?? null,
      zone_key: measurement.zoneKey,
      image_path: measurement.imagePath,
      thumbnail_path: measurement.thumbnailPath,
      processing_time: measurement.processingTime,
      source: measurement.source,
      quality: measurement.quality,
      pdpa_stats: measurement.pdpaStats ? JSON.stringify(measurement.pdpaStats) : null,
    };
  }

  /**
   * ค่าวัดล่าสุดของจุดวัด
   * @param {number} stationId รหัสจุดวัด
   * @returns {Promise<Measurement|null>}
   */
  async findLatest(stationId) {
    const row = await this.db.queryOne(
      'SELECT * FROM measurements WHERE station_id = ? ORDER BY measured_at DESC, id DESC LIMIT 1',
      [stationId],
    );
    return row ? this.mapRow(row) : null;
  }

  /**
   * ค่าวัด N รายการล่าสุด — ใช้คำนวณค่าเฉลี่ยในการตรวจความผันผวน
   * @param {number} stationId รหัสจุดวัด
   * @param {number} [limit=3] จำนวนรายการ
   * @returns {Promise<Array<Measurement>>} เรียงจากใหม่ไปเก่า
   */
  async findRecent(stationId, limit = 3) {
    const rows = await this.db.query(
      'SELECT * FROM measurements WHERE station_id = ? ORDER BY measured_at DESC, id DESC LIMIT ?',
      [stationId, Number(limit)],
    );
    return rows.map((row) => this.mapRow(row));
  }

  /**
   * ค้นค่าวัดตามตัวกรอง พร้อมแบ่งหน้า
   * @param {{stationId?: number|null, stationIds?: Array<number>|null, from?: string|null, to?: string|null, zoneKey?: string|null, limit?: number, offset?: number}} [filters={}]
   * @returns {Promise<{items: Array<Measurement>, total: number}>}
   */
  async search({
    stationId = null, stationIds = null, from = null, to = null,
    zoneKey = null, limit = 50, offset = 0,
  } = {}) {
    const { where, params } = this.#buildFilter({ stationId, stationIds, from, to, zoneKey });
    if (where === null) return { items: [], total: 0 };

    const totalRow = await this.db.queryOne(`SELECT COUNT(*) AS total FROM measurements ${where}`, params);
    const rows = await this.db.query(
      `SELECT * FROM measurements ${where} ORDER BY measured_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, Number(limit), Number(offset)],
    );
    return { items: rows.map((row) => this.mapRow(row)), total: Number(totalRow?.total ?? 0) };
  }

  /**
   * ข้อมูลสำหรับกราฟ — ลดความละเอียดอัตโนมัติเมื่อช่วงเวลากว้าง
   *
   * ≤ 2 วัน คืนทุกจุด, ≤ 14 วัน ยุบเป็นรายชั่วโมง, มากกว่านั้นยุบเป็นรายวัน
   *
   * @param {number} stationId รหัสจุดวัด
   * @param {{from: string, to: string}} range ช่วงเวลา (`YYYY-MM-DD HH:MM:SS`)
   * @returns {Promise<Array<{t: string, waterLine: number, waterLevelM: number|null, zoneKey: string|null}>>}
   */
  async chartSeries(stationId, { from, to }) {
    const spanDays = (new Date(to).getTime() - new Date(from).getTime()) / 86400000;

    if (spanDays <= 2) {
      const rows = await this.db.query(
        `SELECT measured_at, water_line, water_level_m, zone_key, quality
         FROM measurements
         WHERE station_id = ? AND measured_at BETWEEN ? AND ?
         ORDER BY measured_at`,
        [stationId, from, to],
      );
      return rows.map((row) => ({
        t: MeasurementRepository.#formatTime(row.measured_at),
        waterLine: Number(row.water_line),
        waterLevelM: row.water_level_m === null ? null : Number(row.water_level_m),
        zoneKey: row.zone_key,
        quality: row.quality,
      }));
    }

    // ตัวระบุรูปแบบ %Y %m %d %H เหมือนกันทั้ง MySQL และ SQLite ต่างแค่ชื่อฟังก์ชัน
    const format = spanDays <= 14 ? '%Y-%m-%d %H:00:00' : '%Y-%m-%d 00:00:00';
    const rows = await this.db.query(
      `SELECT ${this.db.dialect.formatDate('measured_at')} AS bucket,
              ROUND(AVG(water_line)) AS water_line,
              ROUND(AVG(water_level_m), 2) AS water_level_m,
              MIN(water_line) AS highest_pixel
       FROM measurements
       WHERE station_id = ? AND measured_at BETWEEN ? AND ?
       GROUP BY bucket
       ORDER BY bucket`,
      [format, stationId, from, to],
    );
    return rows.map((row) => ({
      t: row.bucket,
      waterLine: Number(row.water_line),
      waterLevelM: row.water_level_m === null ? null : Number(row.water_level_m),
      zoneKey: null,
    }));
  }

  /**
   * สรุปค่าสูงสุด/ต่ำสุด/จำนวนครั้ง ในช่วงเวลาหนึ่ง
   *
   * ⚠️ `MIN(water_line)` = ระดับน้ำ**สูงสุด** เพราะพิกเซลน้อย = น้ำสูง
   *
   * @param {number} stationId รหัสจุดวัด
   * @param {{from: string, to: string}} range ช่วงเวลา
   * @returns {Promise<{count: number, highestPixel: number|null, lowestPixel: number|null, highestAt: string|null, lowestAt: string|null, highestMeter: number|null, lowestMeter: number|null, currentMeter: number|null, currentPixel: number|null}>}
   */
  async summarize(stationId, { from, to }) {
    const row = await this.db.queryOne(
      `SELECT COUNT(*) AS total,
              MIN(water_line) AS highest_pixel,
              MAX(water_line) AS lowest_pixel
       FROM measurements
       WHERE station_id = ? AND measured_at BETWEEN ? AND ?`,
      [stationId, from, to],
    );
    const count = Number(row?.total ?? 0);
    if (!count) {
      return {
        count: 0, highestPixel: null, lowestPixel: null,
        highestAt: null, lowestAt: null,
        highestMeter: null, lowestMeter: null,
        currentMeter: null, currentPixel: null,
      };
    }

    const highestPixel = Number(row.highest_pixel);
    const lowestPixel = Number(row.lowest_pixel);
    const [highestRow, lowestRow, currentRow] = await Promise.all([
      this.db.queryOne(
        `SELECT measured_at, water_level_m FROM measurements
         WHERE station_id = ? AND measured_at BETWEEN ? AND ? AND water_line = ?
         ORDER BY measured_at LIMIT 1`,
        [stationId, from, to, highestPixel],
      ),
      this.db.queryOne(
        `SELECT measured_at, water_level_m FROM measurements
         WHERE station_id = ? AND measured_at BETWEEN ? AND ? AND water_line = ?
         ORDER BY measured_at LIMIT 1`,
        [stationId, from, to, lowestPixel],
      ),
      this.db.queryOne(
        `SELECT water_line, water_level_m FROM measurements
         WHERE station_id = ? AND measured_at BETWEEN ? AND ?
         ORDER BY measured_at DESC, id DESC LIMIT 1`,
        [stationId, from, to],
      ),
    ]);

    return {
      count,
      highestPixel,
      lowestPixel,
      highestAt: MeasurementRepository.#formatTimeOnly(highestRow?.measured_at),
      lowestAt: MeasurementRepository.#formatTimeOnly(lowestRow?.measured_at),
      highestMeter: highestRow?.water_level_m === null || highestRow?.water_level_m === undefined
        ? null : Number(highestRow.water_level_m),
      lowestMeter: lowestRow?.water_level_m === null || lowestRow?.water_level_m === undefined
        ? null : Number(lowestRow.water_level_m),
      currentMeter: currentRow?.water_level_m === null || currentRow?.water_level_m === undefined
        ? null : Number(currentRow.water_level_m),
      currentPixel: currentRow?.water_line === undefined ? null : Number(currentRow.water_line),
    };
  }

  /**
   * ภาพล่าสุดสำหรับแกลเลอรีในหน้าสาธารณะ
   * @param {number} stationId รหัสจุดวัด
   * @param {number} [limit=12] จำนวนภาพ
   * @returns {Promise<Array<Measurement>>}
   */
  async recentWithImages(stationId, limit = 12) {
    const rows = await this.db.query(
      `SELECT * FROM measurements
       WHERE station_id = ? AND image_path IS NOT NULL
       ORDER BY measured_at DESC, id DESC LIMIT ?`,
      [stationId, Number(limit)],
    );
    return rows.map((row) => this.mapRow(row));
  }

  /**
   * จุดวัดที่ไม่มีข้อมูลเข้ามานานเกินกำหนด — ใช้โดย `HealthCheckJob`
   * @param {number} [minutes=30] จำนวนนาที
   * @returns {Promise<Array<{stationId: number, name: string, lastMeasuredAt: Date|null}>>}
   */
  async findStaleStations(minutes = 30) {
    const cutoff = new Date(Date.now() - Number(minutes) * 60000);
    const rows = await this.db.query(`
      SELECT s.id AS station_id, s.name, MAX(m.measured_at) AS last_measured_at
      FROM stations s
      LEFT JOIN measurements m ON m.station_id = s.id
      WHERE s.is_active = 1
      GROUP BY s.id, s.name
      HAVING last_measured_at IS NULL OR last_measured_at < ?
    `, [cutoff]);
    return rows.map((row) => ({
      stationId: Number(row.station_id),
      name: row.name,
      lastMeasuredAt: row.last_measured_at,
    }));
  }

  /**
   * ค่าวัดที่มีภาพและเก่ากว่ากำหนด — ใช้โดย `RetentionJob` เพื่อลบไฟล์
   * @param {number} days จำนวนวัน
   * @param {number} [limit=500] จำนวนรายการต่อรอบ
   * @returns {Promise<Array<{id: number, imagePath: string, thumbnailPath: string|null}>>}
   */
  async findExpiredImages(days, limit = 500) {
    const cutoff = new Date(Date.now() - Number(days) * 86400000);
    const rows = await this.db.query(
      `SELECT id, image_path, thumbnail_path FROM measurements
       WHERE image_path IS NOT NULL AND measured_at < ?
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
   * ค่าวัดของจุดวัดที่ยังไม่มีค่าเป็นเมตร
   *
   * เกิดขึ้นเมื่อบันทึกค่าไว้ก่อนที่จะตั้งจุดเทียบค่า — ค่าเมตรคำนวณตอนบันทึก
   * แถวเหล่านั้นจึงค้างเป็น NULL ตลอดไปจนกว่าจะคำนวณย้อนหลังให้
   *
   * @param {number} stationId รหัสจุดวัด
   * @param {number} [limit=5000] จำนวนสูงสุด
   * @returns {Promise<Array<{id: number, water_line: number}>>}
   */
  async findWithoutMeters(stationId, limit = 5000) {
    return this.db.query(
      'SELECT id, water_line FROM measurements '
      + 'WHERE station_id = ? AND water_level_m IS NULL ORDER BY id ASC LIMIT ?',
      [stationId, limit],
    );
  }

  /**
   * เขียนค่าเมตรและโซนที่คำนวณย้อนหลังกลับลงฐานข้อมูล
   * แถวที่**ไม่มีคีย์ `zoneKey`** จะถูกแก้เฉพาะค่าเมตร โซนเดิมคงไว้ตามเดิม
   * (ต่างจากการส่ง `zoneKey: null` ซึ่งหมายถึงลบโซนออกจริง ๆ)
   *
   * @param {Array<{id: number, meter: number, zoneKey?: string|null}>} updates รายการที่ต้องแก้
   * @returns {Promise<number>} จำนวนแถวที่แก้
   */
  async applyMeters(updates) {
    if (!updates.length) return 0;
    return this.transaction(async (tx) => {
      for (const item of updates) {
        if (Object.hasOwn(item, 'zoneKey')) {
          await tx.execute(
            'UPDATE measurements SET water_level_m = ?, zone_key = ? WHERE id = ?',
            [item.meter, item.zoneKey, item.id],
          );
        } else {
          await tx.execute(
            'UPDATE measurements SET water_level_m = ? WHERE id = ?', [item.meter, item.id],
          );
        }
      }
      return updates.length;
    });
  }

  /**
   * ลบพาธภาพของค่าวัดตามรายการรหัส
   * @param {Array<number>} ids รายการรหัส
   * @returns {Promise<number>} จำนวนแถวที่แก้
   */
  async clearImagePaths(ids) {
    if (!ids?.length) return 0;
    const placeholders = ids.map(() => '?').join(', ');
    const result = await this.db.execute(
      `UPDATE measurements SET image_path = NULL, thumbnail_path = NULL WHERE id IN (${placeholders})`,
      ids,
    );
    return result.affectedRows;
  }

  /**
   * ค่าวัดสำหรับส่งออก CSV (ไม่แบ่งหน้า แต่จำกัดจำนวนสูงสุด)
   * @param {object} filters ตัวกรองเดียวกับ `search()`
   * @param {number} [max=20000] จำนวนแถวสูงสุด
   * @returns {Promise<Array<object>>} แถวดิบพร้อมชื่อจุดวัด
   */
  async forExport(filters, max = 20000) {
    const { where, params } = this.#buildFilter(filters, 'm.');
    if (where === null) return [];
    return this.db.query(
      `SELECT m.measured_at, s.name AS station_name, m.water_line, m.water_level_m,
              m.zone_key, m.source
       FROM measurements m
       JOIN stations s ON s.id = m.station_id
       ${where}
       ORDER BY m.measured_at DESC LIMIT ?`,
      [...params, Number(max)],
    );
  }

  /**
   * ประกอบเงื่อนไข WHERE ที่ใช้ร่วมกันระหว่าง `search()` และ `forExport()`
   * @param {object} filters ตัวกรอง
   * @param {string} [prefix=''] คำนำหน้าชื่อคอลัมน์ เช่น `'m.'` เมื่อมีการ JOIN
   * @returns {{where: string|null, params: Array<*>}} `where === null` แปลว่าไม่มีทางมีผลลัพธ์
   */
  #buildFilter({ stationId = null, stationIds = null, from = null, to = null, zoneKey = null } = {}, prefix = '') {
    const conditions = [];
    const params = [];
    if (stationId !== null && stationId !== '') {
      conditions.push(`${prefix}station_id = ?`);
      params.push(Number(stationId));
    } else if (Array.isArray(stationIds)) {
      if (!stationIds.length) return { where: null, params: [] };
      conditions.push(`${prefix}station_id IN (${stationIds.map(() => '?').join(', ')})`);
      params.push(...stationIds);
    }
    if (from) { conditions.push(`${prefix}measured_at >= ?`); params.push(from); }
    if (to) { conditions.push(`${prefix}measured_at <= ?`); params.push(to); }
    if (zoneKey) { conditions.push(`${prefix}zone_key = ?`); params.push(zoneKey); }
    return {
      where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
      params,
    };
  }

  /**
   * จัดรูปแบบเวลาเป็น `YYYY-MM-DD HH:MM:SS`
   * @param {Date|string} value ค่าเวลา
   * @returns {string}
   */
  static #formatTime(value) {
    if (!(value instanceof Date)) return String(value);
    return value.toLocaleString('sv-SE');
  }

  /**
   * จัดรูปแบบเวลาเป็น `HH:MM:SS`
   * @param {Date|string|null} value ค่าเวลา
   * @returns {string|null}
   */
  static #formatTimeOnly(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toLocaleTimeString('sv-SE');
    return String(value).slice(11, 19) || null;
  }
}
