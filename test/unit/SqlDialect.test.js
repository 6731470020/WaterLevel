import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  SqlDialect, MySqlDialect, SqliteDialect, DatabaseFactory, Database,
} from '../../src/core/Database.js';
import { NotImplementedError, ValidationError } from '../../src/core/errors/index.js';

describe('SqlDialect — คลาสนามธรรม', () => {
  test('สร้างวัตถุโดยตรงไม่ได้', () => {
    assert.throws(() => new SqlDialect(), NotImplementedError);
  });

  test('คลาสลูกที่ไม่ override ต้องโยน NotImplementedError', () => {
    class Incomplete extends SqlDialect {}
    const dialect = new Incomplete();
    assert.throws(() => dialect.name, NotImplementedError);
    assert.throws(() => dialect.now(), NotImplementedError);
    assert.throws(() => dialect.ago('DAY'), NotImplementedError);
    assert.throws(() => dialect.upsert({}), NotImplementedError);
  });
});

describe('พหุสัณฐาน — dialect ทั้งสองค่ายตอบสัญญาเดียวกันแต่ได้ SQL ต่างกัน', () => {
  const dialects = [new MySqlDialect(), new SqliteDialect()];

  test('ทุกตัวเป็น SqlDialect และมีชื่อของตัวเอง', () => {
    assert.deepEqual(dialects.map((d) => d.name), ['mysql', 'sqlite']);
    for (const dialect of dialects) assert.ok(dialect instanceof SqlDialect);
  });

  test('now() ให้นิพจน์คนละแบบ', () => {
    assert.equal(new MySqlDialect().now(), 'NOW()');
    assert.match(new SqliteDialect().now(), /datetime\('now','localtime'\)/);
  });

  test('ago() ให้นิพจน์คนละแบบแต่รับพารามิเตอร์ตำแหน่งเดียวกัน', () => {
    assert.match(new MySqlDialect().ago('DAY'), /DATE_SUB\(NOW\(\), INTERVAL \? DAY\)/);
    assert.match(new SqliteDialect().ago('DAY'), /-' \|\| \? \|\| ' days/);
    assert.match(new SqliteDialect().ago('MINUTE'), /minutes/);
  });

  test('formatDate() ใช้ฟังก์ชันคนละตัวแต่รูปแบบสตริงเดียวกัน', () => {
    assert.equal(new MySqlDialect().formatDate('measured_at'), 'DATE_FORMAT(measured_at, ?)');
    assert.equal(new SqliteDialect().formatDate('measured_at'), 'strftime(?, measured_at)');
  });

  test('quote() ใช้ backtick เหมือนกันทั้งสองค่าย', () => {
    for (const dialect of dialects) assert.equal(dialect.quote('user_id'), '`user_id`');
  });

  test('migrationFolder แยกตามค่าย', () => {
    assert.equal(new MySqlDialect().migrationFolder, 'mysql');
    assert.equal(new SqliteDialect().migrationFolder, 'sqlite');
  });
});

describe('SqlDialect.upsert — คำสั่งเพิ่ม-หรือ-อัปเดต', () => {
  const spec = {
    table: 'station_alert_states',
    columns: ['station_id', 'last_zone_key'],
    conflictColumns: ['station_id'],
    updateColumns: ['last_zone_key'],
  };

  test('MySQL ใช้ ON DUPLICATE KEY UPDATE พร้อมกลเม็ด LAST_INSERT_ID', () => {
    const { sql } = new MySqlDialect().upsert(spec);
    assert.match(sql, /ON DUPLICATE KEY UPDATE/);
    assert.match(sql, /`last_zone_key` = VALUES\(`last_zone_key`\)/);
    assert.match(sql, /`id` = LAST_INSERT_ID\(`id`\)/);
  });

  test('SQLite ใช้ ON CONFLICT DO UPDATE พร้อม RETURNING', () => {
    const { sql } = new SqliteDialect().upsert(spec);
    assert.match(sql, /ON CONFLICT \(`station_id`\) DO UPDATE SET/);
    assert.match(sql, /`last_zone_key` = excluded\.`last_zone_key`/);
    assert.match(sql, /RETURNING `id` AS id/);
  });

  test('ตารางที่ไม่มีคอลัมน์ id ต้องละส่วนคืนรหัสทั้งสองค่าย', () => {
    const sessionSpec = {
      table: 'sessions', columns: ['sid', 'data'],
      conflictColumns: ['sid'], updateColumns: ['data'], returning: null,
    };
    const mysql = new MySqlDialect().upsert(sessionSpec).sql;
    const sqlite = new SqliteDialect().upsert(sessionSpec).sql;

    assert.ok(!mysql.includes('LAST_INSERT_ID'), 'MySQL ต้องไม่อ้างคอลัมน์ id ที่ไม่มีอยู่');
    assert.ok(!sqlite.includes('RETURNING'), 'SQLite ต้องไม่อ้างคอลัมน์ id ที่ไม่มีอยู่');
  });

  test('จำนวนตัวยึด ? ต้องเท่ากับจำนวนคอลัมน์ทั้งสองค่าย', () => {
    for (const dialect of [new MySqlDialect(), new SqliteDialect()]) {
      const { sql } = dialect.upsert(spec);
      const placeholders = (sql.match(/VALUES \(([^)]*)\)/)[1].match(/\?/g) ?? []).length;
      assert.equal(placeholders, spec.columns.length, dialect.name);
    }
  });
});

