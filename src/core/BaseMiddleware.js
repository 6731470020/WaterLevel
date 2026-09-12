import { NotImplementedError } from './errors/index.js';
import { Logger } from './Logger.js';

/**
 * คลาสฐานนามธรรมของด่านตรวจ (Chain of Responsibility)
 *
 * แต่ละด่านตอบคำถามเดียวและส่งต่อให้ด่านถัดไป หรือหยุดสายด้วยข้อผิดพลาด
 * ลำดับที่ใช้จริง: `LicenseMiddleware` → `AuthMiddleware` → `PermissionMiddleware`
 * → `StationScopeMiddleware` (CLAUDE.md ข้อ 8.4)
 *
 * @abstract
 */
export class BaseMiddleware {
  /** @type {import('./Logger.js').Logger} */
  #logger;

  /**
   * @param {import('./Logger.js').Logger} [logger] ตัวบันทึกเหตุการณ์
   * @throws {NotImplementedError} เมื่อสร้างวัตถุจากคลาสนามธรรมโดยตรง
   */
  constructor(logger = Logger.getInstance()) {
    if (new.target === BaseMiddleware) {
      throw new NotImplementedError('BaseMiddleware เป็นคลาสนามธรรม สร้างวัตถุโดยตรงไม่ได้');
    }
    this.#logger = logger;
  }

  /** @returns {import('./Logger.js').Logger} ตัวบันทึกเหตุการณ์ */
  get logger() { return this.#logger; }

  /**
   * คืน handler สำหรับ Express ที่เรียก `check()` และส่งข้อผิดพลาดต่อให้ `next`
   * @param {object} [options={}] ตัวเลือกเฉพาะการเรียกครั้งนี้
   * @returns {(req: object, res: object, next: Function) => void}
   */
  handle(options = {}) {
    return (req, res, next) => {
      Promise.resolve(this.check(req, res, options))
        .then(() => { if (!res.headersSent) next(); })
        .catch(next);
    };
  }

  /**
   * ตรรกะการตรวจของด่านนี้ — โยนข้อผิดพลาดเพื่อปฏิเสธ
   * @abstract
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @param {object} options ตัวเลือก
   * @returns {Promise<void>}
   * @throws {NotImplementedError} เมื่อคลาสลูกไม่ override
   */
  async check(req, res, options) {
    throw new NotImplementedError(`${this.constructor.name} ต้อง override check()`);
  }

  /**
   * ตรวจว่าคำขอนี้คาดหวังคำตอบเป็น JSON (API) หรือหน้าเว็บ
   * @protected
   * @param {object} req วัตถุ request
   * @returns {boolean}
   */
  wantsJson(req) {
    if (req.path?.startsWith('/api/')) return true;
    if (req.xhr) return true;
    const accept = req.get?.('accept') ?? '';
    return accept.includes('application/json') && !accept.includes('text/html');
  }
}
