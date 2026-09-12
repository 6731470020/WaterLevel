import { createHash, randomBytes } from 'node:crypto';
import { UpstreamError } from '../../core/errors/index.js';

/**
 * ตัวเรียก HTTP ที่รองรับการยืนยันตัวตนแบบ Digest และ Basic
 *
 * เขียนเองด้วย `node:crypto` แทนการเพิ่มไลบรารี ตามกติกาข้อ 15 ของโปรเจกต์
 * ที่ให้พึ่งพาภายนอกน้อยที่สุด — อัลกอริทึม Digest (RFC 7616) สั้นพอจะเขียนเองได้
 * และการมีโค้ดของตัวเองทำให้ตรวจสอบได้ว่ารหัสผ่านถูกใช้อย่างไร
 *
 * ทำไมต้องมี: กล้อง Axis ใช้ Digest ไม่ใช่ Basic ส่วน `fetch` ของ Node
 * ไม่รองรับการยืนยันตัวตนอัตโนมัติเลยทั้งสองแบบ และรูปแบบ `user:pass@host`
 * ใน URL พาได้เฉพาะ Basic เท่านั้น
 */
export class DigestClient {
  /** @type {string} */
  #username;
  /** @type {string} */
  #password;
  /** @type {number} */
  #nonceCount = 0;

  /**
   * @param {{username?: string, password?: string}} [credentials={}] ชื่อผู้ใช้และรหัสผ่านของกล้อง
   */
  constructor({ username = '', password = '' } = {}) {
    this.#username = String(username ?? '');
    this.#password = String(password ?? '');
  }

