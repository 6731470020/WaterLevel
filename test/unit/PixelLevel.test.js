import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PixelLevel } from '../../src/models/values/PixelLevel.js';
import { MeterLevel } from '../../src/models/values/MeterLevel.js';
import { ValidationError } from '../../src/core/errors/index.js';

describe('PixelLevel — ทิศทางแกน Y (จุดที่ผิดบ่อยที่สุด)', () => {
  test('พิกเซลน้อย = น้ำสูงกว่า', () => {
    const high = new PixelLevel(204);
    const low = new PixelLevel(368);
    assert.equal(high.isHigherThan(low), true, '204 px ต้องสูงกว่า 368 px');
    assert.equal(low.isHigherThan(high), false);
  });

  test('พิกเซลมาก = น้ำต่ำกว่า', () => {
    assert.equal(new PixelLevel(368).isLowerThan(new PixelLevel(204)), true);
  });

  test('highest คืนค่าที่พิกเซลน้อยที่สุด', () => {
    const levels = [new PixelLevel(300), new PixelLevel(204), new PixelLevel(368)];
    assert.equal(PixelLevel.highest(levels).value, 204);
  });

  test('lowest คืนค่าที่พิกเซลมากที่สุด', () => {
    const levels = [new PixelLevel(300), new PixelLevel(204), new PixelLevel(368)];
    assert.equal(PixelLevel.lowest(levels).value, 368);
  });
});

describe('PixelLevel — ความไม่เปลี่ยนแปลงและการตรวจค่า', () => {
  test('ค่าติดลบต้องโยน ValidationError', () => {
    assert.throws(() => new PixelLevel(-1), ValidationError);
  });

  test('ค่าที่ไม่ใช่ตัวเลขต้องโยน ValidationError', () => {
    assert.throws(() => new PixelLevel('abc'), ValidationError);
    assert.throws(() => new PixelLevel(NaN), ValidationError);
    assert.throws(() => new PixelLevel(Infinity), ValidationError);
    assert.throws(() => new PixelLevel(null), ValidationError);
  });

  test('ทศนิยมถูกปัดเป็นจำนวนเต็ม', () => {
    assert.equal(new PixelLevel(204.4).value, 204);
    assert.equal(new PixelLevel(204.6).value, 205);
  });

  test('วัตถุถูก freeze — เปลี่ยนค่าไม่ได้', () => {
    const level = new PixelLevel(300);
    assert.ok(Object.isFrozen(level));
  });

  test('from คืน null สำหรับค่าว่าง', () => {
    assert.equal(PixelLevel.from(null), null);
    assert.equal(PixelLevel.from(undefined), null);
    assert.equal(PixelLevel.from(''), null);
    assert.equal(PixelLevel.from(0).value, 0);
  });
});

describe('PixelLevel — การคำนวณ', () => {
  test('differenceFrom คืนผลต่างสัมบูรณ์เสมอ', () => {
    assert.equal(new PixelLevel(300).differenceFrom(new PixelLevel(350)), 50);
    assert.equal(new PixelLevel(350).differenceFrom(new PixelLevel(300)), 50);
  });

  test('average ปัดเป็นจำนวนเต็ม', () => {
    const levels = [new PixelLevel(350), new PixelLevel(360), new PixelLevel(375)];
    assert.equal(PixelLevel.average(levels).value, 362);
  });

  test('spread คืนช่วงกระจาย', () => {
    const levels = [new PixelLevel(350), new PixelLevel(360), new PixelLevel(375)];
    assert.equal(PixelLevel.spread(levels), 25);
    assert.equal(PixelLevel.spread([]), 0);
  });

  test('equals เทียบเฉพาะกับ PixelLevel ด้วยกัน', () => {
    assert.equal(new PixelLevel(300).equals(new PixelLevel(300)), true);
    assert.equal(new PixelLevel(300).equals(300), false);
  });
});

describe('PixelLevel กับ MeterLevel — กันสลับหน่วยโดยไม่ตั้งใจ', () => {
  test('เปรียบเทียบข้ามหน่วยต้องโยนข้อผิดพลาด', () => {
    const pixel = new PixelLevel(300);
    const meter = new MeterLevel(3.5);
    assert.throws(() => pixel.isHigherThan(meter), ValidationError);
    assert.throws(() => meter.isHigherThan(pixel), ValidationError);
  });

  test('เป็นคนละคลาสกันจริง', () => {
    assert.ok(new PixelLevel(300) instanceof PixelLevel);
    assert.ok(!(new PixelLevel(300) instanceof MeterLevel));
    assert.ok(new MeterLevel(3.5) instanceof MeterLevel);
    assert.ok(!(new MeterLevel(3.5) instanceof PixelLevel));
  });

  test('MeterLevel ทิศทางตรงข้าม: ค่ามาก = น้ำสูง', () => {
    assert.equal(new MeterLevel(4.0).isHigherThan(new MeterLevel(3.2)), true);
  });

  test('MeterLevel เก็บทศนิยม 2 ตำแหน่ง', () => {
    assert.equal(new MeterLevel(3.5555).value, 3.56);
    assert.equal(new MeterLevel(3.554).value, 3.55);
  });

  test('toString แสดงหน่วยชัดเจน', () => {
    assert.equal(new PixelLevel(300).toString(), '300 px');
    assert.equal(new MeterLevel(3.5).toString(), '3.50 ม.');
  });
});
