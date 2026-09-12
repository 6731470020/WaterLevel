import { NotImplementedError } from '../../core/errors/index.js';

/**
 * คลาสนามธรรมของ **ทะเบียนคีย์ใช้งาน** ฝั่งผู้ให้บริการ (Strategy Pattern)
 *
 * ผู้ให้บริการตรวจจับ (`app.py`) ออกคีย์ให้ลูกค้าแต่ละราย พร้อมวันหมดอายุและสถานะ
 * เปิด/ยกเลิก ระบบของลูกค้าถามสถานะคีย์ตัวเองได้ที่ `GET /key-info` โดยส่ง
 * `X-API-Key` ที่ตัวเองถืออยู่ — คลาสนี้คือสัญญาของการถามนั้น
 *
 * มีลูกสองตัวที่สลับกันได้ด้วย `.env` โดยชั้นบนไม่ต้องแก้อะไรเลย:
 * - `HttpKeyRegistry` — ถามบริการจริง
 * - `NullKeyRegistry` — ยังไม่ได้ตั้งค่าปลายทาง ใช้ใบอนุญาตที่กรอกเองในระบบแทน
 *
 * @abstract
 */
export class KeyRegistry {
  /** @throws {NotImplementedError} เมื่อสร้างวัตถุจากคลาสนามธรรมโดยตรง */
  constructor() {
    if (new.target === KeyRegistry) {
      throw new NotImplementedError('KeyRegistry เป็นคลาสนามธรรม สร้างวัตถุโดยตรงไม่ได้');
    }
  }

  /**
   * ชื่อไดรเวอร์ — ใช้ใน log และหน้าสถานะระบบ
   * @abstract
   * @returns {string}
   * @throws {NotImplementedError} เมื่อคลาสลูกไม่ override
   */
  get driver() {
    throw new NotImplementedError(`${this.constructor.name} ต้อง override driver`);
  }

  /**
   * ทะเบียนคีย์นี้พร้อมให้ถามหรือไม่ — `false` แปลว่ายังไม่ได้ตั้งค่าปลายทาง
   * @returns {boolean}
   */
  get isConfigured() { return true; }

  /**
   * ถามสถานะคีย์ของระบบนี้จากผู้ให้บริการ
   * @abstract
   * @returns {Promise<import('./KeyInfo.js').KeyInfo|null>} `null` เมื่อทะเบียนถูกปิดใช้งาน
   * @throws {NotImplementedError} เมื่อคลาสลูกไม่ override
   */
  async fetchKeyInfo() {
    throw new NotImplementedError(`${this.constructor.name} ต้อง override fetchKeyInfo()`);
  }
}
