import { BaseModel } from '../core/BaseModel.js';
import { ValidationError } from '../core/errors/index.js';
import { PixelLevel } from './values/PixelLevel.js';
import { MeterLevel } from './values/MeterLevel.js';
import { ZoneLevel } from './values/ZoneLevel.js';

/** ที่มาของค่าวัด */
const SOURCES = ['CRON', 'MANUAL', 'LEGACY'];

/**
 * ค่าวัดระดับน้ำหนึ่งครั้ง (มาจากตาราง `water_history` เดิม)
 *
 * ต่างจากระบบเดิมตรงที่**คำนวณและเก็บ `water_level_m` ตั้งแต่ตอนบันทึก**
 * ระบบเดิมคำนวณใหม่ทุกครั้งที่แสดงผล ด้วยโค้ดที่คัดลอกไว้ 4 ที่พร้อมค่าสำรอง
 * ฮาร์ดโค้ดที่ทำให้รายงานผิดแบบเงียบ ๆ (CLAUDE.md ข้อ 2.1 ข้อบกพร่องที่ 8)
 */
export class Measurement extends BaseModel {
  /** คุณภาพที่เป็นไปได้ของค่าวัด */
  static QUALITIES = ['OK', 'AT_FRAME_EDGE'];

  /** @type {number} */
  #stationId;
  /** @type {Date} */
  #measuredAt;
  /** @type {PixelLevel} */
  #waterLine;
  /** @type {MeterLevel|null} */
  #waterLevelM;
  /** @type {ZoneLevel|null} */
  #zone;
  /** @type {string|null} */
  #imagePath;
  /** @type {string|null} */
  #thumbnailPath;
  /** @type {number|null} */
  #processingTime;
  /** @type {string} */
  #source;
  /** @type {object|null} */
  #pdpaStats;
  /** @type {string} */
  #quality;

  /**
   * @param {object} data ข้อมูลค่าวัด
   * @param {number} data.stationId รหัสจุดวัด
   * @param {Date|string} data.measuredAt เวลาที่วัด
   * @param {number} data.waterLine ตำแหน่งผิวน้ำเป็นพิกเซล Y
   * @param {number|null} [data.waterLevelM] ระดับน้ำเป็นเมตร
   * @param {string|null} [data.zoneKey] คีย์โซนที่คำนวณได้
   * @param {string|null} [data.imagePath] พาธไฟล์ภาพ
   * @param {string} [data.source='CRON'] ที่มาของค่าวัด
   */
  constructor(data = {}) {
    super(data);
    this.#stationId = Number(data.stationId);
    this.#measuredAt = BaseModel.toDate(data.measuredAt) ?? new Date();
    this.#waterLine = new PixelLevel(data.waterLine);
    this.#waterLevelM = MeterLevel.from(data.waterLevelM ?? data.waterLevelMeter);
    this.#zone = ZoneLevel.parse(data.zoneKey ?? data.zone ?? data.zoneName);
    this.#imagePath = data.imagePath ? String(data.imagePath) : null;
    this.#thumbnailPath = data.thumbnailPath ? String(data.thumbnailPath) : null;
    this.#processingTime = data.processingTime === null || data.processingTime === undefined
      ? null : Number(data.processingTime);
    this.#source = SOURCES.includes(data.source) ? data.source : 'CRON';
    this.#pdpaStats = Measurement.#parseJson(data.pdpaStats);
    this.#quality = Measurement.QUALITIES.includes(data.quality) ? data.quality : 'OK';
  }

