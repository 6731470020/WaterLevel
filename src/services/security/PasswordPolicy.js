import { ValidationError } from '../../core/errors/index.js';

/**
 * นโยบายรหัสผ่านของระบบ (CLAUDE.md ข้อ 8.1)
 *
 * ยาวอย่างน้อย 10 ตัว มีตัวพิมพ์ใหญ่ พิมพ์เล็ก และตัวเลข
 * ส่วนกฎ "ห้ามซ้ำรหัสเดิม 3 ครั้งล่าสุด" อยู่ใน `AuthService` เพราะต้องถามฐานข้อมูล
 */
export class PasswordPolicy {
  /** @type {number} */
  #minLength;

  /** @param {number} [minLength=10] ความยาวขั้นต่ำ */
  constructor(minLength = 10) {
    this.#minLength = Number(minLength);
    Object.freeze(this);
  }

  /** @returns {number} ความยาวขั้นต่ำ */
  get minLength() { return this.#minLength; }

  /** @returns {string} คำอธิบายนโยบายสำหรับแสดงบนหน้าจอ */
  get description() {
    return `รหัสผ่านต้องยาวอย่างน้อย ${this.#minLength} ตัวอักษร ` +
           'และประกอบด้วยตัวพิมพ์ใหญ่ ตัวพิมพ์เล็ก และตัวเลข';
  }

  /**
   * ตรวจรหัสผ่านและคืนรายการข้อผิดพลาด
   * @param {string} password รหัสผ่านดิบ
   * @returns {Array<string>} ข้อความภาษาไทย (ว่าง = ผ่าน)
   */
  check(password) {
    const value = String(password ?? '');
    const issues = [];
    if (value.length < this.#minLength) {
      issues.push(`รหัสผ่านต้องยาวอย่างน้อย ${this.#minLength} ตัวอักษร`);
    }
    if (!/[A-Z]/.test(value)) issues.push('รหัสผ่านต้องมีตัวอักษรพิมพ์ใหญ่อย่างน้อย 1 ตัว');
    if (!/[a-z]/.test(value)) issues.push('รหัสผ่านต้องมีตัวอักษรพิมพ์เล็กอย่างน้อย 1 ตัว');
    if (!/\d/.test(value)) issues.push('รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว');
    return issues;
  }

  /**
   * ตรวจและโยนข้อผิดพลาดเมื่อไม่ผ่าน
   * @param {string} password รหัสผ่านดิบ
   * @returns {void}
   * @throws {ValidationError} เมื่อรหัสผ่านไม่ผ่านนโยบาย
   */
  assert(password) {
    const issues = this.check(password);
    if (issues.length) {
      throw new ValidationError(
        'รหัสผ่านไม่ผ่านเกณฑ์ความปลอดภัย',
        issues.map((message) => ({ field: 'password', message })),
      );
    }
  }
}
