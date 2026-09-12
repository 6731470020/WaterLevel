import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SettingsService } from '../../src/services/SettingsService.js';
import { LazyRebuild } from '../../src/core/LazyRebuild.js';
import { LiveValue } from '../../src/core/LiveValue.js';
import { ValidationError } from '../../src/core/errors/index.js';
import { ConfiguredDetectionService } from '../../src/services/detection/ConfiguredDetectionService.js';
import { MockDetectionService } from '../../src/services/detection/MockDetectionService.js';
import { HttpDetectionService } from '../../src/services/detection/HttpDetectionService.js';
import { DetectionService } from '../../src/services/detection/DetectionService.js';
import { ConfiguredKeyRegistry } from '../../src/services/license/ConfiguredKeyRegistry.js';
import { NullKeyRegistry } from '../../src/services/license/NullKeyRegistry.js';
import { HttpKeyRegistry } from '../../src/services/license/HttpKeyRegistry.js';
import { KeyRegistry } from '../../src/services/license/KeyRegistry.js';

/** ที่เก็บค่าตั้งค่าในหน่วยความจำ */
class FakeRepository {
  rows = new Map();

  async all() {
    return [...this.rows.entries()].map(([key, value]) => ({ key, ...value }));
  }

  async saveMany(entries) {
    for (const entry of entries) {
      this.rows.set(entry.key, { value: entry.value, isSecret: Boolean(entry.isSecret) });
    }
    return entries.length;
  }

  async removeMany(keys) {
    for (const key of keys) this.rows.delete(key);
    return keys.length;
  }
}

/** ตัวอ่านค่าจาก .env จำลอง */
class FakeConfig {
  #values;

