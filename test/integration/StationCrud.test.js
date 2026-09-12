import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TestDatabase } from '../helpers/TestDatabase.js';
import { Logger } from '../../src/core/Logger.js';
import { MemoryCache } from '../../src/core/MemoryCache.js';
import { EventBus } from '../../src/core/EventBus.js';
import { StationRepository } from '../../src/repositories/StationRepository.js';
import { RoiRepository } from '../../src/repositories/RoiRepository.js';
import { CalibrationRepository } from '../../src/repositories/CalibrationRepository.js';
import { MeasurementRepository } from '../../src/repositories/MeasurementRepository.js';
import { ValidationLogRepository } from '../../src/repositories/ValidationLogRepository.js';
import { AlertStateRepository } from '../../src/repositories/AlertStateRepository.js';
import { AuditLogRepository } from '../../src/repositories/AuditLogRepository.js';
import { PermissionRepository } from '../../src/repositories/PermissionRepository.js';
import { UserRepository } from '../../src/repositories/UserRepository.js';
import { SessionRepository } from '../../src/repositories/SessionRepository.js';
import { AuditService } from '../../src/services/AuditService.js';
import { PermissionService } from '../../src/services/PermissionService.js';
import { StationService } from '../../src/services/StationService.js';
import { RoiService } from '../../src/services/RoiService.js';
import { CalibrationService } from '../../src/services/CalibrationService.js';
import { MeasurementService } from '../../src/services/MeasurementService.js';
import { User } from '../../src/models/User.js';
import { PixelLevel } from '../../src/models/values/PixelLevel.js';
import { ConflictError, ValidationError } from '../../src/core/errors/index.js';

let testDb;
let stationService;
let roiService;
let calibrationService;
let measurementService;
let eventBus;
let actor;
let permissionServiceRef;
let auditServiceRef;

/** ROI มาตรฐานพร้อมโซน 6 ระดับ (ตำแหน่งจริงจากระบบเดิม) */
const SAMPLE_ROIS = [{
  name: 'ROI วัดระดับ',
  type: 'measurement',
  points: [{ x: 420, y: 202 }, { x: 449, y: 203 }, { x: 416, y: 575 }, { x: 391, y: 572 }],
  zones: [
    { key: 'CRITICAL', yPosition: 204 }, { key: 'SEVERE', yPosition: 247 },
    { key: 'DANGER', yPosition: 286 }, { key: 'WATCH', yPosition: 309 },
    { key: 'HIGH', yPosition: 327 }, { key: 'NORMAL', yPosition: 368 },
  ],
}];

/**
 * ชุดเดียวกันแต่ระบุระดับน้ำของแต่ละโซนไว้ด้วย
 * — ตัวเลขตรงกับ `SAMPLE_CALIBRATION` เพราะในทางปฏิบัติมันคือข้อมูลชุดเดียวกัน
 */
const SAMPLE_ROIS_WITH_METERS = [{
  ...SAMPLE_ROIS[0],
  zones: [
    { key: 'CRITICAL', yPosition: 204, meterLevel: 4.00 },
    { key: 'SEVERE', yPosition: 247, meterLevel: 3.80 },
    { key: 'DANGER', yPosition: 286, meterLevel: 3.60 },
    { key: 'WATCH', yPosition: 309, meterLevel: 3.50 },
    { key: 'HIGH', yPosition: 327, meterLevel: 3.40 },
    { key: 'NORMAL', yPosition: 368, meterLevel: 3.20 },
  ],
}];

/** จุดเทียบค่าจริงจากระบบเดิม */
const SAMPLE_CALIBRATION = [
  { pixel: 204, meter: 4.00 }, { pixel: 247, meter: 3.80 }, { pixel: 286, meter: 3.60 },
  { pixel: 309, meter: 3.50 }, { pixel: 327, meter: 3.40 }, { pixel: 368, meter: 3.20 },
];

