import { BaseModel } from '../core/BaseModel.js';
import { ValidationError } from '../core/errors/index.js';
import { PixelLevel } from './values/PixelLevel.js';
import { MeterLevel } from './values/MeterLevel.js';

/**
 * รายงานสรุประดับน้ำประจำวันของจุดวัดหนึ่งแห่ง
 *
 * ⚠️ ระวังทิศทางแกน: `highest` = พิกเซล**น้อย**ที่สุดของวัน (น้ำสูงสุด)
 * ชื่อฟิลด์ในระบบเดิม (`min_water_level` / `max_water_level`) อ้างอิงพิกเซล
 * ระบบใหม่เรียกตามความหมายจริงเพื่อไม่ให้สับสน
 */
export class DailyReport extends BaseModel {
  /** @type {number} */
  #stationId;
  /** @type {string} */
  #reportDate;
  /** @type {PixelLevel|null} */
  #highestPixel;
  /** @type {PixelLevel|null} */
  #lowestPixel;
  /** @type {MeterLevel|null} */
  #highestMeter;
  /** @type {MeterLevel|null} */
  #lowestMeter;
  /** @type {string|null} */
  #highestAt;
  /** @type {string|null} */
  #lowestAt;
  /** @type {MeterLevel|null} */
  #currentMeter;
  /** @type {number} */
  #measurementCount;
  /** @type {string|null} */
  #imagePath;

  /**
   * @param {object} data ข้อมูลรายงาน
   * @param {number} data.stationId รหัสจุดวัด
   * @param {string} data.reportDate วันที่รายงาน (`YYYY-MM-DD`)
   * @param {number|null} [data.highestPixel] พิกเซลของระดับสูงสุด
   * @param {number|null} [data.lowestPixel] พิกเซลของระดับต่ำสุด
   */
  constructor(data = {}) {
    super(data);
    this.#stationId = Number(data.stationId);
    this.#reportDate = DailyReport.#normalizeDate(data.reportDate);
    this.#highestPixel = PixelLevel.from(data.highestPixel);
    this.#lowestPixel = PixelLevel.from(data.lowestPixel);
    this.#highestMeter = MeterLevel.from(data.highestMeter);
    this.#lowestMeter = MeterLevel.from(data.lowestMeter);
    this.#highestAt = data.highestAt ? String(data.highestAt) : null;
    this.#lowestAt = data.lowestAt ? String(data.lowestAt) : null;
    this.#currentMeter = MeterLevel.from(data.currentMeter);
    this.#measurementCount = Number(data.measurementCount ?? 0);
    this.#imagePath = data.imagePath ? String(data.imagePath) : null;
  }

  /** @returns {number} รหัสจุดวัด */
  get stationId() { return this.#stationId; }

  /** @returns {string} วันที่รายงาน (`YYYY-MM-DD`) */
  get reportDate() { return this.#reportDate; }

  /** @returns {PixelLevel|null} พิกเซลของระดับน้ำสูงสุด (ค่าน้อยที่สุดของวัน) */
  get highestPixel() { return this.#highestPixel; }

  /** @returns {PixelLevel|null} พิกเซลของระดับน้ำต่ำสุด (ค่ามากที่สุดของวัน) */
  get lowestPixel() { return this.#lowestPixel; }

  /** @returns {MeterLevel|null} ระดับน้ำสูงสุดเป็นเมตร */
  get highestMeter() { return this.#highestMeter; }

  /** @returns {MeterLevel|null} ระดับน้ำต่ำสุดเป็นเมตร */
  get lowestMeter() { return this.#lowestMeter; }

  /** @returns {string|null} เวลาที่วัดระดับสูงสุด (`HH:MM:SS`) */
  get highestAt() { return this.#highestAt; }

  /** @returns {string|null} เวลาที่วัดระดับต่ำสุด (`HH:MM:SS`) */
  get lowestAt() { return this.#lowestAt; }

  /** @returns {MeterLevel|null} ระดับน้ำล่าสุดของวัน */
  get currentMeter() { return this.#currentMeter; }

  /** @returns {number} จำนวนครั้งที่วัดในวันนั้น */
  get measurementCount() { return this.#measurementCount; }

  /** @returns {string|null} พาธไฟล์ภาพประกอบรายงาน */
  get imagePath() { return this.#imagePath; }

  /** @returns {number|null} ส่วนต่างระหว่างระดับสูงสุดกับต่ำสุด (เมตร) */
  get rangeMeter() {
    if (!this.#highestMeter || !this.#lowestMeter) return null;
    return this.#highestMeter.differenceFrom(this.#lowestMeter);
  }

  /**
   * วันที่ในรูปแบบไทยพร้อมปี พ.ศ. (CLAUDE.md ข้อ 6.6)
   * @returns {string} เช่น `21 สิงหาคม 2569`
   */
  get thaiDate() { return DailyReport.toThaiDate(this.#reportDate); }

  /**
   * แปลงวันที่เป็นข้อความไทยพร้อมปี พ.ศ.
   * @param {string|Date} value วันที่
   * @returns {string}
   */
  static toThaiDate(value) {
    const months = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
      'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    const date = value instanceof Date ? value : new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return String(value);
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear() + 543}`;
  }

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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(this.#reportDate)) {
      errors.push({ field: 'reportDate', message: 'รูปแบบวันที่ต้องเป็น ปปปป-ดด-วว' });
    }
    if (errors.length) throw new ValidationError('ข้อมูลรายงานประจำวันไม่ถูกต้อง', errors);
  }

  /** @returns {object} โครงสร้างสำหรับส่งออก */
  toJSON() {
    return {
      id: this.id,
      stationId: this.#stationId,
      reportDate: this.#reportDate,
      thaiDate: this.thaiDate,
      highest: {
        pixel: this.#highestPixel?.value ?? null,
        meter: this.#highestMeter?.value ?? null,
        at: this.#highestAt,
      },
      lowest: {
        pixel: this.#lowestPixel?.value ?? null,
        meter: this.#lowestMeter?.value ?? null,
        at: this.#lowestAt,
      },
      currentMeter: this.#currentMeter?.value ?? null,
      rangeMeter: this.rangeMeter,
      measurementCount: this.#measurementCount,
      imageUrl: this.#imagePath ? `/storage/${this.#imagePath}` : null,
      createdAt: this.createdAt,
    };
  }

  /**
   * ทำให้วันที่อยู่ในรูปแบบ `YYYY-MM-DD`
   * @param {string|Date} value ค่าดิบ
   * @returns {string}
   */
  static #normalizeDate(value) {
    if (value instanceof Date) return value.toLocaleDateString('sv-SE');
    const text = String(value ?? '');
    return text.length >= 10 ? text.slice(0, 10) : text;
  }
}
