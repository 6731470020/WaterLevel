import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { TestDatabase } from '../helpers/TestDatabase.js';
import { Logger } from '../../src/core/Logger.js';
import { MemoryCache } from '../../src/core/MemoryCache.js';
import { EventBus } from '../../src/core/EventBus.js';
import { UserRepository } from '../../src/repositories/UserRepository.js';
import { RoleRepository } from '../../src/repositories/RoleRepository.js';
import { SessionRepository } from '../../src/repositories/SessionRepository.js';
import { PermissionRepository } from '../../src/repositories/PermissionRepository.js';
import { StationRepository } from '../../src/repositories/StationRepository.js';
import { AuditLogRepository } from '../../src/repositories/AuditLogRepository.js';
import { PermissionService } from '../../src/services/PermissionService.js';
import { AuditService } from '../../src/services/AuditService.js';
import { StationService } from '../../src/services/StationService.js';
import { RoleService } from '../../src/services/RoleService.js';
import { ScryptHasher } from '../../src/services/security/ScryptHasher.js';
import { User } from '../../src/models/User.js';
import { Role } from '../../src/models/Role.js';
import { Station } from '../../src/models/Station.js';
import { Permission } from '../../src/models/Permission.js';
import { ForbiddenError, NotFoundError } from '../../src/core/errors/index.js';

let testDb;
let permissionService;
let stationService;
let roleService;
let userRepository;
let sessionRepository;
let users = {};
let stations = {};

/**
 * สร้างผู้ใช้พร้อมบทบาทและขอบเขตจุดวัด แล้วคืนวัตถุที่โหลดสิทธิ์ครบแล้ว
 * @param {string} username ชื่อผู้ใช้
 * @param {string} roleKey คีย์บทบาท
 * @param {Array<number>} [stationIds=[]] รหัสจุดวัดที่จำกัดสิทธิ์
 * @param {boolean} [superAdmin=false] เป็นผู้ดูแลสูงสุดหรือไม่
 * @returns {Promise<User>}
 */
async function makeUser(username, roleKey, stationIds = [], superAdmin = false) {
  const hasher = new ScryptHasher();
  const role = await new RoleRepository(testDb.db).findByKey(roleKey);
  const user = new User({
    username,
    email: `${username}@example.com`,
    passwordHash: await hasher.hash('TestPass123'),
    hashAlgo: 'scrypt',
    fullName: `ผู้ใช้ ${username}`,
    status: 'ACTIVE',
    isSuperAdmin: superAdmin,
  });
  const id = await userRepository.createWithAccess(user, [role.id], stationIds);
  return userRepository.findWithAccess(id);
}

before(async () => {
  Logger.configure({ level: 'error', logDir: null, console: false });
  testDb = await TestDatabase.create();

  userRepository = new UserRepository(testDb.db);
  sessionRepository = new SessionRepository(testDb.db);
  const stationRepository = new StationRepository(testDb.db);

  const auditService = new AuditService({
    auditRepository: new AuditLogRepository(testDb.db), logger: Logger.getInstance(),
  });

  permissionService = new PermissionService({
    permissionRepository: new PermissionRepository(testDb.db),
    sessionRepository,
    userRepository,
    cache: new MemoryCache(),
    eventBus: new EventBus(),
    logger: Logger.getInstance(),
  });

  stationService = new StationService({
    stationRepository,
    calibrationRepository: { findByStation: async () => [], countByStation: async () => new Map() },
    roiRepository: { findByStation: async () => [] },
    permissionService,
    auditService,
    logger: Logger.getInstance(),
  });

  roleService = new RoleService({
    roleRepository: new RoleRepository(testDb.db),
    permissionService,
    auditService,
    logger: Logger.getInstance(),
  });

  // จุดวัดสองแห่งเพื่อทดสอบขอบเขต
  for (const [key, name, slug] of [['a', 'จุดวัด A', 'station-a'], ['b', 'จุดวัด B', 'station-b']]) {
    const saved = await stationRepository.create(new Station({ name, slug, cameraType: 'm3u8' }));
    stations[key] = saved;
  }

  users = {
    superAdmin: await makeUser('super', Role.SUPER_ADMIN, [], true),
    admin: await makeUser('admin1', Role.ADMIN),
    operator: await makeUser('oper1', Role.OPERATOR),
    viewer: await makeUser('viewer1', Role.VIEWER),
    scopedOperator: await makeUser('oper_a', Role.OPERATOR, [stations.a.id]),
  };
});

after(async () => { await testDb?.destroy(); });

