import cron from 'node-cron';
import { NotFoundError, ValidationError } from '../core/errors/index.js';

/**
 * ตัวลงทะเบียนและควบคุมงานตามเวลาทั้งหมด
 *
 * ทำงานใน**โปรเซสเดียวกับเว็บเซิร์ฟเวอร์** ผ่าน `node-cron` ไม่ต้องมี Redis
 * หรือโปรเซสแยก ตามข้อกำหนดของโปรเจกต์
 *
 * งานที่ไม่มีนิพจน์ cron (เช่น `AlertJob` ที่ขับเคลื่อนด้วยเหตุการณ์) ยังลงทะเบียนได้
 * เพื่อให้แสดงสถานะและสั่งรันด้วยตนเองได้ แต่จะไม่ถูกตั้งเวลา
 */
export class Scheduler {
  /** @type {Map<string, {job: import('../core/BaseJob.js').BaseJob, task: object|null}>} */
  #jobs = new Map();
  /** @type {import('../core/Logger.js').Logger} */
  #logger;
  /** @type {boolean} */
  #started = false;
  /** @type {string} */
  #timezone;

  /**
   * @param {import('../core/Logger.js').Logger} logger ตัวบันทึกเหตุการณ์
   * @param {{timezone?: string}} [options={}] ตัวเลือก
   */
  constructor(logger, { timezone = 'Asia/Bangkok' } = {}) {
    this.#logger = logger;
    this.#timezone = timezone;
  }

  /** @returns {boolean} เริ่มตั้งเวลาแล้วหรือยัง */
  get isStarted() { return this.#started; }

  /**
   * ลงทะเบียนงานหนึ่งตัว
   * @param {import('../core/BaseJob.js').BaseJob} job งานที่ต้องการลงทะเบียน
   * @returns {this}
   * @throws {ValidationError} เมื่อนิพจน์ cron ไม่ถูกต้อง หรือชื่องานซ้ำ
   */
  register(job) {
    if (this.#jobs.has(job.name)) {
      throw new ValidationError(`มีงานชื่อ "${job.name}" ลงทะเบียนไว้แล้ว`);
    }
    if (job.schedule && !cron.validate(job.schedule)) {
      throw new ValidationError(`นิพจน์ cron ของงาน "${job.name}" ไม่ถูกต้อง: ${job.schedule}`);
    }
    this.#jobs.set(job.name, { job, task: null });
    this.#logger.info('job registered', { name: job.name, schedule: job.schedule ?? 'event-driven' });
    return this;
  }

  /**
   * ลงทะเบียนหลายงานพร้อมกัน
   * @param {Array<import('../core/BaseJob.js').BaseJob>} jobs รายการงาน
   * @returns {this}
   */
  registerAll(jobs) {
    for (const job of jobs) this.register(job);
    return this;
  }

  /**
   * เริ่มตั้งเวลางานทั้งหมดที่มีนิพจน์ cron
   * @returns {this}
   */
  start() {
    if (this.#started) return this;

    for (const entry of this.#jobs.values()) {
      if (!entry.job.schedule) continue;
      entry.task = cron.schedule(
        entry.job.schedule,
        () => { entry.job.run(); },
        { scheduled: true, timezone: this.#timezone },
      );
    }

    this.#started = true;
    const scheduled = [...this.#jobs.values()].filter((entry) => entry.task).length;
    this.#logger.info('scheduler started', { scheduled, timezone: this.#timezone });
    return this;
  }

  /**
   * หยุดงานตามเวลาทั้งหมด (ใช้ตอนปิดแอป)
   * @returns {this}
   */
  stop() {
    for (const entry of this.#jobs.values()) {
      entry.task?.stop();
      entry.task = null;
    }
    this.#started = false;
    this.#logger.info('scheduler stopped');
    return this;
  }

  /**
   * สั่งรันงานหนึ่งตัวทันที (จากหน้าผู้ดูแล)
   * @param {string} name ชื่องาน
   * @returns {Promise<*>} ผลของงาน
   * @throws {NotFoundError} เมื่อไม่พบงานชื่อนั้น
   */
  async runNow(name) {
    const entry = this.#jobs.get(name);
    if (!entry) throw new NotFoundError(`ไม่พบงานชื่อ "${name}"`);
    this.#logger.info('job triggered manually', { name });
    return entry.job.run();
  }

  /**
   * ค้นงานตามชื่อ
   * @param {string} name ชื่องาน
   * @returns {import('../core/BaseJob.js').BaseJob|null}
   */
  get(name) {
    return this.#jobs.get(name)?.job ?? null;
  }

  /**
   * สถานะของงานทั้งหมด — แสดงในหน้า `/admin`
   * @returns {Array<object>}
   */
  status() {
    return [...this.#jobs.values()].map((entry) => ({
      ...entry.job.status,
      scheduled: entry.task !== null,
    }));
  }
}
