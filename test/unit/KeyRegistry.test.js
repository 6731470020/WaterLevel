import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { HttpKeyRegistry } from '../../src/services/license/HttpKeyRegistry.js';
import { NullKeyRegistry } from '../../src/services/license/NullKeyRegistry.js';
import { KeyRegistry } from '../../src/services/license/KeyRegistry.js';
import { KeyInfo } from '../../src/services/license/KeyInfo.js';
import { LicenseService } from '../../src/services/LicenseService.js';
import { License } from '../../src/models/License.js';
import { MemoryCache } from '../../src/core/MemoryCache.js';
import { UpstreamError, ValidationError, NotImplementedError } from '../../src/core/errors/index.js';

/** ตัวบันทึกเหตุการณ์เงียบ — ไม่ให้ log รบกวนผลทดสอบ */
class SilentLogger {
  warn() {}

  info() {}

  error() {}

  debug() {}
}

/** คำตอบสำเร็จของ `GET /key-info` ตามที่ `app.py:key_to_dict()` สร้าง */
const OK_BODY = {
  success: true,
  data: {
    id: 3,
    api_key: 'kQ8vN2xr...9fLm',
    owner_name: 'อบต.บางไผ่',
    owner_email: 'admin@bangpai.go.th',
    owner_phone: '021234567',
    company: 'องค์การบริหารส่วนตำบลบางไผ่',
    plan: 'standard',
    purchased_at: '2026-01-05 09:00:00',
    expires_at: '2027-01-05 09:00:00',
    is_active: true,
    is_expired: false,
    days_remaining: 135,
    expire_text: '05/01/2027 09:00',
    status: 'active',
    usage_count: 8421,
    last_used_at: '2026-08-23 10:15:00',
  },
};

/**
 * แทนที่ `fetch` ทั้งโปรแกรมด้วยตัวปลอมที่ตอบตามที่กำหนด
 * @param {{status: number, body?: object, throws?: Error}} plan สิ่งที่อยากให้ตอบ
 * @returns {{calls: Array<{url: string, init: object}>}}
 */
function stubFetch(plan) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (plan.throws) throw plan.throws;
    return {
      status: plan.status,
      ok: plan.status >= 200 && plan.status < 300,
      json: async () => plan.body,
    };
  };
  return { calls };
}

const originalFetch = globalThis.fetch;

describe('KeyRegistry — คลาสนามธรรมของทะเบียนคีย์', () => {
  test('สร้างวัตถุจากคลาสนามธรรมโดยตรงไม่ได้', () => {
    assert.throws(() => new KeyRegistry(), NotImplementedError);
  });

  test('คลาสลูกที่ไม่ override ต้องโยน NotImplementedError', async () => {
    class Incomplete extends KeyRegistry {}
    await assert.rejects(() => new Incomplete().fetchKeyInfo(), NotImplementedError);
    assert.throws(() => new Incomplete().driver, NotImplementedError);
  });
});

describe('NullKeyRegistry — ไม่มีปลายทางให้ถาม', () => {
  test('รายงานว่ายังไม่ได้ตั้งค่า และคืน null เสมอ', async () => {
    const registry = new NullKeyRegistry();
    assert.equal(registry.driver, 'not-configured');
    assert.equal(registry.isConfigured, false);
    assert.equal(await registry.fetchKeyInfo(), null);
  });
});

