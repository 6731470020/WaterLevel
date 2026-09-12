import { ValidationError } from '../core/errors/index.js';
import { ZoneLevel } from './values/ZoneLevel.js';

/**
 * ขอบเขตโซนเตือนภัยหนึ่งช่วงของจุดวัดหนึ่งแห่ง (Value Object)
 *
 * ผูก `ZoneLevel` (ชนิดโซน) เข้ากับ `yPosition` (พิกเซล Y ของขอบบน) ที่ผู้ดูแล
 * กำหนดไว้ในเครื่องมือวาด ROI
 */
export class Zone {
  /** @type {ZoneLevel} */
  #level;
  /** @type {number} */
  #yPosition;
  /** @type {string} */
  #color;
  /** @type {boolean} */
  #alertEnabled;
  /** @type {number|null} */
  #meterLevel;

  /**
   * @param {object} data ข้อมูลโซน
   * @param {string|ZoneLevel} data.key คีย์โซนหรือวัตถุ `ZoneLevel`
   * @param {number} data.yPosition พิกเซล Y ของขอบบนโซน
   * @param {string} [data.color] สีที่ปรับแต่งเอง (ค่าเริ่มต้น = สีมาตรฐานของโซน)
   * @param {boolean} [data.alertEnabled] เปิดแจ้งเตือนโซนนี้หรือไม่
   * @param {number|null} [data.meterLevel] ระดับน้ำจริง (เมตร) ที่ขอบบนโซนนี้
   *   เมื่อระบุไว้ ระบบจะสร้างจุดเทียบค่าที่ `yPosition` ให้อัตโนมัติ
   * @throws {ValidationError} เมื่อคีย์โซนไม่รู้จัก หรือ `yPosition` ไม่ถูกต้อง
   */
  constructor(data = {}) {
    const level = data.key instanceof ZoneLevel ? data.key : ZoneLevel.parse(data.key ?? data.name);
    if (!level) {
      throw new ValidationError(`ไม่รู้จักโซนเตือนภัย: ${data.key ?? data.name}`);
    }
    const y = Number(data.yPosition ?? data.y_position);
    if (!Number.isFinite(y) || y < 0) {
      throw new ValidationError(`ตำแหน่ง Y ของโซน "${level.label}" ต้องเป็นจำนวนไม่ติดลบ`);
    }
    this.#level = level;
    this.#yPosition = Math.round(y);
    this.#color = Zone.#normalizeColor(data.color ?? data.color_hex) ?? level.color;
    this.#alertEnabled = data.alertEnabled === undefined
      ? level.alertByDefault
      : Boolean(data.alertEnabled);
    this.#meterLevel = Zone.#normalizeMeter(data.meterLevel ?? data.meter_level, level.label);
    Object.freeze(this);
  }

