import { ValidationError } from '../core/errors/index.js';

/**
 * พยากรณ์แนวโน้มระดับน้ำจากค่าที่วัดได้ย้อนหลัง
 *
 * ใช้การถดถอยเชิงเส้นด้วยวิธีกำลังสองน้อยที่สุด (ordinary least squares) บนคู่
 * (เวลาเป็นชั่วโมง, ระดับน้ำเป็นเมตร) ซึ่งเป็นวิธีที่**อธิบายได้และตรวจสอบได้**
 * ต่างจากแบบจำลองที่ซับซ้อนกว่าซึ่งกลายเป็นกล่องดำสำหรับผู้ดูแลท้องถิ่น
 *
 * ⚠️ ข้อจำกัดที่ต้องบอกผู้ใช้เสมอ — วิธีนี้มองเห็นแค่แนวโน้มของตัวเลขที่ผ่านมา
 * ไม่รู้จักฝนที่กำลังจะตก การเปิดปิดประตูน้ำ หรือน้ำทะเลหนุน จึงใช้เป็น
 * "แนวโน้มถ้าสถานการณ์ยังเป็นแบบเดิม" เท่านั้น ห้ามใช้แทนการเฝ้าระวังจริง
 *
 * เป็นตรรกะบริสุทธิ์ — ไม่แตะฐานข้อมูล ไม่รู้จัก HTTP จึงเขียน unit test ได้ครบ
 */
export class ForecastService {
  /** จำนวนค่าวัดขั้นต่ำที่ยอมให้พยากรณ์ */
  static MIN_POINTS = 6;

  /** ช่วงเวลาขั้นต่ำที่ข้อมูลต้องครอบคลุม (ชั่วโมง) */
  static MIN_SPAN_HOURS = 2;

  /** ค่า R² ที่ต่ำกว่านี้ถือว่าแนวโน้มไม่ชัดพอจะบอกทิศทาง */
  static WEAK_FIT_THRESHOLD = 0.3;

  /** อัตราการเปลี่ยนที่น้อยกว่านี้ (เมตร/ชั่วโมง) ถือว่าทรงตัว */
  static STABLE_SLOPE = 0.01;

  /**
   * พยากรณ์ระดับน้ำล่วงหน้า
   *
   * @param {Array<{measuredAt: Date|string, meter: number}>} history ค่าวัดย้อนหลัง (เรียงเวลาใดก็ได้)
   * @param {object} [options] ตัวเลือก
   * @param {number} [options.hours=6] จำนวนชั่วโมงที่จะพยากรณ์ล่วงหน้า
   * @param {number} [options.stepHours=1] ระยะห่างของแต่ละจุดพยากรณ์
   * @param {Date} [options.from] เวลาเริ่มนับ (ค่าเริ่มต้น = เวลาของค่าวัดล่าสุด)
   * @returns {{available: boolean, reason: string,
   *   trend?: string, slopePerHour?: number, rSquared?: number, confidence?: string,
   *   marginMeters?: number, basedOn?: number, spanHours?: number,
   *   points?: Array<{at: Date, meter: number, low: number, high: number}>}}
   * @throws {ValidationError} เมื่อพารามิเตอร์ไม่ถูกต้อง
   */
  forecast(history, { hours = 6, stepHours = 1, from = null } = {}) {
    if (!Number.isFinite(hours) || hours <= 0 || hours > 72) {
      throw new ValidationError('ช่วงพยากรณ์ต้องอยู่ระหว่าง 1–72 ชั่วโมง');
    }
    if (!Number.isFinite(stepHours) || stepHours <= 0) {
      throw new ValidationError('ระยะห่างของจุดพยากรณ์ต้องมากกว่าศูนย์');
    }

    const samples = ForecastService.#clean(history);
    if (samples.length < ForecastService.MIN_POINTS) {
      return {
        available: false,
        reason: `ต้องมีค่าวัดอย่างน้อย ${ForecastService.MIN_POINTS} ครั้งจึงจะพยากรณ์ได้ `
          + `(ตอนนี้มี ${samples.length} ครั้ง)`,
      };
    }

    const spanHours = (samples.at(-1).time - samples[0].time) / 3_600_000;
    if (spanHours < ForecastService.MIN_SPAN_HOURS) {
      return {
        available: false,
        reason: `ข้อมูลครอบคลุมเพียง ${spanHours.toFixed(1)} ชั่วโมง `
          + `ต้องมีอย่างน้อย ${ForecastService.MIN_SPAN_HOURS} ชั่วโมง`,
      };
    }

    const origin = from instanceof Date ? from : samples.at(-1).time;
    const fit = ForecastService.#fit(samples, origin);

    const points = [];
    for (let step = stepHours; step <= hours + 1e-9; step += stepHours) {
      const meter = fit.intercept + fit.slope * step;
      points.push({
        at: new Date(origin.getTime() + step * 3_600_000),
        meter: ForecastService.#round(meter),
        low: ForecastService.#round(meter - fit.margin),
        high: ForecastService.#round(meter + fit.margin),
      });
    }

    return {
      available: true,
      reason: 'พยากรณ์จากแนวโน้มเชิงเส้นของค่าวัดย้อนหลัง',
      trend: ForecastService.#trend(fit.slope, fit.rSquared),
      slopePerHour: ForecastService.#round(fit.slope, 3),
      rSquared: ForecastService.#round(fit.rSquared, 3),
      confidence: ForecastService.#confidence(fit.rSquared),
      marginMeters: ForecastService.#round(fit.margin),
      basedOn: samples.length,
      spanHours: ForecastService.#round(spanHours, 1),
      points,
    };
  }

