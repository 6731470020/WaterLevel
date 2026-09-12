import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { VariationValidator } from '../../src/services/VariationValidator.js';
import { PixelLevel } from '../../src/models/values/PixelLevel.js';

/** ตัวช่วยสร้าง PixelLevel ให้อ่านง่าย */
const px = (value) => new PixelLevel(value);

describe('VariationValidator — ขั้นที่ 1–3: ตัดสินว่าต้องยืนยันหรือไม่', () => {
  const validator = new VariationValidator();

  test('ยังไม่มีประวัติ → รับค่าแรกทันที', () => {
    const result = validator.evaluate(px(300), []);
    assert.equal(result.accepted, true);
    assert.equal(result.needsConfirmation, false);
    assert.equal(result.baseline, null);
  });

  test('ต่างน้อยกว่า 50 พิกเซล → บันทึกทันที', () => {
    const result = validator.evaluate(px(349), [px(300), px(300), px(300)]);
    assert.equal(result.accepted, true);
    assert.equal(result.variation, 49);
  });

  test('ต่าง 50 พิกเซลพอดี → ยังถือว่าผ่าน (เกณฑ์คือ "ไม่เกิน")', () => {
    const result = validator.evaluate(px(350), [px(300), px(300), px(300)]);
    assert.equal(result.accepted, true, 'ที่ขอบเกณฑ์พอดีต้องผ่าน');
    assert.equal(result.variation, 50);
  });

  test('ต่าง 51 พิกเซล → ต้องเข้าโหมดยืนยัน', () => {
    const result = validator.evaluate(px(351), [px(300), px(300), px(300)]);
    assert.equal(result.accepted, false);
    assert.equal(result.needsConfirmation, true);
    assert.equal(result.variation, 51);
  });

  test('เทียบกับค่าเฉลี่ยของประวัติ ไม่ใช่ค่าล่าสุดตัวเดียว', () => {
    // ค่าเฉลี่ยของ 300, 310, 320 = 310 → ต่างจาก 360 เท่ากับ 50 พอดี
    const result = validator.evaluate(px(360), [px(300), px(310), px(320)]);
    assert.equal(result.baseline, 310);
    assert.equal(result.variation, 50);
    assert.equal(result.accepted, true);
  });

  test('ค่าที่ต่ำกว่าฐานมากก็ต้องเข้าโหมดยืนยันเช่นกัน', () => {
    const result = validator.evaluate(px(200), [px(300), px(300), px(300)]);
    assert.equal(result.needsConfirmation, true);
    assert.equal(result.variation, 100);
  });

  test('เกณฑ์ปรับได้ผ่าน constructor', () => {
    const strict = new VariationValidator({ maxVariationPx: 10 });
    assert.equal(strict.evaluate(px(311), [px(300)]).needsConfirmation, true);
    assert.equal(strict.evaluate(px(310), [px(300)]).accepted, true);
  });
});

describe('VariationValidator — ขั้นที่ 4–5: ตัดสินผลการยืนยัน', () => {
  const validator = new VariationValidator();

  test('ค่ากระจาย 25 พิกเซลพอดี → ผ่าน และใช้ค่าเฉลี่ย', () => {
    const result = validator.confirm([px(350), px(360), px(375)]);
    assert.equal(result.confirmed, true, 'ที่ขอบเกณฑ์พอดีต้องผ่าน');
    assert.equal(result.spread, 25);
    assert.equal(result.level.value, 362, 'ต้องใช้ค่าเฉลี่ย (350+360+375)/3 = 361.67 → 362');
  });

  test('ค่ากระจาย 26 พิกเซล → ไม่ผ่าน และไม่คืนค่าวัด', () => {
    const result = validator.confirm([px(350), px(360), px(376)]);
    assert.equal(result.confirmed, false);
    assert.equal(result.level, null, 'ไม่ผ่านต้องไม่มีค่าให้บันทึก');
    assert.equal(result.spread, 26);
  });

  test('วัดซ้ำไม่สำเร็จเลย → ไม่ผ่าน', () => {
    const result = validator.confirm([]);
    assert.equal(result.confirmed, false);
    assert.equal(result.level, null);
    assert.equal(result.attempts, 0);
  });

  test('วัดซ้ำได้ครั้งเดียว → ช่วงกระจายเป็น 0 จึงผ่าน', () => {
    const result = validator.confirm([px(300)]);
    assert.equal(result.confirmed, true);
    assert.equal(result.spread, 0);
    assert.equal(result.level.value, 300);
  });

  test('ค่าที่ยืนยันได้ต้องเป็น PixelLevel — บั๊กระบบเดิมคือทิ้งค่านี้ไป', () => {
    const result = validator.confirm([px(350), px(355), px(360)]);
    assert.ok(result.level instanceof PixelLevel);
    assert.equal(result.confirmed, true);
  });

  test('เหตุผลต้องเป็นข้อความภาษาไทยที่อธิบายได้', () => {
    const passed = validator.confirm([px(350), px(355)]);
    const failed = validator.confirm([px(300), px(400)]);
    assert.match(passed.reason, /ค่าเฉลี่ย/);
    assert.match(failed.reason, /ไม่บันทึก/);
  });
});

describe('VariationValidator — ค่าตั้งค่า', () => {
  test('ค่าเริ่มต้นตรงตาม CLAUDE.md ข้อ 6.4', () => {
    const validator = new VariationValidator();
    assert.equal(validator.maxVariationPx, 50);
    assert.equal(validator.confirmationAttempts, 3);
    assert.equal(validator.confirmationDelayMs, 10000);
    assert.equal(validator.consistencyThresholdPx, 25);
  });

  test('วัตถุถูก freeze — เปลี่ยนเกณฑ์หลังสร้างไม่ได้', () => {
    const validator = new VariationValidator();
    assert.ok(Object.isFrozen(validator));
  });
});
