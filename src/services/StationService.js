import { BaseService } from '../core/BaseService.js';
import { LiveValue } from '../core/LiveValue.js';
import { NotFoundError, ConflictError, ValidationError } from '../core/errors/index.js';
import { Station } from '../models/Station.js';

/**
 * บริการจัดการจุดวัด
 *
 * ทุกเมท็อดที่ดึงข้อมูลหลายจุดวัดผ่าน `PermissionService.applyStationScope()` เสมอ
 * และเมท็อดที่แตะจุดวัดเดียวเรียก `assertStationAccess()` ก่อน — เป็นชั้นป้องกันที่ 2
 * ที่ไม่ขึ้นกับว่า route นั้นติดตั้ง middleware ครบหรือไม่
 */
export class StationService extends BaseService {
  /** @type {import('../repositories/StationRepository.js').StationRepository} */
  #stationRepository;
  /** @type {import('../repositories/CalibrationRepository.js').CalibrationRepository} */
  #calibrationRepository;
  /** @type {import('../repositories/RoiRepository.js').RoiRepository} */
  #roiRepository;
  /** @type {import('./PermissionService.js').PermissionService} */
  #permissionService;
  /** @type {import('./AuditService.js').AuditService} */
  #auditService;
  /** @type {() => boolean} */
  #allowPrivateCameraUrl;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../repositories/StationRepository.js').StationRepository} deps.stationRepository ที่เก็บจุดวัด
   * @param {import('../repositories/CalibrationRepository.js').CalibrationRepository} deps.calibrationRepository ที่เก็บจุดเทียบค่า
   * @param {import('../repositories/RoiRepository.js').RoiRepository} deps.roiRepository ที่เก็บ ROI
   * @param {import('./PermissionService.js').PermissionService} deps.permissionService บริการสิทธิ์
   * @param {import('./AuditService.js').AuditService} deps.auditService บริการบันทึกการใช้งาน
   * @param {boolean|(() => boolean)} [deps.allowPrivateCameraUrl=false] อนุญาต URL กล้องที่เป็น IP ภายในหรือไม่ (ส่งฟังก์ชันได้เพื่ออ่านค่าสด)
   * @param {import('../core/Logger.js').Logger} [deps.logger] ตัวบันทึกเหตุการณ์
   */
  constructor({
    stationRepository, calibrationRepository, roiRepository,
    permissionService, auditService, allowPrivateCameraUrl = false, logger,
  }) {
    super(stationRepository, logger);
    this.#stationRepository = stationRepository;
    this.#calibrationRepository = calibrationRepository;
    this.#roiRepository = roiRepository;
    this.#permissionService = permissionService;
    this.#auditService = auditService;
    // อ่านตอนใช้งานจริง — ค่านี้ตั้งได้จากหน้าเว็บและ `StationController`
    // ถือบริการนี้ไว้ตลอดอายุโปรเซส
    this.#allowPrivateCameraUrl = LiveValue.boolReader(allowPrivateCameraUrl, false);
  }

  /**
   * ค้นจุดวัดตามขอบเขตสิทธิ์ของผู้ใช้
   * @param {import('../models/User.js').User} user ผู้ใช้
   * @param {{search?: string, isActive?: boolean|null, limit?: number, offset?: number}} [filters={}] ตัวกรอง
   * @returns {Promise<{items: Array<Station>, total: number}>}
   */
  async list(user, filters = {}) {
    const scoped = this.#permissionService.applyStationScope(user, filters);
    return this.#stationRepository.search(scoped);
  }

  /**
   * ภาพรวมทุกจุดวัดพร้อมค่าวัดล่าสุด
   * @param {import('../models/User.js').User|null} user ผู้ใช้ (null = หน้าสาธารณะ)
   * @param {{activeOnly?: boolean}} [options={}] ตัวเลือก
   * @returns {Promise<Array<{station: Station, latest: object|null}>>}
   */
  async overview(user, { activeOnly = false } = {}) {
    const stationIds = user
      ? this.#permissionService.applyStationScope(user, {}).stationIds
      : null;
    return this.#stationRepository.findWithLatestMeasurement({ stationIds, activeOnly });
  }

