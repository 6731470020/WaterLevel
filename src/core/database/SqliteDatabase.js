import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Database } from './Database.js';
import { SqliteDialect } from './dialects/SqliteDialect.js';
import { AppError } from '../errors/index.js';
import { Logger } from '../Logger.js';

/**
 * ตัวเชื่อม SQLite ผ่านโมดูล `node:sqlite` ที่มากับ Node 22
 *
 * เลือกใช้โมดูลในตัวแทนไลบรารีภายนอกเพราะ**ไม่ต้อง compile native module**
 * ซึ่งตรงกับข้อกำหนดของโปรเจกต์ที่ห้ามมีขั้นตอน build
 *
 * เหมาะกับหน่วยงานเล็กที่มีจุดวัดไม่กี่แห่ง — ไม่ต้องติดตั้งเซิร์ฟเวอร์ฐานข้อมูลเลย
 * ข้อจำกัด: เขียนพร้อมกันได้ทีละคำสั่ง (เปิด WAL ช่วยให้อ่านขณะเขียนได้)
 *
 * **ข้อควรระวังของ `node:sqlite`:**
 * - เป็น API แบบซิงโครนัส คลาสนี้จึงห่อเป็น async เพื่อให้สัญญาเหมือน `MySqlDatabase`
 * - รับพารามิเตอร์ได้เฉพาะ null, number, string, bigint และ Buffer
 *   จึงต้องแปลง `Date` และ `boolean` ก่อนส่งเสมอ
 */
export class SqliteDatabase extends Database {
  /** @type {DatabaseSync} */
  #db;
  /** @type {string} */
  #file;
  /** @type {number} */
  #transactionDepth = 0;

