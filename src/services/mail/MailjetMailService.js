import { MailService } from './MailService.js';
import { ValidationError } from '../../core/errors/index.js';
import { Logger } from '../../core/Logger.js';

/** ปลายทาง Send API ของ Mailjet */
const SEND_URL = 'https://api.mailjet.com/v3.1/send';
/** ปลายทางที่ใช้ตรวจว่ากุญแจใช้ได้จริง */
const PING_URL = 'https://api.mailjet.com/v3/REST/sender?Limit=1';

/**
 * ส่งอีเมลผ่าน **Mailjet Send API v3.1**
 *
 * เลือกใช้ REST API แทน SMTP relay ของ Mailjet เพราะ:
 * 1. ไม่ต้องพึ่ง `nodemailer` — เรียกด้วย `fetch` ที่มีมากับ Node 22 ได้เลย
 *    (ตัดไลบรารีออกได้หนึ่งตัวตาม CLAUDE.md ข้อ 15)
 * 2. หน่วยงานหลายแห่งปิดพอร์ต 587/465 ขาออก แต่ 443 เปิดเสมอ
 * 3. ได้เหตุผลที่ชัดเจนกลับมาเมื่อส่งไม่สำเร็จ แทนรหัส SMTP ที่ตีความยาก
 *
 * ⚠️ **HTTP 200 ไม่ได้แปลว่าส่งสำเร็จ** — Mailjet ตอบ 200 พร้อม `Status: "error"`
 * รายฉบับได้ (เช่นอีเมลผู้ส่งยังไม่ผ่านการยืนยัน) ต้องอ่านลงไปถึงระดับข้อความเสมอ
 */
export class MailjetMailService extends MailService {
  /** @type {string} */
  #apiKey;
  /** @type {string} */
  #secretKey;
  /** @type {string} */
  #fromEmail;
  /** @type {string} */
  #fromName;
  /** @type {number} */
  #timeoutMs;
  /** @type {import('../../core/Logger.js').Logger} */
  #logger;

  /**
   * @param {object} options ค่าตั้งค่า
   * @param {string} options.apiKey Mailjet API Key
   * @param {string} options.secretKey Mailjet Secret Key
   * @param {string} options.fromEmail อีเมลผู้ส่ง (ต้องยืนยันกับ Mailjet แล้ว)
   * @param {string} [options.fromName] ชื่อผู้ส่งที่แสดงในกล่องจดหมาย
   * @param {number} [options.timeoutMs=15000] เวลารอสูงสุด
   * @param {import('../../core/Logger.js').Logger} [logger] ตัวบันทึกเหตุการณ์
   * @throws {ValidationError} เมื่อตั้งค่าไม่ครบ
   */
  constructor({ apiKey, secretKey, fromEmail, fromName = '', timeoutMs = 15000 },
    logger = Logger.getInstance()) {
    super();
    if (!apiKey || !secretKey) {
      throw new ValidationError('ต้องตั้งค่า Mailjet API Key และ Secret Key ก่อนจึงจะส่งอีเมลได้');
    }
    if (!fromEmail) {
      throw new ValidationError('ต้องตั้งค่าอีเมลผู้ส่ง (MAIL_FROM) ก่อนจึงจะส่งอีเมลได้');
    }
    this.#apiKey = String(apiKey);
    this.#secretKey = String(secretKey);
    this.#fromEmail = String(fromEmail);
    this.#fromName = String(fromName || 'ระบบวัดระดับน้ำอัตโนมัติ');
    this.#timeoutMs = Number(timeoutMs);
    this.#logger = logger;
  }

  /** @returns {string} ชื่อไดรเวอร์ */
  get driver() { return 'mailjet'; }

  /** @returns {boolean} ตั้งค่าครบแล้ว (constructor การันตีไว้ตั้งแต่ตอนสร้าง) */
  get isConfigured() { return true; }

