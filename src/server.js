// ⚠️ ต้องตั้งเขตเวลาเป็นบรรทัดแรกสุด ก่อน import อื่นใด
// เพราะ Node แคชค่า TZ ตั้งแต่การเรียก Date ครั้งแรก (CLAUDE.md ข้อ 13)
process.env.TZ = process.env.TZ ?? 'Asia/Bangkok';

import { join } from 'node:path';
import { Config } from './core/Config.js';
import { DatabaseFactory } from './core/Database.js';
import { Logger } from './core/Logger.js';
import { Application } from './app.js';
import { SchemaGuard } from './core/SchemaGuard.js';

/**
 * จุดเริ่มโปรแกรม — ไฟล์เดียวในระบบที่ไม่ใช่คลาส (CLAUDE.md ข้อ 4)
 *
 * ทำหน้าที่เป็น "ผู้ดูแล" ของแอป: ตัดสินว่าจะเริ่มใน**โหมดติดตั้ง**หรือ**โหมดปกติ**
 * และเมื่อผู้ดูแลติดตั้งเสร็จผ่านหน้าเว็บ จะปิดแอปโหมดติดตั้งแล้วเปิดโหมดปกติ
 * บนพอร์ตเดิมให้อัตโนมัติ โดยไม่ต้องสั่งรันใหม่เอง
 */

/**
 * ตรวจว่าควรเริ่มในโหมดติดตั้งหรือไม่
 *
 * เข้าโหมดติดตั้งเมื่อ: ยังไม่ได้ตั้งค่าฐานข้อมูล · เชื่อมต่อไม่ได้ · หรือยังไม่มีผู้ใช้เลย
 *
 * @param {Config} config ค่าตั้งค่า
 * @param {Logger} logger ตัวบันทึกเหตุการณ์
 * @returns {Promise<{setupMode: boolean, reason: string, pendingMigrations?: Array<string>}>}
 */
async function decideMode(config, logger) {
  if (!config.hasDatabaseConfig) {
    return { setupMode: true, reason: 'ยังไม่ได้ตั้งค่าฐานข้อมูลในไฟล์ .env' };
  }

  let db = null;
  try {
    db = DatabaseFactory.build(config.database);

    if (!await db.ping()) {
      return { setupMode: true, reason: 'เชื่อมต่อฐานข้อมูลไม่ได้' };
    }

    const row = await db.queryOne('SELECT COUNT(*) AS total FROM users');
    if (Number(row?.total ?? 0) === 0) {
      return { setupMode: true, reason: 'ยังไม่มีผู้ใช้ในระบบ' };
    }

    // ระบบติดตั้งแล้วแต่สคีมาอาจตามโค้ดไม่ทัน — ต้องรู้ตั้งแต่ตอนนี้ ไม่ใช่ตอนผู้ใช้กดบันทึก
    const pending = await new SchemaGuard(db, join(config.root, 'database/migrations')).pending();
    if (pending.length) {
      return { setupMode: false, reason: 'พร้อมใช้งาน', pendingMigrations: pending };
    }
    return { setupMode: false, reason: 'พร้อมใช้งาน', pendingMigrations: [] };
  } catch (error) {
    logger.warn('cannot verify database state — entering setup mode', {
      message: error.message,
    });
    return { setupMode: true, reason: 'ยังไม่ได้สร้างตารางในฐานข้อมูล' };
  } finally {
    await db?.close();
  }
}

/**
 * สร้างและเริ่มแอปในโหมดที่ระบุ
 * @param {Config} config ค่าตั้งค่า
 * @param {Logger} logger ตัวบันทึกเหตุการณ์
 * @param {boolean} setupMode เริ่มในโหมดติดตั้งหรือไม่
 * @returns {Promise<Application>}
 */
async function startApplication(config, logger, setupMode) {
  const db = setupMode ? null : DatabaseFactory.create(config.database);
  const application = new Application(config, db, logger, { setupMode }).configure();
  await application.listen();
  return application;
}

/**
 * เริ่มระบบ
 * @returns {Promise<void>}
 */