before(async () => {
  Logger.configure({ level: 'error', logDir: null, console: false });
  testDb = await TestDatabase.create();
  eventBus = new EventBus();

  const cache = new MemoryCache();
  auditServiceRef = new AuditService({
    auditRepository: new AuditLogRepository(testDb.db), logger: Logger.getInstance(),
  });
  permissionServiceRef = new PermissionService({
    permissionRepository: new PermissionRepository(testDb.db),
    sessionRepository: new SessionRepository(testDb.db),
    userRepository: new UserRepository(testDb.db),
    cache, eventBus, logger: Logger.getInstance(),
  });

  const stationRepository = new StationRepository(testDb.db);
  const roiRepository = new RoiRepository(testDb.db);
  const calibrationRepository = new CalibrationRepository(testDb.db);

  stationService = new StationService({
    stationRepository, calibrationRepository, roiRepository,
    permissionService: permissionServiceRef, auditService: auditServiceRef,
    logger: Logger.getInstance(),
  });
  calibrationService = new CalibrationService({
    calibrationRepository, permissionService: permissionServiceRef,
    auditService: auditServiceRef, cache,
    measurementRepository: new MeasurementRepository(testDb.db),
    logger: Logger.getInstance(),
  });
  roiService = new RoiService({
    roiRepository, stationRepository, permissionService: permissionServiceRef,
    auditService: auditServiceRef, cache, calibrationService, logger: Logger.getInstance(),
  });
  measurementService = new MeasurementService({
    measurementRepository: new MeasurementRepository(testDb.db),
    validationLogRepository: new ValidationLogRepository(testDb.db),
    alertStateRepository: new AlertStateRepository(testDb.db),
    calibrationService, roiService, permissionService: permissionServiceRef,
    eventBus, logger: Logger.getInstance(),
  });

  // ผู้ดูแลสูงสุดจำลอง — ไม่ต้องบันทึกลงฐานข้อมูลเพราะ audit log ยอมรับ actorId ที่เป็น null
  actor = new User({
    id: null, username: 'ผู้ทดสอบ', email: 'test@example.com',
    passwordHash: 'scrypt$aa$bb', fullName: 'ผู้ทดสอบ', isSuperAdmin: true,
  });
  actor.assignRoles([]);
  actor.assignStations(null);
});

after(async () => { await testDb?.destroy(); });

beforeEach(async () => {
  await testDb.truncate(['measurements', 'validation_logs', 'station_alert_states',
    'calibration_points', 'station_rois', 'stations']);
});

describe('StationService — CRUD', () => {
  test('สร้างจุดวัดใหม่และอ่านกลับได้', async () => {
    const station = await stationService.create({
      name: 'วัดเขียน อบต.บางไผ่', slug: 'wat-khian', cameraType: 'm3u8',
      cameraUrl: 'https://live.example.com/index.m3u8',
      imageWidth: 704, imageHeight: 576, latitude: 13.8621, longitude: 100.4103,
    }, { actor });

    assert.equal(station.name, 'วัดเขียน อบต.บางไผ่');
    assert.equal(station.slug, 'wat-khian');
    assert.equal(station.isActive, true);
    assert.deepEqual(station.alertZoneKeys, ['CRITICAL', 'SEVERE'], 'ค่าเริ่มต้นของโซนแจ้งเตือน');
  });

  test('slug ซ้ำต้องโยน ConflictError', async () => {
    await stationService.create({ name: 'จุด A', slug: 'dup', cameraType: 'm3u8' }, { actor });
    await assert.rejects(
      () => stationService.create({ name: 'จุด B', slug: 'dup', cameraType: 'm3u8' }, { actor }),
      ConflictError,
    );
  });

  test('URL กล้องที่ชี้ IP ภายในต้องถูกปฏิเสธ (ป้องกัน SSRF)', async () => {
    await assert.rejects(
      () => stationService.create({
        name: 'จุดเสี่ยง', slug: 'ssrf', cameraType: 'm3u8',
        cameraUrl: 'http://192.168.1.1/cam',
      }, { actor }),
      ValidationError,
    );
  });

  test('ALLOW_PRIVATE_CAMERA_URL=true ต้องบันทึกกล้องในเครือข่ายภายในได้จริง', async () => {
    // กล้อง IP ที่ติดตั้งในสำนักงานมักอยู่ที่ 192.168.x.x — ถ้าธงนี้ใช้ไม่ได้
    // หน่วยงานจะเพิ่มกล้องของตัวเองไม่ได้เลย
    const permissive = new StationService({
      stationRepository: new StationRepository(testDb.db),
      calibrationRepository: { findByStation: async () => [] },
      roiRepository: { findByStation: async () => [] },
      permissionService: permissionServiceRef,
      auditService: auditServiceRef,
      allowPrivateCameraUrl: true,
      logger: Logger.getInstance(),
    });

    const station = await permissive.create({
      name: 'กล้องในสำนักงาน', slug: 'lan-cam', cameraType: 'm3u8',
      cameraUrl: 'http://192.168.1.50/stream.m3u8',
    }, { actor });

    assert.equal(station.cameraUrl, 'http://192.168.1.50/stream.m3u8');

    // แก้ไขแล้วบันทึกซ้ำก็ต้องผ่านเช่นกัน
    const updated = await permissive.update(station.id, { name: 'กล้องในสำนักงาน 2' }, { actor });
    assert.equal(updated.name, 'กล้องในสำนักงาน 2');
    assert.equal(updated.cameraUrl, 'http://192.168.1.50/stream.m3u8');
  });

  test('สร้าง slug อัตโนมัติจากชื่อภาษาไทยได้', async () => {
    const station = await stationService.create({
      name: 'วัดเขียน อบต.บางไผ่', cameraType: 'm3u8',
    }, { actor });
    assert.match(station.slug, /^[a-z0-9-]{2,100}$/, 'slug ต้องใช้ใน URL ได้');
  });

  test('แก้ไขจุดวัดแล้วบันทึกก่อน-หลังลง audit log', async () => {
    const station = await stationService.create(
      { name: 'ชื่อเดิม', slug: 'edit-me', cameraType: 'm3u8' }, { actor },
    );
    await stationService.update(station.id, { name: 'ชื่อใหม่' }, { actor });

    const updated = await stationService.findForUser(actor, station.id);
    assert.equal(updated.name, 'ชื่อใหม่');

    const { items } = await new AuditLogRepository(testDb.db).search({ action: 'station.update' });
    assert.equal(items[0].beforeData.name, 'ชื่อเดิม');
    assert.equal(items[0].afterData.name, 'ชื่อใหม่');
  });

  test('ลบจุดวัดแล้วข้อมูลลูกถูกลบตามด้วย Foreign Key', async () => {
    const station = await stationService.create(
      { name: 'จะถูกลบ', slug: 'delete-me', cameraType: 'm3u8' }, { actor },
    );
    await roiService.replaceForStation(station.id, SAMPLE_ROIS, { actor });
    await calibrationService.replaceForStation(station.id, SAMPLE_CALIBRATION, { actor });

    assert.equal(await testDb.count('station_rois'), 1);
    assert.equal(await testDb.count('calibration_points'), 6);

    await stationService.delete(station.id, { actor });

    assert.equal(await testDb.count('station_rois'), 0, 'ROI ต้องถูกลบตาม');
    assert.equal(await testDb.count('calibration_points'), 0, 'จุดเทียบค่าต้องถูกลบตาม');
  });

  test('เปิด/ปิดการใช้งานจุดวัด', async () => {
    const station = await stationService.create(
      { name: 'จุดวัด', slug: 'toggle', cameraType: 'm3u8' }, { actor },
    );
    await stationService.setActive(station.id, false, { actor });
    assert.equal((await stationService.findForUser(actor, station.id)).isActive, false);

    const active = await stationService.activeStations();
    assert.equal(active.length, 0, 'งานตามเวลาต้องไม่หยิบจุดวัดที่ปิดอยู่');
  });
});