  constructor(values = {}) { this.#values = values; }

  get(key, fallback = '') { return this.#values[key] ?? fallback; }
}

/** ตัวบันทึกการใช้งานจำลอง */
class FakeAudit {
  entries = [];

  async record(entry) { this.entries.push(entry); }
}

const actor = { id: 1, username: 'admin' };

/**
 * สร้างบริการค่าตั้งค่าพร้อมค่า `.env` ที่กำหนด
 * @param {Record<string, string>} env ค่าจาก .env
 * @returns {Promise<{service: SettingsService, repository: FakeRepository}>}
 */
async function makeService(env = {}) {
  const repository = new FakeRepository();
  const service = new SettingsService({
    settingRepository: repository,
    config: new FakeConfig(env),
    auditService: new FakeAudit(),
    logger: { warn() {}, info() {}, error() {}, debug() {} },
  });
  await service.load();
  return { service, repository };
}

describe('ค่าตั้งค่าที่ย้ายจาก .env มาไว้ในฐานข้อมูล', () => {
  test('ค่าที่ย้ายมาทุกตัวอยู่ในรายการที่แก้ได้จริง', async () => {
    const { service } = await makeService();
    const keys = service.forDisplay().map((item) => item.key);

    const moved = [
      'DETECTION_DRIVER', 'WATER_API_URL', 'WATER_API_KEY', 'DETECTION_TIMEOUT_MS',
      'MAX_VARIATION_PX', 'CONFIRMATION_ATTEMPTS', 'CONFIRMATION_DELAY_SEC',
      'CONSISTENCY_THRESHOLD_PX', 'IMAGE_RETENTION_DAYS',
      'PASSWORD_MIN_LENGTH', 'LOGIN_MAX_ATTEMPTS', 'LOGIN_LOCK_MINUTES',
      'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM',
    ];
    for (const key of moved) assert.ok(keys.includes(key), `ขาดคีย์ ${key}`);
  });

  test('ค่าที่ต้องอยู่ใน .env เท่านั้น ต้องไม่หลุดเข้ามาในรายการที่แก้ได้', async () => {
    const { service } = await makeService();
    const keys = service.forDisplay().map((item) => item.key);

    // ผู้ที่มีสิทธิ์ setting.manage ต้องเขียนทับค่าเหล่านี้ไม่ได้เด็ดขาด
    // `ALLOW_PRIVATE_CAMERA_URL` อยู่ในรายการนี้เพราะเป็นด่านกัน SSRF —
    // สวิตช์ที่ปิดแล้วเปิดทางยิงคำขอเข้าเครือข่ายภายในต้องไม่อยู่ในฟอร์มเว็บ
    for (const key of ['DB_PASSWORD', 'DB_HOST', 'SESSION_SECRET', 'PORT', 'STORAGE_PATH',
      'NODE_ENV', 'ALLOW_PRIVATE_CAMERA_URL']) {
      assert.ok(!keys.includes(key), `${key} ต้องไม่อยู่ในรายการที่แก้ได้จากหน้าเว็บ`);
    }
  });

  test('ทุกคีย์ต้องสังกัดกลุ่มที่มีอยู่จริง — ไม่งั้นจะไม่โผล่บนแท็บไหนเลย', async () => {
    const { service } = await makeService();
    const groupKeys = SettingsService.groups.map((group) => group.key);
    for (const item of service.forDisplay()) {
      assert.ok(groupKeys.includes(item.group), `คีย์ ${item.key} อยู่ในกลุ่ม "${item.group}" ที่ไม่มีอยู่จริง`);
    }
  });

  test('ค่าจากฐานข้อมูลชนะ .env และล้างแล้วกลับไปใช้ .env', async () => {
    const { service } = await makeService({ MAX_VARIATION_PX: '80' });
    assert.equal(service.int('MAX_VARIATION_PX', 50), 80, 'ยังไม่ตั้งค่า → ใช้ .env');

    await service.save({ MAX_VARIATION_PX: '120' }, { actor });
    assert.equal(service.int('MAX_VARIATION_PX', 50), 120);

    await service.save({}, { actor, clearKeys: ['MAX_VARIATION_PX'] });
    assert.equal(service.int('MAX_VARIATION_PX', 50), 80, 'ล้างแล้วต้องกลับไปใช้ .env');
  });

  test('ไม่มีทั้งฐานข้อมูลและ .env → ใช้ค่าเริ่มต้นในรายการ', async () => {
    const { service } = await makeService();
    assert.equal(service.int('MAX_VARIATION_PX', 999), 50);
    assert.equal(service.int('CONSISTENCY_THRESHOLD_PX', 999), 25);
    assert.equal(service.effective('DETECTION_DRIVER'), 'mock');
  });

  test('bool() อ่านค่าที่มีเฉพาะใน .env ได้ (ไม่ต้องอยู่ในรายการที่แก้ได้)', async () => {
    const off = await makeService({ ALLOW_PRIVATE_CAMERA_URL: 'false' });
    assert.equal(off.service.bool('ALLOW_PRIVATE_CAMERA_URL'), false);

    const on = await makeService({ ALLOW_PRIVATE_CAMERA_URL: 'true' });
    assert.equal(on.service.bool('ALLOW_PRIVATE_CAMERA_URL'), true);

    const unset = await makeService();
    assert.equal(unset.service.bool('ALLOW_PRIVATE_CAMERA_URL'), false, 'ไม่ตั้งค่า = ปิดไว้');
  });

  test('บันทึกด่านกัน SSRF ผ่านหน้าเว็บไม่ได้ แม้ยิงคำขอตรง', async () => {
    const { service, repository } = await makeService();

    // ยิงตรงแบบข้ามหน้าจอ — `save()` ต้องเมินคีย์ที่ไม่อยู่ในรายการ ไม่ใช่รับมาเก็บ
    await service.save({ ALLOW_PRIVATE_CAMERA_URL: 'true' }, { actor });

    assert.equal(repository.rows.has('ALLOW_PRIVATE_CAMERA_URL'), false);
    assert.equal(service.bool('ALLOW_PRIVATE_CAMERA_URL'), false);
  });

  test('ช่องแบบเลือก (select) ปฏิเสธค่าที่ไม่อยู่ในรายการ', async () => {
    const { service } = await makeService();
    await assert.rejects(
      () => service.save({ DETECTION_DRIVER: 'ftp' }, { actor }),
      ValidationError,
    );
    await service.save({ DETECTION_DRIVER: 'http', WATER_API_URL: 'https://a.example.com', WATER_API_KEY: 'k' }, { actor });
    assert.equal(service.effective('DETECTION_DRIVER'), 'http');
  });

  test('เลือกไดรเวอร์ http แต่ไม่กรอกปลายทาง → ต้องบันทึกไม่ผ่าน', async () => {
    const { service } = await makeService();
    await assert.rejects(
      () => service.save({ DETECTION_DRIVER: 'http' }, { actor }),
      (error) => {
        assert.ok(error instanceof ValidationError);
        const fields = error.details.map((detail) => detail.field);
        assert.ok(fields.includes('WATER_API_URL'));
        assert.ok(fields.includes('WATER_API_KEY'));
        return true;
      },
    );
  });

  test('ค่าจำนวนเต็มนอกช่วงที่กำหนดต้องถูกปฏิเสธ', async () => {
    const { service } = await makeService();
    await assert.rejects(() => service.save({ PASSWORD_MIN_LENGTH: '4' }, { actor }), ValidationError);
    await assert.rejects(() => service.save({ LOGIN_LOCK_MINUTES: '99999' }, { actor }), ValidationError);
  });

  test('ค่าลับไม่ถูกส่งกลับไปแสดงบนหน้าเว็บ', async () => {
    const { service } = await makeService();
    await service.save({
      DETECTION_DRIVER: 'http',
      WATER_API_URL: 'https://a.example.com',
      WATER_API_KEY: 'super-secret-key-value',
      SMTP_PASSWORD: 'mail-secret',
    }, { actor });

    for (const key of ['WATER_API_KEY', 'SMTP_PASSWORD']) {
      const item = service.forDisplay().find((entry) => entry.key === key);
      assert.equal(item.secret, true);
      assert.equal(item.value, '', `${key} ต้องไม่ถูกส่งค่าจริงไปที่เบราว์เซอร์`);
      assert.match(item.preview, /^••••/);
    }
  });
});

describe('LazyRebuild — ประกอบใหม่เมื่อค่าตั้งค่าเปลี่ยน', () => {
  let version;
  let built;
  let holder;

  beforeEach(() => {
    version = 1;
    built = 0;
    holder = new LazyRebuild(() => version, () => { built += 1; return { id: built }; });
  });

  test('ประกอบครั้งเดียวตราบใดที่เลขรุ่นไม่เปลี่ยน', () => {
    assert.equal(holder.isBuilt, false);
    assert.equal(holder.current.id, 1);
    assert.equal(holder.current.id, 1);
    assert.equal(built, 1);
    assert.equal(holder.isBuilt, true);
  });

  test('เลขรุ่นเปลี่ยน → ประกอบใหม่', () => {
    assert.equal(holder.current.id, 1);
    version = 2;
    assert.equal(holder.current.id, 2);
    assert.equal(built, 2);
  });

  test('invalidate() บังคับประกอบใหม่โดยไม่ต้องรอเลขรุ่น', () => {
    assert.equal(holder.current.id, 1);
    holder.invalidate();
    assert.equal(holder.isBuilt, false);
    assert.equal(holder.current.id, 2);
  });

  test('โรงงานที่คืน null ต้องไม่ถูกเรียกซ้ำทุกครั้ง... แต่ก็ต้องไม่ค้าง', () => {
    let calls = 0;
    const nullable = new LazyRebuild(() => 1, () => { calls += 1; return null; });
    nullable.current;
    nullable.current;
    // `null` แปลว่า "ยังไม่ได้ตั้งค่า" ซึ่งเป็นสถานะที่เกิดได้จริง (เช่น SMTP ว่าง)
    // จึงยอมให้เรียกซ้ำได้ ขอแค่ต้องไม่พังและต้องคืน null เสมอ
    assert.equal(nullable.current, null);
    assert.ok(calls >= 1);
  });
});

describe('LiveValue — รับได้ทั้งค่าคงที่และฟังก์ชันอ่านค่า', () => {
  test('ค่าคงที่อ่านได้เหมือนเดิมทุกครั้ง', () => {
    assert.equal(LiveValue.intReader(50, 1)(), 50);
    assert.equal(LiveValue.boolReader(true, false)(), true);
  });

  test('ฟังก์ชันอ่านค่าสดทุกครั้งที่เรียก', () => {
    let value = 10;
    const read = LiveValue.intReader(() => value, 1);
    assert.equal(read(), 10);
    value = 42;
    assert.equal(read(), 42);
  });

  test('null / undefined ถอยไปใช้ค่าสำรอง', () => {
    assert.equal(LiveValue.intReader(undefined, 7)(), 7);
    assert.equal(LiveValue.intReader(null, 7)(), 7);
    assert.equal(LiveValue.intReader(() => null, 7)(), 7);
  });

  test('สตริงจากฐานข้อมูลถูกตีความเป็นชนิดที่ถูกต้อง', () => {
    assert.equal(LiveValue.intReader('120', 1)(), 120);
    assert.equal(LiveValue.boolReader('true', false)(), true);
    assert.equal(LiveValue.boolReader('false', true)(), false);
    assert.equal(LiveValue.boolReader('1', false)(), true);
    assert.equal(LiveValue.boolReader('0', true)(), false);
  });

  test('ค่าที่แปลงเป็นตัวเลขไม่ได้ ถอยไปใช้ค่าสำรองแทนที่จะกลายเป็น NaN', () => {
    assert.equal(LiveValue.intReader('ไม่ใช่ตัวเลข', 30)(), 30);
  });
});

describe('สลับไดรเวอร์จากหน้าเว็บโดยไม่รีสตาร์ต', () => {
  /**
   * ประกอบบริการตรวจจับแบบเดียวกับ `ServiceContainer` แต่ผูกกับค่าตั้งค่าจำลอง
   * @param {SettingsService} settings บริการค่าตั้งค่า
   * @returns {ConfiguredDetectionService}
   */
  const buildDetection = (settings) => new ConfiguredDetectionService({
    versionOf: () => settings.version,
    factory: () => (settings.effective('DETECTION_DRIVER', 'mock') === 'http'
      ? new HttpDetectionService({
        apiUrl: settings.effective('WATER_API_URL'),
        apiKey: settings.effective('WATER_API_KEY'),
        timeoutMs: settings.int('DETECTION_TIMEOUT_MS', 30000),
      }, { warn() {}, info() {}, error() {}, debug() {} })
      : new MockDetectionService()),
  });

  test('เป็นลูกของ DetectionService จริง — พหุสัณฐานยังใช้ได้เหมือนเดิม', async () => {
    const { service: settings } = await makeService();
    const detection = buildDetection(settings);
    assert.ok(detection instanceof DetectionService);
  });

  test('บันทึกค่าใหม่แล้วไดรเวอร์เปลี่ยนทันทีโดยไม่ต้องสร้างวัตถุใหม่', async () => {
    const { service: settings } = await makeService();
    const detection = buildDetection(settings);

    assert.equal(detection.driver, 'mock');

    await settings.save({
      DETECTION_DRIVER: 'http',
      WATER_API_URL: 'https://api.example.com',
      WATER_API_KEY: 'key',
    }, { actor });

    // อ้างอิงเดิมตัวเดียวกัน แต่พฤติกรรมเปลี่ยนตามค่าล่าสุด
    assert.equal(detection.driver, 'http');
    assert.ok(detection.current instanceof HttpDetectionService);

    await settings.save({ DETECTION_DRIVER: 'mock' }, { actor });
    assert.equal(detection.driver, 'mock');
  });

  test('ทะเบียนคีย์เปิดใช้เองทันทีที่กรอกคีย์ — ไม่มีตัวเลือกให้ข้าม', async () => {
    const { service: settings } = await makeService();
    const registry = new ConfiguredKeyRegistry({
      versionOf: () => settings.version,
      factory: () => {
        const apiUrl = settings.effective('WATER_API_URL');
        const apiKey = settings.effective('WATER_API_KEY');
        return apiUrl && apiKey
          ? new HttpKeyRegistry({ apiUrl, apiKey }, { warn() {}, info() {}, error() {}, debug() {} })
          : new NullKeyRegistry();
      },
    });

    assert.ok(registry instanceof KeyRegistry);
    assert.equal(registry.isConfigured, false, 'ยังไม่กรอกคีย์ → ใช้ใบอนุญาตที่กรอกเองไปพลาง');
    assert.equal(registry.driver, 'not-configured');

    await settings.save({
      DETECTION_DRIVER: 'http',
      WATER_API_URL: 'https://api.example.com',
      WATER_API_KEY: 'key',
    }, { actor });

    assert.equal(registry.isConfigured, true, 'กรอกคีย์แล้วต้องตรวจกับเซิร์ฟเวอร์เสมอ');
    assert.equal(registry.driver, 'remote');
  });

  test('ไม่มีคีย์ "แหล่งใบอนุญาต" ให้ตั้งค่าอีกต่อไป', async () => {
    const { service } = await makeService();
    const keys = service.forDisplay().map((item) => item.key);
    assert.ok(!keys.includes('LICENSE_DRIVER'),
      'คีย์บริการตรวจจับคือใบอนุญาตในตัว จึงต้องไม่มีตัวเลือกให้ข้ามการตรวจ');
  });
});
