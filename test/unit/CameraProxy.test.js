import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DigestClient } from '../../src/services/camera/DigestClient.js';
import { CameraProxyService } from '../../src/services/camera/CameraProxyService.js';
import { Station } from '../../src/models/Station.js';
import { ValidationError } from '../../src/core/errors/index.js';

describe('DigestClient — แยกพารามิเตอร์จาก WWW-Authenticate', () => {
  test('อ่านค่าที่อยู่ในเครื่องหมายคำพูดและที่ไม่อยู่ได้ทั้งคู่', () => {
    const params = DigestClient.parseChallenge(
      'Digest realm="AXIS_E8272506814E", nonce="AX+QtJ9ZBgA=2f4d", algorithm=MD5, qop="auth"',
    );
    assert.equal(params.realm, 'AXIS_E8272506814E');
    assert.equal(params.nonce, 'AX+QtJ9ZBgA=2f4d');
    assert.equal(params.algorithm, 'MD5');
    assert.equal(params.qop, 'auth');
  });

  test('realm ที่มีจุลภาคข้างในต้องไม่ถูกตัดขาด', () => {
    const params = DigestClient.parseChallenge('Digest realm="กล้อง, ท่าน้ำ", nonce="abc"');
    assert.equal(params.realm, 'กล้อง, ท่าน้ำ');
    assert.equal(params.nonce, 'abc');
  });

  test('ไม่มีข้อมูลยืนยันตัวตนต้องรู้ตัว', () => {
    assert.equal(new DigestClient().hasCredentials, false);
    assert.equal(new DigestClient({ username: 'live' }).hasCredentials, true);
  });
});

describe('CameraProxyService', () => {
  /**
   * สร้างจุดวัดสำหรับทดสอบ
   * @param {object} overrides ค่าที่ต้องการเปลี่ยน
   * @returns {Station}
   */
  const makeStation = (overrides = {}) => new Station({
    id: 5, name: 'ท่าน้ำ', slug: 'tha-nam',
    cameraUrl: 'http://cam.example.test:5001/axis-cgi/mjpg/video.cgi',
    cameraType: 'mjpeg', ...overrides,
  });

  /**
   * สร้างบริการที่ไม่ต้องพึ่งฐานข้อมูลจริง
   * @param {Station|null} station จุดวัดที่จะคืน
   * @returns {CameraProxyService}
   */
  const build = (station = makeStation()) => new CameraProxyService({
    stationRepository: { async findById() { return station; } },
    logger: { warn() {}, info() {}, error() {}, debug() {} },
  });

  test('รหัสผ่านที่ฝังใน URL ต้องถูกแยกออกมาเก็บแยก', () => {
    // เกิดขึ้นจริงกับกล้อง Axis ที่ผู้ดูแลวาง URL แบบ user:pass@host มา
    // `fetch` ของ Node ปฏิเสธ URL แบบนี้ และถ้าปล่อยไว้รหัสผ่านจะรั่วสู่หน้าสาธารณะ
    const station = makeStation({
      cameraUrl: 'http://live:Live2025%21@cam.example.test:5001/axis-cgi/mjpg/video.cgi',
    });

    assert.equal(station.cameraUrl, 'http://cam.example.test:5001/axis-cgi/mjpg/video.cgi');
    assert.equal(station.cameraUsername, 'live');
    assert.equal(station.cameraPassword, 'Live2025!');
    assert.equal(station.cameraNeedsAuth, true);
    assert.ok(!JSON.stringify(station.toJSON()).includes('Live2025'));
  });

  test('ค่าที่กรอกในช่องแยกต้องชนะค่าที่ฝังใน URL', () => {
    const station = makeStation({
      cameraUrl: 'http://old:oldpass@cam.example.test/video.cgi',
      cameraUsername: 'ใหม่', cameraPassword: 'รหัสใหม่',
    });
    assert.equal(station.cameraUsername, 'ใหม่');
    assert.equal(station.cameraPassword, 'รหัสใหม่');
  });

  test('URL ปกติที่ไม่มีรหัสผ่านต้องไม่ถูกแตะ', () => {
    const station = makeStation({ cameraUrl: 'https://cam.test/live/a.m3u8' });
    assert.equal(station.cameraUrl, 'https://cam.test/live/a.m3u8');
    assert.equal(station.cameraNeedsAuth, false);
  });

  test('รหัสผ่านกล้องต้องไม่หลุดออกมากับ toJSON()', () => {
    const station = makeStation({ cameraUsername: 'live', cameraPassword: 'Secret123' });
    const json = JSON.stringify(station.toJSON());

    assert.ok(!json.includes('Secret123'), 'รหัสผ่านต้องไม่อยู่ในผลของ toJSON()');
    assert.match(json, /"cameraUsername":"live"/);
    assert.match(json, /"cameraHasPassword":true/);
  });

  test('ลอง URL ที่ตั้งไว้ก่อน แล้วค่อยเดาเส้นทางของยี่ห้อเป็นทางถอย', () => {
    const urls = CameraProxyService.snapshotCandidates(makeStation());
    assert.equal(urls[0], 'http://cam.example.test:5001/axis-cgi/mjpg/video.cgi');
    assert.ok(urls.some((url) => url.endsWith('/axis-cgi/jpg/image.cgi')), 'ควรลอง Axis');
    assert.ok(urls.some((url) => url.includes('/ISAPI/Streaming')), 'ควรลอง Hikvision');
  });

  test('ตั้งชนิดเป็น snapshot แต่วาง URL ของสตรีมมา ต้องยังมีทางถอย', () => {
    // เกิดง่ายมากในการใช้งานจริง — ถ้าเชื่อค่า cameraType อย่างเดียวจะล้มทั้งที่
    // กล้องมีเส้นทางภาพนิ่งให้ใช้อยู่
    const urls = CameraProxyService.snapshotCandidates(
      makeStation({ cameraType: 'snapshot' }),
    );
    assert.ok(urls.length > 1, 'ต้องมีทางถอย ไม่ใช่ลองแค่ URL เดียว');
    assert.ok(urls.some((url) => url.endsWith('/axis-cgi/jpg/image.cgi')));
  });

  test('ไม่ลอง URL เดิมซ้ำสองครั้ง', () => {
    const urls = CameraProxyService.snapshotCandidates(
      makeStation({ cameraUrl: 'http://cam.example.test:5001/axis-cgi/jpg/image.cgi' }),
    );
    assert.equal(new Set(urls).size, urls.length);
  });

  test('อ่านขนาดภาพจากส่วนหัว JPEG ได้โดยไม่ต้องถอดรหัสทั้งใบ', () => {
    // JPEG ขั้นต่ำ: SOI + SOF0 ที่บอกขนาด 1920×1080
    const jpeg = Buffer.from([
      0xFF, 0xD8,
      0xFF, 0xC0, 0x00, 0x11, 0x08, 0x04, 0x38, 0x07, 0x80, 0x03,
      0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    ]);
    assert.deepEqual(CameraProxyService.readJpegSize(jpeg), { width: 1920, height: 1080 });
  });

  test('ข้อมูลที่ไม่ใช่ JPEG ต้องคืน null ไม่ใช่ตัวเลขมั่ว', () => {
    assert.equal(CameraProxyService.readJpegSize(Buffer.from('<html>ไม่ใช่ภาพ</html>')), null);
  });

  test('จุดวัดที่ยังไม่ตั้ง URL กล้องต้องบอกให้ชัด', async () => {
    const service = build(makeStation({ cameraUrl: null }));
    await assert.rejects(() => service.snapshot(5), ValidationError);
  });
});

