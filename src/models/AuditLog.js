import { BaseModel } from '../core/BaseModel.js';
import { ValidationError } from '../core/errors/index.js';

/**
 * บันทึกการกระทำหนึ่งรายการในระบบ
 *
 * `actorId` เป็น null ได้เมื่อผู้กระทำคือระบบเอง (งานตามเวลา) แต่ `actorLabel`
 * ต้องมีเสมอเพื่อให้ไทม์ไลน์อ่านรู้เรื่องแม้ผู้ใช้จะถูกลบไปแล้ว
 */
export class AuditLog extends BaseModel {
  /** @type {number|null} */
  #actorId;
  /** @type {string} */
  #actorLabel;
  /** @type {string} */
  #action;
  /** @type {string} */
  #resourceType;
  /** @type {string|null} */
  #resourceId;
  /** @type {object|null} */
  #beforeData;
  /** @type {object|null} */
  #afterData;
  /** @type {string|null} */
  #ip;
  /** @type {string|null} */
  #userAgent;

  /**
   * @param {object} data ข้อมูลบันทึก
   * @param {number|null} [data.actorId] รหัสผู้กระทำ (null = ระบบ)
   * @param {string} data.actorLabel ชื่อผู้กระทำที่แสดง
   * @param {string} data.action การกระทำ เช่น `station.update`
   * @param {string} data.resourceType ชนิดทรัพยากร
   * @param {string|number|null} [data.resourceId] รหัสทรัพยากร
   * @param {object|null} [data.beforeData] ข้อมูลก่อนเปลี่ยน
   * @param {object|null} [data.afterData] ข้อมูลหลังเปลี่ยน
   */
  constructor(data = {}) {
    super(data);
    this.#actorId = data.actorId === null || data.actorId === undefined ? null : Number(data.actorId);
    this.#actorLabel = String(data.actorLabel ?? 'ระบบ');
    this.#action = String(data.action ?? '');
    this.#resourceType = String(data.resourceType ?? '');
    this.#resourceId = data.resourceId === null || data.resourceId === undefined
      ? null : String(data.resourceId);
    this.#beforeData = AuditLog.#parseJson(data.beforeData);
    this.#afterData = AuditLog.#parseJson(data.afterData);
    this.#ip = data.ip ? String(data.ip) : null;
    this.#userAgent = data.userAgent ? String(data.userAgent).slice(0, 255) : null;
  }

  /** @returns {number|null} รหัสผู้กระทำ */
  get actorId() { return this.#actorId; }

  /** @returns {string} ชื่อผู้กระทำที่แสดง */
  get actorLabel() { return this.#actorLabel; }

  /** @returns {string} การกระทำ */
  get action() { return this.#action; }

  /** @returns {string} ชนิดทรัพยากร */
  get resourceType() { return this.#resourceType; }

  /** @returns {string|null} รหัสทรัพยากร */
  get resourceId() { return this.#resourceId; }

  /** @returns {object|null} ข้อมูลก่อนเปลี่ยน */
  get beforeData() { return this.#beforeData; }

  /** @returns {object|null} ข้อมูลหลังเปลี่ยน */
  get afterData() { return this.#afterData; }

  /** @returns {string|null} หมายเลข IP */
  get ip() { return this.#ip; }

  /** @returns {string|null} ข้อมูลเบราว์เซอร์ */
  get userAgent() { return this.#userAgent; }

  /** @returns {boolean} เป็นการกระทำของระบบเองหรือไม่ */
  get isSystemAction() { return this.#actorId === null; }

  /**
   * ตรวจความถูกต้อง
   * @returns {void}
   * @throws {ValidationError} เมื่อขาดข้อมูลที่จำเป็น
   */
  validate() {
    const errors = [];
    if (!this.#action) errors.push({ field: 'action', message: 'ต้องระบุการกระทำ' });
    if (!this.#resourceType) errors.push({ field: 'resourceType', message: 'ต้องระบุชนิดทรัพยากร' });
    if (!this.#actorLabel) errors.push({ field: 'actorLabel', message: 'ต้องระบุผู้กระทำ' });
    if (errors.length) throw new ValidationError('ข้อมูลบันทึกการใช้งานไม่ถูกต้อง', errors);
  }

  /** @returns {object} โครงสร้างสำหรับส่งออก */
  toJSON() {
    return {
      id: this.id,
      actorId: this.#actorId,
      actorLabel: this.#actorLabel,
      action: this.#action,
      resourceType: this.#resourceType,
      resourceId: this.#resourceId,
      beforeData: this.#beforeData,
      afterData: this.#afterData,
      ip: this.#ip,
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
