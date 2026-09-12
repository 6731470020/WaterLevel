import { AsyncLocalStorage } from 'node:async_hooks';
import mysql from 'mysql2/promise';
import { Database } from './Database.js';
import { MySqlDialect } from './dialects/MySqlDialect.js';
import { AppError } from '../errors/index.js';
import { Logger } from '../Logger.js';

/**
 * ตัวเชื่อม MySQL 8 ผ่าน connection pool ของ `mysql2`
 *
 * ตั้ง `timezone: '+07:00'` ให้ตรงกับ `process.env.TZ` เพื่อให้เวลาที่อ่านและเขียน
 * เป็นเวลาไทยเสมอ (CLAUDE.md ข้อ 7.2)
 */
export class MySqlDatabase extends Database {
  /** @type {import('mysql2/promise').Pool} */
  #pool;
  /** @type {object} */
  #options;
  /**
   * การเชื่อมต่อของธุรกรรมที่กำลังเปิดอยู่ในสายการทำงานปัจจุบัน
   *
   * จำเป็นเพราะ pool แจกการเชื่อมต่อคนละเส้นทุกครั้ง ถ้าโค้ดใน callback ของธุรกรรม
   * เผลอเรียก `this.query()` แทน `tx.query()` มันจะไปอ่านจากอีกการเชื่อมต่อหนึ่ง
   * ซึ่งมองไม่เห็นแถวที่ยังไม่คอมมิต — เป็นบั๊กที่หาสาเหตุยากมาก
   * เก็บไว้ใน `AsyncLocalStorage` ทุกคำสั่งในสายนั้นจึงใช้การเชื่อมต่อเดียวกันเสมอ
   *
   * @type {AsyncLocalStorage<{connection: object, depth: number}>}
   */
  #context = new AsyncLocalStorage();

