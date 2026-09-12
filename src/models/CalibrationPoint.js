import { BaseModel } from '../core/BaseModel.js';
import { ValidationError } from '../core/errors/index.js';
import { PixelLevel } from './values/PixelLevel.js';
import { MeterLevel } from './values/MeterLevel.js';
import { ZoneLevel } from './values/ZoneLevel.js';

/**
 * จุดเทียบค่าหนึ่งคู่ระหว่างพิกเซล Y กับระดับน้ำเป็นเมตร
 *
 * ต้องมีอย่างน้อย 2 จุดต่อจุดวัด `WaterLevelCalculator` จึงจะทำงานได้
 * ตาราง `calibration_points` มี UNIQUE `(station_id, pixel)` กันจุดซ้ำ
 */
export class CalibrationPoint extends BaseModel {
  /** @type {number} */
  #stationId;
  /** @type {PixelLevel} */
  #pixel;
  /** @type {MeterLevel} */
  #meter;
  /** @type {number} */
  #sortOrder;
  /** @type {string|null} */
  #zoneKey;

  /**
   * @param {object} data ข้อมูลจุดเทียบค่า
   * @param {number} data.stationId รหัสจุดวัด
   * @param {number} data.pixel ค่าพิกเซล Y
   * @param {number} data.meter ค่าระดับน้ำเป็นเมตร
   * @param {number} [data.sortOrder=0] ลำดับ
   * @param {string|null} [data.zoneKey] คีย์โซนที่เป็นเจ้าของจุดนี้
   *   `null` = ผู้ดูแลกรอกเอง · มีค่า = ระบบสร้างจากขอบบนของโซนนั้น
   */
  constructor(data = {}) {
    super(data);
    this.#stationId = Number(data.stationId);
    this.#pixel = new PixelLevel(data.pixel);
    this.#meter = new MeterLevel(data.meter);
    this.#sortOrder = Number(data.sortOrder ?? 0);
    this.#zoneKey = data.zoneKey ? String(data.zoneKey) : null;
  }

  /** @returns {number} รหัสจุดวัด */
  get stationId() { return this.#stationId; }

  /** @returns {PixelLevel} ค่าพิกเซล */
  get pixel() { return this.#pixel; }

  /** @returns {MeterLevel} ค่าเมตร */
  get meter() { return this.#meter; }

  /** @returns {number} ค่าพิกเซลดิบ */
  get pixelValue() { return this.#pixel.value; }

  /** @returns {number} ค่าเมตรดิบ */
  get meterValue() { return this.#meter.value; }

  /** @returns {number} ลำดับ */
  get sortOrder() { return this.#sortOrder; }

  /** @returns {string|null} คีย์โซนที่เป็นเจ้าของจุดนี้ (`null` = กรอกเอง) */
  get zoneKey() { return this.#zoneKey; }

  /** @returns {boolean} จุดนี้ระบบสร้างจากโซนให้อัตโนมัติหรือไม่ */
  get isFromZone() { return this.#zoneKey !== null; }

  /**
   * ตรวจความถูกต้อง
   * @returns {void}
   * @throws {ValidationError} เมื่อข้อมูลไม่ถูกต้อง
   */
  validate() {
    const errors = [];
    if (!Number.isInteger(this.#stationId) || this.#stationId <= 0) {
      errors.push({ field: 'stationId', message: 'ต้องระบุจุดวัด' });
    }
    if (this.#meter.value < 0 || this.#meter.value > 100) {
      errors.push({ field: 'meter', message: 'ระดับน้ำต้องอยู่ระหว่าง 0–100 เมตร' });
    }
    if (errors.length) throw new ValidationError('ข้อมูลจุดเทียบค่าไม่ถูกต้อง', errors);
  }

  /** @returns {object} โครงสร้างสำหรับส่งออก */
  toJSON() {
    return {
      id: this.id,
      stationId: this.#stationId,
      pixel: this.#pixel.value,
      meter: this.#meter.value,
      sortOrder: this.#sortOrder,
      zoneKey: this.#zoneKey,
      zoneLabel: this.#zoneKey ? (ZoneLevel.parse(this.#zoneKey)?.label ?? this.#zoneKey) : null,
      createdAt: this.createdAt,
    };
  }
}
