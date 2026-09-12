process.env.TZ = process.env.TZ ?? 'Asia/Bangkok';

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { Config } from '../src/core/Config.js';
import { DatabaseFactory } from '../src/core/Database.js';
import { Logger } from '../src/core/Logger.js';
import { LegacyMigrator } from '../database/legacy/LegacyMigrator.js';

/**
 * สคริปต์ย้ายข้อมูลจากระบบเดิม — `npm run migrate:legacy`
 *
 * ตัวเลือก:
 * - `--dry-run`      ดูผลโดยไม่บันทึกจริง
 * - `--skip-images`  ข้ามการคัดลอกไฟล์ภาพ (เร็วขึ้นมากตอนทดลอง)
 * - `--dump=<พาธ>`   ระบุไฟล์ dump เอง (ค่าเริ่มต้น `data/bangpai.sql`)
 */

const config = Config.bootstrap();
Logger.configure({ level: 'warn', logDir: null, console: true });

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skipImages = args.includes('--skip-images');
const dumpArg = args.find((arg) => arg.startsWith('--dump='));

const dumpPath = dumpArg
  ? dumpArg.slice('--dump='.length)
  : join(config.root, 'data/bangpai.sql');

if (!existsSync(dumpPath)) {
  process.stderr.write(
    `\n  ❌ ไม่พบไฟล์ dump ของระบบเดิม: ${dumpPath}\n` +
    '     ระบุพาธเองได้ด้วย --dump=<พาธไฟล์>\n\n',
  );
  process.exit(1);
}

const db = DatabaseFactory.create(config.database);

try {
  if (!await db.ping()) {
    process.stderr.write('\n  ❌ เชื่อมต่อฐานข้อมูลไม่ได้ — กรุณารัน npm run db:setup ก่อน\n\n');
    process.exit(1);
  }

  const roles = await db.queryOne('SELECT COUNT(*) AS total FROM roles');
  if (Number(roles?.total ?? 0) === 0) {
    process.stderr.write(
      '\n  ❌ ยังไม่มีข้อมูลตั้งต้นในฐานข้อมูล — กรุณารัน npm run db:setup ก่อน\n\n',
    );
    process.exit(1);
  }

  process.stdout.write(
    '\n  ── ย้ายข้อมูลจากระบบเดิม ──\n' +
    `     ไฟล์ dump : ${dumpPath}\n` +
    `     ปลายทาง   : ${db.driver} · ${db.name}\n`,
  );

  const migrator = new LegacyMigrator({
    db,
    dumpPath,
    imageSourceDir: join(config.root, 'data/bangpai.tspnextsoftware.com/uploads/images'),
    storagePath: config.storagePath,
    dryRun,
  });

  const summary = await migrator.run({ skipImages });

  process.stdout.write('\n  ── สรุป ──\n');
  for (const [step, result] of Object.entries(summary)) {
    if (step === 'verification') continue;
    process.stdout.write(`     ${step.padEnd(16)} ${JSON.stringify(result)}\n`);
  }

  const failed = (summary.verification ?? []).filter((check) => !check.ok);
  if (failed.length) {
    process.stdout.write(`\n  ⚠️  การตรวจสอบไม่ผ่าน ${failed.length} รายการ:\n`);
    for (const check of failed) {
      process.stdout.write(`     · ${check.check}: ${check.detail}\n`);
    }
  }

  if (migrator.warnings.length) {
    process.stdout.write(`\n  ⚠️  คำเตือน ${migrator.warnings.length} ข้อ:\n`);
    for (const warning of migrator.warnings) {
      process.stdout.write(`     · ${warning}\n`);
    }
  }

  process.stdout.write(
    dryRun
      ? '\n  ✅ ทดลองย้ายข้อมูลเสร็จ (ยังไม่ได้บันทึกจริง) — รันซ้ำโดยไม่ใส่ --dry-run เพื่อบันทึก\n\n'
      : '\n  ✅ ย้ายข้อมูลเสร็จเรียบร้อย\n\n',
  );
} catch (error) {
  process.stderr.write(`\n  ❌ ย้ายข้อมูลไม่สำเร็จ: ${error.message}\n`);
  if (error.stack) process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
} finally {
  await db.close();
}
