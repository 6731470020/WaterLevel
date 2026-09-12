import { randomBytes, createHash } from 'node:crypto';
import { BaseService } from '../core/BaseService.js';
import { LiveValue } from '../core/LiveValue.js';
import {
  UnauthorizedError, ValidationError, ForbiddenError, NotFoundError,
} from '../core/errors/index.js';

/**
 * บริการยืนยันตัวตนและจัดการรหัสผ่าน
 *
 * รวมนโยบายความปลอดภัยทั้งหมดไว้ที่นี่:
 * - เลือกวิธีตรวจรหัสผ่านตาม `hash_algo` แล้วอัปเกรด bcrypt → scrypt อัตโนมัติ (พหุสัณฐาน)
 * - ล็อกบัญชีเมื่อกรอกผิดซ้ำ (5 ครั้ง → 15 นาที, เกิน 10 ครั้ง → 1 ชั่วโมง)
 * - ตอบข้อความเป็นกลางเสมอ ไม่บอกว่าบัญชีมีอยู่จริงหรือไม่
 * - ล้าง session ทั้งหมดเมื่อเปลี่ยนรหัสผ่านหรือสิทธิ์เปลี่ยน
 */
export class AuthService extends BaseService {
  /** @type {import('../repositories/UserRepository.js').UserRepository} */
  #userRepository;
  /** @type {import('../repositories/SessionRepository.js').SessionRepository} */
  #sessionRepository;
  /** @type {import('../repositories/PasswordResetRepository.js').PasswordResetRepository} */
  #resetRepository;
  /** @type {import('./security/PasswordHasher.js').PasswordHasher} */
  #primaryHasher;
  /** @type {Array<import('./security/PasswordHasher.js').PasswordHasher>} */
  #hashers;
  /** @type {() => import('./security/PasswordPolicy.js').PasswordPolicy} */
  #policy;
  /** @type {import('./AuditService.js').AuditService} */
  #auditService;
  /** @type {{maxAttempts: () => number, lockMinutes: () => number}} */
  #loginPolicy;

