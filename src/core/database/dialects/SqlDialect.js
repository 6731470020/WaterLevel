import { NotImplementedError } from '../../errors/index.js';

/**
 * คลาสนามธรรมของภาษา SQL แต่ละค่าย (Strategy Pattern)
 *
 * ระบบรองรับทั้ง MySQL และ SQLite ซึ่งเขียน SQL ต่างกันอยู่ไม่กี่จุด
 * คลาสนี้รวบรวมความต่างเหล่านั้นไว้ที่เดียว ทำให้ Repository เขียน SQL ชุดเดียว
 * แล้วเรียกตัวช่วยจาก dialect เฉพาะตรงที่ต่างกันจริง ๆ
 *
 * ความต่างที่ต้องจัดการ:
 * - การเพิ่มหรืออัปเดตเมื่อชนคีย์ (`ON DUPLICATE KEY UPDATE` ↔ `ON CONFLICT DO UPDATE`)
 * - เวลาปัจจุบัน (`NOW()` ↔ `datetime('now','localtime')`)
 * - การลบเวลา (`DATE_SUB` ↔ `datetime(..., '-N days')`)
 * - การจัดรูปแบบวันที่ (`DATE_FORMAT` ↔ `strftime`)
 *
 * @abstract
 */
export class SqlDialect {
  /** @throws {NotImplementedError} เมื่อสร้างวัตถุจากคลาสนามธรรมโดยตรง */
  constructor() {
    if (new.target === SqlDialect) {
      throw new NotImplementedError('SqlDialect เป็นคลาสนามธรรม สร้างวัตถุโดยตรงไม่ได้');
    }
  }

  /**
   * ชื่อ dialect (`mysql` | `sqlite`)
   * @abstract
   * @returns {string}
   * @throws {NotImplementedError} เมื่อคลาสลูกไม่ override
   */
  get name() {
    throw new NotImplementedError(`${this.constructor.name} ต้อง override name`);
  }

  /**
   * นิพจน์เวลาปัจจุบันตามเวลาไทย
   * @abstract
   * @returns {string} ชิ้นส่วน SQL
   * @throws {NotImplementedError} เมื่อคลาสลูกไม่ override
   */
  now() {
    throw new NotImplementedError(`${this.constructor.name} ต้อง override now()`);
  }

  /**
   * นิพจน์ "เวลาปัจจุบันลบไปตามจำนวนหน่วยที่ส่งเป็นพารามิเตอร์"
   * @abstract
   * @param {string} unit หน่วยเวลา (`DAY` | `MINUTE`)
   * @returns {string} ชิ้นส่วน SQL ที่มีตัวยึด `?` หนึ่งตัว
   * @throws {NotImplementedError} เมื่อคลาสลูกไม่ override
   */
  ago(unit) {
    throw new NotImplementedError(`${this.constructor.name} ต้อง override ago()`);
  }

  /**
   * นิพจน์จัดรูปแบบวันที่
   * @abstract
   * @param {string} column ชื่อคอลัมน์
   * @returns {string} ชิ้นส่วน SQL ที่มีตัวยึด `?` สำหรับรูปแบบ
   * @throws {NotImplementedError} เมื่อคลาสลูกไม่ override
   */
  formatDate(column) {
    throw new NotImplementedError(`${this.constructor.name} ต้อง override formatDate()`);
  }

  /**
   * ประกอบคำสั่งเพิ่มแถวแบบอัปเดตเมื่อชนคีย์
   * @abstract
   * @param {object} spec รายละเอียดคำสั่ง
   * @param {string} spec.table ชื่อตาราง
   * @param {Array<string>} spec.columns คอลัมน์ที่จะเพิ่ม
   * @param {Array<string>} spec.conflictColumns คอลัมน์ที่เป็นคีย์ไม่ซ้ำ
   * @param {Array<string>} spec.updateColumns คอลัมน์ที่ต้องอัปเดตเมื่อชน
   * @param {string|null} [spec.returning='id'] คอลัมน์รหัสที่ต้องการคืนกลับ
   *        ส่ง `null` เมื่อตารางไม่มีคอลัมน์รหัส (เช่น `sessions` ที่ใช้ `sid` เป็นคีย์หลัก)
   * @returns {{sql: string}} คำสั่งที่ประกอบแล้ว
   * @throws {NotImplementedError} เมื่อคลาสลูกไม่ override
   */
  upsert(spec) {
    throw new NotImplementedError(`${this.constructor.name} ต้อง override upsert()`);
  }

  /**
   * ครอบชื่อตารางหรือคอลัมน์ด้วยเครื่องหมายอ้างอิง
   *
   * ทั้ง MySQL และ SQLite รับ backtick เหมือนกัน จึงใช้ร่วมกันได้
   *
   * @param {string} identifier ชื่อ
   * @returns {string}
   */
  quote(identifier) { return `\`${identifier}\``; }

  /**
   * โฟลเดอร์ migration ที่ตรงกับ dialect นี้
   * @returns {string} ชื่อโฟลเดอร์ย่อยใต้ `database/migrations/`
   */
  get migrationFolder() { return this.name; }
}
