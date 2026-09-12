import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { DatabaseFactory } from '../core/Database.js';
import { EnvWriter } from '../core/EnvWriter.js';
import { Validator } from '../core/Validator.js';
import { ValidationError, ForbiddenError } from '../core/errors/index.js';
import { MigrationRunner } from '../../scripts/MigrationRunner.js';
import { SeedRunner } from '../../scripts/SeedRunner.js';
import { UserRepository } from '../repositories/UserRepository.js';
import { RoleRepository } from '../repositories/RoleRepository.js';
import { ScryptHasher } from './security/ScryptHasher.js';
import { User } from '../models/User.js';
import { Role } from '../models/Role.js';

/**
 * บริการติดตั้งระบบครั้งแรกผ่านหน้าเว็บ
 *
 * ให้ผู้ดูแลเลือกได้ว่าจะใช้ **SQLite** (ไฟล์เดียว ไม่ต้องติดตั้งอะไรเพิ่ม) หรือ
 * **MySQL** (เซิร์ฟเวอร์แยก) แล้วระบบจะเขียน `.env`, สร้างตาราง, ใส่ข้อมูลตั้งต้น
 * และสร้างผู้ดูแลคนแรกให้ครบในขั้นตอนเดียว
 *
 * **ความปลอดภัย — สำคัญมาก**
 * หน้าตั้งค่าเป็นช่องทางที่สร้างบัญชีผู้ดูแลสูงสุดได้โดยไม่ต้องเข้าสู่ระบบ
 * จึงต้องปิดตายทันทีที่ติดตั้งเสร็จ เงื่อนไขที่ยอมให้เข้าถึงมีเพียงกรณีเดียว:
 * **ระบบยังไม่มีผู้ใช้แม้แต่คนเดียว** (หรือยังเชื่อมต่อฐานข้อมูลไม่ได้เลย)
 * ทุกเมท็อดที่เปลี่ยนแปลงระบบตรวจเงื่อนไขนี้ซ้ำก่อนทำงานเสมอ ไม่พึ่งการตรวจที่ route
 */
export class SetupService extends EventEmitter {
  /** @type {import('../core/Config.js').Config} */
  #config;
  /** @type {import('../core/Logger.js').Logger} */
  #logger;
  /** @type {EnvWriter} */
  #envWriter;
  /** @type {boolean} */
  #completed = false;

  /**
   * @param {import('../core/Config.js').Config} config ค่าตั้งค่าของระบบ
   * @param {import('../core/Logger.js').Logger} logger ตัวบันทึกเหตุการณ์
   */
  constructor(config, logger) {
    super();
    this.#config = config;
    this.#logger = logger;
    this.#envWriter = new EnvWriter(config.envPath);
  }

