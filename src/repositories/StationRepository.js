import { BaseRepository } from '../core/BaseRepository.js';
import { Station } from '../models/Station.js';

/**
 * ที่เก็บข้อมูลจุดวัด
 *
 * เมท็อดที่ดึงหลายจุดวัดรับพารามิเตอร์ `stationIds` เสมอ เพื่อให้ชั้น Service
 * บังคับขอบเขตสิทธิ์ได้ (ชั้นป้องกันที่ 2 ตาม CLAUDE.md ข้อ 8.4)
 */
export class StationRepository extends BaseRepository {
  /** @param {import('../core/Database.js').Database} db ตัวเชื่อมฐานข้อมูล */
  constructor(db) {
    super(db, 'stations');
  }

  /**
   * แปลงแถวดิบเป็นวัตถุ `Station`
   * @param {object} row แถวจากตาราง `stations`
   * @returns {Station}
   */
  mapRow(row) {
    return new Station({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      cameraUrl: row.camera_url,
      cameraType: row.camera_type,
      cameraUsername: row.camera_username,
      cameraPassword: row.camera_password,
      publicLiveEnabled: Boolean(Number(row.public_live_enabled)),
      imageWidth: row.image_width,
      imageHeight: row.image_height,
      latitude: row.latitude,
      longitude: row.longitude,
      isActive: Boolean(row.is_active),
      alertZoneKeys: row.alert_zone_keys,
      alertCooldownMinutes: row.alert_cooldown_minutes,
      lineGroupId: row.line_group_id,
      pdpaEnabled: Boolean(row.pdpa_enabled),
      pdpaMethod: row.pdpa_method,
      pdpaBlurStrength: row.pdpa_blur_strength,
      pdpaConfThreshold: row.pdpa_conf_threshold,
      imageRetentionDays: row.image_retention_days,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  /**
   * แปลงวัตถุ `Station` เป็นคู่คอลัมน์-ค่า
   * @param {Station} station จุดวัด
   * @returns {object}
   */
  toRow(station) {
    return {
      slug: station.slug,
      name: station.name,
      description: station.description,
      camera_url: station.cameraUrl,
      camera_username: station.cameraUsername,
      camera_password: station.cameraPassword,
      public_live_enabled: station.publicLiveEnabled ? 1 : 0,
      camera_type: station.cameraType,
      image_width: station.imageWidth,
      image_height: station.imageHeight,
      latitude: station.latitude,
      longitude: station.longitude,
      is_active: station.isActive ? 1 : 0,
      alert_zone_keys: JSON.stringify(station.alertZoneKeys),
      alert_cooldown_minutes: station.alertCooldownMinutes,
      line_group_id: station.lineGroupId,
      pdpa_enabled: station.pdpaEnabled ? 1 : 0,
      pdpa_method: station.pdpaMethod,
      pdpa_blur_strength: station.pdpaBlurStrength,
      pdpa_conf_threshold: station.pdpaConfThreshold,
      image_retention_days: station.imageRetentionDays,
    };
  }

  /**
   * ค้นจุดวัดจาก slug (ใช้ในหน้าสาธารณะ)
   * @param {string} slug ชื่อย่อ
   * @returns {Promise<Station|null>}
   */
  async findBySlug(slug) {
    const row = await this.db.queryOne(
      'SELECT * FROM stations WHERE slug = ? LIMIT 1', [String(slug)],
    );
    return row ? this.mapRow(row) : null;
  }

  /**
   * จุดวัดที่เปิดใช้งานทั้งหมด — ใช้โดยงานตามเวลา
   * @returns {Promise<Array<Station>>}
   */
  async findActive() {
    const rows = await this.db.query('SELECT * FROM stations WHERE is_active = 1 ORDER BY id');
    return rows.map((row) => this.mapRow(row));
  }

  /**
   * ค้นจุดวัดพร้อมตัวกรองและขอบเขตสิทธิ์
   * @param {{search?: string, isActive?: boolean|null, stationIds?: Array<number>|null, limit?: number, offset?: number}} [filters={}]
   * @returns {Promise<{items: Array<Station>, total: number}>}
   */
  async search({ search = '', isActive = null, stationIds = null, limit = 50, offset = 0 } = {}) {
    const conditions = [];
    const params = [];
    if (search) {
      conditions.push('(name LIKE ? OR slug LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    if (isActive !== null) {
      conditions.push('is_active = ?');
      params.push(isActive ? 1 : 0);
    }
    if (Array.isArray(stationIds)) {
      if (!stationIds.length) return { items: [], total: 0 };
      conditions.push(`id IN (${stationIds.map(() => '?').join(', ')})`);
      params.push(...stationIds);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const totalRow = await this.db.queryOne(`SELECT COUNT(*) AS total FROM stations ${where}`, params);
    const rows = await this.db.query(
      `SELECT * FROM stations ${where} ORDER BY name LIMIT ? OFFSET ?`,
      [...params, Number(limit), Number(offset)],
    );
    return { items: rows.map((row) => this.mapRow(row)), total: Number(totalRow?.total ?? 0) };
  }

  /**
   * ภาพรวมทุกจุดวัดพร้อมค่าวัดล่าสุด — ใช้ในหน้าแรกและหน้า `/admin`
   * @param {{stationIds?: Array<number>|null, activeOnly?: boolean}} [options={}]
   * @returns {Promise<Array<{station: Station, latest: object|null}>>}
   */
  async findWithLatestMeasurement({ stationIds = null, activeOnly = false } = {}) {
    const conditions = [];
    const params = [];
    if (activeOnly) conditions.push('s.is_active = 1');
    if (Array.isArray(stationIds)) {
      if (!stationIds.length) return [];
      conditions.push(`s.id IN (${stationIds.map(() => '?').join(', ')})`);
      params.push(...stationIds);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = await this.db.query(`
      SELECT s.*,
             m.id AS m_id, m.measured_at, m.water_line, m.water_level_m,
             m.zone_key, m.image_path, m.thumbnail_path, m.quality
      FROM stations s
      LEFT JOIN measurements m ON m.id = (
        SELECT id FROM measurements
        WHERE station_id = s.id
        ORDER BY measured_at DESC, id DESC
        LIMIT 1
      )
      ${where}
      ORDER BY s.name
    `, params);

    return rows.map((row) => ({
      station: this.mapRow(row),
      latest: row.m_id ? {
        id: row.m_id,
        measuredAt: row.measured_at,
        waterLine: row.water_line,
        waterLevelM: row.water_level_m === null ? null : Number(row.water_level_m),
        zoneKey: row.zone_key,
        quality: row.quality,
        isEstimate: row.quality === 'AT_FRAME_EDGE',
        imageUrl: row.image_path ? `/storage/${row.image_path}` : null,
        thumbnailUrl: row.thumbnail_path ? `/storage/${row.thumbnail_path}` : null,
      } : null,
    }));
  }

  /**
   * ตรวจว่า slug ถูกใช้ไปแล้วหรือยัง
   * @param {string} slug ชื่อย่อ
   * @param {number|null} [exceptId=null] รหัสจุดวัดที่ยกเว้น (ตอนแก้ไข)
   * @returns {Promise<boolean>}
   */
  async slugTaken(slug, exceptId = null) {
    const row = exceptId === null
      ? await this.db.queryOne('SELECT id FROM stations WHERE slug = ? LIMIT 1', [slug])
      : await this.db.queryOne('SELECT id FROM stations WHERE slug = ? AND id != ? LIMIT 1', [slug, exceptId]);
    return row !== null;
  }

  /**
   * รหัสจุดวัดทั้งหมดในระบบ
   * @returns {Promise<Array<number>>}
   */
  async allIds() {
    const rows = await this.db.query('SELECT id FROM stations ORDER BY id');
    return rows.map((row) => Number(row.id));
  }
}
