import { BaseModel } from '../core/BaseModel.js';
import { ValidationError } from '../core/errors/index.js';

/** สถานะบัญชีที่เป็นไปได้ */
const STATUSES = ['ACTIVE', 'SUSPENDED'];

/**
 * ผู้ใช้ระบบ
 *
 * **ตัวอย่างการห่อหุ้มที่สำคัญที่สุดของโปรเจกต์** — `#passwordHash` เป็นฟิลด์ส่วนตัวจริง
 * ของ JavaScript เข้าถึงจากภายนอกคลาสไม่ได้เลย มีเพียง `passwordHash` getter ที่
 * `AuthService` เรียกเพื่อส่งให้ `PasswordHasher` ตรวจ และ `toJSON()` ที่ไม่ส่งค่านี้ออกไป
 */
export class User extends BaseModel {
  /** @type {string} */
  #username;
  /** @type {string} */
  #email;
  /** @type {string} */
  #passwordHash;
  /** @type {string} */
  #hashAlgo;
  /** @type {string} */
  #fullName;
  /** @type {string|null} */
  #phone;
  /** @type {string} */
  #status;
  /** @type {boolean} */
  #isSuperAdmin;
  /** @type {boolean} */
  #mustChangePassword;
  /** @type {number} */
  #failedLoginCount;
  /** @type {Date|null} */
  #lockedUntil;
  /** @type {Date|null} */
  #lastLoginAt;
  /** @type {string|null} */
  #lastLoginIp;
  /** @type {Date|null} */
  #deletedAt;
  /** @type {Array<import('./Role.js').Role>} */
  #roles = [];
  /** @type {Set<string>} */
  #permissions = new Set();
  /** @type {Array<number>|null} */
  #stationIds = null;

  /**
   * @param {object} data ข้อมูลผู้ใช้
   * @param {number|null} [data.id] รหัส
   * @param {string} data.username ชื่อผู้ใช้
   * @param {string} data.email อีเมล
   * @param {string} data.passwordHash แฮชรหัสผ่าน
   * @param {string} [data.hashAlgo='scrypt'] อัลกอริทึมที่ใช้แฮช
   * @param {string} data.fullName ชื่อ-นามสกุล
   * @param {string|null} [data.phone] เบอร์โทร
   * @param {string} [data.status='ACTIVE'] สถานะบัญชี
   * @param {boolean} [data.isSuperAdmin=false] เป็นผู้ดูแลสูงสุดหรือไม่
   * @param {boolean} [data.mustChangePassword=false] ต้องเปลี่ยนรหัสผ่านก่อนใช้งานหรือไม่
   */
  constructor(data = {}) {
    super(data);
    this.#username = String(data.username ?? '').trim();
    this.#email = String(data.email ?? '').trim().toLowerCase();
    this.#passwordHash = String(data.passwordHash ?? '');
    this.#hashAlgo = String(data.hashAlgo ?? 'scrypt');
    this.#fullName = String(data.fullName ?? '').trim();
    this.#phone = data.phone ? String(data.phone).trim() : null;
    this.#status = String(data.status ?? 'ACTIVE').toUpperCase();
    this.#isSuperAdmin = Boolean(data.isSuperAdmin);
    this.#mustChangePassword = Boolean(data.mustChangePassword);
    this.#failedLoginCount = Number(data.failedLoginCount ?? 0);
    this.#lockedUntil = BaseModel.toDate(data.lockedUntil);
    this.#lastLoginAt = BaseModel.toDate(data.lastLoginAt);
    this.#lastLoginIp = data.lastLoginIp ?? null;
    this.#deletedAt = BaseModel.toDate(data.deletedAt);
  }

