import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionService } from '../../src/services/PermissionService.js';
import { MemoryCache } from '../../src/core/MemoryCache.js';
import { EventBus } from '../../src/core/EventBus.js';
import { Logger } from '../../src/core/Logger.js';
import { User } from '../../src/models/User.js';
import { Role } from '../../src/models/Role.js';
import { ForbiddenError, NotFoundError } from '../../src/core/errors/index.js';

Logger.configure({ level: 'error', logDir: null, console: false });

/**
 * สร้างผู้ใช้จำลองพร้อมบทบาทและขอบเขตจุดวัด
 * @param {{permissions?: Array<string>, stations?: Array<number>|null, superAdmin?: boolean}} options ตัวเลือก
 * @returns {User}
 */
function makeUser({ permissions = [], stations = null, superAdmin = false } = {}) {
  const user = new User({
    id: 1, username: 'tester', email: 't@example.com',
    passwordHash: 'scrypt$aa$bb', fullName: 'ผู้ทดสอบ', isSuperAdmin: superAdmin,
  });
  user.assignRoles([new Role({
    id: 1, roleKey: 'TESTER', name: 'ผู้ทดสอบ', permissionKeys: permissions,
  })]);
  user.assignStations(stations);
  return user;
}

/** สร้างบริการสิทธิ์พร้อมของจำลองที่ไม่แตะฐานข้อมูล */
function makeService(overrides = {}) {
  return new PermissionService({
    permissionRepository: { keysForUser: async () => [] },
    sessionRepository: { destroyForUser: async () => 0, destroyForUsers: async () => 0 },
    userRepository: { userIdsByRole: async () => [] },
    cache: new MemoryCache(),
    eventBus: new EventBus(),
    logger: Logger.getInstance(),
    ...overrides,
  });
}

describe('PermissionService — การตรวจสิทธิ์', () => {
  const service = makeService();

  test('ผู้ใช้ที่มีสิทธิ์ผ่าน / ไม่มีสิทธิ์ไม่ผ่าน', () => {
    const user = makeUser({ permissions: ['station.read'] });
    assert.equal(service.can(user, 'station.read'), true);
    assert.equal(service.can(user, 'station.delete'), false);
  });

  test('ผู้ดูแลสูงสุดผ่านทุกสิทธิ์แม้ไม่ได้ผูกไว้', () => {
    const superAdmin = makeUser({ permissions: [], superAdmin: true });
    assert.equal(service.can(superAdmin, 'role.manage'), true);
    assert.equal(service.can(superAdmin, 'สิทธิ์ที่ไม่มีจริง'), true);
  });

  test('ผู้ใช้ null ไม่ผ่านเสมอ', () => {
    assert.equal(service.can(null, 'station.read'), false);
  });

  test('assertCan โยน ForbiddenError เมื่อไม่มีสิทธิ์', () => {
    const user = makeUser({ permissions: ['station.read'] });
    assert.doesNotThrow(() => service.assertCan(user, 'station.read'));
    assert.throws(() => service.assertCan(user, 'station.delete'), ForbiddenError);
  });
});

