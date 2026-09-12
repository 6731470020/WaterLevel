import { BaseRepository } from '../core/BaseRepository.js';
import { AuditLog } from '../models/AuditLog.js';

/**
 * ที่เก็บบันทึกการใช้งานระบบ (audit trail)
 */
export class AuditLogRepository extends BaseRepository {
  /** @param {import('../core/Database.js').Database} db ตัวเชื่อมฐานข้อมูล */
  constructor(db) {
    super(db, 'audit_logs');
  }

  /**
   * แปลงแถวดิบเป็นวัตถุ `AuditLog`
   * @param {object} row แถวจากตาราง `audit_logs`
   * @returns {AuditLog}
   */
  mapRow(row) {
    return new AuditLog({
      id: row.id,
      actorId: row.actor_id,
      actorLabel: row.actor_label,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      beforeData: row.before_data,
      afterData: row.after_data,
      ip: row.ip,
      userAgent: row.user_agent,
      createdAt: row.created_at,
    });
  }

  /**
   * แปลงวัตถุ `AuditLog` เป็นคู่คอลัมน์-ค่า
   * @param {AuditLog} log บันทึก
   * @returns {object}
   */
  toRow(log) {
    return {
      actor_id: log.actorId,
      actor_label: log.actorLabel,
      action: log.action,
      resource_type: log.resourceType,
      resource_id: log.resourceId,
      before_data: log.beforeData ? JSON.stringify(log.beforeData) : null,
      after_data: log.afterData ? JSON.stringify(log.afterData) : null,
      ip: log.ip,
      user_agent: log.userAgent,
    };
  }

  /**
   * ค้นบันทึกตามตัวกรอง พร้อมแบ่งหน้า
   * @param {{actorId?: number|null, action?: string, resourceType?: string, resourceId?: string|null, from?: string|null, to?: string|null, limit?: number, offset?: number}} [filters={}]
   * @returns {Promise<{items: Array<AuditLog>, total: number}>}
   */
  async search({
    actorId = null, action = '', resourceType = '', resourceId = null,
    from = null, to = null, limit = 50, offset = 0,
  } = {}) {
    const conditions = [];
    const params = [];
    if (actorId !== null && actorId !== '') { conditions.push('actor_id = ?'); params.push(Number(actorId)); }
    if (action) { conditions.push('action LIKE ?'); params.push(`${action}%`); }
    if (resourceType) { conditions.push('resource_type = ?'); params.push(resourceType); }
    if (resourceId !== null && resourceId !== '') { conditions.push('resource_id = ?'); params.push(String(resourceId)); }
    if (from) { conditions.push('created_at >= ?'); params.push(from); }
    if (to) { conditions.push('created_at <= ?'); params.push(to); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const totalRow = await this.db.queryOne(`SELECT COUNT(*) AS total FROM audit_logs ${where}`, params);
    const rows = await this.db.query(
      `SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, Number(limit), Number(offset)],
    );
    return { items: rows.map((row) => this.mapRow(row)), total: Number(totalRow?.total ?? 0) };
  }

  /**
   * รายการการกระทำที่พบในระบบ — ใช้เติมตัวเลือกในตัวกรอง
   * @returns {Promise<Array<string>>}
   */
  async distinctActions() {
    const rows = await this.db.query('SELECT DISTINCT action FROM audit_logs ORDER BY action');
    return rows.map((row) => row.action);
  }

  /**
   * ลบบันทึกที่เก่ากว่ากำหนด
   * @param {number} days จำนวนวัน
   * @returns {Promise<number>} จำนวนแถวที่ลบ
   */
  async purgeOlderThan(days) {
    const cutoff = new Date(Date.now() - Number(days) * 86400000);
    const result = await this.db.execute(
      'DELETE FROM audit_logs WHERE created_at < ?', [cutoff],
    );
    return result.affectedRows;
  }
}
