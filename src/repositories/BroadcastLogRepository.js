import { BaseRepository } from '../core/BaseRepository.js';
import { BroadcastLog } from '../models/BroadcastLog.js';

/**
 * ที่เก็บบันทึกการส่งข้อความแจ้งเตือน
 */
export class BroadcastLogRepository extends BaseRepository {
  /** @param {import('../core/Database.js').Database} db ตัวเชื่อมฐานข้อมูล */
  constructor(db) {
    super(db, 'broadcast_logs');
  }

  /**
   * แปลงแถวดิบเป็นวัตถุ `BroadcastLog`
   * @param {object} row แถวจากตาราง `broadcast_logs`
   * @returns {BroadcastLog}
   */
  mapRow(row) {
    return new BroadcastLog({
      id: row.id,
      stationId: row.station_id,
      messageType: row.message_type,
      zoneKey: row.zone_key,
      channel: row.channel,
      target: row.target,
      messageContent: row.message_content,
      status: row.status,
      response: row.response,
      errorMessage: row.error_message,
      sentAt: row.sent_at,
      triggeredBy: row.triggered_by,
      createdAt: row.created_at,
    });
  }

  /**
   * แปลงวัตถุ `BroadcastLog` เป็นคู่คอลัมน์-ค่า
   * @param {BroadcastLog} log บันทึก
   * @returns {object}
   */
  toRow(log) {
    return {
      station_id: log.stationId,
      message_type: log.messageType,
      zone_key: log.zoneKey,
      channel: log.channel,
      target: log.target,
      message_content: log.messageContent ? JSON.stringify(log.messageContent) : null,
      status: log.status,
      response: log.response ? JSON.stringify(log.response) : null,
      error_message: log.errorMessage,
      sent_at: log.sentAt,
      triggered_by: log.triggeredBy,
    };
  }

  /**
   * ค้นบันทึกตามตัวกรอง พร้อมแบ่งหน้า
   * @param {{stationIds?: Array<number>|null, stationId?: number|null, status?: string, messageType?: string, limit?: number, offset?: number}} [filters={}]
   * @returns {Promise<{items: Array<BroadcastLog>, total: number}>}
   */
  async search({ stationIds = null, stationId = null, status = '', messageType = '', limit = 50, offset = 0 } = {}) {
    const conditions = [];
    const params = [];
    if (stationId !== null && stationId !== '') {
      conditions.push('station_id = ?');
      params.push(Number(stationId));
    } else if (Array.isArray(stationIds)) {
      if (!stationIds.length) return { items: [], total: 0 };
      conditions.push(`station_id IN (${stationIds.map(() => '?').join(', ')})`);
      params.push(...stationIds);
    }
    if (status) { conditions.push('status = ?'); params.push(status); }
    if (messageType) { conditions.push('message_type = ?'); params.push(messageType); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const totalRow = await this.db.queryOne(`SELECT COUNT(*) AS total FROM broadcast_logs ${where}`, params);
    const rows = await this.db.query(
      `SELECT * FROM broadcast_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, Number(limit), Number(offset)],
    );
    return { items: rows.map((row) => this.mapRow(row)), total: Number(totalRow?.total ?? 0) };
  }

  /**
   * บันทึกผลการส่งลงแถวที่มีอยู่
   * @param {number} id รหัสบันทึก
   * @param {{status: string, response?: object|null, errorMessage?: string|null}} result ผลการส่ง
   * @returns {Promise<void>}
   */
  async markResult(id, { status, response = null, errorMessage = null }) {
    await this.db.execute(
      `UPDATE broadcast_logs
       SET status = ?, response = ?, error_message = ?, sent_at = ?
       WHERE id = ?`,
      [status, response ? JSON.stringify(response) : null, errorMessage, new Date(), id],
    );
  }
}
