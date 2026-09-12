import bcrypt from 'bcryptjs';
import { PasswordHasher } from './PasswordHasher.js';
import { ValidationError } from '../../core/errors/index.js';

/**
 * ตรวจรหัสผ่าน bcrypt ที่ระบบ PHP เดิมสร้างไว้ (`$2y$10$…`)
 *
 * มีไว้เพื่อ**ย้ายผู้ใช้เดิมเข้าระบบใหม่โดยไม่ต้องรีเซ็ตรหัสผ่านทุกคน**
 * เมื่อผู้ใช้เข้าสู่ระบบสำเร็จด้วยวิธีนี้ `AuthService` จะแปลงเป็น scrypt ให้ทันที
 * ใช้ `bcryptjs` (pure JS) จึงไม่ต้อง compile native module
 */
export class BcryptHasher extends PasswordHasher {
  /** @type {number} */
  #rounds;

  /** @param {number} [rounds=10] จำนวนรอบ (ให้ตรงกับ `password_hash()` ของ PHP) */
  constructor(rounds = 10) {
    super();
    this.#rounds = rounds;
  }

  /** @returns {string} ชื่ออัลกอริทึม */
  get algorithm() { return 'bcrypt'; }

  /**
   * แฮชรหัสผ่านด้วย bcrypt — ใช้ในชุดทดสอบเป็นหลัก
   * ระบบจริงแฮชด้วย `ScryptHasher` เสมอ
   * @param {string} plain รหัสผ่านดิบ
   * @returns {Promise<string>}
   * @throws {ValidationError} เมื่อรหัสผ่านว่าง
   */
  async hash(plain) {
    if (!plain) throw new ValidationError('รหัสผ่านต้องไม่เป็นค่าว่าง');
    return bcrypt.hash(plain, this.#rounds);
  }

  /**
   * ตรวจรหัสผ่านกับแฮช bcrypt
   *
   * แปลงคำนำหน้า `$2y$` (PHP) เป็น `$2a$` เพราะ `bcryptjs` ไม่รู้จัก `$2y$`
   * ทั้งสองเป็นรูปแบบเดียวกันทุกประการ ต่างแค่ป้ายกำกับ
   *
   * @param {string} plain รหัสผ่านดิบ
   * @param {string} hash ค่าแฮชจากระบบเดิม
   * @returns {Promise<boolean>}
   */
  async verify(plain, hash) {
    if (!plain || !this.supports(hash)) return false;
    try {
      return await bcrypt.compare(plain, hash.replace(/^\$2y\$/, '$2a$'));
    } catch {
      return false;
    }
  }

  /**
   * ตรวจว่าค่าแฮชอยู่ในรูปแบบ bcrypt
   * @param {string} hash ค่าแฮช
   * @returns {boolean}
   */
  supports(hash) {
    return typeof hash === 'string' && /^\$2[aby]\$\d{2}\$/.test(hash);
  }
}
