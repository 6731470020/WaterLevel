import { NotificationChannel } from './NotificationChannel.js';
import { NotificationMessage } from './NotificationMessage.js';
import { UpstreamError, ValidationError } from '../../core/errors/index.js';
import { Logger } from '../../core/Logger.js';

const API_BASE = 'https://api.line.me/v2/bot';
/** ระยะหน่วงก่อนลองใหม่เมื่อได้ 429 หรือ 5xx */
const RETRY_DELAYS_MS = [1000, 3000];

/**
 * ส่งข้อความผ่าน LINE Messaging API
 *
 * ⚠️ Channel Access Token ของระบบเดิมถูกฮาร์ดโค้ดไว้ใน 3 ไฟล์ จึงถือว่า**รั่วแล้ว**
 * และต้องออกใหม่ก่อนใช้งานจริง — คลาสนี้อ่านค่าจาก `.env` เท่านั้น
 * (CLAUDE.md ข้อ 2.1 ข้อบกพร่องที่ 1)
 */
export class LineChannel extends NotificationChannel {
  /** @type {string|null} */
  #accessToken;
  /** @type {string|null} */
  #defaultGroupId;
  /** @type {import('../../core/Logger.js').Logger} */
  #logger;

  /**
   * @param {{accessToken: string|null, defaultGroupId?: string|null}} options ค่าตั้งค่า
   * @param {import('../../core/Logger.js').Logger} [logger] ตัวบันทึกเหตุการณ์
   * @throws {ValidationError} เมื่อไม่ได้ตั้งค่า Channel Access Token
   */
  constructor({ accessToken, defaultGroupId = null }, logger = Logger.getInstance()) {
    super();
    if (!accessToken) {
      throw new ValidationError(
        'ต้องตั้งค่า LINE_CHANNEL_ACCESS_TOKEN ใน .env เมื่อใช้ NOTIFICATION_DRIVER=line',
      );
    }
    this.#accessToken = accessToken;
    this.#defaultGroupId = defaultGroupId;
    this.#logger = logger;
  }

  /** @returns {string} ชื่อช่องทาง */
  get channel() { return 'line'; }

  /** @returns {string|null} รหัสกลุ่มปลายทางเริ่มต้น */
  get defaultGroupId() { return this.#defaultGroupId; }

  /**
   * ส่งข้อความ — เข้ากลุ่มที่ระบุ หรือกระจายให้ผู้ติดตามทั้งหมดเมื่อไม่ระบุ
   * @param {object} message ข้อความ (Flex Message หรือข้อความธรรมดา)
   * @param {{target?: string|null}} [options={}] รหัสกลุ่ม/ผู้ใช้ปลายทาง
   * @returns {Promise<{success: boolean, response?: object, error?: string}>}
   */
  async send(message, { target = null } = {}) {
    const destination = target ?? this.#defaultGroupId;
    const flex = LineChannel.render(message);
    return destination
      ? this.pushToGroup(destination, flex)
      : this.broadcast(flex);
  }

  /** @returns {boolean} LINE ตอบกลับด้วย reply token ได้ */
  get supportsReply() { return true; }

  /**
   * แปลง `NotificationMessage` เป็น Flex Message ของ LINE
   *
   * ข้อความที่มีแต่ข้อความอิสระ (เช่นคำสั่งช่วยเหลือ) ส่งเป็น text ธรรมดาก็พอ
   * ไม่ต้องห่อเป็น bubble ให้เปลืองพื้นที่จอ
   *
   * @param {NotificationMessage} message เนื้อหาข้อความ
   * @returns {object} โครงสร้าง Flex Message หรือข้อความธรรมดา
   */
  static render(message) {
    if (!message.fields.length && !message.imageUrl && !message.links.length) {
      return { type: 'text', text: message.toPlainText() };
    }

    const header = {
      type: 'box', layout: 'vertical', paddingAll: '16px',
      backgroundColor: message.color ?? '#0F766E',
      contents: [{
        type: 'text', text: message.title, weight: 'bold', size: 'lg', wrap: true,
        color: NotificationMessage.textOn(message.color ?? '#0F766E'),
      }],
    };
    if (message.subtitle) {
      header.contents.push({
        type: 'text', text: message.subtitle, size: 'sm', wrap: true, margin: 'sm',
        color: NotificationMessage.textOn(message.color ?? '#0F766E'),
      });
    }

    const body = message.fields.map((field) => LineChannel.#row(field, message.color));
    for (const line of message.lines) {
      body.push({ type: 'text', text: line, size: 'xs', wrap: true, color: '#6B7280', margin: 'md' });
    }

    const contents = {
      type: 'bubble',
      header,
      body: { type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px', contents: body },
    };

    if (message.imageUrl) {
      contents.hero = {
        type: 'image', url: message.imageUrl, size: 'full',
        aspectRatio: '4:3', aspectMode: 'cover',
      };
    }

    if (message.links.length) {
      contents.footer = {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: message.links.map((link, index) => ({
          type: 'button', height: 'sm', style: index === 0 ? 'primary' : 'secondary',
          action: { type: 'uri', label: link.label, uri: link.url },
        })),
      };
    }

    return { type: 'flex', altText: message.summary, contents };
  }

  /**
   * แถวป้ายกำกับ-ค่าใน body ของ bubble
   * @param {{label: string, value: string, emphasis: boolean}} field ข้อมูลแถว
   * @param {string|null} accent สีเน้นของข้อความ
   * @returns {object}
   */
  static #row(field, accent) {
    return {
      type: 'box', layout: 'horizontal', spacing: 'sm',
      contents: [
        { type: 'text', text: field.label, size: 'sm', color: '#6B7280', flex: 4, gravity: 'center' },
        {
          type: 'text', text: field.value, flex: 6, align: 'end', wrap: true, gravity: 'center',
          size: field.emphasis ? 'xl' : 'sm',
          weight: field.emphasis ? 'bold' : 'regular',
          color: field.emphasis ? (accent ?? '#111827') : '#111827',
        },
      ],
    };
  }

  /**
   * ส่งข้อความเข้ากลุ่มหรือถึงผู้ใช้รายเดียว
   * @param {string} to รหัสกลุ่มหรือรหัสผู้ใช้
   * @param {object|Array<object>} message ข้อความ
   * @returns {Promise<{success: boolean, response?: object, error?: string}>}
   */
  async pushToGroup(to, message) {
    return this.#request('/message/push', {
      to,
      messages: Array.isArray(message) ? message : [message],
    });
  }

