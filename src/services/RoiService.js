import { BaseService } from '../core/BaseService.js';
import { ValidationError, NotFoundError } from '../core/errors/index.js';
import { Roi } from '../models/Roi.js';
import { Zone } from '../models/Zone.js';

/**
 * บริการจัดการขอบเขต ROI และโซนเตือนภัย
 *
 * รองรับการนำเข้าไฟล์ config เดิมทั้ง version 2.0 และ 3.0 ผ่าน `importLegacyConfig()`
 * และเป็นจุดเดียวที่ตรวจความสมเหตุสมผลของโซนก่อนบันทึก
 */
export class RoiService extends BaseService {
  /** @type {import('../repositories/RoiRepository.js').RoiRepository} */
  #roiRepository;
  /** @type {import('../repositories/StationRepository.js').StationRepository} */
  #stationRepository;
  /** @type {import('./PermissionService.js').PermissionService} */
  #permissionService;
  /** @type {import('./AuditService.js').AuditService} */
  #auditService;
  /** @type {import('../core/MemoryCache.js').MemoryCache} */
  #cache;
  /** @type {import('./CalibrationService.js').CalibrationService} */
  #calibrationService;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../repositories/RoiRepository.js').RoiRepository} deps.roiRepository ที่เก็บ ROI
   * @param {import('../repositories/StationRepository.js').StationRepository} deps.stationRepository ที่เก็บจุดวัด
   * @param {import('./PermissionService.js').PermissionService} deps.permissionService บริการสิทธิ์
   * @param {import('./AuditService.js').AuditService} deps.auditService บริการบันทึกการใช้งาน
   * @param {import('../core/MemoryCache.js').MemoryCache} deps.cache แคชในหน่วยความจำ
   * @param {import('./CalibrationService.js').CalibrationService} deps.calibrationService บริการจุดเทียบค่า
   * @param {import('../core/Logger.js').Logger} [deps.logger] ตัวบันทึกเหตุการณ์
   */
  constructor({
    roiRepository, stationRepository, permissionService,
    auditService, cache, calibrationService, logger,
  }) {
    super(roiRepository, logger);
    this.#roiRepository = roiRepository;
    this.#stationRepository = stationRepository;
    this.#permissionService = permissionService;
    this.#auditService = auditService;
    this.#cache = cache;
    this.#calibrationService = calibrationService;
  }

  /**
   * ROI ทั้งหมดของจุดวัด
   * @param {number} stationId รหัสจุดวัด
   * @returns {Promise<Array<Roi>>}
   */
  async listForStation(stationId) {
    return this.#roiRepository.findByStation(stationId);
  }