describe('DatabaseFactory', () => {
  test('รองรับสองไดรเวอร์', () => {
    assert.deepEqual(DatabaseFactory.drivers, ['mysql', 'sqlite']);
  });

  test('ไดรเวอร์ที่ไม่รู้จักต้องโยน ValidationError', () => {
    assert.throws(() => DatabaseFactory.build({ driver: 'postgres' }), ValidationError);
  });

  test('สร้าง SqliteDatabase ได้และเป็น Database', async () => {
    const db = DatabaseFactory.build({ driver: 'sqlite', file: ':memory:' });
    assert.ok(db instanceof Database);
    assert.equal(db.driver, 'sqlite');
    assert.equal(await db.ping(), true);
    await db.close();
  });

  test('catalog อธิบายตัวเลือกทั้งสองพร้อมข้อดีข้อเสีย', () => {
    const catalog = DatabaseFactory.catalog('/tmp/project');
    assert.equal(catalog.length, 2);
    for (const option of catalog) {
      assert.ok(option.name && option.summary);
      assert.ok(option.pros.length > 0 && option.cons.length > 0);
    }
  });
});

describe('Database — คลาสนามธรรม', () => {
  test('สร้างวัตถุโดยตรงไม่ได้', () => {
    assert.throws(() => new Database(new SqliteDialect()), NotImplementedError);
  });

  test('คลาสลูกที่ไม่ override ต้องโยน NotImplementedError', async () => {
    class Incomplete extends Database {}
    const db = new Incomplete(new SqliteDialect());
    assert.throws(() => db.name, NotImplementedError);
    await assert.rejects(() => db.query('SELECT 1'), NotImplementedError);
    await assert.rejects(() => db.execute('SELECT 1'), NotImplementedError);
    await assert.rejects(() => db.transaction(async () => {}), NotImplementedError);
  });
});

describe('ธุรกรรมซ้อน — SQLite', () => {
  let folder;
  let db;

  before(async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { DatabaseFactory } = await import('../../src/core/Database.js');
    folder = await mkdtemp(join(tmpdir(), 'nested-tx-'));
    db = DatabaseFactory.build({ driver: 'sqlite', file: join(folder, 'tx.db') });
    await db.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  });

  after(async () => {
    const { rm } = await import('node:fs/promises');
    await db?.close();
    await rm(folder, { recursive: true, force: true });
  });

  test('ธุรกรรมชั้นในที่ล้ม ต้องย้อนเฉพาะงานของตัวเอง ชั้นนอกยังคอมมิตได้', async () => {
    await db.execute('DELETE FROM t');
    await db.transaction(async (tx) => {
      await tx.execute("INSERT INTO t (v) VALUES ('นอก')");
      try {
        await db.transaction(async (inner) => {
          await inner.execute("INSERT INTO t (v) VALUES ('ใน')");
          throw new Error('ล้มโดยตั้งใจ');
        });
      } catch { /* จับไว้เพื่อให้ชั้นนอกเดินต่อ */ }
    });

    const rows = await db.query('SELECT v FROM t ORDER BY id');
    assert.deepEqual(rows.map((row) => row.v), ['นอก']);
  });

  test('ชั้นนอกล้ม ต้องย้อนทั้งหมดแม้ชั้นในจะสำเร็จไปแล้ว', async () => {
    await db.execute('DELETE FROM t');
    await assert.rejects(() => db.transaction(async (tx) => {
      await tx.execute("INSERT INTO t (v) VALUES ('นอก')");
      await db.transaction(async (inner) => {
        await inner.execute("INSERT INTO t (v) VALUES ('ใน')");
      });
      throw new Error('ชั้นนอกล้ม');
    }));

    assert.equal((await db.query('SELECT v FROM t')).length, 0);
  });
});
