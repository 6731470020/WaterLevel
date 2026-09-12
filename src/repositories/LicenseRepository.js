import { BaseRepository } from '../core/BaseRepository.js';
import { License } from '../models/License.js';

/**
 * ที่เก็บใบอนุญาตใช้งานระบบ
 */
export class LicenseRepository extends BaseRepository {
  /** @param {import('../core/Database.js').Database} db ตัวเชื่อมฐานข้อมูล */
  constructor(db) {
    super(db, 'licenses');
  }

  /**
   * แปลงแถวดิบเป็นวัตถุ `License`
   * @param {object} row แถวจากตาราง `licenses`
   * @returns {License}
   */
  mapRow(row) {
    return new License({
      id: row.id,
      licenseKey: row.license_key,
      expiredAt: row.expired_at,
      isActive: Boolean(row.is_active),
      contactEmail: row.contact_email,
      contactPhone: row.contact_phone,
      contactLine: row.contact_line,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  /**
   * แปลงวัตถุ `License` เป็นคู่คอลัมน์-ค่า
   * @param {License} license ใบอนุญาต
   * @returns {object}
   */
  toRow(license) {
    return {
      license_key: license.licenseKey,
      expired_at: license.expiredAt,
      is_active: license.isActive ? 1 : 0,
      contact_email: license.contactEmail,
      contact_phone: license.contactPhone,
      contact_line: license.contactLine,
    };
  }

  /**
   * ใบอนุญาตที่ใช้งานอยู่ (ตัวที่หมดอายุช้าที่สุด)
   * @returns {Promise<License|null>}
   */
  async findCurrent() {
    const row = await this.db.queryOne(
      'SELECT * FROM licenses WHERE is_active = 1 ORDER BY expired_at DESC LIMIT 1',
    );
    return row ? this.mapRow(row) : null;
  }
}
