import { BaseController } from '../core/BaseController.js';
import { Validator } from '../core/Validator.js';
import { ZoneLevel } from '../models/values/ZoneLevel.js';

/**
 * ควบคุมหน้าจัดการจุดวัด (`/admin/stations`)
 */
export class StationController extends BaseController {
  /** @type {import('../services/StationService.js').StationService} */
  #stationService;
  /** @type {import('../services/CalibrationService.js').CalibrationService} */
  #calibrationService;
  /** @type {import('../services/RoiService.js').RoiService} */
  #roiService;
  /** @type {import('../services/LineService.js').LineService} */
  #lineService;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../services/StationService.js').StationService} deps.stationService บริการจุดวัด
   * @param {import('../services/CalibrationService.js').CalibrationService} deps.calibrationService บริการเทียบค่า
   * @param {import('../services/RoiService.js').RoiService} deps.roiService บริการ ROI
   * @param {import('../services/LineService.js').LineService} deps.lineService บริการ LINE
   * @param {import('../core/Logger.js').Logger} [deps.logger] ตัวบันทึกเหตุการณ์
   */
  constructor({ stationService, calibrationService, roiService, lineService, logger }) {
    super(stationService, logger);
    this.#stationService = stationService;
    this.#calibrationService = calibrationService;
    this.#roiService = roiService;
    this.#lineService = lineService;
  }