describe('ตารางสิทธิ์ตามบทบาท — ทุกบทบาท × ทุกสิทธิ์สำคัญ (CLAUDE.md ข้อ 8.3)', () => {
  /**
   * ตารางที่คาดหวัง: [สิทธิ์, SUPER_ADMIN, ADMIN, OPERATOR, VIEWER]
   * ลอกมาจากตารางในเอกสารโดยตรง เพื่อให้ test ทำหน้าที่เป็นสัญญาที่ตรวจได้
   */
  const MATRIX = [
    ['station.read',        true,  true,  true,  true],
    ['station.create',      true,  true,  false, false],
    ['station.update',      true,  true,  false, false],
    ['station.delete',      true,  true,  false, false],
    ['roi.read',            true,  true,  true,  true],
    ['roi.write',           true,  true,  true,  false],
    ['calibration.read',    true,  true,  true,  true],
    ['calibration.write',   true,  true,  true,  false],
    ['measurement.read',    true,  true,  true,  true],
    ['measurement.export',  true,  true,  true,  false],
    ['measurement.delete',  true,  true,  false, false],
    ['capture.trigger',     true,  true,  true,  false],
    ['alert.read',          true,  true,  true,  true],
    ['alert.broadcast',     true,  true,  true,  false],
    ['alert.config',        true,  true,  false, false],
    ['report.read',         true,  true,  true,  true],
    ['report.generate',     true,  true,  true,  false],
    ['report.send',         true,  true,  true,  false],
    ['line.read',           true,  true,  true,  false],
    ['line.manage',         true,  true,  false, false],
    ['user.read',           true,  true,  false, false],
    ['user.create',         true,  true,  false, false],
    ['user.update',         true,  true,  false, false],
    ['user.delete',         true,  true,  false, false],
    ['user.reset_password', true,  true,  false, false],
    ['role.read',           true,  true,  false, false],
    ['role.manage',         true,  false, false, false],
    ['license.read',        true,  true,  false, false],
    ['license.manage',      true,  false, false, false],
    ['audit.read',          true,  true,  false, false],
    ['setting.read',        true,  true,  true,  false],
    ['setting.manage',      true,  true,  false, false],
  ];

  for (const [permission, forSuper, forAdmin, forOperator, forViewer] of MATRIX) {
    test(`${permission}`, () => {
      const expectations = [
        ['SUPER_ADMIN', users.superAdmin, forSuper],
        ['ADMIN', users.admin, forAdmin],
        ['OPERATOR', users.operator, forOperator],
        ['VIEWER', users.viewer, forViewer],
      ];
      for (const [label, user, expected] of expectations) {
        assert.equal(
          permissionService.can(user, permission), expected,
          `${label} ${expected ? 'ควรมี' : 'ไม่ควรมี'}สิทธิ์ ${permission}`,
        );
      }
    });
  }

  test('รายการสิทธิ์ในตารางครอบคลุมทุกสิทธิ์ที่ระบบนิยามไว้', () => {
    const tested = new Set(MATRIX.map(([key]) => key));
    const missing = Permission.allKeys().filter((key) => !tested.has(key));
    assert.deepEqual(missing, [], `สิทธิ์เหล่านี้ยังไม่ถูกทดสอบ: ${missing.join(', ')}`);
  });
});

describe('VIEWER ดูได้แต่แก้ไขไม่ได้ (เกณฑ์ตรวจรับข้อ 19)', () => {
  test('อ่านรายการจุดวัดได้', async () => {
    const result = await stationService.list(users.viewer, {});
    assert.equal(result.total, 2);
  });

  test('สร้างจุดวัดไม่ได้ — ชั้น Service ปฏิเสธแม้ middleware ถูกข้าม', () => {
    assert.throws(() => permissionService.assertCan(users.viewer, 'station.create'), ForbiddenError);
  });

  test('ลบจุดวัดไม่ได้', () => {
    assert.throws(() => permissionService.assertCan(users.viewer, 'station.delete'), ForbiddenError);
  });

  test('แก้ ROI ไม่ได้', () => {
    assert.throws(() => permissionService.assertCan(users.viewer, 'roi.write'), ForbiddenError);
  });

  test('เข้าถึงหน้าผู้ใช้และบันทึกการใช้งานไม่ได้', () => {
    for (const permission of ['user.read', 'audit.read', 'role.read']) {
      assert.throws(() => permissionService.assertCan(users.viewer, permission), ForbiddenError);
    }
  });
});

