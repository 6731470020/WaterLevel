import { BaseRepository } from '../core/BaseRepository.js';
import { Role } from '../models/Role.js';

/**
 * ที่เก็บข้อมูลบทบาทและความสัมพันธ์กับสิทธิ์
 */
export class RoleRepository extends BaseRepository {
  /** @param {import('../core/Database.js').Database} db ตัวเชื่อมฐานข้อมูล */
  constructor(db) {
    super(db, 'roles');
  }

  /**
   * แปลงแถวดิบเป็นวัตถุ `Role`
   * @param {object} row แถวจากตาราง `roles`
   * @returns {Role}
   */
  mapRow(row) {
    return new Role({
      id: row.id,
      roleKey: row.role_key,
      name: row.name,
      description: row.description,
      isSystem: Boolean(row.is_system),
      permissionKeys: row.permission_keys
        ? String(row.permission_keys).split(',').filter(Boolean) : [],
      userCount: row.user_count ?? 0,
      createdAt: row.created_at,
    });
  }

  /**
   * แปลงวัตถุ `Role` เป็นคู่คอลัมน์-ค่า
   * @param {Role} role บทบาท
   * @returns {object}
   */
  toRow(role) {
    return {
      role_key: role.roleKey,
      name: role.name,
      description: role.description,
      is_system: role.isSystem ? 1 : 0,
    };
  }

  /**
   * บทบาททั้งหมดพร้อมสิทธิ์และจำนวนผู้ใช้
   * @returns {Promise<Array<Role>>}
   */
  async findAllWithPermissions() {
    const rows = await this.db.query(`
      SELECT r.*,
             GROUP_CONCAT(DISTINCT p.permission_key) AS permission_keys,
             (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = r.id) AS user_count
      FROM roles r
      LEFT JOIN role_permissions rp ON rp.role_id = r.id
      LEFT JOIN permissions p ON p.id = rp.permission_id
      GROUP BY r.id
      ORDER BY r.id
    `);
    return rows.map((row) => this.mapRow(row));
  }

  /**
   * ค้นบทบาทด้วยรหัสพร้อมสิทธิ์
   * @param {number} id รหัสบทบาท
   * @returns {Promise<Role|null>}
   */
  async findWithPermissions(id) {
    const row = await this.db.queryOne(`
      SELECT r.*,
             GROUP_CONCAT(DISTINCT p.permission_key) AS permission_keys,
             (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = r.id) AS user_count
      FROM roles r
      LEFT JOIN role_permissions rp ON rp.role_id = r.id
      LEFT JOIN permissions p ON p.id = rp.permission_id
      WHERE r.id = ?
      GROUP BY r.id
    `, [id]);
    return row ? this.mapRow(row) : null;
  }

  /**
   * ค้นบทบาทด้วยคีย์
   * @param {string} roleKey คีย์บทบาท
   * @returns {Promise<Role|null>}
   */
  async findByKey(roleKey) {
    const row = await this.db.queryOne(
      'SELECT * FROM roles WHERE role_key = ? LIMIT 1', [String(roleKey).toUpperCase()],
    );
    return row ? this.mapRow(row) : null;
  }

  /**
   * แทนที่ชุดสิทธิ์ของบทบาททั้งชุด
   * @param {number} roleId รหัสบทบาท
   * @param {Array<string>} permissionKeys คีย์สิทธิ์ชุดใหม่
   * @returns {Promise<void>}
   */
  async replacePermissions(roleId, permissionKeys) {
    await this.transaction(async (tx) => {
      await tx.execute('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);
      if (!permissionKeys.length) return;
      const placeholders = permissionKeys.map(() => '?').join(', ');
      await tx.execute(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT ?, id FROM permissions WHERE permission_key IN (${placeholders})`,
        [roleId, ...permissionKeys],
      );
    });
  }

  /**
   * แปลงคีย์บทบาทเป็นรหัส
   * @param {Array<string>} roleKeys คีย์บทบาท
   * @returns {Promise<Array<number>>}
   */
  async idsByKeys(roleKeys) {
    if (!roleKeys?.length) return [];
    const placeholders = roleKeys.map(() => '?').join(', ');
    const rows = await this.db.query(
      `SELECT id FROM roles WHERE role_key IN (${placeholders})`,
      roleKeys.map((key) => String(key).toUpperCase()),
    );
    return rows.map((row) => Number(row.id));
  }
}
