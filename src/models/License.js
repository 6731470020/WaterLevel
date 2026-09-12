import { BaseModel } from '../core/BaseModel.js';
import { ValidationError } from '../core/errors/index.js';

/**
 * ใบอนุญาตใช้งานระบบ
 *
 * `LicenseMiddleware` เรียกใช้ผ่าน `LicenseService` ที่แคชสถานะไว้ 5 นาที
 * เพื่อไม่ให้ต้องถามฐานข้อมูลทุกคำขอ (CLAUDE.md ข้อ 8.5)
 */
export class License extends BaseModel {
  /** @type {string} */
  #licenseKey;
  /** @type {Date} */
  #expiredAt;
  /** @type {boolean} */
  #isActive;
  /** @type {string|null} */
  #contactEmail;
  /** @type {string|null} */
  #contactPhone;
  /** @type {string|null} */
  #contactLine;

  /**
   * @param {object} data ข้อมูลใบอนุญาต
   * @param {string} data.licenseKey รหัสใบอนุญาต
   * @param {Date|string} data.expiredAt วันหมดอายุ
   * @param {boolean} [data.isActive=true] เปิดใช้งานหรือไม่
   */
  constructor(data = {}) {
    super(data);
    this.#licenseKey = String(data.licenseKey ?? '').trim();
    this.#expiredAt = BaseModel.toDate(data.expiredAt) ?? new Date(0);
    this.#isActive = data.isActive === undefined ? true : Boolean(data.isActive);
    this.#contactEmail = data.contactEmail ? String(data.contactEmail) : null;
    this.#contactPhone = data.contactPhone ? String(data.contactPhone) : null;
    this.#contactLine = data.contactLine ? String(data.contactLine) : null;
  }

  /** @returns {string} รหัสใบอนุญาต */
  get licenseKey() { return this.#licenseKey; }

  /** @returns {Date} วันหมดอายุ */
  get expiredAt() { return this.#expiredAt; }

  /** @returns {boolean} เปิดใช้งานหรือไม่ */
  get isActive() { return this.#isActive; }

  /** @returns {string|null} อีเมลติดต่อผู้ให้บริการ */
  get contactEmail() { return this.#contactEmail; }

  /** @returns {string|null} เบอร์โทรติดต่อ */
  get contactPhone() { return this.#contactPhone; }

  /** @returns {string|null} LINE ID ติดต่อ */
  get contactLine() { return this.#contactLine; }

  /** @returns {boolean} ใบอนุญาตยังใช้งานได้อยู่หรือไม่ */
  get isValid() { return this.#isActive && this.#expiredAt.getTime() > Date.now(); }

  /** @returns {number} จำนวนวันที่เหลือ (ติดลบ = หมดอายุแล้ว) */
  get daysRemaining() {
    return Math.ceil((this.#expiredAt.getTime() - Date.now()) / 86400000);
  }

  /** @returns {boolean} ใกล้หมดอายุภายใน 30 วันหรือไม่ */
  get isExpiringSoon() {
    const days = this.daysRemaining;
    return this.isValid && days <= 30;
  }

  /**
   * ตรวจความถูกต้อง
   * @returns {void}
   * @throws {ValidationError} เมื่อข้อมูลไม่ครบ
   */
  validate() {
    const errors = [];
    if (!this.#licenseKey) errors.push({ field: 'licenseKey', message: 'ต้องระบุรหัสใบอนุญาต' });
    if (Number.isNaN(this.#expiredAt.getTime())) {
      errors.push({ field: 'expiredAt', message: 'วันหมดอายุไม่ถูกต้อง' });
    }
    if (errors.length) throw new ValidationError('ข้อมูลใบอนุญาตไม่ถูกต้อง', errors);
  }

  /** @returns {object} โครงสร้างสำหรับส่งออก */
  toJSON() {
    return {
      id: this.id,
      licenseKey: this.#licenseKey,
      expiredAt: this.#expiredAt,
      isActive: this.#isActive,
      isValid: this.isValid,
      daysRemaining: this.daysRemaining,
      isExpiringSoon: this.isExpiringSoon,
      contact: {
        email: this.#contactEmail,
        phone: this.#contactPhone,
        line: this.#contactLine,
      },
      updatedAt: this.updatedAt,
    };
  }
}