describe('ขอบเขตจุดวัด — ผู้ใช้ที่ผูกกับจุด A เข้าจุด B ไม่ได้ (ตอบ 404)', () => {
  test('เข้าจุดวัดของตัวเองได้', async () => {
    const station = await stationService.findForUser(users.scopedOperator, stations.a.id);
    assert.equal(station.slug, 'station-a');
  });

  test('เข้าจุดวัดอื่นต้องได้ NotFoundError ไม่ใช่ ForbiddenError', async () => {
    await assert.rejects(
      () => stationService.findForUser(users.scopedOperator, stations.b.id),
      (error) => {
        assert.ok(error instanceof NotFoundError,
          'ต้องเป็น 404 เพื่อไม่ยืนยันว่าจุดวัดนี้มีอยู่จริง');
        assert.equal(error.statusCode, 404);
        assert.ok(!(error instanceof ForbiddenError));
        return true;
      },
    );
  });

  test('รายการจุดวัดต้องมีเฉพาะจุดที่อยู่ในขอบเขต — ชั้นป้องกันที่ 2', async () => {
    const result = await stationService.list(users.scopedOperator, {});
    assert.equal(result.total, 1, 'ต้องนับเฉพาะจุดวัดที่เข้าถึงได้');
    assert.equal(result.items[0].slug, 'station-a');
  });

  test('ขอจุดวัดนอกขอบเขตผ่านตัวกรอง ต้องได้ผลลัพธ์ว่าง ไม่ใช่ข้อมูลของคนอื่น', async () => {
    const scoped = permissionService.applyStationScope(
      users.scopedOperator, { stationId: stations.b.id },
    );
    assert.deepEqual(scoped.stationIds, []);
    assert.equal(scoped.stationId, null);
  });

  test('ผู้ใช้ที่ไม่จำกัดขอบเขตเห็นทุกจุดวัด', async () => {
    const result = await stationService.list(users.operator, {});
    assert.equal(result.total, 2);
  });

  test('ผู้ดูแลสูงสุดเห็นทุกจุดวัดแม้จะผูกขอบเขตไว้', async () => {
    const result = await stationService.list(users.superAdmin, {});
    assert.equal(result.total, 2);
  });

  test('ภาพรวมจุดวัดก็ต้องถูกจำกัดขอบเขตด้วย', async () => {
    const overview = await stationService.overview(users.scopedOperator);
    assert.equal(overview.length, 1);
    assert.equal(overview[0].station.slug, 'station-a');
  });
});

describe('ผู้ดูแลสูงสุดผ่านทุกด่าน แต่ยังถูกบันทึก', () => {
  test('ผ่านทุกสิทธิ์แม้ไม่ได้ผูกไว้กับบทบาท', () => {
    for (const permission of Permission.allKeys()) {
      assert.equal(permissionService.can(users.superAdmin, permission), true, permission);
    }
  });

  test('เข้าถึงจุดวัดได้ทุกแห่ง', async () => {
    for (const station of Object.values(stations)) {
      await assert.doesNotReject(
        () => stationService.findForUser(users.superAdmin, station.id),
      );
    }
  });

  test('การกระทำของผู้ดูแลสูงสุดถูกบันทึกใน audit log', async () => {
    await stationService.create(
      { name: 'จุดวัดจากผู้ดูแลสูงสุด', slug: 'station-super', cameraType: 'm3u8' },
      { actor: users.superAdmin, ip: '10.0.0.9' },
    );

    const { items } = await new AuditLogRepository(testDb.db)
      .search({ action: 'station.create' });
    const entry = items.find((log) => log.actorLabel === 'super');
    assert.ok(entry, 'ต้องมีบันทึกการกระทำของผู้ดูแลสูงสุด');
    assert.equal(entry.ip, '10.0.0.9');
  });
});

describe('แก้สิทธิ์ของบทบาทแล้วมีผลทันที (เกณฑ์ตรวจรับข้อ 19)', () => {
  test('การแก้สิทธิ์ต้องล้าง session ของผู้ใช้ที่ถือบทบาทนั้นทันที', async () => {
    const viewerRole = await new RoleRepository(testDb.db).findByKey(Role.VIEWER);

    // จำลอง session ที่ viewer1 เปิดอยู่
    await sessionRepository.write('viewer-session', {
      data: '{}', userId: users.viewer.id, ip: null, userAgent: null,
      expiresAt: new Date(Date.now() + 3600000),
    });
    assert.equal((await sessionRepository.activeForUser(users.viewer.id)).length, 1);

    // ผู้ดูแลถอดสิทธิ์ measurement.read ออก
    const { sessionsRevoked } = await roleService.updatePermissions(
      viewerRole.id, ['station.read'], { actor: users.superAdmin },
    );

    assert.ok(sessionsRevoked >= 1, 'ต้องล้าง session ของผู้ใช้ที่ได้รับผลกระทบ');
    assert.equal(
      (await sessionRepository.activeForUser(users.viewer.id)).length, 0,
      'session ต้องถูกล้าง สิทธิ์ใหม่จึงมีผลทันทีโดยไม่ต้องรอหมดอายุ',
    );
  });

  test('โหลดผู้ใช้ใหม่ต้องได้สิทธิ์ชุดใหม่', async () => {
    const reloaded = await userRepository.findWithAccess(users.viewer.id);
    assert.equal(permissionService.can(reloaded, 'station.read'), true);
    assert.equal(
      permissionService.can(reloaded, 'measurement.read'), false,
      'สิทธิ์ที่ถอดออกต้องหายไปทันที',
    );
  });

  test('บทบาทผู้ดูแลสูงสุดแก้สิทธิ์ไม่ได้', async () => {
    const superRole = await new RoleRepository(testDb.db).findByKey(Role.SUPER_ADMIN);
    await assert.rejects(
      () => roleService.updatePermissions(superRole.id, [], { actor: users.superAdmin }),
      /แก้ไขสิทธิ์ไม่ได้/,
    );
  });
});
