import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { MigrationRepository } from '../repositories/MigrationRepository.js';

/**
 * ผู้ตรวจว่าสคีมาของฐานข้อมูลใหม่พอที่จะรันโค้ดชุดนี้หรือไม่
 *
 * โค้ดกับฐานข้อมูลเดินคนละจังหวะได้เสมอ — ดึงโค้ดใหม่มาแล้วลืมรัน `npm run db:migrate`
 * เป็นเรื่องปกติ ถ้าปล่อยให้ระบบขึ้นมาทั้งที่สคีมาเก่า มันจะดูเหมือนทำงานได้
 * แล้วไปพังกลางคำสั่งบันทึกด้วยข้อความอย่าง `no such column: zone_key`
 * ซึ่งผู้ดูแลอ่านไม่ออกว่าต้องทำอะไร — และร้ายกว่านั้นคืออาจพังหลังบันทึกไปแล้วบางส่วน
 *
 * คลาสนี้จึงตรวจตั้งแต่ตอนเริ่มโปรแกรมแล้วหยุดทันทีพร้อมบอกคำสั่งที่ต้องรัน
 *
 * เทียบเฉพาะ**ชื่อไฟล์** — การตรวจว่าไฟล์ที่รันไปแล้วถูกแก้ทีหลังหรือไม่ (checksum)
 * เป็นหน้าที่ของ `MigrationRunner` ตอนรันจริง ไม่ใช่หน้าที่ของด่านนี้
 */
export class SchemaGuard {
  /** @type {import('./Database.js').Database} */
  #db;
  /** @type {string} */
  #directory;

  /**
   * @param {import('./Database.js').Database} db ตัวเชื่อมฐานข้อมูล
   * @param {string} baseDirectory โฟลเดอร์รากของ migration (เลือกโฟลเดอร์ย่อยตามค่าย SQL ให้เอง)
   */
  constructor(db, baseDirectory) {
    this.#db = db;
    this.#directory = join(baseDirectory, db.dialect.migrationFolder);
  }

  /**
   * รายชื่อไฟล์ migration ที่ยังไม่ได้รันกับฐานข้อมูลนี้
   *
   * คืนอาร์เรย์ว่างเมื่อสคีมาเป็นปัจจุบัน และเมื่ออ่านสถานะไม่ได้เลย
   * (เช่นยังไม่มีตาราง `schema_migrations`) เพราะกรณีนั้นคือ "ยังไม่ได้ติดตั้ง"
   * ซึ่ง `server.js` จัดการด้วยการเข้าโหมดตั้งค่าอยู่แล้ว ไม่ใช่หน้าที่ของด่านนี้
   *
   * @returns {Promise<Array<string>>}
   */
  async pending() {
    let applied;
    try {
      applied = new Set(
        (await new MigrationRepository(this.#db).applied()).map((row) => row.filename),
      );
    } catch {
      return [];
    }

    const files = (await readdir(this.#directory))
      .filter((name) => name.endsWith('.sql'))
      .sort();

    return files.filter((name) => !applied.has(name));
  }

  /**
   * ข้อความอธิบายสิ่งที่ต้องทำ เมื่อพบ migration ที่ยังไม่ได้รัน
   * @param {Array<string>} pending รายชื่อไฟล์ที่ค้าง
   * @returns {string}
   */
  static describe(pending) {
    return (
      `\n  ⛔ ฐานข้อมูลยังไม่ได้อัปเดตสคีมา — มี migration ค้างอยู่ ${pending.length} ไฟล์\n`
      + pending.map((name) => `     • ${name}\n`).join('')
      + '\n     โค้ดชุดนี้ต้องการตารางที่ไฟล์เหล่านี้สร้าง หากรันต่อไป ระบบจะดูเหมือน\n'
      + '     ทำงานได้แล้วไปพังตอนบันทึกข้อมูล จึงหยุดไว้ก่อน\n\n'
      + '     แก้ด้วยคำสั่ง:  npm run db:migrate\n'
      + '     (สำรองฐานข้อมูลก่อนทุกครั้ง — SQLite คัดลอกไฟล์เดียว · MySQL ใช้ mysqldump)\n'
    );
  }
}
