import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseFactory } from '../../src/core/Database.js';
import { MigrationRepository } from '../../src/repositories/MigrationRepository.js';
import { SchemaGuard } from '../../src/core/SchemaGuard.js';

describe('SchemaGuard — ด่านกันสคีมาล้าสมัย', () => {
  let folder;
  let db;
  let migrationsDir;

  before(async () => {
    folder = await mkdtemp(join(tmpdir(), 'schema-guard-'));
    migrationsDir = join(folder, 'migrations');
    // `migrationFolder` ของ SQLite คือ 'sqlite'
    await mkdir(join(migrationsDir, 'sqlite'), { recursive: true });
    for (const name of ['001_a.sql', '002_b.sql', '003_c.sql']) {
      await writeFile(join(migrationsDir, 'sqlite', name), 'SELECT 1;');
    }
    db = DatabaseFactory.build({ driver: 'sqlite', file: join(folder, 'test.db') });
  });

  after(async () => {
    await db?.close();
    await rm(folder, { recursive: true, force: true });
  });

  test('ยังไม่มีตาราง schema_migrations ต้องเงียบ — เป็นหน้าที่ของโหมดตั้งค่า', async () => {
    assert.deepEqual(await new SchemaGuard(db, migrationsDir).pending(), []);
  });

  test('รันไปบางไฟล์ ต้องรายงานเฉพาะไฟล์ที่ค้าง เรียงตามชื่อ', async () => {
    const repository = new MigrationRepository(db);
    await repository.ensureTable();
    await repository.record('001_a.sql', 'x');

    assert.deepEqual(
      await new SchemaGuard(db, migrationsDir).pending(),
      ['002_b.sql', '003_c.sql'],
    );
  });

  test('รันครบแล้วต้องไม่มีอะไรค้าง', async () => {
    const repository = new MigrationRepository(db);
    await repository.record('002_b.sql', 'x');
    await repository.record('003_c.sql', 'x');

    assert.deepEqual(await new SchemaGuard(db, migrationsDir).pending(), []);
  });

  test('ข้อความที่แสดงต้องบอกทั้งชื่อไฟล์และคำสั่งที่ต้องรัน', () => {
    const message = SchemaGuard.describe(['005_zone_calibration.sql']);
    assert.match(message, /005_zone_calibration\.sql/);
    assert.match(message, /npm run db:migrate/);
  });

  test('migration จริงของโปรเจกต์ต้องถูกรันครบในฐานข้อมูลทดสอบ', async () => {
    // กันไม่ให้ลืมเพิ่มไฟล์ migration ใหม่เข้าไปในชุดที่ TestDatabase รัน
    const { TestDatabase } = await import('../helpers/TestDatabase.js');
    const testDb = await TestDatabase.create({ seed: false });
    try {
      const pending = await new SchemaGuard(
        testDb.db, join(process.cwd(), 'database/migrations'),
      ).pending();
      assert.deepEqual(pending, [], `migration ที่ยังไม่ถูกรัน: ${pending.join(', ')}`);
    } finally {
      await testDb.destroy();
    }
  });
});
