import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { TestDatabase } from '../helpers/TestDatabase.js';
import { MemoryCache } from '../../src/core/MemoryCache.js';
import { EventBus } from '../../src/core/EventBus.js';
import { Logger } from '../../src/core/Logger.js';
import { UserRepository } from '../../src/repositories/UserRepository.js';
import { RoleRepository } from '../../src/repositories/RoleRepository.js';
import { SessionRepository } from '../../src/repositories/SessionRepository.js';
import { PasswordResetRepository } from '../../src/repositories/PasswordResetRepository.js';
import { AuditLogRepository } from '../../src/repositories/AuditLogRepository.js';
import { PermissionRepository } from '../../src/repositories/PermissionRepository.js';
import { AuthService } from '../../src/services/AuthService.js';
import { AuditService } from '../../src/services/AuditService.js';
import { PermissionService } from '../../src/services/PermissionService.js';
import { ScryptHasher } from '../../src/services/security/ScryptHasher.js';
import { BcryptHasher } from '../../src/services/security/BcryptHasher.js';
import { PasswordPolicy } from '../../src/services/security/PasswordPolicy.js';
import { User } from '../../src/models/User.js';
import { Role } from '../../src/models/Role.js';
import {
  UnauthorizedError, ForbiddenError, ValidationError,
} from '../../src/core/errors/index.js';

let testDb;
let authService;
let userRepository;
let sessionRepository;

/**
 * สร้างผู้ใช้ทดสอบ
 * @param {{username: string, password?: string, bcryptHash?: string, roleKey?: string}} options ตัวเลือก
 * @returns {Promise<number>} รหัสผู้ใช้
 */
async function createUser({ username, password = 'TestPass123', bcryptHash = null, roleKey = 'VIEWER' }) {
  const hasher = new ScryptHasher();
  const role = await new RoleRepository(testDb.db).findByKey(roleKey);
  const user = new User({
    username,
    email: `${username}@example.com`,
    passwordHash: bcryptHash ?? await hasher.hash(password),
    hashAlgo: bcryptHash ? 'bcrypt' : 'scrypt',
    fullName: `ผู้ใช้ ${username}`,
    status: 'ACTIVE',
  });
  return userRepository.createWithAccess(user, [role.id], []);
}

before(async () => {
  Logger.configure({ level: 'error', logDir: null, console: false });
  testDb = await TestDatabase.create();

  userRepository = new UserRepository(testDb.db);
  sessionRepository = new SessionRepository(testDb.db);

  const auditService = new AuditService({
    auditRepository: new AuditLogRepository(testDb.db), logger: Logger.getInstance(),
  });

  authService = new AuthService({
    userRepository,
    sessionRepository,
    resetRepository: new PasswordResetRepository(testDb.db),
    primaryHasher: new ScryptHasher(),
    hashers: [new ScryptHasher(), new BcryptHasher()],
    policy: new PasswordPolicy(10),
    auditService,
    loginPolicy: { maxAttempts: 5, lockMinutes: 15 },
    logger: Logger.getInstance(),
  });
});

after(async () => { await testDb?.destroy(); });

beforeEach(async () => {
  await testDb.truncate(['sessions', 'password_history', 'password_reset_tokens',
    'audit_logs', 'user_roles', 'user_stations', 'users']);
});

