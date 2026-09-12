import { BaseMiddleware } from '../core/BaseMiddleware.js';

/** เส้นทางที่ยกเว้นการตรวจ CSRF */
const EXEMPT_PREFIXES = ['/webhooks/'];

/**
 * ตรวจ token กัน CSRF ในทุกคำขอที่เปลี่ยนแปลงข้อมูล
 *
 * ยกเว้น `/webhooks/` เพราะเป็นคำขอจากเซิร์ฟเวอร์ภายนอกที่ไม่มี session
 * และมีการยืนยันตัวตนด้วยลายเซ็น HMAC แทนอยู่แล้ว (`SignatureVerifier`)
 *
 * เติม `res.locals.csrfToken` ให้ทุกคำขอ เพื่อให้ view ฝังลงฟอร์มได้เสมอ
 */
export class CsrfMiddleware extends BaseMiddleware {
  /** @type {import('../services/security/CsrfProtection.js').CsrfProtection} */
  #csrf;

  /**
   * @param {import('../services/security/CsrfProtection.js').CsrfProtection} csrf ตัวป้องกัน CSRF
   * @param {import('../core/Logger.js').Logger} [logger] ตัวบันทึกเหตุการณ์
   */
  constructor(csrf, logger) {
    super(logger);
    this.#csrf = csrf;
  }

  /**
   * ตรวจ token และเติม `res.locals.csrfToken`
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   * @throws {import('../core/errors/ForbiddenError.js').ForbiddenError} เมื่อ token ไม่ถูกต้อง
   */
  async check(req, res) {
    res.locals.csrfToken = this.#csrf.tokenFor(req);
    if (EXEMPT_PREFIXES.some((prefix) => req.path.startsWith(prefix))) return;
    this.#csrf.assert(req);
  }
}
