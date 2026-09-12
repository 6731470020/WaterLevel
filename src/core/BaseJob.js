import { NotImplementedError } from './errors/index.js';
import { Logger } from './Logger.js';

/**
 * คลาสฐานนามธรรมของงานตามเวลา — ตัวอย่าง **Template Method**
 *
 * `run()` คุมลำดับขั้นตายตัว (กันงานซ้อน → จับเวลา → ทำงาน → บันทึกผล)
 * คลาสลูกเขียนแค่ `execute()` และจะ override `onSuccess()` / `onError()` ก็ได้
 *
 * ธง `#running` ทำหน้าที่แทน distributed lock ได้เพราะระบบรันโปรเซสเดียว
 * (แก้ปัญหาระบบเดิมที่ cron ซ้อนกันได้)
 *
 * @abstract
 */
export class BaseJob {
  /** @type {string} */
  #name;
  /** @type {string|null} */
  #schedule;
  /** @type {boolean} */
  #running = false;
  /** @type {Date|null} */
  #lastRunAt = null;
  /** @type {string} */
  #lastStatus = 'IDLE';
  /** @type {number} */
  #runCount = 0;

  /**
   * @param {string} name ชื่องานที่แสดงใน log และหน้า `/admin`
   * @param {string|null} [schedule=null] นิพจน์ cron (null = ทำงานเมื่อถูกเรียกเท่านั้น)
   * @throws {NotImplementedError} เมื่อสร้างวัตถุจากคลาสนามธรรมโดยตรง
   */
  constructor(name, schedule = null) {
    if (new.target === BaseJob) {
      throw new NotImplementedError('BaseJob เป็นคลาสนามธรรม สร้างวัตถุโดยตรงไม่ได้');
    }
    this.#name = name;
    this.#schedule = schedule;
  }

  /** @returns {string} ชื่องาน */
  get name() { return this.#name; }

  /** @returns {string|null} นิพจน์ cron */
  get schedule() { return this.#schedule; }

  /** @returns {boolean} กำลังทำงานอยู่หรือไม่ */
  get isRunning() { return this.#running; }

  /** @returns {Date|null} เวลาที่ทำงานครั้งล่าสุด */
  get lastRunAt() { return this.#lastRunAt; }

  /** @returns {string} ผลของรอบล่าสุด: IDLE | RUNNING | SUCCESS | FAILED */
  get lastStatus() { return this.#lastStatus; }

  /** @returns {number} จำนวนรอบที่ทำไปแล้ว */
  get runCount() { return this.#runCount; }

  /**
   * สถานะสรุปสำหรับแสดงบนหน้า `/admin`
   * @returns {{name: string, schedule: string|null, isRunning: boolean, lastRunAt: Date|null, lastStatus: string, runCount: number}}
   */
  get status() {
    return {
      name: this.#name,
      schedule: this.#schedule,
      isRunning: this.#running,
      lastRunAt: this.#lastRunAt,
      lastStatus: this.#lastStatus,
      runCount: this.#runCount,
    };
  }

  /**
   * ลำดับขั้นตายตัวของทุกงาน (Template Method) — **คลาสลูกห้าม override**
   * @returns {Promise<*>} ผลที่ `execute()` คืน หรือ null เมื่อข้ามรอบ/ล้มเหลว
   */
  async run() {
    if (this.#running) {
      Logger.getInstance().warn(`skip ${this.#name} — previous run still in progress`);
      return null;
    }
    this.#running = true;
    this.#lastStatus = 'RUNNING';
    this.#lastRunAt = new Date();
    const startedAt = Date.now();
    try {
      const result = await this.execute();
      this.#runCount += 1;
      this.#lastStatus = 'SUCCESS';
      await this.onSuccess(result, Date.now() - startedAt);
      return result;
    } catch (error) {
      this.#runCount += 1;
      this.#lastStatus = 'FAILED';
      await this.onError(error, Date.now() - startedAt);
      return null;
    } finally {
      this.#running = false;
    }
  }

  /**
   * เนื้องานจริง — จุดเดียวที่คลาสลูกต้องเขียน
   * @abstract
   * @returns {Promise<*>}
   * @throws {NotImplementedError} เมื่อคลาสลูกไม่ override
   */
  async execute() {
    throw new NotImplementedError(`${this.constructor.name} ต้อง override execute()`);
  }

  /**
   * เรียกเมื่องานสำเร็จ — override ได้เพื่อทำงานเพิ่ม
   * @param {*} result ผลจาก `execute()`
   * @param {number} durationMs เวลาที่ใช้ (มิลลิวินาที)
   * @returns {Promise<void>}
   */
  async onSuccess(result, durationMs) {
    Logger.getInstance().info(`job ${this.#name} finished in ${durationMs}ms`, {
      result: BaseJob.summarize(result),
    });
  }

  /**
   * เรียกเมื่องานล้มเหลว — override ได้เพื่อแจ้งเตือน
   * @param {Error} error ข้อผิดพลาดที่เกิด
   * @param {number} durationMs เวลาที่ใช้ (มิลลิวินาที)
   * @returns {Promise<void>}
   */
  async onError(error, durationMs) {
    Logger.getInstance().error(`job ${this.#name} failed after ${durationMs}ms`, error);
  }

  /**
   * หน่วงเวลาแบบไม่บล็อก event loop
   *
   * ใช้แทน `sleep()` ของ PHP ที่หยุดทั้งโปรเซส (CLAUDE.md ข้อ 2.1 ข้อบกพร่องที่ 6)
   *
   * @protected
   * @param {number} ms จำนวนมิลลิวินาที
   * @returns {Promise<void>}
   */
  async delay(ms) {
    if (ms <= 0) return;
    // ไม่ใช้ .unref() โดยเจตนา — ตัวจับเวลาต้องคาโปรเซสไว้จนครบเวลา
    // มิฉะนั้นสคริปต์ที่รันครั้งเดียว (เช่นการวัดด้วยตนเองจากบรรทัดคำสั่ง)
    // จะจบไปกลางคันระหว่างรอบยืนยันค่า
    await new Promise((resolve) => { setTimeout(resolve, ms); });
  }

  /**
   * ย่อผลลัพธ์ให้สั้นพอสำหรับ log
   * @param {*} result ผลลัพธ์
   * @returns {*}
   */
  static summarize(result) {
    if (result === null || result === undefined) return null;
    if (typeof result !== 'object') return result;
    if (Array.isArray(result)) return { count: result.length };
    return result;
  }
}
