import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { WaterLevelCalculator } from '../../src/services/WaterLevelCalculator.js';
import { PixelLevel } from '../../src/models/values/PixelLevel.js';
import { MeterLevel } from '../../src/models/values/MeterLevel.js';
import { ValidationError } from '../../src/core/errors/index.js';

/** จุดเทียบค่าจริงของจุดวัดที่ 1 จาก `data/bangpai.sql` (CLAUDE.md ข้อ 6.2) */
const REAL_POINTS = [
  { pixel: 204, meter: 4.00 },
  { pixel: 247, meter: 3.80 },
  { pixel: 286, meter: 3.60 },
  { pixel: 309, meter: 3.50 },
  { pixel: 327, meter: 3.40 },
  { pixel: 368, meter: 3.20 },
];

describe('WaterLevelCalculator — การแปลงพิกเซลเป็นเมตร', () => {
  test('ตัวอย่างในเอกสาร: พิกเซล 298 ต้องได้ 3.55 เมตร', () => {
    const calculator = new WaterLevelCalculator(REAL_POINTS);
    // 298 อยู่ระหว่าง (286, 3.60) กับ (309, 3.50) → 3.60 − (12÷23 × 0.10)
    assert.equal(calculator.pixelToMeter(298).value, 3.55);
  });

  test('ค่าที่ตรงกับจุดเทียบพอดีต้องได้ค่าเดิมทุกจุด', () => {
    const calculator = new WaterLevelCalculator(REAL_POINTS);
    for (const point of REAL_POINTS) {
      assert.equal(
        calculator.pixelToMeter(point.pixel).value, point.meter,
        `พิกเซล ${point.pixel} ควรได้ ${point.meter} เมตร`,
      );
    }
  });

  test('ค่าในช่วงต้องอยู่ระหว่างจุดที่ขนาบเสมอ', () => {
    const calculator = new WaterLevelCalculator(REAL_POINTS);
    const meter = calculator.pixelToMeter(260).value;
    assert.ok(meter < 3.80 && meter > 3.60, `260 px ควรอยู่ระหว่าง 3.60–3.80 (ได้ ${meter})`);
  });

  test('ค่านอกช่วงด้านบน (พิกเซลน้อยกว่าจุดแรก) ต้องได้ค่าสูงกว่าจุดแรก', () => {
    const calculator = new WaterLevelCalculator(REAL_POINTS);
    // พิกเซลน้อย = น้ำสูง → เมตรต้องมากกว่า 4.00
    assert.ok(calculator.pixelToMeter(150).value > 4.00);
  });

  test('ค่านอกช่วงด้านล่าง (พิกเซลมากกว่าจุดสุดท้าย) ต้องได้ค่าต่ำกว่าจุดสุดท้าย', () => {
    const calculator = new WaterLevelCalculator(REAL_POINTS);
    assert.ok(calculator.pixelToMeter(400).value < 3.20);
  });

  test('จุดเทียบค่าไม่ครบ 2 จุดต้องโยน ValidationError — ห้ามมีค่าสำรอง', () => {
    assert.throws(() => new WaterLevelCalculator([]), ValidationError);
    assert.throws(() => new WaterLevelCalculator([{ pixel: 100, meter: 5 }]), ValidationError);
    assert.throws(() => new WaterLevelCalculator(null), ValidationError);
  });

  test('จุดเทียบค่าซ้ำที่ให้ค่าเมตรเดียวกันถือว่าใช้ได้ (ยุบเหลือจุดเดียว)', () => {
    const calculator = new WaterLevelCalculator([
      { pixel: 200, meter: 4.0 }, { pixel: 200, meter: 4.0 }, { pixel: 300, meter: 3.0 },
    ]);
    assert.equal(calculator.pointCount, 2);
  });

  test('จุดเทียบค่าซ้ำที่ให้ค่าเมตรต่างกันต้องโยน ValidationError', () => {
    assert.throws(
      () => new WaterLevelCalculator([
        { pixel: 200, meter: 4.0 }, { pixel: 200, meter: 3.5 }, { pixel: 300, meter: 3.0 },
      ]),
      ValidationError,
    );
  });

  test('จุดที่ส่งมาไม่เรียงลำดับต้องถูกเรียงให้เองก่อนคำนวณ', () => {
    const shuffled = [...REAL_POINTS].reverse();
    const calculator = new WaterLevelCalculator(shuffled);
    assert.equal(calculator.pixelToMeter(298).value, 3.55);
    assert.deepEqual(calculator.points.map((p) => p.pixel), [204, 247, 286, 309, 327, 368]);
  });

  test('รับค่าเป็น PixelLevel ได้เหมือนตัวเลขดิบ', () => {
    const calculator = new WaterLevelCalculator(REAL_POINTS);
    assert.equal(calculator.pixelToMeter(new PixelLevel(298)).value, 3.55);
  });

  test('ผลลัพธ์ต้องเป็น MeterLevel ไม่ใช่ตัวเลขดิบ (กันสลับหน่วย)', () => {
    const calculator = new WaterLevelCalculator(REAL_POINTS);
    assert.ok(calculator.pixelToMeter(298) instanceof MeterLevel);
  });
});

