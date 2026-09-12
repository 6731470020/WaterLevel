import { AppError } from './AppError.js';

/** ใบอนุญาตใช้งานหมดอายุ → HTTP 402 */
export class LicenseExpiredError extends AppError {
  /** @param {string} [message='ใบอนุญาตใช้งานระบบหมดอายุแล้ว กรุณาติดต่อผู้ให้บริการ'] */
  constructor(message = 'ใบอนุญาตใช้งานระบบหมดอายุแล้ว กรุณาติดต่อผู้ให้บริการ') {
    super(message, 402, 'LICENSE_EXPIRED');
  }
}
