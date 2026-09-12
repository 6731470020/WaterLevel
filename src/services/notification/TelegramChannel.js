import { NotificationChannel } from './NotificationChannel.js';
import { Logger } from '../../core/Logger.js';

const API_BASE = 'https://api.telegram.org';

/** จำนวนครั้งที่ลองซ้ำเมื่อโดนจำกัดอัตราหรือเซิร์ฟเวอร์ขัดข้อง */
const RETRY_DELAYS_MS = [1000, 3000];

/** ความยาวสูงสุดของคำบรรยายภาพที่ Telegram ยอมรับ */
const MAX_CAPTION = 1024;

/** ความยาวสูงสุดของข้อความธรรมดา */
const MAX_TEXT = 4096;

/**
 * ส่งแจ้งเตือนเข้า Telegram ผ่าน Bot API
 *
 * ใช้ `sendPhoto` เมื่อข้อความมีภาพประกอบ เพราะภาพระดับน้ำคือสาระสำคัญของการเตือน
 * และ Telegram แสดงภาพพร้อมคำบรรยายในข้อความเดียวได้ — ไม่ต้องส่งสองครั้ง
 * ถ้าไม่มีภาพจึงใช้ `sendMessage`
 *
 * จัดรูปแบบด้วย HTML ไม่ใช่ Markdown เพราะชื่อจุดวัดภาษาไทยอาจมีอักขระอย่าง
 * `_` หรือ `*` ที่ Markdown ตีความเป็นคำสั่ง แล้วทำให้ข้อความเพี้ยนทั้งก้อน
 */
export class TelegramChannel extends NotificationChannel {
  /** @type {string} */
  #botToken;
  /** @type {string|null} */
  #defaultChatId;
  /** @type {import('../../core/Logger.js').Logger} */
  #logger;

  /**
   * @param {object} options ค่าตั้งค่า
   * @param {string} options.botToken โทเคนของบอทจาก BotFather
   * @param {string} [options.defaultChatId] รหัสห้องแชทปลายทางเริ่มต้น
   * @param {import('../../core/Logger.js').Logger} [logger] ตัวบันทึกเหตุการณ์
   */
  constructor({ botToken, defaultChatId = null } = {}, logger = Logger.getInstance()) {
    super();
    this.#botToken = String(botToken ?? '');
    this.#defaultChatId = defaultChatId ? String(defaultChatId) : null;
    this.#logger = logger;
  }

  /** @returns {string} ชื่อช่องทาง — บันทึกลง `broadcast_logs.channel` */
  get channel() { return 'telegram'; }

  /**
   * ส่งข้อความเข้า Telegram
   * @param {import('./NotificationMessage.js').NotificationMessage} message เนื้อหาข้อความ
   * @param {{target?: string|null}} [options={}] รหัสห้องแชทเฉพาะกิจ
   * @returns {Promise<{success: boolean, response?: object, error?: string}>}
   */
  async send(message, { target = null } = {}) {
    if (!this.#botToken) {
      return { success: false, error: 'ยังไม่ได้ตั้งค่า TELEGRAM_BOT_TOKEN' };
    }
    const chatId = target || this.#defaultChatId;
    if (!chatId) {
      return { success: false, error: 'ยังไม่ได้ตั้งค่า TELEGRAM_CHAT_ID' };
    }

    const html = TelegramChannel.render(message);

    if (message.imageUrl) {
      return this.#call('sendPhoto', {
        chat_id: chatId,
        photo: message.imageUrl,
        caption: html.slice(0, MAX_CAPTION),
        parse_mode: 'HTML',
      });
    }

    return this.#call('sendMessage', {
      chat_id: chatId,
      text: html.slice(0, MAX_TEXT),
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  }

  /**
   * แปลง `NotificationMessage` เป็นข้อความ HTML ของ Telegram
   * @param {import('./NotificationMessage.js').NotificationMessage} message เนื้อหาข้อความ
   * @returns {string}
   */
  static render(message) {
    const escape = TelegramChannel.escapeHtml;
    const parts = [`<b>${escape(message.title)}</b>`];

    if (message.subtitle) parts.push(escape(message.subtitle));

    if (message.fields.length) {
      parts.push('');
      for (const field of message.fields) {
        const value = field.emphasis
          ? `<b>${escape(field.value)}</b>`
          : escape(field.value);
        parts.push(`${escape(field.label)}: ${value}`);
      }
    }

    if (message.lines.length) {
      parts.push('');
      parts.push(...message.lines.map((line) => escape(line)));
    }

    if (message.links.length) {
      parts.push('');
      parts.push(message.links
        .map((link) => `<a href="${escape(link.url)}">${escape(link.label)}</a>`)
        .join(' · '));
    }

    return parts.join('\n');
  }

  /**
   * หนีอักขระที่ Telegram ตีความเป็น HTML
   *
   * ต้องหนีก่อนประกอบข้อความเสมอ — ชื่อจุดวัดมาจากผู้ใช้ ถ้ามี `<` หรือ `&`
   * Telegram จะปฏิเสธทั้งข้อความด้วย error 400 แล้วแจ้งเตือนจะหายไปเงียบ ๆ
   *
   * @param {string} value ข้อความดิบ
   * @returns {string}
   */
  static escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * ตรวจว่าโทเคนบอทยังใช้ได้
   * @returns {Promise<{healthy: boolean, message: string}>}
   */
  async healthCheck() {
    if (!this.#botToken) {
      return { healthy: false, message: 'ยังไม่ได้ตั้งค่า TELEGRAM_BOT_TOKEN' };
    }
    const result = await this.#call('getMe', null);
    return result.success
      ? { healthy: true, message: `บอท Telegram พร้อมใช้งาน (@${result.response?.result?.username ?? '?'})` }
      : { healthy: false, message: result.error };
  }

  /**
   * เรียก Bot API พร้อมลองซ้ำเมื่อโดนจำกัดอัตรา
   * @param {string} method ชื่อเมท็อดของ Bot API
   * @param {object|null} payload เนื้อหา (`null` = เรียกแบบ GET)
   * @returns {Promise<{success: boolean, response?: object, error?: string}>}
   */
  async #call(method, payload) {
    const url = `${API_BASE}/bot${this.#botToken}/${method}`;
    let lastError = null;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        const response = await fetch(url, payload === null ? {} : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = await response.json().catch(() => ({}));

        if (response.ok && body.ok) {
          return { success: true, response: body };
        }

        const detail = body.description ?? `HTTP ${response.status}`;

        // 4xx ที่ไม่ใช่ 429 คือค่าตั้งค่าผิด (โทเคนผิด ห้องผิด ข้อความผิดรูป)
        // ลองซ้ำอีกกี่ครั้งก็ได้ผลเดิม
        if (response.status !== 429 && response.status < 500) {
          return { success: false, error: `Telegram: ${detail}` };
        }
        lastError = new Error(detail);
      } catch (error) {
        lastError = error;
      }

      this.#logger.warn('telegram send failed', {
        method, attempt: attempt + 1, message: lastError?.message,
      });
      if (attempt < RETRY_DELAYS_MS.length) {
        await TelegramChannel.#sleep(RETRY_DELAYS_MS[attempt]);
      }
    }

    return { success: false, error: `ส่ง Telegram ไม่สำเร็จ: ${lastError?.message ?? 'ไม่ทราบสาเหตุ'}` };
  }

  /**
   * หน่วงเวลาแบบไม่บล็อก
   * @param {number} ms มิลลิวินาที
   * @returns {Promise<void>}
   */
  static #sleep(ms) {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
  }
}