describe('PermissionService.applyStationScope — ชั้นป้องกันที่ 2', () => {
  const service = makeService();

  test('ผู้ใช้ที่ไม่ได้จำกัดขอบเขต → stationIds เป็น null (เข้าถึงได้ทุกจุด)', () => {
    const user = makeUser({ stations: null });
    assert.equal(service.applyStationScope(user, {}).stationIds, null);
  });

  test('ผู้ดูแลสูงสุด → stationIds เป็น null เสมอแม้ผูกจุดวัดไว้', () => {
    const user = makeUser({ stations: [1], superAdmin: true });
    assert.equal(service.applyStationScope(user, {}).stationIds, null);
  });

  test('ผู้ใช้ที่จำกัดขอบเขต → stationIds เป็นรายการที่อนุญาต', () => {
    const user = makeUser({ stations: [1, 3] });
    assert.deepEqual(service.applyStationScope(user, {}).stationIds, [1, 3]);
  });

  test('ผู้ใช้ null → stationIds เป็นอาร์เรย์ว่าง (ไม่เห็นอะไรเลย)', () => {
    assert.deepEqual(service.applyStationScope(null, {}).stationIds, []);
  });

  test('ขอจุดวัดที่อยู่ในขอบเขต → คงคำขอไว้', () => {
    const user = makeUser({ stations: [1, 3] });
    const scoped = service.applyStationScope(user, { stationId: 3 });
    assert.equal(scoped.stationId, 3);
    assert.deepEqual(scoped.stationIds, [1, 3]);
  });

  test('ขอจุดวัดนอกขอบเขต → ล้างคำขอและตัดผลลัพธ์ให้เป็นศูนย์', () => {
    const user = makeUser({ stations: [1, 3] });
    const scoped = service.applyStationScope(user, { stationId: 2 });
    assert.equal(scoped.stationId, null);
    assert.deepEqual(scoped.stationIds, [], 'ต้องไม่มีทางคืนข้อมูลของจุดวัดอื่น');
  });

  test('เงื่อนไขเดิมที่ส่งมาต้องคงอยู่', () => {
    const user = makeUser({ stations: [1] });
    const scoped = service.applyStationScope(user, { from: '2026-01-01', limit: 50 });
    assert.equal(scoped.from, '2026-01-01');
    assert.equal(scoped.limit, 50);
  });
});

describe('PermissionService — ขอบเขตจุดวัดตอบ 404 ไม่ใช่ 403', () => {
  const service = makeService();

  test('จุดวัดในขอบเขตผ่าน', () => {
    const user = makeUser({ stations: [1] });
    assert.equal(service.canAccessStation(user, 1), true);
    assert.doesNotThrow(() => service.assertStationAccess(user, 1));
  });

  test('จุดวัดนอกขอบเขตต้องโยน NotFoundError ไม่ใช่ ForbiddenError', () => {
    const user = makeUser({ stations: [1] });
    assert.equal(service.canAccessStation(user, 2), false);
    assert.throws(() => service.assertStationAccess(user, 2), (error) => {
      assert.ok(error instanceof NotFoundError,
        'ต้องเป็น 404 เพื่อไม่ยืนยันว่ารหัสจุดวัดนี้มีอยู่จริง');
      assert.equal(error.statusCode, 404);
      return true;
    });
  });

  test('ผู้ใช้ที่ไม่จำกัดขอบเขตเข้าได้ทุกจุด', () => {
    const user = makeUser({ stations: null });
    assert.equal(service.canAccessStation(user, 999), true);
  });
});

describe('PermissionService — ล้าง session เมื่อสิทธิ์เปลี่ยน', () => {
  test('แก้สิทธิ์ของบทบาทต้องล้าง session ของผู้ใช้ทุกคนที่ถือบทบาทนั้น', async () => {
    let revokedFor = null;
    const service = makeService({
      userRepository: { userIdsByRole: async () => [7, 8, 9] },
      sessionRepository: {
        destroyForUsers: async (ids) => { revokedFor = ids; return ids.length; },
        destroyForUser: async () => 0,
      },
    });

    const revoked = await service.invalidateSessionsForRole(4);
    assert.deepEqual(revokedFor, [7, 8, 9]);
    assert.equal(revoked, 3);
  });

  test('ประกาศเหตุการณ์ permissions.changed ให้ส่วนอื่นรับรู้', async () => {
    const eventBus = new EventBus();
    const service = makeService({
      eventBus,
      userRepository: { userIdsByRole: async () => [7] },
      sessionRepository: { destroyForUsers: async () => 1, destroyForUser: async () => 0 },
    });

    const received = [];
    eventBus.subscribe(EventBus.EVENTS.PERMISSIONS_CHANGED, (payload) => received.push(payload));
    await service.invalidateSessionsForRole(4);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(received.length, 1);
    assert.equal(received[0].roleId, 4);
  });
});

describe('PermissionService.helperFor — ตัวช่วยสำหรับ view', () => {
  test('คืนฟังก์ชันที่ตรวจสิทธิ์ของผู้ใช้คนนั้น', () => {
    const service = makeService();
    const can = service.helperFor(makeUser({ permissions: ['station.read'] }));
    assert.equal(can('station.read'), true);
    assert.equal(can('user.delete'), false);
  });
});
