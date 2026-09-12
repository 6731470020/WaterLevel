import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NotificationMessage } from '../../src/services/notification/NotificationMessage.js';
import { DiscordChannel } from '../../src/services/notification/DiscordChannel.js';
import { TelegramChannel } from '../../src/services/notification/TelegramChannel.js';
import { CompositeChannel } from '../../src/services/notification/CompositeChannel.js';
import { NotificationChannel } from '../../src/services/notification/NotificationChannel.js';
import { LineChannel } from '../../src/services/notification/LineChannel.js';
import { ValidationError } from '../../src/core/errors/index.js';

/** ตัวบันทึกเหตุการณ์เงียบ ๆ สำหรับการทดสอบ */
class SilentLogger {
  warn() {}

  info() {}

  error() {}

  debug() {}
}

const message = new NotificationMessage({
  kind: 'ALERT',
  title: '⚠️ เตือนภัย: วิกฤตมาก',
  subtitle: 'ท่าน้ำ<นนท์> & คลอง',
  summary: '⚠️ วิกฤตมาก — ท่าน้ำนนท์ 2.56 ม.',
  color: '#EF4444',
  imageUrl: 'https://example.test/a.jpg',
  fields: [{ label: 'ระดับน้ำ', value: '2.56 ม.', emphasis: true }, { label: 'สถานะ', value: 'วิกฤตมาก' }],
  lines: ['⚠️ เป็นค่าประมาณขั้นต่ำ'],
  links: [{ label: 'ดูกราฟ', url: 'https://example.test/station/a' }],
});

describe('NotificationMessage — DTO กลาง', () => {
  test('ชนิดที่ไม่รู้จักต้องถูกปฏิเสธ', () => {
    assert.throws(() => new NotificationMessage({ kind: 'MYSTERY', title: 'x' }), ValidationError);
  });

  test('ไม่มีหัวเรื่องต้องถูกปฏิเสธ', () => {
    assert.throws(() => new NotificationMessage({ kind: 'INFO', title: '   ' }), ValidationError);
  });

  test('แปลงเป็นข้อความล้วนได้ครบทุกส่วน', () => {
    const text = message.toPlainText();
    assert.match(text, /เตือนภัย: วิกฤตมาก/);
    assert.match(text, /ระดับน้ำ: 2\.56 ม\./);
    assert.match(text, /ดูกราฟ: https:\/\/example\.test\/station\/a/);
  });

  test('สีแปลงเป็นจำนวนเต็มให้ Discord ได้', () => {
    assert.equal(message.colorInt, 0xEF4444);
    assert.equal(new NotificationMessage({ kind: 'INFO', title: 'x' }).colorInt, 0x64748B);
  });

  test('วัตถุต้องเปลี่ยนแปลงไม่ได้ เพราะส่งต่อหลายช่องทางพร้อมกัน', () => {
    assert.throws(() => { message.fields.push({ label: 'x', value: 'y' }); });
  });
});

