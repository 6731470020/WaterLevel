import { AppError } from './AppError.js';

/** เข้าสู่ระบบแล้วแต่ไม่มีสิทธิ์ → HTTP 403 */
export class ForbiddenError extends AppError {
  /** @param {string} [message='คุณไม่มีสิทธิ์ใช้งานส่วนนี้'] */
  constructor(message = 'คุณไม่มีสิทธิ์ใช้งานส่วนนี้') {
    super(message, 403, 'FORBIDDEN');
  }
}
