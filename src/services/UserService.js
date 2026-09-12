import { BaseService } from '../core/BaseService.js';
import { LiveValue } from '../core/LiveValue.js';
import { ConflictError, NotFoundError, ValidationError, ForbiddenError } from '../core/errors/index.js';
import { User } from '../models/User.js';

/**
 * บริการจัดการผู้ใช้ บทบาท และขอบเขตจุดวัด
 *
 * ทุกการเปลี่ยนแปลงที่กระทบสิทธิ์จะล้าง session ของผู้ใช้คนนั้นทันที
 * เพื่อให้สิทธิ์ใหม่มีผลโดยไม่ต้องรอ session หมดอายุ
 */
export class UserService extends BaseService {
  /** @type {import('../repositories/UserRepository.js').UserRepository} */
  #userRepository;
  /** @type {import('../repositories/RoleRepository.js').RoleRepository} */
  #roleRepository;
  /** @type {import('./security/PasswordHasher.js').PasswordHasher} */
  #hasher;
  /** @type {() => import('./security/PasswordPolicy.js').PasswordPolicy} */
  #policy;
  /** @type {import('./PermissionService.js').PermissionService} */
  #permissionService;
  /** @type {import('./AuditService.js').AuditService} */
  #auditService;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../repositories/UserRepository.js').UserRepository} deps.userRepository ที่เก็บผู้ใช้
   * @param {import('../repositories/RoleRepository.js').RoleRepository} deps.roleRepository ที่เก็บบทบาท
   * @param {import('./security/PasswordHasher.js').PasswordHasher} deps.hasher ตัวแฮชรหัสผ่านหลัก
   * @param {import('./security/PasswordPolicy.js').PasswordPolicy} deps.policy นโยบายรหัสผ่าน
   * @param {import('./PermissionService.js').PermissionService} deps.permissionService บริการสิทธิ์
   * @param {import('./AuditService.js').AuditService} deps.auditService บริการบันทึกการใช้งาน
   * @param {import('../core/Logger.js').Logger} [deps.logger] ตัวบันทึกเหตุการณ์
   */
  constructor({ userRepository, roleRepository, hasher, policy, permissionService, auditService, logger }) {
    super(userRepository, logger);
    this.#userRepository = userRepository;
    this.#roleRepository = roleRepository;
    this.#hasher = hasher;
    // รับได้ทั้งวัตถุนโยบายและฟังก์ชันอ่านค่าสด — `PASSWORD_MIN_LENGTH` ตั้งได้จากหน้าเว็บ
    this.#policy = LiveValue.reader(policy, null);
    this.#permissionService = permissionService;
    this.#auditService = auditService;
  }

  /**
   * ค้นผู้ใช้พร้อมแบ่งหน้า
   * @param {object} [filters={}] ตัวกรอง
   * @returns {Promise<{items: Array<User>, total: number}>}
   */
  async list(filters = {}) {
    return this.#userRepository.search(filters);
  }

  /**
   * ค้นผู้ใช้ด้วยรหัส
   * @param {number} userId รหัสผู้ใช้
   * @returns {Promise<User>}
   * @throws {NotFoundError} เมื่อไม่พบ
   */
  async find(userId) {
    const user = await this.#userRepository.findWithAccess(userId);
    if (!user) throw new NotFoundError('ไม่พบผู้ใช้ที่ต้องการ');
    return user;
  }

  /**
   * สร้างผู้ใช้ใหม่พร้อมผูกบทบาทและขอบเขตจุดวัด
   * @param {object} data ข้อมูลผู้ใช้
   * @param {string} data.username ชื่อผู้ใช้
   * @param {string} data.email อีเมล
   * @param {string} data.password รหัสผ่าน
   * @param {string} data.fullName ชื่อ-นามสกุล
   * @param {Array<string>} [data.roleKeys=[]] คีย์บทบาท
   * @param {Array<number>} [data.stationIds=[]] รหัสจุดวัดที่จำกัดสิทธิ์
   * @param {{actor: User, ip?: string|null, userAgent?: string|null}} context ข้อมูลผู้กระทำ
   * @returns {Promise<User>}
   * @throws {ConflictError} เมื่อชื่อผู้ใช้หรืออีเมลซ้ำ
   * @throws {ValidationError} เมื่อข้อมูลไม่ถูกต้อง
   */
  async create(data, { actor, ip = null, userAgent = null }) {
    this.#policy().assert(data.password);

    const username = String(data.username ?? '').trim();
    const email = String(data.email ?? '').trim().toLowerCase();
    if (await this.#userRepository.exists({ username })) {
      throw new ConflictError('ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว');
    }
    if (await this.#userRepository.exists({ email })) {
      throw new ConflictError('อีเมลนี้ถูกใช้ไปแล้ว');
    }

    const user = new User({
      username,
      email,
      passwordHash: await this.#hasher.hash(data.password),
      hashAlgo: this.#hasher.algorithm,
      fullName: data.fullName,
      phone: data.phone ?? null,
      status: data.status ?? 'ACTIVE',
      isSuperAdmin: false,
      mustChangePassword: data.mustChangePassword ?? true,
    });
    user.validate();

    const roleIds = await this.#roleRepository.idsByKeys(data.roleKeys ?? []);
    const userId = await this.#userRepository.createWithAccess(
      user, roleIds, data.stationIds ?? [],
    );