describe('HttpKeyRegistry — เชื่อมกับ GET /key-info', () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  test('ต้องตั้งค่า URL และคีย์ครบ', () => {
    assert.throws(() => new HttpKeyRegistry({ apiUrl: '', apiKey: 'k' }), ValidationError);
    assert.throws(() => new HttpKeyRegistry({ apiUrl: 'https://x', apiKey: '' }), ValidationError);
  });

  test('ส่ง X-API-Key ไปที่ /key-info และแปลงคำตอบเป็น KeyInfo', async () => {
    const { calls } = stubFetch({ status: 200, body: OK_BODY });
    const registry = new HttpKeyRegistry(
      { apiUrl: 'https://api.example.com/', apiKey: 'secret-key' }, new SilentLogger(),
    );

    const info = await registry.fetchKeyInfo();

    assert.equal(calls[0].url, 'https://api.example.com/key-info');
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.headers['X-API-Key'], 'secret-key');

    assert.equal(info.ownerName, 'อบต.บางไผ่');
    assert.equal(info.plan, 'standard');
    assert.equal(info.daysRemaining, 135);
    assert.equal(info.usageCount, 8421);
    assert.equal(info.isUsable, true);
    assert.equal(info.isPerpetual, false);
    assert.equal(info.expiresAt.getFullYear(), 2027);
    assert.equal(info.expiresAt.getMonth(), 0);
    assert.equal(info.expiresAt.getDate(), 5);
  });

  test('expires_at = null แปลว่าตลอดชีพ ไม่ใช่ข้อมูลหาย', async () => {
    stubFetch({
      status: 200,
      body: { success: true, data: { ...OK_BODY.data, expires_at: null, days_remaining: null } },
    });
    const info = await new HttpKeyRegistry(
      { apiUrl: 'https://api.example.com', apiKey: 'k' }, new SilentLogger(),
    ).fetchKeyInfo();

    assert.equal(info.isPerpetual, true);
    assert.equal(info.expiresAt, null);
    assert.equal(info.daysRemaining, null);
    assert.equal(info.isUsable, true);
  });

  test('คีย์หมดอายุ (403) ถือว่าถามสำเร็จ — คืน KeyInfo ที่ใช้ไม่ได้', async () => {
    stubFetch({
      status: 403,
      body: {
        success: false,
        error: 'API Key expired',
        owner: 'อบต.บางไผ่',
        expires_at: '2026-08-01 09:00:00',
      },
    });
    const info = await new HttpKeyRegistry(
      { apiUrl: 'https://api.example.com', apiKey: 'k' }, new SilentLogger(),
    ).fetchKeyInfo();

    assert.equal(info.status, 'expired');
    assert.equal(info.isExpired, true);
    assert.equal(info.isUsable, false);
    assert.equal(info.ownerName, 'อบต.บางไผ่');
  });

  test('คีย์ถูกยกเลิก (403) → status revoked และใช้ไม่ได้', async () => {
    stubFetch({
      status: 403,
      body: { success: false, error: 'API Key revoked', owner: 'อบต.บางไผ่' },
    });
    const info = await new HttpKeyRegistry(
      { apiUrl: 'https://api.example.com', apiKey: 'k' }, new SilentLogger(),
    ).fetchKeyInfo();

    assert.equal(info.status, 'revoked');
    assert.equal(info.isActive, false);
    assert.equal(info.isUsable, false);
  });

  test('คีย์ที่บริการไม่รู้จัก = ตั้งค่าผิด ไม่ใช่ใบอนุญาตหมดอายุ', async () => {
    stubFetch({ status: 403, body: { success: false, error: 'Invalid API Key' } });
    await assert.rejects(
      () => new HttpKeyRegistry(
        { apiUrl: 'https://api.example.com', apiKey: 'k' }, new SilentLogger(),
      ).fetchKeyInfo(),
      UpstreamError,
    );
  });

  test('ติดต่อไม่ได้ → UpstreamError (ห้ามตีความว่าหมดอายุ)', async () => {
    stubFetch({ throws: Object.assign(new Error('fetch failed'), { name: 'TypeError' }) });
    await assert.rejects(
      () => new HttpKeyRegistry(
        { apiUrl: 'https://api.example.com', apiKey: 'k' }, new SilentLogger(),
      ).fetchKeyInfo(),
      UpstreamError,
    );
  });

  test('คำตอบที่ไม่มีส่วน data ถือว่าไม่ใช่บริการที่ถูกต้อง', () => {
    assert.throws(() => KeyInfo.fromApiResponse({ success: true }), ValidationError);
  });

  test('คีย์สั้นที่ต้นทางส่งกลับมาเต็มใบ ต้องถูกปิดบังฝั่งเรา', () => {
    // `key_to_dict()` ปิดบังเฉพาะคีย์ที่ยาวเกิน 12 ตัว — คีย์เดิมจาก .env สั้นกว่านั้น
    const info = KeyInfo.fromApiResponse({
      data: { ...OK_BODY.data, api_key: 'abc123def456' },
    });
    assert.equal(info.maskedKey, 'abc1...56');
    assert.ok(!info.maskedKey.includes('123def4'), 'ห้ามให้ตัวคีย์จริงหลุดออกมา');
  });

  test('คีย์ที่ต้นทางปิดบังมาแล้ว ต้องไม่ถูกปิดบังซ้ำ', () => {
    const info = KeyInfo.fromApiResponse({ data: OK_BODY.data });
    assert.equal(info.maskedKey, 'kQ8vN2xr...9fLm');
  });
});

