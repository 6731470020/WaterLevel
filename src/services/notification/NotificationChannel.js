import { NotImplementedError } from '../../core/errors/index.js';

/**
 * คลาสนามธรรมของช่องทางแจ้งเตือน (Strategy Pattern)
 *
 * สลับด้วย `NOTIFICATION_DRIVER` ใน `.env` — ใส่ได้หลายค่าคั่นด้วยจุลภาค
 * เช่น `line,discord,telegram` เพื่อส่งพร้อมกันทุกช่องทาง
 * ตอนพัฒนาใช้ `console` เพื่อไม่ให้ยิงข้อความจริงเข้ากลุ่มโดยไม่ตั้งใจ
 *
 * ทุกช่องทางรับ `NotificationMessage` ซึ่งเป็นเนื้อหาล้วน ๆ แล้วเรนเดอร์เองตามรูปแบบ
 * ของตัวเอง ชั้นธุรกิจจึงไม่เคยรู้จักรูปแบบข้อความของช่องทางใดเลย
 *
 * @abstract
 */
export class NotificationChannel {
  /** @throws {NotImplementedError} เมื่อสร้างวัตถุจากคลาสนามธรรมโดยตรง */
  constructor() {
    if (new.target === NotificationChannel) {
      throw new NotImplementedError('NotificationChannel เป็นคลาสนามธรรม สร้างวัตถุโดยตรงไม่ได้');
    }
  }

  /**
   * ชื่อช่องทาง — บันทึกลง `broadcast_logs.channel`
   * @abstract
   * @returns {string}
   * @throws {NotImplementedError} เมื่อคลาสลูกไม่ override
   */
  get channel() {
    throw new NotImplementedError(`${this.constructor.name} ต้อง override channel`);
  }

  /**
   * ส่งข้อความไปยังปลายทางที่ระบุ
   * @abstract
   * @param {import('./NotificationMessage.js').NotificationMessage} message เนื้อหาข้อความ
   * @param {{target?: string|null}} [options={}] ปลายทาง
   * @returns {Promise<{success: boolean, response?: object, error?: string}>}
   * @throws {NotImplementedError} เมื่อคลาสลูกไม่ override
   */
  async send(message, options = {}) {
    throw new NotImplementedError(`${this.constructor.name} ต้อง override send()`);
  }

  /**
   * ช่องทางนี้ตอบกลับด้วย reply token ได้หรือไม่
   *
   * มีแต่ LINE ที่ให้ token สำหรับตอบกลับเหตุการณ์จาก webhook — ช่องทางอื่น
   * ตอบได้แต่ต้องส่งเป็นข้อความใหม่ `CompositeChannel` ใช้ค่านี้เลือกตัวที่ตอบได้จริง
   *
   * @returns {boolean}
   */
  get supportsReply() { return false; }

  /**
   * ตอบกลับข้อความด้วย reply token (ใช้จาก webhook)
   * @param {string} replyToken token ที่ได้จากเหตุการณ์
   * @param {Array<import('./NotificationMessage.js').NotificationMessage>} messages ข้อความที่ต้องการส่ง
   * @returns {Promise<{success: boolean, response?: object, error?: string}>}
   */
  async reply(replyToken, messages) {
    return this.send(messages[0], { target: null });
  }

  /**
   * ตรวจว่าช่องทางพร้อมใช้งาน
   * @returns {Promise<{healthy: boolean, message: string}>}
   */
  async healthCheck() {
    return { healthy: true, message: `ช่องทาง ${this.channel} พร้อมใช้งาน` };
  }
}