  /**
   * @param {{host: string, port: number, user: string, password: string, database: string, connectionLimit?: number}} options ค่าตั้งค่า
   */
  constructor(options) {
    super(new MySqlDialect());
    this.#options = options;
    this.#pool = mysql.createPool({
      host: options.host,
      port: options.port,
      user: options.user,
      password: options.password,
      database: options.database,
      connectionLimit: options.connectionLimit ?? 10,
      waitForConnections: true,
      queueLimit: 0,
      charset: 'utf8mb4_unicode_ci',
      timezone: '+07:00',
      dateStrings: ['DATE'],
      multipleStatements: false,
    });
  }

  /** @returns {string} ชื่อฐานข้อมูล */
  get name() { return this.#options.database; }

  /** @returns {import('mysql2/promise').Pool} pool ดิบ */
  get pool() { return this.#pool; }

  /**
   * รันคำสั่ง SELECT
   * @param {string} sql คำสั่ง SQL
   * @param {Array<*>} [params=[]] ค่าพารามิเตอร์
   * @returns {Promise<Array<object>>}
   * @throws {AppError} เมื่อคำสั่งล้มเหลว
   */
  async query(sql, params = []) {
    try {
      const [rows] = await this.#executor().query(sql, params);
      return rows;
    } catch (error) {
      Logger.getInstance().error('database query failed', { sql, message: error.message });
      throw new AppError('เกิดข้อผิดพลาดในการเข้าถึงฐานข้อมูล', 500, 'INTERNAL_ERROR');
    }
  }

  /**
   * รันคำสั่งที่เปลี่ยนแปลงข้อมูล
   * @param {string} sql คำสั่ง SQL
   * @param {Array<*>} [params=[]] ค่าพารามิเตอร์
   * @returns {Promise<{insertId: number, affectedRows: number, changedRows: number}>}
   * @throws {AppError} เมื่อคำสั่งล้มเหลว
   */
  async execute(sql, params = []) {
    try {
      const [result] = await this.#executor().query(sql, params);
      return {
        insertId: result.insertId ?? 0,
        affectedRows: result.affectedRows ?? 0,
        changedRows: result.changedRows ?? 0,
      };
    } catch (error) {
      Logger.getInstance().error('database execute failed', { sql, message: error.message });
      throw new AppError('เกิดข้อผิดพลาดในการบันทึกข้อมูล', 500, 'INTERNAL_ERROR');
    }
  }

  /**
   * รันงานภายใน transaction เดียว — commit เมื่อสำเร็จ rollback เมื่อโยนข้อผิดพลาด
   * @template T
   * @param {(tx: object) => Promise<T>} callback งานที่ต้องทำ
   * @returns {Promise<T>}
   */
  async transaction(callback) {
    const active = this.#context.getStore();
    return active
      ? this.#nestedTransaction(active, callback)
      : this.#rootTransaction(callback);
  }

  /**
   * เปิดธุรกรรมชั้นนอกสุด — จองการเชื่อมต่อหนึ่งเส้นไว้ตลอดทั้งสาย
   * @template T
   * @param {(tx: object) => Promise<T>} callback งานที่ต้องทำ
   * @returns {Promise<T>}
   */
  async #rootTransaction(callback) {
    const connection = await this.#pool.getConnection();
    try {
      await connection.beginTransaction();
      const store = { connection, depth: 0 };
      const output = await this.#context.run(
        store, () => callback(MySqlDatabase.#wrap(connection)),
      );
      await connection.commit();
      return output;
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * เปิดธุรกรรมซ้อนด้วย SAVEPOINT บนการเชื่อมต่อเดิม
   *
   * ให้พฤติกรรมตรงกับ `SqliteDatabase` — ธุรกรรมชั้นในที่ล้มจะย้อนเฉพาะงานของตัวเอง
   * และไม่คอมมิตแยกจากชั้นนอก ก่อนหน้านี้ MySQL จะไปจองการเชื่อมต่อใหม่แล้วคอมมิต
   * แยกกัน ทำให้ผลลัพธ์ต่างกันระหว่างสองค่ายฐานข้อมูลโดยไม่มีอะไรบอก
   *
   * @template T
   * @param {{connection: object, depth: number}} active ธุรกรรมที่เปิดอยู่
   * @param {(tx: object) => Promise<T>} callback งานที่ต้องทำ
   * @returns {Promise<T>}
   */
  async #nestedTransaction(active, callback) {
    const { connection } = active;
    active.depth += 1;
    const savepoint = `sp_${active.depth}`;
    await connection.query(`SAVEPOINT ${savepoint}`);
    try {
      const output = await callback(MySqlDatabase.#wrap(connection));
      await connection.query(`RELEASE SAVEPOINT ${savepoint}`);
      return output;
    } catch (error) {
      await connection.query(`ROLLBACK TO SAVEPOINT ${savepoint}`).catch(() => {});
      throw error;
    } finally {
      active.depth -= 1;
    }
  }

  /**
   * ตัวรันคำสั่งที่ควรใช้ ณ ขณะนี้ — การเชื่อมต่อของธุรกรรมถ้ามี มิฉะนั้นใช้ pool
   * @returns {object}
   */
  #executor() {
    return this.#context.getStore()?.connection ?? this.#pool;
  }

  /**
   * ห่อการเชื่อมต่อให้มีหน้าตาเหมือน `tx` ที่ Repository คาดหวัง
   * @param {object} connection การเชื่อมต่อ
   * @returns {{query: Function, queryOne: Function, execute: Function}}
   */
  static #wrap(connection) {
    return {
      query: async (sql, params = []) => {
        const [rows] = await connection.query(sql, params);
        return rows;
      },
      queryOne: async (sql, params = []) => {
        const [rows] = await connection.query(sql, params);
        return rows.length ? rows[0] : null;
      },
      execute: async (sql, params = []) => {
        const [result] = await connection.query(sql, params);
        return {
          insertId: result.insertId ?? 0,
          affectedRows: result.affectedRows ?? 0,
          changedRows: result.changedRows ?? 0,
        };
      },
    };
  }

  /**
   * ตรวจว่าเซิร์ฟเวอร์ยังตอบสนอง
   * @returns {Promise<boolean>}
   */
  async ping() {
    try {
      await this.#pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  /** ปิด connection pool */
  async close() {
    await this.#pool.end().catch(() => {});
  }

  /**
   * ทดสอบการเชื่อมต่อโดยไม่สร้าง pool ค้างไว้ — ใช้ในหน้าตั้งค่าครั้งแรก
   * @param {object} options ค่าตั้งค่าที่ต้องการทดสอบ
   * @returns {Promise<{ok: boolean, message: string}>}
   */
  static async testConnection(options) {
    let connection = null;
    try {
      connection = await mysql.createConnection({
        host: options.host,
        port: Number(options.port) || 3306,
        user: options.user,
        password: options.password,
        database: options.database,
        connectTimeout: 8000,
      });
      await connection.query('SELECT 1');
      return { ok: true, message: `เชื่อมต่อฐานข้อมูล "${options.database}" สำเร็จ` };
    } catch (error) {
      return { ok: false, message: MySqlDatabase.describeError(error) };
    } finally {
      await connection?.end().catch(() => {});
    }
  }

  /**
   * แปลงข้อผิดพลาดของ MySQL เป็นข้อความภาษาไทยที่บอกทางแก้
   * @param {Error & {code?: string}} error ข้อผิดพลาด
   * @returns {string}
   */
  static describeError(error) {
    switch (error.code) {
      case 'ER_ACCESS_DENIED_ERROR':
        return 'ชื่อผู้ใช้หรือรหัสผ่านฐานข้อมูลไม่ถูกต้อง';
      case 'ER_BAD_DB_ERROR':
        return 'ไม่พบฐานข้อมูลชื่อนี้ — กรุณาสร้างฐานข้อมูลก่อน';
      case 'ECONNREFUSED':
        return 'เชื่อมต่อไม่ได้ — เซิร์ฟเวอร์ MySQL อาจไม่ได้ทำงานอยู่ หรือโฮสต์/พอร์ตไม่ถูกต้อง';
      case 'ETIMEDOUT':
        return 'เชื่อมต่อหมดเวลา — ตรวจสอบโฮสต์ พอร์ต และไฟร์วอลล์';
      case 'ENOTFOUND':
        return 'ไม่พบโฮสต์ที่ระบุ';
      default:
        return `เชื่อมต่อไม่สำเร็จ: ${error.message}`;
    }
  }
}