/**
 * ที่เก็บใบอนุญาตหลอก — เก็บไว้ในหน่วยความจำเพื่อไม่ต้องพึ่งฐานข้อมูลจริง
 */
class FakeLicenseRepository {
  #rows = [];

  #nextId = 1;

  /** @returns {Array<object>} แถวทั้งหมด (ใช้ตรวจในเทสต์) */
  get rows() { return this.#rows; }

  /**
   * @param {object} where เงื่อนไข
   * @returns {Promise<License|null>}
   */
  async findOneBy(where) {
    const row = this.#rows.find((r) => r.license_key === where.license_key);
    return row ? FakeLicenseRepository.#map(row) : null;
  }

  /** @returns {Promise<License|null>} ใบอนุญาตที่เปิดใช้งานและหมดอายุช้าที่สุด */
  async findCurrent() {
    const active = this.#rows
      .filter((r) => r.is_active === 1)
      .sort((a, b) => new Date(b.expired_at) - new Date(a.expired_at));
    return active.length ? FakeLicenseRepository.#map(active[0]) : null;
  }

  /**
   * @param {License} license ใบอนุญาต
   * @returns {Promise<License>}
   */
  async create(license) {
    license.validate();
    const row = {
      id: this.#nextId,
      license_key: license.licenseKey,
      expired_at: license.expiredAt,
      is_active: license.isActive ? 1 : 0,
    };
    this.#nextId += 1;
    this.#rows.push(row);
    return FakeLicenseRepository.#map(row);
  }

  /**
   * @param {number} id รหัสแถว
   * @param {object} data ค่าที่แก้
   * @returns {Promise<License>}
   */
  async update(id, data) {
    const row = this.#rows.find((r) => r.id === id);
    Object.assign(row, data);
    return FakeLicenseRepository.#map(row);
  }

  /**
   * @param {object} row แถวดิบ
   * @returns {License}
   */
  static #map(row) {
    return new License({
      id: row.id,
      licenseKey: row.license_key,
      expiredAt: row.expired_at,
      isActive: Boolean(row.is_active),
    });
  }
}