describe('DiscordChannel', () => {
  const originalFetch = globalThis.fetch;
  let calls = [];

  beforeEach(() => { calls = []; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  test('ประกอบ embed พร้อมภาพและลิงก์', () => {
    const embed = DiscordChannel.render(message);
    assert.equal(embed.title, '⚠️ เตือนภัย: วิกฤตมาก');
    assert.equal(embed.color, 0xEF4444);
    assert.equal(embed.image.url, 'https://example.test/a.jpg');
    assert.equal(embed.fields[0].inline, false, 'ค่าที่เน้นต้องกินเต็มบรรทัด');
    assert.equal(embed.fields[1].inline, true);
    assert.match(embed.fields.at(-1).value, /\[ดูกราฟ\]\(https:\/\/example\.test\/station\/a\)/);
  });

  test('ยังไม่ได้ตั้งค่า webhook ต้องบอกให้ชัด ไม่ใช่ล้มเงียบ', async () => {
    const result = await new DiscordChannel({}, new SilentLogger()).send(message);
    assert.equal(result.success, false);
    assert.match(result.error, /DISCORD_WEBHOOK_URL/);
  });

  test('ส่งสำเร็จต้องแนบ content ไว้ให้แจ้งเตือนบนมือถืออ่านได้', async () => {
    globalThis.fetch = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return new Response(null, { status: 204 });
    };
    const result = await new DiscordChannel(
      { webhookUrl: 'https://discord.test/hook' }, new SilentLogger(),
    ).send(message);

    assert.equal(result.success, true);
    assert.equal(calls[0].body.content, message.summary);
    assert.equal(calls[0].body.embeds.length, 1);
  });

  test('ข้อผิดพลาด 4xx ต้องไม่ลองซ้ำ', async () => {
    globalThis.fetch = async () => { calls.push(1); return new Response('bad', { status: 400 }); };
    const result = await new DiscordChannel(
      { webhookUrl: 'https://discord.test/hook' }, new SilentLogger(),
    ).send(message);

    assert.equal(result.success, false);
    assert.equal(calls.length, 1, 'payload ผิด ลองซ้ำก็ได้ผลเดิม');
  });
});

describe('TelegramChannel', () => {
  const originalFetch = globalThis.fetch;
  let calls = [];

  beforeEach(() => { calls = []; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  test('หนีอักขระ HTML ในชื่อจุดวัด ไม่งั้น Telegram ปฏิเสธทั้งข้อความ', () => {
    const html = TelegramChannel.render(message);
    assert.match(html, /ท่าน้ำ&lt;นนท์&gt; &amp; คลอง/);
    assert.ok(!html.includes('<นนท์>'));
  });

  test('ค่าที่เน้นต้องเป็นตัวหนา และลิงก์เป็นแท็ก a', () => {
    const html = TelegramChannel.render(message);
    assert.match(html, /ระดับน้ำ: <b>2\.56 ม\.<\/b>/);
    assert.match(html, /<a href="https:\/\/example\.test\/station\/a">ดูกราฟ<\/a>/);
  });

  test('มีภาพต้องใช้ sendPhoto เพื่อให้ภาพกับข้อความอยู่ด้วยกัน', async () => {
    globalThis.fetch = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    };
    await new TelegramChannel(
      { botToken: 'T', defaultChatId: '-100' }, new SilentLogger(),
    ).send(message);

    assert.match(calls[0].url, /\/botT\/sendPhoto$/);
    assert.equal(calls[0].body.photo, 'https://example.test/a.jpg');
    assert.equal(calls[0].body.parse_mode, 'HTML');
  });

  test('ไม่มีภาพต้องใช้ sendMessage', async () => {
    globalThis.fetch = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const plain = new NotificationMessage({ kind: 'TEST', title: 'ทดสอบ' });
    await new TelegramChannel(
      { botToken: 'T', defaultChatId: '-100' }, new SilentLogger(),
    ).send(plain);

    assert.match(calls[0].url, /\/sendMessage$/);
  });

  test('ยังไม่ได้ตั้งค่าห้องแชทต้องบอกให้ชัด', async () => {
    const result = await new TelegramChannel({ botToken: 'T' }, new SilentLogger()).send(message);
    assert.equal(result.success, false);
    assert.match(result.error, /TELEGRAM_CHAT_ID/);
  });
});

describe('CompositeChannel — ส่งหลายช่องทางพร้อมกัน', () => {
  /**
   * ช่องทางปลอมที่ควบคุมผลลัพธ์ได้
   */
  class FakeChannel extends NotificationChannel {
    #name; #ok; sent = 0;

    constructor(name, ok = true) { super(); this.#name = name; this.#ok = ok; }

    get channel() { return this.#name; }

    async send() {
      this.sent += 1;
      if (this.#ok) return { success: true, response: {} };
      throw new Error('ล้มโดยตั้งใจ');
    }
  }

  test('ต้องมีอย่างน้อยหนึ่งช่องทาง', () => {
    assert.throws(() => new CompositeChannel([]), ValidationError);
  });

  test('ช่องทางหนึ่งล้มต้องไม่ทำให้ช่องทางอื่นล้มตาม', async () => {
    const ok = new FakeChannel('line');
    const broken = new FakeChannel('discord', false);
    const result = await new CompositeChannel([broken, ok], new SilentLogger()).send(message);

    assert.equal(ok.sent, 1, 'ช่องทางที่ดีต้องได้ส่ง');
    assert.equal(result.success, true, 'มีอย่างน้อยหนึ่งช่องทางสำเร็จ = สำเร็จ');
    assert.match(result.error, /discord/, 'ต้องรายงานว่าใครไม่ได้รับ');
  });

  test('ล้มทุกช่องทางถึงจะถือว่าล้ม', async () => {
    const result = await new CompositeChannel(
      [new FakeChannel('a', false), new FakeChannel('b', false)], new SilentLogger(),
    ).send(message);
    assert.equal(result.success, false);
  });

  test('ชื่อช่องทางรวมต้องบอกได้ว่าส่งไปไหนบ้าง', () => {
    const composite = new CompositeChannel([new FakeChannel('line'), new FakeChannel('discord')]);
    assert.equal(composite.channel, 'line+discord');
  });

  test('reply ต้องไปเฉพาะช่องทางที่รองรับ ไม่กระจายทุกช่องทาง', async () => {
    const line = new LineChannel({ accessToken: 'x' }, new SilentLogger());
    const discord = new FakeChannel('discord');
    const composite = new CompositeChannel([discord, line], new SilentLogger());

    assert.equal(composite.supportsReply, true);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('{}', { status: 200 });
    try {
      await composite.reply('token', [message]);
      assert.equal(discord.sent, 0, 'Discord ต้องไม่เด้งเพราะมีคนถามใน LINE');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('ไม่มีช่องทางที่ตอบ reply ได้ ต้องบอกเหตุผล', async () => {
    const composite = new CompositeChannel([new FakeChannel('discord')], new SilentLogger());
    const result = await composite.reply('token', [message]);
    assert.equal(result.success, false);
    assert.match(result.error, /reply token/);
  });
});
