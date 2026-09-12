import { PermissionRepository } from '../src/repositories/PermissionRepository.js';
import { RoleRepository } from '../src/repositories/RoleRepository.js';
import { LicenseRepository } from '../src/repositories/LicenseRepository.js';
import { Role } from '../src/models/Role.js';
import { License } from '../src/models/License.js';

/**
 * ตัวใส่ข้อมูลตั้งต้นของระบบ
 *
 * เขียนเป็น JavaScript แทนไฟล์ `.sql` โดยเจตนา เพราะข้อมูลตั้งต้นต้อง**ตรงกับ
 * `Permission.catalog()` และ `Role.defaultPermissionMatrix()` เสมอ** การเก็บไว้
 * เป็น SQL แยกจะทำให้ทั้งสองที่เบี่ยงเบนจากกันเมื่อมีการเพิ่มสิทธิ์ใหม่
 *
 * ผลพลอยได้: ใช้ได้ทั้ง MySQL และ SQLite โดยไม่ต้องเขียน SQL สองชุด
 *
 * รันซ้ำได้เสมอโดยไม่ทำข้อมูลซ้ำหรือทับของเดิมที่ผู้ดูแลแก้ไว้
 */
export class SeedRunner {
  /** @type {import('../src/core/Database.js').Database} */
  #db;
  /** @type {(message: string) => void} */
  #report;

  /**
   * @param {import('../src/core/Database.js').Database} db ตัวเชื่อมฐานข้อมูล
   * @param {(message: string) => void} [report] ฟังก์ชันรายงานความคืบหน้า
   */
  constructor(db, report = (message) => process.stdout.write(`${message}\n`)) {
    this.#db = db;
    this.#report = report;
  }

  /**
   * ใส่ข้อมูลตั้งต้นทั้งหมด
   * @returns {Promise<{permissions: {inserted: number, updated: number}, roles: number, license: boolean}>}
   */
  async run() {
    const permissions = await this.#seedPermissions();
    const roles = await this.#seedRoles();
    const license = await this.#seedLicense();
    return { permissions, roles, license };
  }

  /**
   * ซิงก์รายการสิทธิ์ให้ตรงกับ `Permission.catalog()`
   * @returns {Promise<{inserted: number, updated: number}>}
   */
  async #seedPermissions() {
    const repository = new PermissionRepository(this.#db);
    const result = await repository.syncCatalog();
    this.#report(`  ✓ ซิงก์สิทธิ์: เพิ่มใหม่ ${result.inserted} · ปรับปรุง ${result.updated}`);
    return result;
  }

  /**
   * สร้างบทบาทระบบทั้ง 4 ตัวและผูกสิทธิ์ตามตารางใน CLAUDE.md ข้อ 8.3
   * @returns {Promise<number>} จำนวนบทบาทที่จัดการ
   */
  async #seedRoles() {
    const repository = new RoleRepository(this.#db);
    const matrix = Role.defaultPermissionMatrix();

    const definitions = [
      [Role.SUPER_ADMIN, 'ผู้ดูแลสูงสุด',
        'เข้าถึงได้ทุกส่วนของระบบ รวมถึงการจัดการบทบาทและใบอนุญาต'],
      [Role.ADMIN, 'ผู้ดูแลระบบ',
        'จัดการจุดวัด ผู้ใช้ การแจ้งเตือน และดูบันทึกการใช้งาน'],
      [Role.OPERATOR, 'เจ้าหน้าที่',
        'ตั้งค่า ROI จุดเทียบค่า สั่งจับภาพ และส่งการแจ้งเตือน'],
      [Role.VIEWER, 'ผู้ดูข้อมูล',
        'ดูข้อมูลระดับน้ำ กราฟ และรายงานได้อย่างเดียว'],
    ];

    for (const [roleKey, name, description] of definitions) {
      let role = await repository.findByKey(roleKey);

      if (!role) {
        const created = new Role({ roleKey, name, description, isSystem: true });
        created.validate();
        role = await repository.create(created);
        this.#report(`  ✓ สร้างบทบาท ${roleKey}`);
      }

      // ผูกสิทธิ์ใหม่ทุกครั้ง เพื่อให้บทบาทระบบตามทันสิทธิ์ที่เพิ่มในรุ่นใหม่
      const permissionKeys = matrix[roleKey] ?? [];
      await repository.replacePermissions(role.id, permissionKeys);
      this.#report(`  ✓ ผูกสิทธิ์ ${permissionKeys.length} ข้อเข้าบทบาท ${roleKey}`);
    }

    return definitions.length;
  }

  /**
   * สร้างใบอนุญาตทดลองใช้ 1 ปี เฉพาะเมื่อยังไม่มีใบอนุญาตใดในระบบ
   * @returns {Promise<boolean>} true เมื่อสร้างใหม่
   */
  async #seedLicense() {
    const repository = new LicenseRepository(this.#db);
    if (await repository.count()) {
      this.#report('  ✓ มีใบอนุญาตอยู่แล้ว — ข้ามการสร้าง');
      return false;
    }

    const license = new License({
      licenseKey: 'TRIAL-LICENSE-CHANGE-ME',
      expiredAt: new Date(Date.now() + 365 * 86400000),
      isActive: true,
      contactEmail: 'admin@example.go.th',
      contactPhone: '-',
      contactLine: '-',
    });
    license.validate();
    await repository.create(license);

    this.#report('  ✓ สร้างใบอนุญาตทดลองใช้ 1 ปี — กรอกคีย์บริการตรวจจับที่ /admin/settings เพื่อใช้วันหมดอายุจริง');
    return true;
  }
}
