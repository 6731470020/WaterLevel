import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { PasswordHasher } from './PasswordHasher.js';
import { ValidationError } from '../../core/errors/index.js';

const scryptAsync = promisify(scrypt);

/** พารามิเตอร์ scrypt ตาม CLAUDE.md ข้อ 8.1 */
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

/**
 * แฮชรหัสผ่านด้วย scrypt ที่มากับ Node — **วิธีเริ่มต้นของระบบ**
 *
 * ไม่ต้องติดตั้ง native module ใด ๆ และปลอดภัยพอสำหรับงานนี้
 * รูปแบบที่เก็บ: `scrypt$<salt hex>$<hash hex>`
 */
export class ScryptHasher extends PasswordHasher {
  /** @returns {string} ชื่ออัลกอริทึม */
  get algorithm() { return 'scrypt'; }

  /**
   * แฮชรหัสผ่านพร้อมสร้าง salt สุ่มใหม่ทุกครั้ง
   * @param {string} plain รหัสผ่านดิบ
   * @returns {Promise<string>} รูปแบบ `scrypt$salt$hash`
   * @throws {ValidationError} เมื่อรหัสผ่านว่าง
   */
  async hash(plain) {
    if (!plain) throw new ValidationError('รหัสผ่านต้องไม่เป็นค่าว่าง');
    const salt = randomBytes(SALT_BYTES);
    const derived = await scryptAsync(plain, salt, KEY_LENGTH, { N, r: R, p: P });
    return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
  }

  /**
   * ตรวจรหัสผ่านด้วยการเปรียบเทียบแบบ timing-safe
   * @param {string} plain รหัสผ่านดิบ
   * @param {string} hash ค่าแฮชที่เก็บไว้
   * @returns {Promise<boolean>} true เมื่อตรงกัน
   */
  async verify(plain, hash) {
    if (!plain || !this.supports(hash)) return false;
    const [, saltHex, expectedHex] = hash.split('$');
    try {
      const expected = Buffer.from(expectedHex, 'hex');
      const derived = await scryptAsync(
        plain, Buffer.from(saltHex, 'hex'), expected.length, { N, r: R, p: P },
      );
      return derived.length === expected.length && timingSafeEqual(derived, expected);
    } catch {
      return false;
    }
  }

  /**
   * ตรวจว่าค่าแฮชอยู่ในรูปแบบ scrypt ของระบบนี้
   * @param {string} hash ค่าแฮช
   * @returns {boolean}
   */
  supports(hash) {
    return typeof hash === 'string' && /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/.test(hash);
  }
}
