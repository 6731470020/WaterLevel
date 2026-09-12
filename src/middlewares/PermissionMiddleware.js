import { BaseMiddleware } from '../core/BaseMiddleware.js';
import { ForbiddenError, UnauthorizedError } from '../core/errors/index.js';

/**
 * **ด่านที่ 3** — ตรวจว่าผู้ใช้มีสิทธิ์ที่เส้นทางนี้ต้องการ
 *
 * ตอบคำถาม: "คนคนนี้ได้รับอนุญาตให้ทำสิ่งนี้หรือไม่?"
 * ปฏิเสธด้วย `403 FORBIDDEN`
 *
 * ผู้ดูแลสูงสุด (`is_super_admin = 1`) ผ่านด่านนี้เสมอ แต่ยังถูกบันทึกใน audit log
 */
export class PermissionMiddleware extends BaseMiddleware {
  /** @type {import('../services/PermissionService.js').PermissionService} */
  #permissionService;

  /**
   * @param {import('../services/PermissionService.js').PermissionService} permissionService บริการสิทธิ์
   * @param {import('../core/Logger.js').Logger} [logger] ตัวบันทึกเหตุการณ์
   */
  constructor(permissionService, logger) {
    super(logger);
    this.#permissionService = permissionService;
  }

  /**
   * คืน handler ที่บังคับสิทธิ์เดียว
   * @param {string} permissionKey คีย์สิทธิ์ เช่น `roi.write`
   * @returns {(req: object, res: object, next: Function) => void}
   */
  require(permissionKey) {
    return this.handle({ permissionKeys: [permissionKey], mode: 'all' });
  }

  /**
   * คืน handler ที่ผ่านเมื่อมีสิทธิ์ข้อใดข้อหนึ่ง
   * @param {Array<string>} permissionKeys รายการคีย์สิทธิ์
   * @returns {(req: object, res: object, next: Function) => void}
   */
  requireAny(permissionKeys) {
    return this.handle({ permissionKeys, mode: 'any' });
  }

  /**
   * คืน handler ที่ผ่านเฉพาะผู้ดูแลสูงสุด
   * @returns {(req: object, res: object, next: Function) => void}
   */
  requireSuperAdmin() {
    return this.handle({ superAdminOnly: true });
  }

  /**
   * ตรวจสิทธิ์ตามตัวเลือกที่กำหนด
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @param {{permissionKeys?: Array<string>, mode?: string, superAdminOnly?: boolean}} options ตัวเลือก
   * @returns {Promise<void>}
   * @throws {UnauthorizedError} เมื่อยังไม่ผ่านด่านยืนยันตัวตน
   * @throws {ForbiddenError} เมื่อไม่มีสิทธิ์
   */
  async check(req, res, options) {
    const user = req.user;
    if (!user) throw new UnauthorizedError();

    if (options.superAdminOnly) {
      if (!user.isSuperAdmin) {
        this.#deny(req, user, ['is_super_admin']);
      }
      return;
    }

    const keys = options.permissionKeys ?? [];
    const granted = options.mode === 'any'
      ? user.canAny(keys)
      : keys.every((key) => user.can(key));

    if (!granted) this.#deny(req, user, keys);
  }

  /**
   * บันทึกและโยนข้อผิดพลาดเมื่อไม่มีสิทธิ์
   * @param {object} req วัตถุ request
   * @param {import('../models/User.js').User} user ผู้ใช้
   * @param {Array<string>} keys คีย์สิทธิ์ที่ต้องการ
   * @returns {never}
   * @throws {ForbiddenError} เสมอ
   */
  #deny(req, user, keys) {
    this.logger.warn('permission denied', {
      userId: user.id, path: req.path, method: req.method, required: keys,
    });
    throw new ForbiddenError('คุณไม่มีสิทธิ์ใช้งานส่วนนี้');
  }
}