  /** @returns {number} รหัสจุดวัด */
  get stationId() { return this.#stationId; }

  /** @returns {Date} เวลาที่วัด */
  get measuredAt() { return this.#measuredAt; }

  /** @returns {PixelLevel} ตำแหน่งผิวน้ำเป็นพิกเซล */
  get waterLine() { return this.#waterLine; }

  /** @returns {MeterLevel|null} ระดับน้ำเป็นเมตร */
  get waterLevelM() { return this.#waterLevelM; }

  /** @returns {ZoneLevel|null} โซนเตือนภัยที่ตกอยู่ */
  get zone() { return this.#zone; }

  /** @returns {string|null} คีย์โซน */
  get zoneKey() { return this.#zone?.key ?? null; }

  /** @returns {string|null} พาธไฟล์ภาพ */
  get imagePath() { return this.#imagePath; }

  /** @returns {string|null} พาธไฟล์ภาพย่อ */
  get thumbnailPath() { return this.#thumbnailPath; }

  /** @returns {number|null} เวลาที่ใช้ประมวลผล (วินาที) */
  get processingTime() { return this.#processingTime; }

  /** @returns {string} ที่มาของค่าวัด */
  get source() { return this.#source; }

  /** @returns {object|null} สถิติการปกปิดใบหน้าตาม PDPA */
  get pdpaStats() { return this.#pdpaStats; }

  /** @returns {string} คุณภาพของค่าวัด — `OK` หรือ `AT_FRAME_EDGE` */
  get quality() { return this.#quality; }

  /**
   * ค่านี้เป็นเพียงค่าประมาณขั้นต่ำหรือไม่
   *
   * `AT_FRAME_EDGE` แปลว่าผิวน้ำอยู่ที่ขอบล่างของภาพพอดี ระดับน้ำจริง**ต่ำกว่า**
   * ค่าที่แสดง ใช้ดูแนวโน้มได้แต่ห้ามใช้เป็นค่าอ้างอิงที่แน่นอน
   *
   * @returns {boolean}
   */
  get isEstimate() { return this.#quality === 'AT_FRAME_EDGE'; }

  /** @returns {string|null} URL สาธารณะของภาพ */
  get imageUrl() { return this.#imagePath ? `/storage/${this.#imagePath}` : null; }

  /** @returns {string|null} URL สาธารณะของภาพย่อ */
  get thumbnailUrl() { return this.#thumbnailPath ? `/storage/${this.#thumbnailPath}` : null; }

  /**
   * เติมค่าเมตรและโซนที่คำนวณได้ภายหลัง (ใช้ตอนย้ายข้อมูลย้อนหลัง)
   * @param {MeterLevel|number|null} meterLevel ระดับน้ำเป็นเมตร
   * @param {ZoneLevel|string|null} zone โซน
   */
  applyDerived(meterLevel, zone) {
    this.#waterLevelM = meterLevel instanceof MeterLevel ? meterLevel : MeterLevel.from(meterLevel);
    this.#zone = zone instanceof ZoneLevel ? zone : ZoneLevel.parse(zone);
  }

  /**
   * กำหนดพาธไฟล์ภาพหลังบันทึกลงดิสก์สำเร็จ
   * @param {string|null} imagePath พาธภาพหลัก
   * @param {string|null} thumbnailPath พาธภาพย่อ
   */
  attachImage(imagePath, thumbnailPath = null) {
    this.#imagePath = imagePath ? String(imagePath) : null;
    this.#thumbnailPath = thumbnailPath ? String(thumbnailPath) : null;
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
    if (Number.isNaN(this.#measuredAt.getTime())) {
      errors.push({ field: 'measuredAt', message: 'เวลาที่วัดไม่ถูกต้อง' });
    }
    if (!SOURCES.includes(this.#source)) {
      errors.push({ field: 'source', message: `ที่มาต้องเป็น: ${SOURCES.join(', ')}` });
    }
    if (errors.length) throw new ValidationError('ข้อมูลค่าวัดไม่ถูกต้อง', errors);
  }

  /** @returns {object} โครงสร้างสำหรับส่งออก */
  toJSON() {
    return {
      id: this.id,
      stationId: this.#stationId,
      measuredAt: this.#measuredAt,
      waterLine: this.#waterLine.value,
      waterLevelM: this.#waterLevelM?.value ?? null,
      zone: this.#zone?.toJSON() ?? null,
      imageUrl: this.imageUrl,
      thumbnailUrl: this.thumbnailUrl,
      processingTime: this.#processingTime,
      source: this.#source,
      pdpaStats: this.#pdpaStats,
      quality: this.#quality,
      isEstimate: this.isEstimate,
      createdAt: this.createdAt,
    };
  }

  /**
   * แปลงค่า JSON จากฐานข้อมูลอย่างปลอดภัย
   * @param {*} value ค่าดิบ
   * @returns {object|null}
   */
  static #parseJson(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return null; }
  }
}