  /** @returns {boolean} มีข้อมูลยืนยันตัวตนหรือไม่ */
  get hasCredentials() { return Boolean(this.#username); }

  /**
   * เรียก URL พร้อมยืนยันตัวตนอัตโนมัติเมื่อเซิร์ฟเวอร์ขอ
   *
   * ยิงครั้งแรกแบบไม่มีข้อมูลยืนยันตัวตนเสมอ (ตามที่ RFC กำหนด) แล้วอ่าน
   * `WWW-Authenticate` จากคำตอบ 401 เพื่อรู้ว่าต้องใช้วิธีไหน — จะได้ไม่ส่ง
   * รหัสผ่านออกไปโดยไม่จำเป็นถ้าปลายทางไม่ได้ขอ
   *
   * @param {string} url ปลายทาง
   * @param {{method?: string, timeoutMs?: number, signal?: AbortSignal}} [options={}] ตัวเลือก
   * @returns {Promise<Response>}
   * @throws {UpstreamError} เมื่อยืนยันตัวตนไม่ผ่านหรือเชื่อมต่อไม่ได้
   */
  async fetch(url, { method = 'GET', timeoutMs = 15000, signal = null } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // ให้ผู้เรียกยกเลิกได้ด้วย เช่นเมื่อผู้ชมปิดหน้าเว็บระหว่างดูสตรีม
    signal?.addEventListener('abort', () => controller.abort(), { once: true });

    try {
      const first = await fetch(url, { method, signal: controller.signal });
      if (first.status !== 401) return first;

      const challenge = first.headers.get('www-authenticate');
      if (!challenge || !this.hasCredentials) {
        throw new UpstreamError('camera', 'กล้องขอชื่อผู้ใช้และรหัสผ่าน แต่จุดวัดนี้ยังไม่ได้ตั้งค่าไว้');
      }

      // อ่าน body ของคำตอบแรกทิ้งเพื่อคืนการเชื่อมต่อให้ pool
      await first.body?.cancel().catch(() => {});

      const authorization = this.#buildAuthorization(challenge, method, url);
      const second = await fetch(url, {
        method,
        headers: { Authorization: authorization },
        signal: controller.signal,
      });

      if (second.status === 401) {
        throw new UpstreamError('camera', 'ชื่อผู้ใช้หรือรหัสผ่านของกล้องไม่ถูกต้อง');
      }
      return second;
    } catch (error) {
      if (error instanceof UpstreamError) throw error;
      if (error.name === 'AbortError') {
        throw new UpstreamError('camera', `กล้องไม่ตอบสนองภายใน ${timeoutMs / 1000} วินาที`);
      }
      throw new UpstreamError('camera', `เชื่อมต่อกล้องไม่ได้: ${error.message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * ประกอบส่วนหัว `Authorization` ตามวิธีที่เซิร์ฟเวอร์ขอ
   * @param {string} challenge ค่าจากส่วนหัว `WWW-Authenticate`
   * @param {string} method วิธี HTTP
   * @param {string} url ปลายทาง
   * @returns {string}
   * @throws {UpstreamError} เมื่อไม่รองรับวิธีที่ขอมา
   */
  #buildAuthorization(challenge, method, url) {
    const scheme = challenge.trim().split(/\s+/)[0].toLowerCase();

    if (scheme === 'basic') {
      const raw = Buffer.from(`${this.#username}:${this.#password}`, 'utf8');
      return `Basic ${raw.toString('base64')}`;
    }
    if (scheme !== 'digest') {
      throw new UpstreamError('camera', `กล้องขอการยืนยันตัวตนแบบ "${scheme}" ซึ่งระบบยังไม่รองรับ`);
    }

    const params = DigestClient.parseChallenge(challenge);
    const path = DigestClient.#pathOf(url);
    const cnonce = randomBytes(8).toString('hex');
    this.#nonceCount += 1;
    const nc = String(this.#nonceCount).padStart(8, '0');

    const algorithm = (params.algorithm ?? 'MD5').toUpperCase();
    let ha1 = DigestClient.#md5(`${this.#username}:${params.realm}:${this.#password}`);
    if (algorithm === 'MD5-SESS') {
      ha1 = DigestClient.#md5(`${ha1}:${params.nonce}:${cnonce}`);
    }
    const ha2 = DigestClient.#md5(`${method}:${path}`);

    // qop เป็นค่าที่คั่นด้วยจุลภาคได้ เช่น "auth,auth-int" — เรารองรับเฉพาะ auth
    const qop = (params.qop ?? '').split(',').map((item) => item.trim()).includes('auth')
      ? 'auth' : null;

    const response = qop
      ? DigestClient.#md5(`${ha1}:${params.nonce}:${nc}:${cnonce}:auth:${ha2}`)
      : DigestClient.#md5(`${ha1}:${params.nonce}:${ha2}`);

    const fields = [
      `username="${DigestClient.#escape(this.#username)}"`,
      `realm="${DigestClient.#escape(params.realm ?? '')}"`,
      `nonce="${DigestClient.#escape(params.nonce ?? '')}"`,
      `uri="${path}"`,
      `response="${response}"`,
    ];
    if (params.opaque) fields.push(`opaque="${DigestClient.#escape(params.opaque)}"`);
    if (params.algorithm) fields.push(`algorithm=${params.algorithm}`);
    if (qop) fields.push(`qop=auth`, `nc=${nc}`, `cnonce="${cnonce}"`);

    return `Digest ${fields.join(', ')}`;
  }

  /**
   * แยกพารามิเตอร์จากส่วนหัว `WWW-Authenticate`
   *
   * ค่าอาจอยู่ในเครื่องหมายคำพูดหรือไม่ก็ได้ (`algorithm=MD5` กับ `realm="AXIS"`)
   * และ realm ของกล้องอาจมีจุลภาคอยู่ข้างใน จึงต้องจับเป็นคู่คีย์-ค่าทีละคู่
   * แทนการตัดด้วยจุลภาคทั้งสตริง
   *
   * @param {string} challenge ค่าจากส่วนหัว
   * @returns {Record<string, string>}
   */
  static parseChallenge(challenge) {
    const params = {};
    const body = challenge.replace(/^\s*\w+\s+/, '');
    const pattern = /(\w+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^,\s]+))/g;

    let match = pattern.exec(body);
    while (match !== null) {
      params[match[1].toLowerCase()] = (match[2] ?? match[3] ?? '').replace(/\\(.)/g, '$1');
      match = pattern.exec(body);
    }
    return params;
  }

  /**
   * ส่วนพาธพร้อม query ของ URL — Digest คำนวณจากส่วนนี้เท่านั้น
   * @param {string} url URL เต็ม
   * @returns {string}
   */
  static #pathOf(url) {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  }

  /**
   * คำนวณ MD5
   *
   * ⚠️ MD5 อ่อนแอสำหรับงานแฮชทั่วไป แต่ที่นี่ใช้เพราะ**โพรโทคอลบังคับ** —
   * RFC 7616 กำหนดไว้และกล้องรุ่นนี้รองรับแค่นี้ ไม่ใช่ทางเลือกของเรา
   * (รหัสผ่านของผู้ใช้ระบบยังใช้ scrypt ตามเดิม)
   *
   * @param {string} value ข้อความ
   * @returns {string} ค่าแฮชเป็นเลขฐานสิบหก
   */
  static #md5(value) {
    return createHash('md5').update(value, 'utf8').digest('hex');
  }

  /**
   * หนีอักขระที่ทำให้ส่วนหัวผิดรูป
   * @param {string} value ข้อความ
   * @returns {string}
   */
  static #escape(value) {
    return String(value).replace(/["\\\r\n]/g, '');
  }
}
