import { BaseService } from '../core/BaseService.js';
import { EventBus } from '../core/EventBus.js';
import { NotFoundError, ValidationError } from '../core/errors/index.js';
import { Measurement } from '../models/Measurement.js';
import { ValidationLog } from '../models/ValidationLog.js';
import { PixelLevel } from '../models/values/PixelLevel.js';
import { ZoneLevel } from '../models/values/ZoneLevel.js';

/**
 * บริการบันทึกและค้นค่าวัดระดับน้ำ
 *
 * เป็นจุดเดียวที่บันทึกค่าวัด — ทั้ง `DetectJob` และการสั่งวัดด้วยตนเองจาก Controller
 * เรียกเมท็อดเดียวกัน จึงไม่มีทางที่ตรรกะสองที่จะเบี่ยงเบนจากกันได้
 * (แก้ปัญหาตรรกะซ้ำของระบบเดิม — CLAUDE.md ข้อ 5)
 */
export class MeasurementService extends BaseService {
  /** @type {import('../repositories/MeasurementRepository.js').MeasurementRepository} */
  #measurementRepository;
  /** @type {import('../repositories/ValidationLogRepository.js').ValidationLogRepository} */
  #validationLogRepository;
  /** @type {import('../repositories/AlertStateRepository.js').AlertStateRepository} */
  #alertStateRepository;
  /** @type {import('./CalibrationService.js').CalibrationService} */
  #calibrationService;
  /** @type {import('./RoiService.js').RoiService} */
  #roiService;
  /** @type {import('./PermissionService.js').PermissionService} */
  #permissionService;
  /** @type {EventBus} */
  #eventBus;
  /** @type {import('./ForecastService.js').ForecastService|null} */
  #forecastService;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../repositories/MeasurementRepository.js').MeasurementRepository} deps.measurementRepository ที่เก็บค่าวัด
   * @param {import('../repositories/ValidationLogRepository.js').ValidationLogRepository} deps.validationLogRepository ที่เก็บบันทึกการตรวจความผันผวน
   * @param {import('../repositories/AlertStateRepository.js').AlertStateRepository} deps.alertStateRepository ที่เก็บสถานะการแจ้งเตือน
   * @param {import('./CalibrationService.js').CalibrationService} deps.calibrationService บริการเทียบค่า
   * @param {import('./RoiService.js').RoiService} deps.roiService บริการ ROI
   * @param {import('./PermissionService.js').PermissionService} deps.permissionService บริการสิทธิ์
   * @param {EventBus} deps.eventBus ช่องทางเหตุการณ์
   * @param {import('../core/Logger.js').Logger} [deps.logger] ตัวบันทึกเหตุการณ์
   */
  constructor({
    measurementRepository, validationLogRepository, alertStateRepository,
    calibrationService, roiService, permissionService, eventBus, forecastService, logger,
  }) {
    super(measurementRepository, logger);
    this.#measurementRepository = measurementRepository;
    this.#validationLogRepository = validationLogRepository;
    this.#alertStateRepository = alertStateRepository;
    this.#calibrationService = calibrationService;
    this.#roiService = roiService;
    this.#permissionService = permissionService;
    this.#eventBus = eventBus;
    this.#forecastService = forecastService ?? null;
  }

