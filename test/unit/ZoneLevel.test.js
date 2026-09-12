import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ZoneLevel } from '../../src/models/values/ZoneLevel.js';
import { PixelLevel } from '../../src/models/values/PixelLevel.js';
import { ValidationError } from '../../src/core/errors/index.js';

/** ขอบเขตโซนจริงของจุดวัดที่ 1 จาก `data/bangpai.sql` */
const ZONES = [
  { key: 'CRITICAL', yPosition: 204 },
  { key: 'SEVERE', yPosition: 247 },
  { key: 'DANGER', yPosition: 286 },
  { key: 'WATCH', yPosition: 309 },
  { key: 'HIGH', yPosition: 327 },
  { key: 'NORMAL', yPosition: 368 },
];

describe('ZoneLevel — นิยามโซน 6 ระดับ', () => {
  test('มีโซนครบ 6 ระดับเรียงตามความร้ายแรง', () => {
    const all = ZoneLevel.all();
    assert.equal(all.length, 6);
    assert.deepEqual(all.map((z) => z.key),
      ['CRITICAL', 'SEVERE', 'DANGER', 'WATCH', 'HIGH', 'NORMAL']);
    assert.deepEqual(all.map((z) => z.severity), [1, 2, 3, 4, 5, 6]);
  });

  test('สีตรงตามตารางใน CLAUDE.md ข้อ 6.3', () => {
    assert.equal(ZoneLevel.CRITICAL.color, '#EF4444');
    assert.equal(ZoneLevel.SEVERE.color, '#F97316');
    assert.equal(ZoneLevel.DANGER.color, '#EAB308');
    assert.equal(ZoneLevel.WATCH.color, '#22C55E');
    assert.equal(ZoneLevel.HIGH.color, '#06B6D4');
    assert.equal(ZoneLevel.NORMAL.color, '#E5E7EB');
  });

  test('เฉพาะ CRITICAL และ SEVERE ที่แจ้งเตือนเป็นค่าเริ่มต้น', () => {
    assert.deepEqual(
      ZoneLevel.all().filter((z) => z.alertByDefault).map((z) => z.key),
      ['CRITICAL', 'SEVERE'],
    );
  });

  test('isCritical เป็นจริงเฉพาะสองโซนแรก', () => {
    assert.equal(ZoneLevel.CRITICAL.isCritical, true);
    assert.equal(ZoneLevel.SEVERE.isCritical, true);
    assert.equal(ZoneLevel.DANGER.isCritical, false);
  });
});

describe('ZoneLevel — การค้นหา', () => {
  test('fromKey ค้นด้วยคีย์ภาษาอังกฤษ (ไม่สนตัวพิมพ์)', () => {
    assert.equal(ZoneLevel.fromKey('CRITICAL'), ZoneLevel.CRITICAL);
    assert.equal(ZoneLevel.fromKey('critical'), ZoneLevel.CRITICAL);
    assert.equal(ZoneLevel.fromKey('ไม่มีจริง'), null);
    assert.equal(ZoneLevel.fromKey(null), null);
  });

  test('fromLabel ค้นด้วยชื่อไทย — ใช้ตอนย้ายข้อมูลจากระบบเดิม', () => {
    assert.equal(ZoneLevel.fromLabel('วิกฤตมาก'), ZoneLevel.CRITICAL);
    assert.equal(ZoneLevel.fromLabel('ปกติ'), ZoneLevel.NORMAL);
    assert.equal(ZoneLevel.fromLabel('ระดับน้ำสูง'), ZoneLevel.HIGH);
  });

  test('parse รับได้ทั้งคีย์และชื่อไทย', () => {
    assert.equal(ZoneLevel.parse('SEVERE'), ZoneLevel.SEVERE);
    assert.equal(ZoneLevel.parse('วิกฤต'), ZoneLevel.SEVERE);
  });
});

