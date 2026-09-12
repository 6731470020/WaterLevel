import { BaseController } from '../core/BaseController.js';

/**
 * ควบคุมหน้าใบอนุญาตและหน้าแจ้งเตือนเมื่อหมดอายุ
 *
 * `showExpired()` พอร์ตมาจาก `data/license_expired.php` และต้องเข้าถึงได้เสมอ
 * แม้ใบอนุญาตจะหมดอายุแล้ว (`LicenseMiddleware` ยกเว้นพาธนี้ไว้)
 *
 * **ไม่มีหน้าจัดการใบอนุญาตแยกอีกแล้ว** — คีย์บริการตรวจจับคือใบอนุญาตในตัวมันเอง
 * ใบอนุญาตจึงไม่ใช่สิ่งที่ผู้ดูแลกรอกเอง แต่เป็นสิ่งที่ระบบไปถามมาจากผู้ให้บริการ
 * สถานะไปแสดงในแท็บ "สถานะระบบ" ของหน้าตั้งค่า เหลือที่นี่แค่ปุ่มสั่งตรวจเดี๋ยวนี้
 */
export class LicenseController extends BaseController {
  /** @type {import('../services/LicenseService.js').LicenseService} */
  #licenseService;
  /** @type {import('../services/AuditService.js').AuditService} */
  #auditService;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../services/LicenseService.js').LicenseService} deps.licenseService บริการใบอนุญาต
   * @param {import('../services/AuditService.js').AuditService} deps.auditService บริการบันทึกการใช้งาน
   * @param {import('../core/Logger.js').Logger} [deps.logger] ตัวบันทึกเหตุการณ์
   */
  constructor({ licenseService, auditService, logger }) {
    super(licenseService, logger);
    this.#licenseService = licenseService;
    this.#auditService = auditService;
  }

  /**
   * หน้าแจ้งใบอนุญาตหมดอายุ (สาธารณะ)
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async showExpired(req, res) {
    const [{ valid }, contact] = await Promise.all([
      this.#licenseService.check(),
      this.#licenseService.contactInfo(),
    ]);

    if (valid) {
      res.redirect('/');
      return;
    }

    res.status(402).render('public/licenseExpired', {
      title: 'ใบอนุญาตหมดอายุ',
      contact,
    });
  }

  /**
   * ตรวจสถานะคีย์กับผู้ให้บริการเดี๋ยวนี้ (สิทธิ์ `license.manage`)
   *
   * ปุ่มนี้มีไว้ให้ผู้ดูแล **ยืนยันผลทันทีหลังต่ออายุ** โดยไม่ต้องรอรอบของ
   * `LicenseSyncJob` ซึ่งอาจอีกหลายชั่วโมง
   *
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async sync(req, res) {
    const { synced, reason, keyInfo } = await this.#licenseService.syncFromRegistry();

    await this.#auditService.recordFromRequest(req, {
      action: 'license.manage',
      resourceType: 'license',
      resourceId: null,
      afterData: {
        source: 'key-registry',
        synced,
        status: keyInfo?.status ?? null,
        daysRemaining: keyInfo?.daysRemaining ?? null,
        reason: reason ?? null,
      },
    });

    res.redirect(`/admin/settings?tab=status&synced=${synced ? '1' : '0'}`);
  }

}
