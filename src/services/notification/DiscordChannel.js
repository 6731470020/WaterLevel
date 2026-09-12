import { NotificationChannel } from './NotificationChannel.js';
import { Logger } from '../../core/Logger.js';

/** จำนวนครั้งที่ลองซ้ำเมื่อโดนจำกัดอัตราหรือเซิร์ฟเวอร์ขัดข้อง */
const RETRY_DELAYS_MS = [1000, 3000];

/** Discord จำกัดจำนวนช่องในหนึ่ง embed */
const MAX_FIELDS = 25;

/** ความยาวสูงสุดของค่าที่ Discord ยอมรับในหนึ่งช่อง */
const MAX_FIELD_VALUE = 1024;

/**
 * ส่งแจ้งเตือนเข้า Discord ผ่าน Incoming Webhook
 *
 * เลือก webhook แทน bot เพราะผู้ดูแลท้องถิ่นตั้งได้เองในไม่กี่คลิก
 * (ตั้งค่าช่อง → Integrations → Webhooks → คัดลอก URL) ไม่ต้องสร้างแอป
 * ไม่ต้องจัดการสิทธิ์ และไม่ต้องเปิดพอร์ตให้ Discord ยิงกลับ
 *
 * ปลายทางส่งเป็นรายข้อความได้ — `options.target` ที่เป็น URL ของ webhook อื่น
 * จะถูกใช้แทนค่าเริ่มต้น ทำให้ส่งคนละช่องตามจุดวัดได้
 */
export class DiscordChannel extends NotificationChannel {
  /** @type {string} */
  #webhookUrl;
  /** @type {string|null} */
  #username;
  /** @type {import('../../core/Logger.js').Logger} */
  #logger;

  /**
   * @param {object} options ค่าตั้งค่า
   * @param {string} options.webhookUrl URL ของ Incoming Webhook
   * @param {string} [options.username] ชื่อผู้ส่งที่แสดงใน Discord
   * @param {import('../../core/Logger.js').Logger} [logger] ตัวบันทึกเหตุการณ์
   */
  constructor({ webhookUrl, username = null } = {}, logger = Logger.getInstance()) {
    super();
    this.#webhookUrl = String(webhookUrl ?? '');
    this.#username = username ? String(username) : null;
    this.#logger = logger;
  }

  /** @returns {string} ชื่อช่องทาง — บันทึกลง `broadcast_logs.channel` */
  get channel() { return 'discord'; }

  /**
   * ส่งข้อความเข้า Discord
   * @param {import('./NotificationMessage.js').NotificationMessage} message เนื้อหาข้อความ
   * @param {{target?: string|null}} [options={}] URL webhook เฉพาะกิจ
   * @returns {Promise<{success: boolean, response?: object, error?: string}>}
   */
  async send(message, { target = null } = {}) {
    const url = target || this.#webhookUrl;
    if (!url) {
      return { success: false, error: 'ยังไม่ได้ตั้งค่า DISCORD_WEBHOOK_URL' };
    }

    const payload = {
      // `content` เป็นข้อความที่แสดงในการแจ้งเตือนบนมือถือ ส่วน embed อาจถูกย่อ
      content: message.summary.slice(0, 2000),
      embeds: [DiscordChannel.render(message)],
    };
    if (this.#username) payload.username = this.#username;

    return this.#post(url, payload);
  }

  /**
   * แปลง `NotificationMessage` เป็น embed ของ Discord
   * @param {import('./NotificationMessage.js').NotificationMessage} message เนื้อหาข้อความ
   * @returns {object}
   */
  static render(message) {
    const embed = {
      title: message.title,
      color: message.colorInt,
      timestamp: undefined,
    };
    if (message.subtitle) embed.description = message.subtitle;

    const fields = message.fields.slice(0, MAX_FIELDS).map((field) => ({
      name: field.label,
      value: String(field.value).slice(0, MAX_FIELD_VALUE) || '—',
      // ค่าที่เน้นให้กินเต็มบรรทัด ค่าปกติจัดเรียงสองคอลัมน์ให้อ่านง่าย
      inline: !field.emphasis,
    }));

    // ลิงก์กลายเป็นบรรทัดท้าย embed — Discord ไม่มีปุ่มใน webhook payload
    const tail = message.lines.slice();
    if (message.links.length) {
      tail.push(message.links.map((link) => `[${link.label}](${link.url})`).join(' · '));
    }
    if (tail.length) {
      fields.push({ name: '​', value: tail.join('\n').slice(0, MAX_FIELD_VALUE), inline: false });
    }

    if (fields.length) embed.fields = fields;
    if (message.imageUrl) embed.image = { url: message.imageUrl };

    return embed;
  }

  /**
   * ตรวจว่า webhook ยังใช้ได้
   *
   * เรียกแบบ GET ซึ่ง Discord คืนข้อมูลของ webhook โดยไม่ส่งข้อความออกไป
   * — สำคัญมาก เพราะการตรวจสุขภาพทุก 15 นาทีต้องไม่สแปมเข้าช่องจริง
   *
   * @returns {Promise<{healthy: boolean, message: string}>}
   */
  async healthCheck() {
    if (!this.#webhookUrl) {
      return { healthy: false, message: 'ยังไม่ได้ตั้งค่า DISCORD_WEBHOOK_URL' };
    }
    try {
      const response = await fetch(this.#webhookUrl, { method: 'GET' });
      return response.ok
        ? { healthy: true, message: 'Discord webhook พร้อมใช้งาน' }
        : { healthy: false, message: `Discord ตอบรหัส HTTP ${response.status}` };
    } catch (error) {
      return { healthy: false, message: `เชื่อมต่อ Discord ไม่ได้: ${error.message}` };
    }
  }

  /**
   * ส่งคำขอพร้อมลองซ้ำเมื่อโดนจำกัดอัตรา
   * @param {string} url ปลายทาง
   * @param {object} payload เนื้อหา
   * @returns {Promise<{success: boolean, response?: object, error?: string}>}
   */
  async #post(url, payload) {
    let lastError = null;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          return { success: true, response: { status: response.status } };
        }

        // 4xx อื่น ๆ คือ payload หรือ URL ผิด ลองซ้ำก็ได้ผลเดิม
        if (response.status !== 429 && response.status < 500) {
          const detail = await response.text().catch(() => '');
          return { success: false, error: `Discord ตอบรหัส ${response.status} ${detail.slice(0, 200)}` };
        }

        lastError = new Error(`Discord ตอบรหัส ${response.status}`);
      } catch (error) {
        lastError = error;
      }

      this.#logger.warn('discord send failed', {
        attempt: attempt + 1, message: lastError?.message,
      });
      if (attempt < RETRY_DELAYS_MS.length) {
        await DiscordChannel.#sleep(RETRY_DELAYS_MS[attempt]);
      }
    }

    return { success: false, error: `ส่ง Discord ไม่สำเร็จ: ${lastError?.message ?? 'ไม่ทราบสาเหตุ'}` };
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
