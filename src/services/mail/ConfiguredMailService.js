import { MailService } from './MailService.js';
import { LazyRebuild } from '../../core/LazyRebuild.js';

/**
 * บริการอีเมลที่ประกอบตัวเองใหม่เมื่อค่าตั้งค่าเปลี่ยน (Decorator + Lazy Factory)
 *
 * `AuthController` และ `DashboardController` รับบริการอีเมลเข้ามาทาง constructor
 * แล้วถืออ้างอิงเดิมไว้ตลอดอายุโปรเซส เมื่อผู้ดูแลใส่กุญแจ Mailjet ในหน้าเว็บ
 * วัตถุที่ถืออยู่จะยังเป็นตัวเก่าที่ส่งไม่ได้จนกว่าจะรีสตาร์ต — คลาสนี้ปิดช่องนั้น
 */
export class ConfiguredMailService extends MailService {
  /** @type {LazyRebuild<MailService>} */
  #holder;

  /**
   * @param {object} options ตัวเลือก
   * @param {() => number} options.versionOf ฟังก์ชันอ่านเลขรุ่นปัจจุบันของค่าตั้งค่า
   * @param {() => MailService} options.factory ฟังก์ชันประกอบบริการจากค่าล่าสุด
   */
  constructor({ versionOf, factory }) {
    super();
    this.#holder = new LazyRebuild(versionOf, factory);
  }

  /**
   * บริการจริงที่ใช้อยู่ตอนนี้
   * @returns {MailService}
   */
  get current() { return this.#holder.current; }

  /** @returns {string} ชื่อไดรเวอร์ที่ใช้อยู่ */
  get driver() { return this.current.driver; }

  /** @returns {boolean} ตั้งค่าผู้ให้บริการอีเมลจริงแล้วหรือยัง */
  get isConfigured() { return this.current.isConfigured; }

  /**
   * ส่งอีเมลด้วยค่าตั้งค่าล่าสุด
   * @param {{to: string, toName?: string, subject: string, text: string, html?: string}} message เนื้อหาจดหมาย
   * @returns {Promise<{sent: boolean, reason?: string}>}
   */
  async send(message) { return this.current.send(message); }

  /**
   * ตรวจสุขภาพบริการที่ใช้อยู่
   * @returns {Promise<{healthy: boolean, message: string}>}
   */
  async healthCheck() { return this.current.healthCheck(); }
}