describe('HttpDetectionService — URL ที่ส่งให้บริการตรวจจับ', () => {
  test('กล้องที่ต้องยืนยันตัวตนต้องได้ URL ที่ฝังข้อมูลยืนยันตัวตนไว้', async () => {
    const { HttpDetectionService } = await import('../../src/services/detection/HttpDetectionService.js');
    const { Roi } = await import('../../src/models/Roi.js');

    const station = new Station({
      id: 3, name: 'วัดเกาะวาลุการาม', slug: 'wat',
      cameraUrl: 'http://cam.example.test:5001/axis-cgi/mjpg/video.cgi',
      cameraType: 'mjpeg', cameraUsername: 'live', cameraPassword: 'Live2025!',
      imageWidth: 1920, imageHeight: 1080,
    });
    const roi = new Roi({
      stationId: 3, name: 'วัด', type: 'measurement', sortOrder: 1,
      points: [{ x: 1, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 9 }, { x: 1, y: 9 }],
      zones: [{ key: 'NORMAL', yPosition: 900 }],
    });

    const original = globalThis.fetch;
    let sent = null;
    globalThis.fetch = async (_url, options) => {
      sent = JSON.parse(options.body);
      return new Response(JSON.stringify({
        success: true, water_line: 467, image_size: { width: 1920, height: 1080 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try {
      await new HttpDetectionService(
        { apiUrl: 'https://api.test', apiKey: 'k' },
        { warn() {}, info() {}, error() {}, debug() {} },
      ).detect(station, [roi]);
    } finally {
      globalThis.fetch = original;
    }

    // FFmpeg (เบื้องหลังของ cv2.VideoCapture) ทำ Digest ได้ จึงส่ง URL ตรงไปเลย
    assert.match(sent.m3u8_url, /^http:\/\/live:Live2025(%21|!)@cam\.example\.test:5001\//);
    assert.equal(sent.camera_type, 'mjpeg');
  });

  test('กล้องที่ไม่ต้องยืนยันตัวตนต้องได้ URL เดิมไม่แตะต้อง', async () => {
    const { HttpDetectionService } = await import('../../src/services/detection/HttpDetectionService.js');
    const { Roi } = await import('../../src/models/Roi.js');

    const station = new Station({
      id: 2, name: 'ท่าน้ำ', slug: 'tha',
      cameraUrl: 'https://stream.test/live/a.m3u8', cameraType: 'm3u8',
      imageWidth: 800, imageHeight: 600,
    });
    const roi = new Roi({
      stationId: 2, name: 'วัด', type: 'measurement', sortOrder: 1,
      points: [{ x: 1, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 9 }, { x: 1, y: 9 }],
      zones: [{ key: 'NORMAL', yPosition: 500 }],
    });

    const original = globalThis.fetch;
    let sent = null;
    globalThis.fetch = async (_url, options) => {
      sent = JSON.parse(options.body);
      return new Response(JSON.stringify({
        success: true, water_line: 400, image_size: { width: 800, height: 600 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try {
      await new HttpDetectionService(
        { apiUrl: 'https://api.test' },
        { warn() {}, info() {}, error() {}, debug() {} },
      ).detect(station, [roi]);
    } finally {
      globalThis.fetch = original;
    }

    assert.equal(sent.m3u8_url, 'https://stream.test/live/a.m3u8');
  });
});

describe('ภาพสดสาธารณะ', () => {
  /**
   * บริการที่นับจำนวนครั้งที่ยิงกล้องจริง
   * @param {number} delayMs หน่วงเวลาของกล้อง
   * @returns {{service: CameraProxyService, calls: () => number}}
   */
  function buildCounting(delayMs = 30) {
    let calls = 0;
    const service = new CameraProxyService({
      stationRepository: { async findById() { return null; } },
      logger: { warn() {}, info() {}, error() {}, debug() {} },
    });
    service.snapshot = async () => {
      calls += 1;
      await new Promise((resolve) => { setTimeout(resolve, delayMs); });
      return { buffer: Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]), contentType: 'image/jpeg' };
    };
    return { service, calls: () => calls };
  }

  test('ผู้ชมหลายคนพร้อมกันต้องยิงกล้องครั้งเดียว', async () => {
    const { service, calls } = buildCounting();
    await Promise.all(Array.from({ length: 20 }, () => service.cachedSnapshot(1)));
    assert.equal(calls(), 1, 'กล้อง IP รับไม่ไหวถ้ายิงตามจำนวนผู้ชม');
  });

  test('ขอซ้ำในช่วงแคชต้องได้ภาพเดิมโดยไม่ยิงกล้องใหม่', async () => {
    const { service, calls } = buildCounting();
    await service.cachedSnapshot(1);
    const second = await service.cachedSnapshot(1);
    assert.equal(calls(), 1);
    assert.equal(second.cached, true);
  });

  test('จุดวัดคนละแห่งต้องแคชแยกกัน', async () => {
    const { service, calls } = buildCounting();
    await Promise.all([service.cachedSnapshot(1), service.cachedSnapshot(2)]);
    assert.equal(calls(), 2);
  });

  test('กล้องล้มต้องไม่ค้างสถานะจนขอใหม่ไม่ได้', async () => {
    const service = new CameraProxyService({
      stationRepository: { async findById() { return null; } },
      logger: { warn() {} },
    });
    let attempts = 0;
    service.snapshot = async () => {
      attempts += 1;
      throw new Error('กล้องไม่ตอบ');
    };

    await assert.rejects(() => service.cachedSnapshot(1));
    await assert.rejects(() => service.cachedSnapshot(1));
    assert.equal(attempts, 2, 'ต้องลองใหม่ได้ ไม่ใช่ค้างที่ pending เดิม');
  });

  test('ปิดภาพสดไว้ ต้องไม่ถือว่าเปิด แม้จะมี URL กล้อง', () => {
    const off = new Station({
      id: 9, name: 'x', slug: 'x', cameraUrl: 'https://cam.test/a.m3u8',
    });
    assert.equal(off.publicLiveEnabled, false, 'ต้องปิดเป็นค่าเริ่มต้น (PDPA)');

    const on = new Station({
      id: 9, name: 'x', slug: 'x', cameraUrl: 'https://cam.test/a.m3u8',
      publicLiveEnabled: true,
    });
    assert.equal(on.publicLiveEnabled, true);
  });

  test('เปิดภาพสดแต่ไม่มี URL กล้อง ต้องถือว่าปิด', () => {
    const station = new Station({ id: 9, name: 'x', slug: 'x', publicLiveEnabled: true });
    assert.equal(station.publicLiveEnabled, false);
  });
});
