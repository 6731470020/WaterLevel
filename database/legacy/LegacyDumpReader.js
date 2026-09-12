import { readFileSync } from 'node:fs';
import { ValidationError } from '../../src/core/errors/index.js';

/**
 * ตัวอ่านไฟล์ MySQL dump ของระบบเดิม (`data/bangpai.sql`)
 *
 * เขียนตัวแยกวิเคราะห์เองแทนการต่อฐานข้อมูล MySQL เพราะ:
 * - ผู้ใช้ระบบใหม่อาจเลือก SQLite และไม่มี MySQL บนเครื่องเลย
 * - การย้ายข้อมูลควรทำได้จากไฟล์ dump ไฟล์เดียวโดยไม่ต้องติดตั้งอะไรเพิ่ม
 *
 * รองรับเฉพาะรูปแบบที่ phpMyAdmin สร้าง: `INSERT INTO \`t\` (cols) VALUES (…),(…);`
 */
export class LegacyDumpReader {
  /** @type {string} */
  #sql;

  /** @param {string} path พาธไฟล์ dump */
  constructor(path) {
    this.#sql = readFileSync(path, 'utf8');
  }

  /**
   * อ่านทุกแถวของตารางที่ระบุเป็นวัตถุ (คีย์ = ชื่อคอลัมน์)
   * @param {string} table ชื่อตาราง
   * @returns {Array<object>} แถวทั้งหมด (อาร์เรย์ว่างเมื่อไม่มีข้อมูล)
   * @throws {ValidationError} เมื่อแยกวิเคราะห์ไม่สำเร็จ
   */
  rows(table) {
    const pattern = new RegExp(
      `INSERT INTO \`${table}\`\\s*\\(([^)]*)\\)\\s*VALUES\\s*`, 'g',
    );

    const output = [];
    let match;
    while ((match = pattern.exec(this.#sql)) !== null) {
      const columns = match[1]
        .split(',')
        .map((name) => name.trim().replace(/^`|`$/g, ''));

      const body = this.#readUntilStatementEnd(pattern.lastIndex);
      for (const tuple of LegacyDumpReader.#splitTuples(body)) {
        const values = LegacyDumpReader.#parseTuple(tuple);
        if (values.length !== columns.length) {
          throw new ValidationError(
            `ตาราง ${table}: จำนวนค่า (${values.length}) ไม่ตรงกับจำนวนคอลัมน์ (${columns.length})`,
          );
        }
        output.push(Object.fromEntries(columns.map((name, i) => [name, values[i]])));
      }
    }
    return output;
  }

  /**
   * นับจำนวนแถวของตาราง — ใช้ตรวจสอบหลังย้ายข้อมูล
   * @param {string} table ชื่อตาราง
   * @returns {number}
   */
  count(table) { return this.rows(table).length; }

  /**
   * อ่านเนื้อคำสั่งตั้งแต่ตำแหน่งที่ระบุจนถึงอัฒภาคที่ปิดคำสั่ง
   *
   * ต้องข้ามอัฒภาคที่อยู่ในสตริง เช่นคอมเมนต์ภาษาไทยหรือ JSON ที่ฝังอยู่
   *
   * @param {number} start ตำแหน่งเริ่มต้น
   * @returns {string} เนื้อคำสั่ง (ไม่รวมอัฒภาคปิด)
   */
  #readUntilStatementEnd(start) {
    let inString = false;
    for (let i = start; i < this.#sql.length; i += 1) {
      const char = this.#sql[i];
      if (char === '\\') { i += 1; continue; }
      if (char === "'") { inString = !inString; continue; }
      if (char === ';' && !inString) return this.#sql.slice(start, i);
    }
    return this.#sql.slice(start);
  }

  /**
   * แยกกลุ่มค่าที่อยู่ในวงเล็บแต่ละชุด
   * @param {string} body เนื้อคำสั่ง
   * @returns {Array<string>} เนื้อในวงเล็บของแต่ละแถว
   */
  static #splitTuples(body) {
    const tuples = [];
    let depth = 0;
    let inString = false;
    let current = '';

    for (let i = 0; i < body.length; i += 1) {
      const char = body[i];

      if (inString) {
        current += char;
        if (char === '\\') { current += body[i + 1] ?? ''; i += 1; }
        else if (char === "'") inString = false;
        continue;
      }

      if (char === "'") { inString = true; current += char; continue; }

      if (char === '(') {
        depth += 1;
        if (depth === 1) { current = ''; continue; }
      } else if (char === ')') {
        depth -= 1;
        if (depth === 0) { tuples.push(current); continue; }
      }

      if (depth > 0) current += char;
    }
    return tuples;
  }

  /**
   * แยกค่าแต่ละคอลัมน์ในแถวหนึ่ง พร้อมแปลงชนิดข้อมูล
   * @param {string} tuple เนื้อในวงเล็บ
   * @returns {Array<string|number|null>} ค่าที่แปลงแล้ว
   */
  static #parseTuple(tuple) {
    const values = [];
    let current = '';
    let inString = false;
    let isStringValue = false;

    const flush = () => {
      values.push(isStringValue ? current : LegacyDumpReader.#parseScalar(current.trim()));
      current = '';
      isStringValue = false;
    };

    for (let i = 0; i < tuple.length; i += 1) {
      const char = tuple[i];

      if (inString) {
        if (char === '\\') {
          current += LegacyDumpReader.#unescape(tuple[i + 1]);
          i += 1;
        } else if (char === "'") {
          // อัญประกาศสองตัวติดกันภายในสตริงหมายถึงอัญประกาศจริงหนึ่งตัว
          if (tuple[i + 1] === "'") { current += "'"; i += 1; }
          else inString = false;
        } else {
          current += char;
        }
        continue;
      }

      if (char === "'") {
        // ทิ้งช่องว่างที่คั่นระหว่างคอมมากับอัญประกาศเปิด มิฉะนั้นจะติดไปกับค่า
        inString = true;
        isStringValue = true;
        current = '';
        continue;
      }
      if (char === ',') { flush(); continue; }
      current += char;
    }
    flush();
    return values;
  }

  /**
   * แปลงค่าที่ไม่ใช่สตริง (ตัวเลข NULL) เป็นชนิดของ JavaScript
   * @param {string} raw ค่าดิบ
   * @returns {number|null|string}
   */
  static #parseScalar(raw) {
    if (raw === '' || raw.toUpperCase() === 'NULL') return null;
    const number = Number(raw);
    return Number.isFinite(number) ? number : raw;
  }

  /**
   * แปลงลำดับหลบหนีของ MySQL เป็นอักขระจริง
   * @param {string} char อักขระที่ตามหลังแบ็กสแลช
   * @returns {string}
   */
  static #unescape(char) {
    const table = { n: '\n', r: '\r', t: '\t', 0: '\0', b: '\b', Z: '\x1a' };
    return table[char] ?? char;
  }
}
