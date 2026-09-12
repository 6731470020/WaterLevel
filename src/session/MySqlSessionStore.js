import session from 'express-session';
import { Logger } from '../core/Logger.js';

/**
 * ที่เก็บ session ในตาราง `sessions` ของ MySQL
 *
 * สืบทอดจาก `session.Store` ของ `express-session` — เป็นตัวอย่างการสืบทอด
 * จากคลาสของไลบรารีภายนอก ทำให้ระบบ**ไม่ต้องพึ่ง Redis** ตามข้อกำหนด
 *
 * นอกจากเก็บข้อมูล session แล้วยังแยกคอลัมน์ `user_id`, `ip` และ `user_agent` ออกมา
 * เพื่อให้หน้า `/account/sessions` แสดงรายการอุปกรณ์ได้ และล้าง session ของผู้ใช้
 * คนใดคนหนึ่งได้ทันทีเมื่อสิทธิ์เปลี่ยน
 */
export class MySqlSessionStore extends session.Store {
  /** @type {import('../repositories/SessionRepository.js').SessionRepository} */
  #sessionRepository;
  /** @type {number} */
  #cleanupTimer = null;
  /** @type {Logger} */
  #logger;

  /**
   * @param {import('../repositories/SessionRepository.js').SessionRepository} sessionRepository ที่เก็บ session
   * @param {{cleanupIntervalMs?: number}} [options={}] ตัวเลือก
   * @param {Logger} [logger] ตัวบันทึกเหตุการณ์
   */
  constructor(sessionRepository, { cleanupIntervalMs = 15 * 60 * 1000 } = {}, logger = Logger.getInstance()) {
    super();
    this.#sessionRepository = sessionRepository;
    this.#logger = logger;
    if (cleanupIntervalMs > 0) {
      this.#cleanupTimer = setInterval(() => { this.cleanup(); }, cleanupIntervalMs);
      this.#cleanupTimer.unref?.();
    }
  }

  /**
   * อ่าน session จากฐานข้อมูล
   * @param {string} sid รหัส session
   * @param {(error: Error|null, session?: object|null) => void} callback ฟังก์ชันเรียกกลับ
   * @returns {void}
   */
  get(sid, callback) {
    this.#sessionRepository.read(sid)
      .then((row) => {
        if (!row) { callback(null, null); return; }
        try {
          callback(null, JSON.parse(row.data));
        } catch {
          // ข้อมูล session เสียหาย — ถือว่าไม่มี session ดีกว่าทำให้คำขอพัง
          callback(null, null);
        }
      })
      .catch((error) => callback(error));
  }

  /**
   * เขียน session ลงฐานข้อมูล
   * @param {string} sid รหัส session
   * @param {object} sessionData ข้อมูล session
   * @param {(error?: Error|null) => void} callback ฟังก์ชันเรียกกลับ
   * @returns {void}
   */
  set(sid, sessionData, callback) {
    this.#sessionRepository.write(sid, {
      data: JSON.stringify(sessionData),
      userId: sessionData.userId ?? null,
      ip: sessionData.ip ?? null,
      userAgent: sessionData.userAgent ?? null,
      expiresAt: MySqlSessionStore.#expiryOf(sessionData),
    })
      .then(() => callback(null))
      .catch((error) => {
        this.#logger.error('failed to write session', { message: error.message });
        callback(error);
      });
  }

  /**
   * เลื่อนเวลาหมดอายุเมื่อผู้ใช้มีกิจกรรม (rolling session)
   * @param {string} sid รหัส session
   * @param {object} sessionData ข้อมูล session
   * @param {(error?: Error|null) => void} callback ฟังก์ชันเรียกกลับ
   * @returns {void}
   */
  touch(sid, sessionData, callback) {
    this.#sessionRepository.touch(sid, MySqlSessionStore.#expiryOf(sessionData))
      .then(() => callback(null))
      .catch((error) => callback(error));
  }

  /**
   * ลบ session
   * @param {string} sid รหัส session
   * @param {(error?: Error|null) => void} callback ฟังก์ชันเรียกกลับ
   * @returns {void}
   */
  destroy(sid, callback) {
    this.#sessionRepository.destroy(sid)
      .then(() => callback(null))
      .catch((error) => callback(error));
  }

  /**
   * ลบ session ที่หมดอายุแล้ว
   * @returns {Promise<number>} จำนวนแถวที่ลบ
   */
  async cleanup() {
    try {
      const removed = await this.#sessionRepository.purgeExpired();
      if (removed) this.#logger.debug('expired sessions purged', { removed });
      return removed;
    } catch (error) {
      this.#logger.warn('session cleanup failed', { message: error.message });
      return 0;
    }
  }

  /** หยุดตัวจับเวลาล้าง session (ใช้ตอนปิดแอป) */
  close() {
    if (this.#cleanupTimer) clearInterval(this.#cleanupTimer);
    this.#cleanupTimer = null;
  }

  /**
   * คำนวณเวลาหมดอายุจากคุกกี้ของ session
   * @param {object} sessionData ข้อมูล session
   * @returns {Date}
   */
  static #expiryOf(sessionData) {
    const expires = sessionData?.cookie?.expires;
    if (expires) return new Date(expires);
    const maxAge = sessionData?.cookie?.maxAge ?? 8 * 3600 * 1000;
    return new Date(Date.now() + Number(maxAge));
  }
}
