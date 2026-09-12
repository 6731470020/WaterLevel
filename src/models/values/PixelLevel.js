import { ValidationError } from '../../core/errors/index.js';

/**
 * ระดับน้ำในหน่วย **พิกเซลแกน Y** (Value Object — ไม่เปลี่ยนแปลงค่าได้)
 *
 * ⚠️ ทิศทางแกนสำคัญที่สุดและผิดกันบ่อย: แกน Y ของภาพนับจากบนลงล่าง
 * ดังนั้น **พิกเซลน้อย = น้ำสูง / พิกเซลมาก = น้ำต่ำ**
 * `MIN(water_line)` ใน SQL จึงหมายถึงระดับน้ำ**สูงสุด** (CLAUDE.md ข้อ 6.1)
 *
 * การแยกเป็นคนละคลาสกับ `MeterLevel` ทำให้สลับหน่วยกันโดยไม่ตั้งใจไม่ได้เลย
 */
export class PixelLevel {
  /** @type {number} */
  #value;

  /**
   * @param {number} value ค่าพิกเซลแกน Y (ต้องเป็นจำนวนไม่ติดลบ)
   * @throws {ValidationError} เมื่อค่าว่าง ไม่ใช่ตัวเลข หรือติดลบ
   */
  constructor(value) {
    // ปฏิเสธค่าว่างอย่างชัดเจน — `Number(null)` และ `Number('')` ให้ 0 ซึ่งแปลว่า
    // "ผิวน้ำอยู่ขอบบนสุดของภาพ" = น้ำท่วมสูงสุด การปล่อยให้ค่าที่หายไปกลายเป็น
    // ค่าที่ร้ายแรงที่สุดโดยเงียบ ๆ คือบั๊กแบบเดียวกับที่ระบบเดิมมี
    // ใช้ `PixelLevel.from()` แทนเมื่อต้องการรองรับค่าว่าง
    if (value === null || value === undefined || value === '') {
      throw new ValidationError('ค่าพิกเซลต้องไม่เป็นค่าว่าง');
    }
    if (!Number.isFinite(Number(value)) || Number(value) < 0) {
      throw new ValidationError('ค่าพิกเซลต้องเป็นจำนวนไม่ติดลบ');
    }
    this.#value = Math.round(Number(value));
    Object.freeze(this);
  }

  /**
   * สร้างจากค่าที่อาจเป็น null (เช่น คอลัมน์ที่ยังไม่มีข้อมูล)
   * @param {number|null|undefined} value ค่าพิกเซล
   * @returns {PixelLevel|null}
   */
  static from(value) {
    return value === null || value === undefined || value === '' ? null : new PixelLevel(value);
  }

  /** @returns {number} ค่าพิกเซล */
  get value() { return this.#value; }

  /**
   * เปรียบเทียบระดับน้ำ — พิกเซลน้อยกว่าหมายถึงน้ำสูงกว่า
   * @param {PixelLevel} other อีกค่าหนึ่ง
   * @returns {boolean} true เมื่อค่านี้แทนระดับน้ำที่สูงกว่า
   */
  isHigherThan(other) {
    PixelLevel.#assert(other);
    return this.#value < other.value;
  }

  /**
   * เปรียบเทียบระดับน้ำ — พิกเซลมากกว่าหมายถึงน้ำต่ำกว่า
   * @param {PixelLevel} other อีกค่าหนึ่ง
   * @returns {boolean} true เมื่อค่านี้แทนระดับน้ำที่ต่ำกว่า
   */
  isLowerThan(other) {
    PixelLevel.#assert(other);
    return this.#value > other.value;
  }

  /**
   * ตรวจว่าเท่ากันหรือไม่
   * @param {PixelLevel} other อีกค่าหนึ่ง
   * @returns {boolean}
   */
  equals(other) {
    return other instanceof PixelLevel && other.value === this.#value;
  }

  /**
   * ผลต่างสัมบูรณ์เป็นพิกเซล — ใช้ในการตรวจความผันผวน
   * @param {PixelLevel} other อีกค่าหนึ่ง
   * @returns {number} จำนวนพิกเซลที่ต่างกัน (ไม่ติดลบ)
   */
  differenceFrom(other) {
    PixelLevel.#assert(other);
    return Math.abs(this.#value - other.value);
  }

  /**
   * ค่าที่สูงกว่า (พิกเซลน้อยกว่า) จากรายการที่ให้มา
   * @param {Array<PixelLevel>} levels รายการค่าพิกเซล
   * @returns {PixelLevel|null}
   */
  static highest(levels) {
    if (!levels?.length) return null;
    return levels.reduce((best, item) => (item.value < best.value ? item : best));
  }

  /**
   * ค่าที่ต่ำกว่า (พิกเซลมากกว่า) จากรายการที่ให้มา
   * @param {Array<PixelLevel>} levels รายการค่าพิกเซล
   * @returns {PixelLevel|null}
   */
  static lowest(levels) {
    if (!levels?.length) return null;
    return levels.reduce((worst, item) => (item.value > worst.value ? item : worst));
  }

  /**
   * ค่าเฉลี่ยของรายการ (ปัดเป็นจำนวนเต็ม)
   * @param {Array<PixelLevel>} levels รายการค่าพิกเซล
   * @returns {PixelLevel|null}
   * @throws {ValidationError} เมื่อรายการว่าง
   */
  static average(levels) {
    if (!levels?.length) return null;
    const sum = levels.reduce((total, item) => total + item.value, 0);
    return new PixelLevel(sum / levels.length);
  }

  /**
   * ช่วงกระจายของรายการ (ค่ามากสุด − ค่าน้อยสุด)
   * @param {Array<PixelLevel>} levels รายการค่าพิกเซล
   * @returns {number} จำนวนพิกเซล
   */
  static spread(levels) {
    if (!levels?.length) return 0;
    const values = levels.map((item) => item.value);
    return Math.max(...values) - Math.min(...values);
  }

  /** @returns {number} ค่าสำหรับการเปรียบเทียบเชิงตัวเลขโดยอัตโนมัติ */
  valueOf() { return this.#value; }

  /** @returns {string} รูปแบบอ่านง่าย */
  toString() { return `${this.#value} px`; }

  /** @returns {number} ค่าสำหรับ `JSON.stringify` */
  toJSON() { return this.#value; }

  /**
   * ตรวจว่าเป็น `PixelLevel` จริง
   * @param {*} value ค่าที่ต้องการตรวจ
   * @throws {ValidationError} เมื่อไม่ใช่ `PixelLevel`
   */
  static #assert(value) {
    if (!(value instanceof PixelLevel)) {
      throw new ValidationError('ต้องเปรียบเทียบกับค่าพิกเซล (PixelLevel) เท่านั้น');
    }
  }
}
