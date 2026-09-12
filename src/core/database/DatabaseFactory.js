import { resolve } from 'node:path';
import { Database } from './Database.js';
import { MySqlDatabase } from './MySqlDatabase.js';
import { SqliteDatabase } from './SqliteDatabase.js';
import { ValidationError } from '../errors/index.js';

/** ไดรเวอร์ฐานข้อมูลที่ระบบรองรับ */
const DRIVERS = ['mysql', 'sqlite'];

/**
 * ตัวสร้างตัวเชื่อมฐานข้อมูลตามไดรเวอร์ที่เลือก (Factory Pattern)
 *
 * เป็นที่เดียวที่รู้ว่า `DB_DRIVER` ค่าใดตรงกับคลาสใด — ส่วนอื่นของระบบเห็นเพียง
 * คลาสนามธรรม `Database` จึงสลับฐานข้อมูลได้โดยไม่แก้โค้ดที่เรียกใช้
 */
export class DatabaseFactory {
  /** @returns {Array<string>} ไดรเวอร์ที่รองรับ */
  static get drivers() { return [...DRIVERS]; }

  /**
   * สร้างตัวเชื่อมและลงทะเบียนเป็น Singleton
   * @param {object} options ค่าตั้งค่าฐานข้อมูล
   * @param {string} options.driver ไดรเวอร์ (`mysql` | `sqlite`)
   * @returns {Database}
   * @throws {ValidationError} เมื่อไดรเวอร์ไม่ถูกต้อง
   */
  static create(options) {
    const instance = DatabaseFactory.build(options);
    return Database.use(instance);
  }

  /**
   * สร้างตัวเชื่อมโดยไม่ลงทะเบียนเป็น Singleton (ใช้ในชุดทดสอบและหน้าตั้งค่า)
   * @param {object} options ค่าตั้งค่าฐานข้อมูล
   * @returns {Database}
   * @throws {ValidationError} เมื่อไดรเวอร์ไม่ถูกต้อง
   */
  static build(options) {
    const driver = String(options?.driver ?? 'mysql').toLowerCase();

    switch (driver) {
      case 'mysql':
        return new MySqlDatabase(options);
      case 'sqlite':
        return new SqliteDatabase({ file: options.file });
      default:
        throw new ValidationError(
          `DB_DRIVER ต้องเป็นหนึ่งใน: ${DRIVERS.join(', ')} (ได้รับ "${driver}")`,
        );
    }
  }

  /**
   * ทดสอบการเชื่อมต่อโดยไม่เปิดค้างไว้ — ใช้ในหน้าตั้งค่าครั้งแรก
   * @param {object} options ค่าตั้งค่าที่ต้องการทดสอบ
   * @returns {Promise<{ok: boolean, message: string}>}
   */
  static async test(options) {
    const driver = String(options?.driver ?? 'mysql').toLowerCase();

    switch (driver) {
      case 'mysql':
        return MySqlDatabase.testConnection(options);
      case 'sqlite':
        return SqliteDatabase.testConnection({ file: options.file });
      default:
        return { ok: false, message: `ไม่รู้จักไดรเวอร์ "${driver}"` };
    }
  }

  /**
   * คำอธิบายไดรเวอร์แต่ละตัวสำหรับแสดงในหน้าตั้งค่า
   * @param {string} root พาธรากโปรเจกต์ (ใช้แสดงพาธไฟล์ตัวอย่าง)
   * @returns {Array<{key: string, name: string, summary: string, pros: Array<string>, cons: Array<string>}>}
   */
  static catalog(root) {
    return [
      {
        key: 'sqlite',
        name: 'SQLite (ไฟล์เดียว)',
        summary: 'ไม่ต้องติดตั้งเซิร์ฟเวอร์ฐานข้อมูล เก็บทุกอย่างไว้ในไฟล์เดียว',
        example: resolve(root, 'storage/waterlevel.db'),
        pros: [
          'ติดตั้งง่ายที่สุด — พร้อมใช้งานทันที',
          'สำรองข้อมูลด้วยการคัดลอกไฟล์เดียว',
          'เหมาะกับหน่วยงานที่มีจุดวัดไม่กี่แห่ง',
        ],
        cons: [
          'เขียนข้อมูลพร้อมกันได้ทีละคำสั่ง',
          'ไม่เหมาะเมื่อมีผู้ใช้พร้อมกันจำนวนมาก',
        ],
      },
      {
        key: 'mysql',
        name: 'MySQL 8 / MariaDB',
        summary: 'เซิร์ฟเวอร์ฐานข้อมูลแยก รองรับผู้ใช้พร้อมกันจำนวนมาก',
        example: 'localhost:3306',
        pros: [
          'รองรับผู้ใช้และการเขียนพร้อมกันได้ดี',
          'เครื่องมือสำรองข้อมูลและตรวจสอบครบ',
          'เหมาะกับการใช้งานจริงระยะยาว',
        ],
        cons: [
          'ต้องติดตั้งและดูแลเซิร์ฟเวอร์แยก',
          'ต้องสร้างฐานข้อมูลและผู้ใช้ก่อนใช้งาน',
        ],
      },
    ];
  }
}
