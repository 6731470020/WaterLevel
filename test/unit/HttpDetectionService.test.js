import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { HttpDetectionService } from '../../src/services/detection/HttpDetectionService.js';
import { Station } from '../../src/models/Station.js';
import { Roi } from '../../src/models/Roi.js';
import { ValidationError, UpstreamError } from '../../src/core/errors/index.js';

/** ตัวบันทึกเหตุการณ์หลอก — เก็บข้อความไว้ตรวจแทนที่จะพิมพ์ออกจอ */
class SilentLogger {
  warn() {}

  info() {}

  error() {}

  debug() {}
}

/**
 * สร้างจุดวัดสำหรับทดสอบ
 * @param {object} overrides ค่าที่ต้องการเปลี่ยน
 * @returns {Station}
 */
function makeStation(overrides = {}) {
  return new Station({
    id: 1,
    name: 'จุดวัดทดสอบ',
    slug: 'test',
    cameraUrl: 'https://cam.example.com/stream.m3u8',
    cameraType: 'm3u8',
    imageWidth: 800,
    imageHeight: 600,
    isActive: true,
    ...overrides,
  });
}

/**
 * สร้าง ROI สำหรับทดสอบ
 * @param {string} type ชนิด
 * @param {number} sortOrder ลำดับ
 * @returns {Roi}
 */
function makeRoi(type, sortOrder) {
  return new Roi({
    id: sortOrder,
    stationId: 1,
    name: `${type}-${sortOrder}`,
    type,
    sortOrder,
    points: [{ x: 1, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 9 }, { x: 1, y: 9 }],
    zones: type === 'measurement'
      ? [{ zoneKey: 'NORMAL', name: 'ปกติ', color: '#E5E7EB', yPosition: 500 }]
      : [],
  });
}

describe('HttpDetectionService', () => {
  const originalFetch = globalThis.fetch;
  let sentBodies = [];
  let respond = null;

  beforeEach(() => {
    sentBodies = [];
    globalThis.fetch = async (_url, options) => {
      sentBodies.push(JSON.parse(options.body));
      return respond(sentBodies.length);
    };
  });

  afterEach(() => { globalThis.fetch = originalFetch; });

  /**
   * สร้างบริการที่ชี้ไปยัง URL หลอก
   * @returns {HttpDetectionService}
   */
  const build = () => new HttpDetectionService({
    apiUrl: 'https://api.test', apiKey: 'k', timeoutMs: 1000, logger: new SilentLogger(),
  });

  /**
   * คำตอบสำเร็จมาตรฐาน
   * @param {object} extra ฟิลด์เพิ่ม
   * @returns {Response}
   */
  const okResponse = (extra = {}) => new Response(JSON.stringify({
    success: true,
    water_line: 420,
    zone_info: { zone_name: 'ปกติ', zone_color: '#E5E7EB' },
    image_size: { width: 800, height: 600 },
    ...extra,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  test('ส่ง ROI วัดระดับเป็นตัวแรกเสมอ แม้ผู้ใช้จะวาด ROI ตรวจจับก่อน', async () => {
    respond = () => okResponse();
    // ผู้ใช้วาดกรอบตรวจจับก่อน (sortOrder 1) แล้วค่อยวาดกรอบวัดระดับ (sortOrder 2)
    await build().detect(makeStation(), [makeRoi('detection', 1), makeRoi('measurement', 2)]);

    const types = sentBodies[0].config.rois.map((roi) => roi.type);
    assert.deepEqual(types, ['measurement', 'detection'],
      'บริการตรวจจับอ่านบทบาทจากลำดับในอาร์เรย์ ไม่ใช่ฟิลด์ type');
  });

  test('ROI ชนิดเดียวกันยังเรียงตาม sortOrder ที่ผู้ใช้กำหนด', async () => {
    respond = () => okResponse();
    await build().detect(makeStation(), [makeRoi('measurement', 5), makeRoi('measurement', 2)]);
    assert.deepEqual(sentBodies[0].config.rois.map((roi) => roi.name),
      ['measurement-2', 'measurement-5']);
  });

  test('ขนาดภาพไม่ตรงกับที่จุดวัดตั้งไว้ ต้องปฏิเสธ ไม่ใช่คืนค่าที่ผิด', async () => {
    respond = () => okResponse({ image_size: { width: 704, height: 571 } });

    await assert.rejects(
      () => build().detect(makeStation(), [makeRoi('measurement', 1)]),
      (error) => {
        assert.ok(error instanceof ValidationError);
        assert.match(error.message, /704×571/);
        assert.match(error.message, /800×600/);
        return true;
      },
    );
    assert.equal(sentBodies.length, 1, 'ขนาดไม่ตรงเป็นปัญหาการตั้งค่า ห้ามลองซ้ำ');
  });

  test('ข้อผิดพลาดเชิงตรรกะ (success:false) ต้องไม่ลองซ้ำ', async () => {
    respond = () => new Response(
      JSON.stringify({ success: false, error: 'No staff detected in detection ROI' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

    await assert.rejects(
      () => build().detect(makeStation(), [makeRoi('measurement', 1)]),
      UpstreamError,
    );
    assert.equal(sentBodies.length, 1, 'ลองกี่ครั้งก็ได้ผลเดิม จึงต้องเรียกครั้งเดียว');
  });

  test('ผิวน้ำที่ขอบล่างของเฟรมต้องบันทึกได้ แต่ติดธงว่าเป็นค่าประมาณ', async () => {
    respond = () => okResponse({ water_line: 599 });

    const result = await build().detect(makeStation(), [makeRoi('measurement', 1)]);
    assert.equal(result.waterLinePx.value, 599);
    assert.equal(result.isAtFrameEdge, true,
      'ต้องบอกได้ว่าเป็นค่าประมาณ ไม่ใช่ทิ้งข้อมูลไปเลย');
    assert.equal(sentBodies.length, 1);
  });

  test('ผิวน้ำที่อยู่ในเฟรมจริงต้องไม่ถูกติดธงค่าประมาณ', async () => {
    respond = () => okResponse({ water_line: 596 });
    const result = await build().detect(makeStation(), [makeRoi('measurement', 1)]);
    assert.equal(result.waterLinePx.value, 596);
    assert.equal(result.isAtFrameEdge, false);
  });

  test('ข้อผิดพลาดชั่วคราว (HTTP 500) ยังลองซ้ำตามเดิม', async () => {
    respond = (call) => (call < 3
      ? new Response('boom', { status: 500 })
      : okResponse());

    const result = await build().detect(makeStation(), [makeRoi('measurement', 1)]);
    assert.equal(result.waterLinePx.value, 420);
    assert.equal(sentBodies.length, 3, 'ต้องลองซ้ำจนสำเร็จ');
  });
});
