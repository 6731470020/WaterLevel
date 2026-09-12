import { BaseJob } from '../core/BaseJob.js';

/**
 * งานสร้างและส่งรายงานประจำวัน เวลา 18:00 น. (พอร์ตจาก `report_group.php`)
 *
 * สร้างรายงานของ**วันปัจจุบัน** ครอบคลุมช่วง 00:00–23:59 ตามเวลาไทย
 * จุดวัดที่ไม่มีค่าวัดเลยทั้งวันจะข้ามไป ไม่ส่งรายงานเปล่าเข้ากลุ่ม
 */
export class DailyReportJob extends BaseJob {
  /** @type {import('../services/ReportService.js').ReportService} */
  #reportService;
  /** @type {import('../core/Logger.js').Logger} */
  #logger;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../services/ReportService.js').ReportService} deps.reportService บริการรายงาน
   * @param {import('../core/Logger.js').Logger} deps.logger ตัวบันทึกเหตุการณ์
   * @param {string} [deps.schedule='0 18 * * *'] นิพจน์ cron
   */
  constructor({ reportService, logger, schedule = '0 18 * * *' }) {
    super('รายงานประจำวัน', schedule);
    this.#reportService = reportService;
    this.#logger = logger;
  }

  /**
   * สร้างและส่งรายงานของทุกจุดวัด
   * @returns {Promise<{generated: number, sent: number, failed: number}>}
   */
  async execute() {
    const result = await this.#reportService.generateAndSendAll(new Date());
    this.#logger.info('daily reports processed', result);
    return result;
  }
}
