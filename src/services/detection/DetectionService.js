import { NotImplementedError } from '../../core/errors/index.js';

/**
 * คลาสนามธรรมของบริการตรวจจับผิวน้ำ (Strategy Pattern)
 *
 * **ตัวอย่างพหุสัณฐานที่ชัดที่สุดในโปรเจกต์** — `DetectJob` เรียก `detect(station)`
 * เหมือนกันทุกครั้ง แต่ได้พฤติกรรมต่างกันสิ้นเชิงระหว่าง `HttpDetectionService`
 * (เรียก API จริง) กับ `MockDetectionService` (ข้อมูลจำลอง)
 *
 * สลับด้วย `DETECTION_DRIVER=http|mock` ใน `.env` โดย**ไม่แก้โค้ดที่เรียกใช้เลย**
 * เพราะ `ServiceContainer` เป็นผู้ประกอบวัตถุให้ (CLAUDE.md ข้อ 12.1)
 *
 * @abstract
 */
export class DetectionService {
  /** @throws {NotImplementedError} เมื่อสร้างวัตถุจากคลาสนามธรรมโดยตรง */
  constructor() {
    if (new.target === DetectionService) {
      throw new NotImplementedError('DetectionService เป็นคลาสนามธรรม สร้างวัตถุโดยตรงไม่ได้');
    }
  }

  /**
   * ชื่อไดรเวอร์ — ใช้ใน log และหน้าสถานะระบบ
   * @abstract
   * @returns {string}
   * @throws {NotImplementedError} เมื่อคลาสลูกไม่ override
   */
  get driver() {
    throw new NotImplementedError(`${this.constructor.name} ต้อง override driver`);
  }

  /**
   * ตรวจจับตำแหน่งผิวน้ำของจุดวัดหนึ่งแห่ง
   * @abstract
   * @param {import('../../models/Station.js').Station} station จุดวัด
   * @param {Array<import('../../models/Roi.js').Roi>} [rois=[]] ขอบเขต ROI ของจุดวัด
   * @returns {Promise<import('./DetectionResult.js').DetectionResult>} ผลการตรวจจับ
   * @throws {NotImplementedError} เมื่อคลาสลูกไม่ override
   */
  async detect(station, rois = []) {
    throw new NotImplementedError(`${this.constructor.name} ต้อง override detect()`);
  }

  /**
   * ตรวจว่าบริการพร้อมใช้งานหรือไม่ — ใช้ใน `GET /health` และหน้าทดสอบการเชื่อมต่อ
   * @returns {Promise<{healthy: boolean, message: string}>}
   */
  async healthCheck() {
    return { healthy: true, message: `ไดรเวอร์ ${this.driver} พร้อมใช้งาน` };
  }
}
