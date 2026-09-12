import { BaseMiddleware } from '../core/BaseMiddleware.js';
import { LicenseExpiredError } from '../core/errors/index.js';

/** เส้นทางที่ผ่านได้เสมอแม้ใบอนุญาตหมดอายุ (CLAUDE.md ข้อ 8.5) */
const ALLOWED_PREFIXES = [
  '/login', '/logout', '/health', '/license', '/license-expired',
  '/css', '/js', '/img', '/favicon.ico', '/robots.txt',
];

/**
 * **ด่านที่ 1** — ตรวจว่าใบอนุญาตใช้งานระบบยังไม่หมดอายุ
 *
 * ตอบคำถาม: "ระบบนี้ยังได้รับอนุญาตให้ใช้งานอยู่หรือไม่?"
 * ปฏิเสธด้วย `402 LICENSE_EXPIRED` สำหรับ API และ redirect ไป `/license-expired` สำหรับหน้าเว็บ
 *
 * ต้องเป็นด่านแรกเสมอ เพราะเป็นเงื่อนไขที่ครอบทุกอย่าง — ไม่มีประโยชน์ที่จะตรวจสิทธิ์
 * ถ้าระบบทั้งระบบใช้งานไม่ได้อยู่แล้ว
 */
export class LicenseMiddleware extends BaseMiddleware {
  /** @type {import('../services/LicenseService.js').LicenseService} */
  #licenseService;

  /**
   * @param {import('../services/LicenseService.js').LicenseService} licenseService บริการใบอนุญาต
   * @param {import('../core/Logger.js').Logger} [logger] ตัวบันทึกเหตุการณ์
   */
  constructor(licenseService, logger) {
    super(logger);
    this.#licenseService = licenseService;
  }

  /**
   * ตรวจสถานะใบอนุญาต
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   * @throws {LicenseExpiredError} เมื่อใบอนุญาตหมดอายุและคำขอเป็น API
   */
  async check(req, res) {
    if (LicenseMiddleware.isAllowed(req.path)) return;

    const { valid, license } = await this.#licenseService.check();
    if (valid) {
      res.locals.license = license;
      return;
    }

    this.logger.warn('request blocked — license expired', { path: req.path });

    if (this.wantsJson(req)) {
      throw new LicenseExpiredError();
    }
    res.redirect('/license-expired');
  }

  /**
   * ตรวจว่าพาธนี้อยู่ในรายการที่ผ่านได้เสมอ
   * @param {string} path พาธของคำขอ
   * @returns {boolean}
   */
  static isAllowed(path) {
    return ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  }
}
