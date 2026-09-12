import { BaseService } from '../core/BaseService.js';
import { ConflictError, NotFoundError, ValidationError } from '../core/errors/index.js';
import { Role } from '../models/Role.js';
import { Permission } from '../models/Permission.js';

/**
 * บริการจัดการบทบาทและสิทธิ์
 *
 * เมื่อสิทธิ์ของบทบาทเปลี่ยน จะล้าง session ของผู้ใช้ทุกคนที่ถือบทบาทนั้นทันที
 * ทำให้สิทธิ์ใหม่มีผลกับผู้ที่กำลังใช้งานอยู่ (เกณฑ์ตรวจรับข้อ 19)
 */
export class RoleService extends BaseService {
  /** @type {import('../repositories/RoleRepository.js').RoleRepository} */
  #roleRepository;
  /** @type {import('./PermissionService.js').PermissionService} */
  #permissionService;
  /** @type {import('./AuditService.js').AuditService} */
  #auditService;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../repositories/RoleRepository.js').RoleRepository} deps.roleRepository ที่เก็บบทบาท
   * @param {import('./PermissionService.js').PermissionService} deps.permissionService บริการสิทธิ์
   * @param {import('./AuditService.js').AuditService} deps.auditService บริการบันทึกการใช้งาน
   * @param {import('../core/Logger.js').Logger} [deps.logger] ตัวบันทึกเหตุการณ์
   */
  constructor({ roleRepository, permissionService, auditService, logger }) {
    super(roleRepository, logger);
    this.#roleRepository = roleRepository;
    this.#permissionService = permissionService;
    this.#auditService = auditService;
  }

  /**
   * บทบาททั้งหมดพร้อมสิทธิ์
   * @returns {Promise<Array<Role>>}
   */
  async list() {
    return this.#roleRepository.findAllWithPermissions();
  }

  /**
   * ค้นบทบาทด้วยรหัส
   * @param {number} roleId รหัสบทบาท
   * @returns {Promise<Role>}
   * @throws {NotFoundError} เมื่อไม่พบ
   */
  async find(roleId) {
    const role = await this.#roleRepository.findWithPermissions(roleId);
    if (!role) throw new NotFoundError('ไม่พบบทบาทที่ต้องการ');
    return role;
  }

  /**
   * รายการสิทธิ์ทั้งหมดจัดกลุ่มตามทรัพยากร — ใช้แสดงตารางติ๊กสิทธิ์
   * @returns {Array<{resource: string, permissions: Array<{key: string, description: string}>}>}
   */
  permissionCatalog() {
    return [...Permission.groupedByResource().entries()]
      .map(([resource, permissions]) => ({ resource, permissions }));
  }

