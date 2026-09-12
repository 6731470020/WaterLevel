import { ValidationError } from '../../core/errors/index.js';

/**
 * ระดับน้ำในหน่วย **เมตร** (Value Object — ไม่เปลี่ยนแปลงค่าได้)
 *
 * ตรงข้ามกับ `PixelLevel` โดยสิ้นเชิง: **ค่ามาก = น้ำสูง**
 * เก็บทศนิยม 2 ตำแหน่งตามที่ระบบเดิมและรายงานใช้
 */
export class MeterLevel {
  /** @type {number} */
  #value;

  /**
   * @param {number} value ค่าระดับน้ำเป็นเมตร
   * @throws {ValidationError} เมื่อค่าว่างหรือไม่ใช่ตัวเลข
   */
  constructor(value) {
    // ปฏิเสธค่าว่างด้วยเหตุผลเดียวกับ `PixelLevel` — ใช้ `MeterLevel.from()` แทน
    if (value === null || value === undefined || value === '') {
      throw new ValidationError('ค่าระดับน้ำเป็นเมตรต้องไม่เป็นค่าว่าง');
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new ValidationError('ค่าระดับน้ำเป็นเมตรต้องเป็นตัวเลข');
    }
    this.#value = Math.round(parsed * 100) / 100;
    Object.freeze(this);
  }

  /**
   * สร้างจากค่าที่อาจเป็น null
   * @param {number|null|undefined} value ค่าเมตร
   * @returns {MeterLevel|null}
   */
  static from(value) {
    return value === null || value === undefined || value === '' ? null : new MeterLevel(value);
  }

  /** @returns {number} ค่าเมตร (ทศนิยม 2 ตำแหน่ง) */
  get value() { return this.#value; }

  /**
   * เปรียบเทียบระดับน้ำ — เมตรมากกว่าคือน้ำสูงกว่า
   * @param {MeterLevel} other อีกค่าหนึ่ง
   * @returns {boolean}
   */
  isHigherThan(other) {
    MeterLevel.#assert(other);
    return this.#value > other.value;
  }

  /**
   * ตรวจว่าเท่ากันหรือไม่
   * @param {MeterLevel} other อีกค่าหนึ่ง
   * @returns {boolean}
   */
  equals(other) {
    return other instanceof MeterLevel && other.value === this.#value;
  }

  /**
   * ผลต่างสัมบูรณ์เป็นเมตร
   * @param {MeterLevel} other อีกค่าหนึ่ง
   * @returns {number}
   */
  differenceFrom(other) {
    MeterLevel.#assert(other);
    return Math.round(Math.abs(this.#value - other.value) * 100) / 100;
  }

  /** @returns {number} ค่าสำหรับการเปรียบเทียบเชิงตัวเลขโดยอัตโนมัติ */
  valueOf() { return this.#value; }

  /** @returns {string} รูปแบบอ่านง่ายพร้อมหน่วยภาษาไทย */
  toString() { return `${this.#value.toFixed(2)} ม.`; }

  /** @returns {number} ค่าสำหรับ `JSON.stringify` */
  toJSON() { return this.#value; }

  /**
   * ตรวจว่าเป็น `MeterLevel` จริง
   * @param {*} value ค่าที่ต้องการตรวจ
   * @throws {ValidationError} เมื่อไม่ใช่ `MeterLevel`
   */
  static #assert(value) {
    if (!(value instanceof MeterLevel)) {
      throw new ValidationError('ต้องเปรียบเทียบกับค่าระดับน้ำเป็นเมตร (MeterLevel) เท่านั้น');
    }
  }
}
