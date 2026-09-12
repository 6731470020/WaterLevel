import { BaseModel } from '../core/BaseModel.js';
import { ValidationError } from '../core/errors/index.js';
import { ZoneLevel } from './values/ZoneLevel.js';

/**
 * สถานะการแจ้งเตือนล่าสุดของจุดวัดหนึ่งแห่ง (ตารางใหม่ที่ไม่มีในระบบเดิม)
 *
 * เก็บโซนล่าสุดและเวลาที่แจ้งเตือนครั้งสุดท้าย เพื่อให้ `AlertService` ตัดสินใจได้ว่า
 * ควรส่งซ้ำหรือไม่ — แทนที่ระบบเดิมที่ยิงทุกชั่วโมงตลอดเวลาที่อยู่ในโซนวิกฤต
 */
export class StationAlertState extends BaseModel {
  /** @type {number} */
  #stationId;
  /** @type {ZoneLevel|null} */
  #lastZone;
  /** @type {ZoneLevel|null} */
  #lastAlertedZone;
  /** @type {Date|null} */
  #lastAlertAt;
  /** @type {Date|null} */
  #lastMeasuredAt;

  /**
   * @param {object} data ข้อมูลสถานะ
   * @param {number} data.stationId รหัสจุดวัด
   * @param {string|null} [data.lastZoneKey] คีย์โซนล่าสุดที่วัดได้
   * @param {string|null} [data.lastAlertedZoneKey] คีย์โซนที่แจ้งเตือนไปครั้งล่าสุด
   * @param {Date|string|null} [data.lastAlertAt] เวลาที่แจ้งเตือนครั้งล่าสุด
   */
  constructor(data = {}) {
    super(data);
    this.#stationId = Number(data.stationId);
    this.#lastZone = ZoneLevel.parse(data.lastZoneKey);
    this.#lastAlertedZone = ZoneLevel.parse(data.lastAlertedZoneKey);
    this.#lastAlertAt = BaseModel.toDate(data.lastAlertAt);
    this.#lastMeasuredAt = BaseModel.toDate(data.lastMeasuredAt);
  }

  /** @returns {number} รหัสจุดวัด */
  get stationId() { return this.#stationId; }

  /** @returns {ZoneLevel|null} โซนล่าสุดที่วัดได้ */
  get lastZone() { return this.#lastZone; }

  /** @returns {ZoneLevel|null} โซนที่แจ้งเตือนไปครั้งล่าสุด */
  get lastAlertedZone() { return this.#lastAlertedZone; }

  /** @returns {Date|null} เวลาที่แจ้งเตือนครั้งล่าสุด */
  get lastAlertAt() { return this.#lastAlertAt; }

  /** @returns {Date|null} เวลาที่วัดค่าล่าสุด */
  get lastMeasuredAt() { return this.#lastMeasuredAt; }

  /**
   * จำนวนนาทีที่ผ่านไปนับจากการแจ้งเตือนครั้งล่าสุด
   * @returns {number} `Infinity` เมื่อยังไม่เคยแจ้งเตือน
   */
  get minutesSinceLastAlert() {
    if (!this.#lastAlertAt) return Infinity;
    return (Date.now() - this.#lastAlertAt.getTime()) / 60000;
  }

  /**
   * ตรวจว่าพ้นระยะกันการแจ้งเตือนซ้ำแล้วหรือยัง
   * @param {number} cooldownMinutes ระยะกันซ้ำเป็นนาที
   * @returns {boolean}
   */
  isCooldownOver(cooldownMinutes) {
    return this.minutesSinceLastAlert >= Number(cooldownMinutes ?? 0);
  }

  /**
   * ตรวจความถูกต้อง
   * @returns {void}
   * @throws {ValidationError} เมื่อไม่ระบุจุดวัด
   */
  validate() {
    if (!Number.isInteger(this.#stationId) || this.#stationId <= 0) {
      throw new ValidationError('ต้องระบุจุดวัดในสถานะการแจ้งเตือน');
    }
  }

  /** @returns {object} โครงสร้างสำหรับส่งออก */
  toJSON() {
    return {
      id: this.id,
      stationId: this.#stationId,
      lastZone: this.#lastZone?.toJSON() ?? null,
      lastAlertedZone: this.#lastAlertedZone?.toJSON() ?? null,
      lastAlertAt: this.#lastAlertAt,
      lastMeasuredAt: this.#lastMeasuredAt,
      minutesSinceLastAlert: Number.isFinite(this.minutesSinceLastAlert)
        ? Math.round(this.minutesSinceLastAlert) : null,
    };
  }
}
