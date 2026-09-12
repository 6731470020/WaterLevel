import { ValidationError } from '../core/errors/index.js';
import { PixelLevel } from '../models/values/PixelLevel.js';
import { MeterLevel } from '../models/values/MeterLevel.js';
import { ZoneLevel } from '../models/values/ZoneLevel.js';

/**
 * ตัวแปลงพิกเซล↔เมตร ด้วยการประมาณค่าเชิงเส้นทีละช่วง
 *
 * **ตรรกะบริสุทธิ์** — ไม่แตะฐานข้อมูล ไม่รู้จัก HTTP รับจุดเทียบค่าเข้ามาทาง constructor
 * ทำให้ทดสอบได้ครบทุกกรณีโดยไม่ต้องมีฐานข้อมูล
 *
 * ⚠️ **ห้ามมีค่าสำรองฮาร์ดโค้ด** — ถ้าจุดเทียบค่าไม่ครบ 2 จุดต้องโยน `ValidationError`
 * ระบบเดิม (`api/broadcast-line.php:411`) ใส่ค่าสำรองไว้ ทำให้รายงานผิดโดยไม่มีสัญญาณเตือน
 * (CLAUDE.md ข้อ 2.1 ข้อบกพร่องที่ 8 และข้อ 6.2)
 *
 * @example
 * const calc = new WaterLevelCalculator([
 *   { pixel: 204, meter: 4.00 }, { pixel: 247, meter: 3.80 },
 *   { pixel: 286, meter: 3.60 }, { pixel: 309, meter: 3.50 },
 * ]);
 * calc.pixelToMeter(new PixelLevel(298)).value;  // 3.55
 */
export class WaterLevelCalculator {
  /** @type {Array<{pixel: number, meter: number}>} */
  #points;

  /**
   * @param {Array<{pixel: number, meter: number}|import('../models/CalibrationPoint.js').CalibrationPoint>} calibrationPoints
   *        จุดเทียบค่า อย่างน้อย 2 จุด
   * @throws {ValidationError} เมื่อจุดเทียบค่าไม่ครบ 2 จุด หรือมีพิกเซลซ้ำที่ให้ค่าเมตรต่างกัน
   */
  constructor(calibrationPoints) {
    const normalized = WaterLevelCalculator.#normalize(calibrationPoints);
    if (normalized.length < 2) {
      throw new ValidationError(
        'จุดวัดนี้ต้องมีจุดเทียบค่าอย่างน้อย 2 จุดจึงจะคำนวณระดับน้ำเป็นเมตรได้ ' +
        'กรุณาเพิ่มจุดเทียบค่าในหน้าตั้งค่าจุดวัด',
      );
    }
    this.#points = normalized;
    Object.freeze(this);
  }

  /**
   * สร้างตัวคำนวณ หรือคืน null เมื่อจุดเทียบค่าไม่พอ — ใช้ในที่ที่ยอมให้ไม่มีค่าเมตรได้
   * @param {Array<object>} calibrationPoints จุดเทียบค่า
   * @returns {WaterLevelCalculator|null}
   */
  static tryCreate(calibrationPoints) {
    try {
      return new WaterLevelCalculator(calibrationPoints);
    } catch {
      return null;
    }
  }

