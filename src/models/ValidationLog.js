import { BaseModel } from '../core/BaseModel.js';
import { ValidationError } from '../core/errors/index.js';

/**
 * บันทึกผลการตรวจความผันผวนหนึ่งครั้ง (มาจาก `water_validation_log` เดิม)
 *
 * ต้องบันทึก**ทุกครั้ง**ที่เข้าโหมดยืนยัน ไม่ว่าผลจะผ่านหรือไม่ (CLAUDE.md ข้อ 6.4 ขั้นที่ 5)
 * ระบบเดิมมีบั๊กที่คำนวณค่าเฉลี่ยแล้วบันทึก log แต่ `return false` ทำให้ค่าถูกทิ้ง
 */
export class ValidationLog extends BaseModel {
  /** @type {number} */
  #stationId;
  /** @type {number} */
  #suspectedLevel;
  /** @type {number|null} */
  #confirmedLevel;
  /** @type {number} */
  #variation;
  /** @type {number} */
  #attempts;
  /** @type {number} */
  #spread;
  /** @type {boolean} */
  #success;
  /** @type {string|null} */
  #note;

  /**
   * @param {object} data ข้อมูลบันทึก
   * @param {number} data.stationId รหัสจุดวัด
   * @param {number} data.suspectedLevel ค่าที่วัดได้ครั้งแรกและน่าสงสัย (พิกเซล)
   * @param {number|null} [data.confirmedLevel] ค่าที่ยืนยันได้ (พิกเซล)
   * @param {number} data.variation ผลต่างจากค่าเฉลี่ยเดิม (พิกเซล)
   * @param {number} data.attempts จำนวนครั้งที่วัดซ้ำ
   * @param {number} [data.spread=0] ช่วงกระจายของค่าที่วัดซ้ำ (พิกเซล)
   * @param {boolean} [data.success=false] ยืนยันสำเร็จหรือไม่
   * @param {string|null} [data.note] หมายเหตุภาษาไทย
   */
  constructor(data = {}) {
    super(data);
    this.#stationId = Number(data.stationId);
    this.#suspectedLevel = Number(data.suspectedLevel);
    this.#confirmedLevel = data.confirmedLevel === null || data.confirmedLevel === undefined
      ? null : Number(data.confirmedLevel);
    this.#variation = Number(data.variation ?? 0);
    this.#attempts = Number(data.attempts ?? 0);
    this.#spread = Number(data.spread ?? 0);
    this.#success = Boolean(data.success);
    this.#note = data.note ? String(data.note) : null;
  }

  /** @returns {number} รหัสจุดวัด */
  get stationId() { return this.#stationId; }

  /** @returns {number} ค่าที่น่าสงสัย (พิกเซล) */
  get suspectedLevel() { return this.#suspectedLevel; }

  /** @returns {number|null} ค่าที่ยืนยันได้ (พิกเซล) */
  get confirmedLevel() { return this.#confirmedLevel; }

  /** @returns {number} ผลต่างจากค่าเฉลี่ยเดิม (พิกเซล) */
  get variation() { return this.#variation; }

  /** @returns {number} จำนวนครั้งที่วัดซ้ำ */
  get attempts() { return this.#attempts; }

  /** @returns {number} ช่วงกระจายของค่าที่วัดซ้ำ (พิกเซล) */
  get spread() { return this.#spread; }

  /** @returns {boolean} ยืนยันสำเร็จหรือไม่ */
  get success() { return this.#success; }

  /** @returns {string|null} หมายเหตุ */
  get note() { return this.#note; }

  /**
   * ตรวจความถูกต้อง
   * @returns {void}
   * @throws {ValidationError} เมื่อไม่ระบุจุดวัด
   */
  validate() {
    if (!Number.isInteger(this.#stationId) || this.#stationId <= 0) {
      throw new ValidationError('ต้องระบุจุดวัดในบันทึกการตรวจความผันผวน');
    }
  }

  /** @returns {object} โครงสร้างสำหรับส่งออก */
  toJSON() {
    return {
      id: this.id,
      stationId: this.#stationId,
      suspectedLevel: this.#suspectedLevel,
      confirmedLevel: this.#confirmedLevel,
      variation: this.#variation,
      attempts: this.#attempts,
      spread: this.#spread,
      success: this.#success,
      note: this.#note,
      createdAt: this.createdAt,
    };
  }
}