  /**
   * สร้างบทบาทใหม่
   * @param {{roleKey: string, name: string, description?: string|null, permissionKeys?: Array<string>}} data ข้อมูลบทบาท
   * @param {{actor: import('../models/User.js').User, ip?: string|null, userAgent?: string|null}} context ข้อมูลผู้กระทำ
   * @returns {Promise<Role>}
   * @throws {ConflictError} เมื่อคีย์บทบาทซ้ำ
   */
  async create(data, { actor, ip = null, userAgent = null }) {
    const role = new Role({ ...data, isSystem: false });
    role.validate();

    if (await this.#roleRepository.findByKey(role.roleKey)) {
      throw new ConflictError(`มีบทบาทคีย์ "${role.roleKey}" อยู่แล้ว`);
    }

    const saved = await this.#roleRepository.create(role);
    if (data.permissionKeys?.length) {
      const withPermissions = new Role({ ...saved.toJSON(), roleKey: saved.roleKey });
      withPermissions.assignPermissions(data.permissionKeys);
      await this.#roleRepository.replacePermissions(saved.id, data.permissionKeys);
    }

    await this.#auditService.record({
      actorId: actor?.id ?? null, actorLabel: actor?.username ?? 'ระบบ',
      action: 'role.manage', resourceType: 'role', resourceId: saved.id,
      afterData: { action: 'create', roleKey: saved.roleKey, permissions: data.permissionKeys ?? [] },
      ip, userAgent,
    });
    return this.find(saved.id);
  }

  /**
   * แก้ไขสิทธิ์ของบทบาท แล้วล้าง session ของผู้ใช้ที่ได้รับผลกระทบ
   * @param {number} roleId รหัสบทบาท
   * @param {Array<string>} permissionKeys คีย์สิทธิ์ชุดใหม่
   * @param {{actor: import('../models/User.js').User, ip?: string|null, userAgent?: string|null}} context ข้อมูลผู้กระทำ
   * @returns {Promise<{role: Role, sessionsRevoked: number}>}
   * @throws {ValidationError} เมื่อเป็นบทบาทที่ล็อกไว้ หรือมีคีย์สิทธิ์ที่ไม่รู้จัก
   */
  async updatePermissions(roleId, permissionKeys, { actor, ip = null, userAgent = null }) {
    const role = await this.find(roleId);
    if (role.isLocked) {
      throw new ValidationError('บทบาทผู้ดูแลสูงสุดแก้ไขสิทธิ์ไม่ได้');
    }

    const unknown = (permissionKeys ?? []).filter((key) => !Permission.isValidKey(key));
    if (unknown.length) {
      throw new ValidationError(`พบคีย์สิทธิ์ที่ไม่รู้จัก: ${unknown.join(', ')}`);
    }

    const before = role.permissionKeys;
    await this.#roleRepository.replacePermissions(roleId, permissionKeys ?? []);
    const sessionsRevoked = await this.#permissionService.invalidateSessionsForRole(roleId);

    await this.#auditService.record({
      actorId: actor?.id ?? null, actorLabel: actor?.username ?? 'ระบบ',
      action: 'role.manage', resourceType: 'role', resourceId: roleId,
      beforeData: { permissions: before },
      afterData: { permissions: permissionKeys ?? [], sessionsRevoked },
      ip, userAgent,
    });

    return { role: await this.find(roleId), sessionsRevoked };
  }

  /**
   * แก้ไขชื่อและคำอธิบายของบทบาท
   * @param {number} roleId รหัสบทบาท
   * @param {{name?: string, description?: string|null}} data ข้อมูลใหม่
   * @param {{actor: import('../models/User.js').User, ip?: string|null, userAgent?: string|null}} context ข้อมูลผู้กระทำ
   * @returns {Promise<Role>}
   */
  async updateDetails(roleId, data, { actor, ip = null, userAgent = null }) {
    const role = await this.find(roleId);
    await this.#roleRepository.update(roleId, {
      name: data.name ?? role.name,
      description: data.description === undefined ? role.description : (data.description || null),
    });
    await this.#auditService.record({
      actorId: actor?.id ?? null, actorLabel: actor?.username ?? 'ระบบ',
      action: 'role.manage', resourceType: 'role', resourceId: roleId,
      beforeData: { name: role.name }, afterData: { name: data.name }, ip, userAgent,
    });
    return this.find(roleId);
  }

  /**
   * ลบบทบาทที่ไม่ใช่บทบาทระบบ
   * @param {number} roleId รหัสบทบาท
   * @param {{actor: import('../models/User.js').User, ip?: string|null, userAgent?: string|null}} context ข้อมูลผู้กระทำ
   * @returns {Promise<boolean>}
   * @throws {ValidationError} เมื่อเป็นบทบาทระบบ หรือยังมีผู้ใช้ถืออยู่
   */
  async delete(roleId, { actor, ip = null, userAgent = null }) {
    const role = await this.find(roleId);
    if (role.isSystem) {
      throw new ValidationError('บทบาทระบบลบไม่ได้');
    }
    if (role.userCount > 0) {
      throw new ValidationError(
        `ยังมีผู้ใช้ ${role.userCount} คนถือบทบาทนี้อยู่ กรุณาย้ายผู้ใช้ออกก่อนลบ`,
      );
    }

    const deleted = await this.#roleRepository.delete(roleId);
    if (deleted) {
      await this.#auditService.record({
        actorId: actor?.id ?? null, actorLabel: actor?.username ?? 'ระบบ',
        action: 'role.manage', resourceType: 'role', resourceId: roleId,
        beforeData: { action: 'delete', roleKey: role.roleKey }, ip, userAgent,
      });
    }
    return deleted;
  }
}