  /** @returns {boolean} ติดตั้งเสร็จแล้วในรอบการทำงานนี้หรือยัง */
  get isCompleted() { return this.#completed; }

  /**
   * ตัวเลือกฐานข้อมูลพร้อมข้อดีข้อเสีย — ใช้แสดงในหน้าเลือก
   * @returns {Array<object>}
   */
  get databaseOptions() { return DatabaseFactory.catalog(this.#config.root); }

  /**
   * ตรวจว่ายังต้องติดตั้งอยู่หรือไม่
   *
   * คืน `true` เมื่อ **ยังไม่มีผู้ใช้ในระบบ** ซึ่งครอบคลุมทั้งกรณีที่ยังไม่ได้ตั้งค่า
   * ฐานข้อมูล ยังไม่ได้สร้างตาราง และสร้างตารางแล้วแต่ยังไม่มีผู้ดูแล
   *
   * @returns {Promise<{required: boolean, reason: string, canConnect: boolean, hasSchema: boolean, hasUsers: boolean}>}
   */
  async status() {
    if (!this.#config.hasDatabaseConfig) {
      return {
        required: true,
        reason: 'ยังไม่ได้ตั้งค่าฐานข้อมูล',
        canConnect: false,
        hasSchema: false,
        hasUsers: false,
      };
    }

    let db = null;
    try {
      db = DatabaseFactory.build(this.#config.database);

      if (!await db.ping()) {
        return {
          required: true,
          reason: 'เชื่อมต่อฐานข้อมูลไม่ได้',
          canConnect: false,
          hasSchema: false,
          hasUsers: false,
        };
      }

      let hasUsers = false;
      let hasSchema = true;
      try {
        const row = await db.queryOne('SELECT COUNT(*) AS total FROM users');
        hasUsers = Number(row?.total ?? 0) > 0;
      } catch {
        hasSchema = false;
      }

      return {
        required: !hasUsers,
        reason: hasUsers
          ? 'ติดตั้งเรียบร้อยแล้ว'
          : (hasSchema ? 'ยังไม่มีผู้ดูแลในระบบ' : 'ยังไม่ได้สร้างตาราง'),
        canConnect: true,
        hasSchema,
        hasUsers,
      };
    } catch (error) {
      return {
        required: true,
        reason: `ตรวจสถานะไม่สำเร็จ: ${error.message}`,
        canConnect: false,
        hasSchema: false,
        hasUsers: false,
      };
    } finally {
      await db?.close();
    }
  }

  /**
   * โยนข้อผิดพลาดเมื่อระบบติดตั้งเสร็จแล้ว — เรียกก่อนทุกการกระทำที่เปลี่ยนแปลงระบบ
   * @returns {Promise<void>}
   * @throws {ForbiddenError} เมื่อระบบติดตั้งเสร็จแล้ว
   */
  async assertStillRequired() {
    const status = await this.status();
    if (!status.required) {
      throw new ForbiddenError(
        'ระบบติดตั้งเรียบร้อยแล้ว หน้าตั้งค่าถูกปิดเพื่อความปลอดภัย ' +
        'หากต้องการเปลี่ยนฐานข้อมูล กรุณาแก้ไฟล์ .env บนเซิร์ฟเวอร์โดยตรง',
      );
    }
  }

  /**
   * ทดสอบการเชื่อมต่อตามค่าที่ผู้ดูแลกรอก โดยยังไม่บันทึกอะไร
   * @param {object} input ค่าจากฟอร์ม
   * @returns {Promise<{ok: boolean, message: string}>}
   */
  async testConnection(input) {
    await this.assertStillRequired();
    try {
      return await DatabaseFactory.test(this.#normalizeDatabaseInput(input));
    } catch (error) {
      return { ok: false, message: error.message };
    }
  }

  /**
   * ติดตั้งระบบให้ครบในขั้นตอนเดียว
   *
   * ลำดับ: ทดสอบเชื่อมต่อ → เขียน `.env` → สร้างตาราง → ใส่ข้อมูลตั้งต้น → สร้างผู้ดูแล
   * ถ้าขั้นใดล้มเหลวจะหยุดทันทีและรายงานสาเหตุ
   *
   * @param {object} input ค่าจากฟอร์มทั้งหมด
   * @returns {Promise<{steps: Array<{label: string, ok: boolean, detail: string}>, username: string}>}
   * @throws {ValidationError} เมื่อข้อมูลไม่ถูกต้องหรือติดตั้งไม่สำเร็จ
   * @throws {ForbiddenError} เมื่อระบบติดตั้งเสร็จแล้ว
   */
  async install(input) {
    await this.assertStillRequired();

    const database = this.#normalizeDatabaseInput(input);
    const admin = this.#validateAdminInput(input);
    const steps = [];

    // ── 1. ทดสอบการเชื่อมต่อก่อนเขียนอะไรลงดิสก์ ──
    const probe = await DatabaseFactory.test(database);
    if (!probe.ok) {
      throw new ValidationError(`เชื่อมต่อฐานข้อมูลไม่สำเร็จ: ${probe.message}`);
    }
    steps.push({ label: 'ทดสอบการเชื่อมต่อฐานข้อมูล', ok: true, detail: probe.message });

    // ── 2. เขียน .env (สร้าง SESSION_SECRET ให้เมื่อยังไม่มี) ──
    const envUpdates = this.#buildEnvUpdates(database);
    this.#envWriter.write(envUpdates, { template: join(this.#config.root, '.env.example') });
    steps.push({
      label: 'บันทึกค่าตั้งค่าลงไฟล์ .env',
      ok: true,
      detail: `เขียน ${Object.keys(envUpdates).length} ค่า ที่ ${this.#envWriter.path}`,
    });

    // ── 3–5. สร้างตาราง ใส่ข้อมูลตั้งต้น และสร้างผู้ดูแล ──
    const db = DatabaseFactory.build(database);
    try {
      const runner = new MigrationRunner(
        db, join(this.#config.root, 'database/migrations'), () => {},
      );
      const { applied, skipped } = await runner.run();
      steps.push({
        label: 'สร้างตารางในฐานข้อมูล',
        ok: true,
        detail: applied.length
          ? `รัน migration ${applied.length} ไฟล์`
          : `สคีมาเป็นปัจจุบันอยู่แล้ว (ข้าม ${skipped} ไฟล์)`,
      });

      const seed = await new SeedRunner(db, () => {}).run();
      steps.push({
        label: 'ใส่ข้อมูลตั้งต้น',
        ok: true,
        detail: `สิทธิ์ ${seed.permissions.inserted + seed.permissions.updated} ข้อ · ` +
                `บทบาท ${seed.roles} ตัว`,
      });

      await this.#createFirstAdmin(db, admin);
      steps.push({
        label: 'สร้างผู้ดูแลสูงสุดคนแรก',
        ok: true,
        detail: `${admin.username} (${admin.email})`,
      });
    } finally {
      await db.close();
    }

    this.#completed = true;
    this.#logger.info('setup completed via web wizard', {
      driver: database.driver, username: admin.username,
    });

    // แจ้ง server.js ให้เริ่มระบบใหม่ด้วยค่าตั้งค่าที่เพิ่งบันทึก
    this.emit('completed', { driver: database.driver });

    return { steps, username: admin.username };
  }

  /**
   * สร้างผู้ดูแลสูงสุดคนแรก
   * @param {import('../core/Database.js').Database} db ตัวเชื่อมฐานข้อมูล
   * @param {{username: string, email: string, fullName: string, password: string}} admin ข้อมูลผู้ดูแล
   * @returns {Promise<number>} รหัสผู้ใช้ที่สร้าง
   * @throws {ValidationError} เมื่อมีผู้ใช้อยู่แล้วหรือไม่พบบทบาท
   */
  async #createFirstAdmin(db, admin) {
    const userRepository = new UserRepository(db);
    const roleRepository = new RoleRepository(db);

    // ตรวจซ้ำในระดับฐานข้อมูล — กันการยิงคำขอพร้อมกันสองครั้งสร้างผู้ดูแลสองคน
    if (await userRepository.count()) {
      throw new ForbiddenError('ระบบมีผู้ใช้อยู่แล้ว ไม่สามารถสร้างผู้ดูแลคนแรกซ้ำได้');
    }

    const role = await roleRepository.findByKey(Role.SUPER_ADMIN);
    if (!role) {
      throw new ValidationError('ไม่พบบทบาท SUPER_ADMIN — การใส่ข้อมูลตั้งต้นอาจไม่สมบูรณ์');
    }

    const hasher = new ScryptHasher();
    const user = new User({
      username: admin.username,
      email: admin.email,
      passwordHash: await hasher.hash(admin.password),
      hashAlgo: hasher.algorithm,
      fullName: admin.fullName,
      status: 'ACTIVE',
      isSuperAdmin: true,
      mustChangePassword: false,
    });
    user.validate();

    return userRepository.createWithAccess(user, [role.id], []);
  }

  /**
   * ตรวจและทำความสะอาดค่าฐานข้อมูลจากฟอร์ม
   * @param {object} input ค่าจากฟอร์ม
   * @returns {object} ค่าตั้งค่าที่พร้อมส่งให้ `DatabaseFactory`
   * @throws {ValidationError} เมื่อข้อมูลไม่ถูกต้อง
   */
  #normalizeDatabaseInput(input) {
    const driver = String(input?.driver ?? '').toLowerCase();
    if (!DatabaseFactory.drivers.includes(driver)) {
      throw new ValidationError(
        `กรุณาเลือกชนิดฐานข้อมูล (${DatabaseFactory.drivers.join(' หรือ ')})`,
      );
    }

    if (driver === 'sqlite') {
      const clean = new Validator(input)
        .string('file', { max: 500, label: 'พาธไฟล์ฐานข้อมูล' })
        .validate();
      const file = clean.file || './storage/waterlevel.db';

      // กันการเขียนไฟล์นอกโฟลเดอร์โปรเจกต์โดยไม่ตั้งใจ
      if (file.includes('..')) {
        throw new ValidationError('พาธไฟล์ฐานข้อมูลต้องไม่มี ".."');
      }
      return { driver, file: join(this.#config.root, file) };
    }

    const clean = new Validator(input)
      .required('host', 'โฮสต์')
      .string('host', { max: 255, label: 'โฮสต์' })
      .integer('port', { min: 1, max: 65535, label: 'พอร์ต' })
      .required('user', 'ชื่อผู้ใช้ฐานข้อมูล')
      .string('user', { max: 100, label: 'ชื่อผู้ใช้ฐานข้อมูล' })
      .required('database', 'ชื่อฐานข้อมูล')
      .string('database', { max: 100, label: 'ชื่อฐานข้อมูล' })
      .validate();

    return {
      driver,
      host: clean.host,
      port: clean.port ?? 3306,
      user: clean.user,
      password: String(input.password ?? ''),
      database: clean.database,
      connectionLimit: 10,
    };
  }

  /**
   * ตรวจและทำความสะอาดข้อมูลผู้ดูแลจากฟอร์ม
   * @param {object} input ค่าจากฟอร์ม
   * @returns {{username: string, email: string, fullName: string, password: string}}
   * @throws {ValidationError} เมื่อข้อมูลไม่ถูกต้อง
   */
  #validateAdminInput(input) {
    const clean = new Validator(input)
      .required('adminUsername', 'ชื่อผู้ใช้ผู้ดูแล')
      .string('adminUsername', { min: 3, max: 100, label: 'ชื่อผู้ใช้ผู้ดูแล' })
      .required('adminEmail', 'อีเมลผู้ดูแล')
      .email('adminEmail', 'อีเมลผู้ดูแล')
      .required('adminFullName', 'ชื่อ-นามสกุลผู้ดูแล')
      .string('adminFullName', { max: 200, label: 'ชื่อ-นามสกุลผู้ดูแล' })
      .required('adminPassword', 'รหัสผ่านผู้ดูแล')
      .validate();

    if (input.adminPassword !== input.adminPasswordConfirm) {
      throw new ValidationError('รหัสผ่านและการยืนยันไม่ตรงกัน');
    }

    return {
      username: clean.adminUsername,
      email: clean.adminEmail,
      fullName: clean.adminFullName,
      password: String(input.adminPassword),
    };
  }

  /**
   * ประกอบค่าที่ต้องเขียนลง `.env`
   *
   * สร้าง `SESSION_SECRET` ใหม่ให้อัตโนมัติเมื่อยังไม่มี — ผู้ดูแลไม่ต้องรู้จักคำสั่งสุ่มเอง
   *
   * @param {object} database ค่าตั้งค่าฐานข้อมูล
   * @returns {Record<string, string>}
   */
  #buildEnvUpdates(database) {
    const existing = this.#envWriter.read();
    const updates = { DB_DRIVER: database.driver };

    if (database.driver === 'sqlite') {
      // เก็บเป็นพาธสัมพัทธ์เพื่อให้ย้ายโฟลเดอร์โปรเจกต์ได้โดยไม่ต้องแก้ .env
      updates.DB_FILE = `./${database.file.slice(this.#config.root.length + 1)}`;
    } else {
      updates.DB_HOST = database.host;
      updates.DB_PORT = String(database.port);
      updates.DB_USER = database.user;
      updates.DB_PASSWORD = database.password;
      updates.DB_NAME = database.database;
      updates.DB_CONNECTION_LIMIT = '10';
    }

    const secret = existing.get('SESSION_SECRET');
    if (!secret || secret.replace(/^["']|["']$/g, '').length < 32) {
      updates.SESSION_SECRET = randomBytes(48).toString('hex');
    }

    return updates;
  }
}
