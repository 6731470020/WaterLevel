import { BaseModel } from '../core/BaseModel.js';
import { ValidationError } from '../core/errors/index.js';

/**
 * กลุ่ม LINE ที่บอทเข้าร่วมอยู่ (มาจากตาราง `line_groups` เดิม)
 *
 * บันทึกผ่านเหตุการณ์ `join` / `leave` ของ webhook
 */
export class LineGroup extends BaseModel {
  /** @type {string} */
  #groupId;
  /** @type {string} */
  #type;
  /** @type {string|null} */
  #displayName;
  /** @type {string} */
  #status;
  /** @type {Date|null} */
  #joinedAt;
  /** @type {Date|null} */
  #lastActiveAt;
  /** @type {Date|null} */
  #leftAt;

  /**
   * @param {object} data ข้อมูลกลุ่ม
   * @param {string} data.groupId รหัสกลุ่มจาก LINE
   * @param {string} [data.type='group'] ชนิดแหล่งข้อความ (`group` | `room`)
   * @param {string} [data.status='active'] สถานะ
   */
  constructor(data = {}) {
    super(data);
    this.#groupId = String(data.groupId ?? '').trim();
    this.#type = String(data.type ?? 'group');
    this.#displayName = data.displayName ? String(data.displayName) : null;
    this.#status = String(data.status ?? 'active').toLowerCase();
    this.#joinedAt = BaseModel.toDate(data.joinedAt);
    this.#lastActiveAt = BaseModel.toDate(data.lastActiveAt);
    this.#leftAt = BaseModel.toDate(data.leftAt);
  }

  /** @returns {string} รหัสกลุ่มจาก LINE */
  get groupId() { return this.#groupId; }

  /** @returns {string} ชนิดแหล่งข้อความ */
  get type() { return this.#type; }

  /** @returns {string|null} ชื่อที่ตั้งไว้เพื่อให้ผู้ดูแลจำได้ */
  get displayName() { return this.#displayName; }

  /** @returns {string} สถานะ */
  get status() { return this.#status; }

  /** @returns {Date|null} เวลาที่บอทเข้ากลุ่ม */
  get joinedAt() { return this.#joinedAt; }

  /** @returns {Date|null} เวลาที่มีกิจกรรมล่าสุด */
  get lastActiveAt() { return this.#lastActiveAt; }

  /** @returns {Date|null} เวลาที่บอทออกจากกลุ่ม */
  get leftAt() { return this.#leftAt; }

  /** @returns {boolean} ยังใช้งานอยู่หรือไม่ */
  get isActive() { return this.#status === 'active'; }

  /** @returns {string} ป้ายชื่อที่ใช้แสดง */
  get label() { return this.#displayName ?? `${this.#type}: ${this.#groupId.slice(0, 12)}…`; }

  /**
   * ตรวจความถูกต้อง
   * @returns {void}
   * @throws {ValidationError} เมื่อไม่มีรหัสกลุ่ม
   */
  validate() {
    if (!this.#groupId) throw new ValidationError('ต้องระบุรหัสกลุ่ม LINE');
  }

  /** @returns {object} โครงสร้างสำหรับส่งออก */
  toJSON() {
    return {
      id: this.id,
      groupId: this.#groupId,
      type: this.#type,
      displayName: this.#displayName,
      label: this.label,
      status: this.#status,
      isActive: this.isActive,
      joinedAt: this.#joinedAt,
      lastActiveAt: this.#lastActiveAt,
      leftAt: this.#leftAt,
    };
  }
}