describe('StationService.readiness — ความพร้อมของจุดวัด', () => {
  test('จุดวัดใหม่ยังไม่พร้อม และบอกสาเหตุครบ', async () => {
    const station = await stationService.create(
      { name: 'จุดใหม่', slug: 'not-ready', cameraType: 'm3u8' }, { actor },
    );
    const readiness = await stationService.readiness(station.id);

    assert.equal(readiness.ready, false);
    assert.ok(readiness.issues.some((i) => i.includes('URL กล้อง')));
    assert.ok(readiness.issues.some((i) => i.includes('จุดเทียบค่า')));
    assert.ok(readiness.issues.some((i) => i.includes('ROI')));
  });

  test('ตั้งค่าครบแล้วต้องพร้อมใช้งาน', async () => {
    const station = await stationService.create({
      name: 'จุดพร้อม', slug: 'ready', cameraType: 'm3u8',
      cameraUrl: 'https://live.example.com/index.m3u8',
    }, { actor });

    await roiService.replaceForStation(station.id, SAMPLE_ROIS, { actor });
    await calibrationService.replaceForStation(station.id, SAMPLE_CALIBRATION, { actor });

    const readiness = await stationService.readiness(station.id);
    assert.deepEqual(readiness.issues, []);
    assert.equal(readiness.ready, true);
  });
});

