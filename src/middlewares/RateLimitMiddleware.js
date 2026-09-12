import rateLimit from 'express-rate-limit';
import { RateLimitedError } from '../core/errors/index.js';

/**
 * ตัวสร้างด่านจำกัดอัตราคำขอ
 *
 * ไม่สืบทอด `BaseMiddleware` เพราะห่อไลบรารีภายนอกที่มีสัญญาเป็น factory
 * ทุกตัวโยน `RateLimitedError` เพื่อให้ `ErrorMiddleware` จัดรูปแบบคำตอบให้เหมือนกัน
 */
export class RateLimitMiddleware {
  /**
   * ด่านสำหรับหน้าสาธารณะ — 60 คำขอ/นาที/IP (CLAUDE.md ข้อ 9.1)
   * @returns {Function} middleware ของ Express
   */
  static publicPages() {
    return RateLimitMiddleware.#build({
      windowMs: 60 * 1000,
      limit: 60,
      message: 'คุณเปิดหน้าเว็บถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
    });
  }

  /**
   * ด่านสำหรับหน้าเข้าสู่ระบบ — 10 ครั้ง/5 นาที ต่อ IP **และต่อชื่อผู้ใช้**
   *
   * การรวมชื่อผู้ใช้เข้าไปในคีย์ทำให้ผู้โจมตีที่มีหลาย IP ยังยิงบัญชีเดียวรัว ๆ ไม่ได้
   * (CLAUDE.md ข้อ 8.1)
   *
   * @returns {Function} middleware ของ Express
   */
  static login() {
    return RateLimitMiddleware.#build({
      windowMs: 5 * 60 * 1000,
      limit: 10,
      message: 'พยายามเข้าสู่ระบบถี่เกินไป กรุณารอ 5 นาทีแล้วลองใหม่',
      keyGenerator: (req) => {
        const ip = req.ip ?? 'unknown';
        const login = String(req.body?.username ?? req.body?.login ?? '').toLowerCase().slice(0, 100);
        return `${ip}|${login}`;
      },
    });
  }

  /**
   * ด่านสำหรับ API ของผู้ดูแล — 300 คำขอ/นาที
   * @returns {Function} middleware ของ Express
   */
  static api() {
    return RateLimitMiddleware.#build({
      windowMs: 60 * 1000,
      limit: 300,
      message: 'คำขอถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
    });
  }

  /**
   * ด่านสำหรับคำสั่งที่ใช้ทรัพยากรมาก เช่น สั่งจับภาพหรือส่งข้อความ — 20 ครั้ง/5 นาที
   * @returns {Function} middleware ของ Express
   */
  static heavyAction() {
    return RateLimitMiddleware.#build({
      windowMs: 5 * 60 * 1000,
      limit: 20,
      message: 'สั่งงานถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
    });
  }

  /**
   * ด่านสำหรับหน้าลืมรหัสผ่าน — 5 ครั้ง/15 นาที
   * @returns {Function} middleware ของ Express
   */
  static passwordReset() {
    return RateLimitMiddleware.#build({
      windowMs: 15 * 60 * 1000,
      limit: 5,
      message: 'ขอตั้งรหัสผ่านใหม่ถี่เกินไป กรุณารอ 15 นาทีแล้วลองใหม่',
    });
  }

  /**
   * ด่านสำหรับ webhook — 600 คำขอ/นาที (LINE ส่งเป็นชุดได้)
   * @returns {Function} middleware ของ Express
   */
  static webhook() {
    return RateLimitMiddleware.#build({
      windowMs: 60 * 1000,
      limit: 600,
      message: 'คำขอถี่เกินไป',
    });
  }

  /**
   * ประกอบด่านจากค่าตั้งค่า
   * @param {{windowMs: number, limit: number, message: string, keyGenerator?: Function}} options ค่าตั้งค่า
   * @returns {Function} middleware ของ Express
   */
  static #build({ windowMs, limit, message, keyGenerator }) {
    return rateLimit({
      windowMs,
      limit,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      ...(keyGenerator ? { keyGenerator } : {}),
      handler: (req, res, next) => { next(new RateLimitedError(message)); },
    });
  }
}
