import { BaseJob } from '../core/BaseJob.js';
import { EventBus } from '../core/EventBus.js';

/**
 * งานแจ้งเตือน — **ไม่มีตารางเวลา ทำงานเมื่อได้รับเหตุการณ์**
 *
 * ต่างจากระบบเดิม (`cron_group.php`) ที่เป็น cron รายชั่วโมงและยิงซ้ำตลอดเวลาที่
 * อยู่ในโซนวิกฤต ระบบใหม่รับเหตุการณ์ `measurement.recorded` จาก `EventBus`
 * แล้วให้ `AlertService` ตัดสินใจตามกฎ cooldown (Observer Pattern)
 *
 * ผลลัพธ์: แจ้งเตือนทันทีเมื่อสถานการณ์แย่ลง และไม่รบกวนซ้ำเมื่อสถานการณ์คงที่
 *
 * ยังคงมีเมท็อด `execute()` เพื่อรองรับการสั่งกวาดด้วยตนเองจากหน้าผู้ดูแล
 */
export class AlertJob extends BaseJob {
  /** @type {import('../services/AlertService.js').AlertService} */
  #alertService;
  /** @type {EventBus} */
  #eventBus;
  /** @type {import('../core/Logger.js').Logger} */
  #logger;
  /** @type {number} */
  #handled = 0;
  /** @type {number} */
  #sent = 0;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../services/AlertService.js').AlertService} deps.alertService บริการแจ้งเตือน
   * @param {EventBus} deps.eventBus ช่องทางเหตุการณ์
   * @param {import('../core/Logger.js').Logger} deps.logger ตัวบันทึกเหตุการณ์
   */
  constructor({ alertService, eventBus, logger }) {
    super('แจ้งเตือนระดับน้ำ', null);
    this.#alertService = alertService;
    this.#eventBus = eventBus;
    this.#logger = logger;
  }

  /**
   * เริ่มรับฟังเหตุการณ์จาก `EventBus`
   *
   * เรียกครั้งเดียวตอนแอปเริ่มทำงาน — `Scheduler` เป็นผู้เรียก
   *
   * @returns {this}
   */
  subscribe() {
    this.#eventBus.subscribe(EventBus.EVENTS.MEASUREMENT_RECORDED, async (payload) => {
      this.#handled += 1;
      const result = await this.#alertService.evaluateAndSend(payload);
      if (result.sent) this.#sent += 1;
    });
    this.#logger.info('alert job subscribed to measurement events');
    return this;
  }

  /**
   * สถิติการทำงาน — แสดงในหน้า `/admin`
   * @returns {{name: string, schedule: string|null, isRunning: boolean, lastRunAt: Date|null, lastStatus: string, runCount: number, handled: number, sent: number}}
   */
  get status() {
    return { ...super.status, handled: this.#handled, sent: this.#sent };
  }

  /**
   * ไม่มีงานตามเวลาให้ทำ — การแจ้งเตือนขับเคลื่อนด้วยเหตุการณ์ทั้งหมด
   * @returns {Promise<{mode: string, handled: number, sent: number}>}
   */
  async execute() {
    return { mode: 'event-driven', handled: this.#handled, sent: this.#sent };
  }
}