  /** @returns {string} ชื่อผู้ใช้ */
  get username() { return this.#username; }

  /** @returns {string} อีเมล */
  get email() { return this.#email; }

  /**
   * แฮชรหัสผ่าน — เปิดเผยเฉพาะให้ `AuthService` ส่งต่อให้ `PasswordHasher`
   * ห้ามส่งค่านี้ออกนอกชั้น business เด็ดขาด และ `toJSON()` ไม่รวมค่านี้
   * @returns {string}
   */
  get passwordHash() { return this.#passwordHash; }

  /** @returns {string} อัลกอริทึมที่ใช้แฮชรหัสผ่านปัจจุบัน (`scrypt` | `bcrypt`) */
  get hashAlgo() { return this.#hashAlgo; }

  /** @returns {string} ชื่อ-นามสกุล */
  get fullName() { return this.#fullName; }

  /** @returns {string|null} เบอร์โทร */
  get phone() { return this.#phone; }

  /** @returns {string} สถานะบัญชี */
  get status() { return this.#status; }

  /** @returns {boolean} เป็นผู้ดูแลสูงสุดหรือไม่ */
  get isSuperAdmin() { return this.#isSuperAdmin; }

  /** @returns {boolean} ต้องเปลี่ยนรหัสผ่านก่อนใช้งานหรือไม่ */
  get mustChangePassword() { return this.#mustChangePassword; }

  /** @returns {number} จำนวนครั้งที่กรอกรหัสผ่านผิดติดต่อกัน */
  get failedLoginCount() { return this.#failedLoginCount; }

  /** @returns {Date|null} ล็อกบัญชีถึงเวลาใด */
  get lockedUntil() { return this.#lockedUntil; }

  /** @returns {Date|null} เวลาเข้าสู่ระบบล่าสุด */
  get lastLoginAt() { return this.#lastLoginAt; }

  /** @returns {string|null} หมายเลข IP ที่เข้าสู่ระบบล่าสุด */
  get lastLoginIp() { return this.#lastLoginIp; }

  /** @returns {Date|null} เวลาที่ถูกลบแบบนุ่มนวล */
  get deletedAt() { return this.#deletedAt; }

  /** @returns {Array<import('./Role.js').Role>} บทบาททั้งหมดของผู้ใช้ (สำเนา) */
  get roles() { return [...this.#roles]; }

  /** @returns {Array<string>} คีย์สิทธิ์ทั้งหมดที่รวมมาจากทุกบทบาท */
  get permissions() { return [...this.#permissions]; }

  /**
   * รายการรหัสจุดวัดที่ผู้ใช้เข้าถึงได้
   * `null` = เข้าถึงได้ทุกจุดวัดตามบทบาท (ตามกติกาในตาราง `user_stations`)
   * @returns {Array<number>|null}
   */
  get stationIds() { return this.#stationIds === null ? null : [...this.#stationIds]; }

  /** @returns {boolean} ผูกกับจุดวัดบางส่วนหรือไม่ */
  get hasStationScope() { return Array.isArray(this.#stationIds) && this.#stationIds.length > 0; }

  /** @returns {boolean} บัญชียังใช้งานได้และไม่ถูกลบ */
  get isActive() { return this.#status === 'ACTIVE' && this.#deletedAt === null; }

  /** @returns {boolean} บัญชีถูกล็อกอยู่ในขณะนี้ */
  get isLocked() { return this.#lockedUntil !== null && this.#lockedUntil.getTime() > Date.now(); }

  /**
   * กำหนดบทบาทและรวมสิทธิ์ทั้งหมดเข้าด้วยกัน
   * @param {Array<import('./Role.js').Role>} roles บทบาทของผู้ใช้
   */
  assignRoles(roles) {
    this.#roles = [...(roles ?? [])];
    this.#permissions = new Set(this.#roles.flatMap((role) => role.permissionKeys));
  }

  /**
   * กำหนดขอบเขตจุดวัดที่เข้าถึงได้
   * @param {Array<number>|null} stationIds รายการรหัสจุดวัด (อาร์เรย์ว่าง = เข้าถึงได้ทุกจุด)
   */
  assignStations(stationIds) {
    this.#stationIds = Array.isArray(stationIds) && stationIds.length
      ? stationIds.map(Number)
      : null;
  }

  /**
   * ตรวจว่ามีสิทธิ์ที่ระบุหรือไม่ — ผู้ดูแลสูงสุดผ่านทุกสิทธิ์เสมอ
   * @param {string} permissionKey คีย์สิทธิ์ เช่น `station.update`
   * @returns {boolean}
   */
  can(permissionKey) {
    if (this.#isSuperAdmin) return true;
    return this.#permissions.has(permissionKey);
  }

  /**
   * ตรวจว่ามีสิทธิ์อย่างน้อยหนึ่งข้อจากรายการหรือไม่
   * @param {Array<string>} permissionKeys รายการคีย์สิทธิ์
   * @returns {boolean}
   */
  canAny(permissionKeys) {
    return (permissionKeys ?? []).some((key) => this.can(key));
  }

  /**
   * ตรวจว่ามีบทบาทที่ระบุหรือไม่
   * @param {string} roleKey คีย์บทบาท เช่น `ADMIN`
   * @returns {boolean}
   */
  hasRole(roleKey) {
    return this.#roles.some((role) => role.roleKey === roleKey);
  }

  /**
   * ตรวจว่าเข้าถึงจุดวัดนี้ได้หรือไม่ (ตามขอบเขต `user_stations`)
   * @param {number} stationId รหัสจุดวัด
   * @returns {boolean}
   */
  canAccessStation(stationId) {
    if (this.#isSuperAdmin) return true;
    if (this.#stationIds === null) return true;
    return this.#stationIds.includes(Number(stationId));
  }

  /**
   * เปลี่ยนแฮชรหัสผ่านในหน่วยความจำ — ใช้ตอนอัปเกรด bcrypt → scrypt
   * @param {string} hash แฮชใหม่
   * @param {string} algo ชื่ออัลกอริทึม
   */
  replacePasswordHash(hash, algo) {
    this.#passwordHash = String(hash);
    this.#hashAlgo = String(algo);
  }

  /**
   * ตรวจความถูกต้องของข้อมูลผู้ใช้
   * @returns {void}
   * @throws {ValidationError} เมื่อข้อมูลไม่ครบหรือผิดรูปแบบ
   */
  validate() {
    const errors = [];
    if (this.#username.length < 3 || this.#username.length > 100) {
      errors.push({ field: 'username', message: 'ชื่อผู้ใช้ต้องยาว 3–100 ตัวอักษร' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(this.#email)) {
      errors.push({ field: 'email', message: 'รูปแบบอีเมลไม่ถูกต้อง' });
    }
    if (!this.#passwordHash) {
      errors.push({ field: 'password', message: 'ต้องกำหนดรหัสผ่าน' });
    }
    if (!this.#fullName) {
      errors.push({ field: 'fullName', message: 'กรุณากรอกชื่อ-นามสกุล' });
    }
    if (!STATUSES.includes(this.#status)) {
      errors.push({ field: 'status', message: `สถานะต้องเป็นหนึ่งใน: ${STATUSES.join(', ')}` });
    }
    if (errors.length) throw new ValidationError('ข้อมูลผู้ใช้ไม่ถูกต้อง', errors);
  }

  /**
   * แปลงเป็นโครงสร้างที่ปลอดภัยสำหรับส่งออก
   *
   * **ไม่มี `passwordHash` และ `hashAlgo` ในผลลัพธ์โดยเด็ดขาด**
   *
   * @returns {object}
   */
  toJSON() {
    return {
      id: this.id,
      username: this.#username,
      email: this.#email,
      fullName: this.#fullName,
      phone: this.#phone,
      status: this.#status,
      isSuperAdmin: this.#isSuperAdmin,
      mustChangePassword: this.#mustChangePassword,
      isLocked: this.isLocked,
      lockedUntil: this.#lockedUntil,
      lastLoginAt: this.#lastLoginAt,
      lastLoginIp: this.#lastLoginIp,
      roles: this.#roles.map((role) => ({ key: role.roleKey, name: role.name })),
      permissions: this.permissions,
      stationIds: this.stationIds,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