describe('AuthFlow — เข้าสู่ระบบ', () => {
  test('เข้าสู่ระบบสำเร็จด้วยชื่อผู้ใช้', async () => {
    await createUser({ username: 'somchai' });
    const user = await authService.login('somchai', 'TestPass123', { ip: '10.0.0.1' });
    assert.equal(user.username, 'somchai');
    assert.equal(user.isActive, true);
  });

  test('เข้าสู่ระบบสำเร็จด้วยอีเมลก็ได้', async () => {
    await createUser({ username: 'somsri' });
    const user = await authService.login('somsri@example.com', 'TestPass123', {});
    assert.equal(user.username, 'somsri');
  });

  test('รหัสผ่านผิดต้องโยน UnauthorizedError พร้อมข้อความกลาง ๆ', async () => {
    await createUser({ username: 'somchai' });
    await assert.rejects(
      () => authService.login('somchai', 'ผิด', {}),
      (error) => {
        assert.ok(error instanceof UnauthorizedError);
        assert.equal(error.message, AuthService.GENERIC_LOGIN_ERROR);
        return true;
      },
    );
  });

  test('บัญชีที่ไม่มีอยู่ต้องได้ข้อความเดียวกับรหัสผ่านผิด — ห้ามเปิดเผยว่ามีบัญชีหรือไม่',
    async () => {
      await createUser({ username: 'somchai' });
      const errors = [];
      for (const [login, password] of [['somchai', 'ผิด'], ['ไม่มีคนนี้', 'อะไรก็ได้']]) {
        await authService.login(login, password, {}).catch((error) => errors.push(error.message));
      }
      assert.equal(errors[0], errors[1], 'ข้อความต้องเหมือนกันเป๊ะ');
    });

  test('บัญชีที่ถูกระงับต้องโยน ForbiddenError', async () => {
    const userId = await createUser({ username: 'suspended' });
    await userRepository.update(userId, { status: 'SUSPENDED' });
    await assert.rejects(
      () => authService.login('suspended', 'TestPass123', {}),
      ForbiddenError,
    );
  });

  test('บันทึกการเข้าสู่ระบบสำเร็จลง audit log', async () => {
    await createUser({ username: 'somchai' });
    await authService.login('somchai', 'TestPass123', { ip: '10.0.0.1' });

    const { items } = await new AuditLogRepository(testDb.db).search({ action: 'auth.login' });
    assert.equal(items.length, 1);
    assert.equal(items[0].actorLabel, 'somchai');
    assert.equal(items[0].ip, '10.0.0.1');
  });
});

describe('AuthFlow — ล็อกบัญชีเมื่อกรอกผิดซ้ำ', () => {
  test('ผิดครบ 5 ครั้งต้องถูกล็อก 15 นาที', async () => {
    await createUser({ username: 'target' });

    for (let i = 0; i < 4; i += 1) {
      await authService.login('target', 'ผิด', {}).catch(() => {});
      const user = await userRepository.findByLogin('target');
      assert.equal(user.isLocked, false, `ครั้งที่ ${i + 1} ยังไม่ควรถูกล็อก`);
    }

    await authService.login('target', 'ผิด', {}).catch(() => {});
    const locked = await userRepository.findByLogin('target');
    assert.equal(locked.isLocked, true, 'ครั้งที่ 5 ต้องถูกล็อก');
    assert.equal(locked.failedLoginCount, 5);

    const minutes = (locked.lockedUntil.getTime() - Date.now()) / 60000;
    assert.ok(minutes > 14 && minutes <= 15, `ต้องล็อกราว 15 นาที (ได้ ${minutes.toFixed(1)})`);
  });

  test('รหัสผ่านถูกต้องขณะถูกล็อกก็ยังเข้าไม่ได้', async () => {
    await createUser({ username: 'target' });
    for (let i = 0; i < 5; i += 1) {
      await authService.login('target', 'ผิด', {}).catch(() => {});
    }
    await assert.rejects(
      () => authService.login('target', 'TestPass123', {}),
      (error) => {
        assert.ok(error instanceof ForbiddenError);
        assert.match(error.message, /ถูกล็อก/);
        return true;
      },
    );
  });

  test('เข้าสู่ระบบสำเร็จต้องล้างตัวนับและปลดล็อก', async () => {
    await createUser({ username: 'target' });
    for (let i = 0; i < 3; i += 1) {
      await authService.login('target', 'ผิด', {}).catch(() => {});
    }
    await authService.login('target', 'TestPass123', {});

    const user = await userRepository.findByLogin('target');
    assert.equal(user.failedLoginCount, 0);
    assert.equal(user.lockedUntil, null);
  });

  test('บันทึกการล็อกบัญชีลง audit log ด้วย action เฉพาะ', async () => {
    await createUser({ username: 'target' });
    for (let i = 0; i < 5; i += 1) {
      await authService.login('target', 'ผิด', {}).catch(() => {});
    }
    const { items } = await new AuditLogRepository(testDb.db)
      .search({ action: 'auth.account_locked' });
    assert.equal(items.length, 1);
    assert.equal(items[0].afterData.attempts, 5);
  });
});