  /**
   * คัดข้อมูลที่ใช้ได้ เรียงตามเวลา และรวมค่าที่เวลาซ้ำกัน
   * @param {Array<{measuredAt: Date|string, meter: number}>} history ค่าวัดดิบ
   * @returns {Array<{time: Date, meter: number}>}
   */
  static #clean(history) {
    const seen = new Map();

    for (const row of history ?? []) {
      // ⚠️ ห้ามใช้ `Number()` ตรง ๆ กับค่าที่อาจว่าง — `Number(null)` และ `Number('')`
      // ได้ 0 ซึ่งผ่าน `isFinite()` ไปได้ ค่าที่ "ไม่มี" จะกลายเป็น "ระดับน้ำ 0 เมตร"
      // แล้วดึงเส้นแนวโน้มให้เพี้ยนโดยไม่มีสัญญาณเตือน (บทเรียนเดียวกับ PixelLevel)
      const raw = row?.meter;
      if (raw === null || raw === undefined || raw === '') continue;
      const meter = Number(raw);
      if (!Number.isFinite(meter)) continue;

      const time = row.measuredAt instanceof Date ? row.measuredAt : new Date(row.measuredAt);
      if (Number.isNaN(time.getTime())) continue;

      // เวลาซ้ำกันให้ใช้ค่าหลังสุด — กันข้อมูลซ้ำจากการวัดด้วยตนเองซ้อนกับงานตามเวลา
      seen.set(time.getTime(), { time, meter });
    }

    return [...seen.values()].sort((a, b) => a.time - b.time);
  }

  /**
   * หาเส้นตรงที่เหมาะที่สุดด้วยวิธีกำลังสองน้อยที่สุด
   *
   * แกน x คือ "ชั่วโมงนับจาก `origin`" ซึ่งเป็นลบสำหรับข้อมูลในอดีต ทำให้
   * `intercept` มีความหมายตรงตัวว่า "ระดับน้ำ ณ เวลา `origin`"
   *
   * @param {Array<{time: Date, meter: number}>} samples ค่าวัดที่คัดแล้ว
   * @param {Date} origin เวลาอ้างอิง
   * @returns {{slope: number, intercept: number, rSquared: number, margin: number}}
   */
  static #fit(samples, origin) {
    const xs = samples.map((s) => (s.time - origin) / 3_600_000);
    const ys = samples.map((s) => s.meter);
    const n = samples.length;

    const meanX = xs.reduce((sum, x) => sum + x, 0) / n;
    const meanY = ys.reduce((sum, y) => sum + y, 0) / n;

    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < n; i += 1) {
      sxy += (xs[i] - meanX) * (ys[i] - meanY);
      sxx += (xs[i] - meanX) ** 2;
    }

    // ทุกจุดอยู่เวลาเดียวกันจนหาความชันไม่ได้ — ถือว่าทรงตัวที่ค่าเฉลี่ย
    const slope = sxx === 0 ? 0 : sxy / sxx;
    const intercept = meanY - slope * meanX;

    let ssRes = 0;
    let ssTot = 0;
    for (let i = 0; i < n; i += 1) {
      ssRes += (ys[i] - (intercept + slope * xs[i])) ** 2;
      ssTot += (ys[i] - meanY) ** 2;
    }

    // ระดับน้ำคงที่เป๊ะ (ssTot = 0) คือเส้นตรงที่พอดีสมบูรณ์ ไม่ใช่ข้อมูลที่ใช้ไม่ได้
    const rSquared = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);

    // ช่วงความคลาดเคลื่อนโดยประมาณ = ส่วนเบี่ยงเบนของเศษเหลือ
    const margin = n > 2 ? Math.sqrt(ssRes / (n - 2)) : 0;

    return { slope, intercept, rSquared, margin };
  }

  /**
   * แปลงความชันเป็นทิศทางที่คนอ่านเข้าใจ
   * @param {number} slope ความชัน (เมตร/ชั่วโมง)
   * @param {number} rSquared ความแนบของเส้น
   * @returns {'RISING'|'FALLING'|'STABLE'|'UNCLEAR'}
   */
  static #trend(slope, rSquared) {
    if (rSquared < ForecastService.WEAK_FIT_THRESHOLD) return 'UNCLEAR';
    if (Math.abs(slope) < ForecastService.STABLE_SLOPE) return 'STABLE';
    return slope > 0 ? 'RISING' : 'FALLING';
  }

  /**
   * แปลง R² เป็นระดับความเชื่อมั่นที่สื่อสารได้
   * @param {number} rSquared ความแนบของเส้น
   * @returns {'HIGH'|'MEDIUM'|'LOW'}
   */
  static #confidence(rSquared) {
    if (rSquared >= 0.8) return 'HIGH';
    if (rSquared >= ForecastService.WEAK_FIT_THRESHOLD) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * ปัดทศนิยม
   * @param {number} value ค่า
   * @param {number} [digits=2] จำนวนตำแหน่ง
   * @returns {number}
   */
  static #round(value, digits = 2) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }
}
