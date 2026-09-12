process.env.TZ = process.env.TZ ?? 'Asia/Bangkok';

import { join } from 'node:path';
import { Config } from '../src/core/Config.js';
import { DatabaseFactory } from '../src/core/Database.js';
import { Logger } from '../src/core/Logger.js';
import { MigrationRunner } from './MigrationRunner.js';
import { SeedRunner } from './SeedRunner.js';

/**
 * สคริปต์ติดตั้งฐานข้อมูล — `npm run db:setup`
 *
 * ขั้นตอน: รัน migration ของค่ายที่เลือก → ใส่ข้อมูลตั้งต้น (สิทธิ์ บทบาท ใบอนุญาต)
 * รันซ้ำได้เสมอโดยไม่ทำข้อมูลซ้ำหรือพัง
 *
 * ตัวเลือก: `--migrate-only` รันแค่ migration, `--seed-only` รันแค่ข้อมูลตั้งต้น
 */
class DatabaseSetup {
  /** @type {Config} */
  #config;
  /** @type {import('../src/core/Database.js').Database} */
  #db;

  /**
   * @param {Config} config ค่าตั้งค่า
   * @param {import('../src/core/Database.js').Database} db ตัวเชื่อมฐานข้อมูล
   */
  constructor(config, db) {
    this.#config = config;
    this.#db = db;
  }

  /**
   * รันการติดตั้งตามตัวเลือกที่ระบุ
   * @param {{migrateOnly: boolean, seedOnly: boolean}} options ตัวเลือก
   * @returns {Promise<void>}
   */
  async run({ migrateOnly, seedOnly }) {
    process.stdout.write(
      `\n  ฐานข้อมูล: ${this.#db.driver} · ${this.#db.name}\n`,
    );

    if (!seedOnly) {
      process.stdout.write('\n▸ รัน migration\n');
      const runner = new MigrationRunner(this.#db, join(this.#config.root, 'database/migrations'));
      const { applied, skipped } = await runner.run();
      process.stdout.write(applied.length
        ? `  ✓ รัน migration ใหม่ ${applied.length} ไฟล์\n`
        : `  ✓ สคีมาเป็นปัจจุบันอยู่แล้ว (ข้าม ${skipped} ไฟล์)\n`);
    }

    if (!migrateOnly) {
      process.stdout.write('\n▸ ใส่ข้อมูลตั้งต้น\n');
      await new SeedRunner(this.#db).run();
    }
  }
}

const config = Config.bootstrap();
Logger.configure({ level: 'warn', logDir: null, console: true });
const db = DatabaseFactory.create(config.database);

try {
  if (!await db.ping()) {
    const info = config.databaseDriver === 'sqlite'
      ? `ไฟล์: ${config.database.file}`
      : `โฮสต์: ${config.database.host}:${config.database.port}` +
        ` · ฐานข้อมูล: ${config.database.database} · ผู้ใช้: ${config.database.user}`;
    process.stderr.write(
      '\n  ❌ เชื่อมต่อฐานข้อมูลไม่ได้\n' +
      `     ไดรเวอร์: ${config.databaseDriver} · ${info}\n` +
      '     ตรวจค่า DB_* ในไฟล์ .env — หรือเปิดหน้า /setup เพื่อตั้งค่าผ่านเว็บ\n\n',
    );
    process.exit(1);
  }

  await new DatabaseSetup(config, db).run({
    migrateOnly: process.argv.includes('--migrate-only'),
    seedOnly: process.argv.includes('--seed-only'),
  });

  process.stdout.write(
    '\n  ✅ ติดตั้งฐานข้อมูลเรียบร้อย\n' +
    '     ขั้นถัดไป: npm run create:admin (สร้างผู้ดูแลคนแรก)\n\n',
  );
} catch (error) {
  process.stderr.write(`\n  ❌ ติดตั้งฐานข้อมูลไม่สำเร็จ: ${error.message}\n`);
  if (error.stack) process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
} finally {
  await db.close();
}
