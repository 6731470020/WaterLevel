import { BaseController } from '../core/BaseController.js';
import { Validator } from '../core/Validator.js';
import { AppError, ValidationError } from '../core/errors/index.js';

/**
 * ควบคุมการเข้าสู่ระบบ ออกจากระบบ และการจัดการรหัสผ่าน
 *
 * เป็นชั้นบาง ๆ ที่แปลงคำขอ HTTP เป็นการเรียก `AuthService` แล้วแปลงผลกลับเป็นหน้าเว็บ
 * ตรรกะความปลอดภัยทั้งหมดอยู่ในชั้น Service
 */
export class AuthController extends BaseController {
  /** @type {import('../services/AuthService.js').AuthService} */
  #authService;
  /** @type {import('../services/MailService.js').MailService} */
  #mailService;
  /** @type {import('../services/security/CsrfProtection.js').CsrfProtection} */
  #csrf;
  /** @type {string} */
  #baseUrl;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../services/AuthService.js').AuthService} deps.authService บริการยืนยันตัวตน
   * @param {import('../services/MailService.js').MailService} deps.mailService บริการอีเมล
   * @param {import('../services/security/CsrfProtection.js').CsrfProtection} deps.csrf ตัวป้องกัน CSRF
   * @param {string} deps.baseUrl URL ฐานของระบบ
   * @param {import('../core/Logger.js').Logger} [deps.logger] ตัวบันทึกเหตุการณ์
   */
  constructor({ authService, mailService, csrf, baseUrl, logger }) {
    super(authService, logger);
    this.#authService = authService;
    this.#mailService = mailService;
    this.#csrf = csrf;
    this.#baseUrl = String(baseUrl ?? '').replace(/\/+$/, '');
  }

