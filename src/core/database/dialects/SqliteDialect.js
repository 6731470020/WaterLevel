import { SqlDialect } from './SqlDialect.js';

/**
 * ภาษา SQL ของ SQLite — เหมาะกับการติดตั้งขนาดเล็กที่ไม่อยากลงเซิร์ฟเวอร์ฐานข้อมูล
 *
 * ข้อควรรู้: SQLite เก็บเวลาเป็นข้อความ จึงใช้ `datetime('now','localtime')`
 * เพื่อให้ได้เวลาไทยเหมือน `NOW()` ของ MySQL ที่ตั้ง `time_zone = '+07:00'`
 */
export class SqliteDialect extends SqlDialect {
  /** @returns {string} ชื่อ dialect */
  get name() { return 'sqlite'; }

  /** @returns {string} เวลาปัจจุบันตามเขตเวลาของเครื่อง (ตั้ง TZ=Asia/Bangkok ไว้แล้ว) */
  now() { return "datetime('now','localtime')"; }

  /**
   * เวลาปัจจุบันลบตามจำนวนหน่วยที่ส่งเป็นพารามิเตอร์
   *
   * SQLite ต่อสตริงตัวปรับแต่งเอง เช่น `'-7 days'` จึงต้องประกอบด้วย `||`
   *
   * @param {string} unit หน่วยเวลา (`DAY` | `MINUTE`)
   * @returns {string}
   */
  ago(unit) {
    const modifier = unit.toUpperCase() === 'MINUTE' ? 'minutes' : 'days';
    return `datetime('now','localtime', '-' || ? || ' ${modifier}')`;
  }

  /**
   * จัดรูปแบบวันที่ — ตัวระบุรูปแบบ `%Y %m %d %H` เหมือน MySQL ทุกประการ
   * จึงส่งสตริงรูปแบบเดียวกันได้โดยไม่ต้องแปลง
   *
   * @param {string} column ชื่อคอลัมน์
   * @returns {string}
   */
  formatDate(column) { return `strftime(?, ${column})`; }

  /**
   * `INSERT ... ON CONFLICT DO UPDATE` พร้อม `RETURNING id`
   *
   * SQLite ไม่มีกลเม็ด `LAST_INSERT_ID(id)` แต่รองรับ `RETURNING` ซึ่งตรงไปตรงมากว่า
   *
   * @param {{table: string, columns: Array<string>, conflictColumns: Array<string>, updateColumns: Array<string>, returning?: string|null}} spec รายละเอียด
   * @returns {{sql: string}}
   */
  upsert({ table, columns, conflictColumns, updateColumns, returning = 'id' }) {
    const columnList = columns.map((column) => this.quote(column)).join(', ');
    const placeholders = columns.map(() => '?').join(', ');
    const conflictList = conflictColumns.map((column) => this.quote(column)).join(', ');
    const updates = updateColumns
      .map((column) => `${this.quote(column)} = excluded.${this.quote(column)}`)
      .join(', ');
    const returningClause = returning ? `\n            RETURNING ${this.quote(returning)} AS id` : '';

    return {
      sql: `INSERT INTO ${this.quote(table)} (${columnList}) VALUES (${placeholders})
            ON CONFLICT (${conflictList}) DO UPDATE SET ${updates}${returningClause}`,
    };
  }
}