    const created = await this.find(userId);
    await this.#auditService.record({
      actorId: actor?.id ?? null, actorLabel: actor?.username ?? 'ระบบ',
      action: 'user.create', resourceType: 'user', resourceId: userId,
      afterData: created.toJSON(), ip, userAgent,
    });
    return created;
  }

  /**
   * แก้ไขข้อมูลผู้ใช้ (ไม่รวมรหัสผ่าน)
   * @param {number} userId รหัสผู้ใช้
   * @param {object} data ข้อมูลใหม่
   * @param {{actor: User, ip?: string|null, userAgent?: string|null}} context ข้อมูลผู้กระทำ
   * @returns {Promise<User>}
   * @throws {ConflictError} เมื่ออีเมลซ้ำกับผู้ใช้อื่น
   * @throws {ForbiddenError} เมื่อพยายามแก้ผู้ดูแลสูงสุดโดยไม่มีสิทธิ์
   */
  async update(userId, data, { actor, ip = null, userAgent = null }) {
    const existing = await this.find(userId);
    this.#assertCanManage(actor, existing);

    const email = data.email ? String(data.email).trim().toLowerCase() : existing.email;
    if (email !== existing.email) {
      const conflict = await this.#userRepository.findByEmail(email);
      if (conflict && conflict.id !== userId) {
        throw new ConflictError('อีเมลนี้ถูกใช้ไปแล้ว');
      }
    }

    await this.#userRepository.update(userId, {
      email,
      full_name: data.fullName ?? existing.fullName,
      phone: data.phone === undefined ? existing.phone : (data.phone || null),
      status: data.status ?? existing.status,
    });

    if (Array.isArray(data.roleKeys)) {
      const roleIds = await this.#roleRepository.idsByKeys(data.roleKeys);
      await this.#userRepository.replaceRoles(userId, roleIds);
      await this.#permissionService.invalidateSessionsForUser(userId);
    }
    if (Array.isArray(data.stationIds)) {
      await this.#userRepository.replaceStations(userId, data.stationIds);
      await this.#permissionService.invalidateSessionsForUser(userId);
    }
    if (data.status === 'SUSPENDED' && existing.status !== 'SUSPENDED') {
      await this.#permissionService.invalidateSessionsForUser(userId);
    }

    const updated = await this.find(userId);
    await this.#auditService.record({
      actorId: actor?.id ?? null, actorLabel: actor?.username ?? 'ระบบ',
      action: 'user.update', resourceType: 'user', resourceId: userId,
      beforeData: existing.toJSON(), afterData: updated.toJSON(), ip, userAgent,
    });
    return updated;
  }

  /**
   * ลบผู้ใช้แบบนุ่มนวล
   * @param {number} userId รหัสผู้ใช้
   * @param {{actor: User, ip?: string|null, userAgent?: string|null}} context ข้อมูลผู้กระทำ
   * @returns {Promise<boolean>}
   * @throws {ValidationError} เมื่อพยายามลบตัวเอง
   * @throws {ForbiddenError} เมื่อพยายามลบผู้ดูแลสูงสุด
   */
  async delete(userId, { actor, ip = null, userAgent = null }) {
    const existing = await this.find(userId);
    this.#assertCanManage(actor, existing);

    if (Number(userId) === Number(actor?.id)) {
      throw new ValidationError('ลบบัญชีของตัวเองไม่ได้');
    }

    const deleted = await this.#userRepository.softDelete(userId);
    if (deleted) {
      await this.#permissionService.invalidateSessionsForUser(userId);
      await this.#auditService.record({
        actorId: actor?.id ?? null, actorLabel: actor?.username ?? 'ระบบ',
        action: 'user.delete', resourceType: 'user', resourceId: userId,
        beforeData: existing.toJSON(), ip, userAgent,
      });
    }
    return deleted;
  }

  /**
   * บทบาททั้งหมดที่มีในระบบ — ใช้เติมตัวเลือกในฟอร์ม
   * @returns {Promise<Array<import('../models/Role.js').Role>>}
   */
  async availableRoles() {
    return this.#roleRepository.findAllWithPermissions();
  }

  /**
   * ตรวจว่าผู้กระทำมีสิทธิ์จัดการผู้ใช้เป้าหมายหรือไม่
   *
   * เฉพาะผู้ดูแลสูงสุดเท่านั้นที่จัดการบัญชีผู้ดูแลสูงสุดด้วยกันได้
   *
   * @param {User} actor ผู้กระทำ
   * @param {User} target ผู้ใช้เป้าหมาย
   * @returns {void}
   * @throws {ForbiddenError} เมื่อไม่มีสิทธิ์
   */
  #assertCanManage(actor, target) {
    if (target.isSuperAdmin && !actor?.isSuperAdmin) {
      throw new ForbiddenError('เฉพาะผู้ดูแลสูงสุดเท่านั้นที่จัดการบัญชีผู้ดูแลสูงสุดได้');
    }
  }
}
