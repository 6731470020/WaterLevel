import { NotImplementedError, AppError } from './errors/index.js';
import { Logger } from './Logger.js';

/**
 * คลาสฐานนามธรรมของชั้นนำเสนอ
 *
 * รวมรูปแบบตอบกลับ (ข้อ 9 ของ CLAUDE.md) และการดักข้อผิดพลาดของ handler แบบ async
 * ไว้ที่เดียว คลาสลูกเรียกได้แค่ Service ห้ามแตะ Repository หรือ SQL
 *
 * @abstract
 */
export class BaseController {
  /** @type {import('./BaseService.js').BaseService|null} */
  #service;
  /** @type {import('./Logger.js').Logger} */
  #logger;

  /**
   * @param {import('./BaseService.js').BaseService|null} [service=null] บริการหลักที่ควบคุม
   * @param {import('./Logger.js').Logger} [logger] ตัวบันทึกเหตุการณ์
   * @throws {NotImplementedError} เมื่อสร้างวัตถุจากคลาสนามธรรมโดยตรง
   */
  constructor(service = null, logger = Logger.getInstance()) {
    if (new.target === BaseController) {
      throw new NotImplementedError('BaseController เป็นคลาสนามธรรม สร้างวัตถุโดยตรงไม่ได้');
    }
    this.#service = service;
    this.#logger = logger;
  }

  /** @returns {import('./BaseService.js').BaseService|null} บริการหลัก */
  get service() { return this.#service; }

  /** @returns {import('./Logger.js').Logger} ตัวบันทึกเหตุการณ์ */
  get logger() { return this.#logger; }

  /**
   * ห่อเมท็อดของ Controller ให้ผูก `this` และส่งข้อผิดพลาดต่อไปยัง `ErrorMiddleware`
   *
   * ใช้กับทุกเส้นทาง:
   * `router.get('/x', controller.handle(controller.index))`
   *
   * @param {(req: object, res: object, next: Function) => Promise<void>} fn เมท็อดของ Controller
   * @returns {(req: object, res: object, next: Function) => void} handler สำหรับ Express
   */
  handle(fn) {
    if (typeof fn !== 'function') {
      throw new NotImplementedError(`${this.constructor.name}.handle() ต้องรับฟังก์ชัน`);
    }
    return (req, res, next) => {
      Promise.resolve(fn.call(this, req, res, next)).catch(next);
    };
  }

  /**
   * ตอบกลับสำเร็จในรูปแบบ JSON มาตรฐาน
   * @protected
   * @param {object} res วัตถุ response ของ Express
   * @param {*} [data=null] ข้อมูลที่ต้องการส่ง
   * @param {object|null} [meta=null] ข้อมูลประกอบ เช่น การแบ่งหน้า
   * @param {number} [statusCode=200] รหัสสถานะ HTTP
   */
  ok(res, data = null, meta = null, statusCode = 200) {
    const body = { success: true, data };
    if (meta) body.meta = meta;
    res.status(statusCode).json(body);
  }

  /**
   * ตอบกลับว่าสร้างข้อมูลใหม่สำเร็จ
   * @protected
   * @param {object} res วัตถุ response
   * @param {*} data ข้อมูลที่สร้าง
   */
  created(res, data) { this.ok(res, data, null, 201); }

  /**
   * ตอบกลับข้อผิดพลาดในรูปแบบ JSON มาตรฐาน
   * @protected
   * @param {object} res วัตถุ response
   * @param {Error} error ข้อผิดพลาด
   */
  fail(res, error) {
    const appError = error instanceof AppError
      ? error
      : new AppError('เกิดข้อผิดพลาดภายในระบบ', 500, 'INTERNAL_ERROR');
    res.status(appError.statusCode).json(appError.toJSON());
  }

  /**
   * ดึงหมายเลข IP ของผู้เรียก โดยเคารพส่วนหัว `X-Forwarded-For` เมื่ออยู่หลัง reverse proxy
   * @protected
   * @param {object} req วัตถุ request
   * @returns {string|null}
   */
  clientIp(req) {
    const forwarded = req.get?.('x-forwarded-for');
    if (forwarded) return String(forwarded).split(',')[0].trim().slice(0, 45);
    return (req.ip ?? req.socket?.remoteAddress ?? null)?.slice(0, 45) ?? null;
  }

  /**
   * บริบทของผู้กระทำสำหรับส่งให้ชั้น Service บันทึกลง audit log
   * @protected
   * @param {object} req วัตถุ request
   * @returns {{actor: import('../models/User.js').User|null, ip: string|null, userAgent: string|null}}
   */
  actorContext(req) {
    return {
      actor: req.user ?? null,
      ip: this.clientIp(req),
      userAgent: req.get?.('user-agent') ?? null,
    };
  }

  /**
   * แปลงพารามิเตอร์การแบ่งหน้าจาก query string
   * @protected
   * @param {object} query วัตถุ `req.query`
   * @param {number} [defaultSize=50] จำนวนต่อหน้าเริ่มต้น
   * @param {number} [maxSize=200] จำนวนต่อหน้าสูงสุด
   * @returns {{page: number, pageSize: number, offset: number}}
   */
  pagination(query, defaultSize = 50, maxSize = 200) {
    const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
    const requested = Number.parseInt(query.pageSize, 10) || defaultSize;
    const pageSize = Math.min(Math.max(1, requested), maxSize);
    return { page, pageSize, offset: (page - 1) * pageSize };
  }
}