  /**
   * @param {{file: string}} options ค่าตั้งค่า
   * @throws {AppError} เมื่อเปิดไฟล์ฐานข้อมูลไม่ได้
   */
  constructor({ file }) {
    super(new SqliteDialect());
    this.#file = resolve(file);

    const folder = dirname(this.#file);
    if (!existsSync(folder)) mkdirSync(folder, { recursive: true });

    try {
      this.#db = new DatabaseSync(this.#file);
      // WAL ให้อ่านขณะเขียนได้ · foreign_keys ต้องเปิดเองทุกการเชื่อมต่อ
      this.#db.exec('PRAGMA journal_mode = WAL');
      this.#db.exec('PRAGMA foreign_keys = ON');
      this.#db.exec('PRAGMA busy_timeout = 5000');
    } catch (error) {
      throw new AppError(
        `เปิดไฟล์ฐานข้อมูล SQLite ไม่ได้: ${error.message}`, 500, 'INTERNAL_ERROR',
      );
    }
  }

  /** @returns {string} พาธไฟล์ฐานข้อมูล */
  get name() { return this.#file; }

  /**
   * รันคำสั่ง SELECT
   * @param {string} sql คำสั่ง SQL
   * @param {Array<*>} [params=[]] ค่าพารามิเตอร์
   * @returns {Promise<Array<object>>}
   * @throws {AppError} เมื่อคำสั่งล้มเหลว
   */
  async query(sql, params = []) {
    try {
      return this.#db.prepare(sql).all(...SqliteDatabase.#bind(params));
    } catch (error) {
      Logger.getInstance().error('database query failed', { sql, message: error.message });
      throw new AppError('เกิดข้อผิดพลาดในการเข้าถึงฐานข้อมูล', 500, 'INTERNAL_ERROR');
    }
  }

  /**
   * รันคำสั่งที่เปลี่ยนแปลงข้อมูล
   *
   * คำสั่งที่มี `RETURNING` ต้องใช้ `all()` แทน `run()` เพราะคืนแถวกลับมา
   *
   * @param {string} sql คำสั่ง SQL
   * @param {Array<*>} [params=[]] ค่าพารามิเตอร์
   * @returns {Promise<{insertId: number, affectedRows: number, changedRows: number, rows: Array<object>}>}
   * @throws {AppError} เมื่อคำสั่งล้มเหลว
   */
  async execute(sql, params = []) {
    try {
      const bound = SqliteDatabase.#bind(params);

      if (/\bRETURNING\b/i.test(sql)) {
        const rows = this.#db.prepare(sql).all(...bound);
        return {
          insertId: Number(rows[0]?.id ?? 0),
          affectedRows: rows.length,
          changedRows: rows.length,
          rows,
        };
      }

      // คำสั่ง DDL ที่ไม่มีพารามิเตอร์ใช้ exec() เพราะ prepare() รับได้ทีละคำสั่ง
      if (!bound.length && /^\s*(CREATE|DROP|ALTER|PRAGMA)\b/i.test(sql)) {
        this.#db.exec(sql);
        return { insertId: 0, affectedRows: 0, changedRows: 0, rows: [] };
      }

      const result = this.#db.prepare(sql).run(...bound);
      return {
        insertId: Number(result.lastInsertRowid ?? 0),
        affectedRows: Number(result.changes ?? 0),
        changedRows: Number(result.changes ?? 0),
        rows: [],
      };
    } catch (error) {
      Logger.getInstance().error('database execute failed', { sql, message: error.message });
      throw new AppError('เกิดข้อผิดพลาดในการบันทึกข้อมูล', 500, 'INTERNAL_ERROR');
    }
  }

  /**
   * รันงานภายใน transaction เดียว
   *
   * รองรับการซ้อนกันด้วย SAVEPOINT เพราะ Repository บางตัวเรียก transaction
   * ซ้อนกันได้เมื่อถูกเรียกจาก Service ที่อยู่ใน transaction อยู่แล้ว
   *
   * @template T
   * @param {(tx: object) => Promise<T>} callback งานที่ต้องทำ
   * @returns {Promise<T>}
   */
  async transaction(callback) {
    const depth = this.#transactionDepth;
    const savepoint = `sp_${depth}`;

    if (depth === 0) this.#db.exec('BEGIN');
    else this.#db.exec(`SAVEPOINT ${savepoint}`);
    this.#transactionDepth += 1;

    const tx = {
      query: (sql, params = []) => this.query(sql, params),
      queryOne: (sql, params = []) => this.queryOne(sql, params),
      execute: (sql, params = []) => this.execute(sql, params),
    };

    try {
      const output = await callback(tx);
      if (depth === 0) this.#db.exec('COMMIT');
      else this.#db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return output;
    } catch (error) {
      try {
        if (depth === 0) this.#db.exec('ROLLBACK');
        else this.#db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      } catch { /* ไม่มีอะไรทำได้เพิ่มหากย้อนกลับไม่สำเร็จ */ }
      throw error;
    } finally {
      this.#transactionDepth -= 1;
    }
  }

  /**
   * ตรวจว่าไฟล์ฐานข้อมูลยังใช้งานได้
   * @returns {Promise<boolean>}
   */
  async ping() {
    try {
      this.#db.prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }

  /** ปิดไฟล์ฐานข้อมูล */
  async close() {
    try { this.#db.close(); } catch { /* ปิดไปแล้ว */ }
  }

  /**
   * ทดสอบว่าสร้างไฟล์ฐานข้อมูลที่พาธนี้ได้หรือไม่ — ใช้ในหน้าตั้งค่าครั้งแรก
   * @param {{file: string}} options ค่าตั้งค่าที่ต้องการทดสอบ
   * @returns {Promise<{ok: boolean, message: string}>}
   */
  static async testConnection({ file }) {
    try {
      const target = resolve(file);
      const folder = dirname(target);
      if (!existsSync(folder)) mkdirSync(folder, { recursive: true });

      const probe = new DatabaseSync(target);
      probe.exec('PRAGMA user_version');
      probe.close();

      return {
        ok: true,
        message: existsSync(target)
          ? `ใช้ไฟล์ฐานข้อมูลที่ ${target} ได้`
          : `สร้างไฟล์ฐานข้อมูลที่ ${target} ได้`,
      };
    } catch (error) {
      return { ok: false, message: `ใช้ไฟล์ฐานข้อมูลนี้ไม่ได้: ${error.message}` };
    }
  }

  /**
   * แปลงพารามิเตอร์ให้เป็นชนิดที่ `node:sqlite` รับได้
   *
   * `Date` → ข้อความ `YYYY-MM-DD HH:MM:SS` ตามเวลาไทย
   * `boolean` → 0 หรือ 1
   * `undefined` → null
   *
   * @param {Array<*>} params พารามิเตอร์ดิบ
   * @returns {Array<*>}
   */
  static #bind(params) {
    return (params ?? []).map((value) => {
      if (value === undefined) return null;
      if (value instanceof Date) return value.toLocaleString('sv-SE');
      if (typeof value === 'boolean') return value ? 1 : 0;
      return value;
    });
  }
}
