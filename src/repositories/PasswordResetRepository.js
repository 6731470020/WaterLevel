import { BaseRepository } from '../core/BaseRepository.js';

/**
 * ที่เก็บ token สำหรับตั้งรหัสผ่านใหม่
 *
 * เก็บเฉพาะ **sha256 ของ token** ไม่เก็บ token ดิบ — ผู้ที่เข้าถึงฐานข้อมูลได้
 * จึงนำ token ไปใช้ไม่ได้ token มีอายุ 30 นาทีและใช้ได้ครั้งเดียว
 * ไม่มีโมเดลเฉพาะเพราะเป็นข้อมูลชั่วคราวล้วน ๆ
 */
export class PasswordResetRepository extends BaseRepository {
  /** @param {import('../core/Database.js').Database} db ตัวเชื่อมฐานข้อมูล */
  constructor(db) {
    super(db, 'password_reset_tokens');
  }

  /**
   * แปลงแถวดิบเป็นวัตถุธรรมดา
   * @param {object} row แถวจากตาราง `password_reset_tokens`
   * @returns {{id: number, userId: number, expiresAt: Date, usedAt: Date|null}}
   */
  mapRow(row) {
    return {
      id: Number(row.id),
      userId: Number(row.user_id),
      expiresAt: row.expires_at,
      usedAt: row.used_at,
    };
  }

  /**
   * สร้าง token ใหม่ พร้อมล้าง token เก่าที่ยังไม่ถูกใช้ของผู้ใช้คนเดียวกัน
   * @param {number} userId รหัสผู้ใช้
   * @param {string} tokenHash sha256 ของ token
   * @param {Date} expiresAt เวลาหมดอายุ
   * @returns {Promise<number>} รหัสแถวที่สร้าง
   */
  async issue(userId, tokenHash, expiresAt) {
    return this.transaction(async (tx) => {
      await tx.execute(
        'DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL', [userId],
      );
      const result = await tx.execute(
        'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
        [userId, tokenHash, expiresAt],
      );
      return result.insertId;
    });
  }

  /**
   * ค้น token ที่ยังใช้ได้จากค่าแฮช
   * @param {string} tokenHash sha256 ของ token
   * @returns {Promise<{id: number, userId: number, expiresAt: Date, usedAt: Date|null}|null>}
   */
  async findUsable(tokenHash) {
    const row = await this.db.queryOne(
      `SELECT * FROM password_reset_tokens
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
       LIMIT 1`,
      [tokenHash, new Date()],
    );
    return row ? this.mapRow(row) : null;
  }

  /**
   * ทำเครื่องหมายว่า token ถูกใช้ไปแล้ว
   * @param {number} id รหัสแถว
   * @returns {Promise<void>}
   */
  async markUsed(id) {
    await this.db.execute(
      'UPDATE password_reset_tokens SET used_at = ? WHERE id = ?', [new Date(), id],
    );
  }

  /**
   * ลบ token ที่หมดอายุหรือถูกใช้ไปแล้ว
   * @returns {Promise<number>} จำนวนแถวที่ลบ
   */
  async purgeExpired() {
    const result = await this.db.execute(
      'DELETE FROM password_reset_tokens WHERE expires_at <= ? OR used_at IS NOT NULL',
      [new Date()],
    );
    return result.affectedRows;
  }
}
