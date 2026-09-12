import { BaseModel } from '../core/BaseModel.js';
import { ValidationError } from '../core/errors/index.js';

/** สถานะการส่งข้อความ */
const STATUSES = ['PENDING', 'SENT', 'FAILED'];

/**
 * บันทึกการส่งข้อความแจ้งเตือนหนึ่งครั้ง (มาจาก `broadcast_history` เดิม)
 *
 * ต้องบันทึก**ทั้งกรณีสำเร็จและล้มเหลว** เพื่อให้ตรวจสอบย้อนหลังได้ (CLAUDE.md ข้อ 12.2)
 */
export class BroadcastLog extends BaseModel {
  /** @type {number|null} */
  #stationId;
  /** @type {string} */
  #messageType;
  /** @type {string|null} */
  #zoneKey;
  /** @type {string|null} */
  #channel;
  /** @type {string|null} */
  #target;
  /** @type {object|null} */
  #messageContent;
  /** @type {string} */
  #status;
  /** @type {object|null} */
  #response;
  /** @type {string|null} */
  #errorMessage;
  /** @type {Date|null} */
  #sentAt;
  /** @type {number|null} */
  #triggeredBy;

  /**
   * @param {object} data ข้อมูลบันทึก
   * @param {number|null} [data.stationId] รหัสจุดวัด
   * @param {string} [data.messageType='ALERT'] ชนิดข้อความ (`ALERT` | `REPORT` | `TEST`)
   * @param {string|null} [data.zoneKey] คีย์โซนที่กระตุ้นการแจ้งเตือน
   * @param {string} [data.status='PENDING'] สถานะการส่ง
   */
  constructor(data = {}) {
    super(data);
    this.#stationId = data.stationId === null || data.stationId === undefined
      ? null : Number(data.stationId);
    this.#messageType = String(data.messageType ?? 'ALERT').toUpperCase();
    this.#zoneKey = data.zoneKey ? String(data.zoneKey).toUpperCase() : null;
    this.#channel = data.channel ? String(data.channel) : null;
    this.#target = data.target ? String(data.target) : null;
    this.#messageContent = BroadcastLog.#parseJson(data.messageContent);
    this.#status = STATUSES.includes(String(data.status).toUpperCase())
      ? String(data.status).toUpperCase() : 'PENDING';
    this.#response = BroadcastLog.#parseJson(data.response);
    this.#errorMessage = data.errorMessage ? String(data.errorMessage).slice(0, 500) : null;
    this.#sentAt = BaseModel.toDate(data.sentAt);
    this.#triggeredBy = data.triggeredBy === null || data.triggeredBy === undefined
      ? null : Number(data.triggeredBy);
  }

  /** @returns {number|null} รหัสจุดวัด */
  get stationId() { return this.#stationId; }

  /** @returns {string} ชนิดข้อความ */
  get messageType() { return this.#messageType; }

  /** @returns {string|null} คีย์โซนที่กระตุ้นการแจ้งเตือน */
  get zoneKey() { return this.#zoneKey; }

  /** @returns {string|null} ช่องทางที่ส่ง (`line` | `console`) */
  get channel() { return this.#channel; }

  /** @returns {string|null} ปลายทาง เช่น รหัสกลุ่ม LINE */
  get target() { return this.#target; }

  /** @returns {object|null} เนื้อหาข้อความที่ส่ง */
  get messageContent() { return this.#messageContent; }

  /** @returns {string} สถานะการส่ง */
  get status() { return this.#status; }

  /** @returns {object|null} คำตอบจากปลายทาง */
  get response() { return this.#response; }

  /** @returns {string|null} ข้อความข้อผิดพลาด */
  get errorMessage() { return this.#errorMessage; }

  /** @returns {Date|null} เวลาที่ส่ง */
  get sentAt() { return this.#sentAt; }

  /** @returns {number|null} รหัสผู้ใช้ที่สั่งส่ง (null = ระบบ) */
  get triggeredBy() { return this.#triggeredBy; }

  /** @returns {boolean} ส่งสำเร็จหรือไม่ */
  get isSent() { return this.#status === 'SENT'; }

  /**
   * ตรวจความถูกต้อง
   * @returns {void}
   * @throws {ValidationError} เมื่อสถานะไม่ถูกต้อง
   */
  validate() {
    if (!STATUSES.includes(this.#status)) {
      throw new ValidationError(`สถานะการส่งต้องเป็น: ${STATUSES.join(', ')}`);
    }
  }

  /** @returns {object} โครงสร้างสำหรับส่งออก */
  toJSON() {
    return {
      id: this.id,
      stationId: this.#stationId,
      messageType: this.#messageType,
      zoneKey: this.#zoneKey,
      channel: this.#channel,
      target: this.#target,
      status: this.#status,
      errorMessage: this.#errorMessage,
      sentAt: this.#sentAt,
      triggeredBy: this.#triggeredBy,
      createdAt: this.createdAt,
    };
  }

  /**
   * แปลงค่า JSON จากฐานข้อมูลอย่างปลอดภัย
   * @param {*} value ค่าดิบ
   * @returns {object|null}
   */
  static #parseJson(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return null; }
  }
}
