import { BaseService } from '../core/BaseService.js';
import { ValidationError } from '../core/errors/index.js';
import { CalibrationPoint } from '../models/CalibrationPoint.js';
import { ZoneLevel } from '../models/values/ZoneLevel.js';
import { PixelLevel } from '../models/values/PixelLevel.js';
import { WaterLevelCalculator } from './WaterLevelCalculator.js';

/**
 * บริการจัดการจุดเทียบค่าพิกเซล↔เมตร
 *
 * เป็นจุดเดียวที่สร้าง `WaterLevelCalculator` ให้ส่วนอื่นของระบบใช้ ทำให้ตรรกะการแปลงค่า
 * มีที่มาที่เดียว — ต่างจากระบบเดิมที่คัดลอก `pixelToMeter()` ไว้ 4 ไฟล์
 * พร้อมค่าสำรองฮาร์ดโค้ดที่ทำให้รายงานผิดแบบเงียบ ๆ
 */
export class CalibrationService extends BaseService {
  /** @type {import('../repositories/CalibrationRepository.js').CalibrationRepository} */
  #calibrationRepository;
  /** @type {import('./PermissionService.js').PermissionService} */
  #permissionService;
  /** @type {import('./AuditService.js').AuditService} */
  #auditService;
  /** @type {import('../core/MemoryCache.js').MemoryCache} */
  #cache;
  /** @type {import('../repositories/MeasurementRepository.js').MeasurementRepository|null} */
  #measurementRepository;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../repositories/CalibrationRepository.js').CalibrationRepository} deps.calibrationRepository ที่เก็บจุดเทียบค่า
   * @param {import('./PermissionService.js').PermissionService} deps.permissionService บริการสิทธิ์
   * @param {import('./AuditService.js').AuditService} deps.auditService บริการบันทึกการใช้งาน
   * @param {import('../core/MemoryCache.js').MemoryCache} deps.cache แคชในหน่วยความจำ
   * @param {import('../core/Logger.js').Logger} [deps.logger] ตัวบันทึกเหตุการณ์
   */
  constructor({
    calibrationRepository, permissionService, auditService, cache, measurementRepository, logger,
  }) {
    super(calibrationRepository, logger);
    this.#calibrationRepository = calibrationRepository;
    this.#permissionService = permissionService;
    this.#auditService = auditService;
    this.#cache = cache;
    this.#measurementRepository = measurementRepository ?? null;
  }

  /**
   * จุดเทียบค่าทั้งหมดของจุดวัด
   * @param {number} stationId รหัสจุดวัด
   * @returns {Promise<Array<CalibrationPoint>>}
   */
  async listForStation(stationId) {
    return this.#calibrationRepository.findByStation(stationId);
  }

