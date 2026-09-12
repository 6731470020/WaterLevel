import { BaseController } from '../core/BaseController.js';
import { Validator } from '../core/Validator.js';

/**
 * ควบคุมหน้าจัดการบทบาทและตารางติ๊กสิทธิ์ (`/admin/roles`)
 */
export class RoleController extends BaseController {
  /** @type {import('../services/RoleService.js').RoleService} */
  #roleService;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../services/RoleService.js').RoleService} deps.roleService บริการบทบาท
   * @param {import('../core/Logger.js').Logger} [deps.logger] ตัวบันทึกเหตุการณ์
   */
  constructor({ roleService, logger }) {
    super(roleService, logger);
    this.#roleService = roleService;
  }

  /**
   * หน้าตารางบทบาท × สิทธิ์
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async index(req, res) {
    const roles = await this.#roleService.list();
    res.render('admin/roles', {
      title: 'บทบาทและสิทธิ์',
      roles: roles.map((role) => role.toJSON()),
      catalog: this.#roleService.permissionCatalog(),
      canManage: req.user.can('role.manage'),
      saved: req.query.saved === '1',
    });
  }

  /**
   * แก้ไขสิทธิ์ของบทบาท (สิทธิ์ `role.manage`)
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async updatePermissions(req, res) {
    const raw = req.body.permissions;
    const permissionKeys = Array.isArray(raw) ? raw : raw ? [raw] : [];

    const { sessionsRevoked } = await this.#roleService.updatePermissions(
      Number(req.params.id), permissionKeys, this.actorContext(req),
    );

    this.logger.info('role permissions updated', {
      roleId: req.params.id, count: permissionKeys.length, sessionsRevoked,
    });
    res.redirect('/admin/roles?saved=1');
  }

  /**
   * สร้างบทบาทใหม่ (สิทธิ์ `role.manage`)
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async create(req, res) {
    const clean = new Validator(req.body)
      .required('roleKey', 'คีย์บทบาท')
      .string('roleKey', { max: 50, label: 'คีย์บทบาท' })
      .required('name', 'ชื่อบทบาท')
      .string('name', { max: 100, label: 'ชื่อบทบาท' })
      .string('description', { max: 255, label: 'คำอธิบาย' })
      .validate();

    const raw = req.body.permissions;
    await this.#roleService.create({
      roleKey: clean.roleKey,
      name: clean.name,
      description: clean.description || null,
      permissionKeys: Array.isArray(raw) ? raw : raw ? [raw] : [],
    }, this.actorContext(req));

    res.redirect('/admin/roles?saved=1');
  }

  /**
   * ลบบทบาท (สิทธิ์ `role.manage`)
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async destroy(req, res) {
    await this.#roleService.delete(Number(req.params.id), this.actorContext(req));
    res.redirect('/admin/roles?saved=1');
  }
}