  /**
   * กระจายข้อความถึงผู้ติดตามทุกคน
   * @param {object|Array<object>} message ข้อความ
   * @returns {Promise<{success: boolean, response?: object, error?: string}>}
   */
  async broadcast(message) {
    return this.#request('/message/broadcast', {
      messages: Array.isArray(message) ? message : [message],
    });
  }

  /**
   * ตอบกลับด้วย reply token จาก webhook
   * @param {string} replyToken token ที่ได้จากเหตุการณ์
   * @param {Array<object>} messages ข้อความที่ต้องการส่ง
   * @returns {Promise<{success: boolean, response?: object, error?: string}>}
   */
  async reply(replyToken, messages) {
    const list = Array.isArray(messages) ? messages : [messages];
    return this.#request('/message/reply', {
      replyToken,
      messages: list.map((item) => LineChannel.render(item)),
    });
  }

  /**
   * ตรวจว่า token ยังใช้ได้อยู่
   * @returns {Promise<{healthy: boolean, message: string}>}
   */
  async healthCheck() {
    try {
      const response = await fetch(`${API_BASE}/info`, { headers: this.#headers() });
      return response.ok
        ? { healthy: true, message: 'เชื่อมต่อ LINE Messaging API สำเร็จ' }
        : { healthy: false, message: `LINE ตอบรหัส ${response.status}` };
    } catch (error) {
      return { healthy: false, message: `เชื่อมต่อ LINE ไม่ได้: ${error.message}` };
    }
  }

  /**
   * ส่งคำขอไปยัง LINE พร้อมลองซ้ำเมื่อได้ 429 หรือ 5xx
   * @param {string} path พาธปลายทาง
   * @param {object} payload เนื้อคำขอ
   * @returns {Promise<{success: boolean, response?: object, error?: string}>}
   */
  async #request(path, payload) {
    let lastError = 'ไม่ทราบสาเหตุ';

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        const response = await fetch(`${API_BASE}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...this.#headers() },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          return { success: true, response: { status: response.status } };
        }

        const text = await response.text().catch(() => '');
        lastError = `HTTP ${response.status} ${text.slice(0, 200)}`;

        // 4xx อื่นนอกจาก 429 เป็นความผิดของคำขอเอง ลองซ้ำไปก็ไม่ช่วย
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable) break;
      } catch (error) {
        lastError = error.message;
      }

      if (attempt < RETRY_DELAYS_MS.length) {
        await LineChannel.#sleep(RETRY_DELAYS_MS[attempt]);
      }
    }

    this.#logger.error('line api request failed', { path, error: lastError });
    return { success: false, error: lastError };
  }

  /**
   * ส่วนหัวยืนยันตัวตน
   * @returns {Record<string, string>}
   */
  #headers() {
    return { Authorization: `Bearer ${this.#accessToken}` };
  }

  /**
   * หน่วงเวลาแบบไม่บล็อก event loop
   * @param {number} ms มิลลิวินาที
   * @returns {Promise<void>}
   */
  static #sleep(ms) {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
  }
}