  /**
   * สร้างตัวคำนวณของจุดวัด (ผ่านแคช 60 วินาที)
   *
   * @param {number} stationId รหัสจุดวัด
   * @returns {Promise<WaterLevelCalculator>}
   * @throws {ValidationError} เมื่อจุดเทียบค่าไม่ครบ 2 จุด — **ไม่มีค่าสำรอง**
   */
  async calculatorFor(stationId) {
    const points = await this.#cache.remember(
      `calibration:${stationId}`,
      async () => {
        const list = await this.#calibrationRepository.findByStation(stationId);
        return list.map((point) => ({ pixel: point.pixelValue, meter: point.meterValue }));
      },
      60 * 1000,
    );
    return new WaterLevelCalculator(points);
  }

  /**
   * สร้างตัวคำนวณ หรือคืน null เมื่อจุดเทียบค่าไม่พอ
   *
   * ใช้ในที่ที่ยอมให้ไม่มีค่าเมตรได้ เช่น การแสดงผลย้อนหลัง — **ไม่ใช่**การบันทึกค่าใหม่
   *
   * @param {number} stationId รหัสจุดวัด
   * @returns {Promise<WaterLevelCalculator|null>}
   */
  async tryCalculatorFor(stationId) {
    try {
      return await this.calculatorFor(stationId);
    } catch {
      return null;
    }
  }

  /**
   * แทนที่จุดเทียบค่าของจุดวัดทั้งชุด
   * @param {number} stationId รหัสจุดวัด
   * @param {Array<{pixel: number, meter: number}>} rawPoints จุดเทียบค่าชุดใหม่
   * @param {{actor: import('../models/User.js').User, ip?: string|null, userAgent?: string|null}} context ข้อมูลผู้กระทำ
   * @returns {Promise<Array<CalibrationPoint>>} จุดเทียบค่าหลังบันทึก
   * @throws {ValidationError} เมื่อจุดไม่ครบ 2 จุด มีพิกเซลซ้ำ หรือค่าเมตรไม่สอดคล้องทิศทางแกน
   */
  async replaceForStation(stationId, rawPoints, { actor, ip = null, userAgent = null }) {
    this.#permissionService.assertStationAccess(actor, stationId);

    const points = (rawPoints ?? [])
      .filter((raw) => raw && raw.pixel !== '' && raw.meter !== '')
      .map((raw, index) => new CalibrationPoint({
        stationId, pixel: raw.pixel, meter: raw.meter, sortOrder: index + 1,
      }));

    const existing = await this.#calibrationRepository.findByStation(stationId);
    const fromZones = existing.filter((point) => point.isFromZone);

    // นับรวมจุดที่มาจากโซนด้วย — ผู้ดูแลอาจใช้โซนล้วนแล้วไม่กรอกจุดเองเลย
    if (points.length + fromZones.length < 2) {
      throw new ValidationError(
        'ต้องมีจุดเทียบค่าอย่างน้อย 2 จุด ระบบจึงจะแปลงพิกเซลเป็นเมตรได้ '
        + '(นับรวมจุดที่ระบบสร้างจากโซนเตือนภัยให้อัตโนมัติ)',
      );
    }

    const pixels = points.map((point) => point.pixelValue);
    if (new Set(pixels).size !== pixels.length) {
      throw new ValidationError('มีค่าพิกเซลซ้ำกัน กรุณาตรวจสอบจุดเทียบค่าอีกครั้ง');
    }

    const zonePixels = new Map(fromZones.map((point) => [point.pixelValue, point]));
    const clash = points.find((point) => zonePixels.has(point.pixelValue));
    if (clash) {
      const owner = zonePixels.get(clash.pixelValue);
      throw new ValidationError(
        `พิกเซล ${clash.pixelValue} เป็นของโซน "${ZoneLevel.parse(owner.zoneKey)?.label ?? owner.zoneKey}" อยู่แล้ว `
        + '— แก้ค่าระดับน้ำของโซนนั้นในเครื่องมือวาด ROI แทนการเพิ่มจุดซ้ำที่นี่',
      );
    }

    // สร้างตัวคำนวณทันทีเพื่อให้ข้อผิดพลาดปรากฏก่อนบันทึก ไม่ใช่ตอนถึงเวลาวัดจริง
    // ใช้ชุดรวม (กรอกเอง + จากโซน) เพราะนั่นคือสิ่งที่ตอนวัดจริงจะใช้
    const calculator = new WaterLevelCalculator(
      [...points, ...fromZones]
        .map((point) => ({ pixel: point.pixelValue, meter: point.meterValue })),
    );

    for (const warning of CalibrationService.inspectDirection(calculator.points)) {
      this.logger.warn('calibration direction warning', { stationId, warning });
    }

    const before = existing;
    await this.#calibrationRepository.replaceForStation(stationId, points);
    this.#cache.forget(`calibration:${stationId}`);

    await this.#auditService.record({
      actorId: actor?.id ?? null, actorLabel: actor?.username ?? 'ระบบ',
      action: 'calibration.write', resourceType: 'station', resourceId: stationId,
      beforeData: { points: before.map((point) => point.toJSON()) },
      afterData: { points: points.map((point) => point.toJSON()) },
      ip, userAgent,
    });

    // ค่าวัดที่บันทึกไว้ก่อนมีจุดเทียบค่าจะได้ค่าเมตรย้อนหลังทันที
    await this.backfillMeters(stationId);

    return this.#calibrationRepository.findByStation(stationId);
  }

  /**
   * สร้างจุดเทียบค่าจากโซนเตือนภัยให้อัตโนมัติ
   *
   * ขอบบนของโซนคือพิกเซล Y ที่ผู้ดูแลรู้ระดับน้ำจริงอยู่แล้ว เช่น "โซนวิกฤตมาก
   * เริ่มที่ 2.50 เมตร" — เป็นข้อมูลชุดเดียวกับจุดเทียบค่าทุกประการ เดิมต้องกรอก
   * เลขชุดเดิมซ้ำสองที่ ซึ่งนอกจากเสียเวลาแล้วยังเสี่ยงกรอกไม่ตรงกันจนคำนวณเพี้ยน
   *
   * เรียกจาก `RoiService.replaceForStation()` ทุกครั้งที่บันทึก ROI
   * ไม่โยนข้อผิดพลาดเมื่อโซนยังไม่ครบ — คืนคำเตือนกลับไปแทน เพราะผู้ดูแล
   * อาจกำลังค่อย ๆ ปรับแต่ง และการบันทึก ROI ไม่ควรถูกบล็อกด้วยเรื่องเทียบค่า
   *
   * @param {number} stationId รหัสจุดวัด
   * @param {Array<import('../models/Zone.js').Zone>} zones โซนทั้งหมดของจุดวัด
   * @param {{actor: import('../models/User.js').User, ip?: string|null, userAgent?: string|null}} context ข้อมูลผู้กระทำ
   * @returns {Promise<{saved: number, warnings: Array<string>}>}
   */
  async syncFromZones(stationId, zones, { actor, ip = null, userAgent = null }) {
    const warnings = [];
    const usable = (zones ?? []).filter((zone) => zone.hasCalibration);

    // โซนสองโซนอยู่พิกเซลเดียวกันไม่ได้ (ตาราง UNIQUE `(station_id, pixel)`)
    // `Zone.findIssues()` เตือนไว้แล้ว ที่นี่แค่กันไม่ให้ธุรกรรมล้ม
    const seen = new Set();
    const points = [];
    for (const zone of [...usable].sort((a, b) => a.severity - b.severity)) {
      if (seen.has(zone.yPosition)) {
        warnings.push(
          `ข้ามโซน "${zone.label}" — พิกเซล ${zone.yPosition} ถูกโซนอื่นใช้ไปแล้ว`,
        );
        continue;
      }
      seen.add(zone.yPosition);
      points.push(new CalibrationPoint({
        stationId, pixel: zone.yPosition, meter: zone.meterLevel, zoneKey: zone.key,
      }));
    }

    // เติมค่าไม่ครบเป็นสาเหตุที่ผู้ดูแลงงบ่อยที่สุด — กรอกไป 5 จาก 6 โซนแล้วเห็น
    // จุดเทียบค่าแค่ 5 จุดโดยไม่มีอะไรบอกว่าโซนไหนหายไป จึงต้องระบุชื่อให้ชัด
    const missing = (zones ?? []).filter((zone) => !zone.hasCalibration);
    if (missing.length && usable.length) {
      warnings.push(
        `ยังไม่ได้ใส่ระดับน้ำให้โซน ${missing.map((zone) => `"${zone.label}"`).join(', ')} `
        + `จึงได้จุดเทียบค่า ${usable.length} จุดจากทั้งหมด ${zones.length} โซน`,
      );
    }

    const before = await this.#calibrationRepository.findByStation(stationId);
    const { saved, replacedManual } = await this.#calibrationRepository
      .syncZonePoints(stationId, points);
    this.#cache.forget(`calibration:${stationId}`);

    if (replacedManual.length) {
      warnings.push(
        `จุดเทียบค่าที่กรอกเองไว้ที่พิกเซล ${replacedManual.join(', ')} `
        + 'ถูกแทนด้วยค่าจากโซนที่อยู่ตำแหน่งเดียวกัน',
      );
    }

    const after = await this.#calibrationRepository.findByStation(stationId);
    if (after.length < 2) {
      warnings.push(
        `ยังมีจุดเทียบค่าเพียง ${after.length} จุด — ต้องมีอย่างน้อย 2 จุดจึงจะวัดระดับน้ำได้ `
        + 'ใส่ค่าระดับน้ำ (เมตร) ให้โซนอย่างน้อย 2 โซน หรือเพิ่มจุดเทียบค่าเอง',
      );
    } else {
      warnings.push(...CalibrationService.inspectDirection(
        after.map((point) => ({ pixel: point.pixelValue, meter: point.meterValue })),
      ));
    }

    // บันทึกเฉพาะเมื่อมีการเปลี่ยนแปลงจริง — ไม่งั้น audit log จะเต็มไปด้วยแถวซ้ำ
    // ทุกครั้งที่ผู้ดูแลกดบันทึก ROI โดยไม่ได้แตะโซนเลย
    if (CalibrationService.#differs(before, after)) {
      await this.#auditService.record({
        actorId: actor?.id ?? null, actorLabel: actor?.username ?? 'ระบบ',
        action: 'calibration.write', resourceType: 'station', resourceId: stationId,
        beforeData: { points: before.map((point) => point.toJSON()) },
        afterData: { points: after.map((point) => point.toJSON()), source: 'zones' },
        ip, userAgent,
      });
    }

    const backfilled = await this.backfillMeters(stationId, usable);
    if (backfilled) {
      warnings.push(`คำนวณระดับน้ำเป็นเมตรย้อนหลังให้ค่าวัดเดิม ${backfilled} รายการแล้ว`);
    }

    return { saved, warnings };
  }

  /**
   * เทียบว่าจุดเทียบค่าสองชุดต่างกันหรือไม่
   * @param {Array<CalibrationPoint>} before ชุดก่อน
   * @param {Array<CalibrationPoint>} after ชุดหลัง
   * @returns {boolean}
   */
  static #differs(before, after) {
    /**
     * ย่อชุดจุดให้เป็นสตริงเดียวเพื่อเทียบ
     * @param {Array<CalibrationPoint>} points ชุดจุด
     * @returns {string}
     */
    const fingerprint = (points) => points
      .map((point) => `${point.pixelValue}:${point.meterValue}:${point.zoneKey ?? ''}`)
      .sort()
      .join('|');
    return fingerprint(before) !== fingerprint(after);
  }

  /**
   * คำนวณค่าเมตรย้อนหลังให้ค่าวัดที่ยังไม่มี
   *
   * ค่าเมตรถูกคำนวณ ณ ตอนบันทึก ถ้าตอนนั้นจุดวัดยังไม่มีจุดเทียบค่า แถวนั้นจะค้าง
   * เป็น NULL ตลอดไปทั้งที่ภายหลังตั้งจุดเทียบค่าแล้ว — หน้าเว็บจึงแสดง
   * "ยังไม่มีค่าเป็นเมตร" ทั้งที่ข้อมูลพอจะคำนวณได้ เรียกทุกครั้งที่จุดเทียบค่าเปลี่ยน
   *
   * ไม่โยนข้อผิดพลาด — งานนี้เป็นการเก็บกวาด ไม่ควรทำให้การบันทึกจุดเทียบค่าล้ม
   *
   * @param {number} stationId รหัสจุดวัด
   * @param {Array<import('../models/Zone.js').Zone>} [zones] โซนสำหรับตัดสิน `zone_key`
   * @returns {Promise<number>} จำนวนแถวที่คำนวณให้
   */
  async backfillMeters(stationId, zones = []) {
    if (!this.#measurementRepository) return 0;

    try {
      const calculator = await this.tryCalculatorFor(stationId);
      if (!calculator) return 0;

      const rows = await this.#measurementRepository.findWithoutMeters(stationId);
      if (!rows.length) return 0;

      const updates = rows.map((row) => {
        const pixel = new PixelLevel(row.water_line);
        const update = { id: row.id, meter: calculator.pixelToMeter(pixel.value).value };
        // ใส่ `zoneKey` เฉพาะเมื่อมีโซนให้ตัดสิน — ไม่งั้นปล่อยให้โซนเดิมคงไว้
        if (zones.length) update.zoneKey = ZoneLevel.resolve(pixel, zones)?.key ?? null;
        return update;
      });

      const changed = await this.#measurementRepository.applyMeters(updates);
      this.logger.info('backfilled water level metres', { stationId, rows: changed });
      return changed;
    } catch (error) {
      this.logger.warn('cannot backfill water level metres', {
        stationId, message: error.message,
      });
      return 0;
    }
  }

  /**
   * ทดสอบแปลงค่าสด — ใช้ในหน้าตั้งค่าเทียบค่า
   * @param {number} stationId รหัสจุดวัด
   * @param {number} pixel ค่าพิกเซลที่ต้องการทดสอบ
   * @returns {Promise<{pixel: number, meter: number}>}
   * @throws {ValidationError} เมื่อจุดเทียบค่าไม่ครบ
   */
  async testConversion(stationId, pixel) {
    const calculator = await this.calculatorFor(stationId);
    return { pixel: Number(pixel), meter: calculator.pixelToMeter(pixel).value };
  }

  /**
   * ตรวจว่าจุดเทียบค่าสอดคล้องกับทิศทางแกน Y หรือไม่
   *
   * พิกเซลน้อย = น้ำสูง ดังนั้นเมื่อเรียงพิกเซลจากน้อยไปมาก ค่าเมตรควรลดลง
   * ถ้าเพิ่มขึ้นแสดงว่าผู้ดูแลอาจกรอกสลับกัน — เตือนแต่ไม่ห้าม เพราะบางเสาวัดอาจติดกลับด้าน
   *
   * @param {Array<{pixel: number, meter: number}>} points จุดเทียบค่าที่เรียงแล้ว
   * @returns {Array<string>} คำเตือนภาษาไทย
   */
  static inspectDirection(points) {
    const warnings = [];
    for (let i = 1; i < points.length; i += 1) {
      if (points[i].meter > points[i - 1].meter) {
        warnings.push(
          `จุดเทียบค่าพิกเซล ${points[i - 1].pixel}→${points[i].pixel} ให้ค่าเมตรเพิ่มขึ้น ` +
          `(${points[i - 1].meter}→${points[i].meter}) ` +
          'ปกติพิกเซลที่มากกว่าควรหมายถึงน้ำต่ำกว่า กรุณาตรวจสอบว่ากรอกสลับกันหรือไม่',
        );
      }
    }
    return warnings;
  }
}
