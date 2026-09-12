import { NotificationChannel } from './NotificationChannel.js';
import { ValidationError } from '../../core/errors/index.js';
import { Logger } from '../../core/Logger.js';

/**
 * ส่งข้อความเดียวกันออกหลายช่องทางพร้อมกัน (Composite Pattern)
 *
 * ตัวมันเองก็เป็น `NotificationChannel` ตัวหนึ่ง ผู้เรียกจึงไม่ต้องรู้เลยว่า
 * ปลายทางมีกี่ช่องทาง — `AlertService` เรียก `send()` เหมือนเดิมทุกประการ
 *
 * **ช่องทางหนึ่งล้มต้องไม่ทำให้ช่องทางอื่นล้มตาม** — หน่วยงานที่ตั้งทั้ง LINE และ
 * Discord ไว้ ย่อมไม่ต้องการให้ Discord ที่ token หมดอายุมาบล็อกการเตือนภัยทาง LINE
 * จึงส่งทุกช่องทางแบบขนานแล้วรวมผล ถือว่าสำเร็จเมื่อมีอย่างน้อยหนึ่งช่องทางส่งได้
 */
export class CompositeChannel extends NotificationChannel {
  /** @type {Array<NotificationChannel>} */
  #channels;
  /** @type {import('../../core/Logger.js').Logger} */
  #logger;

  /**
   * @param {Array<NotificationChannel>} channels ช่องทางที่ต้องส่ง
   * @param {import('../../core/Logger.js').Logger} [logger] ตัวบันทึกเหตุการณ์
   * @throws {ValidationError} เมื่อไม่มีช่องทางเลย
   */
  constructor(channels, logger = Logger.getInstance()) {
    super();
    if (!channels?.length) {
      throw new ValidationError('CompositeChannel ต้องมีช่องทางอย่างน้อยหนึ่งช่องทาง');
    }
    this.#channels = [...channels];
    this.#logger = logger;
  }

  /** @returns {string} ชื่อช่องทางทั้งหมดคั่นด้วยจุลภาค เช่น `line+discord` */
  get channel() { return this.#channels.map((item) => item.channel).join('+'); }

  /** @returns {Array<NotificationChannel>} ช่องทางย่อยทั้งหมด */
  get channels() { return [...this.#channels]; }

  /** @returns {boolean} มีช่องทางใดตอบกลับด้วย reply token ได้หรือไม่ */
  get supportsReply() { return this.#channels.some((item) => item.supportsReply); }

  /**
   * ส่งข้อความออกทุกช่องทางพร้อมกัน
   * @param {import('./NotificationMessage.js').NotificationMessage} message เนื้อหาข้อความ
   * @param {{target?: string|null, targets?: Record<string, string>}} [options={}] ปลายทาง
   *   `targets` ระบุปลายทางแยกรายช่องทางได้ เช่น `{ line: 'Cxxx', discord: 'https://…' }`
   * @returns {Promise<{success: boolean, response: object, error?: string}>}
   */
  async send(message, { target = null, targets = {} } = {}) {
    const settled = await Promise.all(this.#channels.map(async (item) => {
      try {
        const outcome = await item.send(message, { target: targets[item.channel] ?? target });
        return { channel: item.channel, ...outcome };
      } catch (error) {
        return { channel: item.channel, success: false, error: error.message };
      }
    }));

    const failed = settled.filter((item) => !item.success);
    for (const item of failed) {
      this.#logger.warn('notification channel failed', {
        channel: item.channel, error: item.error,
      });
    }

    const success = settled.some((item) => item.success);
    return {
      success,
      response: { results: settled },
      // รายงานเฉพาะช่องทางที่ล้ม เพื่อให้ `broadcast_logs` บอกได้ว่าใครไม่ได้รับ
      error: failed.length
        ? `ส่งไม่สำเร็จ ${failed.length} ช่องทาง: ${failed.map((item) => `${item.channel} (${item.error})`).join(', ')}`
        : undefined,
    };
  }

  /**
   * ตอบกลับด้วย reply token ผ่านช่องทางที่รองรับ
   *
   * reply token ออกโดยช่องทางใดช่องทางหนึ่ง (ปัจจุบันมีแต่ LINE) จึงส่งให้เฉพาะ
   * ช่องทางนั้น ไม่กระจายไปทุกช่องทาง — คนถามใน LINE ไม่ควรทำให้ Discord เด้ง
   *
   * @param {string} replyToken token ที่ได้จากเหตุการณ์
   * @param {Array<import('./NotificationMessage.js').NotificationMessage>} messages ข้อความ
   * @returns {Promise<{success: boolean, response?: object, error?: string}>}
   */
  async reply(replyToken, messages) {
    const responder = this.#channels.find((item) => item.supportsReply);
    if (!responder) {
      return { success: false, error: 'ไม่มีช่องทางใดที่ตอบกลับด้วย reply token ได้' };
    }
    return responder.reply(replyToken, messages);
  }

  /**
   * ตรวจสุขภาพทุกช่องทาง
   * @returns {Promise<{healthy: boolean, message: string}>}
   */
  async healthCheck() {
    const results = await Promise.all(this.#channels.map(async (item) => {
      try {
        return { channel: item.channel, ...(await item.healthCheck()) };
      } catch (error) {
        return { channel: item.channel, healthy: false, message: error.message };
      }
    }));

    const unhealthy = results.filter((item) => !item.healthy);
    return unhealthy.length
      ? {
        healthy: false,
        message: unhealthy.map((item) => `${item.channel}: ${item.message}`).join(' · '),
      }
      : { healthy: true, message: `ทุกช่องทางพร้อมใช้งาน (${this.channel})` };
  }
}
