import { BaseJob } from '../core/BaseJob.js';
import { EventBus } from '../core/EventBus.js';

/**
 * งานตรวจสุขภาพระบบทุก 15 นาที
 *
 * แจ้งเตือนเมื่อจุดวัดใดไม่มีข้อมูลเข้ามาเกิน 30 นาที ซึ่งมักหมายถึงกล้องล่ม
 * หรือบริการตรวจจับมีปัญหา — ปัญหาที่ระบบเดิมไม่มีทางรู้ตัวจนกว่าจะมีคนสังเกตเห็น
 *
 * ประกาศเหตุการณ์ `station.offline` แทนการส่งข้อความเอง เพื่อให้เพิ่มช่องทาง
 * แจ้งเตือนใหม่ได้โดยไม่แก้คลาสนี้
 */
export class HealthCheckJob extends BaseJob {
  /** @type {import('../repositories/MeasurementRepository.js').MeasurementRepository} */
  #measurementRepository;
  /** @type {import('../services/detection/DetectionService.js').DetectionService} */
  #detectionService;
  /** @type {EventBus} */
  #eventBus;
  /** @type {number} */
  #staleMinutes;
  /** @type {import('../core/Logger.js').Logger} */
  #logger;
  /** @type {Set<number>} */
  #alreadyReported = new Set();

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../repositories/MeasurementRepository.js').MeasurementRepository} deps.measurementRepository ที่เก็บค่าวัด
   * @param {import('../services/detection/DetectionService.js').DetectionService} deps.detectionService บริการตรวจจับ
   * @param {EventBus} deps.eventBus ช่องทางเหตุการณ์
   * @param {number} [deps.staleMinutes=30] จำนวนนาทีที่ถือว่าขาดการติดต่อ
   * @param {import('../core/Logger.js').Logger} deps.logger ตัวบันทึกเหตุการณ์
   * @param {string} [deps.schedule='*\/15 * * * *'] นิพจน์ cron
   */
  constructor({
    measurementRepository, detectionService, eventBus,
    staleMinutes = 30, logger, schedule = '*/15 * * * *',
  }) {
    super('ตรวจสุขภาพระบบ', schedule);
    this.#measurementRepository = measurementRepository;
    this.#detectionService = detectionService;
    this.#eventBus = eventBus;
    this.#staleMinutes = Number(staleMinutes);
    this.#logger = logger;
  }

  /**
   * ตรวจว่ามีจุดวัดใดขาดการติดต่อบ้าง
   * @returns {Promise<{checked: number, stale: number, recovered: number, detection: object}>}
   */
  async execute() {
    const stale = await this.#measurementRepository.findStaleStations(this.#staleMinutes);
    const staleIds = new Set(stale.map((item) => item.stationId));

    // แจ้งเฉพาะจุดวัดที่เพิ่งเริ่มขาดการติดต่อ ไม่แจ้งซ้ำทุก 15 นาที
    let reported = 0;
    for (const item of stale) {
      if (this.#alreadyReported.has(item.stationId)) continue;
      this.#alreadyReported.add(item.stationId);
      reported += 1;
      this.#logger.warn('station appears offline', {
        stationId: item.stationId, name: item.name, lastMeasuredAt: item.lastMeasuredAt,
      });
      this.#eventBus.publish(EventBus.EVENTS.STATION_OFFLINE, {
        stationId: item.stationId,
        name: item.name,
        lastMeasuredAt: item.lastMeasuredAt,
        staleMinutes: this.#staleMinutes,
      });
    }

    // จุดวัดที่กลับมาทำงานแล้ว — ล้างออกจากรายการเพื่อให้แจ้งได้อีกครั้งหากล่มซ้ำ
    let recovered = 0;
    for (const stationId of [...this.#alreadyReported]) {
      if (!staleIds.has(stationId)) {
        this.#alreadyReported.delete(stationId);
        recovered += 1;
        this.#logger.info('station recovered', { stationId });
      }
    }

    const detection = await this.#detectionService.healthCheck();
    if (!detection.healthy) {
      this.#logger.error('detection service unhealthy', detection);
    }

    return { checked: stale.length + recovered, stale: reported, recovered, detection };
  }
}
