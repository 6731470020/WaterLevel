import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * ตรวจลายเซ็น `X-Line-Signature` ของ LINE Messaging API
 *
 * LINE เซ็นเนื้อคำขอด้วย HMAC-SHA256 โดยใช้ Channel Secret แล้วเข้ารหัส base64
 * การเปรียบเทียบต้องเป็นแบบ timing-safe เพื่อไม่ให้ผู้โจมตีเดาลายเซ็นทีละไบต์ได้
 *
 * ⚠️ ต้องใช้ **raw body** ที่ยังไม่ผ่าน `JSON.parse` — ไม่เช่นนั้นลายเซ็นจะไม่ตรง
 * `Application` จึงตั้ง `express.json({ verify })` เก็บ raw body ไว้ที่ `req.rawBody`
 */
export class SignatureVerifier {
  /** @type {string|null} */
  #secret;

  /** @param {string|null} secret Channel Secret จาก `.env` */
  constructor(secret) {
    this.#secret = secret || null;
  }

  /** @returns {boolean} ตั้งค่า secret ไว้แล้วหรือยัง */
  get isConfigured() { return Boolean(this.#secret); }

  /**
   * ตรวจลายเซ็นของคำขอ
   * @param {Buffer|string} rawBody เนื้อคำขอดิบ
   * @param {string|undefined} signature ค่าจากส่วนหัว `X-Line-Signature`
   * @returns {boolean} true เมื่อลายเซ็นถูกต้อง
   */
  verify(rawBody, signature) {
    if (!this.#secret || !signature || rawBody === undefined || rawBody === null) return false;
    try {
      const expected = createHmac('sha256', this.#secret)
        .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8'))
        .digest();
      const received = Buffer.from(String(signature), 'base64');
      return expected.length === received.length && timingSafeEqual(expected, received);
    } catch {
      return false;
    }
  }

  /**
   * สร้างลายเซ็นจากเนื้อคำขอ — ใช้ในชุดทดสอบเพื่อจำลองคำขอจาก LINE
   * @param {Buffer|string} rawBody เนื้อคำขอ
   * @returns {string|null} ลายเซ็น base64 หรือ null เมื่อยังไม่ตั้งค่า secret
   */
  sign(rawBody) {
    if (!this.#secret) return null;
    return createHmac('sha256', this.#secret)
      .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8'))
      .digest('base64');
  }
}
