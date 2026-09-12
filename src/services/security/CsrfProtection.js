import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { ForbiddenError } from '../../core/errors/index.js';

/** เมท็อด HTTP ที่ไม่เปลี่ยนแปลงข้อมูล จึงไม่ต้องตรวจ CSRF */
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/**
 * ป้องกันการปลอมคำขอข้ามเว็บไซต์ (CSRF)
 *
 * สร้าง token หนึ่งตัวต่อ session เก็บใน session แล้วฝังลงฟอร์มทุกอัน
 * คำขอที่เปลี่ยนข้อมูลต้องส่ง token กลับมาทาง field `_csrf` หรือส่วนหัว `X-CSRF-Token`
 *
 * ระบบเดิมไม่มีการป้องกันนี้เลย และยังเปิด CORS `*` บน endpoint ที่เขียนข้อมูลได้
 * (CLAUDE.md ข้อ 2.1 ข้อบกพร่องที่ 3)
 */
export class CsrfProtection {
  /**
   * คืน token ของ session ปัจจุบัน สร้างใหม่หากยังไม่มี
   * @param {object} req วัตถุ request
   * @returns {string} token
   */
  tokenFor(req) {
    if (!req.session) return '';
    if (!req.session.csrfToken) {
      req.session.csrfToken = randomBytes(32).toString('hex');
    }
    return req.session.csrfToken;
  }

  /**
   * ตรวจว่าคำขอนี้แนบ token ที่ถูกต้องมาหรือไม่
   * @param {object} req วัตถุ request
   * @returns {boolean}
   */
  isValid(req) {
    if (SAFE_METHODS.includes(req.method)) return true;
    const expected = req.session?.csrfToken;
    if (!expected) return false;
    const received = req.body?._csrf
      ?? req.get?.('x-csrf-token')
      ?? req.get?.('x-xsrf-token');
    if (!received) return false;
    // แฮชก่อนเปรียบเทียบเพื่อให้ความยาวเท่ากันเสมอ ป้องกันการรั่วผ่านเวลาที่ใช้
    const a = createHash('sha256').update(String(expected)).digest();
    const b = createHash('sha256').update(String(received)).digest();
    return timingSafeEqual(a, b);
  }

  /**
   * ตรวจและโยนข้อผิดพลาดเมื่อไม่ผ่าน
   * @param {object} req วัตถุ request
   * @returns {void}
   * @throws {ForbiddenError} เมื่อ token ไม่ถูกต้องหรือขาดหาย
   */
  assert(req) {
    if (!this.isValid(req)) {
      throw new ForbiddenError('คำขอไม่ถูกต้อง (CSRF) กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง');
    }
  }

  /**
   * สร้าง token ใหม่ — เรียกหลังเข้าสู่ระบบหรือออกจากระบบ
   * @param {object} req วัตถุ request
   * @returns {string} token ใหม่
   */
  rotate(req) {
    if (!req.session) return '';
    req.session.csrfToken = randomBytes(32).toString('hex');
    return req.session.csrfToken;
  }
}