  /**
   * ค้นจุดวัดด้วยรหัส พร้อมตรวจขอบเขตสิทธิ์
   * @param {import('../models/User.js').User} user ผู้ใช้
   * @param {number} stationId รหัสจุดวัด
   * @returns {Promise<Station>}
   * @throws {NotFoundError} เมื่อไม่พบหรืออยู่นอกขอบเขต
   */
  async findForUser(user, stationId) {
    this.#permissionService.assertStationAccess(user, stationId);
    const station = await this.#stationRepository.findById(stationId);
    if (!station) throw new NotFoundError('ไม่พบจุดวัดที่ต้องการ');
    return station;
  }

  /**
   * ค้นจุดวัดจาก slug (หน้าสาธารณะ ไม่ตรวจสิทธิ์)
   * @param {string} slug ชื่อย่อ
   * @returns {Promise<Station>}
   * @throws {NotFoundError} เมื่อไม่พบ
   */
  async findBySlug(slug) {
    const station = await this.#stationRepository.findBySlug(slug);
    if (!station) throw new NotFoundError('ไม่พบจุดวัดที่ต้องการ');
    return station;
  }

  /**
   * จุดวัดที่เปิดใช้งานทั้งหมด — ใช้โดยงานตามเวลา (ไม่มีผู้ใช้จึงไม่ตรวจสิทธิ์)
   * @returns {Promise<Array<Station>>}
   */
  async activeStations() {
    return this.#stationRepository.findActive();
  }

  /**
   * สร้างจุดวัดใหม่
   * @param {object} data ข้อมูลจุดวัด
   * @param {{actor: import('../models/User.js').User, ip?: string|null, userAgent?: string|null}} context ข้อมูลผู้กระทำ
   * @returns {Promise<Station>}
   * @throws {ConflictError} เมื่อ slug ซ้ำ
   * @throws {ValidationError} เมื่อข้อมูลไม่ถูกต้อง
   */
  async create(data, { actor, ip = null, userAgent = null }) {
    const station = new Station({ ...data, allowPrivateCameraUrl: this.#allowPrivateCameraUrl() });
    station.validate();

    if (await this.#stationRepository.slugTaken(station.slug)) {
      throw new ConflictError(`มีจุดวัดที่ใช้ชื่อย่อ "${station.slug}" อยู่แล้ว กรุณาเปลี่ยนชื่อย่อ`);
    }

    const saved = await this.#stationRepository.create(station);
    await this.#auditService.record({
      actorId: actor?.id ?? null, actorLabel: actor?.username ?? 'ระบบ',
      action: 'station.create', resourceType: 'station', resourceId: saved.id,
      afterData: saved.toJSON(), ip, userAgent,
    });
    return saved;
  }

