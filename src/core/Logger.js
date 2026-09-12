import { createWriteStream, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** ระดับความสำคัญของ log เรียงจากน้อยไปมาก */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

/** คีย์ที่ต้องปกปิดเสมอ — ห้ามบันทึกรหัสผ่านหรือ token ลง log (CLAUDE.md ข้อ 13) */
const REDACT_KEYS = [
  'password', 'passwordhash', 'password_hash', 'token', 'accesstoken',
  'access_token', 'secret', 'authorization', 'cookie', 'apikey', 'api_key',
  'csrf', 'sid', 'token_hash',
];

/**
 * ตัวบันทึกเหตุการณ์ของระบบ (Singleton)
 *
 * เขียนพร้อมกันทั้งคอนโซลและไฟล์ `storage/logs/app-YYYY-MM-DD.log`
 * ข้อความใน log เป็นภาษาอังกฤษ (ข้อความที่ผู้ใช้เห็นเป็นภาษาไทย)
 */
export class Logger {
  /** @type {Logger|null} */
  static #instance = null;

  /** @type {number} */
  #minLevel;
  /** @type {string|null} */
  #logDir;
  /** @type {import('node:fs').WriteStream|null} */
  #stream = null;
  /** @type {string|null} */
  #streamDate = null;
  /** @type {boolean} */
  #console;

  /**
   * @param {{level?: string, logDir?: string|null, console?: boolean}} [options={}]
   */
  constructor({ level = 'info', logDir = null, console: toConsole = true } = {}) {
    this.#minLevel = LEVELS[level] ?? LEVELS.info;
    this.#logDir = logDir;
    this.#console = toConsole;
    if (this.#logDir && !existsSync(this.#logDir)) {
      mkdirSync(this.#logDir, { recursive: true });
    }
  }

  /**
   * คืนอินสแตนซ์เดียวของทั้งแอป (Singleton)
   * @returns {Logger}
   */
  static getInstance() {
    if (!Logger.#instance) Logger.#instance = new Logger();
    return Logger.#instance;
  }

  /**
   * ตั้งค่า Singleton ใหม่ตอนแอปเริ่มทำงาน
   * @param {{level?: string, logDir?: string|null, console?: boolean}} options
   * @returns {Logger}
   */
  static configure(options) {
    Logger.#instance = new Logger(options);
    return Logger.#instance;
  }

  /** ล้าง Singleton (ใช้ในชุดทดสอบเท่านั้น) */
  static reset() {
    Logger.#instance?.close();
    Logger.#instance = null;
  }

  /**
   * บันทึกระดับ debug
   * @param {string} message ข้อความ (ภาษาอังกฤษ)
   * @param {object} [context={}] ข้อมูลประกอบ
   */
  debug(message, context = {}) { this.#write('debug', message, context); }

  /**
   * บันทึกระดับ info
   * @param {string} message ข้อความ (ภาษาอังกฤษ)
   * @param {object} [context={}] ข้อมูลประกอบ
   */
  info(message, context = {}) { this.#write('info', message, context); }

  /**
   * บันทึกระดับ warn
   * @param {string} message ข้อความ (ภาษาอังกฤษ)
   * @param {object} [context={}] ข้อมูลประกอบ
   */
  warn(message, context = {}) { this.#write('warn', message, context); }

  /**
   * บันทึกระดับ error — รับ Error object ได้โดยตรง
   * @param {string} message ข้อความ (ภาษาอังกฤษ)
   * @param {Error|object} [errorOrContext={}] ข้อผิดพลาดหรือข้อมูลประกอบ
   */
  error(message, errorOrContext = {}) {
    const context = errorOrContext instanceof Error
      ? { error: errorOrContext.message, name: errorOrContext.name, stack: errorOrContext.stack }
      : errorOrContext;
    this.#write('error', message, context);
  }

  /**
   * สร้าง logger ลูกที่แนบ context ติดไปทุกครั้ง เช่น request id
   * @param {object} boundContext context ที่ผูกติด
   * @returns {{debug: Function, info: Function, warn: Function, error: Function}}
   */
  child(boundContext) {
    const parent = this;
    return {
      debug: (m, c = {}) => parent.debug(m, { ...boundContext, ...c }),
      info:  (m, c = {}) => parent.info(m, { ...boundContext, ...c }),
      warn:  (m, c = {}) => parent.warn(m, { ...boundContext, ...c }),
      error: (m, c = {}) => parent.error(m, { ...boundContext, ...c }),
    };
  }

  /** ปิดสตรีมไฟล์ log */
  close() {
    this.#stream?.end();
    this.#stream = null;
    this.#streamDate = null;
  }

  /**
   * เขียน log จริง — จัดรูปแบบและปกปิดค่าลับก่อนเสมอ
   * @param {string} level ระดับ
   * @param {string} message ข้อความ
   * @param {object} context ข้อมูลประกอบ
   */
  #write(level, message, context) {
    if (LEVELS[level] < this.#minLevel) return;
    const now = new Date();
    const safeContext = Logger.#redact(context);
    const hasContext = safeContext && Object.keys(safeContext).length > 0;

    if (this.#console) {
      const stamp = now.toLocaleString('sv-SE');
      const tag = level.toUpperCase().padEnd(5);
      const tail = hasContext ? ` ${JSON.stringify(safeContext)}` : '';
      const line = `[${stamp}] ${tag} ${message}${tail}`;
      if (level === 'error') process.stderr.write(`${line}\n`);
      else process.stdout.write(`${line}\n`);
    }

    if (this.#logDir) {
      const record = JSON.stringify({
        ts: now.toISOString(), level, message,
        ...(hasContext ? { context: safeContext } : {}),
      });
      this.#fileStream(now).write(`${record}\n`);
    }
  }

  /**
   * คืนสตรีมไฟล์ของวันนี้ สร้างใหม่เมื่อข้ามวัน
   * @param {Date} now เวลาปัจจุบัน
   * @returns {import('node:fs').WriteStream}
   */
  #fileStream(now) {
    const date = now.toLocaleDateString('sv-SE');
    if (this.#streamDate !== date) {
      this.#stream?.end();
      this.#stream = createWriteStream(join(this.#logDir, `app-${date}.log`), { flags: 'a' });
      this.#streamDate = date;
    }
    return this.#stream;
  }

  /**
   * ปกปิดค่าลับในวัตถุแบบเรียกซ้ำ
   * @param {*} value ค่าที่ต้องการทำความสะอาด
   * @param {number} [depth=0] ความลึกปัจจุบัน
   * @returns {*}
   */
  static #redact(value, depth = 0) {
    if (depth > 4 || value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((item) => Logger.#redact(item, depth + 1));
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = REDACT_KEYS.includes(key.toLowerCase())
        ? '[REDACTED]'
        : Logger.#redact(item, depth + 1);
    }
    return output;
  }
}
