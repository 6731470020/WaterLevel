import { BaseController } from '../core/BaseController.js';
import { ValidationError } from '../core/errors/index.js';

/**
 * ควบคุมเครื่องมือวาด ROI และการบันทึกขอบเขต
 *
 * ระบบเดิมส่งออก ROI เป็นไฟล์อย่างเดียว ระบบใหม่บันทึกเข้าฐานข้อมูลผ่าน API นี้
 * แต่ยังคงความสามารถนำเข้า/ส่งออกไฟล์ไว้เพื่อความเข้ากันได้
 */
export class RoiController extends BaseController {
  /** @type {import('../services/RoiService.js').RoiService} */
  #roiService;
  /** @type {import('../services/StationService.js').StationService} */
  #stationService;
  /** @type {import('../services/CalibrationService.js').CalibrationService} */
  #calibrationService;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../services/RoiService.js').RoiService} deps.roiService บริการ ROI
   * @param {import('../services/StationService.js').StationService} deps.stationService บริการจุดวัด
   * @param {import('../services/CalibrationService.js').CalibrationService} deps.calibrationService บริการเทียบค่า
   * @param {import('../core/Logger.js').Logger} [deps.logger] ตัวบันทึกเหตุการณ์
   */
  constructor({ roiService, stationService, calibrationService, logger }) {
    super(roiService, logger);
    this.#roiService = roiService;
    this.#stationService = stationService;
    this.#calibrationService = calibrationService;
  }

  /**
   * หน้าเครื่องมือวาด ROI
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async editor(req, res) {
    const stationId = req.stationId;
    const [station, rois, calibration] = await Promise.all([
      this.#stationService.findForUser(req.user, stationId),
      this.#roiService.listForStation(stationId),
      this.#calibrationService.listForStation(stationId),
    ]);

    res.render('admin/roiEditor', {
      title: `วาด ROI — ${station.name}`,
      station: station.toJSON(),
      rois: rois.map((roi) => roi.toJSON()),
      calibration: calibration.map((point) => point.toJSON()),
      defaultZones: this.#roiService.defaultZones(station.imageHeight),
    });
  }

  /**
   * API: อ่าน ROI ทั้งหมดของจุดวัด
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async apiIndex(req, res) {
    const rois = await this.#roiService.listForStation(req.stationId);
    this.ok(res, rois.map((roi) => roi.toJSON()));
  }

  /**
   * API: บันทึก ROI ทั้งชุด (เครื่องมือวาดส่งชุดเต็มมาเสมอ)
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   * @throws {ValidationError} เมื่อโครงสร้างข้อมูลไม่ถูกต้อง
   */
  async save(req, res) {
    const rawRois = req.body?.rois;
    if (!Array.isArray(rawRois)) {
      throw new ValidationError('รูปแบบข้อมูล ROI ไม่ถูกต้อง — ต้องส่งฟิลด์ rois เป็นอาร์เรย์');
    }

    const { rois, warnings } = await this.#roiService.replaceForStation(
      req.stationId, rawRois, {
        ...this.actorContext(req),
        imageWidth: req.body?.imageWidth,
        imageHeight: req.body?.imageHeight,
      },
    );
    this.ok(res, { rois: rois.map((roi) => roi.toJSON()), warnings });
  }

  /**
   * API: ส่งออก ROI เป็นไฟล์ config version 3.0
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async exportConfig(req, res) {
    const config = await this.#roiService.exportConfig(req.stationId);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="roi-config-${req.stationId}.json"`,
    );
    res.send(JSON.stringify(config, null, 2));
  }

  /**
   * API: นำเข้าไฟล์ config เดิม (รองรับ version 2.0 และ 3.0)
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   * @throws {ValidationError} เมื่อไม่ได้แนบไฟล์หรือไฟล์ไม่ใช่ JSON ที่ถูกต้อง
   */
  async importConfig(req, res) {
    if (!req.file?.buffer) {
      throw new ValidationError('กรุณาเลือกไฟล์ config ที่ต้องการนำเข้า');
    }

    let config;
    try {
      config = JSON.parse(req.file.buffer.toString('utf8'));
    } catch {
      throw new ValidationError('ไฟล์ที่อัปโหลดไม่ใช่ JSON ที่ถูกต้อง');
    }

    const { rois, warnings } = await this.#roiService.importLegacyConfig(
      req.stationId, config, this.actorContext(req),
    );
    this.ok(res, {
      imported: rois.length,
      version: config.version ?? 'ไม่ระบุ',
      rois: rois.map((roi) => roi.toJSON()),
      warnings,
    });
  }
}
