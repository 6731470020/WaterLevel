import { ValidationError } from '../../core/errors/index.js';
import { PixelLevel } from '../../models/values/PixelLevel.js';

/**
 * ผลการตรวจจับผิวน้ำหนึ่งครั้ง (Data Transfer Object)
 *
 * เป็น**สัญญาเดียว**ที่ทุก `DetectionService` ต้องคืน ชั้นที่เรียกใช้จึงไม่ต้องรู้เลยว่า
 * เบื้องหลังเป็นบริการ AI จริงหรือข้อมูลจำลอง — นี่คือสิ่งที่ทำให้สลับ `DETECTION_DRIVER`
 * ได้โดยไม่แก้โค้ดที่เรียกใช้แม้แต่บรรทัดเดียว
 */
export class DetectionResult {
  /** ระยะเผื่อจากขอบล่างที่ยังถือว่า "ติดขอบ" — กล่องของโมเดลให้ 599 บ้าง 600 บ้าง */
  static FRAME_EDGE_TOLERANCE_PX = 2;

  /** @type {PixelLevel} */
  #waterLinePx;
  /** @type {string|null} */
  #zoneName;
  /** @type {string|null} */
  #zoneColor;
  /** @type {string|null} */
  #imageBase64;
  /** @type {number|null} */
  #processingTime;
  /** @type {{peopleCount: number, facesCount: number, method: string}|null} */
  #pdpaStats;
  /** @type {Date} */
  #detectedAt;

  /** @type {{width: number, height: number}|null} ขนาดภาพจริงที่บริการประมวลผล */
  #imageSize;
  /** @type {string} */
  #driver;

  /**
   * @param {object} data ผลการตรวจจับ
   * @param {number} data.waterLinePx ตำแหน่งผิวน้ำเป็นพิกเซล Y
   * @param {string|null} [data.zoneName] ชื่อโซนที่บริการภายนอกคำนวณให้ (ใช้อ้างอิงเท่านั้น)
   * @param {string|null} [data.zoneColor] สีโซนจากบริการภายนอก
   * @param {string|null} [data.imageBase64] ภาพที่เบลอใบหน้าแล้ว เข้ารหัส base64
   * @param {number|null} [data.processingTime] เวลาที่ใช้ประมวลผล (วินาที)
   * @param {object|null} [data.pdpaStats] สถิติการปกปิดใบหน้า
   * @param {string} [data.driver='unknown'] ชื่อไดรเวอร์ที่ผลิตผลนี้
   * @throws {ValidationError} เมื่อค่าพิกเซลไม่ถูกต้อง
   */
  constructor(data = {}) {
    this.#waterLinePx = new PixelLevel(data.waterLinePx);
    this.#zoneName = data.zoneName ? String(data.zoneName) : null;
    this.#zoneColor = data.zoneColor ? String(data.zoneColor) : null;
    this.#imageBase64 = data.imageBase64 ? String(data.imageBase64) : null;
    this.#processingTime = data.processingTime === null || data.processingTime === undefined
      ? null : Number(data.processingTime);
    this.#pdpaStats = DetectionResult.#normalizePdpa(data.pdpaStats);
    this.#detectedAt = data.detectedAt instanceof Date ? data.detectedAt : new Date();
    this.#imageSize = DetectionResult.#normalizeSize(data.imageSize);
    this.#driver = String(data.driver ?? 'unknown');
    Object.freeze(this);
  }

