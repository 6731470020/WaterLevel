import { BaseController } from '../core/BaseController.js';
import { Validator } from '../core/Validator.js';
import { NotFoundError } from '../core/errors/index.js';
import { ZoneLevel } from '../models/values/ZoneLevel.js';

/**
 * ควบคุมหน้าค่าวัดระดับน้ำ การส่งออก CSV และการสั่งวัดด้วยตนเอง
 */
export class MeasurementController extends BaseController {
  /** @type {import('../services/MeasurementService.js').MeasurementService} */
  #measurementService;
  /** @type {import('../services/StationService.js').StationService} */
  #stationService;
  /** @type {import('../jobs/DetectJob.js').DetectJob} */
  #detectJob;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../services/MeasurementService.js').MeasurementService} deps.measurementService บริการค่าวัด
   * @param {import('../services/StationService.js').StationService} deps.stationService บริการจุดวัด
   * @param {import('../jobs/DetectJob.js').DetectJob} deps.detectJob งานตรวจวัด (ใช้สั่งวัดด้วยตนเอง)
   * @param {import('../core/Logger.js').Logger} [deps.logger] ตัวบันทึกเหตุการณ์
   */
  constructor({ measurementService, stationService, detectJob, logger }) {
    super(measurementService, logger);
    this.#measurementService = measurementService;
    this.#stationService = stationService;
    this.#detectJob = detectJob;
  }

  /**
   * หน้ารายการค่าวัดพร้อมตัวกรอง
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async index(req, res) {
    const { page, pageSize, offset } = this.pagination(req.query, 50);
    const filters = this.#parseFilters(req.query);

    const [{ items, total }, stations] = await Promise.all([
      this.#measurementService.search(req.user, { ...filters, limit: pageSize, offset }),
      this.#stationService.list(req.user, { limit: 200 }),
    ]);

    res.render('admin/measurements', {
      title: 'ค่าวัดระดับน้ำ',
      measurements: items.map((item) => item.toJSON()),
      stations: stations.items.map((station) => station.toJSON()),
      zoneLevels: ZoneLevel.all().map((zone) => zone.toJSON()),
      filters: req.query,
      pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) },
    });
  }

  /**
   * API: ค้นค่าวัด
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async apiIndex(req, res) {
    const { page, pageSize, offset } = this.pagination(req.query);
    const filters = this.#parseFilters(req.query);
    const { items, total } = await this.#measurementService.search(
      req.user, { ...filters, limit: pageSize, offset },
    );
    this.ok(res, items.map((item) => item.toJSON()), { page, pageSize, total });
  }

  /**
   * ส่งออกค่าวัดเป็นไฟล์ CSV (สิทธิ์ `measurement.export`)
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async exportCsv(req, res) {
    const csv = await this.#measurementService.exportCsv(req.user, this.#parseFilters(req.query));
    const stamp = new Date().toLocaleDateString('sv-SE');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="measurements-${stamp}.csv"`);
    res.send(csv);
  }

  /**
   * API: ข้อมูลกราฟของจุดวัด
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async apiChart(req, res) {
    const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 24 * 366);
    const series = await this.#measurementService.chartSeries(req.stationId, { hours });
    this.ok(res, series, { hours, points: series.length });
  }

  /**
   * สั่งจับภาพและวัดค่าทันที (สิทธิ์ `capture.trigger`)
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   * @throws {NotFoundError} เมื่อไม่พบจุดวัด
   */
  async triggerCapture(req, res) {
    const station = await this.#stationService.findForUser(req.user, req.stationId);
    const result = await this.#detectJob.runForStation(station, {
      source: 'MANUAL', triggeredBy: req.user.id,
    });
    this.ok(res, result);
  }

  /**
   * ลบค่าวัดหนึ่งรายการ (สิทธิ์ `measurement.delete`)
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async destroy(req, res) {
    const measurement = await this.#measurementService.delete(req.user, Number(req.params.id));
    this.ok(res, { deleted: true, id: measurement.id });
  }

  /**
   * แปลงตัวกรองจาก query string
   * @param {object} query วัตถุ `req.query`
   * @returns {object} ตัวกรองที่สะอาดแล้ว
   */
  #parseFilters(query) {
    const clean = new Validator(query)
      .integer('stationId', { min: 1, label: 'จุดวัด' })
      .oneOf('zoneKey', ZoneLevel.keys(), { label: 'โซน' })
      .date('from', { label: 'วันที่เริ่มต้น' })
      .date('to', { label: 'วันที่สิ้นสุด' })
      .validate();

    return {
      stationId: clean.stationId ?? null,
      zoneKey: clean.zoneKey ?? null,
      from: clean.from ? `${clean.from} 00:00:00` : null,
      to: clean.to ? `${clean.to} 23:59:59` : null,
    };
  }
}