async function main() {
  let config = Config.bootstrap();

  if (config.get('TZ') && process.env.TZ !== config.get('TZ')) {
    process.env.TZ = config.get('TZ');
  }

  const logger = Logger.configure({
    level: config.get('LOG_LEVEL', config.isProduction ? 'info' : 'debug'),
    logDir: join(config.storagePath, 'logs'),
    console: true,
  });

  logger.info('starting water level monitoring system', {
    node: process.version,
    env: config.get('NODE_ENV', 'development'),
    tz: process.env.TZ,
  });

  const mode = await decideMode(config, logger);

  if (mode.pendingMigrations?.length) {
    logger.error('database schema is behind the code', { pending: mode.pendingMigrations });
    process.stderr.write(SchemaGuard.describe(mode.pendingMigrations));
    process.exit(1);
  }

  let application = await startApplication(config, logger, mode.setupMode);

  if (mode.setupMode) {
    process.stdout.write(
      '\n  ⚙️  ระบบยังไม่ได้ติดตั้ง — เข้าสู่โหมดตั้งค่า\n' +
      `     เหตุผล: ${mode.reason}\n` +
      `     เปิดเบราว์เซอร์ไปที่ ${config.baseUrl}/setup เพื่อตั้งค่าฐานข้อมูล\n` +
      '     (หรือใช้บรรทัดคำสั่ง: npm run db:setup แล้ว npm run create:admin)\n\n',
    );

    // เมื่อหน้าตั้งค่าทำงานเสร็จ ให้เริ่มระบบใหม่ด้วยค่าที่เพิ่งบันทึก
    application.setupService.once('completed', async ({ driver }) => {
      logger.info('setup finished — restarting in normal mode', { driver });

      // ให้เวลาส่งหน้า "ติดตั้งเสร็จ" กลับไปยังเบราว์เซอร์ก่อนปิดเซิร์ฟเวอร์
      setTimeout(async () => {
        try {
          await application.shutdown({ closeLogger: false });
          config = Config.reload();
          application = await startApplication(config, logger, false);

          process.stdout.write(
            `\n  ✅ ติดตั้งเสร็จแล้ว — ระบบพร้อมใช้งานที่ ${config.baseUrl}\n` +
            `     หน้าผู้ดูแล: ${config.baseUrl}/admin\n\n`,
          );
        } catch (error) {
          logger.error('failed to restart after setup', error);
          process.stderr.write(
            `\n  ⚠️  ติดตั้งสำเร็จแต่เริ่มระบบใหม่ไม่ได้: ${error.message}\n` +
            '     กรุณาสั่ง npm start อีกครั้ง\n\n',
          );
          process.exit(1);
        }
      }, 1500).unref?.();
    });
  } else {
    process.stdout.write(
      `\n  ✅ ระบบพร้อมใช้งานที่ ${config.baseUrl}\n` +
      `     หน้าผู้ดูแล: ${config.baseUrl}/admin\n` +
      `     ฐานข้อมูล: ${config.databaseDriver}` +
      ` · ไดรเวอร์ตรวจจับ: ${config.get('DETECTION_DRIVER', 'mock')}` +
      ` · ช่องทางแจ้งเตือน: ${config.get('NOTIFICATION_DRIVER', 'console')}\n\n`,
    );
  }

  // ── ปิดระบบอย่างเรียบร้อยเมื่อได้รับสัญญาณ ──
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`received ${signal} — shutting down gracefully`);
    try {
      await application.shutdown();
      process.exit(0);
    } catch (error) {
      logger.error('error during shutdown', error);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled promise rejection', reason instanceof Error ? reason : { reason });
  });
  process.on('uncaughtException', (error) => {
    logger.error('uncaught exception — shutting down', error);
    shutdown('uncaughtException');
  });
}

main().catch((error) => {
  // ข้อผิดพลาดที่คาดไว้ (เช่นพอร์ตซ้ำ) มีข้อความบอกทางแก้อยู่แล้ว ไม่ต้องแสดง stack trace
  const expected = ['EADDRINUSE', 'EACCES', 'EADDRNOTAVAIL'].includes(error.code);
  process.stderr.write(
    `\n  ❌ เริ่มระบบไม่สำเร็จ: ${error.message}\n` +
    (expected ? '' : `${error.stack}\n`) + '\n',
  );
  process.exit(1);
});
