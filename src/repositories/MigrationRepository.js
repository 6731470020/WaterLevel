import { Database } from '../core/Database.js';

/**
 * ที่เก็บบันทึกว่า migration ใดถูกรันไปแล้ว
 *
 * ต่างจาก Repository อื่นตรงที่ไม่ผูกกับโมเดล จึงไม่สืบทอด `BaseRepository`
 * และต้องสร้างตารางของตัวเองได้ (เป็นข้อยกเว้นเดียวของกฎ "ห้ามสร้างตารางตอน runtime"
 * เพราะเป็นตารางควบคุมของตัวระบบ migration เอง ไม่ใช่ตารางข้อมูล)
 */
export class MigrationRepository {
  /** @type {Database} */
  #db;

  /** @param {Database} db ตัวเชื่อมฐานข้อมูล */
  constructor(db) {
    this.#db = db;
  }

  /**
   * สร้างตารางควบคุม migration หากยังไม่มี
   * @returns {Promise<void>}
   */
  async ensureTable() {
    const ddl = this.#db.driver === 'sqlite'
      ? `CREATE TABLE IF NOT EXISTS schema_migrations (
           id         INTEGER PRIMARY KEY AUTOINCREMENT,
           filename   TEXT NOT NULL UNIQUE,
           checksum   TEXT NOT NULL,
           applied_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
         )`
      : `CREATE TABLE IF NOT EXISTS schema_migrations (
           id         INT AUTO_INCREMENT PRIMARY KEY,
           filename   VARCHAR(255) NOT NULL UNIQUE,
           checksum   CHAR(64)     NOT NULL,
           applied_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

    await this.#db.execute(ddl);
  }

  /**
   * รายชื่อไฟล์ migration ที่รันไปแล้ว
   * @returns {Promise<Array<{filename: string, checksum: string, applied_at: Date}>>}
   */
  async applied() {
    return this.#db.query('SELECT filename, checksum, applied_at FROM schema_migrations ORDER BY filename');
  }

  /**
   * บันทึกว่า migration หนึ่งไฟล์รันสำเร็จแล้ว
   * @param {string} filename ชื่อไฟล์
   * @param {string} checksum ค่า sha256 ของเนื้อไฟล์
   * @returns {Promise<void>}
   */
  async record(filename, checksum) {
    await this.#db.execute(
      'INSERT INTO schema_migrations (filename, checksum) VALUES (?, ?)',
      [filename, checksum],
    );
  }
}
