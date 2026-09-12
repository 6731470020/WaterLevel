import { BaseJob } from '../core/BaseJob.js';

/**
 * งานลบข้อมูลเก่าตามนโยบายเก็บรักษา เวลา 03:00 น.
 *
 * ลบไฟล์ภาพที่เกินอายุตามนโยบาย PDPA (ค่าเริ่มต้น 90 วัน) และล้าง session
 * กับ token ที่หมดอายุ ทำเป็นชุดละ 500 รายการเพื่อไม่ให้ล็อกตารางนาน
 *
 * **ลบเฉพาะไฟล์ภาพ ไม่ลบแถวค่าวัด** — ข้อมูลตัวเลขยังมีประโยชน์สำหรับสถิติ
 * ระยะยาว ส่วนภาพเป็นข้อมูลส่วนบุคคลที่ต้องลบตามกำหนด
 */
export class RetentionJob extends BaseJob {
  /** @type {import('../repositories/MeasurementRepository.js').MeasurementRepository} */
  #measurementRepository;
  /** @type {import('../repositories/CaptureRepository.js').CaptureRepository} */
  #captureRepository;
  /** @type {import('../repositories/SessionRepository.js').SessionRepository} */
  #sessionRepository;
  /** @type {import('../repositories/PasswordResetRepository.js').PasswordResetRepository} */
  #resetRepository;
  /** @type {import('../services/storage/StorageService.js').StorageService} */
  #storageService;
  /** @type {number} */
  #retentionDays;
  /** @type {import('../core/Logger.js').Logger} */
  #logger;

  /** จำนวนรายการต่อชุด */
  static BATCH_SIZE = 500;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../repositories/MeasurementRepository.js').MeasurementRepository} deps.measurementRepository ที่เก็บค่าวัด
   * @param {import('../repositories/CaptureRepository.js').CaptureRepository} deps.captureRepository ที่เก็บภาพจับเฟรม
   * @param {import('../repositories/SessionRepository.js').SessionRepository} deps.sessionRepository ที่เก็บ session
   * @param {import('../repositories/PasswordResetRepository.js').PasswordResetRepository} deps.resetRepository ที่เก็บ token รีเซ็ตรหัสผ่าน
   * @param {import('../services/storage/StorageService.js').StorageService} deps.storageService ที่เก็บไฟล์ภาพ
   * @param {number} [deps.retentionDays=90] จำนวนวันที่เก็บภาพ
   * @param {import('../core/Logger.js').Logger} deps.logger ตัวบันทึกเหตุการณ์
   * @param {string} [deps.schedule='0 3 * * *'] นิพจน์ cron
   */
  constructor({
    measurementRepository, captureRepository, sessionRepository, resetRepository,
    storageService, retentionDays = 90, logger, schedule = '0 3 * * *',
  }) {
    super('ลบข้อมูลเก่าตามนโยบาย', schedule);
    this.#measurementRepository = measurementRepository;
    this.#captureRepository = captureRepository;
    this.#sessionRepository = sessionRepository;
    this.#resetRepository = resetRepository;
    this.#storageService = storageService;
    this.#retentionDays = Number(retentionDays);
    this.#logger = logger;
  }

  /**
   * ลบภาพเก่าและข้อมูลชั่วคราวที่หมดอายุ
   * @returns {Promise<{measurementImages: number, captureImages: number, sessions: number, tokens: number}>}
   */
  async execute() {
    const measurementImages = await this.#purgeMeasurementImages();
    const captureImages = await this.#purgeCaptureImages();
    const sessions = await this.#sessionRepository.purgeExpired();
    const tokens = await this.#resetRepository.purgeExpired();

    const result = { measurementImages, captureImages, sessions, tokens };
    this.#logger.info('retention job completed', result);
    return result;
  }

  /**
   * ลบไฟล์ภาพของค่าวัดที่เกินอายุ
   * @returns {Promise<number>} จำนวนรายการที่ล้าง
   */
  async #purgeMeasurementImages() {
    let total = 0;
    for (;;) {
      const expired = await this.#measurementRepository.findExpiredImages(
        this.#retentionDays, RetentionJob.BATCH_SIZE,
      );
      if (!expired.length) break;

      for (const item of expired) {
        await this.#storageService.delete(item.imagePath);
        if (item.thumbnailPath) await this.#storageService.delete(item.thumbnailPath);
      }
      await this.#measurementRepository.clearImagePaths(expired.map((item) => item.id));
      total += expired.length;

      if (expired.length < RetentionJob.BATCH_SIZE) break;
    }
    return total;
  }

  /**
   * ลบไฟล์ภาพจับเฟรมที่เกินอายุ
   * @returns {Promise<number>} จำนวนรายการที่ล้าง
   */
  async #purgeCaptureImages() {
    let total = 0;
    for (;;) {
      const expired = await this.#captureRepository.findExpired(
        this.#retentionDays, RetentionJob.BATCH_SIZE,
      );
      if (!expired.length) break;

      for (const item of expired) {
        await this.#storageService.delete(item.imagePath);
        if (item.thumbnailPath) await this.#storageService.delete(item.thumbnailPath);
      }
      await this.#captureRepository.clearImagePaths(expired.map((item) => item.id));
      total += expired.length;

      if (expired.length < RetentionJob.BATCH_SIZE) break;
    }
    return total;
  }
}
