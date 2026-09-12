import { BaseRepository } from '../core/BaseRepository.js';
import { Permission } from '../models/Permission.js';

/**
 * ที่เก็บรายการสิทธิ์ — เนื้อหาคงที่ ซิงก์จาก `Permission.catalog()` ตอน seed
 */
export class PermissionRepository extends BaseRepository {
  /** @param {import('../core/Database.js').Database} db ตัวเชื่อมฐานข้อมูล */
  constructor(db) {
    super(db, 'permissions');
  }

  /**
   * แปลงแถวดิบเป็นวัตถุ `Permission`
   * @param {object} row แถวจากตาราง `permissions`
   * @returns {Permission}
   */
  mapRow(row) {
    return new Permission({
      id: row.id,
      permissionKey: row.permission_key,
      resource: row.resource,
      action: row.action,
      description: row.description,
    });
  }

  /**
   * แปลงวัตถุ `Permission` เป็นคู่คอลัมน์-ค่า
   * @param {Permission} permission สิทธิ์
   * @returns {object}
   */
  toRow(permission) {
    return {
      permission_key: permission.permissionKey,
      resource: permission.resource,
      action: permission.action,
      description: permission.description,
    };
  }

  /**
   * ซิงก์รายการสิทธิ์ในฐานข้อมูลให้ตรงกับ `Permission.catalog()`
   *
   * เพิ่มสิทธิ์ใหม่และอัปเดตคำอธิบาย แต่**ไม่ลบ**สิทธิ์เก่าอัตโนมัติ
   * เพราะการลบจะพารา `role_permissions` หายไปด้วยแบบ cascade
   *
   * @returns {Promise<{inserted: number, updated: number}>}
   */
  async syncCatalog() {
    const existing = new Set(
      (await this.db.query('SELECT permission_key FROM permissions'))
        .map((row) => row.permission_key),
    );

    let inserted = 0;
    let updated = 0;

    for (const item of Permission.catalog()) {
      await this.upsertRow(
        {
          permission_key: item.key,
          resource: item.resource,
          action: item.action,
          description: item.description,
        },
        ['resource', 'action', 'description'],
        ['permission_key'],
      );
      if (existing.has(item.key)) updated += 1;
      else inserted += 1;
    }
    return { inserted, updated };
  }

  /**
   * คีย์สิทธิ์ทั้งหมดของบทบาทหนึ่ง
   * @param {number} roleId รหัสบทบาท
   * @returns {Promise<Array<string>>}
   */
  async keysForRole(roleId) {
    const rows = await this.db.query(
      `SELECT p.permission_key FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = ?`,
      [roleId],
    );
    return rows.map((row) => row.permission_key);
  }

  /**
   * คีย์สิทธิ์ทั้งหมดของผู้ใช้หนึ่ง (รวมจากทุกบทบาท)
   * @param {number} userId รหัสผู้ใช้
   * @returns {Promise<Array<string>>}
   */
  async keysForUser(userId) {
    const rows = await this.db.query(
      `SELECT DISTINCT p.permission_key
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE ur.user_id = ?`,
      [userId],
    );
    return rows.map((row) => row.permission_key);
  }
}
