import { NotImplementedError } from '../../core/errors/index.js';

/**
 * คลาสนามธรรมของวิธีแฮชรหัสผ่าน (Strategy Pattern)
 *
 * ระบบรองรับสองวิธีพร้อมกันโดยเจตนา:
 * - `ScryptHasher` — ค่าเริ่มต้นของระบบใหม่ ใช้ `crypto` ที่มากับ Node
 * - `BcryptHasher` — ตรวจรหัสผ่านเดิมที่ PHP สร้างไว้ (`$2y$10$…`)
 *
 * `AuthService` เลือกตัวตรวจตามคอลัมน์ `hash_algo` ของผู้ใช้แต่ละคน แล้วอัปเกรด
 * เป็น scrypt อัตโนมัติเมื่อเข้าสู่ระบบสำเร็จ — นี่คือพหุสัณฐานที่มีเหตุผลรองรับจริง
 * ไม่ใช่แค่ตัวอย่างประกอบ (CLAUDE.md ข้อ 8.1)
 *
 * @abstract
 */
export class PasswordHasher {
  /** @throws {NotImplementedError} เมื่อสร้างวัตถุจากคลาสนามธรรมโดยตรง */
  constructor() {
    if (new.target === PasswordHasher) {
      throw new NotImplementedError('PasswordHasher เป็นคลาสนามธรรม สร้างวัตถุโดยตรงไม่ได้');
    }
  }

  /**
   * ชื่ออัลกอริทึม — เก็บลงคอลัมน์ `hash_algo`
   * @abstract
   * @returns {string}
   * @throws {NotImplementedError} เมื่อคลาสลูกไม่ override
   */
  get algorithm() {
    throw new NotImplementedError(`${this.constructor.name} ต้อง override algorithm`);
  }

  /**
   * แฮชรหัสผ่านดิบ
   * @abstract
   * @param {string} plain รหัสผ่านดิบ
   * @returns {Promise<string>} ค่าแฮชที่พร้อมเก็บลงฐานข้อมูล
   * @throws {NotImplementedError} เมื่อคลาสลูกไม่ override
   */
  async hash(plain) {
    throw new NotImplementedError(`${this.constructor.name} ต้อง override hash()`);
  }

  /**
   * ตรวจรหัสผ่านกับค่าแฮชที่เก็บไว้
   * @abstract
   * @param {string} plain รหัสผ่านดิบ
   * @param {string} hash ค่าแฮชที่เก็บไว้
   * @returns {Promise<boolean>} true เมื่อตรงกัน
   * @throws {NotImplementedError} เมื่อคลาสลูกไม่ override
   */
  async verify(plain, hash) {
    throw new NotImplementedError(`${this.constructor.name} ต้อง override verify()`);
  }

  /**
   * ตรวจว่าค่าแฮชนี้อยู่ในรูปแบบที่คลาสนี้จัดการได้หรือไม่
   * @abstract
   * @param {string} hash ค่าแฮช
   * @returns {boolean}
   * @throws {NotImplementedError} เมื่อคลาสลูกไม่ override
   */
  supports(hash) {
    throw new NotImplementedError(`${this.constructor.name} ต้อง override supports()`);
  }
}
