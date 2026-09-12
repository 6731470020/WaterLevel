import { BaseMiddleware } from '../core/BaseMiddleware.js';
import { NotFoundError, UnauthorizedError, ValidationError } from '../core/errors/index.js';

/**
 * **ด่านที่ 4** — ตรวจว่าจุดวัดที่ขอถึงอยู่ในขอบเขตของผู้ใช้
 *
 * ตอบคำถาม: "คนคนนี้ได้รับมอบหมายให้ดูแลจุดวัดนี้หรือไม่?"
 * ปฏิเสธด้วย **404 NOT_FOUND** ไม่ใช่ 403
 *
 * **เหตุผลที่ตอบ 404** — การตอบ 403 เป็นการยืนยันว่ารหัสจุดวัดนั้นมีอยู่จริง
 * ผู้ใช้ที่มีสิทธิ์แค่จุดวัดเดียวจึงไล่ยิงรหัส 1, 2, 3, … แล้วแยกได้ว่าจุดวัดใดมีอยู่บ้าง
 * การตอบ 404 ทำให้ "ไม่มีจุดวัดนี้" กับ "มีแต่คุณเข้าไม่ได้" แยกจากกันไม่ออก
 * (CLAUDE.md ข้อ 8.4)
 */
export class StationScopeMiddleware extends BaseMiddleware {
  /** @type {import('../services/PermissionService.js').PermissionService} */
  #permissionService;

  /**
   * @param {import('../services/PermissionService.js').PermissionService} permissionService บริการสิทธิ์
   * @param {import('../core/Logger.js').Logger} [logger] ตัวบันทึกเหตุการณ์
   */
  constructor(permissionService, logger) {
    super(logger);
    this.#permissionService = permissionService;
  }

  /**
   * คืน handler ที่อ่านรหัสจุดวัดจากพารามิเตอร์ใน URL
   * @param {string} [paramName='id'] ชื่อพารามิเตอร์
   * @returns {(req: object, res: object, next: Function) => void}
   */
  fromParam(paramName = 'id') {
    return this.handle({ source: 'params', key: paramName });
  }

  /**
   * คืน handler ที่อ่านรหัสจุดวัดจาก query string (ไม่บังคับว่าต้องมี)
   * @param {string} [key='stationId'] ชื่อพารามิเตอร์
   * @returns {(req: object, res: object, next: Function) => void}
   */
  fromQuery(key = 'stationId') {
    return this.handle({ source: 'query', key, optional: true });
  }

  /**
   * คืน handler ที่อ่านรหัสจุดวัดจากเนื้อคำขอ
   * @param {string} [key='stationId'] ชื่อฟิลด์
   * @param {boolean} [optional=false] ไม่บังคับว่าต้องมีหรือไม่
   * @returns {(req: object, res: object, next: Function) => void}
   */
  fromBody(key = 'stationId', optional = false) {
    return this.handle({ source: 'body', key, optional });
  }

  /**
   * ตรวจขอบเขตจุดวัด
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @param {{source: string, key: string, optional?: boolean}} options ตัวเลือก
   * @returns {Promise<void>}
   * @throws {UnauthorizedError} เมื่อยังไม่ผ่านด่านยืนยันตัวตน
   * @throws {ValidationError} เมื่อรหัสจุดวัดไม่ใช่ตัวเลข
   * @throws {NotFoundError} เมื่อจุดวัดอยู่นอกขอบเขต
   */
  async check(req, res, options) {
    const user = req.user;
    if (!user) throw new UnauthorizedError();

    const raw = req[options.source]?.[options.key];

    if (raw === undefined || raw === null || raw === '') {
      if (options.optional) return;
      throw new ValidationError('ต้องระบุจุดวัด');
    }

    const stationId = Number(raw);
    if (!Number.isInteger(stationId) || stationId <= 0) {
      throw new ValidationError('รหัสจุดวัดไม่ถูกต้อง');
    }

    if (!this.#permissionService.canAccessStation(user, stationId)) {
      this.logger.warn('station scope denied', {
        userId: user.id, stationId, path: req.path,
      });
      // ตอบ 404 โดยเจตนา — ห้ามยืนยันว่ารหัสนี้มีอยู่จริง
      throw new NotFoundError('ไม่พบจุดวัดที่ต้องการ');
    }

    req.stationId = stationId;
  }
}