  /**
   * แก้ไขจุดวัด
   * @param {number} stationId รหัสจุดวัด
   * @param {object} data ข้อมูลใหม่
   * @param {{actor: import('../models/User.js').User, ip?: string|null, userAgent?: string|null}} context ข้อมูลผู้กระทำ
   * @returns {Promise<Station>}
   * @throws {NotFoundError} เมื่อไม่พบหรืออยู่นอกขอบเขต
   * @throws {ConflictError} เมื่อ slug ซ้ำกับจุดวัดอื่น
   */
  async update(stationId, data, { actor, ip = null, userAgent = null }) {
    const existing = await this.findForUser(actor, stationId);
    const merged = new Station({
      ...existing.toJSON(), ...data, id: stationId,
      allowPrivateCameraUrl: this.#allowPrivateCameraUrl(),
      // `toJSON()` ไม่มีรหัสผ่านกล้องโดยเจตนา (กันรั่วออกนอกเซิร์ฟเวอร์) การรวมค่า
      // จึงต้องหยิบของเดิมมาเองเมื่อฟอร์มเว้นว่าง — ไม่งั้นแค่แก้ชื่อจุดวัด
      // รหัสผ่านกล้องก็หายไปเงียบ ๆ แล้วระบบดึงภาพไม่ได้อีกเลย
      cameraPassword: data.cameraPassword || existing.cameraPassword,
    });
    merged.validate();

    if (await this.#stationRepository.slugTaken(merged.slug, stationId)) {
      throw new ConflictError(`มีจุดวัดอื่นที่ใช้ชื่อย่อ "${merged.slug}" อยู่แล้ว`);
    }

    const saved = await this.#stationRepository.update(
      stationId, this.#stationRepository.toRow(merged),
    );
    await this.#auditService.record({
      actorId: actor?.id ?? null, actorLabel: actor?.username ?? 'ระบบ',
      action: 'station.update', resourceType: 'station', resourceId: stationId,
      beforeData: existing.toJSON(), afterData: saved.toJSON(), ip, userAgent,
    });
    return saved;
  }

  /**
   * เปิด/ปิดการใช้งานจุดวัด
   * @param {number} stationId รหัสจุดวัด
   * @param {boolean} isActive สถานะใหม่
   * @param {{actor: import('../models/User.js').User, ip?: string|null, userAgent?: string|null}} context ข้อมูลผู้กระทำ
   * @returns {Promise<Station>}
   */
  async setActive(stationId, isActive, { actor, ip = null, userAgent = null }) {
    const existing = await this.findForUser(actor, stationId);
    const saved = await this.#stationRepository.update(stationId, { is_active: isActive ? 1 : 0 });
    await this.#auditService.record({
      actorId: actor?.id ?? null, actorLabel: actor?.username ?? 'ระบบ',
      action: 'station.update', resourceType: 'station', resourceId: stationId,
      beforeData: { isActive: existing.isActive }, afterData: { isActive }, ip, userAgent,
    });
    return saved;
  }

  /**
   * ลบจุดวัด — ข้อมูลลูกทั้งหมดถูกลบตามด้วย Foreign Key แบบ cascade
   * @param {number} stationId รหัสจุดวัด
   * @param {{actor: import('../models/User.js').User, ip?: string|null, userAgent?: string|null}} context ข้อมูลผู้กระทำ
   * @returns {Promise<boolean>}
   * @throws {NotFoundError} เมื่อไม่พบหรืออยู่นอกขอบเขต
   */
  async delete(stationId, { actor, ip = null, userAgent = null }) {
    const existing = await this.findForUser(actor, stationId);
    const deleted = await this.#stationRepository.delete(stationId);
    if (deleted) {
      await this.#auditService.record({
        actorId: actor?.id ?? null, actorLabel: actor?.username ?? 'ระบบ',
        action: 'station.delete', resourceType: 'station', resourceId: stationId,
        beforeData: existing.toJSON(), ip, userAgent,
      });
    }
    return deleted;
  }

  /**
   * ความพร้อมของจุดวัด — ใช้เตือนผู้ดูแลว่ายังตั้งค่าไม่ครบ
   * @param {number} stationId รหัสจุดวัด
   * @returns {Promise<{ready: boolean, issues: Array<string>, calibrationCount: number, roiCount: number}>}
   */
  async readiness(stationId) {
    const [calibrationPoints, rois, station] = await Promise.all([
      this.#calibrationRepository.findByStation(stationId),
      this.#roiRepository.findByStation(stationId),
      this.#stationRepository.findById(stationId),
    ]);

    const issues = [];
    if (!station?.cameraUrl) issues.push('ยังไม่ได้ตั้งค่า URL กล้อง');
    if (calibrationPoints.length < 2) {
      issues.push(`ต้องมีจุดเทียบค่าอย่างน้อย 2 จุด (ตอนนี้มี ${calibrationPoints.length} จุด)`);
    }
    const measurementRoi = rois.find((roi) => roi.isMeasurement);
    if (!measurementRoi) issues.push('ยังไม่ได้วาด ROI ชนิดวัดระดับ');
    else issues.push(...measurementRoi.zoneIssues(station?.imageHeight ?? null));

    return {
      ready: issues.length === 0,
      issues,
      calibrationCount: calibrationPoints.length,
      roiCount: rois.length,
    };
  }
}
