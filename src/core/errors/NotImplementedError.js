import { AppError } from './AppError.js';

/**
 * เมท็อดนามธรรมยังไม่ถูก override หรือมีการสร้างวัตถุจากคลาสนามธรรมโดยตรง
 *
 * เป็นหัวใจของ "การนามธรรม" ในโปรเจกต์นี้ (ดู CLAUDE.md ข้อ 3.1)
 * ถือเป็นความผิดพลาดของโปรแกรมเมอร์ ไม่ใช่ของผู้ใช้ → HTTP 500
 */
export class NotImplementedError extends AppError {
  /** @param {string} [message='เมท็อดนี้ยังไม่ถูกพัฒนา'] */
  constructor(message = 'เมท็อดนี้ยังไม่ถูกพัฒนา') {
    super(message, 500, 'NOT_IMPLEMENTED');
  }
}