describe('RoiService — ROI และโซน', () => {
  let stationId;

  beforeEach(async () => {
    const station = await stationService.create(
      { name: 'จุดวัด', slug: 'roi-test', cameraType: 'm3u8' }, { actor },
    );
    stationId = station.id;
  });

  test('บันทึก ROI พร้อมโซน 6 ระดับ', async () => {
    const { rois, warnings } = await roiService.replaceForStation(stationId, SAMPLE_ROIS, { actor });
    assert.equal(rois.length, 1);
    assert.equal(rois[0].zones.length, 6);
    // โซนไม่ได้ระบุระดับน้ำ จึงยังไม่มีจุดเทียบค่า — ต้องเตือนเพราะจุดวัดนี้ยังวัดไม่ได้
    assert.deepEqual(
      warnings.filter((warning) => !warning.includes('จุดเทียบค่า')), [],
      'ชุดโซนที่ถูกต้องต้องไม่มีคำเตือนเรื่องโซน',
    );
    assert.ok(warnings.some((warning) => warning.includes('จุดเทียบค่าเพียง 0 จุด')));
  });

  test('โซนที่ระบุระดับน้ำไว้ต้องกลายเป็นจุดเทียบค่าให้อัตโนมัติ', async () => {
    const { warnings } = await roiService.replaceForStation(
      stationId, SAMPLE_ROIS_WITH_METERS, { actor },
    );
    assert.deepEqual(warnings, [], 'ชุดที่สมบูรณ์ต้องไม่มีคำเตือนใด ๆ');

    const points = await calibrationService.listForStation(stationId);
    assert.equal(points.length, 6, 'ต้องได้จุดเทียบค่าครบทั้ง 6 โซน');
    assert.deepEqual(
      points.map((point) => [point.pixelValue, point.meterValue]),
      [[204, 4], [247, 3.8], [286, 3.6], [309, 3.5], [327, 3.4], [368, 3.2]],
      'ต้องเรียงตามพิกเซลจากน้อยไปมากและค่าตรงกับที่กรอกในโซน',
    );
    assert.ok(points.every((point) => point.isFromZone), 'ทุกจุดต้องมีเจ้าของเป็นโซน');

    // ใช้คำนวณได้จริง — พิกเซล 298 อยู่ระหว่าง (286, 3.60) กับ (309, 3.50)
    const calculator = await calibrationService.calculatorFor(stationId);
    assert.equal(calculator.pixelToMeter(298).value, 3.55);
  });

  test('ย้ายโซนแล้วจุดเทียบค่าเดิมต้องหายไป ไม่ค้างสะสม', async () => {
    await roiService.replaceForStation(stationId, SAMPLE_ROIS_WITH_METERS, { actor });

    const moved = [{
      ...SAMPLE_ROIS_WITH_METERS[0],
      zones: SAMPLE_ROIS_WITH_METERS[0].zones.map((zone) => ({
        ...zone, yPosition: zone.yPosition + 10,
      })),
    }];
    await roiService.replaceForStation(stationId, moved, { actor });

    const points = await calibrationService.listForStation(stationId);
    assert.equal(points.length, 6, 'ต้องยังมี 6 จุด ไม่ใช่ 12');
    assert.deepEqual(points.map((point) => point.pixelValue), [214, 257, 296, 319, 337, 378]);
  });

  test('ลบค่าระดับน้ำออกจากโซนแล้วจุดเทียบค่าของโซนนั้นต้องหายตาม', async () => {
    await roiService.replaceForStation(stationId, SAMPLE_ROIS_WITH_METERS, { actor });

    const cleared = [{
      ...SAMPLE_ROIS_WITH_METERS[0],
      zones: SAMPLE_ROIS_WITH_METERS[0].zones.map((zone, index) => (
        index < 2 ? zone : { ...zone, meterLevel: null }
      )),
    }];
    await roiService.replaceForStation(stationId, cleared, { actor });

    const points = await calibrationService.listForStation(stationId);
    assert.deepEqual(points.map((point) => point.pixelValue), [204, 247]);
  });

  test('จุดที่กรอกเองต้องอยู่รอดเมื่อบันทึก ROI ใหม่', async () => {
    await roiService.replaceForStation(stationId, SAMPLE_ROIS_WITH_METERS, { actor });
    await calibrationService.replaceForStation(stationId, [{ pixel: 500, meter: 2.5 }], { actor });

    await roiService.replaceForStation(stationId, SAMPLE_ROIS_WITH_METERS, { actor });

    const points = await calibrationService.listForStation(stationId);
    assert.equal(points.length, 7);
    const manual = points.filter((point) => !point.isFromZone);
    assert.deepEqual(manual.map((point) => point.pixelValue), [500]);
  });

  test('ขนาดภาพที่ส่งมาพร้อม ROI ต้องอัปเดตจุดวัดให้ตรงกัน', async () => {
    const { warnings } = await roiService.replaceForStation(stationId, SAMPLE_ROIS, {
      actor, imageWidth: 800, imageHeight: 600,
    });

    const station = await stationService.findForUser(actor, stationId);
    assert.equal(station.imageWidth, 800);
    assert.equal(station.imageHeight, 600);
    assert.ok(warnings.some((warning) => warning.includes('800×600')),
      `ต้องแจ้งว่าเปลี่ยนขนาดให้ แต่ได้: ${JSON.stringify(warnings)}`);
  });

  test('ส่งขนาดเท่าเดิมต้องไม่แจ้งอะไรและไม่เขียนซ้ำ', async () => {
    await roiService.replaceForStation(stationId, SAMPLE_ROIS, {
      actor, imageWidth: 800, imageHeight: 600,
    });
    const { warnings } = await roiService.replaceForStation(stationId, SAMPLE_ROIS, {
      actor, imageWidth: 800, imageHeight: 600,
    });
    assert.equal(warnings.filter((warning) => warning.includes('ปรับขนาด')).length, 0);
  });

  test('ขนาดภาพที่ไม่ถูกต้องต้องถูกปฏิเสธ', async () => {
    for (const size of [{ imageWidth: 0, imageHeight: 600 }, { imageWidth: 800, imageHeight: 99999 }]) {
      await assert.rejects(
        () => roiService.replaceForStation(stationId, SAMPLE_ROIS, { actor, ...size }),
        ValidationError,
        `ต้องปฏิเสธ ${JSON.stringify(size)}`,
      );
    }
  });

  test('ไม่ส่งขนาดมาเลยต้องไม่แตะขนาดเดิม', async () => {
    const before = await stationService.findForUser(actor, stationId);
    await roiService.replaceForStation(stationId, SAMPLE_ROIS, { actor });
    const after = await stationService.findForUser(actor, stationId);
    assert.equal(after.imageWidth, before.imageWidth);
    assert.equal(after.imageHeight, before.imageHeight);
  });

  test('ขั้นจุดเทียบค่าล้ม ต้องย้อน ROI กลับด้วย ไม่เหลือสถานะครึ่งทาง', async () => {
    await roiService.replaceForStation(stationId, SAMPLE_ROIS, { actor });
    const before = await roiService.listForStation(stationId);
    assert.equal(before.length, 1);

    const original = calibrationService.syncFromZones;
    calibrationService.syncFromZones = async () => {
      throw new Error('จำลองความล้มเหลวหลังเขียน ROI แล้ว');
    };
    try {
      await assert.rejects(() => roiService.replaceForStation(stationId, [
        ...SAMPLE_ROIS,
        {
          name: 'กรอบที่สอง', type: 'detection',
          points: [{ x: 1, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 9 }, { x: 1, y: 9 }], zones: [],
        },
      ], { actor }));
    } finally {
      calibrationService.syncFromZones = original;
    }

    const after = await roiService.listForStation(stationId);
    assert.equal(after.length, 1, 'ROI ต้องกลับไปเป็นชุดเดิม ไม่ใช่ชุดใหม่ที่เขียนค้างไว้');
    assert.equal(after[0].name, before[0].name);
  });

  test('มุม ROI ที่หลุดนอกกรอบภาพต้องได้คำเตือน', async () => {
    const outside = [{
      ...SAMPLE_ROIS[0],
      points: [{ x: 420, y: 202 }, { x: 449, y: 203 }, { x: 416, y: 700 }, { x: 391, y: 690 }],
    }];
    const { warnings } = await roiService.replaceForStation(stationId, outside, {
      actor, imageWidth: 800, imageHeight: 600,
    });
    assert.ok(warnings.some((warning) => warning.includes('นอกกรอบภาพ')),
      `ต้องเตือนเรื่องมุมหลุดกรอบ แต่ได้: ${JSON.stringify(warnings)}`);
  });

  test('ค่าวัดที่บันทึกก่อนมีจุดเทียบค่า ต้องได้ค่าเมตรย้อนหลังเมื่อตั้งโซน', async () => {
    // บันทึกค่าวัดตอนที่ยังไม่มีจุดเทียบค่าเลย — water_level_m จึงเป็น null
    await testDb.db.execute(
      'INSERT INTO measurements (station_id, water_line, water_level_m, zone_key, source, measured_at)'
      + " VALUES (?, ?, NULL, NULL, 'CRON', ?)",
      [stationId, 298, '2026-08-21 19:25:01'],
    );

    await roiService.replaceForStation(stationId, SAMPLE_ROIS_WITH_METERS, { actor });

    const row = await testDb.db.queryOne(
      'SELECT water_level_m, zone_key FROM measurements WHERE station_id = ?', [stationId],
    );
    // พิกเซล 298 อยู่ระหว่าง (286, 3.60) กับ (309, 3.50) → 3.55 ม.
    assert.equal(Number(row.water_level_m), 3.55);
    assert.equal(row.zone_key, 'DANGER', 'ต้องได้โซนย้อนหลังด้วย');
  });

  test('ใส่ระดับน้ำไม่ครบทุกโซน ต้องบอกชื่อโซนที่ขาด', async () => {
    const partial = [{
      ...SAMPLE_ROIS_WITH_METERS[0],
      zones: SAMPLE_ROIS_WITH_METERS[0].zones.map((zone) => (
        zone.key === 'HIGH' ? { ...zone, meterLevel: null } : zone
      )),
    }];
    const { warnings } = await roiService.replaceForStation(stationId, partial, { actor });

    const notice = warnings.find((warning) => warning.includes('ยังไม่ได้ใส่ระดับน้ำ'));
    assert.ok(notice, `ต้องเตือน แต่ได้: ${JSON.stringify(warnings)}`);
    assert.match(notice, /ระดับน้ำสูง/);
    assert.match(notice, /5 จุดจากทั้งหมด 6 โซน/);
  });

  test('ใส่ครบทุกโซนต้องไม่มีคำเตือนเรื่องกรอกไม่ครบ', async () => {
    const { warnings } = await roiService.replaceForStation(
      stationId, SAMPLE_ROIS_WITH_METERS, { actor },
    );
    assert.ok(!warnings.some((warning) => warning.includes('ยังไม่ได้ใส่ระดับน้ำ')));
  });

  test('ระดับน้ำของโซนที่กลับหัวต้องได้คำเตือน', async () => {
    const inverted = [{
      ...SAMPLE_ROIS_WITH_METERS[0],
      zones: [
        { key: 'CRITICAL', yPosition: 204, meterLevel: 3.20 },  // อยู่บนสุดแต่น้ำต่ำสุด — ผิด
        { key: 'NORMAL', yPosition: 368, meterLevel: 4.00 },
      ],
    }];
    const { warnings } = await roiService.replaceForStation(stationId, inverted, { actor });
    assert.ok(warnings.some((warning) => warning.includes('ไม่ต่ำกว่าโซน')),
      `ต้องเตือนเรื่องทิศทาง แต่ได้: ${JSON.stringify(warnings)}`);
  });

  test('ต้องมี ROI ชนิดวัดระดับอย่างน้อย 1 กรอบ', async () => {
    await assert.rejects(
      () => roiService.replaceForStation(stationId, [{
        name: 'ตรวจจับอย่างเดียว', type: 'detection',
        points: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }], zones: [],
      }], { actor }),
      ValidationError,
    );
  });

  test('ROI ที่มีมุมไม่ครบ 4 จุดต้องถูกปฏิเสธ', async () => {
    await assert.rejects(
      () => roiService.replaceForStation(stationId, [{
        ...SAMPLE_ROIS[0], points: [{ x: 1, y: 1 }, { x: 2, y: 2 }],
      }], { actor }),
      ValidationError,
    );
  });

  test('โซนที่เรียงผิดลำดับต้องได้คำเตือน แต่ยังบันทึกได้', async () => {
    const swapped = [{
      ...SAMPLE_ROIS[0],
      zones: [
        { key: 'CRITICAL', yPosition: 400 },  // ร้ายแรงที่สุดแต่อยู่ล่างสุด — ผิด
        { key: 'NORMAL', yPosition: 204 },
      ],
    }];
    const { warnings } = await roiService.replaceForStation(stationId, swapped, { actor });
    assert.ok(warnings.length > 0, 'ต้องเตือนเมื่อลำดับโซนผิด');
    assert.ok(warnings.some((w) => w.includes('ลำดับโซนผิด')));
  });

  test('บันทึกซ้ำต้องแทนที่ชุดเดิมทั้งหมด ไม่สะสม', async () => {
    await roiService.replaceForStation(stationId, SAMPLE_ROIS, { actor });
    await roiService.replaceForStation(stationId, SAMPLE_ROIS, { actor });
    assert.equal(await testDb.count('station_rois'), 1);
  });

  test('นำเข้าไฟล์ config เวอร์ชัน 3.0 ของระบบเดิมได้', async () => {
    const legacyV3 = {
      version: '3.0',
      rois: [{
        id: 1764316068824, name: 'วัดเขียน อบต.บางไผ่', type: 'measurement',
        points: [{ x: 420, y: 202 }, { x: 449, y: 203 }, { x: 416, y: 575 }, { x: 391, y: 572 }],
        zones: [
          { name: 'วิกฤตมาก', color_hex: 'EF4444', y_position: 204 },
          { name: 'วิกฤต', color_hex: 'F97316', y_position: 247 },
          { name: 'ปกติ', color_hex: 'E5E7EB', y_position: 368 },
        ],
      }],
    };
    const { rois } = await roiService.importLegacyConfig(stationId, legacyV3, { actor });
    assert.equal(rois.length, 1);
    assert.equal(rois[0].zones.length, 3);
    assert.equal(rois[0].zones[0].key, 'CRITICAL', 'ต้องแปลงชื่อไทยเป็นคีย์อังกฤษ');
  });

  test('นำเข้าไฟล์ config เวอร์ชัน 2.0 ของระบบเดิมได้', async () => {
    const legacyV2 = {
      version: '2.0',
      location_name: 'จุดวัดเก่า',
      roi: { points: [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }, { x: 10, y: 20 }] },
      zones: [
        { name: 'วิกฤตมาก', y_position: 12 },
        { name: 'ปกติ', y_position: 18 },
      ],
    };
    const { rois } = await roiService.importLegacyConfig(stationId, legacyV2, { actor });
    assert.equal(rois.length, 1);
    assert.equal(rois[0].zones.length, 2);
  });

  test('ส่งออก config เป็นเวอร์ชัน 3.0 ที่นำกลับเข้าได้', async () => {
    await roiService.replaceForStation(stationId, SAMPLE_ROIS, { actor });
    const config = await roiService.exportConfig(stationId);

    assert.equal(config.version, '3.0');
    assert.equal(config.rois.length, 1);
    assert.equal(config.rois[0].zones[0].y_position, 204);

    // นำกลับเข้าได้โดยไม่เสียข้อมูล
    const { rois } = await roiService.importLegacyConfig(stationId, config, { actor });
    assert.equal(rois[0].zones.length, 6);
  });
});

