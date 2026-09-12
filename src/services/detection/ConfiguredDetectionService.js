import { DetectionService } from './DetectionService.js';
import { LazyRebuild } from '../../core/LazyRebuild.js';

/**
 * บริการตรวจจับที่ประกอบตัวเองใหม่เมื่อค่าตั้งค่าเปลี่ยน (Decorator + Lazy Factory)
 *
 * `DetectJob`, `HealthCheckJob` และ `DashboardController` รับบริการตรวจจับเข้ามาทาง
 * constructor แล้วถืออ้างอิงเดิมไว้ตลอดอายุโปรเซส เมื่อผู้ดูแลสลับ `DETECTION_DRIVER`
 * จาก `mock` เป็น `http` หรือแก้ URL ในหน้าเว็บ วัตถุที่ถืออยู่จะยังเป็นตัวเก่า
 * จนกว่าจะรีสตาร์ต — คลาสนี้ปิดช่องนั้น
 *
 * เป็นตัวแทนที่หน้าตาเหมือนบริการตรวจจับทุกประการ ผู้เรียกไม่รู้เรื่องและไม่ต้องแก้อะไร
 * — พหุสัณฐานยังทำงานเหมือนเดิม เพียงแต่ตัวจริงที่อยู่ข้างในเปลี่ยนได้ระหว่างทาง
 */
export class ConfiguredDetectionService extends DetectionService {
  /** @type {LazyRebuild<DetectionService>} */
  #holder;

  /**
   * @param {object} options ตัวเลือก
   * @param {() => number} options.versionOf ฟังก์ชันอ่านเลขรุ่นปัจจุบันของค่าตั้งค่า
   * @param {() => DetectionService} options.factory ฟังก์ชันประกอบบริการจากค่าล่าสุด
   */
  constructor({ versionOf, factory }) {
    super();
    this.#holder = new LazyRebuild(versionOf, factory);
  }

  /**
   * บริการจริงที่ใช้อยู่ตอนนี้
   * @returns {DetectionService}
   */
  get current() { return this.#holder.current; }

  /** @returns {string} ชื่อไดรเวอร์ที่ใช้อยู่ */
  get driver() { return this.current.driver; }

  /**
   * ตรวจจับตำแหน่งผิวน้ำด้วยค่าตั้งค่าล่าสุด
   * @param {import('../../models/Station.js').Station} station จุดวัด
   * @param {Array<import('../../models/Roi.js').Roi>} [rois=[]] ขอบเขต ROI
   * @returns {Promise<import('./DetectionResult.js').DetectionResult>}
   */
  async detect(station, rois = []) { return this.current.detect(station, rois); }

  /**
   * ตรวจสุขภาพบริการที่ใช้อยู่
   * @returns {Promise<{healthy: boolean, message: string}>}
   */
  async healthCheck() { return this.current.healthCheck(); }
}
