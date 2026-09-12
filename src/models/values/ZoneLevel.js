import { ValidationError } from '../../core/errors/index.js';
import { PixelLevel } from './PixelLevel.js';

/**
 * โซนเตือนภัย 6 ระดับ (Value Object แบบ enum)
 *
 * ระบบเดิมฮาร์ดโค้ดชื่อโซนเป็นภาษาไทยกระจายทั่วโค้ด และตัดสินใจแจ้งเตือนจาก
 * `ALERT_ZONES = ['วิกฤต','วิกฤตมาก']` ระบบใหม่ใช้ **คีย์ภาษาอังกฤษ** เป็นตัวจริง
 * ส่วนชื่อไทยเป็นเพียงป้ายแสดงผล และเปิดให้ตั้งค่ารายจุดวัดว่าโซนใดต้องแจ้งเตือน
 *
 * `severity` น้อย = ร้ายแรงมาก (1 = วิกฤตมาก … 6 = ปกติ) ตามลำดับใน CLAUDE.md ข้อ 6.3
 */
export class ZoneLevel {
  /** @type {string} */
  #key;
  /** @type {string} */
  #label;
  /** @type {string} */
  #color;
  /** @type {number} */
  #severity;
  /** @type {boolean} */
  #alertByDefault;

  /**
   * @param {string} key คีย์ภาษาอังกฤษ เช่น `CRITICAL`
   * @param {string} label ชื่อภาษาไทยที่แสดงต่อผู้ใช้
   * @param {string} color รหัสสี hex พร้อม `#`
   * @param {number} severity ลำดับความร้ายแรง (1 = ร้ายแรงที่สุด)
   * @param {boolean} alertByDefault ค่าเริ่มต้นว่าต้องแจ้งเตือนเข้ากลุ่ม LINE หรือไม่
   */
  constructor(key, label, color, severity, alertByDefault) {
    this.#key = key;
    this.#label = label;
    this.#color = color;
    this.#severity = severity;
    this.#alertByDefault = alertByDefault;
    Object.freeze(this);
  }

  /** โซนทั้ง 6 ระดับ เรียงจากร้ายแรงที่สุดไปหาปกติ */
  static CRITICAL = new ZoneLevel('CRITICAL', 'วิกฤตมาก',   '#EF4444', 1, true);
  static SEVERE   = new ZoneLevel('SEVERE',   'วิกฤต',      '#F97316', 2, true);
  static DANGER   = new ZoneLevel('DANGER',   'อันตราย',    '#EAB308', 3, false);
  static WATCH    = new ZoneLevel('WATCH',    'เฝ้าระวัง',   '#22C55E', 4, false);
  static HIGH     = new ZoneLevel('HIGH',     'ระดับน้ำสูง', '#06B6D4', 5, false);
  static NORMAL   = new ZoneLevel('NORMAL',   'ปกติ',       '#E5E7EB', 6, false);

  /** @returns {Array<ZoneLevel>} โซนทั้งหมดเรียงตามความร้ายแรง (ร้ายแรงก่อน) */
  static all() {
    return [ZoneLevel.CRITICAL, ZoneLevel.SEVERE, ZoneLevel.DANGER,
            ZoneLevel.WATCH, ZoneLevel.HIGH, ZoneLevel.NORMAL];
  }

  /** @returns {Array<string>} คีย์ของโซนทั้งหมด */
  static keys() { return ZoneLevel.all().map((zone) => zone.key); }