  /**
   * โซนเตือนภัยของจุดวัด (ผ่านแคช 60 วินาที)
   *
   * `DetectJob` เรียกทุก 5 นาทีต่อจุดวัด จึงคุ้มที่จะแคชไว้
   *
   * @param {number} stationId รหัสจุดวัด
   * @returns {Promise<Array<Zone>>}
   */
  async zonesForStation(stationId) {
    return this.#cache.remember(
      `zones:${stationId}`,
      () => this.#roiRepository.zonesForStation(stationId),
      60 * 1000,
    );
  }

  /**
   * แทนที่ ROI ของจุดวัดทั้งชุด (เครื่องมือวาด ROI ส่งชุดเต็มมาเสมอ)
   * @param {number} stationId รหัสจุดวัด
   * @param {Array<object>} rawRois ชุด ROI ใหม่
   * @param {object} context ข้อมูลผู้กระทำและขนาดภาพ
   * @param {import('../models/User.js').User} context.actor ผู้กระทำ
   * @param {string|null} [context.ip] หมายเลข IP
   * @param {string|null} [context.userAgent] เบราว์เซอร์ที่ใช้
   * @param {number} [context.imageWidth] ความกว้างภาพจริงที่ใช้วาด
   * @param {number} [context.imageHeight] ความสูงภาพจริงที่ใช้วาด
   * @returns {Promise<{rois: Array<Roi>, warnings: Array<string>}>}
   * @throws {ValidationError} เมื่อไม่มี ROI ชนิดวัดระดับ หรือข้อมูลไม่ถูกต้อง
   * @throws {NotFoundError} เมื่อไม่พบจุดวัด
   */
  async replaceForStation(stationId, rawRois, {
    actor, ip = null, userAgent = null, imageWidth, imageHeight,
  }) {
    this.#permissionService.assertStationAccess(actor, stationId);

    const station = await this.#stationRepository.findById(stationId);
    if (!station) throw new NotFoundError('ไม่พบจุดวัดที่ต้องการ');

    const resized = await this.#syncImageSize(station, imageWidth, imageHeight, {
      actor, ip, userAgent,
    });

    const rois = (rawRois ?? []).map((raw, index) => new Roi({
      stationId,
      name: raw.name,
      type: raw.type,
      points: raw.points,
      zones: raw.zones,
      sortOrder: index,
    }));

    if (!rois.some((roi) => roi.isMeasurement)) {
      throw new ValidationError('ต้องมี ROI ชนิดวัดระดับ (measurement) อย่างน้อย 1 กรอบ');
    }

    // เตือนเรื่องโซนแต่ไม่ห้ามบันทึก — ผู้ดูแลอาจกำลังค่อย ๆ ปรับแต่ง
    const warnings = rois.flatMap((roi) => roi.zoneIssues(station.imageHeight));
    warnings.push(...RoiService.#outOfFrameIssues(rois, station));
    if (resized) warnings.unshift(resized);

    const before = await this.#roiRepository.findByStation(stationId);

    // ROI กับจุดเทียบค่าที่สร้างจากโซนเป็นข้อมูลชุดเดียวกัน ต้องสำเร็จหรือล้มพร้อมกัน
    // ก่อนหน้านี้แยกกัน ถ้าขั้นที่สองล้ม ผู้ดูแลจะเห็นข้อความว่าบันทึกไม่สำเร็จ
    // ทั้งที่ ROI ถูกเขียนลงฐานข้อมูลไปแล้ว — สถานะครึ่ง ๆ กลาง ๆ ที่ไม่มีใครรู้ตัว
    const zones = rois.flatMap((roi) => (roi.isMeasurement ? roi.zones : []));
    const calibration = await this.#roiRepository.transaction(async () => {
      await this.#roiRepository.replaceForStation(stationId, rois);
      return this.#calibrationService.syncFromZones(stationId, zones, { actor, ip, userAgent });
    });

    this.#cache.forget(`zones:${stationId}`);
    warnings.push(...calibration.warnings);

    await this.#auditService.record({
      actorId: actor?.id ?? null, actorLabel: actor?.username ?? 'ระบบ',
      action: 'roi.write', resourceType: 'station', resourceId: stationId,
      beforeData: { roiCount: before.length },
      afterData: {
        roiCount: rois.length, warnings, calibrationFromZones: calibration.saved,
      },
      ip, userAgent,
    });

    return { rois: await this.#roiRepository.findByStation(stationId), warnings };
  }

  /**
   * หามุม ROI ที่หลุดออกนอกกรอบภาพ
   *
   * บริการตรวจจับตัดพิกัดที่เกินขอบทิ้งเงียบ ๆ กรอบที่หลุดออกไปจึงกลายเป็นกรอบที่เล็กลง
   * โดยไม่มีใครรู้ — เกิดได้ง่ายหลังสเกลพิกัดตามขนาดภาพใหม่ จึงต้องบอกให้ชัด
   *
   * @param {Array<Roi>} rois ชุด ROI
   * @param {import('../models/Station.js').Station} station จุดวัด
   * @returns {Array<string>}
   */
  static #outOfFrameIssues(rois, station) {
    const issues = [];
    for (const roi of rois) {
      const outside = roi.points.filter((point) => (
        point.x < 0 || point.y < 0 || point.x > station.imageWidth || point.y > station.imageHeight
      ));
      if (outside.length) {
        issues.push(
          `ROI "${roi.name}" มีมุมที่อยู่นอกกรอบภาพ ${outside.length} จุด `
          + `(ภาพขนาด ${station.imageWidth}×${station.imageHeight}) — `
          + 'ส่วนที่เกินจะถูกตัดทิ้งตอนตรวจจับ กรุณาลากมุมกลับเข้ามาในภาพ',
        );
      }
    }
    return issues;
  }

  /**
   * ปรับขนาดภาพต้นทางของจุดวัดให้ตรงกับภาพที่ใช้วาดจริง
   *
   * ⚠️ บริการตรวจจับใช้พิกัด ROI ทับเฟรมดิบตรง ๆ **ไม่มีการย่อขยาย** และไม่เคยอ่าน
   * `image_width` ที่เราส่งไป (ดู `app.py` — ไม่มีที่ไหนอ้างถึงเลย) ขนาดที่บันทึกไว้
   * จึงต้องเท่ากับขนาดสตรีมจริงเสมอ ไม่ใช่ค่าเริ่มต้นที่เดาไว้ตอนสร้างจุดวัด
   *
   * ยอมให้สิทธิ์ `roi.write` แก้ค่านี้ได้ เพราะพิกัด ROI กับขนาดภาพเป็นข้อมูลชุดเดียวกัน
   * — แยกให้คนละสิทธิ์แก้จะเปิดช่องให้เกิดสถานะที่พิกัดถูกแต่ขนาดผิด ซึ่งทำให้
   * ค่าที่วัดได้ผิดโดยไม่มีสัญญาณเตือน (`data/roi.html` เดิมก็ใช้ขนาดจากภาพจริงเสมอ)
   *
   * @param {import('../models/Station.js').Station} station จุดวัด
   * @param {number|undefined} width ความกว้างที่ส่งมา
   * @param {number|undefined} height ความสูงที่ส่งมา
   * @param {object} context ข้อมูลผู้กระทำ
   * @returns {Promise<string|null>} ข้อความแจ้งเมื่อมีการเปลี่ยน หรือ `null` เมื่อไม่เปลี่ยน
   * @throws {ValidationError} เมื่อขนาดที่ส่งมาไม่ถูกต้อง
   */
  async #syncImageSize(station, width, height, { actor, ip, userAgent }) {
    if (width === undefined && height === undefined) return null;

    const nextWidth = Number(width);
    const nextHeight = Number(height);
    const valid = (value) => Number.isInteger(value) && value >= 1 && value <= 8192;
    if (!valid(nextWidth) || !valid(nextHeight)) {
      throw new ValidationError('ขนาดภาพต้นทางต้องเป็นจำนวนเต็ม 1–8192 พิกเซล');
    }
    if (nextWidth === station.imageWidth && nextHeight === station.imageHeight) return null;

    const before = { imageWidth: station.imageWidth, imageHeight: station.imageHeight };
    await this.#stationRepository.update(station.id, {
      image_width: nextWidth, image_height: nextHeight,
    });
    station.resizeImage(nextWidth, nextHeight);

    await this.#auditService.record({
      actorId: actor?.id ?? null, actorLabel: actor?.username ?? 'ระบบ',
      action: 'station.update', resourceType: 'station', resourceId: station.id,
      beforeData: before,
      afterData: { imageWidth: nextWidth, imageHeight: nextHeight, source: 'roi-editor' },
      ip, userAgent,
    });

    return `ปรับขนาดภาพต้นทางของจุดวัดจาก ${before.imageWidth}×${before.imageHeight} `
      + `เป็น ${nextWidth}×${nextHeight} พิกเซล ให้ตรงกับภาพที่ใช้วาด`;
  }

  /**
   * นำเข้าไฟล์ config เดิม (version 2.0 หรือ 3.0)
   * @param {number} stationId รหัสจุดวัด
   * @param {object} config วัตถุ config ที่แปลงจาก JSON แล้ว
   * @param {{actor: import('../models/User.js').User, ip?: string|null, userAgent?: string|null}} context ข้อมูลผู้กระทำ
   * @returns {Promise<{rois: Array<Roi>, warnings: Array<string>}>}
   * @throws {ValidationError} เมื่ออ่าน ROI จากไฟล์ไม่ได้
   */
  async importLegacyConfig(stationId, config, context) {
    const rois = Roi.fromLegacy(config, stationId);
    if (!rois.length) {
      throw new ValidationError(
        'อ่าน ROI จากไฟล์นี้ไม่ได้ — รองรับเฉพาะไฟล์ config เวอร์ชัน 2.0 และ 3.0',
      );
    }
    return this.replaceForStation(
      stationId,
      rois.map((roi) => ({
        name: roi.name, type: roi.type, points: roi.points,
        zones: roi.zones.map((zone) => zone.toJSON()),
      })),
      context,
    );
  }

  /**
   * ส่งออก ROI เป็นโครงสร้าง config version 3.0 (เข้ากันได้กับเครื่องมือเดิม)
   * @param {number} stationId รหัสจุดวัด
   * @returns {Promise<object>}
   * @throws {NotFoundError} เมื่อไม่พบจุดวัด
   */
  async exportConfig(stationId) {
    const [station, rois] = await Promise.all([
      this.#stationRepository.findById(stationId),
      this.#roiRepository.findByStation(stationId),
    ]);
    if (!station) throw new NotFoundError('ไม่พบจุดวัดที่ต้องการ');

    return {
      version: '3.0',
      location_name: station.name,
      image_width: station.imageWidth,
      image_height: station.imageHeight,
      camera_url: station.cameraUrl,
      camera_type: station.cameraType,
      rois: rois.map((roi) => ({
        id: roi.id,
        name: roi.name,
        type: roi.type,
        points: roi.points,
        zones: roi.zones.map((zone) => ({
          name: zone.label,
          color_hex: zone.color.replace('#', ''),
          y_position: zone.yPosition,
        })),
      })),
      pdpa: {
        enabled: station.pdpaEnabled,
        method: station.pdpaMethod,
        conf_threshold: station.pdpaConfThreshold,
        blur_strength: station.pdpaBlurStrength,
      },
      exported_at: new Date().toISOString(),
    };
  }

  /**
   * ชุดโซนเริ่มต้นสำหรับจุดวัดที่ยังไม่เคยตั้งค่า
   * @param {number} imageHeight ความสูงภาพ
   * @returns {Array<object>}
   */
  defaultZones(imageHeight) {
    return Zone.defaults(imageHeight).map((zone) => zone.toJSON());
  }
}
