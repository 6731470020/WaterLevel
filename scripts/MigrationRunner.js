import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { MigrationRepository } from '../src/repositories/MigrationRepository.js';
import { AppError } from '../src/core/errors/index.js';

/**
 * ตัวรัน migration ตามลำดับชื่อไฟล์
 *
 * แก้ปัญหาระบบเดิมที่เรียก `CREATE TABLE IF NOT EXISTS` และ `ALTER TABLE` ทุกครั้ง
 * ที่มีคำขอเข้ามา (CLAUDE.md ข้อ 2.1 ข้อบกพร่องที่ 5) — ระบบใหม่รันครั้งเดียว
 * ตอนติดตั้งแล้วบันทึกไว้ว่ารันไปแล้ว
 *
 * ตรวจ checksum ของทุกไฟล์ที่เคยรัน หากเนื้อไฟล์เปลี่ยนจะเตือนทันที
 * เพราะการแก้ migration ที่รันไปแล้วทำให้สคีมาของแต่ละเครื่องไม่ตรงกัน
 */
export class MigrationRunner {
  /** @type {import('../src/core/Database.js').Database} */
  #db;
  /** @type {MigrationRepository} */
  #repository;
  /** @type {string} */
  #directory;
  /** @type {(message: string) => void} */
  #report;

  /**
   * @param {import('../src/core/Database.js').Database} db ตัวเชื่อมฐานข้อมูล
   * @param {string} baseDirectory โฟลเดอร์รากของ migration (จะเลือกโฟลเดอร์ย่อยตามค่าย SQL ให้เอง)
   * @param {(message: string) => void} [report] ฟังก์ชันรายงานความคืบหน้า
   */
  constructor(db, baseDirectory, report = (message) => process.stdout.write(`${message}\n`)) {
    this.#db = db;
    this.#repository = new MigrationRepository(db);
    // MySQL กับ SQLite ใช้ DDL คนละชุด จึงแยกโฟลเดอร์กันคนละค่าย
    this.#directory = join(baseDirectory, db.dialect.migrationFolder);
    this.#report = report;
  }

  /**
   * รัน migration ที่ยังไม่เคยรัน
   * @returns {Promise<{applied: Array<string>, skipped: number}>}
   * @throws {AppError} เมื่อไฟล์ที่เคยรันถูกแก้ไข หรือรันคำสั่งไม่สำเร็จ
   */
  async run() {
    await this.#repository.ensureTable();

    const appliedRows = await this.#repository.applied();
    const appliedMap = new Map(appliedRows.map((row) => [row.filename, row.checksum]));

    const files = (await readdir(this.#directory))
      .filter((name) => name.endsWith('.sql'))
      .sort();

    const applied = [];
    let skipped = 0;

    for (const filename of files) {
      const sql = await readFile(join(this.#directory, filename), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');

      if (appliedMap.has(filename)) {
        if (appliedMap.get(filename) !== checksum) {
          throw new AppError(
            `ไฟล์ migration "${filename}" ถูกแก้ไขหลังจากรันไปแล้ว — ` +
            'การแก้ไฟล์ที่รันแล้วทำให้สคีมาของแต่ละเครื่องไม่ตรงกัน ' +
            'กรุณาสร้างไฟล์ migration ใหม่แทน',
            500, 'INTERNAL_ERROR',
          );
        }
        skipped += 1;
        continue;
      }

      this.#report(`  ▸ กำลังรัน ${filename} …`);
      for (const statement of MigrationRunner.splitStatements(sql)) {
        await this.#db.execute(statement);
      }
      await this.#repository.record(filename, checksum);
      applied.push(filename);
      this.#report(`    ✓ สำเร็จ`);
    }

    return { applied, skipped };
  }

  /**
   * แยกคำสั่ง SQL ที่คั่นด้วย `;` โดยไม่ตัดกลางสตริง คอมเมนต์ หรือเนื้อทริกเกอร์
   *
   * เขียนเองแทนการ `split(';')` ตรง ๆ เพราะ:
   * - คอมเมนต์ภาษาไทยและค่า default ในสคีมามีอัฒภาคปนอยู่ได้
   * - ทริกเกอร์ของ SQLite มี `;` อยู่ภายใน `BEGIN … END;` ซึ่งห้ามตัด
   *
   * @param {string} sql เนื้อไฟล์ SQL
   * @returns {Array<string>} รายการคำสั่ง
   */
  static splitStatements(sql) {
    const statements = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;
    let inBacktick = false;
    let inLineComment = false;
    let inBlockComment = false;
    let inTriggerBody = false;

    const inString = () => inSingle || inDouble || inBacktick;

    for (let i = 0; i < sql.length; i += 1) {
      const char = sql[i];
      const next = sql[i + 1];

      if (inLineComment) {
        if (char === '\n') { inLineComment = false; current += char; }
        continue;
      }
      if (inBlockComment) {
        if (char === '*' && next === '/') { inBlockComment = false; i += 1; }
        continue;
      }
      if (!inString()) {
        if (char === '-' && next === '-') { inLineComment = true; i += 1; continue; }
        if (char === '#') { inLineComment = true; continue; }
        if (char === '/' && next === '*') { inBlockComment = true; i += 1; continue; }
      }

      if (char === "'" && !inDouble && !inBacktick && sql[i - 1] !== '\\') inSingle = !inSingle;
      else if (char === '"' && !inSingle && !inBacktick && sql[i - 1] !== '\\') inDouble = !inDouble;
      else if (char === '`' && !inSingle && !inDouble) inBacktick = !inBacktick;

      current += char;

      if (inString()) continue;

      // เข้าสู่เนื้อทริกเกอร์เมื่อพบ BEGIN ที่ตามหลัง CREATE TRIGGER
      if (!inTriggerBody && /\bCREATE\s+TRIGGER\b[\s\S]*\bBEGIN\s*$/i.test(current)) {
        inTriggerBody = true;
        continue;
      }

      if (char !== ';') continue;

      if (inTriggerBody) {
        // จบทริกเกอร์เมื่อพบ `END;` เท่านั้น อัฒภาคอื่นภายในถือเป็นส่วนของเนื้อ
        if (!/\bEND\s*;\s*$/i.test(current)) continue;
        inTriggerBody = false;
      }

      const trimmed = current.slice(0, -1).trim();
      if (trimmed) statements.push(trimmed);
      current = '';
    }

    const trimmed = current.trim();
    if (trimmed) statements.push(trimmed);
    return statements;
  }
}
