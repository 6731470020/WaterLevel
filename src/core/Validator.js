import { ValidationError } from './errors/index.js';

/**
 * ตัวตรวจข้อมูลนำเข้าแบบมีกฎ — เขียนเองแทนการใช้ไลบรารีภายนอก (CLAUDE.md ข้อ 15)
 *
 * ใช้รูปแบบต่อเมท็อดเป็นทอด (fluent) แล้วเรียก `validate()` ครั้งเดียวเพื่อรวบรวม
 * ข้อผิดพลาดทั้งหมดพร้อมกัน ผู้ใช้จึงเห็นทุกช่องที่ผิดในครั้งเดียว
 *
 * @example
 * const data = new Validator(req.body)
 *   .required('username', 'ชื่อผู้ใช้')
 *   .string('username', { min: 3, max: 100 })
 *   .email('email', 'อีเมล')
 *   .integer('stationId', { min: 1 })
 *   .validate();
 */
export class Validator {
  /** @type {object} */
  #source;
  /** @type {Array<{field: string, message: string}>} */
  #errors = [];
  /** @type {object} */
  #clean = {};
  /** @type {Set<string>} */
  #failed = new Set();

  /** @param {object} [source={}] ข้อมูลนำเข้า เช่น `req.body` */
  constructor(source = {}) {
    this.#source = source && typeof source === 'object' ? source : {};
  }

