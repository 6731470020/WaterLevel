import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { PasswordHasher } from '../../src/services/security/PasswordHasher.js';
import { ScryptHasher } from '../../src/services/security/ScryptHasher.js';
import { BcryptHasher } from '../../src/services/security/BcryptHasher.js';
import { PasswordPolicy } from '../../src/services/security/PasswordPolicy.js';
import { NotImplementedError, ValidationError } from '../../src/core/errors/index.js';

describe('PasswordHasher — คลาสนามธรรม', () => {
  test('สร้างวัตถุโดยตรงไม่ได้', () => {
    assert.throws(() => new PasswordHasher(), NotImplementedError);
  });

  test('คลาสลูกที่ไม่ override ต้องโยน NotImplementedError', async () => {
    class Incomplete extends PasswordHasher {}
    const instance = new Incomplete();
    assert.throws(() => instance.algorithm, NotImplementedError);
    await assert.rejects(() => instance.hash('x'), NotImplementedError);
    await assert.rejects(() => instance.verify('x', 'y'), NotImplementedError);
  });
});

describe('ScryptHasher — วิธีเริ่มต้นของระบบ', () => {
  const hasher = new ScryptHasher();

  test('แฮชแล้วตรวจกลับได้', async () => {
    const hash = await hasher.hash('MyPassword123');
    assert.equal(await hasher.verify('MyPassword123', hash), true);
  });

  test('รหัสผ่านผิดต้องไม่ผ่าน', async () => {
    const hash = await hasher.hash('MyPassword123');
    assert.equal(await hasher.verify('WrongPassword', hash), false);
    assert.equal(await hasher.verify('', hash), false);
  });

  test('salt สุ่มใหม่ทุกครั้ง — แฮชเดียวกันสองครั้งต้องได้คนละค่า', async () => {
    const first = await hasher.hash('SamePassword1');
    const second = await hasher.hash('SamePassword1');
    assert.notEqual(first, second);
    assert.equal(await hasher.verify('SamePassword1', first), true);
    assert.equal(await hasher.verify('SamePassword1', second), true);
  });

  test('รูปแบบที่เก็บคือ scrypt$salt$hash', async () => {
    const hash = await hasher.hash('MyPassword123');
    assert.match(hash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  });

  test('supports รู้จักเฉพาะรูปแบบของตัวเอง', async () => {
    assert.equal(hasher.supports(await hasher.hash('x')), true);
    assert.equal(hasher.supports('$2y$10$abcdefghijklmnopqrstuv'), false);
    assert.equal(hasher.supports('ไม่ใช่แฮช'), false);
  });

  test('รหัสผ่านว่างต้องโยน ValidationError', async () => {
    await assert.rejects(() => hasher.hash(''), ValidationError);
  });
});

describe('BcryptHasher — ตรวจรหัสผ่านเดิมจากระบบ PHP', () => {
  const hasher = new BcryptHasher();

  test('ตรวจแฮชรูปแบบ $2y$ ของ PHP ได้', async () => {
    // PHP password_hash() สร้างคำนำหน้า $2y$ ซึ่ง bcryptjs ไม่รู้จักโดยตรง
    const phpStyle = (await bcrypt.hash('LegacyPass123', 10)).replace(/^\$2a\$/, '$2y$');
    assert.match(phpStyle, /^\$2y\$/);
    assert.equal(await hasher.verify('LegacyPass123', phpStyle), true);
    assert.equal(await hasher.verify('WrongPass', phpStyle), false);
  });

  test('ตรวจแฮชรูปแบบ $2a$ และ $2b$ ได้ด้วย', async () => {
    const hash = await hasher.hash('LegacyPass123');
    assert.equal(await hasher.verify('LegacyPass123', hash), true);
  });

  test('supports รู้จักเฉพาะรูปแบบ bcrypt', async () => {
    assert.equal(hasher.supports('$2y$10$abcdefghijklmnopqrstuv'), true);
    assert.equal(hasher.supports('$2a$10$abcdefghijklmnopqrstuv'), true);
    assert.equal(hasher.supports('scrypt$aa$bb'), false);
  });

  test('algorithm คืนชื่อที่ตรงกับคอลัมน์ hash_algo', () => {
    assert.equal(hasher.algorithm, 'bcrypt');
    assert.equal(new ScryptHasher().algorithm, 'scrypt');
  });
});

describe('พหุสัณฐาน — เรียกเหมือนกันแต่ทำงานต่างกัน', () => {
  test('ทั้งสองคลาสใช้สัญญาเดียวกันได้โดยผู้เรียกไม่ต้องรู้ชนิด', async () => {
    const hashers = [new ScryptHasher(), new BcryptHasher()];
    for (const hasher of hashers) {
      assert.ok(hasher instanceof PasswordHasher);
      const hash = await hasher.hash('CommonPassword1');
      assert.equal(await hasher.verify('CommonPassword1', hash), true);
      assert.equal(hasher.supports(hash), true);
    }
  });

  test('แต่ละตัวไม่ยอมรับแฮชของอีกตัว — ใช้เลือกตัวตรวจได้', async () => {
    const scrypt = new ScryptHasher();
    const bcryptHasher = new BcryptHasher();
    const scryptHash = await scrypt.hash('Password123');
    const bcryptHash = await bcryptHasher.hash('Password123');

    assert.equal(scrypt.supports(bcryptHash), false);
    assert.equal(bcryptHasher.supports(scryptHash), false);
    assert.equal(await scrypt.verify('Password123', bcryptHash), false);
    assert.equal(await bcryptHasher.verify('Password123', scryptHash), false);
  });
});

describe('PasswordPolicy — นโยบายรหัสผ่าน', () => {
  const policy = new PasswordPolicy(10);

  test('รหัสผ่านที่ผ่านทุกเกณฑ์', () => {
    assert.deepEqual(policy.check('GoodPass123'), []);
  });

  test('สั้นเกินไป', () => {
    assert.match(policy.check('Short1a')[0], /อย่างน้อย 10/);
  });

  test('ไม่มีตัวพิมพ์ใหญ่ / พิมพ์เล็ก / ตัวเลข', () => {
    assert.match(policy.check('alllowercase123')[0], /พิมพ์ใหญ่/);
    assert.match(policy.check('ALLUPPERCASE123')[0], /พิมพ์เล็ก/);
    assert.match(policy.check('NoDigitsHereAtAll')[0], /ตัวเลข/);
  });

  test('รายงานทุกข้อที่ผิดพร้อมกัน', () => {
    assert.equal(policy.check('abc').length, 3, 'สั้น + ไม่มีพิมพ์ใหญ่ + ไม่มีตัวเลข');
  });

  test('assert โยน ValidationError พร้อมรายละเอียดครบ', () => {
    assert.throws(() => policy.assert('abc'), (error) => {
      assert.ok(error instanceof ValidationError);
      assert.equal(error.details.length, 3);
      return true;
    });
  });
});
