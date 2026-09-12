import { BaseMiddleware } from '../core/BaseMiddleware.js';
import { AppError, NotFoundError } from '../core/errors/index.js';

/**
 * ตัวจัดการข้อผิดพลาดรวมของทั้งระบบ — ด่านสุดท้ายของสาย middleware
 *
 * แปลงลำดับชั้น `AppError` เป็นรหัส HTTP และรูปแบบคำตอบที่ถูกต้องโดยอัตโนมัติ
 * ทำให้ Controller ไม่ต้องเขียน try/catch เอง (เกณฑ์ตรวจรับข้อ 19)
 *
 * ข้อผิดพลาดที่ไม่ใช่ `AppError` ถือเป็นบั๊ก — บันทึกเต็มรูปแบบลง log
 * แต่ตอบผู้ใช้เพียงข้อความกลาง ๆ เพื่อไม่ให้รั่วรายละเอียดภายในระบบ
 */
export class ErrorMiddleware extends BaseMiddleware {
  /** @type {boolean} */
  #isProduction;

  /**
   * @param {boolean} isProduction อยู่ในโหมดใช้งานจริงหรือไม่
   * @param {import('../core/Logger.js').Logger} [logger] ตัวบันทึกเหตุการณ์
   */
  constructor(isProduction, logger) {
    super(logger);
    this.#isProduction = isProduction;
  }

  /**
   * ด่านนี้ไม่ใช้ `check()` เพราะ Express เรียก error handler ด้วยลายเซ็น 4 พารามิเตอร์
   * @param {object} req วัตถุ request
   * @returns {Promise<void>}
   */
  async check(req) { /* ไม่ใช้ — ดู handler() */ }

  /**
   * คืน handler สำหรับเส้นทางที่ไม่มีอยู่ (404)
   * @returns {(req: object, res: object, next: Function) => void}
   */
  notFound() {
    return (req, res, next) => {
      next(new NotFoundError('ไม่พบหน้าที่คุณเรียก'));
    };
  }

  /**
   * คืน error handler ของ Express (ต้องมี 4 พารามิเตอร์ Express จึงจะรู้จัก)
   * @returns {(error: Error, req: object, res: object, next: Function) => void}
   */
  handler() {
    return (error, req, res, next) => {
      if (res.headersSent) {
        next(error);
        return;
      }

      const appError = error instanceof AppError
        ? error
        : new AppError('เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง', 500, 'INTERNAL_ERROR');

      this.#log(appError, error, req);

      if (this.wantsJson(req)) {
        res.status(appError.statusCode).json({
          ...appError.toJSON(),
          requestId: req.requestId ?? undefined,
        });
        return;
      }

      // ใบอนุญาตหมดอายุบนหน้าเว็บ → พาไปหน้าแจ้งเตือนเฉพาะ
      if (appError.code === 'LICENSE_EXPIRED') {
        res.redirect('/license-expired');
        return;
      }
      // ยังไม่เข้าสู่ระบบบนหน้าเว็บ → พาไปหน้าเข้าสู่ระบบ
      if (appError.statusCode === 401) {
        res.redirect(`/login?next=${encodeURIComponent(req.originalUrl ?? '/admin')}`);
        return;
      }

      // ส่งค่าที่หน้า error ต้องใช้ให้ครบเสมอ ไม่พึ่ง res.locals ซึ่งอาจยังไม่ถูกตั้ง
      // เมื่อคำขอล้มเหลวตั้งแต่ชั้นอ่านเนื้อคำขอ
      res.status(appError.statusCode).render('error', {
        title: ErrorMiddleware.#titleFor(appError.statusCode),
        statusCode: appError.statusCode,
        message: appError.message,
        details: appError.details,
        requestId: req.requestId ?? null,
        stack: this.#isProduction ? null : error.stack,
      }, (renderError, html) => {
        if (!renderError) { res.send(html); return; }

        // ทางถอยสุดท้าย — หน้าแสดงข้อผิดพลาดเองก็เรนเดอร์ไม่ได้
        // ห้ามปล่อยให้ Express ตอบด้วย stack trace เพราะจะเผยพาธจริงของเซิร์ฟเวอร์
        this.logger.error('failed to render error page', renderError);
        res.type('text/plain; charset=utf-8').send(
          `${appError.statusCode} — ${appError.message}\n` +
          (req.requestId ? `รหัสอ้างอิงคำขอ: ${req.requestId}\n` : ''),
        );
      });
    };
  }

  /**
   * บันทึกข้อผิดพลาดตามระดับความรุนแรง
   * @param {AppError} appError ข้อผิดพลาดที่แปลงแล้ว
   * @param {Error} original ข้อผิดพลาดต้นฉบับ
   * @param {object} req วัตถุ request
   */
  #log(appError, original, req) {
    const context = {
      requestId: req.requestId ?? null,
      method: req.method,
      path: req.path,
      code: appError.code,
      userId: req.user?.id ?? null,
    };

    if (appError.isExpected) {
      this.logger.warn(`request rejected: ${appError.message}`, context);
    } else {
      this.logger.error('unhandled error', {
        ...context,
        error: original.message,
        stack: original.stack,
      });
    }
  }

  /**
   * หัวข้อหน้าแสดงข้อผิดพลาดตามรหัสสถานะ
   * @param {number} statusCode รหัสสถานะ HTTP
   * @returns {string}
   */
  static #titleFor(statusCode) {
    const titles = {
      400: 'คำขอไม่ถูกต้อง',
      401: 'กรุณาเข้าสู่ระบบ',
      402: 'ใบอนุญาตหมดอายุ',
      403: 'ไม่มีสิทธิ์เข้าถึง',
      404: 'ไม่พบหน้าที่ต้องการ',
      409: 'ข้อมูลซ้ำ',
      422: 'ข้อมูลไม่ถูกต้อง',
      429: 'คำขอถี่เกินไป',
      502: 'บริการภายนอกขัดข้อง',
    };
    return titles[statusCode] ?? 'เกิดข้อผิดพลาด';
  }
}