  /** @returns {PixelLevel} ตำแหน่งผิวน้ำเป็นพิกเซล */
  get waterLinePx() { return this.#waterLinePx; }

  /** @returns {string|null} ชื่อโซนจากบริการภายนอก */
  get zoneName() { return this.#zoneName; }

  /** @returns {string|null} สีโซนจากบริการภายนอก */
  get zoneColor() { return this.#zoneColor; }

  /** @returns {string|null} ภาพที่เบลอใบหน้าแล้ว (base64) */
  get imageBase64() { return this.#imageBase64; }

  /** @returns {boolean} มีภาพแนบมาด้วยหรือไม่ */
  get hasImage() { return Boolean(this.#imageBase64); }

  /** @returns {number|null} เวลาที่ใช้ประมวลผล (วินาที) */
  get processingTime() { return this.#processingTime; }

  /** @returns {{peopleCount: number, facesCount: number, method: string}|null} สถิติ PDPA */
  get pdpaStats() { return this.#pdpaStats ? { ...this.#pdpaStats } : null; }

  /** @returns {Date} เวลาที่ตรวจจับ */
  get detectedAt() { return this.#detectedAt; }

  /** @returns {{width: number, height: number}|null} ขนาดภาพจริงที่บริการประมวลผล */
  get imageSize() { return this.#imageSize ? { ...this.#imageSize } : null; }

  /**
   * ผิวน้ำที่ได้อยู่ที่ขอบล่างของภาพพอดีหรือไม่
   *
   * ⚠️ บริการตรวจจับคำนวณ `water_line` จากขอบล่าง (y2) ของกล่องเสาวัดระดับที่ต่ำสุด
   * (`app.py:740`) ถ้าเสาทะลุขอบล่างของเฟรม กล่องจะถูกตัดที่ขอบภาพแล้วคืนค่าเท่ากับ
   * ความสูงภาพพอดี — ค่านั้นคือ**ขอบภาพ ไม่ใช่ผิวน้ำ** ระดับน้ำจริงต่ำกว่านั้น
   * จึงใช้ได้แค่ในฐานะ "ต่ำกว่าหรือเท่ากับ" ไม่ใช่ค่าที่วัดได้จริง
   *
   * @returns {boolean}
   */
  get isAtFrameEdge() {
    const height = this.#imageSize?.height;
    if (!height) return false;
    return this.#waterLinePx.value >= height - DetectionResult.FRAME_EDGE_TOLERANCE_PX;
  }

  /** @returns {string} ชื่อไดรเวอร์ที่ผลิตผลนี้ */
  get driver() { return this.#driver; }

  /**
   * สร้าง DTO จากคำตอบดิบของบริการภายนอก
   *
   * รองรับทั้งรูปแบบที่ห่อด้วย `zone_info` และแบบแบนราบ เพราะระบบเดิมอ่านทั้งสองแบบ
   *
   * @param {object} payload คำตอบ JSON จากบริการตรวจจับ
   * @param {string} driver ชื่อไดรเวอร์
   * @returns {DetectionResult}
   * @throws {ValidationError} เมื่อคำตอบไม่มีค่า `water_line`
   */
  static fromApiResponse(payload, driver) {
    const waterLine = payload?.water_line ?? payload?.waterLine;
    if (waterLine === undefined || waterLine === null) {
      throw new ValidationError('คำตอบจากบริการตรวจจับไม่มีค่าตำแหน่งผิวน้ำ (water_line)');
    }
    const zoneInfo = payload.zone_info ?? payload.zoneInfo ?? {};
    return new DetectionResult({
      waterLinePx: waterLine,
      zoneName: zoneInfo.zone_name ?? zoneInfo.zoneName ?? payload.zone_name ?? null,
      zoneColor: zoneInfo.zone_color ?? zoneInfo.color ?? payload.zone_color ?? null,
      imageBase64: payload.image_base64 ?? payload.imageBase64 ?? null,
      processingTime: payload.processing_time ?? payload.processingTime ?? null,
      pdpaStats: payload.pdpa_stats ?? payload.pdpaStats ?? null,
      imageSize: payload.image_size ?? payload.imageSize ?? null,
      driver,
    });
  }

  /**
   * แปลงเป็นโครงสร้างสำหรับ log และตอบกลับ API — **ไม่รวมภาพ base64** เพราะใหญ่เกินไป
   * @returns {object}
   */
  toJSON() {
    return {
      waterLinePx: this.#waterLinePx.value,
      zoneName: this.#zoneName,
      zoneColor: this.#zoneColor,
      hasImage: this.hasImage,
      processingTime: this.#processingTime,
      pdpaStats: this.pdpaStats,
      detectedAt: this.#detectedAt,
      imageSize: this.imageSize,
      atFrameEdge: this.isAtFrameEdge,
      driver: this.#driver,
    };
  }

  /**
   * ทำให้สถิติ PDPA อยู่ในรูปแบบเดียวกันเสมอ
   * @param {object|null} raw สถิติดิบ
   * @returns {{peopleCount: number, facesCount: number, method: string}|null}
   */
  static #normalizeSize(raw) {
    const width = Number(raw?.width);
    const height = Number(raw?.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null;
    }
    return { width: Math.round(width), height: Math.round(height) };
  }

  /**
   * แปลงสถิติ PDPA ให้อยู่ในรูปแบบเดียวกัน
   * @param {object|null} raw ข้อมูลดิบ
   * @returns {object|null}
   */
  static #normalizePdpa(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
      peopleCount: Number(raw.peopleCount ?? raw.people_count ?? raw.people ?? 0),
      facesCount: Number(raw.facesCount ?? raw.faces_count ?? raw.faces ?? 0),
      method: String(raw.method ?? 'blur'),
    };
  }
}
