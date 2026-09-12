import { AppError } from './AppError.js';

/** ยังไม่ได้เข้าสู่ระบบ หรือ session หมดอายุ → HTTP 401 */
export class UnauthorizedError extends AppError {
  /** @param {string} [message='กรุณาเข้าสู่ระบบก่อนใช้งาน'] */
  constructor(message = 'กรุณาเข้าสู่ระบบก่อนใช้งาน') {
    super(message, 401, 'UNAUTHORIZED');
  }
}
