import { BaseRepository } from '../core/BaseRepository.js';
import { Session } from '../models/Session.js';

/**
 * ที่เก็บ session — ใช้โดย `MySqlSessionStore` และหน้า `/account/sessions`
 *
 * ตาราง `sessions` ใช้ `sid` เป็นคีย์หลักแทน `id` เมท็อดที่สืบทอดมาซึ่งอ้าง `id`
 * จึงใช้ไม่ได้ คลาสนี้เขียนคำสั่งของตัวเองทั้งหมด
 */
export class SessionRepository extends BaseRepository {
  /** @param {import('../core/Database.js').Database} db ตัวเชื่อมฐานข้อมูล */
  constructor(db) {
    super(db, 'sessions');
  }

  /**
   * แปลงแถวดิบเป็นวัตถุ `Session`
   * @param {object} row แถวจากตาราง `sessions`
   * @returns {Session}
   */
  mapRow(row) {
    return new Session({
      sid: row.sid,
      userId: row.user_id,
      ip: row.ip,
      userAgent: row.user_agent,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    });
  }

  /**
   * แปลงวัตถุ `Session` เป็นคู่คอลัมน์-ค่า (ไม่รวมข้อมูล session)
   * @param {Session} session session
   * @returns {object}
   */
  toRow(session) {
    return {
      sid: session.sid,
      user_id: session.userId,
      ip: session.ip,
      user_agent: session.userAgent,
      expires_at: session.expiresAt,
    };
  }

  /**
   * อ่านข้อมูล session ดิบด้วย sid
   * @param {string} sid รหัส session
   * @returns {Promise<{data: string, expires_at: Date}|null>}
   */
  async read(sid) {
    return this.db.queryOne(
      'SELECT data, expires_at FROM sessions WHERE sid = ? AND expires_at > ? LIMIT 1',
      [sid, new Date()],
    );
  }

  /**
   * เขียนหรือแทนที่ session
   * @param {string} sid รหัส session
   * @param {object} params ข้อมูลประกอบ
   * @param {string} params.data ข้อมูล session ที่แปลงเป็น JSON แล้ว
   * @param {number|null} params.userId รหัสผู้ใช้
   * @param {string|null} params.ip หมายเลข IP
   * @param {string|null} params.userAgent ข้อมูลเบราว์เซอร์
   * @param {Date} params.expiresAt เวลาหมดอายุ
   * @returns {Promise<void>}
   */
  async write(sid, { data, userId, ip, userAgent, expiresAt }) {
    const { sql } = this.db.dialect.upsert({
      table: 'sessions',
      columns: ['sid', 'user_id', 'data', 'ip', 'user_agent', 'expires_at'],
      conflictColumns: ['sid'],
      updateColumns: ['user_id', 'data', 'ip', 'user_agent', 'expires_at'],
      // ตาราง sessions ใช้ `sid` เป็นคีย์หลัก ไม่มีคอลัมน์ `id` ให้คืนกลับ
      returning: null,
    });
    await this.db.execute(sql, [
      sid, userId, data, ip, userAgent ? String(userAgent).slice(0, 255) : null, expiresAt,
    ]);
  }

  /**
   * เลื่อนเวลาหมดอายุของ session (ต่ออายุเมื่อมีกิจกรรม)
   * @param {string} sid รหัส session
   * @param {Date} expiresAt เวลาหมดอายุใหม่
   * @returns {Promise<void>}
   */
  async touch(sid, expiresAt) {
    await this.db.execute('UPDATE sessions SET expires_at = ? WHERE sid = ?', [expiresAt, sid]);
  }

  /**
   * ลบ session เดียว
   * @param {string} sid รหัส session
   * @returns {Promise<void>}
   */
  async destroy(sid) {
    await this.db.execute('DELETE FROM sessions WHERE sid = ?', [sid]);
  }

  /**
   * ลบ session ทั้งหมดของผู้ใช้หนึ่ง
   *
   * เรียกเมื่อ: ออกจากระบบทุกอุปกรณ์, เปลี่ยนรหัสผ่าน, **สิทธิ์ถูกแก้**
   * (ข้อสุดท้ายทำให้สิทธิ์ใหม่มีผลทันทีตาม CLAUDE.md ข้อ 8.1)
   *
   * @param {number} userId รหัสผู้ใช้
   * @param {string|null} [exceptSid=null] sid ที่ต้องการเก็บไว้ (session ปัจจุบัน)
   * @returns {Promise<number>} จำนวน session ที่ลบ
   */
  async destroyForUser(userId, exceptSid = null) {
    const result = exceptSid
      ? await this.db.execute('DELETE FROM sessions WHERE user_id = ? AND sid != ?', [userId, exceptSid])
      : await this.db.execute('DELETE FROM sessions WHERE user_id = ?', [userId]);
    return result.affectedRows;
  }

  /**
   * ลบ session ของผู้ใช้หลายคนพร้อมกัน — ใช้เมื่อสิทธิ์ของบทบาทเปลี่ยน
   * @param {Array<number>} userIds รหัสผู้ใช้
   * @returns {Promise<number>} จำนวน session ที่ลบ
   */
  async destroyForUsers(userIds) {
    if (!userIds?.length) return 0;
    const placeholders = userIds.map(() => '?').join(', ');
    const result = await this.db.execute(
      `DELETE FROM sessions WHERE user_id IN (${placeholders})`, userIds,
    );
    return result.affectedRows;
  }

  /**
   * session ที่ยังใช้งานได้ของผู้ใช้หนึ่ง — แสดงในหน้า `/account/sessions`
   * @param {number} userId รหัสผู้ใช้
   * @returns {Promise<Array<Session>>}
   */
  async activeForUser(userId) {
    const rows = await this.db.query(
      'SELECT * FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC',
      [userId, new Date()],
    );
    return rows.map((row) => this.mapRow(row));
  }

  /**
   * ลบ session ที่หมดอายุแล้ว
   * @returns {Promise<number>} จำนวนแถวที่ลบ
   */
  async purgeExpired() {
    const result = await this.db.execute(
      'DELETE FROM sessions WHERE expires_at <= ?', [new Date()],
    );
    return result.affectedRows;
  }
}
