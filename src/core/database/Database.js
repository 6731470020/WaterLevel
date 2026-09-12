import { AppError, NotImplementedError } from '../errors/index.js';

/**
 * คลาสนามธรรมของตัวเชื่อมฐานข้อมูล (Strategy Pattern)
 *
 * ระบบรองรับสองค่ายที่ทำงานต่างกันสิ้นเชิง:
 * - `MySqlDatabase` — เซิร์ฟเวอร์แยก รองรับผู้ใช้พร้อมกันมาก เหมาะกับการใช้งานจริง
 * - `SqliteDatabase` — ไฟล์เดียวบนดิสก์ ไม่ต้องติดตั้งเซิร์ฟเวอร์ เหมาะกับหน่วยงานเล็ก
 *
 * ชั้น Repository เรียก `query()` / `execute()` / `transaction()` เหมือนกันทุกประการ
 * ความต่างของภาษา SQL ถูกห่อไว้ใน `SqlDialect` ที่แต่ละตัวถือไว้
 *
 * ทุกคำสั่งใช้ prepared statement (`?`) ห้ามต่อสตริง SQL เด็ดขาด (CLAUDE.md ข้อ 13)
 *
 * @abstract
 */
export class Database {
  /** @type {Database|null} */
  static #instance = null;

  /** @type {import('./dialects/SqlDialect.js').SqlDialect} */
  #dialect;

  /**
   * @param {import('./dialects/SqlDialect.js').SqlDialect} dialect ภาษา SQL ที่ใช้
   * @throws {NotImplementedError} เมื่อสร้างวัตถุจากคลาสนามธรรมโดยตรง
   */
  constructor(dialect) {
    if (new.target === Database) {
      throw new NotImplementedError('Database เป็นคลาสนามธรรม สร้างวัตถุโดยตรงไม่ได้');
    }
    this.#dialect = dialect;
  }

  /**
   * คืนอินสแตนซ์เดียวของทั้งแอป (Singleton)
   * @returns {Database}
   * @throws {AppError} เมื่อยังไม่ได้ลงทะเบียนอินสแตนซ์
   */
  static getInstance() {
    if (!Database.#instance) {
      throw new AppError('ยังไม่ได้ตั้งค่าการเชื่อมต่อฐานข้อมูล', 500, 'INTERNAL_ERROR');
    }
    return Database.#instance;
  }

  /**
   * ลงทะเบียนอินสแตนซ์เป็น Singleton ของทั้งแอป
   * @param {Database} instance ตัวเชื่อมที่สร้างแล้ว
   * @returns {Database}
   */
  static use(instance) {
    Database.#instance = instance;
    return instance;
  }

  /** @returns {boolean} ลงทะเบียน Singleton ไว้แล้วหรือยัง */
  static get isConfigured() { return Database.#instance !== null; }

  /** ปิดและล้าง Singleton (ใช้ตอนปิดแอปหรือในชุดทดสอบ) */
  static async reset() {
    await Database.#instance?.close();
    Database.#instance = null;
  }

  /** @returns {import('./dialects/SqlDialect.js').SqlDialect} ภาษา SQL ที่ใช้ */
  get dialect() { return this.#dialect; }

  /** @returns {string} ชื่อไดรเวอร์ (`mysql` | `sqlite`) */
  get driver() { return this.#dialect.name; }

  /**
   * ชื่อฐานข้อมูลหรือพาธไฟล์ที่กำลังใช้ — แสดงในหน้าตั้งค่าและ log
   * @abstract
   * @returns {string}
   * @throws {NotImplementedError} เมื่อคลาสลูกไม่ override
   */
  get name() {
    throw new NotImplementedError(`${this.constructor.name} ต้อง override name`);
  }

  /**
   * รันคำสั่ง SELECT แล้วคืนแถวทั้งหมด
   * @abstract
   * @param {string} sql คำสั่ง SQL ที่ใช้ `?` เป็นตัวยึด
   * @param {Array<*>} [params=[]] ค่าพารามิเตอร์
   * @returns {Promise<Array<object>>}
   * @throws {NotImplementedError} เมื่อคลาสลูกไม่ override
   */
  async query(sql, params = []) {
    throw new NotImplementedError(`${this.constructor.name} ต้อง override query()`);
  }

  /**
   * รัน SELECT แล้วคืนแถวแรกหรือ null
   * @param {string} sql คำสั่ง SQL
   * @param {Array<*>} [params=[]] ค่าพารามิเตอร์
   * @returns {Promise<object|null>}
   */
  async queryOne(sql, params = []) {
    const rows = await this.query(sql, params);
    return rows.length ? rows[0] : null;
  }

  /**
   * รันคำสั่งที่เปลี่ยนแปลงข้อมูล
   * @abstract
   * @param {string} sql คำสั่ง SQL
   * @param {Array<*>} [params=[]] ค่าพารามิเตอร์
   * @returns {Promise<{insertId: number, affectedRows: number}>}
   * @throws {NotImplementedError} เมื่อคลาสลูกไม่ override
   */
  async execute(sql, params = []) {
    throw new NotImplementedError(`${this.constructor.name} ต้อง override execute()`);
  }

  /**
   * รันหลายคำสั่งภายใน transaction เดียว
   * @abstract
   * @template T
   * @param {(tx: {query: Function, queryOne: Function, execute: Function}) => Promise<T>} callback งานที่ต้องทำ
   * @returns {Promise<T>}
   * @throws {NotImplementedError} เมื่อคลาสลูกไม่ override
   */
  async transaction(callback) {
    throw new NotImplementedError(`${this.constructor.name} ต้อง override transaction()`);
  }

  /**
   * รันคำสั่ง DDL หลายคำสั่ง (ใช้ตอน migration)
   * @param {Array<string>} statements รายการคำสั่ง
   * @returns {Promise<void>}
   */
  async runStatements(statements) {
    for (const statement of statements) {
      await this.execute(statement);
    }
  }

  /**
   * ตรวจว่าฐานข้อมูลยังตอบสนอง — ใช้ใน `GET /health`
   * @abstract
   * @returns {Promise<boolean>}
   * @throws {NotImplementedError} เมื่อคลาสลูกไม่ override
   */
  async ping() {
    throw new NotImplementedError(`${this.constructor.name} ต้อง override ping()`);
  }

  /**
   * ปิดการเชื่อมต่อ
   * @abstract
   * @returns {Promise<void>}
   * @throws {NotImplementedError} เมื่อคลาสลูกไม่ override
   */
  async close() {
    throw new NotImplementedError(`${this.constructor.name} ต้อง override close()`);
  }
}
