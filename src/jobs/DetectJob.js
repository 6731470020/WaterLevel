import { BaseJob } from '../core/BaseJob.js';
import { PixelLevel } from '../models/values/PixelLevel.js';

/**
 * งานตรวจวัดระดับน้ำทุก 5 นาที — งานหลักของทั้งระบบ
 *
 * ลำดับการทำงานต่อจุดวัดหนึ่งแห่ง (CLAUDE.md ข้อ 6.4):
 * 1. เรียกบริการตรวจจับ → ได้ตำแหน่งผิวน้ำเป็นพิกเซล
 * 2. เทียบกับค่าเฉลี่ย 3 ค่าล่าสุด
 * 3. ต่างไม่เกิน 50 px → บันทึกทันที
 * 4. ต่างเกิน → เข้าโหมดยืนยัน วัดซ้ำสูงสุด 3 ครั้ง เว้น 10 วินาที
 * 5. `max − min ≤ 25 px` → ใช้ค่าเฉลี่ยแล้วบันทึก
 * 6. ไม่ผ่าน → **ไม่บันทึกค่าวัด** แต่บันทึก `validation_log` ด้วย `success = 0` เสมอ
 *
 * ⚠️ **ต่างจากระบบเดิมสองจุดสำคัญ:**
 * - ใช้ `await this.delay()` ที่ไม่บล็อก event loop แทน `sleep()` ของ PHP
 *   ที่หยุดทั้งโปรเซส 30 วินาที (ข้อบกพร่องที่ 6)
 * - เมื่อยืนยันสำเร็จจะ**บันทึกค่าจริง** ต่างจากระบบเดิมที่คำนวณค่าเฉลี่ยแล้ว
 *   `return false` ทำให้ค่าถูกทิ้ง (ข้อบกพร่องที่ 9)
 */
export class DetectJob extends BaseJob {
  /** @type {import('../services/StationService.js').StationService} */
  #stationService;
  /** @type {import('../services/MeasurementService.js').MeasurementService} */
  #measurementService;
  /** @type {import('../services/RoiService.js').RoiService} */
  #roiService;
  /** @type {import('../services/detection/DetectionService.js').DetectionService} */
  #detectionService;
  /** @type {import('../services/VariationValidator.js').VariationValidator} */
  #variationValidator;
  /** @type {import('../services/storage/StorageService.js').StorageService} */
  #storageService;
  /** @type {import('../core/Logger.js').Logger} */
  #logger;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../services/StationService.js').StationService} deps.stationService บริการจุดวัด
   * @param {import('../services/MeasurementService.js').MeasurementService} deps.measurementService บริการค่าวัด
   * @param {import('../services/RoiService.js').RoiService} deps.roiService บริการ ROI
   * @param {import('../services/detection/DetectionService.js').DetectionService} deps.detectionService บริการตรวจจับ
   * @param {import('../services/VariationValidator.js').VariationValidator} deps.variationValidator ตัวตรวจความผันผวน
   * @param {import('../services/storage/StorageService.js').StorageService} deps.storageService ที่เก็บไฟล์ภาพ
   * @param {import('../core/Logger.js').Logger} deps.logger ตัวบันทึกเหตุการณ์
   * @param {string} [deps.schedule='*\/5 * * * *'] นิพจน์ cron
   */
  constructor({
    stationService, measurementService, roiService, detectionService,
    variationValidator, storageService, logger, schedule = '*/5 * * * *',
  }) {
    super('ตรวจวัดระดับน้ำ', schedule);
    this.#stationService = stationService;
    this.#measurementService = measurementService;
    this.#roiService = roiService;
    this.#detectionService = detectionService;
    this.#variationValidator = variationValidator;
    this.#storageService = storageService;
    this.#logger = logger;
  }