  /** @returns {string} คีย์ภาษาอังกฤษ */
  get key() { return this.#key; }

  /** @returns {string} ชื่อภาษาไทย */
  get label() { return this.#label; }

  /** @returns {string} รหัสสี hex พร้อม `#` */
  get color() { return this.#color; }

  /** @returns {number} ลำดับความร้ายแรง (1 = ร้ายแรงที่สุด) */
  get severity() { return this.#severity; }

  /** @returns {boolean} ค่าเริ่มต้นว่าต้องแจ้งเตือนหรือไม่ */
  get alertByDefault() { return this.#alertByDefault; }

  /** @returns {boolean} true เมื่อเป็นโซน CRITICAL หรือ SEVERE */
  get isCritical() { return this.#severity <= 2; }

  /**
   * ค้นหาโซนจากคีย์
   * @param {string} key คีย์ภาษาอังกฤษ
   * @returns {ZoneLevel|null}
   */
  static fromKey(key) {
    if (!key) return null;
    return ZoneLevel.all().find((zone) => zone.key === String(key).toUpperCase()) ?? null;
  }

  /**
   * ค้นหาโซนจากชื่อภาษาไทย — ใช้ตอนย้ายข้อมูลจากระบบเดิมที่เก็บ `zone_name` เป็นไทย
   * @param {string} label ชื่อภาษาไทย
   * @returns {ZoneLevel|null}
   */
  static fromLabel(label) {
    if (!label) return null;
    const target = String(label).trim();
    return ZoneLevel.all().find((zone) => zone.label === target) ?? null;
  }

  /**
   * ค้นหาโซนจากคีย์หรือชื่อไทยก็ได้ — ตัวช่วยสำหรับข้อมูลผสมจากระบบเดิม
   * @param {string} value คีย์หรือชื่อไทย
   * @returns {ZoneLevel|null}
   */
  static parse(value) {
    return ZoneLevel.fromKey(value) ?? ZoneLevel.fromLabel(value);
  }

  /**
   * เลือกโซนที่ระดับน้ำตกอยู่ ตามขอบเขต `yPosition` ของจุดวัดนั้น
   *
   * กฎ (CLAUDE.md ข้อ 6.3): เลือกโซนที่ `pixel >= yPosition` และมี `yPosition` มากที่สุด
   * ค่าที่อยู่เหนือขอบบนสุด (พิกเซลน้อยกว่าทุกโซน) ถือเป็นโซนที่ร้ายแรงที่สุด
   *
   * @param {PixelLevel} pixelLevel ระดับน้ำเป็นพิกเซล
   * @param {Array<{key: string, yPosition: number}>} zones ขอบเขตโซนของจุดวัด
   * @returns {ZoneLevel} โซนที่เลือกได้
   * @throws {ValidationError} เมื่อพารามิเตอร์ไม่ถูกต้องหรือไม่มีโซนที่ใช้ได้
   */
  static resolve(pixelLevel, zones) {
    if (!(pixelLevel instanceof PixelLevel)) {
      throw new ValidationError('ต้องส่งระดับน้ำเป็น PixelLevel');
    }
    const usable = (zones ?? [])
      .map((zone) => ({
        level: ZoneLevel.parse(zone.key ?? zone.zoneKey ?? zone.name),
        yPosition: Number(zone.yPosition ?? zone.y_position),
      }))
      .filter((zone) => zone.level !== null && Number.isFinite(zone.yPosition))
      .sort((a, b) => a.yPosition - b.yPosition);

    if (!usable.length) {
      throw new ValidationError('จุดวัดนี้ยังไม่ได้กำหนดโซนเตือนภัย');
    }

    const pixel = pixelLevel.value;
    // พิกเซลน้อย = น้ำสูง: ถ้าเหนือขอบบนสุดก็ถือว่าอยู่ในโซนบนสุด (ร้ายแรงที่สุด)
    if (pixel < usable[0].yPosition) return usable[0].level;

    let matched = usable[0].level;
    for (const zone of usable) {
      if (pixel >= zone.yPosition) matched = zone.level;
      else break;
    }
    return matched;
  }

  /**
   * ตรวจว่าโซนใหม่แย่ลงกว่าโซนเดิมหรือไม่ — ใช้ตัดสินใจแจ้งเตือนทันที (ข้อ 6.5)
   * @param {ZoneLevel|null} previous โซนก่อนหน้า
   * @param {ZoneLevel} current โซนปัจจุบัน
   * @returns {boolean} true เมื่อสถานการณ์แย่ลง
   */
  static hasWorsened(previous, current) {
    if (!(current instanceof ZoneLevel)) return false;
    if (!(previous instanceof ZoneLevel)) return true;
    return current.severity < previous.severity;
  }

  /**
   * ตรวจว่าเท่ากันหรือไม่
   * @param {ZoneLevel} other อีกค่าหนึ่ง
   * @returns {boolean}
   */
  equals(other) { return other instanceof ZoneLevel && other.key === this.#key; }

  /** @returns {string} ชื่อภาษาไทย */
  toString() { return this.#label; }

  /**
   * @returns {{key: string, label: string, color: string, severity: number}}
   */
  toJSON() {
    return { key: this.#key, label: this.#label, color: this.#color, severity: this.#severity };
  }
}
