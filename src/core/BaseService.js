import { NotImplementedError } from './errors/index.js';
import { Logger } from './Logger.js';

/**
 * คลาสฐานนามธรรมของชั้นตรรกะทางธุรกิจ
 *
 * ชั้นนี้**ไม่รู้จัก HTTP** (ไม่มี `req`/`res`) และ**ไม่เขียน SQL**
 * ทำให้ Controller และ Job เรียกใช้ Service ชุดเดียวกันได้ — แก้ปัญหาตรรกะซ้ำ
 * ของระบบเดิม (CLAUDE.md ข้อ 2.1 ข้อบกพร่องที่ 8)
 *
 * @abstract
 */
export class BaseService {
  /** @type {import('./BaseRepository.js').BaseRepository|null} */
  #repository;
  /** @type {import('./Logger.js').Logger} */
  #logger;

  /**
   * @param {import('./BaseRepository.js').BaseRepository|null} [repository=null] ที่เก็บข้อมูลหลักของบริการนี้
   * @param {import('./Logger.js').Logger} [logger] ตัวบันทึกเหตุการณ์
   * @throws {NotImplementedError} เมื่อสร้างวัตถุจากคลาสนามธรรมโดยตรง
   */
  constructor(repository = null, logger = Logger.getInstance()) {
    if (new.target === BaseService) {
      throw new NotImplementedError('BaseService เป็นคลาสนามธรรม สร้างวัตถุโดยตรงไม่ได้');
    }
    this.#repository = repository;
    this.#logger = logger;
  }

  /** @returns {import('./BaseRepository.js').BaseRepository|null} ที่เก็บข้อมูลหลัก */
  get repository() { return this.#repository; }

  /** @returns {import('./Logger.js').Logger} ตัวบันทึกเหตุการณ์ */
  get logger() { return this.#logger; }
}
