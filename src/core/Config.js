import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ValidationError } from './errors/index.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * ตัวอ่านและตรวจสอบค่าตั้งค่าจาก `.env` (Singleton)
 *
 * ห่อหุ้ม `process.env` ไว้ทั้งหมด — ชั้นอื่นห้ามอ่าน `process.env` โดยตรง
 * เพื่อให้มีจุดเดียวที่ตรวจว่าค่าที่จำเป็นครบและอยู่ในรูปแบบที่ถูกต้อง
 */
export class Config {
  /** @type {Config|null} */
  static #instance = null;

  /** @type {Map<string, string>} */
  #values = new Map();
  /** @type {string} */
  #root = PROJECT_ROOT;

  /**
   * @param {Record<string, string>} [source=process.env] แหล่งค่าตั้งค่า
   * @throws {ValidationError} เมื่อค่าที่จำเป็นขาดหายในโหมด production
   */
  constructor(source = process.env) {
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined) this.#values.set(key, String(value));
    }
    this.#validateRequired();
  }

  /**
   * คืนอินสแตนซ์เดียวของทั้งแอป (Singleton)
   * @returns {Config}
   */
  static getInstance() {
    if (!Config.#instance) Config.#instance = new Config();
    return Config.#instance;
  }

  /**
   * โหลดไฟล์ `.env` เข้าสู่ `process.env` แล้วสร้าง Singleton
   * เขียนตัวอ่านเองเพื่อไม่ให้ขึ้นกับลำดับการ import ของ dotenv
   * @param {string} [envPath] พาธไฟล์ .env (ค่าเริ่มต้น = รากโปรเจกต์)
   * @returns {Config}
   */
  static bootstrap(envPath = join(PROJECT_ROOT, '.env')) {
    if (existsSync(envPath)) {
      const text = readFileSync(envPath, 'utf8');
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = value;
      }
    }
    Config.#instance = new Config();
    return Config.#instance;
  }

  /** ล้าง Singleton (ใช้ในชุดทดสอบเท่านั้น) */
  static reset() { Config.#instance = null; }

  /** @returns {string} พาธรากโปรเจกต์ */
  get root() { return this.#root; }

  /**
   * อ่านค่าเป็นสตริง
   * @param {string} key ชื่อค่า
   * @param {string|null} [fallback=null] ค่าเริ่มต้นเมื่อไม่พบ
   * @returns {string|null}
   */
  get(key, fallback = null) {
    const value = this.#values.get(key);
    return value === undefined || value === '' ? fallback : value;
  }

  /**
   * อ่านค่าที่ต้องมีเสมอ
   * @param {string} key ชื่อค่า
   * @returns {string}
   * @throws {ValidationError} เมื่อไม่มีค่านั้น
   */
  require(key) {
    const value = this.get(key);
    if (value === null) {
      throw new ValidationError(`ไม่พบค่าตั้งค่าที่จำเป็น: ${key} — กรุณาตรวจไฟล์ .env`);
    }
    return value;
  }

  /**
   * อ่านค่าเป็นจำนวนเต็ม
   * @param {string} key ชื่อค่า
   * @param {number} fallback ค่าเริ่มต้น
   * @returns {number}
   */
  int(key, fallback) {
    const value = Number.parseInt(this.get(key, ''), 10);
    return Number.isFinite(value) ? value : fallback;
  }

  /**
   * อ่านค่าเป็นทศนิยม
   * @param {string} key ชื่อค่า
   * @param {number} fallback ค่าเริ่มต้น
   * @returns {number}
   */
  float(key, fallback) {
    const value = Number.parseFloat(this.get(key, ''));
    return Number.isFinite(value) ? value : fallback;
  }

  /**
   * อ่านค่าเป็นบูลีน — รับ `true`, `1`, `yes`, `on` (ไม่สนตัวพิมพ์)
   * @param {string} key ชื่อค่า
   * @param {boolean} [fallback=false] ค่าเริ่มต้น
   * @returns {boolean}
   */
  bool(key, fallback = false) {
    const value = this.get(key);
    if (value === null) return fallback;
    return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
  }

  /** @returns {boolean} รันอยู่ในโหมดใช้งานจริงหรือไม่ */
  get isProduction() { return this.get('NODE_ENV', 'development') === 'production'; }

  /** @returns {boolean} รันอยู่ในโหมดทดสอบหรือไม่ */
  get isTest() { return this.get('NODE_ENV', 'development') === 'test'; }

  /** @returns {string} URL ฐานของระบบ ไม่มี `/` ปิดท้าย */
  get baseUrl() { return this.get('BASE_URL', 'http://localhost:3000').replace(/\/+$/, ''); }

  /** @returns {string} พาธโฟลเดอร์เก็บไฟล์ (absolute) */
  get storagePath() {
    return resolve(this.#root, this.get('STORAGE_PATH', './storage'));
  }

  /**
   * ค่าตั้งค่าการเชื่อมต่อฐานข้อมูล
   *
   * รองรับสองไดรเวอร์: `sqlite` (ไฟล์เดียว ไม่ต้องมีเซิร์ฟเวอร์) และ `mysql`
   * `DatabaseFactory` เป็นผู้เลือกคลาสที่ตรงกับค่า `driver`
   *
   * @returns {{driver: string, file?: string, host?: string, port?: number, user?: string, password?: string, database?: string, connectionLimit?: number}}
   */
  get database() {
    const driver = String(this.get('DB_DRIVER', 'sqlite')).toLowerCase();

    if (driver === 'sqlite') {
      return {
        driver,
        file: resolve(this.#root, this.get('DB_FILE', './storage/waterlevel.db')),
      };
    }

    return {
      driver,
      host: this.get('DB_HOST', 'localhost'),
      port: this.int('DB_PORT', 3306),
      user: this.get('DB_USER', 'root'),
      password: this.get('DB_PASSWORD', ''),
      database: this.get('DB_NAME', 'waterlevel'),
      connectionLimit: this.int('DB_CONNECTION_LIMIT', 10),
    };
  }

  /** @returns {string} ไดรเวอร์ฐานข้อมูลที่ใช้อยู่ */
  get databaseDriver() { return String(this.get('DB_DRIVER', 'sqlite')).toLowerCase(); }

  /** @returns {boolean} ตั้งค่าฐานข้อมูลไว้แล้วหรือยัง (ใช้ตัดสินว่าต้องเข้าหน้าตั้งค่าครั้งแรกหรือไม่) */
  get hasDatabaseConfig() {
    if (this.get('DB_DRIVER') === null) return false;
    if (this.databaseDriver === 'sqlite') return true;
    return this.get('DB_NAME') !== null && this.get('DB_USER') !== null;
  }

  /** @returns {string} พาธไฟล์ `.env` ที่ระบบใช้อยู่ */
  get envPath() { return join(this.#root, '.env'); }

  /**
   * โหลดค่าจากไฟล์ `.env` ใหม่ทั้งหมด — ใช้หลังหน้าตั้งค่าเขียนไฟล์เสร็จ
   * @returns {Config} อินสแตนซ์ Singleton ตัวใหม่
   */
  static reload() {
    for (const key of ['DB_DRIVER', 'DB_FILE', 'DB_HOST', 'DB_PORT',
      'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'SESSION_SECRET']) {
      delete process.env[key];
    }
    return Config.bootstrap();
  }

  /**
   * ค่าคงที่ทางธุรกิจของการตรวจความผันผวน (ดู CLAUDE.md ข้อ 6.4)
   * @returns {{maxVariationPx: number, confirmationAttempts: number, confirmationDelayMs: number, consistencyThresholdPx: number}}
   */
  get variation() {
    return {
      maxVariationPx: this.int('MAX_VARIATION_PX', 50),
      confirmationAttempts: this.int('CONFIRMATION_ATTEMPTS', 3),
      confirmationDelayMs: this.int('CONFIRMATION_DELAY_SEC', 10) * 1000,
      consistencyThresholdPx: this.int('CONSISTENCY_THRESHOLD_PX', 25),
    };
  }

  /**
   * ตรวจว่าค่าที่จำเป็นครบถ้วน — เข้มงวดเฉพาะโหมด production
   * @throws {ValidationError}
   */
  #validateRequired() {
    if (this.get('NODE_ENV', 'development') !== 'production') return;
    const required = String(this.get('DB_DRIVER', 'sqlite')).toLowerCase() === 'sqlite'
      ? ['SESSION_SECRET', 'BASE_URL']
      : ['SESSION_SECRET', 'BASE_URL', 'DB_NAME', 'DB_USER'];

    const missing = [];
    for (const key of required) {
      if (this.get(key) === null) missing.push(key);
    }
    const secret = this.get('SESSION_SECRET', '');
    if (secret && secret.length < 32) {
      throw new ValidationError('SESSION_SECRET ต้องยาวอย่างน้อย 32 ตัวอักษร');
    }
    if (missing.length) {
      throw new ValidationError(`ไฟล์ .env ขาดค่าที่จำเป็น: ${missing.join(', ')}`);
    }
  }
}