  /**
   * หน้ารายการจุดวัด
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async index(req, res) {
    const { page, pageSize, offset } = this.pagination(req.query, 25);
    const { items, total } = await this.#stationService.list(req.user, {
      search: req.query.search ?? '',
      isActive: req.query.status === 'active' ? true
        : req.query.status === 'inactive' ? false : null,
      limit: pageSize,
      offset,
    });

    res.render('admin/stations', {
      title: 'จุดวัดระดับน้ำ',
      stations: items.map((station) => station.toJSON()),
      pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) },
      filters: { search: req.query.search ?? '', status: req.query.status ?? '' },
    });
  }

  /**
   * หน้ารายละเอียดจุดวัด (แท็บทั่วไป / ROI / เทียบค่า / การเตือน / PDPA)
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async show(req, res) {
    const stationId = req.stationId;
    const [station, calibration, rois, readiness, lineGroups] = await Promise.all([
      this.#stationService.findForUser(req.user, stationId),
      this.#calibrationService.listForStation(stationId),
      this.#roiService.listForStation(stationId),
      this.#stationService.readiness(stationId),
      this.#lineService.activeGroups(),
    ]);

    res.render('admin/stationDetail', {
      title: station.name,
      station: station.toJSON(),
      calibration: calibration.map((point) => point.toJSON()),
      rois: rois.map((roi) => roi.toJSON()),
      readiness,
      zoneLevels: ZoneLevel.all().map((zone) => zone.toJSON()),
      lineGroups: lineGroups.map((group) => group.toJSON()),
      tab: req.query.tab ?? 'general',
    });
  }

  /**
   * หน้าสร้างจุดวัดใหม่
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async showCreate(req, res) {
    res.render('admin/stationForm', {
      title: 'สร้างจุดวัดใหม่',
      station: null,
      zoneLevels: ZoneLevel.all().map((zone) => zone.toJSON()),
      lineGroups: (await this.#lineService.activeGroups()).map((group) => group.toJSON()),
    });
  }

  /**
   * หน้าแก้ไขจุดวัด
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async showEdit(req, res) {
    const station = await this.#stationService.findForUser(req.user, req.stationId);
    res.render('admin/stationForm', {
      title: `แก้ไขจุดวัด — ${station.name}`,
      station: station.toJSON(),
      zoneLevels: ZoneLevel.all().map((zone) => zone.toJSON()),
      lineGroups: (await this.#lineService.activeGroups()).map((group) => group.toJSON()),
    });
  }

  /**
   * สร้างจุดวัดใหม่
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async create(req, res) {
    const data = this.#validateForm(req);
    const station = await this.#stationService.create(data, this.actorContext(req));
    res.redirect(`/admin/stations/${station.id}?created=1`);
  }

  /**
   * แก้ไขจุดวัด
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async update(req, res) {
    const data = this.#validateForm(req);
    await this.#stationService.update(req.stationId, data, this.actorContext(req));
    res.redirect(`/admin/stations/${req.stationId}?updated=1`);
  }

  /**
   * เปิด/ปิดการใช้งานจุดวัด
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async toggleActive(req, res) {
    const isActive = ['1', 'true', 'on'].includes(String(req.body.isActive));
    await this.#stationService.setActive(req.stationId, isActive, this.actorContext(req));
    res.redirect('/admin/stations');
  }

  /**
   * ลบจุดวัด
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async destroy(req, res) {
    await this.#stationService.delete(req.stationId, this.actorContext(req));
    res.redirect('/admin/stations?deleted=1');
  }

  /**
   * API: รายการจุดวัดตามขอบเขตสิทธิ์
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async apiIndex(req, res) {
    const { page, pageSize, offset } = this.pagination(req.query);
    const { items, total } = await this.#stationService.list(req.user, {
      search: req.query.search ?? '', limit: pageSize, offset,
    });
    this.ok(res, items.map((station) => station.toJSON()), { page, pageSize, total });
  }

  /**
   * API: รายละเอียดจุดวัดเดียว
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async apiShow(req, res) {
    const station = await this.#stationService.findForUser(req.user, req.stationId);
    const readiness = await this.#stationService.readiness(req.stationId);
    this.ok(res, { ...station.toJSON(), readiness });
  }

  /**
   * ตรวจและทำความสะอาดข้อมูลจากฟอร์มจุดวัด
   * @param {object} req วัตถุ request
   * @returns {object} ข้อมูลที่สะอาดแล้ว
   * @throws {import('../core/errors/ValidationError.js').ValidationError} เมื่อข้อมูลไม่ถูกต้อง
   */
  #validateForm(req) {
    const validator = new Validator(req.body)
      .required('name', 'ชื่อจุดวัด')
      .string('name', { max: 255, label: 'ชื่อจุดวัด' })
      .string('slug', { max: 100, label: 'ชื่อย่อ' })
      .string('description', { max: 2000, label: 'คำอธิบาย' })
      .oneOf('cameraType', ['snapshot', 'm3u8', 'mjpeg'], { label: 'ชนิดกล้อง' })
      .integer('imageWidth', { min: 1, max: 8192, label: 'ความกว้างภาพ' })
      .integer('imageHeight', { min: 1, max: 8192, label: 'ความสูงภาพ' })
      .number('latitude', { min: -90, max: 90, label: 'ละติจูด' })
      .number('longitude', { min: -180, max: 180, label: 'ลองจิจูด' })
      .integer('alertCooldownMinutes', { min: 0, max: 1440, label: 'ระยะกันแจ้งเตือนซ้ำ' })
      .integer('pdpaBlurStrength', { min: 1, max: 100, label: 'ความแรงการเบลอ' })
      .number('pdpaConfThreshold', { min: 0, max: 1, label: 'ค่าความเชื่อมั่น' })
      .integer('imageRetentionDays', { min: 1, max: 3650, label: 'จำนวนวันเก็บภาพ' })
      .string('cameraUrl', { max: 500, label: 'URL กล้อง' })
      .string('cameraUsername', { max: 100, label: 'ชื่อผู้ใช้ของกล้อง' })
      .string('cameraPassword', { max: 255, label: 'รหัสผ่านของกล้อง' })
      .string('lineGroupId', { max: 100, label: 'รหัสกลุ่ม LINE' })
      .oneOf('pdpaMethod', ['blur', 'pixelate'], { label: 'วิธีปกปิดใบหน้า' })
      .boolean('isActive', true)
      .boolean('pdpaEnabled', true)
      .boolean('publicLiveEnabled', false);

    const clean = validator.validate();

    const rawZones = req.body.alertZoneKeys;
    const alertZoneKeys = (Array.isArray(rawZones) ? rawZones : rawZones ? [rawZones] : [])
      .map((key) => String(key).toUpperCase())
      .filter((key) => ZoneLevel.fromKey(key));

    return {
      ...clean,
      alertZoneKeys,
      slug: clean.slug || clean.name,
      latitude: clean.latitude ?? null,
      longitude: clean.longitude ?? null,
      cameraUrl: clean.cameraUrl || null,
      cameraUsername: clean.cameraUsername || null,
      // เว้นว่าง = ไม่เปลี่ยน — `StationService.update()` หยิบค่าเดิมมาให้
      cameraPassword: clean.cameraPassword || '',
      lineGroupId: clean.lineGroupId || null,
      description: clean.description || null,
    };
  }

}
