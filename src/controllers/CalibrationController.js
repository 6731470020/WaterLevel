import { BaseController } from '../core/BaseController.js';
import { ValidationError } from '../core/errors/index.js';

/**
 * ควบคุมหน้าจัดการจุดเทียบค่าพิกเซล↔เมตร
 */
export class CalibrationController extends BaseController {
  /** @type {import('../services/CalibrationService.js').CalibrationService} */
  #calibrationService;
  /** @type {import('../services/StationService.js').StationService} */
  #stationService;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../services/CalibrationService.js').CalibrationService} deps.calibrationService บริการเทียบค่า
   * @param {import('../services/StationService.js').StationService} deps.stationService บริการจุดวัด
   * @param {import('../core/Logger.js').Logger} [deps.logger] ตัวบันทึกเหตุการณ์
   */
  constructor({ calibrationService, stationService, logger }) {
    super(calibrationService, logger);
    this.#calibrationService = calibrationService;
    this.#stationService = stationService;
  }

  /**
   * หน้าจัดการจุดเทียบค่า
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async page(req, res) {
    const stationId = req.stationId;
    const [station, points] = await Promise.all([
      this.#stationService.findForUser(req.user, stationId),
      this.#calibrationService.listForStation(stationId),
    ]);

    const calculator = await this.#calibrationService.tryCalculatorFor(stationId);

    res.render('admin/calibration', {
      title: `จุดเทียบค่า — ${station.name}`,
      station: station.toJSON(),
      points: points.map((point) => point.toJSON()),
      preview: calculator ? calculator.previewTable(20) : [],
      ready: calculator !== null,
    });
  }

  /**
   * API: อ่านจุดเทียบค่าทั้งหมด
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async apiIndex(req, res) {
    const points = await this.#calibrationService.listForStation(req.stationId);
    this.ok(res, points.map((point) => point.toJSON()));
  }

  /**
   * API: บันทึกจุดเทียบค่าทั้งชุด
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   * @throws {ValidationError} เมื่อรูปแบบข้อมูลไม่ถูกต้อง
   */
  async save(req, res) {
    const rawPoints = req.body?.points;
    if (!Array.isArray(rawPoints)) {
      throw new ValidationError('รูปแบบข้อมูลไม่ถูกต้อง — ต้องส่งฟิลด์ points เป็นอาร์เรย์');
    }

    const points = await this.#calibrationService.replaceForStation(
      req.stationId, rawPoints, this.actorContext(req),
    );
    this.ok(res, points.map((point) => point.toJSON()));
  }

  /**
   * API: ทดสอบแปลงค่าพิกเซลเป็นเมตรแบบสด
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   * @throws {ValidationError} เมื่อค่าพิกเซลไม่ถูกต้อง
   */
  async test(req, res) {
    const pixel = Number(req.query.pixel ?? req.body?.pixel);
    if (!Number.isFinite(pixel) || pixel < 0) {
      throw new ValidationError('กรุณาระบุค่าพิกเซลเป็นจำนวนไม่ติดลบ');
    }
    const result = await this.#calibrationService.testConversion(req.stationId, pixel);
    this.ok(res, result);
  }
}