  /**
   * บันทึกค่าวัดหนึ่งครั้ง — คำนวณเมตรและโซนให้ครบตั้งแต่ตอนบันทึก
   *
   * ประกาศเหตุการณ์ `measurement.recorded` เมื่อสำเร็จ เพื่อให้ `AlertService`
   * ไปประเมินการแจ้งเตือนต่อเองโดยที่บริการนี้ไม่ต้องรู้จัก LINE เลย (Observer)
   *
   * @param {object} params ข้อมูลค่าวัด
   * @param {import('../models/Station.js').Station} params.station จุดวัด
   * @param {PixelLevel} params.waterLine ตำแหน่งผิวน้ำเป็นพิกเซล
   * @param {Date} [params.measuredAt] เวลาที่วัด
   * @param {string|null} [params.imagePath] พาธไฟล์ภาพ
   * @param {string|null} [params.thumbnailPath] พาธไฟล์ภาพย่อ
   * @param {number|null} [params.processingTime] เวลาที่ใช้ประมวลผล
   * @param {string} [params.source='CRON'] ที่มาของค่าวัด
   * @param {object|null} [params.pdpaStats] สถิติ PDPA
   * @returns {Promise<Measurement>} ค่าวัดที่บันทึกแล้ว
   * @throws {ValidationError} เมื่อข้อมูลไม่ถูกต้อง
   */
  async record({
    station, waterLine, measuredAt = new Date(), imagePath = null, thumbnailPath = null,
    processingTime = null, source = 'CRON', pdpaStats = null, quality = 'OK',
  }) {
    const pixel = waterLine instanceof PixelLevel ? waterLine : new PixelLevel(waterLine);

    // แปลงเป็นเมตรและหาโซน — ทั้งสองอย่างยอมให้ล้มเหลวได้โดยไม่ทิ้งค่าวัดทิ้ง
    // เพราะค่าพิกเซลดิบยังมีประโยชน์แม้จะยังตั้งค่าเทียบค่าหรือโซนไม่ครบ
    let meterLevel = null;
    let zone = null;

    const calculator = await this.#calibrationService.tryCalculatorFor(station.id);
    if (calculator) {
      meterLevel = calculator.pixelToMeter(pixel);
    } else {
      this.logger.warn('measurement saved without meter value — calibration incomplete', {
        stationId: station.id, slug: station.slug,
      });
    }

    const zones = await this.#roiService.zonesForStation(station.id);
    if (zones.length) {
      try {
        zone = ZoneLevel.resolve(pixel, zones);
      } catch (error) {
        this.logger.warn('could not resolve zone for measurement', {
          stationId: station.id, message: error.message,
        });
      }
    }

    const measurement = new Measurement({
      stationId: station.id,
      measuredAt,
      waterLine: pixel.value,
      waterLevelM: meterLevel?.value ?? null,
      zoneKey: zone?.key ?? null,
      imagePath,
      thumbnailPath,
      processingTime,
      source,
      pdpaStats,
      quality,
    });

    const saved = await this.#measurementRepository.create(measurement);
    await this.#alertStateRepository.recordZone(station.id, zone?.key ?? null, measuredAt);

    this.#eventBus.publish(EventBus.EVENTS.MEASUREMENT_RECORDED, {
      station, measurement: saved, zone,
    });

    this.logger.info('measurement recorded', {
      stationId: station.id, waterLine: pixel.value,
      meter: meterLevel?.value ?? null, zone: zone?.key ?? null, source,
    });

    return saved;
  }

  /**
   * พยากรณ์ระดับน้ำล่วงหน้าของจุดวัดหนึ่งแห่ง
   *
   * ดึงค่าวัดย้อนหลังมาหาแนวโน้มด้วย `ForecastService` แล้วแปลงระดับที่พยากรณ์ได้
   * กลับเป็นพิกเซลด้วยตัวคำนวณเดิม เพื่อหาโซนเตือนภัยด้วย `ZoneLevel.resolve()`
   * — ใช้ตรรกะชุดเดียวกับตอนบันทึกค่าจริง จะได้ไม่มีวันตีความโซนต่างกันสองแบบ
   *
   * @param {number} stationId รหัสจุดวัด
   * @param {object} [options] ตัวเลือก
   * @param {number} [options.hours=6] จำนวนชั่วโมงล่วงหน้า
   * @param {number} [options.historyHours=24] ช่วงข้อมูลย้อนหลังที่ใช้หาแนวโน้ม
   * @returns {Promise<object>} ผลพยากรณ์ (มี `available: false` พร้อมเหตุผลเมื่อทำไม่ได้)
   */
  async forecast(stationId, { hours = 6, historyHours = 24 } = {}) {
    if (!this.#forecastService) return { available: false, reason: 'ไม่ได้เปิดใช้ระบบพยากรณ์' };

    const to = new Date();
    const from = new Date(to.getTime() - historyHours * 3_600_000);
    const series = await this.#measurementRepository.chartSeries(stationId, { from, to });

    const result = this.#forecastService.forecast(
      series.map((row) => ({ measuredAt: row.t, meter: row.waterLevelM })),
      { hours },
    );
    if (!result.available) return result;

    // สัดส่วนค่าประมาณ — ถ้าข้อมูลส่วนใหญ่มาจากภาพที่เสาทะลุขอบเฟรม ต้องบอกผู้ใช้
    const estimates = series.filter((row) => row.quality === 'AT_FRAME_EDGE').length;

    const [calculator, zones] = await Promise.all([
      this.#calibrationService.tryCalculatorFor(stationId),
      this.#roiService.zonesForStation(stationId),
    ]);

    const points = result.points.map((point) => {
      let zone = null;
      if (calculator && zones.length) {
        try {
          zone = ZoneLevel.resolve(calculator.meterToPixel(point.meter), zones);
        } catch { /* ค่าที่พยากรณ์อยู่นอกช่วงจนหาโซนไม่ได้ — แสดงเป็นไม่มีโซน */ }
      }
      return { ...point, zone: zone?.toJSON() ?? null };
    });

    return { ...result, points, estimateShare: series.length ? estimates / series.length : 0 };
  }

  /**
   * บันทึกผลการตรวจความผันผวน — **ต้องเรียกทุกครั้งที่เข้าโหมดยืนยัน**
   *
   * ไม่ว่าผลจะผ่านหรือไม่ก็ต้องมีบันทึก (CLAUDE.md ข้อ 6.4 ขั้นที่ 5)
   *
   * @param {object} entry ผลการตรวจ
   * @param {number} entry.stationId รหัสจุดวัด
   * @param {number} entry.suspectedLevel ค่าที่น่าสงสัย (พิกเซล)
   * @param {number|null} entry.confirmedLevel ค่าที่ยืนยันได้ (พิกเซล)
   * @param {number} entry.variation ผลต่างจากค่าเฉลี่ยเดิม
   * @param {number} entry.attempts จำนวนครั้งที่วัดซ้ำ
   * @param {number} [entry.spread=0] ช่วงกระจาย
   * @param {boolean} entry.success ยืนยันสำเร็จหรือไม่
   * @param {string|null} [entry.note] หมายเหตุ
   * @returns {Promise<ValidationLog>}
   */
  async recordValidation(entry) {
    const log = new ValidationLog(entry);
    const saved = await this.#validationLogRepository.create(log);
    if (!entry.success) {
      this.#eventBus.publish(EventBus.EVENTS.MEASUREMENT_REJECTED, { log: saved });
    }
    return saved;
  }

  /**
   * ค่าวัดล่าสุด N รายการเป็น `PixelLevel` — ใช้เป็นฐานเทียบในการตรวจความผันผวน
   * @param {number} stationId รหัสจุดวัด
   * @param {number} [limit=3] จำนวนรายการ
   * @returns {Promise<Array<PixelLevel>>}
   */
  async recentLevels(stationId, limit = 3) {
    const measurements = await this.#measurementRepository.findRecent(stationId, limit);
    return measurements.map((measurement) => measurement.waterLine);
  }

  /**
   * ค่าวัดล่าสุดของจุดวัด
   * @param {number} stationId รหัสจุดวัด
   * @returns {Promise<Measurement|null>}
   */
  async latestFor(stationId) {
    return this.#measurementRepository.findLatest(stationId);
  }

  /**
   * ค้นค่าวัดตามขอบเขตสิทธิ์ของผู้ใช้
   * @param {import('../models/User.js').User} user ผู้ใช้
   * @param {object} [filters={}] ตัวกรอง
   * @returns {Promise<{items: Array<Measurement>, total: number}>}
   */
  async search(user, filters = {}) {
    const scoped = this.#permissionService.applyStationScope(user, filters);
    return this.#measurementRepository.search(scoped);
  }

  /**
   * ข้อมูลกราฟของจุดวัด
   * @param {number} stationId รหัสจุดวัด
   * @param {{hours?: number, from?: string|null, to?: string|null}} [range={}] ช่วงเวลา
   * @returns {Promise<Array<{t: string, waterLine: number, waterLevelM: number|null, zoneKey: string|null}>>}
   */
  async chartSeries(stationId, { hours = 24, from = null, to = null } = {}) {
    const end = to ? new Date(to) : new Date();
    const start = from ? new Date(from) : new Date(end.getTime() - hours * 3600 * 1000);
    return this.#measurementRepository.chartSeries(stationId, {
      from: MeasurementService.formatSql(start),
      to: MeasurementService.formatSql(end),
    });
  }

  /**
   * สรุปค่าสูงสุด/ต่ำสุดของจุดวัดในช่วงเวลา
   * @param {number} stationId รหัสจุดวัด
   * @param {{from: Date|string, to: Date|string}} range ช่วงเวลา
   * @returns {Promise<object>}
   */
  async summarize(stationId, { from, to }) {
    return this.#measurementRepository.summarize(stationId, {
      from: MeasurementService.formatSql(from),
      to: MeasurementService.formatSql(to),
    });
  }

  /**
   * ภาพล่าสุดสำหรับแกลเลอรี
   * @param {number} stationId รหัสจุดวัด
   * @param {number} [limit=12] จำนวนภาพ
   * @returns {Promise<Array<Measurement>>}
   */
  async gallery(stationId, limit = 12) {
    return this.#measurementRepository.recentWithImages(stationId, limit);
  }

  /**
   * ส่งออกค่าวัดเป็น CSV
   *
   * ใส่ BOM ของ UTF-8 นำหน้าเพื่อให้ Excel ภาษาไทยเปิดแล้วไม่เป็นอักษรเพี้ยน
   *
   * @param {import('../models/User.js').User} user ผู้ใช้
   * @param {object} filters ตัวกรอง
   * @returns {Promise<string>} เนื้อหา CSV
   */
  async exportCsv(user, filters) {
    const scoped = this.#permissionService.applyStationScope(user, filters);
    const rows = await this.#measurementRepository.forExport(scoped);
    // คงคอลัมน์พิกเซลไว้ในไฟล์ส่งออกโดยเจตนา — ผู้ดูแลใช้ตรวจสอบย้อนกลับกับจุดเทียบค่า
    // ต่างจากหน้าจอที่แสดงเฉพาะเมตร เพราะ CSV เป็นข้อมูลดิบสำหรับงานวิเคราะห์
    const header = ['เวลาที่วัด', 'จุดวัด', 'ตำแหน่งผิวน้ำ (พิกเซล)', 'ระดับน้ำ (เมตร)', 'โซน', 'ที่มา'];

    const lines = [header.join(',')];
    for (const row of rows) {
      lines.push([
        MeasurementService.formatSql(row.measured_at),
        row.station_name,
        row.water_line,
        row.water_level_m ?? '',
        ZoneLevel.fromKey(row.zone_key)?.label ?? '',
        row.source,
      ].map(MeasurementService.#csvCell).join(','));
    }
    return `﻿${lines.join('\r\n')}`;
  }

  /**
   * ลบค่าวัดหนึ่งรายการ (สิทธิ์ `measurement.delete`)
   * @param {import('../models/User.js').User} user ผู้ใช้
   * @param {number} measurementId รหัสค่าวัด
   * @returns {Promise<Measurement>} ค่าวัดที่ถูกลบ
   * @throws {NotFoundError} เมื่อไม่พบหรืออยู่นอกขอบเขต
   */
  async delete(user, measurementId) {
    const measurement = await this.#measurementRepository.findById(measurementId);
    if (!measurement) throw new NotFoundError('ไม่พบค่าวัดที่ต้องการ');
    this.#permissionService.assertStationAccess(user, measurement.stationId);
    await this.#measurementRepository.delete(measurementId);
    return measurement;
  }

  /**
   * จัดรูปแบบเวลาเป็นสตริงที่ MySQL รับได้ (`YYYY-MM-DD HH:MM:SS` เวลาไทย)
   * @param {Date|string} value เวลา
   * @returns {string}
   */
  static formatSql(value) {
    if (typeof value === 'string') return value;
    const date = value instanceof Date ? value : new Date(value);
    return date.toLocaleString('sv-SE');
  }

  /**
   * หนีอักขระพิเศษในเซลล์ CSV
   * @param {*} value ค่าดิบ
   * @returns {string}
   */
  static #csvCell(value) {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }
}
