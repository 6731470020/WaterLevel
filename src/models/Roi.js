import { BaseModel } from '../core/BaseModel.js';
import { ValidationError } from '../core/errors/index.js';
import { Zone } from './Zone.js';

/** ชนิด ROI ที่รองรับ (ตรงกับ `data/roi.html`) */
const TYPES = ['measurement', 'detection'];

/**
 * ขอบเขตความสนใจ (Region of Interest) — กรอบ 4 มุมบนภาพ
 *
 * ระบบเดิมยัดทั้ง ROI และโซนไว้ในคอลัมน์ `configs.config_data` เป็น JSON ก้อนเดียว
 * ระบบใหม่แยกเป็นตาราง `station_rois` ของตัวเอง แต่ยังอ่านไฟล์ config เดิม
 * ทั้ง version 2.0 และ 3.0 ได้ผ่าน `fromLegacy()`
 *
 * - `measurement` (สีเหลือง) — กรอบเสาวัดระดับ มีโซนเตือนภัย
 * - `detection` (สีม่วง) — กรอบให้ AI ค้นหาผิวน้ำ ไม่มีโซน
 */
export class Roi extends BaseModel {
  /** @type {number} */
  #stationId;
  /** @type {string} */
  #name;
  /** @type {string} */
  #type;
  /** @type {Array<{x: number, y: number}>} */
  #points;
  /** @type {Array<Zone>} */
  #zones;
  /** @type {number} */
  #sortOrder;

  /**
   * @param {object} data ข้อมูล ROI
   * @param {number} data.stationId รหัสจุดวัด
   * @param {string} data.name ชื่อ ROI
   * @param {string} [data.type='measurement'] ชนิด ROI
   * @param {Array<{x: number, y: number}>} data.points มุมทั้งสี่
   * @param {Array<object>} [data.zones=[]] โซนเตือนภัย (เฉพาะชนิด measurement)
   * @param {number} [data.sortOrder=0] ลำดับการแสดงผล
   */
  constructor(data = {}) {
    super(data);
    this.#stationId = Number(data.stationId);
    this.#name = String(data.name ?? '').trim();
    this.#type = TYPES.includes(data.type) ? data.type : 'measurement';
    this.#points = Roi.#normalizePoints(data.points);
    this.#zones = this.#type === 'measurement' ? Zone.fromArray(data.zones) : [];
    this.#sortOrder = Number(data.sortOrder ?? 0);
  }

  /** @returns {number} รหัสจุดวัดที่ ROI นี้สังกัด */
  get stationId() { return this.#stationId; }

  /** @returns {string} ชื่อ ROI */
  get name() { return this.#name; }

  /** @returns {string} ชนิด ROI */
  get type() { return this.#type; }

  /** @returns {boolean} เป็น ROI สำหรับวัดระดับหรือไม่ */
  get isMeasurement() { return this.#type === 'measurement'; }

  /** @returns {Array<{x: number, y: number}>} มุมทั้งสี่ (สำเนา) */
  get points() { return this.#points.map((point) => ({ ...point })); }

  /** @returns {Array<Zone>} โซนเตือนภัย (สำเนา) */
  get zones() { return [...this.#zones]; }

  /** @returns {number} ลำดับการแสดงผล */
  get sortOrder() { return this.#sortOrder; }

  /** @returns {string} สีเส้นกรอบตามชนิด (เหมือนระบบเดิม) */
  get strokeColor() { return this.isMeasurement ? '#EAB308' : '#A855F7'; }

  /**
   * กรอบสี่เหลี่ยมที่ครอบ ROI ทั้งหมด
   * @returns {{x: number, y: number, width: number, height: number}}
   */
  get boundingBox() {
    const xs = this.#points.map((point) => point.x);
    const ys = this.#points.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  }

  /**
   * ค้นหาโซนตามคีย์
   * @param {string} key คีย์โซน
   * @returns {Zone|null}
   */
  findZone(key) { return this.#zones.find((zone) => zone.key === key) ?? null; }

  /**
   * คำเตือนเกี่ยวกับโซน — เรียกจากหน้าเครื่องมือวาด ROI และก่อนบันทึก
   * @param {number|null} [imageHeight=null] ความสูงภาพ
   * @returns {Array<string>} รายการคำเตือนภาษาไทย
   */
  zoneIssues(imageHeight = null) {
    if (!this.isMeasurement) return [];
    return Zone.findIssues(this.#zones, imageHeight);
  }

  /**
   * อ่านโครงสร้าง config เดิม (`configs.config_data`) ทั้ง version 2.0 และ 3.0
   *
   * version 3.0 เก็บ `rois: [{ points, zones, type }]`
   * version 2.0 เก็บ `roi: { points }` กับ `zones` แยกไว้ที่ระดับบนสุด
   *
   * @param {object} config วัตถุ config ที่แปลงจาก JSON แล้ว
   * @param {number} stationId รหัสจุดวัดปลายทาง
   * @returns {Array<Roi>} รายการ ROI ที่อ่านได้
   */
  static fromLegacy(config, stationId) {
    if (!config || typeof config !== 'object') return [];

    if (Array.isArray(config.rois)) {
      return config.rois.map((raw, index) => new Roi({
        stationId,
        name: raw.name ?? `ROI_${index + 1}`,
        type: raw.type ?? 'measurement',
        points: raw.points,
        zones: raw.zones,
        sortOrder: index,
      }));
    }

    if (config.roi?.points) {
      return [new Roi({
        stationId,
        name: config.roi.name ?? config.location_name ?? 'ROI_วัดระดับ',
        type: 'measurement',
        points: config.roi.points,
        zones: config.zones ?? [],
        sortOrder: 0,
      })];
    }
    return [];
  }

  /**
   * ตรวจความถูกต้อง
   * @returns {void}
   * @throws {ValidationError} เมื่อจำนวนมุมไม่ครบ 4 หรือข้อมูลอื่นผิด
   */
  validate() {
    const errors = [];
    if (!Number.isInteger(this.#stationId) || this.#stationId <= 0) {
      errors.push({ field: 'stationId', message: 'ต้องระบุจุดวัด' });
    }
    if (!this.#name) {
      errors.push({ field: 'name', message: 'กรุณาตั้งชื่อ ROI' });
    }
    if (!TYPES.includes(this.#type)) {
      errors.push({ field: 'type', message: `ชนิด ROI ต้องเป็น: ${TYPES.join(' หรือ ')}` });
    }
    if (this.#points.length !== 4) {
      errors.push({ field: 'points', message: 'ROI ต้องมีมุมครบ 4 จุด' });
    }
    if (this.isMeasurement && !this.#zones.length) {
      errors.push({ field: 'zones', message: 'ROI ชนิดวัดระดับต้องกำหนดโซนเตือนภัย' });
    }
    if (errors.length) throw new ValidationError('ข้อมูล ROI ไม่ถูกต้อง', errors);
  }

  /** @returns {object} โครงสร้างสำหรับส่งออก */
  toJSON() {
    return {
      id: this.id,
      stationId: this.#stationId,
      name: this.#name,
      type: this.#type,
      points: this.points,
      zones: this.#zones.map((zone) => zone.toJSON()),
      sortOrder: this.#sortOrder,
      strokeColor: this.strokeColor,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * ทำความสะอาดรายการจุดมุม
   * @param {Array<{x: number, y: number}>} points จุดดิบ
   * @returns {Array<{x: number, y: number}>}
   */
  static #normalizePoints(points) {
    return (points ?? [])
      .filter((point) => point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)))
      .map((point) => ({ x: Math.round(Number(point.x)), y: Math.round(Number(point.y)) }));
  }
}