describe('AuthFlow — อัปเกรดรหัสผ่าน bcrypt จากระบบ PHP เป็น scrypt', () => {
  test('เข้าสู่ระบบด้วยแฮช $2y$ ของ PHP ได้ และถูกแปลงเป็น scrypt ทันที', async () => {
    // จำลองแฮชที่ PHP password_hash() สร้างไว้ (คำนำหน้า $2y$)
    const phpHash = (await bcrypt.hash('LegacyPass123', 10)).replace(/^\$2a\$/, '$2y$');
    await createUser({ username: 'legacy', bcryptHash: phpHash });

    const before = await userRepository.findByLogin('legacy');
    assert.equal(before.hashAlgo, 'bcrypt');

    const user = await authService.login('legacy', 'LegacyPass123', {});
    assert.equal(user.username, 'legacy');

    const after = await userRepository.findByLogin('legacy');
    assert.equal(after.hashAlgo, 'scrypt', 'ต้องถูกอัปเกรดเป็น scrypt');
    assert.match(after.passwordHash, /^scrypt\$/);
  });

  test('หลังอัปเกรดแล้วยังเข้าสู่ระบบด้วยรหัสผ่านเดิมได้', async () => {
    const phpHash = (await bcrypt.hash('LegacyPass123', 10)).replace(/^\$2a\$/, '$2y$');
    await createUser({ username: 'legacy', bcryptHash: phpHash });

    await authService.login('legacy', 'LegacyPass123', {});
    const user = await authService.login('legacy', 'LegacyPass123', {});
    assert.equal(user.hashAlgo, 'scrypt');
  });

  test('audit log บันทึกว่ามีการอัปเกรดแฮช', async () => {
    const phpHash = (await bcrypt.hash('LegacyPass123', 10)).replace(/^\$2a\$/, '$2y$');
    await createUser({ username: 'legacy', bcryptHash: phpHash });
    await authService.login('legacy', 'LegacyPass123', {});

    const { items } = await new AuditLogRepository(testDb.db).search({ action: 'auth.login' });
    assert.equal(items[0].afterData.hashUpgraded, true);
  });
});

describe('AuthFlow — เปลี่ยนรหัสผ่าน', () => {
  test('เปลี่ยนรหัสผ่านสำเร็จแล้ว session อื่นถูกล้างทั้งหมด', async () => {
    const userId = await createUser({ username: 'somchai' });

    // จำลอง session ที่เปิดอยู่ 3 อุปกรณ์
    for (const sid of ['sid-a', 'sid-b', 'sid-c']) {
      await sessionRepository.write(sid, {
        data: '{}', userId, ip: '10.0.0.1', userAgent: 'test',
        expiresAt: new Date(Date.now() + 3600000),
      });
    }
    assert.equal((await sessionRepository.activeForUser(userId)).length, 3);

    const result = await authService.changePassword(
      userId, 'TestPass123', 'BrandNewPass456', { keepSessionId: 'sid-a' },
    );

    assert.equal(result.sessionsRevoked, 2, 'ต้องล้าง 2 อุปกรณ์ เก็บอุปกรณ์ปัจจุบันไว้');
    assert.equal((await sessionRepository.activeForUser(userId)).length, 1);
  });

  test('รหัสผ่านเดิมผิดต้องโยน UnauthorizedError', async () => {
    const userId = await createUser({ username: 'somchai' });
    await assert.rejects(
      () => authService.changePassword(userId, 'ผิด', 'BrandNewPass456', {}),
      UnauthorizedError,
    );
  });

  test('รหัสผ่านใหม่ที่ไม่ผ่านนโยบายต้องโยน ValidationError', async () => {
    const userId = await createUser({ username: 'somchai' });
    await assert.rejects(
      () => authService.changePassword(userId, 'TestPass123', 'สั้น', {}),
      ValidationError,
    );
  });

  test('ห้ามใช้รหัสผ่านซ้ำกับ 3 ครั้งล่าสุด', async () => {
    const userId = await createUser({ username: 'somchai' });

    await authService.changePassword(userId, 'TestPass123', 'SecondPass123', {});
    await authService.changePassword(userId, 'SecondPass123', 'ThirdPass123', {});

    // ย้อนกลับไปใช้รหัสแรกที่ยังอยู่ในประวัติ
    await assert.rejects(
      () => authService.changePassword(userId, 'ThirdPass123', 'TestPass123', {}),
      (error) => {
        assert.ok(error instanceof ValidationError);
        assert.match(error.message, /ซ้ำ/);
        return true;
      },
    );
  });

  test('เข้าสู่ระบบด้วยรหัสผ่านใหม่ได้ และรหัสเดิมใช้ไม่ได้แล้ว', async () => {
    const userId = await createUser({ username: 'somchai' });
    await authService.changePassword(userId, 'TestPass123', 'BrandNewPass456', {});

    const user = await authService.login('somchai', 'BrandNewPass456', {});
    assert.equal(user.username, 'somchai');
    await assert.rejects(() => authService.login('somchai', 'TestPass123', {}), UnauthorizedError);
  });
});

