import { NotificationChannel } from './NotificationChannel.js';
import { LazyRebuild } from '../../core/LazyRebuild.js';

/**
 * ช่องทางที่ประกอบตัวเองใหม่เมื่อค่าตั้งค่าเปลี่ยน (Decorator + Lazy Factory)
 *
 * ปัญหาที่แก้: `AlertService`, `ReportService` และ `LineWebhookController` รับ
 * ช่องทางเข้ามาทาง constructor แล้วถือ**อ้างอิงเดิม**ไว้ตลอดอายุโปรเซส
 * ถ้าผู้ดูแลเปลี่ยนโทเคนในหน้าเว็บ วัตถุที่ถืออยู่จะยังเป็นตัวเก่าจนกว่าจะรีสตาร์ต
 *
 * คลาสนี้เป็นตัวแทนที่หน้าตาเหมือนช่องทางทั่วไปทุกประการ แต่ตรวจเลขรุ่นของ
 * ค่าตั้งค่าก่อนใช้ทุกครั้ง เปลี่ยนเมื่อไรก็ประกอบใหม่เมื่อนั้น — ผู้เรียกไม่รู้เรื่อง
 * และไม่ต้องมีใครคอยแจ้งข่าวให้
 */
export class ConfiguredChannel extends NotificationChannel {
  /** @type {LazyRebuild<NotificationChannel>} */
  #holder;

  /**
   * @param {object} options ตัวเลือก
   * @param {() => number} options.versionOf ฟังก์ชันอ่านเลขรุ่นปัจจุบันของค่าตั้งค่า
   * @param {() => NotificationChannel} options.factory ฟังก์ชันประกอบช่องทางจากค่าล่าสุด
   */
  constructor({ versionOf, factory }) {
    super();
    this.#holder = new LazyRebuild(versionOf, factory);
  }

  /**
   * ช่องทางจริงที่ใช้อยู่ตอนนี้ — ประกอบใหม่เมื่อค่าตั้งค่าเปลี่ยน
   * @returns {NotificationChannel}
   */
  get current() { return this.#holder.current; }

  /** @returns {string} ชื่อช่องทางที่ใช้อยู่ */
  get channel() { return this.current.channel; }

  /** @returns {boolean} ช่องทางที่ใช้อยู่ตอบ reply token ได้หรือไม่ */
  get supportsReply() { return this.current.supportsReply; }

  /**
   * ส่งข้อความด้วยค่าตั้งค่าล่าสุด
   * @param {import('./NotificationMessage.js').NotificationMessage} message เนื้อหาข้อความ
   * @param {object} [options={}] ปลายทาง
   * @returns {Promise<{success: boolean, response?: object, error?: string}>}
   */
  async send(message, options = {}) { return this.current.send(message, options); }

  /**
   * ตอบกลับด้วย reply token
   * @param {string} replyToken token ที่ได้จากเหตุการณ์
   * @param {Array<import('./NotificationMessage.js').NotificationMessage>} messages ข้อความ
   * @returns {Promise<{success: boolean, response?: object, error?: string}>}
   */
  async reply(replyToken, messages) { return this.current.reply(replyToken, messages); }

  /**
   * ตรวจสุขภาพช่องทางที่ใช้อยู่
   * @returns {Promise<{healthy: boolean, message: string}>}
   */
  async healthCheck() { return this.current.healthCheck(); }
}