describe('CalibrationService — จุดเทียบค่า', () => {
  let stationId;

  beforeEach(async () => {
    const station = await stationService.create(
      { name: 'จุดวัด', slug: 'calib-test', cameraType: 'm3u8' }, { actor },
    );
    stationId = station.id;
  });

  test('บันทึกจุดเทียบค่าและเรียงตามพิกเซลให้เอง', async () => {
    const shuffled = [...SAMPLE_CALIBRATION].reverse();
    const points = await calibrationService.replaceForStation(stationId, shuffled, { actor });
    assert.deepEqual(points.map((p) => p.pixelValue), [204, 247, 286, 309, 327, 368]);
  });

  test('จุดน้อยกว่า 2 จุดต้องถูกปฏิเสธ — ห้ามมีค่าสำรอง', async () => {
    await assert.rejects(
      () => calibrationService.replaceForStation(stationId, [{ pixel: 200, meter: 4 }], { actor }),
      ValidationError,
    );
  });

  test('พิกเซลซ้ำต้องถูกปฏิเสธ', async () => {
    await assert.rejects(
      () => calibrationService.replaceForStation(stationId, [
        { pixel: 200, meter: 4.0 }, { pixel: 200, meter: 3.5 },
      ], { actor }),
      ValidationError,
    );
  });

  test('ตัวคำนวณที่ได้แปลงค่าได้ถูกต้อง (298 px → 3.55 ม.)', async () => {
    await calibrationService.replaceForStation(stationId, SAMPLE_CALIBRATION, { actor });
    const result = await calibrationService.testConversion(stationId, 298);
    assert.equal(result.meter, 3.55);
  });

  test('จุดวัดที่ยังไม่ตั้งค่า tryCalculatorFor ต้องคืน null', async () => {
    assert.equal(await calibrationService.tryCalculatorFor(stationId), null);
  });

  test('แคชถูกล้างเมื่อบันทึกจุดเทียบค่าใหม่', async () => {
    await calibrationService.replaceForStation(stationId, SAMPLE_CALIBRATION, { actor });
    assert.equal((await calibrationService.testConversion(stationId, 204)).meter, 4.00);

    // เปลี่ยนค่าใหม่ทั้งชุด — ผลลัพธ์ต้องเปลี่ยนตามทันที ไม่ใช่ค่าที่แคชไว้
    await calibrationService.replaceForStation(stationId, [
      { pixel: 204, meter: 9.00 }, { pixel: 368, meter: 8.00 },
    ], { actor });
    assert.equal((await calibrationService.testConversion(stationId, 204)).meter, 9.00);
  });
});

