import { AppError } from './AppError.js';

/**
 * ไม่พบทรัพยากร → HTTP 404
 *
 * ใช้กับด่าน `StationScopeMiddleware` ด้วย เพราะการตอบ 403 เป็นการยืนยันว่า ID นั้น
 * มีอยู่จริง ซึ่งเปิดช่องให้ไล่เดา ID ได้ (ดู CLAUDE.md ข้อ 8.4)
 */
export class NotFoundError extends AppError {
  /** @param {string} [message='ไม่พบข้อมูลที่ต้องการ'] */
  constructor(message = 'ไม่พบข้อมูลที่ต้องการ') {
    super(message, 404, 'NOT_FOUND');
  }
}
