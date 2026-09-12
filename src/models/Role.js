import { BaseModel } from '../core/BaseModel.js';
import { ValidationError } from '../core/errors/index.js';
import { Permission } from './Permission.js';

/**
 * บทบาทของผู้ใช้ พร้อมชุดสิทธิ์ที่ผูกอยู่
 *
 * บทบาทระบบทั้ง 4 ตัว (`is_system = 1`) ลบไม่ได้ แต่แก้สิทธิ์ได้
 * ยกเว้น `SUPER_ADMIN` ที่ล็อกไว้ทั้งหมด (CLAUDE.md ข้อ 8.3)
 */
export class Role extends BaseModel {
  /** @type {string} */
  #roleKey;
  /** @type {string} */
  #name;
  /** @type {string|null} */
  #description;
  /** @type {boolean} */
  #isSystem;
  /** @type {Set<string>} */
  #permissionKeys = new Set();
  /** @type {number} */
  #userCount = 0;

  /**
   * @param {object} data ข้อมูลบทบาท
   * @param {string} data.roleKey คีย์บทบาท เช่น `ADMIN`
   * @param {string} data.name ชื่อภาษาไทย
   * @param {string|null} [data.description] คำอธิบาย
   * @param {boolean} [data.isSystem=false] เป็นบทบาทระบบหรือไม่
   * @param {Array<string>} [data.permissionKeys=[]] คีย์สิทธิ์ที่ผูกอยู่
   */
  constructor(data = {}) {
    super(data);
    this.#roleKey = String(data.roleKey ?? '').trim().toUpperCase();
    this.#name = String(data.name ?? '').trim();
    this.#description = data.description ? String(data.description) : null;
    this.#isSystem = Boolean(data.isSystem);
    this.#permissionKeys = new Set(data.permissionKeys ?? []);
    this.#userCount = Number(data.userCount ?? 0);
  }

  /** คีย์บทบาทระบบทั้งสี่ */
  static SUPER_ADMIN = 'SUPER_ADMIN';
  static ADMIN = 'ADMIN';
  static OPERATOR = 'OPERATOR';
  static VIEWER = 'VIEWER';

  /** @returns {Array<string>} คีย์บทบาทระบบทั้งหมด */
  static systemKeys() {
    return [Role.SUPER_ADMIN, Role.ADMIN, Role.OPERATOR, Role.VIEWER];
  }

  /**
   * ตารางสิทธิ์ตามบทบาทตั้งต้น (CLAUDE.md ข้อ 8.3)
   *
   * `SUPER_ADMIN` ไม่ระบุสิทธิ์ที่นี่เพราะผ่านทุกด่านด้วยธง `is_super_admin`
   * แต่ยังได้รับสิทธิ์ครบทุกข้อในฐานข้อมูลเพื่อให้หน้าจอแสดงผลถูกต้อง
   *
   * @returns {Record<string, Array<string>>} คีย์บทบาท → รายการคีย์สิทธิ์
   */
  static defaultPermissionMatrix() {
    const viewer = [
      'station.read', 'roi.read', 'calibration.read',
      'measurement.read', 'alert.read', 'report.read',
    ];
    const operator = [
      ...viewer,
      'roi.write', 'calibration.write', 'measurement.export',
      'capture.trigger', 'alert.broadcast', 'report.generate', 'report.send',
      'line.read', 'setting.read',
    ];
    const admin = [
      ...operator,
      'station.create', 'station.update', 'station.delete',
      'measurement.delete', 'alert.config', 'line.manage',
      'user.read', 'user.create', 'user.update', 'user.delete', 'user.reset_password',
      'role.read', 'license.read', 'audit.read', 'setting.manage',
    ];
    return {
      [Role.SUPER_ADMIN]: Permission.allKeys(),
      [Role.ADMIN]: [...new Set(admin)],
      [Role.OPERATOR]: [...new Set(operator)],
      [Role.VIEWER]: [...new Set(viewer)],
    };
  }

  /** @returns {string} คีย์บทบาท */
  get roleKey() { return this.#roleKey; }

  /** @returns {string} ชื่อภาษาไทย */
  get name() { return this.#name; }

  /** @returns {string|null} คำอธิบาย */
  get description() { return this.#description; }

  /** @returns {boolean} เป็นบทบาทระบบหรือไม่ (ลบไม่ได้) */
  get isSystem() { return this.#isSystem; }

  /** @returns {Array<string>} คีย์สิทธิ์ทั้งหมดของบทบาทนี้ */
  get permissionKeys() { return [...this.#permissionKeys]; }

  /** @returns {number} จำนวนผู้ใช้ที่ถือบทบาทนี้ */
  get userCount() { return this.#userCount; }

  /** @returns {boolean} เป็นบทบาทผู้ดูแลสูงสุด (แก้ไขสิทธิ์ไม่ได้) */
  get isLocked() { return this.#roleKey === Role.SUPER_ADMIN; }

  /**
   * กำหนดชุดสิทธิ์ใหม่ทั้งชุด
   * @param {Array<string>} keys คีย์สิทธิ์
   * @throws {ValidationError} เมื่อมีคีย์ที่ไม่รู้จัก หรือเป็นบทบาทที่ล็อกไว้
   */
  assignPermissions(keys) {
    if (this.isLocked) {
      throw new ValidationError('บทบาทผู้ดูแลสูงสุดแก้ไขสิทธิ์ไม่ได้');
    }
    const unknown = (keys ?? []).filter((key) => !Permission.isValidKey(key));
    if (unknown.length) {
      throw new ValidationError(`พบคีย์สิทธิ์ที่ไม่รู้จัก: ${unknown.join(', ')}`);
    }
    this.#permissionKeys = new Set(keys);
  }

  /**
   * กำหนดจำนวนผู้ใช้ที่ถือบทบาทนี้ (มาจากการนับใน Repository)
   * @param {number} count จำนวน
   */
  assignUserCount(count) { this.#userCount = Number(count ?? 0); }

  /**
   * ตรวจว่าบทบาทนี้มีสิทธิ์ที่ระบุหรือไม่
   * @param {string} permissionKey คีย์สิทธิ์
   * @returns {boolean}
   */
  has(permissionKey) { return this.#permissionKeys.has(permissionKey); }

  /**
   * ตรวจความถูกต้อง
   * @returns {void}
   * @throws {ValidationError} เมื่อคีย์หรือชื่อไม่ถูกต้อง
   */
  validate() {
    const errors = [];
    if (!/^[A-Z][A-Z0-9_]{1,49}$/.test(this.#roleKey)) {
      errors.push({ field: 'roleKey', message: 'คีย์บทบาทต้องเป็นตัวพิมพ์ใหญ่ภาษาอังกฤษ 2–50 ตัว' });
    }
    if (!this.#name || this.#name.length > 100) {
      errors.push({ field: 'name', message: 'ชื่อบทบาทต้องยาว 1–100 ตัวอักษร' });
    }
    if (errors.length) throw new ValidationError('ข้อมูลบทบาทไม่ถูกต้อง', errors);
  }

  /** @returns {object} โครงสร้างสำหรับส่งออก */
  toJSON() {
    return {
      id: this.id,
      key: this.#roleKey,
      name: this.#name,
      description: this.#description,
      isSystem: this.#isSystem,
      isLocked: this.isLocked,
      permissions: this.permissionKeys,
      userCount: this.#userCount,
      createdAt: this.createdAt,
    };
  }
}
