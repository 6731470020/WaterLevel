import { AppError } from './AppError.js';

/** ส่งคำขอถี่เกินกำหนด → HTTP 429 */
export class RateLimitedError extends AppError {
  /** @param {string} [message='คำขอถี่เกินไป กรุณารอสักครู่แล้วลองใหม่'] */
  constructor(message = 'คำขอถี่เกินไป กรุณารอสักครู่แล้วลองใหม่') {
    super(message, 429, 'RATE_LIMITED');
  }
}