describe('WaterLevelCalculator — การแปลงเมตรกลับเป็นพิกเซล', () => {
  test('meterToPixel เป็นเมท็อดผกผันของ pixelToMeter', () => {
    const calculator = new WaterLevelCalculator(REAL_POINTS);
    for (const pixel of [210, 250, 298, 320, 360]) {
      const meter = calculator.pixelToMeter(pixel);
      const back = calculator.meterToPixel(meter).value;
      assert.ok(
        Math.abs(back - pixel) <= 1,
        `${pixel} px → ${meter.value} ม. → ${back} px (คลาดเคลื่อนเกิน 1 พิกเซล)`,
      );
    }
  });

  test('ค่าที่ตรงกับจุดเทียบพอดีต้องแปลงกลับได้ตรงเป๊ะ', () => {
    const calculator = new WaterLevelCalculator(REAL_POINTS);
    assert.equal(calculator.meterToPixel(4.00).value, 204);
    assert.equal(calculator.meterToPixel(3.20).value, 368);
  });

  test('ค่าเมตรนอกช่วงต้องคำนวณต่อด้วยความชันของคู่ปลาย', () => {
    const calculator = new WaterLevelCalculator(REAL_POINTS);
    assert.ok(calculator.meterToPixel(4.50).value < 204);
    assert.ok(calculator.meterToPixel(3.00).value > 368);
  });

  test('ผลลัพธ์ต้องเป็น PixelLevel', () => {
    const calculator = new WaterLevelCalculator(REAL_POINTS);
    assert.ok(calculator.meterToPixel(3.55) instanceof PixelLevel);
  });

  test('จุดเทียบค่าที่ให้ค่าเมตรเท่ากันทั้งคู่ต้องโยนเมื่อแปลงกลับ', () => {
    const calculator = new WaterLevelCalculator([
      { pixel: 100, meter: 2.0 }, { pixel: 200, meter: 2.0 },
    ]);
    assert.throws(() => calculator.meterToPixel(2.0), ValidationError);
  });
});

describe('WaterLevelCalculator — ตัวช่วยอื่น', () => {
  test('tryCreate คืน null แทนการโยนเมื่อจุดไม่พอ', () => {
    assert.equal(WaterLevelCalculator.tryCreate([]), null);
    assert.ok(WaterLevelCalculator.tryCreate(REAL_POINTS) instanceof WaterLevelCalculator);
  });

  test('range รายงานช่วงที่เทียบค่าไว้ถูกต้อง', () => {
    const { minPixel, maxPixel, minMeter, maxMeter } =
      new WaterLevelCalculator(REAL_POINTS).range;
    assert.deepEqual({ minPixel, maxPixel, minMeter, maxMeter },
      { minPixel: 204, maxPixel: 368, minMeter: 3.20, maxMeter: 4.00 });
  });

  test('previewTable สร้างตารางเทียบค่าครอบคลุมทั้งช่วง', () => {
    const rows = new WaterLevelCalculator(REAL_POINTS).previewTable(20);
    assert.equal(rows[0].pixel, 204);
    assert.ok(rows.length > 5);
    // ค่าเมตรต้องลดลงเรื่อย ๆ เพราะพิกเซลเพิ่มขึ้น
    for (let i = 1; i < rows.length; i += 1) {
      assert.ok(rows[i].meter <= rows[i - 1].meter);
    }
  });

  test('วัตถุถูก freeze — เปลี่ยนจุดเทียบค่าหลังสร้างไม่ได้', () => {
    const calculator = new WaterLevelCalculator(REAL_POINTS);
    const copy = calculator.points;
    copy.push({ pixel: 999, meter: 0 });
    assert.equal(calculator.pointCount, 6, 'การแก้สำเนาต้องไม่กระทบภายใน');
  });
});