describe('MeasurementService — บันทึกค่าวัดครบวงจร', () => {
  let station;

  beforeEach(async () => {
    station = await stationService.create({
      name: 'จุดวัด', slug: 'measure-test', cameraType: 'm3u8',
      cameraUrl: 'https://live.example.com/index.m3u8',
    }, { actor });
    await roiService.replaceForStation(station.id, SAMPLE_ROIS, { actor });
    await calibrationService.replaceForStation(station.id, SAMPLE_CALIBRATION, { actor });
  });

  test('บันทึกค่าวัดพร้อมคำนวณเมตรและโซนตั้งแต่ตอนบันทึก', async () => {
    const saved = await measurementService.record({
      station, waterLine: new PixelLevel(298), source: 'CRON',
    });

    assert.equal(saved.waterLine.value, 298);
    assert.equal(saved.waterLevelM.value, 3.55, 'ต้องคำนวณเมตรตอนบันทึก ไม่ใช่ตอนแสดงผล');
    assert.equal(saved.zoneKey, 'DANGER', '298 px อยู่ระหว่างขอบ 286 กับ 309');
  });

  test('ประกาศเหตุการณ์ measurement.recorded ให้ระบบแจ้งเตือนรับไปทำต่อ', async () => {
    const received = [];
    eventBus.subscribe(EventBus.EVENTS.MEASUREMENT_RECORDED, (payload) => received.push(payload));

    await measurementService.record({ station, waterLine: new PixelLevel(210) });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(received.length, 1);
    assert.equal(received[0].zone.key, 'CRITICAL');
  });

  test('จุดวัดที่ยังไม่มีจุดเทียบค่ายังบันทึกค่าพิกเซลได้ แต่ไม่มีค่าเมตร', async () => {
    const bare = await stationService.create(
      { name: 'ยังไม่ตั้งค่า', slug: 'bare', cameraType: 'm3u8' }, { actor },
    );
    const saved = await measurementService.record({ station: bare, waterLine: new PixelLevel(300) });

    assert.equal(saved.waterLine.value, 300);
    assert.equal(saved.waterLevelM, null, 'ต้องไม่เดาค่าเมตรเมื่อยังเทียบค่าไม่ได้');
  });

  test('บันทึก validation_log ทั้งกรณีผ่านและไม่ผ่าน', async () => {
    await measurementService.recordValidation({
      stationId: station.id, suspectedLevel: 500, confirmedLevel: null,
      variation: 200, attempts: 3, spread: 80, success: false, note: 'กระจายเกินเกณฑ์',
    });
    await measurementService.recordValidation({
      stationId: station.id, suspectedLevel: 400, confirmedLevel: 402,
      variation: 60, attempts: 3, spread: 10, success: true, note: 'ยืนยันสำเร็จ',
    });

    const logs = await new ValidationLogRepository(testDb.db).findByStation(station.id);
    assert.equal(logs.length, 2, 'ต้องบันทึกทุกครั้งไม่ว่าผลจะเป็นอย่างไร');
    assert.equal(logs.filter((l) => !l.success).length, 1);
    assert.equal(logs.find((l) => !l.success).confirmedLevel, null);
  });

  test('recentLevels คืนค่าล่าสุดเป็น PixelLevel สำหรับตรวจความผันผวน', async () => {
    for (const pixel of [300, 305, 310]) {
      await measurementService.record({ station, waterLine: new PixelLevel(pixel) });
    }
    const levels = await measurementService.recentLevels(station.id, 3);
    assert.equal(levels.length, 3);
    assert.ok(levels[0] instanceof PixelLevel);
  });

  test('สรุปค่าสูงสุด/ต่ำสุดถูกทิศทางแกน (พิกเซลน้อย = น้ำสูง)', async () => {
    const today = new Date().toLocaleDateString('sv-SE');
    for (const pixel of [204, 300, 368]) {
      await measurementService.record({ station, waterLine: new PixelLevel(pixel) });
    }

    const summary = await measurementService.summarize(station.id, {
      from: `${today} 00:00:00`, to: `${today} 23:59:59`,
    });

    assert.equal(summary.count, 3);
    assert.equal(summary.highestPixel, 204, 'ระดับสูงสุด = พิกเซลน้อยสุด');
    assert.equal(summary.lowestPixel, 368, 'ระดับต่ำสุด = พิกเซลมากสุด');
    assert.equal(summary.highestMeter, 4.00);
    assert.equal(summary.lowestMeter, 3.20);
  });

  test('ส่งออก CSV มี BOM และหัวตารางภาษาไทย', async () => {
    await measurementService.record({ station, waterLine: new PixelLevel(298) });
    const csv = await measurementService.exportCsv(actor, {});

    assert.ok(csv.startsWith('﻿'), 'ต้องมี BOM เพื่อให้ Excel อ่านภาษาไทยได้');
    assert.ok(csv.includes('ระดับน้ำ (เมตร)'));
    assert.ok(csv.includes('3.55'));
    assert.ok(csv.includes('อันตราย'), 'ต้องแปลงคีย์โซนเป็นชื่อไทย');
  });
});
