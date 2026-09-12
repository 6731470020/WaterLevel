import { AppError } from './AppError.js';

/** ข้อมูลชนกับที่มีอยู่แล้ว เช่น ชื่อผู้ใช้ซ้ำ → HTTP 409 */
export class ConflictError extends AppError {
  /** @param {string} [message='ข้อมูลนี้มีอยู่ในระบบแล้ว'] */
  constructor(message = 'ข้อมูลนี้มีอยู่ในระบบแล้ว') {
    super(message, 409, 'CONFLICT');
  }
}
