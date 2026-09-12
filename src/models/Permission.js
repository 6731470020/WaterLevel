import { BaseModel } from '../core/BaseModel.js';
import { ValidationError } from '../core/errors/index.js';

/**
 * สิทธิ์การใช้งานหนึ่งข้อ ในรูปแบบ `<ทรัพยากร>.<การกระทำ>`
 *
 * รายการสิทธิ์ทั้งหมดนิยามเป็น static constant ที่นี่ที่เดียว (CLAUDE.md ข้อ 8.2)
 * เพื่อให้ทั้ง seed ฐานข้อมูล, middleware และ view อ้างอิงแหล่งเดียวกัน
 */
export class Permission extends BaseModel {
  /** @type {string} */
  #permissionKey;
  /** @type {string} */
  #resource;
  /** @type {string} */
  #action;
  /** @type {string} */
  #description;

  /**
   * @param {object} data ข้อมูลสิทธิ์
   * @param {string} data.permissionKey คีย์สิทธิ์
   * @param {string} [data.resource] ทรัพยากร (แยกจากคีย์อัตโนมัติถ้าไม่ส่ง)
   * @param {string} [data.action] การกระทำ (แยกจากคีย์อัตโนมัติถ้าไม่ส่ง)
   * @param {string} [data.description] คำอธิบายภาษาไทย
   */
  constructor(data = {}) {
    super(data);
    this.#permissionKey = String(data.permissionKey ?? '').trim();
    const [resource, action] = this.#permissionKey.split('.');
    this.#resource = String(data.resource ?? resource ?? '');
    this.#action = String(data.action ?? action ?? '');
    this.#description = String(data.description ?? '');
  }

  /** @returns {string} คีย์สิทธิ์ */
  get permissionKey() { return this.#permissionKey; }

  /** @returns {string} ชื่อทรัพยากร */
  get resource() { return this.#resource; }

  /** @returns {string} ชื่อการกระทำ */
  get action() { return this.#action; }

  /** @returns {string} คำอธิบายภาษาไทย */
  get description() { return this.#description; }

  /**
   * รายการสิทธิ์ทั้งหมดของระบบ — แหล่งความจริงเพียงแหล่งเดียว
   * @returns {Array<{key: string, resource: string, action: string, description: string}>}
   */
  static catalog() {
    return [
      ['station.read',            'station',     'read',           'ดูข้อมูลจุดวัด'],
      ['station.create',          'station',     'create',         'สร้างจุดวัดใหม่'],
      ['station.update',          'station',     'update',         'แก้ไขข้อมูลจุดวัด'],
      ['station.delete',          'station',     'delete',         'ลบจุดวัด'],
      ['roi.read',                'roi',         'read',           'ดูขอบเขต ROI และโซน'],
      ['roi.write',               'roi',         'write',          'แก้ไขขอบเขต ROI และโซน'],
      ['calibration.read',        'calibration', 'read',           'ดูจุดเทียบค่าพิกเซล-เมตร'],
      ['calibration.write',       'calibration', 'write',          'แก้ไขจุดเทียบค่าพิกเซล-เมตร'],
      ['measurement.read',        'measurement', 'read',           'ดูค่าวัดระดับน้ำ'],
      ['measurement.export',      'measurement', 'export',         'ส่งออกค่าวัดเป็นไฟล์ CSV'],
      ['measurement.delete',      'measurement', 'delete',         'ลบค่าวัด'],
      ['capture.trigger',         'capture',     'trigger',        'สั่งจับภาพจากกล้องด้วยตนเอง'],
      ['alert.read',              'alert',       'read',           'ดูประวัติการแจ้งเตือน'],
      ['alert.broadcast',         'alert',       'broadcast',      'ส่งการแจ้งเตือนด้วยตนเอง'],
      ['alert.config',            'alert',       'config',         'ตั้งค่าเงื่อนไขการแจ้งเตือน'],
      ['report.read',             'report',      'read',           'ดูรายงานประจำวัน'],
      ['report.generate',         'report',      'generate',       'สั่งสร้างรายงาน'],
      ['report.send',             'report',      'send',           'ส่งรายงานเข้ากลุ่ม LINE'],
      ['line.read',               'line',        'read',           'ดูรายการกลุ่มและผู้ติดตาม LINE'],
      ['line.manage',             'line',        'manage',         'จัดการกลุ่มและผู้ติดตาม LINE'],
      ['user.read',               'user',        'read',           'ดูรายชื่อผู้ใช้'],
      ['user.create',             'user',        'create',         'สร้างผู้ใช้ใหม่'],
      ['user.update',             'user',        'update',         'แก้ไขข้อมูลผู้ใช้'],
      ['user.delete',             'user',        'delete',         'ลบผู้ใช้'],
      ['user.reset_password',     'user',        'reset_password', 'ตั้งรหัสผ่านใหม่ให้ผู้ใช้'],
      ['role.read',               'role',        'read',           'ดูบทบาทและสิทธิ์'],
      ['role.manage',             'role',        'manage',         'จัดการบทบาทและสิทธิ์'],
      ['license.read',            'license',     'read',           'ดูข้อมูลใบอนุญาต'],
      ['license.manage',          'license',     'manage',         'จัดการใบอนุญาต'],
      ['audit.read',              'audit',       'read',           'ดูบันทึกการใช้งานระบบ'],
      ['setting.read',            'setting',     'read',           'ดูค่าตั้งค่าระบบ'],
      ['setting.manage',          'setting',     'manage',         'แก้ไขค่าตั้งค่าระบบ'],
    ].map(([key, resource, action, description]) => ({ key, resource, action, description }));
  }

  /** @returns {Array<string>} คีย์สิทธิ์ทั้งหมด */
  static allKeys() { return Permission.catalog().map((item) => item.key); }

  /**
   * ตรวจว่าคีย์สิทธิ์นี้มีอยู่จริงในระบบ
   * @param {string} key คีย์สิทธิ์
   * @returns {boolean}
   */
  static isValidKey(key) { return Permission.allKeys().includes(key); }

  /**
   * จัดกลุ่มสิทธิ์ตามทรัพยากร — ใช้แสดงตารางติ๊กสิทธิ์ในหน้า `/admin/roles`
   * @returns {Map<string, Array<{key: string, description: string}>>}
   */
  static groupedByResource() {
    const groups = new Map();
    for (const item of Permission.catalog()) {
      if (!groups.has(item.resource)) groups.set(item.resource, []);
      groups.get(item.resource).push({ key: item.key, description: item.description });
    }
    return groups;
  }

  /**
   * ตรวจความถูกต้อง
   * @returns {void}
   * @throws {ValidationError} เมื่อคีย์ไม่อยู่ในรูปแบบ `resource.action`
   */
  validate() {
    if (!/^[a-z_]+\.[a-z_]+$/.test(this.#permissionKey)) {
      throw new ValidationError('คีย์สิทธิ์ต้องอยู่ในรูปแบบ ทรัพยากร.การกระทำ');
    }
  }

  /** @returns {object} โครงสร้างสำหรับส่งออก */
  toJSON() {
    return {
      id: this.id,
      key: this.#permissionKey,
      resource: this.#resource,
      action: this.#action,
      description: this.#description,
    };
  }
}