describe('LicenseService — ซิงก์ใบอนุญาตจากทะเบียนคีย์', () => {
  let repository;
  let service;

  beforeEach(() => {
    repository = new FakeLicenseRepository();
    service = new LicenseService({
      licenseRepository: repository,
      cache: new MemoryCache(),
      keyRegistry: new HttpKeyRegistry(
        { apiUrl: 'https://api.example.com', apiKey: 'k' }, new SilentLogger(),
      ),
      logger: new SilentLogger(),
    });
  });

  afterEach(() => { globalThis.fetch = originalFetch; });

  test('คีย์ที่ใช้ได้ → สร้างใบอนุญาตตามวันหมดอายุของคีย์', async () => {
    stubFetch({ status: 200, body: OK_BODY });

    const { synced, keyInfo } = await service.syncFromRegistry();
    assert.equal(synced, true);
    assert.equal(keyInfo.isUsable, true);

    const license = await service.current();
    // เก็บเฉพาะคีย์ที่ปิดบังแล้ว ค่าจริงต้องไม่หลุดลงฐานข้อมูล
    assert.equal(license.licenseKey, 'kQ8vN2xr...9fLm');
    assert.notEqual(license.licenseKey, 'k');
    assert.equal(license.expiredAt.getFullYear(), 2027);
    assert.equal((await service.check()).valid, true);
  });

  test('คีย์ถูกยกเลิก → ระบบถูกกั้นทันที แม้มีใบอนุญาตตั้งต้นค้างอยู่', async () => {
    // ใบอนุญาตทดลองใช้ที่ `SeedRunner` ใส่ไว้ตอนติดตั้ง — อายุยาวและยังเปิดใช้งาน
    await repository.create(new License({
      licenseKey: 'TRIAL-LICENSE-CHANGE-ME',
      expiredAt: new Date(Date.now() + 365 * 86400000),
      isActive: true,
    }));
    assert.equal((await service.check()).valid, true);

    stubFetch({
      status: 403,
      body: { success: false, error: 'API Key revoked', owner: 'อบต.บางไผ่' },
    });
    await service.syncFromRegistry();

    const { valid } = await service.check();
    assert.equal(valid, false, 'ใบอนุญาตที่กรอกเองต้องไม่กลายเป็นทางลัดข้ามคีย์ที่ถูกยกเลิก');
  });

  test('ติดต่อทะเบียนไม่ได้ → คงใบอนุญาตเดิมไว้ ไม่กั้นระบบ', async () => {
    stubFetch({ status: 200, body: OK_BODY });
    await service.syncFromRegistry();
    assert.equal((await service.check()).valid, true);

    stubFetch({ throws: Object.assign(new Error('ECONNREFUSED'), { name: 'TypeError' }) });
    const { synced, reason } = await service.syncFromRegistry();

    assert.equal(synced, false);
    assert.match(reason, /ติดต่อทะเบียนคีย์ไม่ได้/);
    assert.equal((await service.check()).valid, true, 'เน็ตหลุดต้องไม่ทำให้ทั้งระบบถูกกั้น');
    assert.equal(repository.rows.length, 1, 'ต้องไม่สร้างแถวใบอนุญาตใหม่ตอนซิงก์ล้มเหลว');
  });

  test('คีย์ตลอดชีพ → ใบอนุญาตไม่หมดอายุ', async () => {
    stubFetch({
      status: 200,
      body: { success: true, data: { ...OK_BODY.data, expires_at: null, days_remaining: null } },
    });
    await service.syncFromRegistry();

    const license = await service.current();
    assert.equal(license.isValid, true);
    assert.ok(license.daysRemaining > 100000, 'ตลอดชีพต้องไม่ขึ้นว่าใกล้หมดอายุ');
    assert.equal(license.isExpiringSoon, false);
  });

  test('registryStatus() รายงานไดรเวอร์และผลการตรวจล่าสุด', async () => {
    stubFetch({ status: 200, body: OK_BODY });
    await service.syncFromRegistry();

    const status = service.registryStatus();
    assert.equal(status.driver, 'remote');
    assert.equal(status.configured, true);
    assert.equal(status.lastSync.ok, true);
    assert.equal(status.lastSync.keyInfo.ownerName, 'อบต.บางไผ่');
  });

  test('ไม่ได้ตั้งค่าทะเบียน → ซิงก์ถูกข้าม ระบบยังใช้ใบอนุญาตที่กรอกเอง', async () => {
    const local = new LicenseService({
      licenseRepository: new FakeLicenseRepository(),
      cache: new MemoryCache(),
      keyRegistry: new NullKeyRegistry(),
      logger: new SilentLogger(),
    });

    const { synced, reason } = await local.syncFromRegistry();
    assert.equal(synced, false);
    assert.match(reason, /ยังไม่ได้กรอกคีย์/);
    assert.equal(local.registryStatus().configured, false);
    assert.equal((await local.check()).valid, true);
  });
});