  /**
   * ส่งอีเมลหนึ่งฉบับผ่าน Mailjet
   * @param {{to: string, toName?: string, subject: string, text: string, html?: string}} message เนื้อหาจดหมาย
   * @returns {Promise<{sent: boolean, reason?: string, messageId?: string}>}
   */
  async send({ to, toName = '', subject, text, html }) {
    const payload = {
      Messages: [{
        From: { Email: this.#fromEmail, Name: this.#fromName },
        To: [{ Email: to, Name: toName || to }],
        Subject: subject,
        TextPart: text,
        ...(html ? { HTMLPart: html } : {}),
      }],
    };

    try {
      const { status, body } = await this.#post(SEND_URL, payload);

      if (status === 401) {
        return { sent: false, reason: 'Mailjet ปฏิเสธกุญแจ — ตรวจ API Key และ Secret Key' };
      }
      if (status >= 400) {
        return { sent: false, reason: MailjetMailService.#describe(status, body) };
      }

      const result = body?.Messages?.[0];
      if (result?.Status !== 'success') {
        // ⚠️ ถึงตรงนี้ได้ทั้งที่ HTTP 200 — ดูเหตุผลใน JSDoc ของคลาส
        const reason = MailjetMailService.#describeMessageErrors(result);
        this.#logger.error('mailjet rejected the message', { reason });
        return { sent: false, reason };
      }

      // ⚠️ ห้ามบันทึกอีเมลผู้รับหรือเนื้อหาลง log — เก็บแค่รหัสอ้างอิงไว้ตามเรื่องได้
      const messageId = result?.To?.[0]?.MessageUUID ?? null;
      this.#logger.info('password reset email sent', { provider: 'mailjet', messageId });
      return { sent: true, messageId };
    } catch (error) {
      this.#logger.error('failed to send email via mailjet', { message: error.message });
      return { sent: false, reason: error.message };
    }
  }

  /**
   * ตรวจว่ากุญแจใช้ได้และติดต่อ Mailjet ได้จริง
   * @returns {Promise<{healthy: boolean, message: string}>}
   */
  async healthCheck() {
    try {
      const { status } = await this.#request(PING_URL, { method: 'GET' });
      if (status === 200) {
        return { healthy: true, message: `เชื่อมต่อ Mailjet สำเร็จ (ผู้ส่ง ${this.#fromEmail})` };
      }
      if (status === 401) {
        return { healthy: false, message: 'Mailjet ปฏิเสธกุญแจ — ตรวจ API Key และ Secret Key' };
      }
      return { healthy: false, message: `Mailjet ตอบรหัส HTTP ${status}` };
    } catch (error) {
      return { healthy: false, message: `เชื่อมต่อ Mailjet ไม่ได้: ${error.message}` };
    }
  }

  /**
   * ส่งคำขอ POST พร้อมเนื้อหา JSON
   * @param {string} url ปลายทาง
   * @param {object} payload เนื้อคำขอ
   * @returns {Promise<{status: number, body: object|null}>}
   */
  async #post(url, payload) {
    return this.#request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  /**
   * ส่งคำขอพร้อม Basic auth และ timeout
   * @param {string} url ปลายทาง
   * @param {object} init ตัวเลือกของ fetch
   * @returns {Promise<{status: number, body: object|null}>}
   * @throws {Error} เมื่อเชื่อมต่อไม่ได้หรือหมดเวลา
   */
  async #request(url, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        headers: { ...init.headers, Authorization: `Basic ${this.#basicAuth()}` },
        signal: controller.signal,
      });
      let body = null;
      try { body = await response.json(); } catch { /* บางคำตอบไม่มีเนื้อหา JSON */ }
      return { status: response.status, body };
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Mailjet ไม่ตอบภายใน ${this.#timeoutMs / 1000} วินาที`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /** @returns {string} ส่วนหัว Basic auth ที่เข้ารหัสแล้ว */
  #basicAuth() {
    return Buffer.from(`${this.#apiKey}:${this.#secretKey}`).toString('base64');
  }

  /**
   * อธิบายข้อผิดพลาดระดับคำขอ
   * @param {number} status รหัส HTTP
   * @param {object|null} body เนื้อคำตอบ
   * @returns {string}
   */
  static #describe(status, body) {
    return body?.ErrorMessage ?? body?.Message ?? `Mailjet ตอบรหัส HTTP ${status}`;
  }

  /**
   * อธิบายข้อผิดพลาดระดับจดหมายรายฉบับ
   * @param {object|undefined} result ผลของข้อความฉบับแรก
   * @returns {string}
   */
  static #describeMessageErrors(result) {
    const errors = result?.Errors ?? [];
    if (!errors.length) return 'Mailjet ไม่ได้ระบุเหตุผลที่ส่งไม่สำเร็จ';
    return errors
      .map((error) => {
        const field = error.ErrorRelatedTo?.join(', ');
        return field ? `${error.ErrorMessage} (${field})` : error.ErrorMessage;
      })
      .join(' · ');
  }
}
