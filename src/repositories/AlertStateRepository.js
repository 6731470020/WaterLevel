import { BaseRepository } from '../core/BaseRepository.js';
import { StationAlertState } from '../models/StationAlertState.js';

/**
 * ที่เก็บสถานะการแจ้งเตือนล่าสุดรายจุดวัด — ใช้กันการแจ้งเตือนซ้ำ
 */
export class AlertStateRepository extends BaseRepository {
  /** @param {import('../core/Database.js').Database} db ตัวเชื่อมฐานข้อมูล */
  constructor(db) {
    super(db, 'station_alert_states');
  }

  /**
   * แปลงแถวดิบเป็นวัตถุ `StationAlertState`
   * @param {object} row แถวจากตาราง `station_alert_states`
   * @returns {StationAlertState}
   */
  mapRow(row) {
    return new StationAlertState({
      id: row.id,
      stationId: row.station_id,
      lastZoneKey: row.last_zone_key,
      lastAlertedZoneKey: row.last_alerted_zone_key,
      lastAlertAt: row.last_alert_at,
      lastMeasuredAt: row.last_measured_at,
      updatedAt: row.updated_at,
    });
  }

  /**
   * แปลงวัตถุ `StationAlertState` เป็นคู่คอลัมน์-ค่า
   * @param {StationAlertState} state สถานะ
   * @returns {object}
   */
  toRow(state) {
    return {
      station_id: state.stationId,
      last_zone_key: state.lastZone?.key ?? null,
      last_alerted_zone_key: state.lastAlertedZone?.key ?? null,
      last_alert_at: state.lastAlertAt,
      last_measured_at: state.lastMeasuredAt,
    };
  }

  /**
   * ค้นสถานะของจุดวัด — คืนสถานะว่างเปล่าเมื่อยังไม่เคยมี
   * @param {number} stationId รหัสจุดวัด
   * @returns {Promise<StationAlertState>}
   */
  async findByStation(stationId) {
    const row = await this.db.queryOne(
      'SELECT * FROM station_alert_states WHERE station_id = ? LIMIT 1', [stationId],
    );
    return row ? this.mapRow(row) : new StationAlertState({ stationId });
  }

  /**
   * บันทึกโซนที่วัดได้ล่าสุด (ไม่แตะเวลาการแจ้งเตือน)
   * @param {number} stationId รหัสจุดวัด
   * @param {string|null} zoneKey คีย์โซน
   * @param {Date} measuredAt เวลาที่วัด
   * @returns {Promise<void>}
   */
  async recordZone(stationId, zoneKey, measuredAt) {
    await this.upsertRow(
      { station_id: stationId, last_zone_key: zoneKey, last_measured_at: measuredAt },
      ['last_zone_key', 'last_measured_at'],
      ['station_id'],
    );
  }

  /**
   * บันทึกว่าเพิ่งส่งการแจ้งเตือนไป — รีเซ็ตตัวจับเวลา cooldown
   * @param {number} stationId รหัสจุดวัด
   * @param {string} zoneKey คีย์โซนที่แจ้งเตือน
   * @returns {Promise<void>}
   */
  async recordAlert(stationId, zoneKey) {
    await this.upsertRow(
      {
        station_id: stationId,
        last_zone_key: zoneKey,
        last_alerted_zone_key: zoneKey,
        last_alert_at: new Date(),
      },
      ['last_zone_key', 'last_alerted_zone_key', 'last_alert_at'],
      ['station_id'],
    );
  }
}