  /** @returns {Array<{pixel: number, meter: number}>} จุดเทียบค่าที่ใช้อยู่ (สำเนา) */
  get points() { return this.#points.map((point) => ({ ...point })); }

  /** @returns {number} จำนวนจุดเทียบค่า */
  get pointCount() { return this.#points.length; }

  /** @returns {{minPixel: number, maxPixel: number, minMeter: number, maxMeter: number}} ช่วงที่เทียบค่าไว้ */
  get range() {
    const first = this.#points[0];
    const last = this.#points[this.#points.length - 1];
    return {
      minPixel: first.pixel,
      maxPixel: last.pixel,
      minMeter: Math.min(first.meter, last.meter),
      maxMeter: Math.max(first.meter, last.meter),
    };
  }

  /**
   * แปลงพิกเซลแกน Y เป็นระดับน้ำเป็นเมตร
   *
   * - อยู่ในช่วงที่เทียบไว้ → ประมาณค่าเชิงเส้นระหว่างจุดที่ขนาบอยู่
   * - อยู่นอกช่วง → คำนวณต่อด้วยความชันของคู่ปลายที่ใกล้ที่สุด (extrapolation)
   *
   * @param {PixelLevel|number} pixelLevel ระดับน้ำเป็นพิกเซล
   * @returns {MeterLevel} ระดับน้ำเป็นเมตร (ทศนิยม 2 ตำแหน่ง)
   * @throws {ValidationError} เมื่อค่าที่ส่งมาไม่ใช่พิกเซลที่ถูกต้อง
   */
  pixelToMeter(pixelLevel) {
    const pixel = pixelLevel instanceof PixelLevel ? pixelLevel.value : new PixelLevel(pixelLevel).value;
    const points = this.#points;

    // ต่ำกว่าจุดแรก — ใช้ความชันของคู่แรกคำนวณต่อออกไป
    if (pixel <= points[0].pixel) {
      return new MeterLevel(WaterLevelCalculator.#interpolate(pixel, points[0], points[1]));
    }
    // สูงกว่าจุดสุดท้าย — ใช้ความชันของคู่สุดท้าย
    const last = points.length - 1;
    if (pixel >= points[last].pixel) {
      return new MeterLevel(WaterLevelCalculator.#interpolate(pixel, points[last - 1], points[last]));
    }
    // อยู่ในช่วง — หาคู่ที่ขนาบแล้วประมาณค่าเชิงเส้น
    for (let i = 0; i < last; i += 1) {
      if (pixel >= points[i].pixel && pixel <= points[i + 1].pixel) {
        return new MeterLevel(WaterLevelCalculator.#interpolate(pixel, points[i], points[i + 1]));
      }
    }
    // ไปถึงตรงนี้ไม่ได้หากจุดเทียบค่าเรียงถูกต้อง — กันไว้เพื่อความชัดเจน
    throw new ValidationError('ไม่สามารถแปลงค่าพิกเซลเป็นเมตรได้จากจุดเทียบค่าที่มี');
  }

  /**
   * แปลงระดับน้ำเป็นเมตรกลับเป็นพิกเซล — ใช้วาดเส้นเทียบค่าทับบนภาพ
   *
   * เป็นเมท็อดผกผันของ `pixelToMeter()` การแปลงไปกลับต้องได้ค่าเดิม (ภายในความคลาดเคลื่อนจากการปัดเศษ)
   *
   * @param {MeterLevel|number} meterLevel ระดับน้ำเป็นเมตร
   * @returns {PixelLevel} ตำแหน่งพิกเซลแกน Y
   * @throws {ValidationError} เมื่อจุดเทียบค่าให้ค่าเมตรเท่ากันทั้งคู่จนหาผกผันไม่ได้
   */
  meterToPixel(meterLevel) {
    const meter = meterLevel instanceof MeterLevel ? meterLevel.value : new MeterLevel(meterLevel).value;
    // จุดเรียงตามพิกเซลจากน้อยไปมาก = เมตรจากมากไปน้อย (พิกเซลน้อย = น้ำสูง)
    const points = this.#points;
    const last = points.length - 1;
    const ascendingMeter = points[0].meter < points[last].meter;

    const isBefore = ascendingMeter ? meter <= points[0].meter : meter >= points[0].meter;
    const isAfter = ascendingMeter ? meter >= points[last].meter : meter <= points[last].meter;

    if (isBefore) return new PixelLevel(Math.max(0, this.#invert(meter, points[0], points[1])));
    if (isAfter) return new PixelLevel(Math.max(0, this.#invert(meter, points[last - 1], points[last])));

    for (let i = 0; i < last; i += 1) {
      const lo = Math.min(points[i].meter, points[i + 1].meter);
      const hi = Math.max(points[i].meter, points[i + 1].meter);
      if (meter >= lo && meter <= hi) {
        return new PixelLevel(Math.max(0, this.#invert(meter, points[i], points[i + 1])));
      }
    }
    throw new ValidationError('ไม่สามารถแปลงค่าเมตรกลับเป็นพิกเซลได้จากจุดเทียบค่าที่มี');
  }

  /**
   * หาโซนเตือนภัยจากระดับน้ำ — ห่อ `ZoneLevel.resolve()` ไว้ให้เรียกจากที่เดียว
   * @param {PixelLevel|number} pixelLevel ระดับน้ำเป็นพิกเซล
   * @param {Array<import('../models/Zone.js').Zone>} zones โซนของจุดวัด
   * @returns {ZoneLevel} โซนที่ตกอยู่
   * @throws {ValidationError} เมื่อยังไม่ได้กำหนดโซน
   */
  resolveZone(pixelLevel, zones) {
    const pixel = pixelLevel instanceof PixelLevel ? pixelLevel : new PixelLevel(pixelLevel);
    return ZoneLevel.resolve(pixel, zones);
  }

  /**
   * ตารางเทียบค่าสำหรับแสดงผลในหน้าทดสอบการแปลงค่า
   * @param {number} [step=10] ระยะห่างพิกเซลของแต่ละแถว
   * @returns {Array<{pixel: number, meter: number}>}
   */
  previewTable(step = 10) {
    const { minPixel, maxPixel } = this.range;
    const rows = [];
    for (let pixel = minPixel; pixel <= maxPixel; pixel += step) {
      rows.push({ pixel, meter: this.pixelToMeter(pixel).value });
    }
    return rows;
  }

  /**
   * คำนวณพิกเซลผกผันจากคู่จุดหนึ่งคู่
   * @param {number} meter ค่าเมตรเป้าหมาย
   * @param {{pixel: number, meter: number}} a จุดที่หนึ่ง
   * @param {{pixel: number, meter: number}} b จุดที่สอง
   * @returns {number} ค่าพิกเซล
   * @throws {ValidationError} เมื่อสองจุดให้ค่าเมตรเท่ากัน (ความชันเป็นศูนย์)
   */
  #invert(meter, a, b) {
    const meterSpan = b.meter - a.meter;
    if (meterSpan === 0) {
      throw new ValidationError('จุดเทียบค่าสองจุดให้ค่าเมตรเท่ากัน แปลงกลับเป็นพิกเซลไม่ได้');
    }
    return a.pixel + ((meter - a.meter) / meterSpan) * (b.pixel - a.pixel);
  }

  /**
   * ประมาณค่าเชิงเส้นระหว่างจุดสองจุด (ใช้ทั้ง interpolation และ extrapolation)
   * @param {number} pixel ค่าพิกเซลเป้าหมาย
   * @param {{pixel: number, meter: number}} a จุดที่หนึ่ง
   * @param {{pixel: number, meter: number}} b จุดที่สอง
   * @returns {number} ค่าเมตร
   */
  static #interpolate(pixel, a, b) {
    const pixelSpan = b.pixel - a.pixel;
    if (pixelSpan === 0) return a.meter;
    const ratio = (pixel - a.pixel) / pixelSpan;
    return a.meter + ratio * (b.meter - a.meter);
  }

  /**
   * ทำความสะอาดและเรียงจุดเทียบค่าตามพิกเซลจากน้อยไปมาก
   * @param {Array<object>} rawPoints จุดดิบ
   * @returns {Array<{pixel: number, meter: number}>}
   * @throws {ValidationError} เมื่อมีพิกเซลซ้ำที่ให้ค่าเมตรต่างกัน
   */
  static #normalize(rawPoints) {
    const byPixel = new Map();
    for (const raw of rawPoints ?? []) {
      const pixel = Math.round(Number(raw.pixel ?? raw.pixelValue ?? raw.px));
      const meter = Number(raw.meter ?? raw.meterValue ?? raw.m);
      if (!Number.isFinite(pixel) || !Number.isFinite(meter) || pixel < 0) continue;
      const rounded = Math.round(meter * 100) / 100;
      if (byPixel.has(pixel) && byPixel.get(pixel) !== rounded) {
        throw new ValidationError(
          `จุดเทียบค่าขัดแย้งกัน: พิกเซล ${pixel} ถูกกำหนดเป็น ` +
          `${byPixel.get(pixel)} ม. และ ${rounded} ม. พร้อมกัน`,
        );
      }
      byPixel.set(pixel, rounded);
    }
    return [...byPixel.entries()]
      .map(([pixel, meter]) => ({ pixel, meter }))
      .sort((a, b) => a.pixel - b.pixel);
  }
}
