import { BaseController } from '../core/BaseController.js';
import { NotFoundError } from '../core/errors/index.js';

/**
 * ควบคุมหน้าประวัติการแจ้งเตือนและการส่งด้วยตนเอง
 */
export class AlertController extends BaseController {
  /** @type {import('../services/AlertService.js').AlertService} */
  #alertService;
  /** @type {import('../services/StationService.js').StationService} */
  #stationService;
  /** @type {import('../services/MeasurementService.js').MeasurementService} */
  #measurementService;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../services/AlertService.js').AlertService} deps.alertService บริการแจ้งเตือน
   * @param {import('../services/StationService.js').StationService} deps.stationService บริการจุดวัด
   * @param {import('../services/MeasurementService.js').MeasurementService} deps.measurementService บริการค่าวัด
   * @param {import('../core/Logger.js').Logger} [deps.logger] ตัวบันทึกเหตุการณ์
   */
  constructor({ alertService, stationService, measurementService, logger }) {
    super(alertService, logger);
    this.#alertService = alertService;
    this.#stationService = stationService;
    this.#measurementService = measurementService;
  }

  /**
   * หน้าประวัติการแจ้งเตือน
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async index(req, res) {
    const { page, pageSize, offset } = this.pagination(req.query, 50);
    const [{ items, total }, stations] = await Promise.all([
      this.#alertService.history(req.user, {
        stationId: req.query.stationId || null,
        status: req.query.status ?? '',
        messageType: req.query.messageType ?? '',
        limit: pageSize,
        offset,
      }),
      this.#stationService.list(req.user, { limit: 200 }),
    ]);

    res.render('admin/alerts', {
      title: 'ประวัติการแจ้งเตือน',
      alerts: items.map((item) => item.toJSON()),
      stations: stations.items.map((station) => station.toJSON()),
      filters: req.query,
      pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) },
    });
  }

  /**
   * ส่งการแจ้งเตือนด้วยตนเอง (สิทธิ์ `alert.broadcast`)
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   * @throws {NotFoundError} เมื่อยังไม่มีค่าวัดของจุดวัดนั้น
   */
  async broadcast(req, res) {
    const measurement = await this.#measurementService.latestFor(req.stationId);
    if (!measurement) {
      throw new NotFoundError('ยังไม่มีค่าวัดของจุดวัดนี้ให้แจ้งเตือน');
    }
    const result = await this.#alertService.sendManual(req.stationId, {
      actor: req.user, measurement,
    });
    this.ok(res, result);
  }

  /**
   * ส่งข้อความทดสอบไปยังกลุ่ม LINE (สิทธิ์ `alert.broadcast`)
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async sendTest(req, res) {
    const target = req.body?.target || null;
    const result = await this.#alertService.sendTest(target, req.user);
    this.ok(res, result);
  }
}
