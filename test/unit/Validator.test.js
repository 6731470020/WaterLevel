import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Validator } from '../../src/core/Validator.js';
import { ValidationError } from '../../src/core/errors/index.js';

describe('Validator — การตรวจพื้นฐาน', () => {
  test('รวบรวมข้อผิดพลาดทุกฟิลด์พร้อมกัน ไม่หยุดที่ข้อแรก', () => {
    const validator = new Validator({})
      .required('a', 'ฟิลด์ A')
      .required('b', 'ฟิลด์ B')
      .required('c', 'ฟิลด์ C');
    assert.equal(validator.errors.length, 3);
  });

  test('รายงานข้อผิดพลาดฟิลด์ละหนึ่งข้อความเท่านั้น', () => {
    const validator = new Validator({ name: '' })
      .required('name', 'ชื่อ')
      .string('name', { min: 5, optional: false });
    assert.equal(validator.errors.length, 1);
  });

  test('validate คืนข้อมูลที่สะอาดเมื่อผ่าน', () => {
    const clean = new Validator({ name: '  สมชาย  ', age: '30' })
      .string('name').integer('age').validate();
    assert.equal(clean.name, 'สมชาย', 'ต้องตัดช่องว่างหัวท้าย');
    assert.equal(clean.age, 30, 'ต้องแปลงเป็นตัวเลข');
  });

  test('validate โยน ValidationError พร้อมรายละเอียดเมื่อไม่ผ่าน', () => {
    assert.throws(() => new Validator({}).required('name', 'ชื่อ').validate(), (error) => {
      assert.ok(error instanceof ValidationError);
      assert.equal(error.statusCode, 422);
      assert.equal(error.details[0].field, 'name');
      assert.match(error.details[0].message, /ชื่อ/);
      return true;
    });
  });

  test('ฟิลด์ที่ไม่บังคับและไม่ได้ส่งมาต้องไม่ผิดพลาด', () => {
    const clean = new Validator({}).string('optional').integer('num').validate();
    assert.equal(clean.optional, undefined);
  });
});

describe('Validator — ชนิดข้อมูล', () => {
  test('integer ตรวจช่วงค่า', () => {
    assert.equal(new Validator({ n: '5' }).integer('n', { min: 1, max: 10 }).passes, true);
    assert.equal(new Validator({ n: '11' }).integer('n', { min: 1, max: 10 }).passes, false);
    assert.equal(new Validator({ n: '1.5' }).integer('n').passes, false);
  });

  test('email ตรวจรูปแบบและแปลงเป็นตัวพิมพ์เล็ก', () => {
    const clean = new Validator({ email: '  Somchai@Example.COM ' }).email('email').validate();
    assert.equal(clean.email, 'somchai@example.com');
    assert.equal(new Validator({ email: 'ไม่ใช่อีเมล' }).email('email').passes, false);
    assert.equal(new Validator({ email: 'a@b' }).email('email').passes, false);
  });

  test('oneOf จำกัดค่าที่อนุญาต', () => {
    assert.equal(new Validator({ t: 'm3u8' }).oneOf('t', ['m3u8', 'mjpeg']).passes, true);
    assert.equal(new Validator({ t: 'rtsp' }).oneOf('t', ['m3u8', 'mjpeg']).passes, false);
  });

  test('boolean รับค่าจาก checkbox ของ HTML และ JSON', () => {
    for (const value of ['1', 'true', 'on', 'yes', true]) {
      assert.equal(new Validator({ b: value }).boolean('b').validate().b, true, `${value}`);
    }
    for (const value of ['0', 'false', 'off']) {
      assert.equal(new Validator({ b: value }).boolean('b').validate().b, false, `${value}`);
    }
    assert.equal(new Validator({}).boolean('b', true).validate().b, true, 'ใช้ค่าเริ่มต้น');
  });

  test('date ตรวจรูปแบบ ปปปป-ดด-วว', () => {
    assert.equal(new Validator({ d: '2026-08-21' }).date('d').passes, true);
    assert.equal(new Validator({ d: '21/08/2026' }).date('d').passes, false);
    assert.equal(new Validator({ d: '2026-13-45' }).date('d').passes, false);
  });

  test('hexColor ตรวจและทำให้เป็นรูปแบบเดียวกัน', () => {
    assert.equal(new Validator({ c: '#ef4444' }).hexColor('c').validate().c, 'EF4444');
    assert.equal(new Validator({ c: 'EF4444' }).hexColor('c').validate().c, 'EF4444');
    assert.equal(new Validator({ c: 'xyz' }).hexColor('c').passes, false);
  });
});

describe('Validator.url — ป้องกัน SSRF (CLAUDE.md ข้อ 13)', () => {
  test('URL สาธารณะผ่าน', () => {
    assert.equal(
      new Validator({ u: 'https://live1.example.com/hls/cam1/index.m3u8' }).url('u').passes,
      true,
    );
  });

  test('โปรโตคอลอื่นนอกจาก http/https ต้องไม่ผ่าน', () => {
    for (const url of ['file:///etc/passwd', 'ftp://example.com', 'gopher://x']) {
      assert.equal(new Validator({ u: url }).url('u').passes, false, url);
    }
  });

  test('IP ภายในทุกช่วงต้องไม่ผ่านโดยค่าเริ่มต้น', () => {
    const blocked = [
      'http://127.0.0.1/cam', 'http://localhost/cam',
      'http://10.0.0.5/cam', 'http://172.16.0.1/cam', 'http://172.31.255.254/cam',
      'http://192.168.1.1/cam', 'http://169.254.169.254/latest/meta-data',
      'http://0.0.0.0/cam', 'http://100.64.0.1/cam',
      'http://[::1]/cam', 'http://router.local/cam',
    ];
    for (const url of blocked) {
      assert.equal(new Validator({ u: url }).url('u').passes, false, `ต้องบล็อก: ${url}`);
    }
  });

  test('ช่วงที่ดูคล้ายแต่เป็นสาธารณะต้องผ่าน', () => {
    for (const url of ['http://172.32.0.1/cam', 'http://11.0.0.1/cam', 'http://192.169.1.1/cam']) {
      assert.equal(new Validator({ u: url }).url('u').passes, true, `ต้องผ่าน: ${url}`);
    }
  });

  test('อนุญาต IP ภายในได้เมื่อตั้งค่าไว้ชัดเจน', () => {
    assert.equal(
      new Validator({ u: 'http://192.168.1.50/cam' }).url('u', { allowPrivate: true }).passes,
      true,
    );
  });

  test('isPrivateHost ตรวจได้โดยตรง', () => {
    assert.equal(Validator.isPrivateHost('10.1.2.3'), true);
    assert.equal(Validator.isPrivateHost('8.8.8.8'), false);
    assert.equal(Validator.isPrivateHost('999.1.1.1'), false, 'IP ที่ผิดรูปแบบไม่ถือเป็นภายใน');
  });
});
