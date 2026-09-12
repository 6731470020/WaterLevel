import { AppError } from './AppError.js';

/** ข้อมูลนำเข้าไม่ผ่านการตรวจสอบ → HTTP 422 */
export class ValidationError extends AppError {
  /**
   * @param {string} [message='ข้อมูลที่ส่งมาไม่ถูกต้อง']
   * @param {Array<{field: string, message: string}>} [details=[]]
   */
  constructor(message = 'ข้อมูลที่ส่งมาไม่ถูกต้อง', details = []) {
    super(message, 422, 'VALIDATION_ERROR', details);
  }
}
