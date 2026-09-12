import { PixelLevel } from '../models/values/PixelLevel.js';

/**
 * ตัวตัดสินความน่าเชื่อถือของค่าวัด — **ตรรกะบริสุทธิ์** ไม่แตะฐานข้อมูลและไม่วัดค่าเอง
 *
 * แยกการ*ตัดสินใจ*ออกจากการ*ลงมือทำ*: คลาสนี้บอกว่าควรทำอะไรต่อ ส่วน `DetectJob`
 * เป็นผู้เรียกบริการตรวจจับและหน่วงเวลาจริง ทำให้ทดสอบตรรกะได้โดยไม่ต้องรอ 30 วินาที
 *
 * เกณฑ์ตาม CLAUDE.md ข้อ 6.4:
 * ```
 * MAX_VARIATION = 50 px      CONFIRMATION_ATTEMPTS = 3
 * RETRY_DELAY   = 10 วินาที   CONSISTENCY_THRESHOLD = 25 px
 * ```
 */
export class VariationValidator {
  /** @type {number} */
  #maxVariationPx;
  /** @type {number} */
  #confirmationAttempts;
  /** @type {number} */
  #confirmationDelayMs;
  /** @type {number} */
  #consistencyThresholdPx;

  /**
   * @param {{maxVariationPx?: number, confirmationAttempts?: number, confirmationDelayMs?: number, consistencyThresholdPx?: number}} [options={}]
   */
  constructor({
    maxVariationPx = 50,
    confirmationAttempts = 3,
    confirmationDelayMs = 10000,
    consistencyThresholdPx = 25,
  } = {}) {
    this.#maxVariationPx = Number(maxVariationPx);
    this.#confirmationAttempts = Number(confirmationAttempts);
    this.#confirmationDelayMs = Number(confirmationDelayMs);
    this.#consistencyThresholdPx = Number(consistencyThresholdPx);
    Object.freeze(this);
  }

  /** @returns {number} ผลต่างสูงสุดที่ยอมรับได้โดยไม่ต้องยืนยัน (พิกเซล) */
  get maxVariationPx() { return this.#maxVariationPx; }

  /** @returns {number} จำนวนครั้งที่วัดซ้ำในโหมดยืนยัน */
  get confirmationAttempts() { return this.#confirmationAttempts; }

  /** @returns {number} ระยะหน่วงระหว่างการวัดซ้ำ (มิลลิวินาที) */
  get confirmationDelayMs() { return this.#confirmationDelayMs; }

  /** @returns {number} ช่วงกระจายสูงสุดที่ถือว่าค่าที่วัดซ้ำสอดคล้องกัน (พิกเซล) */
  get consistencyThresholdPx() { return this.#consistencyThresholdPx; }

  /**
   * ขั้นที่ 1–3: ตัดสินว่าค่าที่วัดได้ใหม่ต้องเข้าโหมดยืนยันหรือไม่
   *
   * เทียบกับ**ค่าเฉลี่ยของค่าวัดล่าสุด 3 ค่า** ตามที่ระบบเดิมทำ
   * ถ้ายังไม่มีประวัติเลย ให้ผ่านทันที (ค่าแรกไม่มีอะไรให้เทียบ)
   *
   * @param {PixelLevel} candidate ค่าที่เพิ่งวัดได้
   * @param {Array<PixelLevel>} recentLevels ค่าวัดล่าสุด (เรียงจากใหม่ไปเก่า)
   * @returns {{accepted: boolean, needsConfirmation: boolean, variation: number, baseline: number|null, reason: string}}
   */
  evaluate(candidate, recentLevels) {
    const usable = (recentLevels ?? []).filter((level) => level instanceof PixelLevel);
    if (!usable.length) {
      return {
        accepted: true,
        needsConfirmation: false,
        variation: 0,
        baseline: null,
        reason: 'ยังไม่มีค่าวัดก่อนหน้า จึงรับค่าแรกไว้ทันที',
      };
    }

    const baseline = PixelLevel.average(usable);
    const variation = candidate.differenceFrom(baseline);

    // "ต่างไม่เกิน 50 px → บันทึกทันที" — ที่ 50 พอดีถือว่าผ่าน
    if (variation <= this.#maxVariationPx) {
      return {
        accepted: true,
        needsConfirmation: false,
        variation,
        baseline: baseline.value,
        reason: `ผลต่าง ${variation} พิกเซล ไม่เกินเกณฑ์ ${this.#maxVariationPx} พิกเซล`,
      };
    }

    return {
      accepted: false,
      needsConfirmation: true,
      variation,
      baseline: baseline.value,
      reason: `ผลต่าง ${variation} พิกเซล เกินเกณฑ์ ${this.#maxVariationPx} พิกเซล ต้องวัดซ้ำเพื่อยืนยัน`,
    };
  }

  /**
   * ขั้นที่ 4–5: ตัดสินผลของโหมดยืนยันจากค่าที่วัดซ้ำได้
   *
   * ผ่านเมื่อ `max − min ≤ 25 px` → ใช้**ค่าเฉลี่ย**ของค่าที่วัดซ้ำ
   * ไม่ผ่าน → ไม่บันทึกค่าวัด แต่ผู้เรียกยังต้องบันทึก `validation_log` เสมอ
   *
   * ระบบเดิมมีบั๊กตรงนี้: คำนวณค่าเฉลี่ยและบันทึก log แล้ว `return false`
   * ทำให้ค่าที่ยืนยันได้ถูกทิ้งไปเปล่า ๆ (`cron_water_level.php:174`)
   *
   * @param {Array<PixelLevel>} attempts ค่าที่วัดซ้ำได้ทั้งหมด
   * @returns {{confirmed: boolean, level: PixelLevel|null, spread: number, attempts: number, reason: string}}
   */
  confirm(attempts) {
    const usable = (attempts ?? []).filter((level) => level instanceof PixelLevel);

    if (!usable.length) {
      return {
        confirmed: false,
        level: null,
        spread: 0,
        attempts: 0,
        reason: 'วัดซ้ำไม่สำเร็จเลยแม้แต่ครั้งเดียว',
      };
    }

    const spread = PixelLevel.spread(usable);
    if (spread <= this.#consistencyThresholdPx) {
      return {
        confirmed: true,
        level: PixelLevel.average(usable),
        spread,
        attempts: usable.length,
        reason: `ค่าที่วัดซ้ำ ${usable.length} ครั้งกระจายเพียง ${spread} พิกเซล ` +
                `(ไม่เกิน ${this.#consistencyThresholdPx}) จึงใช้ค่าเฉลี่ยได้`,
      };
    }

    return {
      confirmed: false,
      level: null,
      spread,
      attempts: usable.length,
      reason: `ค่าที่วัดซ้ำกระจาย ${spread} พิกเซล เกินเกณฑ์ ${this.#consistencyThresholdPx} พิกเซล ` +
              'จึงไม่บันทึกค่าวัดรอบนี้',
    };
  }
}