describe('ZoneLevel.resolve — เลือกโซนจากระดับน้ำ', () => {
  test('ค่าที่ขอบโซนพอดีต้องเลือกโซนนั้น ไม่ใช่โซนก่อนหน้า', () => {
    const cases = [
      [204, 'CRITICAL'], [247, 'SEVERE'], [286, 'DANGER'],
      [309, 'WATCH'], [327, 'HIGH'], [368, 'NORMAL'],
    ];
    for (const [pixel, expected] of cases) {
      assert.equal(
        ZoneLevel.resolve(new PixelLevel(pixel), ZONES).key, expected,
        `พิกเซล ${pixel} (ขอบโซนพอดี) ต้องได้ ${expected}`,
      );
    }
  });

  test('ค่าที่ต่ำกว่าขอบ 1 พิกเซลต้องได้โซนที่ร้ายแรงกว่า', () => {
    assert.equal(ZoneLevel.resolve(new PixelLevel(246), ZONES).key, 'CRITICAL');
    assert.equal(ZoneLevel.resolve(new PixelLevel(285), ZONES).key, 'SEVERE');
    assert.equal(ZoneLevel.resolve(new PixelLevel(367), ZONES).key, 'HIGH');
  });

  test('ค่าที่อยู่เหนือขอบบนสุด (น้ำสูงมาก) ต้องได้โซนร้ายแรงที่สุด', () => {
    assert.equal(ZoneLevel.resolve(new PixelLevel(0), ZONES).key, 'CRITICAL');
    assert.equal(ZoneLevel.resolve(new PixelLevel(100), ZONES).key, 'CRITICAL');
  });

  test('ค่าที่ต่ำกว่าขอบล่างสุด (น้ำน้อยมาก) ต้องได้ปกติ', () => {
    assert.equal(ZoneLevel.resolve(new PixelLevel(1000), ZONES).key, 'NORMAL');
  });

  test('โซนที่ส่งมาไม่เรียงลำดับต้องถูกเรียงให้เองก่อนตัดสิน', () => {
    const shuffled = [...ZONES].reverse();
    assert.equal(ZoneLevel.resolve(new PixelLevel(298), shuffled).key, 'DANGER');
  });

  test('ยังไม่ได้กำหนดโซนต้องโยน ValidationError', () => {
    assert.throws(() => ZoneLevel.resolve(new PixelLevel(300), []), ValidationError);
    assert.throws(() => ZoneLevel.resolve(new PixelLevel(300), null), ValidationError);
  });

  test('ต้องส่ง PixelLevel ไม่ใช่ตัวเลขดิบ (กันสลับหน่วย)', () => {
    assert.throws(() => ZoneLevel.resolve(300, ZONES), ValidationError);
  });

  test('รองรับรูปแบบฟิลด์ y_position ของระบบเดิม', () => {
    const legacy = [
      { name: 'วิกฤตมาก', y_position: 204 },
      { name: 'ปกติ', y_position: 368 },
    ];
    assert.equal(ZoneLevel.resolve(new PixelLevel(400), legacy).key, 'NORMAL');
    assert.equal(ZoneLevel.resolve(new PixelLevel(210), legacy).key, 'CRITICAL');
  });
});

describe('ZoneLevel.hasWorsened — ตัดสินว่าสถานการณ์แย่ลงหรือไม่', () => {
  test('ยังไม่เคยแจ้งเตือน → ถือว่าแย่ลง (ต้องแจ้ง)', () => {
    assert.equal(ZoneLevel.hasWorsened(null, ZoneLevel.SEVERE), true);
  });

  test('โซนร้ายแรงขึ้น → แย่ลง', () => {
    assert.equal(ZoneLevel.hasWorsened(ZoneLevel.SEVERE, ZoneLevel.CRITICAL), true);
    assert.equal(ZoneLevel.hasWorsened(ZoneLevel.NORMAL, ZoneLevel.DANGER), true);
  });

  test('โซนเดิม → ไม่ถือว่าแย่ลง (ต้องรอ cooldown)', () => {
    assert.equal(ZoneLevel.hasWorsened(ZoneLevel.SEVERE, ZoneLevel.SEVERE), false);
  });

  test('โซนดีขึ้น → ไม่ถือว่าแย่ลง', () => {
    assert.equal(ZoneLevel.hasWorsened(ZoneLevel.CRITICAL, ZoneLevel.WATCH), false);
  });
});
