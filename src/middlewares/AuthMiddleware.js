import { BaseMiddleware } from '../core/BaseMiddleware.js';
import { UnauthorizedError, ForbiddenError } from '../core/errors/index.js';

/**
 * **ด่านที่ 2** — ตรวจว่ามี session ที่ใช้ได้และบัญชียัง ACTIVE
 *
 * ตอบคำถาม: "คนที่ส่งคำขอมานี้คือใคร และยังเข้าสู่ระบบอยู่หรือไม่?"
 * ปฏิเสธด้วย `401 UNAUTHORIZED` สำหรับ API และ redirect ไป `/login` สำหรับหน้าเว็บ
 *
 * **โหลดผู้ใช้จากฐานข้อมูลใหม่ทุกคำขอ** ไม่ใช้ข้อมูลที่แคชไว้ใน session
 * เพื่อให้การเปลี่ยนสิทธิ์ ระงับบัญชี หรือลบบัญชี มีผลทันที
 */
export class AuthMiddleware extends BaseMiddleware {
  /** @type {import('../services/AuthService.js').AuthService} */
  #authService;

  /**
   * @param {import('../services/AuthService.js').AuthService} authService บริการยืนยันตัวตน
   * @param {import('../core/Logger.js').Logger} [logger] ตัวบันทึกเหตุการณ์
   */
  constructor(authService, logger) {
    super(logger);
    this.#authService = authService;
  }

  /**
   * ตรวจ session และโหลดผู้ใช้
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @param {{optional?: boolean, allowPasswordChange?: boolean}} [options={}] ตัวเลือก
   * @returns {Promise<void>}
   * @throws {UnauthorizedError} เมื่อไม่มี session ที่ใช้ได้
   * @throws {ForbiddenError} เมื่อบัญชีถูกระงับ
   */
  async check(req, res, options = {}) {
    const userId = req.session?.userId ?? null;

    if (!userId) {
      if (options.optional) return;
      if (this.wantsJson(req)) throw new UnauthorizedError();
      const target = encodeURIComponent(req.originalUrl ?? '/admin');
      res.redirect(`/login?next=${target}`);
      return;
    }

    const user = await this.#authService.loadUser(userId);

    if (!user) {
      req.session.destroy?.(() => {});
      if (options.optional) return;
      if (this.wantsJson(req)) throw new UnauthorizedError('บัญชีนี้ไม่มีอยู่ในระบบแล้ว');
      res.redirect('/login');
      return;
    }

    if (!user.isActive) {
      req.session.destroy?.(() => {});
      throw new ForbiddenError('บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
    }

    req.user = user;
    res.locals.currentUser = user;

    // บังคับเปลี่ยนรหัสผ่านก่อนใช้งานส่วนอื่น (ผู้ใช้ที่ย้ายมาจากระบบเดิม)
    if (user.mustChangePassword && !options.allowPasswordChange
        && !AuthMiddleware.#isPasswordRoute(req.path)) {
      if (this.wantsJson(req)) {
        throw new ForbiddenError('กรุณาเปลี่ยนรหัสผ่านก่อนใช้งานระบบ');
      }
      res.redirect('/change-password?required=1');
    }
  }

  /**
   * ด่านแบบไม่บังคับ — เติม `req.user` ถ้ามี session แต่ไม่ปฏิเสธเมื่อไม่มี
   *
   * ใช้กับหน้าสาธารณะเพื่อแสดงเมนูผู้ดูแลให้ผู้ที่เข้าสู่ระบบอยู่แล้ว
   *
   * @returns {(req: object, res: object, next: Function) => void}
   */
  optional() {
    return this.handle({ optional: true });
  }

  /**
   * ตรวจว่าเป็นเส้นทางที่เกี่ยวกับการเปลี่ยนรหัสผ่านหรือออกจากระบบ
   * @param {string} path พาธของคำขอ
   * @returns {boolean}
   */
  static #isPasswordRoute(path) {
    return path.startsWith('/change-password') || path.startsWith('/logout');
  }
}