  /** @returns {ZoneLevel} ชนิดโซน */
  get level() { return this.#level; }

  /** @returns {string} คีย์โซน */
  get key() { return this.#level.key; }

  /** @returns {string} ชื่อภาษาไทย */
  get label() { return this.#level.label; }

  /** @returns {number} ลำดับความร้ายแรง */
  get severity() { return this.#level.severity; }

  /** @returns {number} พิกเซล Y ของขอบบนโซน */
  get yPosition() { return this.#yPosition; }

  /** @returns {number|null} ระดับน้ำจริง (เมตร) ที่ขอบบนโซน — `null` เมื่อยังไม่ได้ระบุ */
  get meterLevel() { return this.#meterLevel; }

  /** @returns {boolean} โซนนี้ใช้เป็นจุดเทียบค่าได้หรือไม่ */
  get hasCalibration() { return this.#meterLevel !== null; }

  /** @returns {string} สีที่ใช้แสดงผล */
  get color() { return this.#color; }

  /** @returns {boolean} เปิดแจ้งเตือนโซนนี้หรือไม่ */
  get alertEnabled() { return this.#alertEnabled; }

  /**
   * สร้างชุดโซนมาตรฐาน 6 ระดับ พร้อมตำแหน่งเริ่มต้นที่กระจายเท่า ๆ กัน
   * @param {number} imageHeight ความสูงของภาพเป็นพิกเซล
   * @returns {Array<Zone>}
   */
  static defaults(imageHeight = 576) {
    const levels = ZoneLevel.all();
    const step = Math.floor(imageHeight / (levels.length + 1));
    return levels.map((level, index) => new Zone({
      key: level.key,
      yPosition: step * (index + 1),
    }));
  }

  /**
   * แปลงข้อมูลดิบเป็นชุดโซน แล้วเรียงจากขอบบน (พิกเซลน้อย) ลงล่าง
   * @param {Array<object>} rawZones ข้อมูลโซนดิบ
   * @returns {Array<Zone>}
   */
  static fromArray(rawZones) {
    return (rawZones ?? [])
      .map((item) => new Zone(item))
      .sort((a, b) => a.yPosition - b.yPosition);
  }

  /**
   * ตรวจว่าชุดโซนสมเหตุสมผล — เรียงลำดับความร้ายแรงถูกต้องและอยู่ในกรอบภาพ
   *
   * โซนที่ร้ายแรงกว่าต้องอยู่สูงกว่า (พิกเซล Y น้อยกว่า) เพราะน้ำสูงกว่า
   *
   * @param {Array<Zone>} zones ชุดโซนที่ต้องการตรวจ
   * @param {number|null} [imageHeight=null] ความสูงภาพ (ถ้าระบุจะตรวจขอบเขตด้วย)
   * @returns {Array<string>} รายการคำเตือนภาษาไทย (ว่าง = ผ่าน)
   */
  static findIssues(zones, imageHeight = null) {
    const issues = [];
    if (!zones?.length) return ['ยังไม่ได้กำหนดโซนเตือนภัย'];

    const keys = zones.map((zone) => zone.key);
    const duplicated = keys.filter((key, index) => keys.indexOf(key) !== index);
    if (duplicated.length) {
      issues.push(`มีโซนซ้ำกัน: ${[...new Set(duplicated)].join(', ')}`);
    }

    const sorted = [...zones].sort((a, b) => a.yPosition - b.yPosition);
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].severity <= sorted[i - 1].severity) {
        issues.push(
          `ลำดับโซนผิด — "${sorted[i].label}" อยู่ต่ำกว่า "${sorted[i - 1].label}" ` +
          'แต่ควรร้ายแรงน้อยกว่า (โซนร้ายแรงกว่าต้องอยู่สูงกว่า)',
        );
      }
      if (sorted[i].yPosition === sorted[i - 1].yPosition) {
        issues.push(`โซน "${sorted[i].label}" กับ "${sorted[i - 1].label}" อยู่ตำแหน่ง Y เดียวกัน`);
      }
    }

    // ทิศทางแกน Y: พิกเซลมาก = น้ำต่ำ ระดับน้ำของโซนจึงต้องลดลงตามพิกเซลที่เพิ่มขึ้น
    // ผิดข้อนี้แล้วจุดเทียบค่าที่สร้างจากโซนจะให้ค่าที่กลับหัว (CLAUDE.md ข้อ 6.1)
    const withMeter = sorted.filter((zone) => zone.hasCalibration);
    for (let i = 1; i < withMeter.length; i += 1) {
      if (withMeter[i].meterLevel >= withMeter[i - 1].meterLevel) {
        issues.push(
          `ระดับน้ำของโซน "${withMeter[i].label}" (${withMeter[i].meterLevel} ม.) `
          + `ไม่ต่ำกว่าโซน "${withMeter[i - 1].label}" (${withMeter[i - 1].meterLevel} ม.) `
          + 'ทั้งที่อยู่ต่ำกว่าในภาพ — กรุณาตรวจสอบว่ากรอกสลับกันหรือไม่',
        );
      }
    }

    if (imageHeight !== null) {
      for (const zone of zones) {
        if (zone.yPosition > imageHeight) {
          issues.push(`โซน "${zone.label}" อยู่นอกกรอบภาพ (Y = ${zone.yPosition} เกิน ${imageHeight})`);
        }
      }
    }
    return issues;
  }

  /** @returns {object} โครงสร้างสำหรับส่งออกและเก็บเป็น JSON */
  toJSON() {
    return {
      key: this.key,
      label: this.label,
      yPosition: this.#yPosition,
      color: this.#color,
      severity: this.severity,
      alertEnabled: this.#alertEnabled,
      meterLevel: this.#meterLevel,
    };
  }

  /**
   * ตรวจและแปลงค่าระดับน้ำของขอบบนโซน
   *
   * ค่าว่าง (`null` · `undefined` · `''`) แปลว่า "ยังไม่ได้ระบุ" ซึ่งถูกต้องตามปกติ
   * — โซนไม่จำเป็นต้องเป็นจุดเทียบค่า แต่ถ้าใส่มาแล้วต้องเป็นตัวเลขที่ใช้ได้จริง
   * ห้ามปล่อยค่าที่พิมพ์ผิดให้กลายเป็น 0 เงียบ ๆ เพราะ 0 เมตรคือค่าที่ใช้คำนวณได้
   *
   * @param {number|string|null} value ค่าดิบ
   * @param {string} label ชื่อโซน (ใช้ในข้อความผิดพลาด)
   * @returns {number|null}
   * @throws {ValidationError} เมื่อค่าที่ระบุไม่ใช่ตัวเลขที่ใช้ได้
   */
  static #normalizeMeter(value, label) {
    if (value === null || value === undefined || value === '') return null;
    const meter = Number(value);
    if (!Number.isFinite(meter) || meter < 0 || meter > 100) {
      throw new ValidationError(
        `ระดับน้ำของโซน "${label}" ต้องเป็นตัวเลขระหว่าง 0–100 เมตร`,
      );
    }
    return Math.round(meter * 100) / 100;
  }

  /**
   * ทำให้รหัสสีอยู่ในรูปแบบ `#RRGGBB`
   * @param {string|null} value รหัสสีดิบ
   * @returns {string|null}
   */
  static #normalizeColor(value) {
    if (!value) return null;
    const hex = String(value).trim().replace(/^#/, '').toUpperCase();
    return /^[0-9A-F]{6}$/.test(hex) ? `#${hex}` : null;
  }
}