  /**
   * แสดงหน้าเข้าสู่ระบบ
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async showLogin(req, res) {
    if (req.session?.userId) {
      res.redirect('/admin');
      return;
    }
    res.render('auth/login', {
      title: 'เข้าสู่ระบบ',
      next: AuthController.#safeNext(req.query.next),
      error: null,
      username: '',
    });
  }

  /**
   * ประมวลผลการเข้าสู่ระบบ
   *
   * สร้าง session id ใหม่หลังเข้าสู่ระบบสำเร็จเพื่อกัน session fixation (CLAUDE.md ข้อ 8.1)
   *
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async login(req, res) {
    const next = AuthController.#safeNext(req.body.next);
    const username = String(req.body.username ?? '').trim();

    try {
      const user = await this.#authService.login(username, req.body.password, {
        ip: this.clientIp(req),
        userAgent: req.get('user-agent'),
      });

      await AuthController.#regenerateSession(req);

      req.session.userId = user.id;
      req.session.ip = this.clientIp(req);
      req.session.userAgent = req.get('user-agent')?.slice(0, 255) ?? null;
      this.#csrf.rotate(req);
      await AuthController.#saveSession(req);

      if (user.mustChangePassword) {
        res.redirect('/change-password?required=1');
        return;
      }
      res.redirect(next);
    } catch (error) {
      if (!(error instanceof AppError) || error.statusCode >= 500) throw error;
      res.status(error.statusCode).render('auth/login', {
        title: 'เข้าสู่ระบบ',
        next,
        error: error.message,
        username,
      });
    }
  }

  /**
   * ออกจากระบบ (อุปกรณ์นี้เท่านั้น)
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async logout(req, res) {
    await new Promise((resolve) => { req.session.destroy(resolve); });
    res.clearCookie('wl.sid');
    res.redirect('/login');
  }

  /**
   * ออกจากระบบทุกอุปกรณ์
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async logoutAll(req, res) {
    await this.#authService.logoutEverywhere(req.user.id);
    await new Promise((resolve) => { req.session.destroy(resolve); });
    res.clearCookie('wl.sid');
    res.redirect('/login?logout=all');
  }

  /**
   * แสดงหน้าเปลี่ยนรหัสผ่าน
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async showChangePassword(req, res) {
    res.render('auth/changePassword', {
      title: 'เปลี่ยนรหัสผ่าน',
      required: req.query.required === '1' || req.user.mustChangePassword,
      policy: this.#authService.policy.description,
      error: null,
      success: null,
    });
  }

  /**
   * ประมวลผลการเปลี่ยนรหัสผ่าน
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async changePassword(req, res) {
    const render = (error, success) => res.render('auth/changePassword', {
      title: 'เปลี่ยนรหัสผ่าน',
      required: req.user.mustChangePassword,
      policy: this.#authService.policy.description,
      error,
      success,
    });

    try {
      const data = new Validator(req.body)
        .required('currentPassword', 'รหัสผ่านเดิม')
        .required('newPassword', 'รหัสผ่านใหม่')
        .required('confirmPassword', 'ยืนยันรหัสผ่านใหม่')
        .validate();

      if (req.body.newPassword !== req.body.confirmPassword) {
        throw new ValidationError('รหัสผ่านใหม่และการยืนยันไม่ตรงกัน');
      }

      await this.#authService.changePassword(
        req.user.id, req.body.currentPassword, req.body.newPassword,
        {
          ip: this.clientIp(req),
          userAgent: req.get('user-agent'),
          keepSessionId: req.sessionID,
        },
      );
      render(null, 'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว อุปกรณ์อื่นถูกออกจากระบบทั้งหมด');
    } catch (error) {
      if (!(error instanceof AppError) || error.statusCode >= 500) throw error;
      const detail = error.details?.map((item) => item.message).join(' · ');
      res.status(error.statusCode);
      render(detail || error.message, null);
    }
  }

  /**
   * แสดงหน้าลืมรหัสผ่าน
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async showForgotPassword(req, res) {
    res.render('auth/forgotPassword', { title: 'ลืมรหัสผ่าน', sent: false, error: null });
  }

  /**
   * ประมวลผลคำขอลืมรหัสผ่าน — **ตอบสำเร็จเสมอ** ไม่ว่าอีเมลจะมีในระบบหรือไม่
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async forgotPassword(req, res) {
    const email = String(req.body.email ?? '').trim();
    const result = await this.#authService.requestPasswordReset(email, {
      ip: this.clientIp(req),
    });

    if (result) {
      await this.#mailService.sendPasswordReset({
        to: result.user.email,
        fullName: result.user.fullName,
        resetUrl: `${this.#baseUrl}/reset-password/${result.token}`,
      });
    }

    // ข้อความเดียวกันทุกกรณี — ห้ามเปิดเผยว่าอีเมลนี้มีบัญชีอยู่จริงหรือไม่
    res.render('auth/forgotPassword', { title: 'ลืมรหัสผ่าน', sent: true, error: null });
  }

  /**
   * แสดงหน้าตั้งรหัสผ่านใหม่ด้วย token
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async showResetPassword(req, res) {
    res.render('auth/resetPassword', {
      title: 'ตั้งรหัสผ่านใหม่',
      token: req.params.token,
      policy: this.#authService.policy.description,
      error: null,
      done: false,
    });
  }

  /**
   * ประมวลผลการตั้งรหัสผ่านใหม่ด้วย token
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async resetPassword(req, res) {
    const render = (error, done) => res.render('auth/resetPassword', {
      title: 'ตั้งรหัสผ่านใหม่',
      token: req.params.token,
      policy: this.#authService.policy.description,
      error,
      done,
    });

    try {
      if (req.body.newPassword !== req.body.confirmPassword) {
        throw new ValidationError('รหัสผ่านใหม่และการยืนยันไม่ตรงกัน');
      }
      await this.#authService.resetPasswordWithToken(
        req.params.token, req.body.newPassword,
        { ip: this.clientIp(req), userAgent: req.get('user-agent') },
      );
      render(null, true);
    } catch (error) {
      if (!(error instanceof AppError) || error.statusCode >= 500) throw error;
      const detail = error.details?.map((item) => item.message).join(' · ');
      res.status(error.statusCode);
      render(detail || error.message, false);
    }
  }

  /**
   * แสดงรายการอุปกรณ์ที่กำลังเข้าสู่ระบบอยู่
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async showSessions(req, res) {
    const sessions = await this.#authService.activeSessions(req.user.id);
    res.render('auth/sessions', {
      title: 'อุปกรณ์ที่เข้าสู่ระบบอยู่',
      sessions: sessions.map((item) => item.toJSON()),
      currentSuffix: req.sessionID?.slice(-8) ?? '',
    });
  }


  /**
   * ตรวจปลายทางหลังเข้าสู่ระบบ — รับเฉพาะพาธภายในเว็บนี้
   *
   * ป้องกัน open redirect ที่ผู้โจมตีส่งลิงก์ `?next=https://evil.example`
   *
   * @param {string} value ค่าที่ผู้ใช้ส่งมา
   * @returns {string} พาธที่ปลอดภัย
   */
  static #safeNext(value) {
    const target = String(value ?? '');
    if (!target.startsWith('/') || target.startsWith('//')) return '/admin';
    return target;
  }

  /**
   * สร้าง session id ใหม่ (กัน session fixation)
   * @param {object} req วัตถุ request
   * @returns {Promise<void>}
   */
  static #regenerateSession(req) {
    return new Promise((resolve, reject) => {
      req.session.regenerate((error) => (error ? reject(error) : resolve()));
    });
  }

  /**
   * บันทึก session ลงที่เก็บทันที
   * @param {object} req วัตถุ request
   * @returns {Promise<void>}
   */
  static #saveSession(req) {
    return new Promise((resolve, reject) => {
      req.session.save((error) => (error ? reject(error) : resolve()));
    });
  }
}
