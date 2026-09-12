import { NotImplementedError, ValidationError } from './errors/index.js';

/** ชื่อตาราง/คอลัมน์ที่ยอมรับ — กันการฉีด SQL ผ่านชื่อ identifier */
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * คลาสฐานนามธรรมของชั้นข้อมูล — **ที่เดียวในระบบที่เขียน SQL**
 *
 * ให้เมท็อด CRUD มาตรฐานฟรี คลาสลูกเขียนแค่ `mapRow()` กับคำสั่งเฉพาะทางของตัวเอง
 * ค่าทุกตัวส่งผ่าน prepared statement (`?`) ส่วนชื่อคอลัมน์ผ่านการตรวจรูปแบบก่อนเสมอ
 *
 * @abstract
 */
export class BaseRepository {
  /** @type {import('./Database.js').Database} */
  #db;
  /** @type {string} */
  #tableName;

  /**
   * @param {import('./Database.js').Database} db ตัวเชื่อมฐานข้อมูล (ฉีดผ่าน constructor)
   * @param {string} tableName ชื่อตารางที่ดูแล
   * @throws {NotImplementedError} เมื่อสร้างวัตถุจากคลาสนามธรรมโดยตรง
   */
  constructor(db, tableName) {
    if (new.target === BaseRepository) {
      throw new NotImplementedError('BaseRepository เป็นคลาสนามธรรม สร้างวัตถุโดยตรงไม่ได้');
    }
    if (!SAFE_IDENTIFIER.test(tableName)) {
      throw new ValidationError(`ชื่อตารางไม่ถูกต้อง: ${tableName}`);
    }
    this.#db = db;
    this.#tableName = tableName;
  }

  /** @returns {import('./Database.js').Database} ตัวเชื่อมฐานข้อมูล */
  get db() { return this.#db; }

  /** @returns {string} ชื่อตารางที่ดูแล */
  get tableName() { return this.#tableName; }

  /**
   * ค้นหาด้วยรหัสประจำตัว
   * @param {number} id รหัส
   * @returns {Promise<import('./BaseModel.js').BaseModel|null>}
   */
  async findById(id) {
    const row = await this.#db.queryOne(
      `SELECT * FROM \`${this.#tableName}\` WHERE id = ? LIMIT 1`, [id],
    );
    return row ? this.mapRow(row) : null;
  }

  /**
   * ค้นหาหลายแถวตามเงื่อนไข
   *
   * `where` รับได้ทั้งค่าเดี่ยว (`{status: 'ACTIVE'}` → `=`), อาร์เรย์ (→ `IN`),
   * `null` (→ `IS NULL`) และวัตถุตัวดำเนินการ (`{age: {op: '>=', value: 18}}`)
   *
   * @param {{where?: object, orderBy?: string, limit?: number|null, offset?: number}} [options={}]
   * @returns {Promise<Array<import('./BaseModel.js').BaseModel>>}
   */
  async findAll({ where = {}, orderBy = 'id DESC', limit = 100, offset = 0 } = {}) {
    const { clause, params } = this.buildWhere(where);
    const order = this.buildOrderBy(orderBy);
    let sql = `SELECT * FROM \`${this.#tableName}\`${clause}${order}`;
    if (limit !== null) {
      sql += ' LIMIT ? OFFSET ?';
      params.push(Number(limit), Number(offset));
    }
    const rows = await this.#db.query(sql, params);
    return rows.map((row) => this.mapRow(row));
  }

  /**
   * ค้นหาแถวเดียวตามเงื่อนไข
   * @param {object} where เงื่อนไข
   * @returns {Promise<import('./BaseModel.js').BaseModel|null>}
   */
  async findOneBy(where) {
    const rows = await this.findAll({ where, limit: 1, orderBy: 'id DESC' });
    return rows[0] ?? null;
  }

  /**
   * นับจำนวนแถวตามเงื่อนไข
   * @param {object} [where={}] เงื่อนไข
   * @returns {Promise<number>}
   */
  async count(where = {}) {
    const { clause, params } = this.buildWhere(where);
    const row = await this.#db.queryOne(
      `SELECT COUNT(*) AS total FROM \`${this.#tableName}\`${clause}`, params,
    );
    return Number(row?.total ?? 0);
  }

