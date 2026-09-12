import { BaseModel } from '../core/BaseModel.js';
import { ValidationError } from '../core/errors/index.js';

/**
 * session ที่เก็บอยู่ในตาราง `sessions`
 *
 * ใช้แสดงรายการอุปกรณ์ที่ผู้ใช้กำลังเข้าสู่ระบบอยู่ในหน้า `/account/sessions`
 * `sid` เป็นข้อมูลอ่อนไหว — `toJSON()` จึงส่งออกเพียงเศษท้ายไว้แยกแยะเท่านั้น
 */
export class Session extends BaseModel {
  /** @type {string} */
  #sid;
  /** @type {number|null} */
  #userId;
  /** @type {string|null} */
  #ip;
  /** @type {string|null} */
  #userAgent;
  /** @type {Date} */
  #expiresAt;

  /**
   * @param {object} data ข้อมูล session
   * @param {string} data.sid รหัส session
   * @param {number|null} [data.userId] รหัสผู้ใช้
   * @param {string|null} [data.ip] หมายเลข IP
   * @param {string|null} [data.userAgent] ข้อมูลเบราว์เซอร์
   * @param {Date|string} data.expiresAt เวลาหมดอายุ
   */
  constructor(data = {}) {
    super(data);
    this.#sid = String(data.sid ?? '');
    this.#userId = data.userId === null || data.userId === undefined ? null : Number(data.userId);
    this.#ip = data.ip ? String(data.ip) : null;
    this.#userAgent = data.userAgent ? String(data.userAgent) : null;
    this.#expiresAt = BaseModel.toDate(data.expiresAt) ?? new Date();
  }

  /** @returns {string} รหัส session (ข้อมูลอ่อนไหว) */
  get sid() { return this.#sid; }

  /** @returns {number|null} รหัสผู้ใช้ */
  get userId() { return this.#userId; }

  /** @returns {string|null} หมายเลข IP */
  get ip() { return this.#ip; }

  /** @returns {string|null} ข้อมูลเบราว์เซอร์ */
  get userAgent() { return this.#userAgent; }

  /** @returns {Date} เวลาหมดอายุ */
  get expiresAt() { return this.#expiresAt; }

  /** @returns {boolean} หมดอายุแล้วหรือยัง */
  get isExpired() { return this.#expiresAt.getTime() <= Date.now(); }

  /** @returns {string} ชื่ออุปกรณ์แบบอ่านง่าย แยกจาก user agent */
  get deviceLabel() {
    const ua = this.#userAgent ?? '';
    const os = /Windows/i.test(ua) ? 'Windows'
      : /Android/i.test(ua) ? 'Android'
      : /iPhone|iPad|iOS/i.test(ua) ? 'iOS'
      : /Mac OS X|Macintosh/i.test(ua) ? 'macOS'
      : /Linux/i.test(ua) ? 'Linux' : 'ไม่ทราบระบบ';
    const browser = /Edg\//i.test(ua) ? 'Edge'
      : /Chrome\//i.test(ua) ? 'Chrome'
      : /Safari\//i.test(ua) ? 'Safari'
      : /Firefox\//i.test(ua) ? 'Firefox' : 'ไม่ทราบเบราว์เซอร์';
    return `${browser} บน ${os}`;
  }

  /**
   * ตรวจความถูกต้อง
   * @returns {void}
   * @throws {ValidationError} เมื่อไม่มีรหัส session
   */
  validate() {
    if (!this.#sid) throw new ValidationError('ไม่พบรหัส session');
  }

  /** @returns {object} โครงสร้างสำหรับส่งออก (ไม่เปิดเผย `sid` เต็ม) */
  toJSON() {
    return {
      id: this.id,
      sidSuffix: this.#sid.slice(-8),
      userId: this.#userId,
      ip: this.#ip,
      device: this.deviceLabel,
      expiresAt: this.#expiresAt,
      isExpired: this.isExpired,
      createdAt: this.createdAt,
    };
  }
}
