import { BaseRepository } from '../core/BaseRepository.js';
import { LineGroup } from '../models/LineGroup.js';
import { LineUser } from '../models/LineUser.js';

/**
 * ที่เก็บกลุ่มและผู้ติดตาม LINE
 *
 * ดูแลสองตาราง (`line_groups` และ `line_users`) เพราะทั้งคู่มาจากแหล่งเดียวกัน
 * คือ webhook และมักถูกอ่านพร้อมกันเสมอ `tableName` หลักตั้งเป็น `line_groups`
 */
export class LineRepository extends BaseRepository {
  /** @param {import('../core/Database.js').Database} db ตัวเชื่อมฐานข้อมูล */
  constructor(db) {
    super(db, 'line_groups');
  }

  /**
   * แปลงแถวดิบเป็นวัตถุ `LineGroup`
   * @param {object} row แถวจากตาราง `line_groups`
   * @returns {LineGroup}
   */
  mapRow(row) {
    return new LineGroup({
      id: row.id,
      groupId: row.group_id,
      type: row.type,
      displayName: row.display_name,
      status: row.status,
      joinedAt: row.joined_at,
      lastActiveAt: row.last_active_at,
      leftAt: row.left_at,
    });
  }

  /**
   * แปลงวัตถุ `LineGroup` เป็นคู่คอลัมน์-ค่า
   * @param {LineGroup} group กลุ่ม
   * @returns {object}
   */
  toRow(group) {
    return {
      group_id: group.groupId,
      type: group.type,
      display_name: group.displayName,
      status: group.status,
    };
  }

  /**
   * กลุ่มที่ยังใช้งานอยู่ทั้งหมด — ปลายทางของการแจ้งเตือน
   * @returns {Promise<Array<LineGroup>>}
   */
  async activeGroups() {
    const rows = await this.db.query(
      "SELECT * FROM line_groups WHERE status = 'active' ORDER BY joined_at",
    );
    return rows.map((row) => this.mapRow(row));
  }

  /**
   * กลุ่มทั้งหมด รวมที่ออกไปแล้ว
   * @returns {Promise<Array<LineGroup>>}
   */
  async allGroups() {
    const rows = await this.db.query('SELECT * FROM line_groups ORDER BY status, joined_at DESC');
    return rows.map((row) => this.mapRow(row));
  }

  /**
   * บันทึกว่าบอทเข้ากลุ่ม (หรือกลับเข้ากลุ่มเดิม)
   * @param {string} groupId รหัสกลุ่มจาก LINE
   * @param {string} [type='group'] ชนิดแหล่งข้อความ
   * @returns {Promise<void>}
   */
  async recordJoin(groupId, type = 'group') {
    const now = new Date();
    await this.upsertRow(
      {
        group_id: groupId, type, status: 'active',
        joined_at: now, last_active_at: now, left_at: null,
      },
      ['type', 'status', 'last_active_at', 'left_at'],
      ['group_id'],
    );
  }

  /**
   * บันทึกว่าบอทออกจากกลุ่ม
   * @param {string} groupId รหัสกลุ่ม
   * @returns {Promise<void>}
   */
  async recordLeave(groupId) {
    await this.db.execute(
      "UPDATE line_groups SET status = 'left', left_at = ? WHERE group_id = ?",
      [new Date(), groupId],
    );
  }

  /**
   * ปรับปรุงเวลากิจกรรมล่าสุดของกลุ่ม
   * @param {string} groupId รหัสกลุ่ม
   * @returns {Promise<void>}
   */
  async touchGroup(groupId) {
    await this.db.execute(
      'UPDATE line_groups SET last_active_at = ? WHERE group_id = ?', [new Date(), groupId],
    );
  }

  /**
   * ตั้งชื่อกลุ่มเพื่อให้ผู้ดูแลจำได้
   * @param {number} id รหัสแถว
   * @param {string|null} displayName ชื่อที่ตั้ง
   * @returns {Promise<void>}
   */
  async renameGroup(id, displayName) {
    await this.db.execute('UPDATE line_groups SET display_name = ? WHERE id = ?', [displayName, id]);
  }

  /**
   * ผู้ติดตามที่ยังใช้งานอยู่ทั้งหมด
   * @returns {Promise<Array<LineUser>>}
   */
  async activeUsers() {
    const rows = await this.db.query(
      "SELECT * FROM line_users WHERE status = 'active' ORDER BY followed_at DESC",
    );
    return rows.map((row) => LineRepository.#mapUser(row));
  }

  /**
   * ผู้ติดตามทั้งหมด รวมที่เลิกติดตามแล้ว
   * @returns {Promise<Array<LineUser>>}
   */
  async allUsers() {
    const rows = await this.db.query('SELECT * FROM line_users ORDER BY status, followed_at DESC');
    return rows.map((row) => LineRepository.#mapUser(row));
  }

  /**
   * บันทึกว่ามีผู้ติดตามใหม่ (หรือกลับมาติดตามอีกครั้ง)
   * @param {string} lineUserId รหัสผู้ใช้จาก LINE
   * @returns {Promise<void>}
   */
  async recordFollow(lineUserId) {
    const now = new Date();
    // ตาราง line_users ไม่ใช่ตารางหลักของ Repository นี้ จึงประกอบคำสั่งผ่าน dialect โดยตรง
    const { sql } = this.db.dialect.upsert({
      table: 'line_users',
      columns: ['line_user_id', 'status', 'followed_at', 'last_active_at', 'unfollowed_at'],
      conflictColumns: ['line_user_id'],
      updateColumns: ['status', 'last_active_at', 'unfollowed_at'],
    });
    await this.db.execute(sql, [lineUserId, 'active', now, now, null]);
  }

  /**
   * บันทึกว่าผู้ติดตามเลิกติดตาม
   * @param {string} lineUserId รหัสผู้ใช้
   * @returns {Promise<void>}
   */
  async recordUnfollow(lineUserId) {
    await this.db.execute(
      "UPDATE line_users SET status = 'unfollowed', unfollowed_at = ? WHERE line_user_id = ?",
      [new Date(), lineUserId],
    );
  }

  /**
   * ปรับปรุงเวลากิจกรรมล่าสุดของผู้ติดตาม
   * @param {string} lineUserId รหัสผู้ใช้
   * @returns {Promise<void>}
   */
  async touchUser(lineUserId) {
    await this.db.execute(
      'UPDATE line_users SET last_active_at = ? WHERE line_user_id = ?', [new Date(), lineUserId],
    );
  }

  /**
   * นับจำนวนกลุ่มและผู้ติดตามที่ใช้งานอยู่
   * @returns {Promise<{groups: number, users: number}>}
   */
  async counts() {
    const [groupRow, userRow] = await Promise.all([
      this.db.queryOne("SELECT COUNT(*) AS total FROM line_groups WHERE status = 'active'"),
      this.db.queryOne("SELECT COUNT(*) AS total FROM line_users WHERE status = 'active'"),
    ]);
    return { groups: Number(groupRow?.total ?? 0), users: Number(userRow?.total ?? 0) };
  }

  /**
   * แปลงแถวดิบเป็นวัตถุ `LineUser`
   * @param {object} row แถวจากตาราง `line_users`
   * @returns {LineUser}
   */
  static #mapUser(row) {
    return new LineUser({
      id: row.id,
      lineUserId: row.line_user_id,
      displayName: row.display_name,
      status: row.status,
      followedAt: row.followed_at,
      lastActiveAt: row.last_active_at,
      unfollowedAt: row.unfollowed_at,
    });
  }
}
