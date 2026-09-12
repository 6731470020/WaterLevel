import { NotImplementedError } from './errors/index.js';

/**
 * คลาสฐานนามธรรมของเอนทิตีทุกตัวในระบบ
 *
 * ห่อหุ้ม `id` และเวลาสร้าง/แก้ไขไว้เป็นฟิลด์ส่วนตัว เปิดออกทาง getter เท่านั้น
 * คลาสลูกต้อง override `toJSON()` และ `validate()`
 *
 * @abstract
 */
export class BaseModel {
  /** @type {number|null} */
  #id;
  /** @type {Date|null} */
  #createdAt;
  /** @type {Date|null} */
  #updatedAt;

  /**
   * @param {{id?: number|null, createdAt?: Date|string|null, updatedAt?: Date|string|null}} [data={}]
   * @throws {NotImplementedError} เมื่อพยายามสร้างวัตถุจากคลาสนามธรรมโดยตรง
   */
  constructor({ id = null, createdAt = null, updatedAt = null } = {}) {
    if (new.target === BaseModel) {
      throw new NotImplementedError('BaseModel เป็นคลาสนามธรรม สร้างวัตถุโดยตรงไม่ได้');
    }
    this.#id = id === null || id === undefined ? null : Number(id);
    this.#createdAt = BaseModel.toDate(createdAt);
    this.#updatedAt = BaseModel.toDate(updatedAt);
  }

  /** @returns {number|null} รหัสประจำตัวในฐานข้อมูล */
  get id() { return this.#id; }

  /** @returns {Date|null} เวลาที่สร้าง */
  get createdAt() { return this.#createdAt; }

  /** @returns {Date|null} เวลาที่แก้ไขล่าสุด */
  get updatedAt() { return this.#updatedAt; }

  /** @returns {boolean} true เมื่อยังไม่เคยถูกบันทึกลงฐานข้อมูล */
  get isNew() { return this.#id === null; }

  /**
   * กำหนด id หลังบันทึกลงฐานข้อมูลครั้งแรก
   * @param {number} id รหัสที่ฐานข้อมูลสร้างให้
   * @throws {NotImplementedError} เมื่อวัตถุมี id อยู่แล้ว
   */
  assignId(id) {
    if (this.#id !== null) {
      throw new NotImplementedError('กำหนดรหัสซ้ำให้วัตถุที่มีรหัสอยู่แล้วไม่ได้');
    }
    this.#id = Number(id);
  }

  /**
   * แปลงค่าจากฐานข้อมูลเป็น `Date` อย่างปลอดภัย
   * @param {Date|string|number|null} value ค่าที่ได้จากฐานข้อมูล
   * @returns {Date|null}
   */
  static toDate(value) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  /**
   * แปลงเป็นโครงสร้างที่ปลอดภัยสำหรับส่งออกทาง API หรือ view
   *
   * **สำคัญ:** คลาสที่มีข้อมูลอ่อนไหว (เช่น `User`) ต้องไม่ส่งค่านั้นออกมาที่นี่
   *
   * @abstract
   * @returns {object}
   * @throws {NotImplementedError} เมื่อคลาสลูกไม่ override
   */
  toJSON() {
    throw new NotImplementedError(`${this.constructor.name} ต้อง override toJSON()`);
  }

  /**
   * ตรวจความถูกต้องของข้อมูลภายในวัตถุ
   * @abstract
   * @returns {void}
   * @throws {NotImplementedError} เมื่อคลาสลูกไม่ override
   */
  validate() {
    throw new NotImplementedError(`${this.constructor.name} ต้อง override validate()`);
  }
}
