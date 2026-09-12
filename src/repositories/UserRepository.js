import { BaseRepository } from '../core/BaseRepository.js';
import { User } from '../models/User.js';
import { Role } from '../models/Role.js';

/**
 * ที่เก็บข้อมูลผู้ใช้ บทบาท และขอบเขตจุดวัด
 *
 * โหลดบทบาทและสิทธิ์มาพร้อมผู้ใช้เสมอเมื่อค้นด้วย `findByLogin()` หรือ `findWithAccess()`
 * เพื่อให้ `AuthMiddleware` มีข้อมูลครบตั้งแต่คำขอแรกโดยไม่ต้องถามซ้ำ
 */
export class UserRepository extends BaseRepository {
  /** @param {import('../core/Database.js').Database} db ตัวเชื่อมฐานข้อมูล */
  constructor(db) {
    super(db, 'users');
  }

  /**
   * แปลงแถวดิบเป็นวัตถุ `User`
   * @param {object} row แถวจากตาราง `users`
   * @returns {User}
   */
  mapRow(row) {
    return new User({
      id: row.id,
      username: row.username,
      email: row.email,
      passwordHash: row.password_hash,
      hashAlgo: row.hash_algo,
      fullName: row.full_name,
      phone: row.phone,
      status: row.status,
      isSuperAdmin: Boolean(row.is_super_admin),
      mustChangePassword: Boolean(row.must_change_password),
      failedLoginCount: row.failed_login_count,
      lockedUntil: row.locked_until,
      lastLoginAt: row.last_login_at,
      lastLoginIp: row.last_login_ip,
      deletedAt: row.deleted_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  /**
   * แปลงวัตถุ `User` เป็นคู่คอลัมน์-ค่า
   * @param {User} user ผู้ใช้
   * @returns {object}
   */
  toRow(user) {
    return {
      username: user.username,
      email: user.email,
      password_hash: user.passwordHash,
      hash_algo: user.hashAlgo,
      full_name: user.fullName,
      phone: user.phone,
      status: user.status,
      is_super_admin: user.isSuperAdmin ? 1 : 0,
      must_change_password: user.mustChangePassword ? 1 : 0,
    };
  }

  /**
   * ค้นผู้ใช้จากชื่อผู้ใช้หรืออีเมล พร้อมบทบาทและขอบเขตจุดวัด
   *
   * ใช้ตอนเข้าสู่ระบบ — คืนผู้ใช้ที่ถูกลบแบบนุ่มนวลด้วยหรือไม่ก็ได้ แต่ค่าเริ่มต้นคือไม่คืน
   *
   * @param {string} login ชื่อผู้ใช้หรืออีเมล
   * @returns {Promise<User|null>}
   */
  async findByLogin(login) {
    const row = await this.db.queryOne(
      `SELECT * FROM users
       WHERE (username = ? OR email = ?) AND deleted_at IS NULL
       LIMIT 1`,
      [String(login).trim(), String(login).trim().toLowerCase()],
    );
    if (!row) return null;
    const user = this.mapRow(row);
    await this.loadAccess(user);
    return user;
  }

  /**
   * ค้นผู้ใช้ด้วยรหัส พร้อมบทบาทและขอบเขตจุดวัด
   * @param {number} id รหัสผู้ใช้
   * @returns {Promise<User|null>}
   */
  async findWithAccess(id) {
    const row = await this.db.queryOne(
      'SELECT * FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1', [id],
    );
    if (!row) return null;
    const user = this.mapRow(row);
    await this.loadAccess(user);
    return user;
  }

  /**
   * เติมบทบาท สิทธิ์ และขอบเขตจุดวัดให้วัตถุผู้ใช้
   * @param {User} user ผู้ใช้ที่ต้องการเติมข้อมูล
   * @returns {Promise<User>} ผู้ใช้ตัวเดิมที่เติมข้อมูลแล้ว
   */
  async loadAccess(user) {
    const roleRows = await this.db.query(
      `SELECT r.id, r.role_key, r.name, r.description, r.is_system,
              GROUP_CONCAT(p.permission_key) AS permission_keys
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
       WHERE ur.user_id = ?
       GROUP BY r.id`,
      [user.id],
    );
    user.assignRoles(roleRows.map((row) => new Role({
      id: row.id,
      roleKey: row.role_key,
      name: row.name,
      description: row.description,
      isSystem: Boolean(row.is_system),
      permissionKeys: row.permission_keys ? row.permission_keys.split(',') : [],
    })));

    const stationRows = await this.db.query(
      'SELECT station_id FROM user_stations WHERE user_id = ?', [user.id],
    );
    user.assignStations(stationRows.map((row) => row.station_id));
    return user;
  }

  /**
   * ค้นผู้ใช้แบบแบ่งหน้าพร้อมตัวกรอง
   * @param {{search?: string, status?: string, roleKey?: string, limit?: number, offset?: number}} [filters={}]
   * @returns {Promise<{items: Array<User>, total: number}>}
   */
  async search({ search = '', status = '', roleKey = '', limit = 50, offset = 0 } = {}) {
    const conditions = ['u.deleted_at IS NULL'];
    const params = [];
    if (search) {
      conditions.push('(u.username LIKE ? OR u.email LIKE ? OR u.full_name LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    if (status) {
      conditions.push('u.status = ?');
      params.push(status);
    }
    if (roleKey) {
      conditions.push('EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.role_key = ?)');
      params.push(roleKey);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const totalRow = await this.db.queryOne(`SELECT COUNT(*) AS total FROM users u ${where}`, params);
    const rows = await this.db.query(
      `SELECT u.* FROM users u ${where} ORDER BY u.id DESC LIMIT ? OFFSET ?`,
      [...params, Number(limit), Number(offset)],
    );
    const items = [];
    for (const row of rows) {
      const user = this.mapRow(row);
      await this.loadAccess(user);
      items.push(user);
    }
    return { items, total: Number(totalRow?.total ?? 0) };
  }

  /**
   * สร้างผู้ใช้พร้อมผูกบทบาทและขอบเขตจุดวัดใน transaction เดียว
   * @param {User} user ผู้ใช้ใหม่
   * @param {Array<number>} [roleIds=[]] รหัสบทบาท
   * @param {Array<number>} [stationIds=[]] รหัสจุดวัดที่จำกัดสิทธิ์
   * @returns {Promise<number>} รหัสผู้ใช้ที่สร้าง
   */
  async createWithAccess(user, roleIds = [], stationIds = []) {
    user.validate();
    return this.transaction(async (tx) => {
      const userId = await this.insertRow(this.toRow(user), tx);
      await tx.execute(
        'INSERT INTO password_history (user_id, password_hash, hash_algo) VALUES (?, ?, ?)',
        [userId, user.passwordHash, user.hashAlgo],
      );
      for (const roleId of roleIds) {
        await tx.execute('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, roleId]);
      }
      for (const stationId of stationIds) {
        await tx.execute('INSERT INTO user_stations (user_id, station_id) VALUES (?, ?)', [userId, stationId]);
      }
      return userId;
    });
  }

  /**
   * แทนที่บทบาทของผู้ใช้ทั้งชุด
   * @param {number} userId รหัสผู้ใช้
   * @param {Array<number>} roleIds รหัสบทบาทชุดใหม่
   * @returns {Promise<void>}
   */
  async replaceRoles(userId, roleIds) {
    await this.transaction(async (tx) => {
      await tx.execute('DELETE FROM user_roles WHERE user_id = ?', [userId]);
      for (const roleId of roleIds) {
        await tx.execute('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, roleId]);
      }
    });
  }

  /**
   * แทนที่ขอบเขตจุดวัดของผู้ใช้ทั้งชุด (อาร์เรย์ว่าง = เข้าถึงได้ทุกจุด)
   * @param {number} userId รหัสผู้ใช้
   * @param {Array<number>} stationIds รหัสจุดวัดชุดใหม่
   * @returns {Promise<void>}
   */
  async replaceStations(userId, stationIds) {
    await this.transaction(async (tx) => {
      await tx.execute('DELETE FROM user_stations WHERE user_id = ?', [userId]);
      for (const stationId of stationIds) {
        await tx.execute('INSERT INTO user_stations (user_id, station_id) VALUES (?, ?)', [userId, stationId]);
      }
    });
  }

  /**
   * บันทึกผลการเข้าสู่ระบบสำเร็จ — ล้างตัวนับที่ผิดและปลดล็อก
   * @param {number} userId รหัสผู้ใช้
   * @param {string|null} ip หมายเลข IP
   * @returns {Promise<void>}
   */
  async recordSuccessfulLogin(userId, ip) {
    await this.db.execute(
      `UPDATE users
       SET failed_login_count = 0, locked_until = NULL, last_login_at = ?, last_login_ip = ?
       WHERE id = ?`,
      [new Date(), ip, userId],
    );
  }

  /**
   * เพิ่มตัวนับการเข้าสู่ระบบล้มเหลว และล็อกบัญชีเมื่อถึงเกณฑ์
   * @param {number} userId รหัสผู้ใช้
   * @param {Date|null} lockUntil เวลาปลดล็อก (null = ยังไม่ล็อก)
   * @returns {Promise<number>} จำนวนครั้งที่ผิดสะสมหลังอัปเดต
   */
  async recordFailedLogin(userId, lockUntil) {
    await this.db.execute(
      'UPDATE users SET failed_login_count = failed_login_count + 1, locked_until = ? WHERE id = ?',
      [lockUntil, userId],
    );
    const row = await this.db.queryOne('SELECT failed_login_count FROM users WHERE id = ?', [userId]);
    return Number(row?.failed_login_count ?? 0);
  }

  /**
   * เปลี่ยนรหัสผ่านและบันทึกลงประวัติ
   * @param {number} userId รหัสผู้ใช้
   * @param {string} passwordHash แฮชใหม่
   * @param {string} hashAlgo อัลกอริทึม
   * @param {boolean} [mustChange=false] บังคับให้เปลี่ยนอีกครั้งหรือไม่
   * @returns {Promise<void>}
   */
  async changePassword(userId, passwordHash, hashAlgo, mustChange = false) {
    await this.transaction(async (tx) => {
      await tx.execute(
        'UPDATE users SET password_hash = ?, hash_algo = ?, must_change_password = ? WHERE id = ?',
        [passwordHash, hashAlgo, mustChange ? 1 : 0, userId],
      );
      await tx.execute(
        'INSERT INTO password_history (user_id, password_hash, hash_algo) VALUES (?, ?, ?)',
        [userId, passwordHash, hashAlgo],
      );
    });
  }

  /**
   * อัปเกรดแฮชจาก bcrypt เป็น scrypt โดยไม่แตะประวัติรหัสผ่าน
   *
   * เรียกอัตโนมัติเมื่อผู้ใช้เดิมจากระบบ PHP เข้าสู่ระบบสำเร็จ (CLAUDE.md ข้อ 8.1)
   *
   * @param {number} userId รหัสผู้ใช้
   * @param {string} passwordHash แฮช scrypt ใหม่
   * @returns {Promise<void>}
   */
  async upgradeHash(userId, passwordHash) {
    await this.db.execute(
      "UPDATE users SET password_hash = ?, hash_algo = 'scrypt' WHERE id = ?",
      [passwordHash, userId],
    );
  }

  /**
   * แฮชรหัสผ่านล่าสุด N รายการ — ใช้บังคับนโยบายห้ามใช้รหัสเดิมซ้ำ
   * @param {number} userId รหัสผู้ใช้
   * @param {number} [limit=3] จำนวนรายการ
   * @returns {Promise<Array<{password_hash: string, hash_algo: string}>>}
   */
  async recentPasswords(userId, limit = 3) {
    return this.db.query(
      'SELECT password_hash, hash_algo FROM password_history WHERE user_id = ? ORDER BY id DESC LIMIT ?',
      [userId, Number(limit)],
    );
  }

  /**
   * ลบผู้ใช้แบบนุ่มนวล (เก็บ audit log ไว้)
   * @param {number} userId รหัสผู้ใช้
   * @returns {Promise<boolean>}
   */
  async softDelete(userId) {
    const result = await this.db.execute(
      "UPDATE users SET deleted_at = ?, status = 'SUSPENDED' WHERE id = ? AND deleted_at IS NULL",
      [new Date(), userId],
    );
    return result.affectedRows > 0;
  }

  /**
   * ค้นผู้ใช้จากอีเมล (ใช้ตอนลืมรหัสผ่าน)
   * @param {string} email อีเมล
   * @returns {Promise<User|null>}
   */
  async findByEmail(email) {
    const row = await this.db.queryOne(
      'SELECT * FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1',
      [String(email).trim().toLowerCase()],
    );
    return row ? this.mapRow(row) : null;
  }

  /**
   * รายชื่อรหัสผู้ใช้ที่ถือบทบาทหนึ่ง — ใช้ล้าง session เมื่อสิทธิ์ของบทบาทเปลี่ยน
   * @param {number} roleId รหัสบทบาท
   * @returns {Promise<Array<number>>}
   */
  async userIdsByRole(roleId) {
    const rows = await this.db.query('SELECT user_id FROM user_roles WHERE role_id = ?', [roleId]);
    return rows.map((row) => Number(row.user_id));
  }
}