  /** ข้อความเดียวที่ตอบกลับทุกกรณีที่เข้าสู่ระบบไม่สำเร็จ — ห้ามเปิดเผยว่าบัญชีมีอยู่จริงหรือไม่ */
  static GENERIC_LOGIN_ERROR = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../repositories/UserRepository.js').UserRepository} deps.userRepository ที่เก็บผู้ใช้
   * @param {import('../repositories/SessionRepository.js').SessionRepository} deps.sessionRepository ที่เก็บ session
   * @param {import('../repositories/PasswordResetRepository.js').PasswordResetRepository} deps.resetRepository ที่เก็บ token รีเซ็ตรหัสผ่าน
   * @param {import('./security/PasswordHasher.js').PasswordHasher} deps.primaryHasher ตัวแฮชหลัก (scrypt)
   * @param {Array<import('./security/PasswordHasher.js').PasswordHasher>} deps.hashers ตัวแฮชทั้งหมดที่รองรับ
   * @param {import('./security/PasswordPolicy.js').PasswordPolicy} deps.policy นโยบายรหัสผ่าน
   * @param {import('./AuditService.js').AuditService} deps.auditService บริการบันทึกการใช้งาน
   * @param {{maxAttempts?: number, lockMinutes?: number}} [deps.loginPolicy={}] นโยบายการล็อกบัญชี
   * @param {import('../core/Logger.js').Logger} [deps.logger] ตัวบันทึกเหตุการณ์
   */
  constructor({
    userRepository, sessionRepository, resetRepository,
    primaryHasher, hashers, policy, auditService, loginPolicy = {}, logger,
  }) {
    super(userRepository, logger);
    this.#userRepository = userRepository;
    this.#sessionRepository = sessionRepository;
    this.#resetRepository = resetRepository;
    this.#primaryHasher = primaryHasher;
    this.#hashers = hashers ?? [primaryHasher];
    this.#policy = LiveValue.reader(policy, null);
    this.#auditService = auditService;
    // อ่านค่าตอนใช้งานจริง ไม่ใช่ตอนสร้างวัตถุ — ค่าเหล่านี้อยู่ในฐานข้อมูลและ
    // แก้ได้จากหน้าเว็บ ส่วน `AuthController` ถือบริการนี้ไว้ตลอดอายุโปรเซส
    this.#loginPolicy = {
      maxAttempts: LiveValue.intReader(loginPolicy.maxAttempts, 5),
      lockMinutes: LiveValue.intReader(loginPolicy.lockMinutes, 15),
    };
  }

  /** @returns {import('./security/PasswordPolicy.js').PasswordPolicy} นโยบายรหัสผ่านที่มีผลอยู่ตอนนี้ */
  get policy() { return this.#policy(); }

  /**
   * เข้าสู่ระบบ
   *
   * ลำดับการตรวจ: หาผู้ใช้ → ตรวจสถานะ → ตรวจการล็อก → ตรวจรหัสผ่าน → อัปเกรดแฮช
   * ทุกทางที่ล้มเหลวตอบข้อความเดียวกัน และบันทึกลง `audit_logs` ทุกกรณี
   *
   * @param {string} login ชื่อผู้ใช้หรืออีเมล
   * @param {string} password รหัสผ่าน
   * @param {{ip?: string|null, userAgent?: string|null}} [context={}] ข้อมูลคำขอ
   * @returns {Promise<import('../models/User.js').User>} ผู้ใช้ที่เข้าสู่ระบบสำเร็จ
   * @throws {UnauthorizedError} เมื่อชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง
   * @throws {ForbiddenError} เมื่อบัญชีถูกล็อกหรือถูกระงับ
   */
  async login(login, password, { ip = null, userAgent = null } = {}) {
    if (!login || !password) {
      throw new UnauthorizedError(AuthService.GENERIC_LOGIN_ERROR);
    }

    const user = await this.#userRepository.findByLogin(login);

    if (!user) {
      await this.#auditService.record({
        actorId: null, actorLabel: String(login).slice(0, 100),
        action: 'auth.login_failed', resourceType: 'user',
        afterData: { reason: 'ไม่พบบัญชีผู้ใช้' }, ip, userAgent,
      });
      throw new UnauthorizedError(AuthService.GENERIC_LOGIN_ERROR);
    }

    if (user.isLocked) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      await this.#auditService.record({
        actorId: user.id, actorLabel: user.username,
        action: 'auth.login_blocked', resourceType: 'user', resourceId: user.id,
        afterData: { reason: 'บัญชีถูกล็อก', minutesRemaining: minutes }, ip, userAgent,
      });
      throw new ForbiddenError(
        `บัญชีถูกล็อกชั่วคราวเนื่องจากกรอกรหัสผ่านผิดหลายครั้ง กรุณารออีก ${minutes} นาที`,
      );
    }

    if (!user.isActive) {
      await this.#auditService.record({
        actorId: user.id, actorLabel: user.username,
        action: 'auth.login_failed', resourceType: 'user', resourceId: user.id,
        afterData: { reason: 'บัญชีถูกระงับ' }, ip, userAgent,
      });
      throw new ForbiddenError('บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
    }

    const hasher = this.#hasherFor(user.hashAlgo, user.passwordHash);
    const matched = hasher ? await hasher.verify(password, user.passwordHash) : false;

    if (!matched) {
      await this.#registerFailure(user, { ip, userAgent });
      throw new UnauthorizedError(AuthService.GENERIC_LOGIN_ERROR);
    }

    // ── พหุสัณฐานที่มีเหตุผลรองรับจริง: อัปเกรดแฮชเดิมจาก PHP เป็น scrypt ──
    let upgraded = false;
    if (hasher.algorithm !== this.#primaryHasher.algorithm) {
      const newHash = await this.#primaryHasher.hash(password);
      await this.#userRepository.upgradeHash(user.id, newHash);
      user.replacePasswordHash(newHash, this.#primaryHasher.algorithm);
      upgraded = true;
      this.logger.info('password hash upgraded', {
        userId: user.id, from: hasher.algorithm, to: this.#primaryHasher.algorithm,
      });
    }

    await this.#userRepository.recordSuccessfulLogin(user.id, ip);
    await this.#auditService.record({
      actorId: user.id, actorLabel: user.username,
      action: 'auth.login', resourceType: 'user', resourceId: user.id,
      afterData: { hashUpgraded: upgraded }, ip, userAgent,
    });

    return user;
  }

  /**
   * เปลี่ยนรหัสผ่านของตัวเอง
   *
   * ต้องยืนยันรหัสผ่านเดิมก่อน และรหัสใหม่ต้องผ่านนโยบาย ห้ามซ้ำ 3 ครั้งล่าสุด
   * เมื่อสำเร็จจะล้าง session อื่นทั้งหมดของผู้ใช้คนนั้น
   *
   * @param {number} userId รหัสผู้ใช้
   * @param {string} currentPassword รหัสผ่านเดิม
   * @param {string} newPassword รหัสผ่านใหม่
   * @param {{ip?: string|null, userAgent?: string|null, keepSessionId?: string|null}} [context={}] ข้อมูลคำขอ
   * @returns {Promise<{sessionsRevoked: number}>}
   * @throws {UnauthorizedError} เมื่อรหัสผ่านเดิมไม่ถูกต้อง
   * @throws {ValidationError} เมื่อรหัสใหม่ไม่ผ่านนโยบายหรือซ้ำของเดิม
   * @throws {NotFoundError} เมื่อไม่พบผู้ใช้
   */
  async changePassword(userId, currentPassword, newPassword, { ip = null, userAgent = null, keepSessionId = null } = {}) {
    const user = await this.#userRepository.findWithAccess(userId);
    if (!user) throw new NotFoundError('ไม่พบบัญชีผู้ใช้');

    const hasher = this.#hasherFor(user.hashAlgo, user.passwordHash);
    const matched = hasher ? await hasher.verify(currentPassword, user.passwordHash) : false;
    if (!matched) throw new UnauthorizedError('รหัสผ่านเดิมไม่ถูกต้อง');

    await this.#applyNewPassword(user, newPassword);

    const revoked = await this.#sessionRepository.destroyForUser(userId, keepSessionId);
    await this.#auditService.record({
      actorId: userId, actorLabel: user.username,
      action: 'auth.password_changed', resourceType: 'user', resourceId: userId,
      afterData: { sessionsRevoked: revoked }, ip, userAgent,
    });
    return { sessionsRevoked: revoked };
  }

  /**
   * ตั้งรหัสผ่านใหม่ให้ผู้ใช้คนอื่น (สิทธิ์ `user.reset_password`)
   * @param {number} targetUserId รหัสผู้ใช้ปลายทาง
   * @param {string} newPassword รหัสผ่านใหม่
   * @param {{actor: import('../models/User.js').User, ip?: string|null, userAgent?: string|null, mustChange?: boolean}} context ข้อมูลผู้กระทำ
   * @returns {Promise<void>}
   * @throws {NotFoundError} เมื่อไม่พบผู้ใช้ปลายทาง
   */
  async resetPasswordFor(targetUserId, newPassword, { actor, ip = null, userAgent = null, mustChange = true }) {
    const user = await this.#userRepository.findWithAccess(targetUserId);
    if (!user) throw new NotFoundError('ไม่พบบัญชีผู้ใช้');

    this.policy.assert(newPassword);
    const hash = await this.#primaryHasher.hash(newPassword);
    await this.#userRepository.changePassword(
      targetUserId, hash, this.#primaryHasher.algorithm, mustChange,
    );
    await this.#sessionRepository.destroyForUser(targetUserId);
    await this.#auditService.record({
      actorId: actor?.id ?? null, actorLabel: actor?.username ?? 'ระบบ',
      action: 'user.reset_password', resourceType: 'user', resourceId: targetUserId,
      afterData: { username: user.username }, ip, userAgent,
    });
  }

  /**
   * ขอลิงก์ตั้งรหัสผ่านใหม่
   *
   * **ตอบสำเร็จเสมอ** ไม่ว่าอีเมลจะมีอยู่ในระบบหรือไม่ เพื่อไม่ให้ผู้โจมตีใช้หน้านี้
   * ไล่หาว่าอีเมลใดมีบัญชีอยู่ (CLAUDE.md ข้อ 8.1)
   *
   * @param {string} email อีเมล
   * @param {{ip?: string|null}} [context={}] ข้อมูลคำขอ
   * @returns {Promise<{token: string, user: import('../models/User.js').User}|null>}
   *          ข้อมูลสำหรับส่งอีเมล หรือ null เมื่อไม่พบบัญชี — **ผู้เรียกต้องตอบสำเร็จเสมอ**
   */
  async requestPasswordReset(email, { ip = null } = {}) {
    const user = await this.#userRepository.findByEmail(email);
    if (!user || !user.isActive) {
      this.logger.info('password reset requested for unknown or inactive account');
      return null;
    }

    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await this.#resetRepository.issue(user.id, tokenHash, expiresAt);
    await this.#auditService.record({
      actorId: user.id, actorLabel: user.username,
      action: 'auth.password_reset_requested', resourceType: 'user', resourceId: user.id,
      ip,
    });
    return { token, user };
  }

  /**
   * ตั้งรหัสผ่านใหม่ด้วย token จากอีเมล
   *
   * token ใช้ได้ครั้งเดียว และเมื่อใช้แล้วจะล้าง session ทั้งหมดของผู้ใช้นั้น
   *
   * @param {string} token token ดิบจากลิงก์ในอีเมล
   * @param {string} newPassword รหัสผ่านใหม่
   * @param {{ip?: string|null, userAgent?: string|null}} [context={}] ข้อมูลคำขอ
   * @returns {Promise<void>}
   * @throws {ValidationError} เมื่อ token ไม่ถูกต้อง หมดอายุ หรือถูกใช้ไปแล้ว
   * @throws {NotFoundError} เมื่อไม่พบผู้ใช้เจ้าของ token
   */
  async resetPasswordWithToken(token, newPassword, { ip = null, userAgent = null } = {}) {
    const tokenHash = createHash('sha256').update(String(token ?? '')).digest('hex');
    const record = await this.#resetRepository.findUsable(tokenHash);
    if (!record) {
      throw new ValidationError('ลิงก์ตั้งรหัสผ่านใหม่ไม่ถูกต้องหรือหมดอายุแล้ว กรุณาขอลิงก์ใหม่');
    }

    const user = await this.#userRepository.findWithAccess(record.userId);
    if (!user) throw new NotFoundError('ไม่พบบัญชีผู้ใช้');

    await this.#applyNewPassword(user, newPassword);
    await this.#resetRepository.markUsed(record.id);
    await this.#sessionRepository.destroyForUser(user.id);
    await this.#auditService.record({
      actorId: user.id, actorLabel: user.username,
      action: 'auth.password_reset_completed', resourceType: 'user', resourceId: user.id,
      ip, userAgent,
    });
  }

  /**
   * ออกจากระบบทุกอุปกรณ์
   * @param {number} userId รหัสผู้ใช้
   * @param {string|null} [keepSessionId=null] session ที่ต้องการเก็บไว้
   * @returns {Promise<number>} จำนวน session ที่ถูกล้าง
   */
  async logoutEverywhere(userId, keepSessionId = null) {
    return this.#sessionRepository.destroyForUser(userId, keepSessionId);
  }

  /**
   * รายการอุปกรณ์ที่กำลังเข้าสู่ระบบอยู่
   * @param {number} userId รหัสผู้ใช้
   * @returns {Promise<Array<import('../models/Session.js').Session>>}
   */
  async activeSessions(userId) {
    return this.#sessionRepository.activeForUser(userId);
  }

  /**
   * โหลดผู้ใช้พร้อมสิทธิ์ล่าสุด — `AuthMiddleware` เรียกทุกคำขอ
   * @param {number} userId รหัสผู้ใช้
   * @returns {Promise<import('../models/User.js').User|null>}
   */
  async loadUser(userId) {
    return this.#userRepository.findWithAccess(userId);
  }

  /**
   * ตรวจนโยบายและบันทึกรหัสผ่านใหม่ — ใช้ร่วมกันระหว่างเปลี่ยนเองและตั้งใหม่ด้วย token
   * @param {import('../models/User.js').User} user ผู้ใช้
   * @param {string} newPassword รหัสผ่านใหม่
   * @returns {Promise<void>}
   * @throws {ValidationError} เมื่อไม่ผ่านนโยบายหรือซ้ำรหัสเดิม
   */
  async #applyNewPassword(user, newPassword) {
    this.policy.assert(newPassword);

    const history = await this.#userRepository.recentPasswords(user.id, 3);
    for (const record of history) {
      const hasher = this.#hasherFor(record.hash_algo, record.password_hash);
      if (hasher && await hasher.verify(newPassword, record.password_hash)) {
        throw new ValidationError('ห้ามใช้รหัสผ่านซ้ำกับ 3 ครั้งล่าสุด กรุณาตั้งรหัสผ่านใหม่');
      }
    }

    const hash = await this.#primaryHasher.hash(newPassword);
    await this.#userRepository.changePassword(user.id, hash, this.#primaryHasher.algorithm, false);
  }

  /**
   * บันทึกการเข้าสู่ระบบล้มเหลว และล็อกบัญชีเมื่อถึงเกณฑ์
   *
   * ผิดครบ 5 ครั้ง → ล็อก 15 นาที, เกิน 10 ครั้ง → ล็อก 1 ชั่วโมง
   *
   * @param {import('../models/User.js').User} user ผู้ใช้
   * @param {{ip: string|null, userAgent: string|null}} context ข้อมูลคำขอ
   * @returns {Promise<void>}
   */
  async #registerFailure(user, { ip, userAgent }) {
    const nextCount = user.failedLoginCount + 1;
    const maxAttempts = this.#loginPolicy.maxAttempts();
    const lockMinutes = this.#loginPolicy.lockMinutes();

    let lockUntil = null;
    if (nextCount >= maxAttempts * 2) {
      lockUntil = new Date(Date.now() + 60 * 60 * 1000);
    } else if (nextCount >= maxAttempts) {
      lockUntil = new Date(Date.now() + lockMinutes * 60 * 1000);
    }

    await this.#userRepository.recordFailedLogin(user.id, lockUntil);
    await this.#auditService.record({
      actorId: user.id, actorLabel: user.username,
      action: lockUntil ? 'auth.account_locked' : 'auth.login_failed',
      resourceType: 'user', resourceId: user.id,
      afterData: { attempts: nextCount, lockedUntil: lockUntil }, ip, userAgent,
    });
  }

  /**
   * เลือกตัวตรวจรหัสผ่านที่เหมาะกับแฮชที่เก็บไว้ (พหุสัณฐาน)
   *
   * ใช้ `hash_algo` เป็นตัวเลือกหลัก แต่ถ้าไม่ตรงก็ให้แต่ละตัวตรวจ `supports()` เอง
   * ทำให้ข้อมูลที่ `hash_algo` ผิดพลาดยังเข้าสู่ระบบได้
   *
   * @param {string} algo ชื่ออัลกอริทึมจากฐานข้อมูล
   * @param {string} hash ค่าแฮช
   * @returns {import('./security/PasswordHasher.js').PasswordHasher|null}
   */
  #hasherFor(algo, hash) {
    return this.#hashers.find((hasher) => hasher.algorithm === algo && hasher.supports(hash))
      ?? this.#hashers.find((hasher) => hasher.supports(hash))
      ?? null;
  }
}
