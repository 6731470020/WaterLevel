import { BaseController } from '../core/BaseController.js';
import { Validator } from '../core/Validator.js';
import { ValidationError } from '../core/errors/index.js';

/**
 * ควบคุมหน้าจัดการผู้ใช้ (`/admin/users`)
 */
export class UserController extends BaseController {
  /** @type {import('../services/UserService.js').UserService} */
  #userService;
  /** @type {import('../services/AuthService.js').AuthService} */
  #authService;
  /** @type {import('../services/StationService.js').StationService} */
  #stationService;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../services/UserService.js').UserService} deps.userService บริการผู้ใช้
   * @param {import('../services/AuthService.js').AuthService} deps.authService บริการยืนยันตัวตน
   * @param {import('../services/StationService.js').StationService} deps.stationService บริการจุดวัด
   * @param {import('../core/Logger.js').Logger} [deps.logger] ตัวบันทึกเหตุการณ์
   */
  constructor({ userService, authService, stationService, logger }) {
    super(userService, logger);
    this.#userService = userService;
    this.#authService = authService;
    this.#stationService = stationService;
  }

  /**
   * หน้ารายการผู้ใช้
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async index(req, res) {
    const { page, pageSize, offset } = this.pagination(req.query, 25);
    const [{ items, total }, roles] = await Promise.all([
      this.#userService.list({
        search: req.query.search ?? '',
        status: req.query.status ?? '',
        roleKey: req.query.roleKey ?? '',
        limit: pageSize,
        offset,
      }),
      this.#userService.availableRoles(),
    ]);

    res.render('admin/users', {
      title: 'ผู้ใช้ระบบ',
      users: items.map((user) => user.toJSON()),
      roles: roles.map((role) => role.toJSON()),
      filters: req.query,
      pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) },
    });
  }

  /**
   * หน้าสร้างผู้ใช้ใหม่
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async showCreate(req, res) {
    const [roles, stations] = await Promise.all([
      this.#userService.availableRoles(),
      this.#stationService.list(req.user, { limit: 200 }),
    ]);
    res.render('admin/userForm', {
      title: 'สร้างผู้ใช้ใหม่',
      user: null,
      roles: roles.map((role) => role.toJSON()),
      stations: stations.items.map((station) => station.toJSON()),
      policy: this.#authService.policy.description,
    });
  }

  /**
   * หน้าแก้ไขผู้ใช้
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async showEdit(req, res) {
    const [user, roles, stations] = await Promise.all([
      this.#userService.find(Number(req.params.id)),
      this.#userService.availableRoles(),
      this.#stationService.list(req.user, { limit: 200 }),
    ]);
    res.render('admin/userForm', {
      title: `แก้ไขผู้ใช้ — ${user.username}`,
      user: user.toJSON(),
      roles: roles.map((role) => role.toJSON()),
      stations: stations.items.map((station) => station.toJSON()),
      policy: this.#authService.policy.description,
    });
  }

  /**
   * สร้างผู้ใช้ใหม่
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async create(req, res) {
    const clean = new Validator(req.body)
      .required('username', 'ชื่อผู้ใช้')
      .string('username', { min: 3, max: 100, label: 'ชื่อผู้ใช้' })
      .required('email', 'อีเมล')
      .email('email')
      .required('fullName', 'ชื่อ-นามสกุล')
      .string('fullName', { max: 200, label: 'ชื่อ-นามสกุล' })
      .string('phone', { max: 50, label: 'เบอร์โทร' })
      .required('password', 'รหัสผ่าน')
      .oneOf('status', ['ACTIVE', 'SUSPENDED'], { label: 'สถานะ' })
      .validate();

    const user = await this.#userService.create({
      ...clean,
      password: req.body.password,
      roleKeys: UserController.#toArray(req.body.roleKeys),
      stationIds: UserController.#toArray(req.body.stationIds).map(Number).filter(Boolean),
      mustChangePassword: req.body.mustChangePassword !== '0',
    }, this.actorContext(req));

    res.redirect(`/admin/users?created=${encodeURIComponent(user.username)}`);
  }

  /**
   * แก้ไขผู้ใช้
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async update(req, res) {
    const clean = new Validator(req.body)
      .email('email')
      .string('fullName', { max: 200, label: 'ชื่อ-นามสกุล' })
      .string('phone', { max: 50, label: 'เบอร์โทร' })
      .oneOf('status', ['ACTIVE', 'SUSPENDED'], { label: 'สถานะ' })
      .validate();

    await this.#userService.update(Number(req.params.id), {
      ...clean,
      roleKeys: UserController.#toArray(req.body.roleKeys),
      stationIds: UserController.#toArray(req.body.stationIds).map(Number).filter(Boolean),
    }, this.actorContext(req));

    res.redirect(`/admin/users/${req.params.id}/edit?updated=1`);
  }

  /**
   * ตั้งรหัสผ่านใหม่ให้ผู้ใช้ (สิทธิ์ `user.reset_password`)
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   * @throws {ValidationError} เมื่อไม่ได้กรอกรหัสผ่านใหม่
   */
  async resetPassword(req, res) {
    if (!req.body.newPassword) {
      throw new ValidationError('กรุณากรอกรหัสผ่านใหม่');
    }
    await this.#authService.resetPasswordFor(Number(req.params.id), req.body.newPassword, {
      actor: req.user,
      ip: this.clientIp(req),
      userAgent: req.get('user-agent'),
      mustChange: true,
    });
    res.redirect(`/admin/users/${req.params.id}/edit?passwordReset=1`);
  }

  /**
   * ลบผู้ใช้
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async destroy(req, res) {
    await this.#userService.delete(Number(req.params.id), this.actorContext(req));
    res.redirect('/admin/users?deleted=1');
  }

  /**
   * แปลงค่าจากฟอร์มให้เป็นอาร์เรย์เสมอ
   *
   * ฟอร์ม HTML ส่งค่าเดี่ยวมาเป็นสตริง และส่งหลายค่ามาเป็นอาร์เรย์
   *
   * @param {*} value ค่าดิบจากฟอร์ม
   * @returns {Array<string>}
   */
  static #toArray(value) {
    if (value === undefined || value === null || value === '') return [];
    return Array.isArray(value) ? value : [value];
  }
}
