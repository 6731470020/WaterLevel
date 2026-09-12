import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SettingsService } from '../../src/services/SettingsService.js';
import { ConfiguredChannel } from '../../src/services/notification/ConfiguredChannel.js';
import { NotificationChannel } from '../../src/services/notification/NotificationChannel.js';
import { ValidationError } from '../../src/core/errors/index.js';

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

const actor = { id: 7, username: 'admin' };

describe('SettingsService', () => {
  let repository;
  let audit;
  let service;

  beforeEach(async () => {
    repository = new FakeRepository();
    audit = new FakeAudit();
    service = new SettingsService({
      settingRepository: repository,
      config: new FakeConfig({ LINE_CHANNEL_ACCESS_TOKEN: 'จาก-env', NOTIFICATION_DRIVER: 'line' }),
      auditService: audit,
      logger: { warn() {}, info() {}, error() {}, debug() {} },
    });
    await service.load();
  });

  test('ยังไม่ตั้งค่าผ่านเว็บ ต้องใช้ค่าจาก .env', () => {
    assert.equal(service.effective('LINE_CHANNEL_ACCESS_TOKEN'), 'จาก-env');
  });

  test('ค่าที่ตั้งผ่านเว็บต้องชนะค่าใน .env', async () => {
    await service.save({ LINE_CHANNEL_ACCESS_TOKEN: 'จาก-เว็บ' }, { actor });
    assert.equal(service.effective('LINE_CHANNEL_ACCESS_TOKEN'), 'จาก-เว็บ');
  });

  test('ล้างค่าแล้วต้องกลับไปใช้ .env', async () => {
    await service.save({ LINE_CHANNEL_ACCESS_TOKEN: 'จาก-เว็บ' }, { actor });
    await service.save({}, { actor, clearKeys: ['LINE_CHANNEL_ACCESS_TOKEN'] });
    assert.equal(service.effective('LINE_CHANNEL_ACCESS_TOKEN'), 'จาก-env');
  });

  test('เว้นช่องว่างต้องไม่ลบค่าเดิม เพราะหน้าเว็บไม่เคยแสดงค่าลับให้พิมพ์กลับ', async () => {
    await service.save({ TELEGRAM_BOT_TOKEN: 'โทเคนจริง', TELEGRAM_CHAT_ID: '-100' }, { actor });
    await service.save({ TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '-200' }, { actor });

    assert.equal(service.effective('TELEGRAM_BOT_TOKEN'), 'โทเคนจริง');
    assert.equal(service.effective('TELEGRAM_CHAT_ID'), '-200');
  });

  test('คีย์นอกรายการที่อนุญาตต้องถูกเมิน', async () => {
    await service.save({ SESSION_SECRET: 'แฮ็ก', DB_PASSWORD: 'แฮ็ก' }, { actor });
    assert.equal(repository.rows.has('SESSION_SECRET'), false);
    assert.equal(repository.rows.has('DB_PASSWORD'), false);
  });

  test('เลือกช่องทางที่ยังไม่มีค่าที่จำเป็น ต้องถูกปฏิเสธตั้งแต่ตอนบันทึก', async () => {
    await assert.rejects(
      () => service.save({ NOTIFICATION_DRIVER: ['discord'] }, { actor }),
      (error) => {
        assert.ok(error instanceof ValidationError);
        assert.match(error.details[0].message, /Discord Webhook URL/);
        return true;
      },
    );
  });

  test('เลือกช่องทางพร้อมใส่ค่าที่จำเป็นในครั้งเดียว ต้องผ่าน', async () => {
    await service.save({
      NOTIFICATION_DRIVER: ['discord', 'line'],
      DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/x',
    }, { actor });
    assert.equal(service.effective('NOTIFICATION_DRIVER'), 'discord,line');
  });

  test('URL ที่ไม่ใช่ http/https ต้องถูกปฏิเสธ', async () => {
    await assert.rejects(
      () => service.save({ DISCORD_WEBHOOK_URL: 'javascript:alert(1)' }, { actor }),
      ValidationError,
    );
  });

  test('ไม่เลือกช่องทางเลย ต้องกลายเป็น console ไม่ใช่ค่าว่าง', async () => {
    await service.save({ NOTIFICATION_DRIVER: [] }, { actor });
    assert.equal(service.effective('NOTIFICATION_DRIVER'), 'console');
  });

  test('ค่าลับต้องไม่ถูกส่งกลับไปแสดง เห็นได้แค่ 4 ตัวท้าย', async () => {
    await service.save({ TELEGRAM_BOT_TOKEN: '123456:ABCDEFGHIJKLMNOP' }, { actor });
    const row = service.forDisplay().find((item) => item.key === 'TELEGRAM_BOT_TOKEN');

    assert.equal(row.value, '', 'ห้ามส่งค่าจริงกลับไปที่เบราว์เซอร์');
    assert.equal(row.preview, '••••MNOP');
    assert.equal(row.configured, true);
    assert.equal(row.source, 'database');
  });

  test('ค่าที่ไม่ลับส่งกลับไปแสดงได้ตามปกติ', async () => {
    await service.save({ TELEGRAM_CHAT_ID: '-1001234' }, { actor });
    const row = service.forDisplay().find((item) => item.key === 'TELEGRAM_CHAT_ID');
    assert.equal(row.value, '-1001234');
    assert.equal(row.preview, null);
  });

  test('audit log ต้องบันทึกแค่ว่าคีย์ไหนถูกแก้ ห้ามบันทึกค่า', async () => {
    await service.save({ TELEGRAM_BOT_TOKEN: 'ความลับสุดยอด' }, { actor });
    const record = audit.entries.at(-1);

    assert.deepEqual(record.afterData.saved, ['TELEGRAM_BOT_TOKEN']);
    assert.ok(!JSON.stringify(record).includes('ความลับสุดยอด'), 'ค่าลับต้องไม่อยู่ใน audit log');
  });

  test('เลขรุ่นต้องเพิ่มขึ้นทุกครั้งที่บันทึก', async () => {
    const before = service.version;
    await service.save({ TELEGRAM_CHAT_ID: '-1' }, { actor });
    assert.ok(service.version > before);
  });
});

describe('ConfiguredChannel — ตามค่าตั้งค่าล่าสุดโดยไม่ต้องรีสตาร์ต', () => {
  /** ช่องทางปลอมที่บอกชื่อของตัวเองได้ */
  class Fake extends NotificationChannel {
    #name;

    constructor(name) { super(); this.#name = name; }

    get channel() { return this.#name; }
  }

  test('เลขรุ่นเท่าเดิมต้องใช้วัตถุเดิม ไม่ประกอบใหม่ทุกครั้ง', () => {
    let built = 0;
    let version = 1;
    const channel = new ConfiguredChannel({
      versionOf: () => version,
      factory: () => { built += 1; return new Fake('line'); },
    });

    assert.equal(channel.channel, 'line');
    assert.equal(channel.channel, 'line');
    assert.equal(built, 1);
  });

  test('เลขรุ่นเปลี่ยนต้องประกอบใหม่ด้วยค่าล่าสุด', () => {
    let version = 1;
    let name = 'line';
    const channel = new ConfiguredChannel({
      versionOf: () => version,
      factory: () => new Fake(name),
    });

    assert.equal(channel.channel, 'line');
    version = 2;
    name = 'line+discord';
    assert.equal(channel.channel, 'line+discord', 'ต้องเห็นค่าใหม่ทันทีโดยไม่ต้องรีสตาร์ต');
  });
});