  /**
   * ค่าดิบของฟิลด์
   * @param {string} field ชื่อฟิลด์
   * @returns {*}
   */
  raw(field) { return this.#source[field]; }

  /**
   * บังคับว่าต้องมีค่า และไม่ใช่สตริงว่าง
   * @param {string} field ชื่อฟิลด์
   * @param {string} [label] ชื่อที่แสดงต่อผู้ใช้
   * @returns {this}
   */
  required(field, label = field) {
    const value = this.#source[field];
    if (value === undefined || value === null || String(value).trim() === '') {
      this.#fail(field, `กรุณากรอก${label}`);
    }
    return this;
  }

  /**
   * ตรวจสตริงพร้อมกำหนดความยาว
   * @param {string} field ชื่อฟิลด์
   * @param {{min?: number, max?: number, label?: string, trim?: boolean, optional?: boolean}} [options={}]
   * @returns {this}
   */
  string(field, { min = 0, max = 65535, label = field, trim = true, optional = true } = {}) {
    if (this.#skip(field, optional)) return this;
    const value = trim ? String(this.#source[field] ?? '').trim() : String(this.#source[field] ?? '');
    if (value.length < min) this.#fail(field, `${label} ต้องยาวอย่างน้อย ${min} ตัวอักษร`);
    else if (value.length > max) this.#fail(field, `${label} ต้องยาวไม่เกิน ${max} ตัวอักษร`);
    else this.#clean[field] = value;
    return this;
  }

  /**
   * ตรวจจำนวนเต็มพร้อมช่วงค่า
   * @param {string} field ชื่อฟิลด์
   * @param {{min?: number, max?: number, label?: string, optional?: boolean}} [options={}]
   * @returns {this}
   */
  integer(field, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, label = field, optional = true } = {}) {
    if (this.#skip(field, optional)) return this;
    const value = Number(this.#source[field]);
    if (!Number.isInteger(value)) this.#fail(field, `${label} ต้องเป็นจำนวนเต็ม`);
    else if (value < min || value > max) this.#fail(field, `${label} ต้องอยู่ระหว่าง ${min} ถึง ${max}`);
    else this.#clean[field] = value;
    return this;
  }

  /**
   * ตรวจตัวเลขทศนิยมพร้อมช่วงค่า
   * @param {string} field ชื่อฟิลด์
   * @param {{min?: number, max?: number, label?: string, optional?: boolean}} [options={}]
   * @returns {this}
   */
  number(field, { min = -Infinity, max = Infinity, label = field, optional = true } = {}) {
    if (this.#skip(field, optional)) return this;
    const value = Number(this.#source[field]);
    if (!Number.isFinite(value)) this.#fail(field, `${label} ต้องเป็นตัวเลข`);
    else if (value < min || value > max) this.#fail(field, `${label} ต้องอยู่ระหว่าง ${min} ถึง ${max}`);
    else this.#clean[field] = value;
    return this;
  }

  /**
   * ตรวจรูปแบบอีเมล
   * @param {string} field ชื่อฟิลด์
   * @param {string} [label='อีเมล'] ชื่อที่แสดง
   * @param {{optional?: boolean}} [options={}]
   * @returns {this}
   */
  email(field, label = 'อีเมล', { optional = true } = {}) {
    if (this.#skip(field, optional)) return this;
    const value = String(this.#source[field] ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) || value.length > 255) {
      this.#fail(field, `รูปแบบ${label}ไม่ถูกต้อง`);
    } else {
      this.#clean[field] = value;
    }
    return this;
  }

  /**
   * ตรวจว่าค่าอยู่ในรายการที่อนุญาต
   * @param {string} field ชื่อฟิลด์
   * @param {Array<string>} allowed ค่าที่อนุญาต
   * @param {{label?: string, optional?: boolean}} [options={}]
   * @returns {this}
   */
  oneOf(field, allowed, { label = field, optional = true } = {}) {
    if (this.#skip(field, optional)) return this;
    const value = String(this.#source[field] ?? '');
    if (!allowed.includes(value)) this.#fail(field, `${label} ต้องเป็นหนึ่งใน: ${allowed.join(', ')}`);
    else this.#clean[field] = value;
    return this;
  }

  /**
   * แปลงค่าเป็นบูลีน — รับได้ทั้ง checkbox ของ HTML และ JSON
   * @param {string} field ชื่อฟิลด์
   * @param {boolean} [fallback=false] ค่าเริ่มต้นเมื่อไม่ส่งมา
   * @returns {this}
   */
  boolean(field, fallback = false) {
    const value = this.#source[field];
    if (value === undefined || value === null || value === '') this.#clean[field] = fallback;
    else this.#clean[field] = ['1', 'true', 'on', 'yes'].includes(String(value).toLowerCase()) || value === true;
    return this;
  }

  /**
   * ตรวจ URL ของกล้อง — ต้องเป็น http/https และกัน SSRF ไปยัง IP ภายใน
   * @param {string} field ชื่อฟิลด์
   * @param {{allowPrivate?: boolean, label?: string, optional?: boolean}} [options={}]
   * @returns {this}
   */
  url(field, { allowPrivate = false, label = 'URL', optional = true } = {}) {
    if (this.#skip(field, optional)) return this;
    const value = String(this.#source[field] ?? '').trim();
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      this.#fail(field, `รูปแบบ${label}ไม่ถูกต้อง`);
      return this;
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      this.#fail(field, `${label} ต้องขึ้นต้นด้วย http:// หรือ https://`);
      return this;
    }
    if (!allowPrivate && Validator.isPrivateHost(parsed.hostname)) {
      this.#fail(field, `${label} ต้องไม่ชี้ไปยังเครือข่ายภายใน`);
      return this;
    }
    this.#clean[field] = value;
    return this;
  }

  /**
   * ตรวจรูปแบบวันที่ `YYYY-MM-DD`
   * @param {string} field ชื่อฟิลด์
   * @param {{label?: string, optional?: boolean}} [options={}]
   * @returns {this}
   */
  date(field, { label = 'วันที่', optional = true } = {}) {
    if (this.#skip(field, optional)) return this;
    const value = String(this.#source[field] ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
      this.#fail(field, `รูปแบบ${label}ต้องเป็น ปปปป-ดด-วว`);
    } else {
      this.#clean[field] = value;
    }
    return this;
  }

  /**
   * ตรวจค่าสีแบบ hex เช่น `#EF4444` หรือ `EF4444`
   * @param {string} field ชื่อฟิลด์
   * @param {{label?: string, optional?: boolean}} [options={}]
   * @returns {this}
   */
  hexColor(field, { label = 'สี', optional = true } = {}) {
    if (this.#skip(field, optional)) return this;
    const value = String(this.#source[field] ?? '').trim().replace(/^#/, '').toUpperCase();
    if (!/^[0-9A-F]{6}$/.test(value)) this.#fail(field, `รูปแบบ${label}ไม่ถูกต้อง (ต้องเป็นรหัส hex 6 หลัก)`);
    else this.#clean[field] = value;
    return this;
  }

  /**
   * เพิ่มกฎเฉพาะกิจ
   * @param {string} field ชื่อฟิลด์
   * @param {(value: *) => boolean} predicate เงื่อนไขที่ต้องเป็นจริง
   * @param {string} message ข้อความเมื่อไม่ผ่าน
   * @returns {this}
   */
  custom(field, predicate, message) {
    if (!predicate(this.#source[field])) this.#fail(field, message);
    return this;
  }

  /**
   * รวบรวมผลและคืนข้อมูลที่ผ่านการทำความสะอาดแล้ว
   * @returns {object} ค่าที่สะอาดของทุกฟิลด์ที่ผ่าน
   * @throws {ValidationError} เมื่อมีฟิลด์ใดไม่ผ่าน
   */
  validate() {
    if (this.#errors.length) {
      throw new ValidationError('ข้อมูลที่กรอกไม่ถูกต้อง', this.#errors);
    }
    return this.#clean;
  }

  /** @returns {boolean} true เมื่อยังไม่พบข้อผิดพลาด */
  get passes() { return this.#errors.length === 0; }

  /** @returns {Array<{field: string, message: string}>} รายการข้อผิดพลาดที่พบ */
  get errors() { return [...this.#errors]; }

  /**
   * ตรวจว่า hostname ชี้ไปยังเครือข่ายภายในหรือไม่ (ป้องกัน SSRF — CLAUDE.md ข้อ 13)
   * @param {string} hostname ชื่อโฮสต์หรือ IP
   * @returns {boolean}
   */
  static isPrivateHost(hostname) {
    const host = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
    if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
    if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true;
    const parts = host.split('.');
    if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) return false;
    const [a, b] = parts.map(Number);
    if (parts.some((p) => Number(p) > 255)) return false;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }

  /**
   * บันทึกข้อผิดพลาดของฟิลด์ (ฟิลด์ละหนึ่งข้อความ)
   * @param {string} field ชื่อฟิลด์
   * @param {string} message ข้อความภาษาไทย
   */
  #fail(field, message) {
    if (this.#failed.has(field)) return;
    this.#failed.add(field);
    this.#errors.push({ field, message });
  }

  /**
   * ตัดสินว่าจะข้ามการตรวจฟิลด์นี้หรือไม่
   * @param {string} field ชื่อฟิลด์
   * @param {boolean} optional เป็นฟิลด์ที่ไม่บังคับหรือไม่
   * @returns {boolean} true = ข้าม
   */
  #skip(field, optional) {
    if (this.#failed.has(field)) return true;
    const value = this.#source[field];
    const empty = value === undefined || value === null || value === '';
    if (empty && optional) return true;
    if (empty && !optional) {
      this.#fail(field, `กรุณากรอก ${field}`);
      return true;
    }
    return false;
  }
}
