import { NotificationChannel } from './NotificationChannel.js';
import { Logger } from '../../core/Logger.js';

/**
 * พิมพ์ข้อความแจ้งเตือนลงคอนโซลแทนการส่งจริง — ใช้ตอนพัฒนาและตอนทดสอบ
 *
 * ทำให้ทดสอบเส้นทางการแจ้งเตือนทั้งหมดได้โดยไม่ต้องมี Channel Access Token
 * และไม่มีความเสี่ยงที่จะส่งข้อความทดสอบเข้ากลุ่มจริง
 */
export class ConsoleChannel extends NotificationChannel {
  /** @type {import('../../core/Logger.js').Logger} */
  #logger;

  /** @param {import('../../core/Logger.js').Logger} [logger] ตัวบันทึกเหตุการณ์ */
  constructor(logger = Logger.getInstance()) {
    super();
    this.#logger = logger;
  }

  /** @returns {string} ชื่อช่องทาง */
  get channel() { return 'console'; }

  /**
   * "ส่ง" ข้อความด้วยการบันทึกลง log
   * @param {import('./NotificationMessage.js').NotificationMessage} message ข้อความ
   * @param {{target?: string|null}} [options={}] ปลายทาง
   * @returns {Promise<{success: true, response: object}>}
   */
  async send(message, { target = null } = {}) {
    this.#logger.info('notification (console driver)', {
      target: target ?? 'broadcast',
      kind: message?.kind ?? 'unknown',
      summary: message?.summary ?? '(ไม่มีข้อความสรุป)',
    });
    // พิมพ์เนื้อความเต็มลงคอนโซล เพื่อให้ตรวจสอบข้อความจริงได้ตอนพัฒนา
    process.stdout.write(`\n${'─'.repeat(56)}\n${message?.toPlainText?.() ?? ''}\n${'─'.repeat(56)}\n\n`);
    return { success: true, response: { driver: 'console', target } };
  }

  /**
   * "ตอบกลับ" ด้วยการบันทึกลง log
   * @param {string} replyToken token ที่ได้จากเหตุการณ์
   * @param {Array<object>} messages ข้อความ
   * @returns {Promise<{success: true, response: object}>}
   */
  async reply(replyToken, messages) {
    const list = Array.isArray(messages) ? messages : [messages];
    this.#logger.info('notification reply (console driver)', {
      count: list.length,
      first: list[0]?.summary ?? null,
    });
    return { success: true, response: { driver: 'console', replied: list.length } };
  }
}
