import { BaseModel } from '../core/BaseModel.js';
import { ValidationError } from '../core/errors/index.js';

/**
 * ผู้ติดตามบัญชี LINE ของระบบ (มาจากตาราง `line_users` เดิม)
 *
 * บันทึกผ่านเหตุการณ์ `follow` / `unfollow` ของ webhook
 */
export class LineUser extends BaseModel {
  /** @type {string} */
  #lineUserId;
  /** @type {string|null} */
  #displayName;
  /** @type {string} */
  #status;
  /** @type {Date|null} */
  #followedAt;
  /** @type {Date|null} */
  #lastActiveAt;
  /** @type {Date|null} */
  #unfollowedAt;

  /**
   * @param {object} data ข้อมูลผู้ติดตาม
   * @param {string} data.lineUserId รหัสผู้ใช้จาก LINE
   * @param {string} [data.status='active'] สถานะ
   */
  constructor(data = {}) {
    super(data);
    this.#lineUserId = String(data.lineUserId ?? '').trim();
    this.#displayName = data.displayName ? String(data.displayName) : null;
    this.#status = String(data.status ?? 'active').toLowerCase();
    this.#followedAt = BaseModel.toDate(data.followedAt);
    this.#lastActiveAt = BaseModel.toDate(data.lastActiveAt);
    this.#unfollowedAt = BaseModel.toDate(data.unfollowedAt);
  }

  /** @returns {string} รหัสผู้ใช้จาก LINE */
  get lineUserId() { return this.#lineUserId; }

  /** @returns {string|null} ชื่อที่แสดง */
  get displayName() { return this.#displayName; }

  /** @returns {string} สถานะ */
  get status() { return this.#status; }

  /** @returns {Date|null} เวลาที่เริ่มติดตาม */
  get followedAt() { return this.#followedAt; }

  /** @returns {Date|null} เวลาที่มีกิจกรรมล่าสุด */
  get lastActiveAt() { return this.#lastActiveAt; }

  /** @returns {Date|null} เวลาที่เลิกติดตาม */
  get unfollowedAt() { return this.#unfollowedAt; }

  /** @returns {boolean} ยังติดตามอยู่หรือไม่ */
  get isActive() { return this.#status === 'active'; }

  /**
   * ตรวจความถูกต้อง
   * @returns {void}
   * @throws {ValidationError} เมื่อไม่มีรหัสผู้ใช้
   */
  validate() {
    if (!this.#lineUserId) throw new ValidationError('ต้องระบุรหัสผู้ใช้ LINE');
  }

  /** @returns {object} โครงสร้างสำหรับส่งออก */
  toJSON() {
    return {
      id: this.id,
      lineUserId: this.#lineUserId,
      displayName: this.#displayName,
      status: this.#status,
      isActive: this.isActive,
      followedAt: this.#followedAt,
      lastActiveAt: this.#lastActiveAt,
      unfollowedAt: this.#unfollowedAt,
    };
  }
}
