import { BaseJob } from '../core/BaseJob.js';

/**
 * งานซิงก์ใบอนุญาตกับทะเบียนคีย์ของผู้ให้บริการ
 *
 * ถาม `GET {WATER_API_URL}/key-info` เป็นรอบ แล้วเขียนวันหมดอายุที่ได้ลงตาราง
 * `licenses` เพื่อให้ `LicenseMiddleware` ซึ่งอ่านจากฐานข้อมูลในเครื่อง
 * ทำงานเร็วและไม่พึ่งเครือข่ายในเส้นทางของทุกคำขอ
 *
 * ตั้งเป็นทุก 6 ชั่วโมงโดยค่าเริ่มต้น — ถี่พอที่จะรับรู้การต่ออายุหรือการยกเลิกคีย์
 * ภายในวันเดียวกัน แต่ไม่ถี่จนกลายเป็นภาระของบริการปลายทาง
 *
 * **ไม่ทำให้งานล้มเหลวเมื่อติดต่อไม่ได้** — `LicenseService.syncFromRegistry()`
 * จัดการเก็บเหตุผลไว้ให้แล้ว การโยนข้อผิดพลาดออกมาจะทำให้หน้าสถานะงาน
 * ขึ้นสีแดงทุกครั้งที่เน็ตสะดุด ทั้งที่ระบบยังทำงานได้ตามปกติ
 */
export class LicenseSyncJob extends BaseJob {
  /** @type {import('../services/LicenseService.js').LicenseService} */
  #licenseService;
  /** @type {import('../core/Logger.js').Logger} */
  #logger;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../services/LicenseService.js').LicenseService} deps.licenseService บริการใบอนุญาต
   * @param {string} [deps.schedule='7 *\/6 * * *'] นิพจน์ cron
   * @param {import('../core/Logger.js').Logger} deps.logger ตัวบันทึกเหตุการณ์
   */
  constructor({ licenseService, schedule = '7 */6 * * *', logger }) {
    super('ซิงก์ใบอนุญาตกับทะเบียนคีย์', schedule);
    this.#licenseService = licenseService;
    this.#logger = logger;
  }

  /**
   * ดึงสถานะคีย์ล่าสุดมาอัปเดตใบอนุญาต
   * @returns {Promise<{driver: string, synced: boolean, status?: string, daysRemaining?: number|null, reason?: string}>}
   */
  async execute() {
    const registry = this.#licenseService.keyRegistry;
    if (!registry.isConfigured) {
      return { driver: registry.driver, synced: false, reason: 'ไม่ได้ตั้งค่าทะเบียนคีย์' };
    }

    const { synced, reason, keyInfo } = await this.#licenseService.syncFromRegistry();
    if (!synced) {
      return { driver: registry.driver, synced: false, reason };
    }

    if (!keyInfo.isUsable) {
      this.#logger.error('service key is no longer usable', {
        owner: keyInfo.ownerName, status: keyInfo.status,
      });
    }

    return {
      driver: registry.driver,
      synced: true,
      status: keyInfo.status,
      daysRemaining: keyInfo.daysRemaining,
    };
  }
}
