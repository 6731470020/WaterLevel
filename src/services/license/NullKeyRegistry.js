import { KeyRegistry } from './KeyRegistry.js';

/**
 * ทะเบียนคีย์แบบ "ยังไม่ได้ตั้งค่า" — ใช้เมื่อยังไม่ได้กรอก `WATER_API_URL`
 * หรือ `WATER_API_KEY`
 *
 * เป็น **Null Object** ที่ทำให้ `LicenseService` ไม่ต้องมี `if (registry)` กระจาย
 * อยู่ทั่วคลาส — เรียกได้เหมือนกันทุกกรณี เพียงแต่ได้ `null` กลับมาแล้วระบบ
 * จะใช้ใบอนุญาตที่ผู้ดูแลกรอกเองในตาราง `licenses` ต่อไปตามปกติ
 */
export class NullKeyRegistry extends KeyRegistry {
  /** @returns {string} ชื่อไดรเวอร์ */
  get driver() { return 'not-configured'; }

  /** @returns {boolean} ทะเบียนนี้ไม่มีปลายทางให้ถาม */
  get isConfigured() { return false; }

  /**
   * ไม่ถามใคร — คืน `null` เสมอ
   * @returns {Promise<null>}
   */
  async fetchKeyInfo() { return null; }
}