  /**
   * ตรวจว่ามีแถวที่ตรงเงื่อนไขหรือไม่
   * @param {object} where เงื่อนไข
   * @returns {Promise<boolean>}
   */
  async exists(where) { return (await this.count(where)) > 0; }

  /**
   * เพิ่มแถวใหม่จากวัตถุโมเดล
   * @param {import('./BaseModel.js').BaseModel} model โมเดลที่ต้องการบันทึก
   * @returns {Promise<import('./BaseModel.js').BaseModel>} โมเดลที่อ่านกลับมาพร้อม id
   */
  async create(model) {
    model.validate();
    const id = await this.insertRow(this.toRow(model));
    return this.findById(id);
  }

  /**
   * แก้ไขแถวตามรหัส
   * @param {number} id รหัสแถว
   * @param {object} data คู่คอลัมน์-ค่าที่ต้องการแก้
   * @returns {Promise<import('./BaseModel.js').BaseModel|null>} โมเดลหลังแก้ไข
   */
  async update(id, data) {
    const entries = Object.entries(data).filter(([, value]) => value !== undefined);
    if (!entries.length) return this.findById(id);
    for (const [column] of entries) this.assertIdentifier(column);
    const assignments = entries.map(([column]) => `\`${column}\` = ?`).join(', ');
    const params = [...entries.map(([, value]) => value), id];
    await this.#db.execute(
      `UPDATE \`${this.#tableName}\` SET ${assignments} WHERE id = ?`, params,
    );
    return this.findById(id);
  }

  /**
   * ลบแถวตามรหัส
   * @param {number} id รหัสแถว
   * @returns {Promise<boolean>} true เมื่อมีแถวถูกลบ
   */
  async delete(id) {
    const result = await this.#db.execute(
      `DELETE FROM \`${this.#tableName}\` WHERE id = ?`, [id],
    );
    return result.affectedRows > 0;
  }

  /**
   * รันงานหลายอย่างใน transaction เดียว
   * @template T
   * @param {(tx: object) => Promise<T>} callback งานที่ต้องทำ
   * @returns {Promise<T>}
   */
  async transaction(callback) { return this.#db.transaction(callback); }

  /**
   * เพิ่มแถวจากคู่คอลัมน์-ค่าโดยตรง
   * @protected
   * @param {object} row คู่คอลัมน์-ค่า
   * @param {object} [executor=this.db] ตัวรันคำสั่ง (ส่ง tx เข้ามาได้)
   * @returns {Promise<number>} รหัสที่เพิ่งสร้าง
   */
  async insertRow(row, executor = this.#db) {
    const entries = Object.entries(row).filter(([, value]) => value !== undefined);
    for (const [column] of entries) this.assertIdentifier(column);
    const columns = entries.map(([column]) => `\`${column}\``).join(', ');
    const placeholders = entries.map(() => '?').join(', ');
    const result = await executor.execute(
      `INSERT INTO \`${this.#tableName}\` (${columns}) VALUES (${placeholders})`,
      entries.map(([, value]) => value),
    );
    return result.insertId;
  }

  /**
   * เพิ่มแถวใหม่ หรืออัปเดตเมื่อชนคีย์ที่ไม่ซ้ำ
   *
   * MySQL กับ SQLite เขียนคำสั่งนี้ต่างกัน จึงให้ `SqlDialect` ประกอบคำสั่งให้
   * แล้ว Repository เรียกเหมือนกันทั้งสองค่าย
   *
   * @protected
   * @param {object} row คู่คอลัมน์-ค่าสำหรับ INSERT
   * @param {Array<string>} updateColumns คอลัมน์ที่ต้องอัปเดตเมื่อชนคีย์
   * @param {Array<string>} conflictColumns คอลัมน์ที่เป็นคีย์ไม่ซ้ำ (SQLite ต้องระบุ)
   * @param {object} [executor=this.db] ตัวรันคำสั่ง
   * @returns {Promise<number>} รหัสแถว
   */
  async upsertRow(row, updateColumns, conflictColumns, executor = this.#db) {
    const entries = Object.entries(row).filter(([, value]) => value !== undefined);
    for (const [column] of entries) this.assertIdentifier(column);
    for (const column of updateColumns) this.assertIdentifier(column);
    for (const column of conflictColumns) this.assertIdentifier(column);

    const { sql } = this.#db.dialect.upsert({
      table: this.#tableName,
      columns: entries.map(([column]) => column),
      conflictColumns,
      updateColumns,
    });

    const result = await executor.execute(sql, entries.map(([, value]) => value));
    return result.insertId;
  }

  /**
   * ประกอบส่วน WHERE จากวัตถุเงื่อนไข
   * @protected
   * @param {object} where เงื่อนไข
   * @returns {{clause: string, params: Array<*>}}
   */
  buildWhere(where) {
    const conditions = [];
    const params = [];
    for (const [column, value] of Object.entries(where ?? {})) {
      if (value === undefined) continue;
      this.assertIdentifier(column);
      const quoted = `\`${column}\``;
      if (value === null) {
        conditions.push(`${quoted} IS NULL`);
      } else if (Array.isArray(value)) {
        if (!value.length) { conditions.push('1 = 0'); continue; }
        conditions.push(`${quoted} IN (${value.map(() => '?').join(', ')})`);
        params.push(...value);
      } else if (typeof value === 'object' && 'op' in value) {
        const op = BaseRepository.#assertOperator(value.op);
        if (op === 'IS NOT NULL' || op === 'IS NULL') {
          conditions.push(`${quoted} ${op}`);
        } else {
          conditions.push(`${quoted} ${op} ?`);
          params.push(value.value);
        }
      } else {
        conditions.push(`${quoted} = ?`);
        params.push(value);
      }
    }
    return {
      clause: conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '',
      params,
    };
  }

  /**
   * ประกอบส่วน ORDER BY พร้อมตรวจชื่อคอลัมน์และทิศทาง
   * @protected
   * @param {string|null} orderBy เช่น `'created_at DESC, id ASC'`
   * @returns {string}
   */
  buildOrderBy(orderBy) {
    if (!orderBy) return '';
    const parts = String(orderBy).split(',').map((piece) => {
      const [column, direction = 'ASC'] = piece.trim().split(/\s+/);
      this.assertIdentifier(column);
      const dir = direction.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      return `\`${column}\` ${dir}`;
    });
    return ` ORDER BY ${parts.join(', ')}`;
  }

  /**
   * ตรวจว่าชื่อคอลัมน์ปลอดภัย
   * @protected
   * @param {string} identifier ชื่อคอลัมน์
   * @throws {ValidationError} เมื่อชื่อไม่ผ่านรูปแบบที่กำหนด
   */
  assertIdentifier(identifier) {
    if (!SAFE_IDENTIFIER.test(String(identifier))) {
      throw new ValidationError(`ชื่อคอลัมน์ไม่ถูกต้อง: ${identifier}`);
    }
  }

  /**
   * ตรวจตัวดำเนินการเปรียบเทียบ
   * @param {string} op ตัวดำเนินการ
   * @returns {string}
   * @throws {ValidationError} เมื่อไม่อยู่ในรายการที่อนุญาต
   */
  static #assertOperator(op) {
    const allowed = ['=', '!=', '<>', '>', '>=', '<', '<=', 'LIKE', 'NOT LIKE', 'IS NULL', 'IS NOT NULL'];
    const value = String(op).toUpperCase() === op.toUpperCase() ? op.toUpperCase() : op;
    const found = allowed.find((item) => item === op || item === value);
    if (!found) throw new ValidationError(`ตัวดำเนินการไม่ถูกต้อง: ${op}`);
    return found;
  }

  /**
   * แปลงแถวดิบจากฐานข้อมูลเป็นวัตถุโมเดล
   * @abstract
   * @param {object} row แถวดิบ
   * @returns {import('./BaseModel.js').BaseModel}
   * @throws {NotImplementedError} เมื่อคลาสลูกไม่ override
   */
  mapRow(row) {
    throw new NotImplementedError(`${this.constructor.name} ต้อง override mapRow()`);
  }

  /**
   * แปลงวัตถุโมเดลเป็นคู่คอลัมน์-ค่าสำหรับบันทึก
   * @abstract
   * @param {import('./BaseModel.js').BaseModel} model โมเดล
   * @returns {object}
   * @throws {NotImplementedError} เมื่อคลาสลูกไม่ override
   */
  toRow(model) {
    throw new NotImplementedError(`${this.constructor.name} ต้อง override toRow()`);
  }
}
