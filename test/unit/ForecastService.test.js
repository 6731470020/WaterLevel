import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ForecastService } from '../../src/services/ForecastService.js';
import { ValidationError } from '../../src/core/errors/index.js';

const service = new ForecastService();
const BASE = new Date('2026-08-22T06:00:00+07:00');

/**
 * สร้างชุดค่าวัดจำลอง
 * @param {number} count จำนวนจุด
 * @param {(index: number) => number} meterAt ฟังก์ชันคืนค่าเมตรของแต่ละจุด
 * @param {number} [minutesApart=20] ระยะห่างเป็นนาที
 * @returns {Array<{measuredAt: Date, meter: number}>}
 */
function series(count, meterAt, minutesApart = 20) {
  return Array.from({ length: count }, (_, index) => ({
    measuredAt: new Date(BASE.getTime() + index * minutesApart * 60_000),
    meter: meterAt(index),
  }));
}

describe('ForecastService — พยากรณ์แนวโน้มระดับน้ำ', () => {
  test('น้ำขึ้นสม่ำเสมอ ต้องพยากรณ์ต่อได้ตรงและบอกว่ากำลังขึ้น', () => {
    // ขึ้น 0.30 เมตรต่อชั่วโมง (0.10 ต่อ 20 นาที)
    const result = service.forecast(series(12, (i) => 1.0 + i * 0.1), { hours: 3 });

    assert.equal(result.available, true);
    assert.equal(result.trend, 'RISING');
    assert.equal(result.slopePerHour, 0.3);
    assert.equal(result.confidence, 'HIGH');
    assert.equal(result.points.length, 3);

    // จุดสุดท้ายของข้อมูลคือ 1.0 + 11×0.1 = 2.10 → อีก 3 ชั่วโมง = 2.10 + 0.9
    assert.equal(result.points.at(-1).meter, 3.0);
    assert.equal(result.points[0].meter, 2.4);
  });

  test('น้ำลงต้องบอกว่ากำลังลงและความชันติดลบ', () => {
    const result = service.forecast(series(12, (i) => 3.0 - i * 0.05), { hours: 2 });
    assert.equal(result.trend, 'FALLING');
    assert.ok(result.slopePerHour < 0);
  });

  test('ระดับน้ำคงที่ต้องบอกว่าทรงตัว ไม่ใช่ไม่ชัดเจน', () => {
    const result = service.forecast(series(12, () => 2.0), { hours: 3 });
    assert.equal(result.trend, 'STABLE');
    assert.equal(result.rSquared, 1, 'ค่าคงที่คือเส้นตรงที่พอดีสมบูรณ์');
    assert.equal(result.points.at(-1).meter, 2);
  });

  test('ข้อมูลกระโดดไปมาต้องบอกว่าแนวโน้มไม่ชัด', () => {
    const result = service.forecast(series(12, (i) => (i % 2 === 0 ? 1.0 : 3.0)), { hours: 2 });
    assert.equal(result.trend, 'UNCLEAR');
    assert.equal(result.confidence, 'LOW');
    assert.ok(result.marginMeters > 0.5, 'ช่วงความคลาดเคลื่อนต้องกว้างเมื่อข้อมูลกระจาย');
  });

  test('จุดน้อยเกินไปต้องไม่พยากรณ์ และบอกเหตุผลเป็นภาษาไทย', () => {
    const result = service.forecast(series(3, (i) => 1 + i * 0.1));
    assert.equal(result.available, false);
    assert.match(result.reason, /อย่างน้อย 6 ครั้ง/);
  });

  test('ข้อมูลกระจุกในช่วงสั้นเกินไปต้องไม่พยากรณ์', () => {
    // 10 จุดห่างกัน 5 นาที = 45 นาที ไม่ถึง 2 ชั่วโมง
    const result = service.forecast(series(10, (i) => 1 + i * 0.01, 5));
    assert.equal(result.available, false);
    assert.match(result.reason, /ชั่วโมง/);
  });

  test('ค่าที่ใช้ไม่ได้ต้องถูกคัดทิ้ง ไม่ทำให้ผลเพี้ยน', () => {
    const dirty = [
      ...series(12, (i) => 1.0 + i * 0.1),
      { measuredAt: new Date(BASE.getTime() + 3_600_000), meter: null },
      { measuredAt: new Date('ไม่ใช่วันที่'), meter: 2.0 },
      { measuredAt: new Date(BASE.getTime() + 7_200_000), meter: Number.NaN },
    ];
    const result = service.forecast(dirty, { hours: 1 });
    assert.equal(result.basedOn, 12);
    assert.equal(result.slopePerHour, 0.3);
  });

  test('เวลาซ้ำกันต้องใช้ค่าหลังสุด ไม่นับซ้ำ', () => {
    const at = new Date(BASE.getTime() + 60_000);
    const result = service.forecast([
      ...series(12, (i) => 1.0 + i * 0.1),
      { measuredAt: at, meter: 9.9 },
      { measuredAt: at, meter: 1.05 },
    ], { hours: 1 });
    assert.equal(result.basedOn, 13, 'จุดเวลาซ้ำต้องนับเป็นจุดเดียว');
  });

  test('ข้อมูลเรียงสลับลำดับต้องให้ผลเท่ากับที่เรียงมาแล้ว', () => {
    const ordered = series(12, (i) => 1.0 + i * 0.1);
    const shuffled = [...ordered].reverse();
    assert.deepEqual(
      service.forecast(shuffled, { hours: 2 }).points,
      service.forecast(ordered, { hours: 2 }).points,
    );
  });

  test('ช่วงพยากรณ์ที่ไม่สมเหตุสมผลต้องถูกปฏิเสธ', () => {
    const data = series(12, (i) => 1 + i * 0.1);
    for (const bad of [{ hours: 0 }, { hours: -3 }, { hours: 200 }, { stepHours: 0 }]) {
      assert.throws(() => service.forecast(data, bad), ValidationError,
        `ต้องปฏิเสธ ${JSON.stringify(bad)}`);
    }
  });

  test('ช่วงความเชื่อมั่นต้องคร่อมค่าที่พยากรณ์เสมอ', () => {
    const result = service.forecast(series(12, (i) => 1.0 + i * 0.1 + (i % 3) * 0.02), { hours: 3 });
    for (const point of result.points) {
      assert.ok(point.low <= point.meter && point.meter <= point.high,
        `ช่วง ${point.low}–${point.high} ต้องคร่อม ${point.meter}`);
    }
  });
});