describe('AuthFlow — ลืมรหัสผ่าน', () => {
  test('ขอลิงก์สำหรับอีเมลที่มีอยู่จริงได้ token', async () => {
    await createUser({ username: 'somchai' });
    const result = await authService.requestPasswordReset('somchai@example.com', {});
    assert.ok(result?.token);
    assert.equal(result.user.username, 'somchai');
  });

  test('อีเมลที่ไม่มีในระบบคืน null — ผู้เรียกต้องตอบสำเร็จเสมอ', async () => {
    assert.equal(await authService.requestPasswordReset('ไม่มี@example.com', {}), null);
  });

  test('ตั้งรหัสผ่านใหม่ด้วย token สำเร็จและล้าง session ทั้งหมด', async () => {
    const userId = await createUser({ username: 'somchai' });
    await sessionRepository.write('sid-x', {
      data: '{}', userId, ip: null, userAgent: null,
      expiresAt: new Date(Date.now() + 3600000),
    });

    const { token } = await authService.requestPasswordReset('somchai@example.com', {});
    await authService.resetPasswordWithToken(token, 'ResetPass789', {});

    assert.equal((await sessionRepository.activeForUser(userId)).length, 0);
    const user = await authService.login('somchai', 'ResetPass789', {});
    assert.equal(user.username, 'somchai');
  });

  test('token ใช้ได้ครั้งเดียว', async () => {
    await createUser({ username: 'somchai' });
    const { token } = await authService.requestPasswordReset('somchai@example.com', {});

    await authService.resetPasswordWithToken(token, 'ResetPass789', {});
    await assert.rejects(
      () => authService.resetPasswordWithToken(token, 'AnotherPass999', {}),
      ValidationError,
    );
  });

  test('token ปลอมต้องถูกปฏิเสธ', async () => {
    await createUser({ username: 'somchai' });
    await assert.rejects(
      () => authService.resetPasswordWithToken('token-ปลอม', 'ResetPass789', {}),
      ValidationError,
    );
  });

  test('ขอ token ใหม่ต้องยกเลิก token เก่าที่ยังไม่ได้ใช้', async () => {
    await createUser({ username: 'somchai' });
    const first = await authService.requestPasswordReset('somchai@example.com', {});
    const second = await authService.requestPasswordReset('somchai@example.com', {});

    await assert.rejects(
      () => authService.resetPasswordWithToken(first.token, 'ResetPass789', {}),
      ValidationError,
    );
    await assert.doesNotReject(
      () => authService.resetPasswordWithToken(second.token, 'ResetPass789', {}),
    );
  });

  test('ระบบเก็บเฉพาะ sha256 ของ token ไม่เก็บ token ดิบ', async () => {
    await createUser({ username: 'somchai' });
    const { token } = await authService.requestPasswordReset('somchai@example.com', {});

    const rows = await testDb.db.query('SELECT token_hash FROM password_reset_tokens');
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].token_hash, token, 'ต้องไม่เก็บ token ดิบลงฐานข้อมูล');
    assert.match(rows[0].token_hash, /^[0-9a-f]{64}$/);
  });
});

describe('AuthFlow — ออกจากระบบทุกอุปกรณ์', () => {
  test('ล้าง session ทั้งหมดของผู้ใช้', async () => {
    const userId = await createUser({ username: 'somchai' });
    for (const sid of ['s1', 's2', 's3']) {
      await sessionRepository.write(sid, {
        data: '{}', userId, ip: null, userAgent: null,
        expiresAt: new Date(Date.now() + 3600000),
      });
    }
    const revoked = await authService.logoutEverywhere(userId);
    assert.equal(revoked, 3);
    assert.equal((await authService.activeSessions(userId)).length, 0);
  });
});

describe('AuthFlow — User.toJSON ต้องไม่รั่วรหัสผ่าน', () => {
  test('ผลลัพธ์ไม่มี passwordHash และ hashAlgo', async () => {
    await createUser({ username: 'somchai' });
    const user = await authService.login('somchai', 'TestPass123', {});
    const json = JSON.stringify(user.toJSON());

    assert.ok(!('passwordHash' in user.toJSON()), 'ต้องไม่มีฟิลด์ passwordHash');
    assert.ok(!('hashAlgo' in user.toJSON()), 'ต้องไม่มีฟิลด์ hashAlgo');
    assert.ok(!json.includes('scrypt$'), 'ต้องไม่มีค่าแฮชปนอยู่ในผลลัพธ์');
  });
});
