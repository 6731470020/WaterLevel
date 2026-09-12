import { KeyRegistry } from './KeyRegistry.js';
import { LazyRebuild } from '../../core/LazyRebuild.js';

/**
 * ทะเบียนคีย์ที่ประกอบตัวเองใหม่เมื่อค่าตั้งค่าเปลี่ยน (Decorator + Lazy Factory)
 *
 * `LicenseService` ถือทะเบียนคีย์ไว้ตลอดอายุโปรเซส ถ้าผู้ดูแลเปลี่ยนคีย์บริการตรวจจับ
 * ในหน้าเว็บแล้วระบบยังตรวจด้วยคีย์เก่า มันจะรายงานสถานะใบอนุญาตผิดจนกว่าจะรีสตาร์ต
 * ซึ่งเป็นเรื่องที่สังเกตได้ยากมาก
 */
export class ConfiguredKeyRegistry extends KeyRegistry {
  /** @type {LazyRebuild<KeyRegistry>} */
  #holder;

  /**
   * @param {object} options ตัวเลือก
   * @param {() => number} options.versionOf ฟังก์ชันอ่านเลขรุ่นปัจจุบันของค่าตั้งค่า
   * @param {() => KeyRegistry} options.factory ฟังก์ชันประกอบทะเบียนจากค่าล่าสุด
   */
  constructor({ versionOf, factory }) {
    super();
    this.#holder = new LazyRebuild(versionOf, factory);
  }

  /**
   * ทะเบียนจริงที่ใช้อยู่ตอนนี้
   * @returns {KeyRegistry}
   */
  get current() { return this.#holder.current; }

  /** @returns {string} ชื่อไดรเวอร์ที่ใช้อยู่ */
  get driver() { return this.current.driver; }

  /** @returns {boolean} ตั้งค่าปลายทางครบแล้วหรือยัง */
  get isConfigured() { return this.current.isConfigured; }

  /**
   * ถามสถานะคีย์ด้วยค่าตั้งค่าล่าสุด
   * @returns {Promise<import('./KeyInfo.js').KeyInfo|null>}
   */
  async fetchKeyInfo() { return this.current.fetchKeyInfo(); }
}