  /**
   * ตรวจวัดทุกจุดวัดที่เปิดใช้งาน
   *
   * จุดวัดแต่ละแห่งถูกดักข้อผิดพลาดแยกกัน เพื่อไม่ให้จุดวัดเดียวที่กล้องล่ม
   * ทำให้จุดวัดอื่นไม่ได้ถูกวัดไปด้วย
   *
   * @returns {Promise<{stations: number, recorded: number, rejected: number, failed: number}>}
   */
  async execute() {
    const stations = await this.#stationService.activeStations();
    const totals = { stations: stations.length, recorded: 0, rejected: 0, failed: 0 };

    for (const station of stations) {
      try {
        const result = await this.runForStation(station, { source: 'CRON' });
        if (result.recorded) totals.recorded += 1;
        else totals.rejected += 1;
      } catch (error) {
        totals.failed += 1;
        this.#logger.error('detection failed for station', {
          stationId: station.id, slug: station.slug, message: error.message,
        });
      }
    }
    return totals;
  }

  /**
   * ตรวจวัดจุดวัดเดียว — ใช้ทั้งจากงานตามเวลาและจากปุ่ม "จับภาพทันที"
   *
   * เป็นเมท็อดสาธารณะเพราะ `MeasurementController` เรียกใช้ตรง ๆ เพื่อให้
   * การวัดด้วยตนเองใช้ตรรกะเดียวกันกับงานอัตโนมัติทุกประการ
   *
   * @param {import('../models/Station.js').Station} station จุดวัด
   * @param {{source?: string, triggeredBy?: number|null}} [options={}] ตัวเลือก
   * @returns {Promise<{recorded: boolean, waterLine: number|null, reason: string, measurement: object|null}>}
   */
  async runForStation(station, { source = 'CRON', triggeredBy = null } = {}) {
    const rois = await this.#roiService.listForStation(station.id);

    // ── ขั้นที่ 1: วัดค่าครั้งแรก ──
    const initial = await this.#detectionService.detect(station, rois);
    const candidate = initial.waterLinePx;

    // ── ขั้นที่ 2–3: เทียบกับค่าเฉลี่ยล่าสุด ──
    const recentLevels = await this.#measurementService.recentLevels(station.id, 3);
    const evaluation = this.#variationValidator.evaluate(candidate, recentLevels);

    if (evaluation.accepted) {
      const measurement = await this.#save(station, candidate, initial, source);
      return {
        recorded: true,
        waterLine: candidate.value,
        reason: evaluation.reason,
        measurement: measurement.toJSON(),
      };
    }

    // ── ขั้นที่ 4: โหมดยืนยัน ──
    this.#logger.warn('entering confirmation mode', {
      stationId: station.id,
      candidate: candidate.value,
      baseline: evaluation.baseline,
      variation: evaluation.variation,
    });

    const attempts = [];
    let lastResult = initial;

    for (let i = 0; i < this.#variationValidator.confirmationAttempts; i += 1) {
      // หน่วงแบบไม่บล็อก event loop — คำขอเว็บอื่นยังทำงานได้ตามปกติ
      await this.delay(this.#variationValidator.confirmationDelayMs);
      try {
        const retry = await this.#detectionService.detect(station, rois);
        attempts.push(retry.waterLinePx);
        lastResult = retry;
        this.#logger.info('confirmation reading', {
          stationId: station.id, attempt: i + 1, waterLine: retry.waterLinePx.value,
        });
      } catch (error) {
        this.#logger.warn('confirmation reading failed', {
          stationId: station.id, attempt: i + 1, message: error.message,
        });
      }
    }

    // ── ขั้นที่ 5–6: ตัดสินผล ──
    const confirmation = this.#variationValidator.confirm(attempts);

    // บันทึก validation_log **ทุกกรณี** ไม่ว่าผลจะเป็นอย่างไร
    await this.#measurementService.recordValidation({
      stationId: station.id,
      suspectedLevel: candidate.value,
      confirmedLevel: confirmation.level?.value ?? null,
      variation: evaluation.variation,
      attempts: confirmation.attempts,
      spread: confirmation.spread,
      success: confirmation.confirmed,
      note: confirmation.reason.slice(0, 255),
    });

    if (!confirmation.confirmed) {
      this.#logger.warn('measurement rejected after confirmation', {
        stationId: station.id, reason: confirmation.reason,
      });
      return {
        recorded: false,
        waterLine: null,
        reason: confirmation.reason,
        measurement: null,
      };
    }

    // ยืนยันสำเร็จ → **บันทึกค่าจริง** (ระบบเดิมทิ้งค่านี้ไปเพราะบั๊ก return false)
    const measurement = await this.#save(station, confirmation.level, lastResult, source);
    this.#logger.info('measurement confirmed and saved', {
      stationId: station.id, waterLine: confirmation.level.value, spread: confirmation.spread,
    });
    return {
      recorded: true,
      waterLine: confirmation.level.value,
      reason: confirmation.reason,
      measurement: measurement.toJSON(),
    };
  }

  /**
   * บันทึกภาพและค่าวัดลงระบบ
   *
   * ภาพที่บันทึกไม่ได้ไม่ควรทำให้ค่าวัดหายไป — จึงดักข้อผิดพลาดแยกไว้
   *
   * @param {import('../models/Station.js').Station} station จุดวัด
   * @param {PixelLevel} waterLine ตำแหน่งผิวน้ำ
   * @param {import('../services/detection/DetectionResult.js').DetectionResult} result ผลการตรวจจับ
   * @param {string} source ที่มาของค่าวัด
   * @returns {Promise<import('../models/Measurement.js').Measurement>}
   */
  async #save(station, waterLine, result, source) {
    const measuredAt = new Date();
    let imagePath = null;
    let thumbnailPath = null;

    if (result.hasImage) {
      try {
        const saved = await this.#storageService.saveBase64(result.imageBase64, {
          kind: source === 'MANUAL' ? 'alert' : 'cron',
          stationId: station.id,
          at: measuredAt,
        });
        imagePath = saved.imagePath;
        thumbnailPath = saved.thumbnailPath;
      } catch (error) {
        this.#logger.warn('failed to save detection image', {
          stationId: station.id, message: error.message,
        });
      }
    }

    return this.#measurementService.record({
      station,
      waterLine,
      measuredAt,
      imagePath,
      thumbnailPath,
      processingTime: result.processingTime,
      source,
      pdpaStats: result.pdpaStats,
      // ผิวน้ำติดขอบภาพ = ได้แค่ค่าประมาณขั้นต่ำ บันทึกไว้แต่ต้องกำกับให้ชัด
      quality: result.isAtFrameEdge ? 'AT_FRAME_EDGE' : 'OK',
    });
  }
}
