import { BaseRepository } from '../core/BaseRepository.js';

/**
 * ที่เก็บค่าตั้งค่าที่แก้ได้จากหน้าผู้ดูแล
 *
 * เป็นตารางคู่คีย์-ค่าที่ไม่มีคอลัมน์ `id` — `key` เป็นคีย์หลักเอง
 * จึงไม่ใช้ `findById()`/`create()` ของคลาสฐาน แต่ใช้เมท็อดเฉพาะของตัวเอง
 */
export class SettingRepository extends BaseRepository {
  /** @param {import('../core/Database.js').Database} db ตัวเชื่อมฐานข้อมูล */
  constructor(db) {
    super(db, 'app_settings');
  }

  /**
   * แปลงแถวดิบเป็นวัตถุธรรมดา
   *
   * ค่าตั้งค่าไม่ต้องมีคลาสโมเดลของตัวเอง เพราะไม่มีพฤติกรรมทางธุรกิจใด ๆ
   * — ตรรกะทั้งหมด (ตรวจค่า ปิดบังความลับ ลำดับความสำคัญ) อยู่ที่ `SettingsService`
   *
   * @param {object} row แถวดิบ
   * @returns {{key: string, value: string, isSecret: boolean, updatedAt: string|Date}}
   */
  mapRow(row) {
    return {
      key: row.key,
      value: row.value,
      isSecret: Boolean(Number(row.is_secret)),
      updatedAt: row.updated_at,
    };
  }

  /**
   * ค่าตั้งค่าทั้งหมด
   * @returns {Promise<Array<{key: string, value: string, isSecret: boolean, updatedAt: string|Date}>>}
   */
  async all() {
    const rows = await this.db.query(
      `SELECT * FROM ${this.db.dialect.quote('app_settings')} ORDER BY ${this.db.dialect.quote('key')}`,
    );
    return rows.map((row) => this.mapRow(row));
  }

  /**
   * บันทึกค่าหลายรายการในธุรกรรมเดียว
   *
   * ใช้ธุรกรรมเพราะการตั้งค่าช่องทางแจ้งเตือนต้องเปลี่ยนพร้อมกันทั้งชุด —
   * เปลี่ยนไดรเวอร์เป็น `discord` สำเร็จแต่บันทึก webhook URL ไม่สำเร็จ
   * จะได้ระบบที่ตั้งใจจะส่ง Discord แต่ส่งไม่ได้จริง
   *
   * @param {Array<{key: string, value: string, isSecret?: boolean}>} entries ค่าที่ต้องบันทึก
   * @param {number|null} actorId รหัสผู้แก้ไข
   * @returns {Promise<number>} จำนวนรายการที่บันทึก
   */
  async saveMany(entries, actorId = null) {
    if (!entries.length) return 0;

    return this.transaction(async (tx) => {
      for (const entry of entries) {
        const spec = this.db.dialect.upsert({
          table: 'app_settings',
          columns: ['key', 'value', 'is_secret', 'updated_by'],
          conflictColumns: ['key'],
          updateColumns: ['value', 'is_secret', 'updated_by'],
          returning: null,
        });
        await tx.execute(spec.sql, [
          entry.key, entry.value, entry.isSecret ? 1 : 0, actorId,
        ]);
      }
      return entries.length;
    });
  }

  /**
   * ลบค่าตั้งค่าออก — ทำให้ระบบกลับไปใช้ค่าจาก `.env`
   * @param {Array<string>} keys คีย์ที่ต้องลบ
   * @returns {Promise<number>} จำนวนที่ลบ
   */
  async removeMany(keys) {
    if (!keys.length) return 0;
    const placeholders = keys.map(() => '?').join(', ');
    const result = await this.db.execute(
      `DELETE FROM ${this.db.dialect.quote('app_settings')} `
      + `WHERE ${this.db.dialect.quote('key')} IN (${placeholders})`,
      keys,
    );
    return result.affectedRows ?? 0;
  }
}
