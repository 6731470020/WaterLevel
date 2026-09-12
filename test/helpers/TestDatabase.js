import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseFactory } from '../../src/core/Database.js';
import { Logger } from '../../src/core/Logger.js';
import { MigrationRunner } from '../../scripts/MigrationRunner.js';
import { SeedRunner } from '../../scripts/SeedRunner.js';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * ฐานข้อมูลชั่วคราวสำหรับชุดทดสอบ
 *
 * ใช้ SQLite ในโฟลเดอร์ชั่วคราวเสมอ ทำให้ integration test รันได้ทุกเครื่อง
 * **โดยไม่ต้องติดตั้งเซิร์ฟเวอร์ฐานข้อมูล** และแต่ละชุดทดสอบมีฐานข้อมูลของตัวเอง
 * จึงรันขนานกันได้โดยไม่กวนกัน
 *
 * @example
 * const testDb = await TestDatabase.create();
 * try {
 *   // … ทดสอบ …
 * } finally {
 *   await testDb.destroy();
 * }
 */
export class TestDatabase {
  /** @type {import('../../src/core/Database.js').Database} */
  #db;
  /** @type {string} */
  #folder;

  /**
   * @param {import('../../src/core/Database.js').Database} db ตัวเชื่อมฐานข้อมูล
   * @param {string} folder โฟลเดอร์ชั่วคราวที่เก็บไฟล์
   */
  constructor(db, folder) {
    this.#db = db;
    this.#folder = folder;
  }

  /** @returns {import('../../src/core/Database.js').Database} ตัวเชื่อมฐานข้อมูล */
  get db() { return this.#db; }

  /**
   * สร้างฐานข้อมูลชั่วคราวพร้อมตารางและข้อมูลตั้งต้น
   * @param {{seed?: boolean}} [options={}] ตัวเลือก
   * @returns {Promise<TestDatabase>}
   */
  static async create({ seed = true } = {}) {
    Logger.configure({ level: 'error', logDir: null, console: false });

    const folder = mkdtempSync(join(tmpdir(), 'waterlevel-test-'));
    const db = DatabaseFactory.build({ driver: 'sqlite', file: join(folder, 'test.db') });

    const silent = () => {};
    await new MigrationRunner(db, join(PROJECT_ROOT, 'database/migrations'), silent).run();
    if (seed) await new SeedRunner(db, silent).run();

    return new TestDatabase(db, folder);
  }

  /**
   * ปิดฐานข้อมูลและลบไฟล์ชั่วคราวทั้งหมด
   * @returns {Promise<void>}
   */
  async destroy() {
    await this.#db.close();
    rmSync(this.#folder, { recursive: true, force: true });
  }

  /**
   * ล้างข้อมูลในตารางที่ระบุ (คงตารางไว้)
   * @param {Array<string>} tables ชื่อตาราง
   * @returns {Promise<void>}
   */
  async truncate(tables) {
    await this.#db.execute('PRAGMA foreign_keys = OFF');
    for (const table of tables) {
      await this.#db.execute(`DELETE FROM \`${table}\``);
    }
    await this.#db.execute('PRAGMA foreign_keys = ON');
  }

  /**
   * นับจำนวนแถวในตาราง
   * @param {string} table ชื่อตาราง
   * @returns {Promise<number>}
   */
  async count(table) {
    const row = await this.#db.queryOne(`SELECT COUNT(*) AS total FROM \`${table}\``);
    return Number(row?.total ?? 0);
  }
}
