import { SqlDialect } from './SqlDialect.js';

/**
 * ภาษา SQL ของ MySQL 8 — ค่าเริ่มต้นสำหรับใช้งานจริง
 */
export class MySqlDialect extends SqlDialect {
  /** @returns {string} ชื่อ dialect */
  get name() { return 'mysql'; }

  /** @returns {string} เวลาปัจจุบัน */
  now() { return 'NOW()'; }

  /**
   * เวลาปัจจุบันลบตามจำนวนหน่วยที่ส่งเป็นพารามิเตอร์
   * @param {string} unit หน่วยเวลา
   * @returns {string}
   */
  ago(unit) { return `DATE_SUB(NOW(), INTERVAL ? ${unit})`; }

  /**
   * จัดรูปแบบวันที่
   * @param {string} column ชื่อคอลัมน์
   * @returns {string}
   */
  formatDate(column) { return `DATE_FORMAT(${column}, ?)`; }

  /**
   * `INSERT ... ON DUPLICATE KEY UPDATE`
   *
   * เมื่อต้องการรหัสแถวกลับมา ใช้กลเม็ด `LAST_INSERT_ID(id)` ที่ทำให้ `insertId`
   * คืนรหัสแถว**เดิม**เมื่อชนคีย์ แทนที่จะคืน 0
   *
   * @param {{table: string, columns: Array<string>, conflictColumns: Array<string>, updateColumns: Array<string>, returning?: string|null}} spec รายละเอียด
   * @returns {{sql: string}}
   */
  upsert({ table, columns, updateColumns, returning = 'id' }) {
    const columnList = columns.map((column) => this.quote(column)).join(', ');
    const placeholders = columns.map(() => '?').join(', ');
    const updates = updateColumns
      .map((column) => `${this.quote(column)} = VALUES(${this.quote(column)})`)
      .join(', ');
    const idTrick = returning
      ? `, ${this.quote(returning)} = LAST_INSERT_ID(${this.quote(returning)})`
      : '';

    return {
      sql: `INSERT INTO ${this.quote(table)} (${columnList}) VALUES (${placeholders})
            ON DUPLICATE KEY UPDATE ${updates}${idTrick}`,
    };
  }
}
