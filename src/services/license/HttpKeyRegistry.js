import { KeyRegistry } from './KeyRegistry.js';
import { KeyInfo } from './KeyInfo.js';
import { UpstreamError, ValidationError } from '../../core/errors/index.js';
import { Logger } from '../../core/Logger.js';

/**
 * ถามสถานะคีย์จากบริการตรวจจับจริงผ่าน `GET {WATER_API_URL}/key-info`
 *
 * ใช้คีย์ตัวเดียวกับที่ `HttpDetectionService` ใช้เรียก `/detect-with-zones` —
 * เพราะฝั่งผู้ให้บริการมีคีย์ชุดเดียว (`api_keys` ใน `apikeys.db`) ที่คุมทั้ง
 * สิทธิ์เรียกใช้และวันหมดอายุ ระบบนี้จึงไม่ต้องมีรหัสใบอนุญาตแยกอีกชุด
 *
 * **การแยกแยะความล้มเหลวคือหัวใจของคลาสนี้:**
 * - คีย์หมดอายุ / ถูกยกเลิก → ยัง "ถามสำเร็จ" คืน `KeyInfo` ที่ `isUsable = false`
 *   ให้ระบบปิดตัวเองตามจริง
 * - เครือข่ายล่ม / บริการไม่ตอบ → โยน `UpstreamError` เพื่อให้ผู้เรียก
 *   **คงใบอนุญาตเดิมไว้** ห้ามตีความว่าหมดอายุเด็ดขาด มิฉะนั้นอินเทอร์เน็ตหลุด
 *   ชั่วคราวจะทำให้ทั้งระบบถูกกั้นทันที
 */
export class HttpKeyRegistry extends KeyRegistry {
  /** @type {string} */
  #apiUrl;
  /** @type {string} */
  #apiKey;
  /** @type {number} */
  #timeoutMs;
  /** @type {import('../../core/Logger.js').Logger} */
  #logger;

  /**
   * @param {{apiUrl: string, apiKey: string, timeoutMs?: number}} options ค่าตั้งค่า
   * @param {import('../../core/Logger.js').Logger} [logger] ตัวบันทึกเหตุการณ์
   * @throws {ValidationError} เมื่อไม่ได้ตั้งค่า `WATER_API_URL` หรือ `WATER_API_KEY`
   */
  constructor({ apiUrl, apiKey, timeoutMs = 15000 }, logger = Logger.getInstance()) {
    super();
    if (!apiUrl) {
      throw new ValidationError('ต้องตั้งค่า URL บริการตรวจจับก่อนจึงจะตรวจสถานะคีย์ได้');
    }
    if (!apiKey) {
      throw new ValidationError('ต้องตั้งค่า API Key บริการตรวจจับก่อนจึงจะตรวจสถานะคีย์ได้');
    }
    this.#apiUrl = String(apiUrl).replace(/\/+$/, '');
    this.#apiKey = String(apiKey);
    this.#timeoutMs = Number(timeoutMs);
    this.#logger = logger;
  }

  /** @returns {string} ชื่อไดรเวอร์ */
  get driver() { return 'remote'; }

  /**
   * ถามสถานะคีย์ของระบบนี้
   * @returns {Promise<KeyInfo>} สถานะคีย์ (รวมกรณีหมดอายุและถูกยกเลิก)
   * @throws {UpstreamError} เมื่อติดต่อบริการไม่ได้ หรือบริการไม่รู้จักคีย์นี้
   */
  async fetchKeyInfo() {
    const { status, body } = await this.#get('/key-info');

    if (status === 200) {
      const info = KeyInfo.fromApiResponse(body);
      this.#logger.info('key registry checked', {
        owner: info.ownerName, status: info.status, daysRemaining: info.daysRemaining,
      });
      return info;
    }

    // 403 พร้อมเหตุผลที่ระบุตัวคีย์ได้ = ถามสำเร็จ แต่คีย์ใช้ไม่ได้แล้ว
    const known = HttpKeyRegistry.#fromRejection(status, body);
    if (known) {
      this.#logger.warn('key registry rejected our key', { status: known.status });
      return known;
    }

    throw new UpstreamError('key-registry', HttpKeyRegistry.#describe(status, body));
  }

  /**
   * แปลงคำตอบที่ถูกปฏิเสธให้เป็น `KeyInfo` เมื่อบริการยืนยันว่ารู้จักคีย์นี้
   *
   * `require_api_key()` ใน `app.py:1445` ตอบ 403 สามแบบ — สองแบบแรกแนบ `owner`
   * มาด้วย ซึ่งแปลว่าคีย์มีอยู่จริงในทะเบียนแต่ใช้ไม่ได้ ส่วน "Invalid API Key"
   * ไม่แนบอะไรมาเลย เพราะหาไม่เจอ (ตั้งค่าผิด — ไม่ใช่ใบอนุญาตหมดอายุ)
   *
   * @param {number} status รหัส HTTP
   * @param {object|null} body เนื้อคำตอบ
   * @returns {KeyInfo|null}
   */
  static #fromRejection(status, body) {
    if (status !== 403 || !body?.owner) return null;

    const expired = String(body.error ?? '').toLowerCase().includes('expired');
    return new KeyInfo({
      ownerName: body.owner,
      expiresAt: body.expires_at ? new Date(String(body.expires_at).replace(' ', 'T')) : null,
      daysRemaining: 0,
      // หมดอายุ = คีย์ยังเปิดอยู่แต่เลยกำหนดแล้ว · ถูกยกเลิก = ผู้ให้บริการปิดคีย์
      isActive: expired,
      isExpired: expired,
      status: expired ? 'expired' : 'revoked',
    });
  }

  /**
   * ส่งคำขอ GET พร้อม timeout
   * @param {string} path พาธปลายทาง
   * @returns {Promise<{status: number, body: object|null}>}
   * @throws {UpstreamError} เมื่อเชื่อมต่อไม่ได้หรือหมดเวลา
   */
  async #get(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await fetch(`${this.#apiUrl}${path}`, {
        method: 'GET',
        headers: { Accept: 'application/json', 'X-API-Key': this.#apiKey },
        signal: controller.signal,
      });
      let body = null;
      try {
        body = await response.json();
      } catch {
        // บริการอาจตอบ HTML (เช่น หน้า 502 ของ reverse proxy) — ปล่อยเป็น null
      }
      return { status: response.status, body };
    } catch (error) {
      const reason = error.name === 'AbortError'
        ? `ไม่ตอบภายใน ${this.#timeoutMs / 1000} วินาที`
        : error.message;
      throw new UpstreamError('key-registry', `ติดต่อทะเบียนคีย์ไม่ได้: ${reason}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * ข้อความอธิบายคำตอบที่ใช้ไม่ได้
   * @param {number} status รหัส HTTP
   * @param {object|null} body เนื้อคำตอบ
   * @returns {string}
   */
  static #describe(status, body) {
    if (status === 401) {
      return 'บริการแจ้งว่าไม่ได้ส่ง API Key มาด้วย — ตรวจค่า API Key ในหน้าตั้งค่า';
    }
    if (status === 403) {
      return 'บริการไม่รู้จัก API Key นี้ — ตรวจว่าคัดลอกคีย์มาครบถ้วน';
    }
    return body?.message ?? body?.error ?? `ทะเบียนคีย์ตอบรหัส HTTP ${status}`;
  }
}
