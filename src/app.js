import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import { join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { Config } from './core/Config.js';
import { Database } from './core/Database.js';
import { Logger } from './core/Logger.js';
import { ServiceContainer } from './core/ServiceContainer.js';
import { RouteRegistry } from './routes/RouteRegistry.js';
import { setupRoutes } from './routes/setupRoutes.js';
import { SetupService } from './services/SetupService.js';
import { SetupController } from './controllers/SetupController.js';
import { CsrfProtection } from './services/security/CsrfProtection.js';
import { ErrorMiddleware } from './middlewares/ErrorMiddleware.js';
import { ZoneLevel } from './models/values/ZoneLevel.js';
import { DailyReport } from './models/DailyReport.js';

/**
 * แอปพลิเคชันหลัก — ประกอบทุกชิ้นส่วนเข้าด้วยกันและควบคุมวงจรชีวิตของระบบ
 *
 * รับผิดชอบสามอย่าง: ตั้งค่า Express, ลงทะเบียนเส้นทาง และเริ่ม/หยุดระบบอย่างเรียบร้อย
 * ตรรกะทางธุรกิจทั้งหมดอยู่ในชั้น Service — คลาสนี้ไม่มีตรรกะของตัวเอง
 */
export class Application {
  /** @type {import('express').Express} */
  #app;
  /** @type {Config} */
  #config;
  /** @type {Logger} */
  #logger;
  /** @type {Database} */
  #db;
  /** @type {ServiceContainer} */
  #container;
  /** @type {import('node:http').Server|null} */
  #server = null;
  /** @type {boolean} */
  #setupMode = false;
  /** @type {SetupService|null} */
  #setupService = null;

  /**
   * @param {Config} config ค่าตั้งค่าของระบบ
   * @param {Database|null} db ตัวเชื่อมฐานข้อมูล (null ได้ในโหมดติดตั้ง)
   * @param {Logger} logger ตัวบันทึกเหตุการณ์
   * @param {{setupMode?: boolean}} [options={}] ตัวเลือก
   */
  constructor(config, db, logger, { setupMode = false } = {}) {
    this.#config = config;
    this.#db = db;
    this.#logger = logger;
    this.#setupMode = setupMode;
    this.#container = setupMode ? null : new ServiceContainer(config, db, logger);
    this.#app = express();
  }

  /** @returns {boolean} กำลังทำงานในโหมดติดตั้งหรือไม่ */
  get isSetupMode() { return this.#setupMode; }

  /** @returns {SetupService|null} บริการติดตั้ง (มีเฉพาะโหมดติดตั้ง) */
  get setupService() { return this.#setupService; }

  /** @returns {import('express').Express} แอป Express (ใช้ในชุดทดสอบ) */
  get expressApp() { return this.#app; }

  /** @returns {ServiceContainer} ตัวประกอบวัตถุ (ใช้ในชุดทดสอบ) */
  get container() { return this.#container; }

  /**
   * ตั้งค่า Express ให้ครบทุกชั้นตามลำดับที่ถูกต้อง
   *
   * ในโหมดติดตั้ง (ยังไม่มีฐานข้อมูลหรือยังไม่มีผู้ใช้) จะลงทะเบียนเฉพาะเส้นทาง
   * `/setup` กับ `/health` เท่านั้น เพื่อไม่ให้ส่วนที่ต้องใช้ฐานข้อมูลถูกเรียก
   *
   * @returns {this}
   */
  configure() {
    return this.#setupMode ? this.#configureSetupMode() : this.#configureNormalMode();
  }

  /**
   * ตั้งค่าโหมดติดตั้ง — มีเฉพาะหน้าตั้งค่าและไฟล์ static
   * @returns {this}
   */
  #configureSetupMode() {
    const app = this.#app;
    const root = this.#config.root;

    app.set('view engine', 'ejs');
    app.set('views', join(root, 'src/views'));
    app.set('trust proxy', 1);
    app.disable('x-powered-by');

    this.#applySecurityHeaders();

    app.use((req, res, next) => {
      req.requestId = randomUUID();
      res.setHeader('X-Request-Id', req.requestId);
      next();
    });

    app.use(express.json({ limit: '256kb' }));
    app.use(express.urlencoded({ extended: false, limit: '256kb' }));
    app.use(express.static(join(root, 'src/public'), { maxAge: 0 }));

    // โหมดติดตั้งยังไม่มีฐานข้อมูลให้เก็บ session จึงใช้ที่เก็บในหน่วยความจำชั่วคราว
    app.use(session({
      name: 'wl.setup',
      secret: randomUUID(),
      resave: false,
      saveUninitialized: true,
      cookie: { httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 1000 },
    }));

    const csrf = new CsrfProtection();
    app.use((req, res, next) => {
      res.locals.csrfToken = csrf.tokenFor(req);
      res.locals.currentUser = null;
      res.locals.can = () => false;
      res.locals.currentPath = req.path;
      res.locals.baseUrl = this.#config.baseUrl;
      res.locals.seo = null;
      res.locals.jsonLd = null;
      res.locals.query = req.query;
      try {
        csrf.assert(req);
        next();
      } catch (error) {
        next(error);
      }
    });

    this.#setupService = new SetupService(this.#config, this.#logger);
    const setupController = new SetupController({
      setupService: this.#setupService,
      baseUrl: this.#config.baseUrl,
      logger: this.#logger,
    });

    app.get('/health', (req, res) => {
      res.status(503).json({
        success: false,
        data: { healthy: false, mode: 'setup', message: 'ระบบยังไม่ได้ติดตั้ง' },
      });
    });

    app.use('/setup', setupRoutes({ setupController }));

    // ทุกเส้นทางอื่นพาไปหน้าตั้งค่า
    app.use((req, res) => { res.redirect('/setup'); });

    const errorMiddleware = new ErrorMiddleware(this.#config.isProduction, this.#logger);
    app.use(errorMiddleware.handler());

    this.#logger.warn('running in SETUP MODE — only /setup is available');
    return this;
  }

  /**
   * ตั้งค่าโหมดใช้งานปกติ
   * @returns {this}
   */
  #configureNormalMode() {
    const app = this.#app;
    const root = this.#config.root;

    app.set('view engine', 'ejs');
    app.set('views', join(root, 'src/views'));
    app.set('trust proxy', 1);
    app.disable('x-powered-by');

    this.#applySecurityHeaders();

    // ── request id สำหรับไล่ตามใน log ──
    app.use((req, res, next) => {
      req.requestId = randomUUID();
      res.setHeader('X-Request-Id', req.requestId);
      next();
    });

    // ── อ่านเนื้อคำขอ พร้อมเก็บ raw body ไว้ตรวจลายเซ็น LINE ──
    app.use(express.json({
      limit: '2mb',
      verify: (req, res, buffer) => { req.rawBody = buffer; },
    }));
    app.use(express.urlencoded({ extended: false, limit: '2mb' }));

    // ── ไฟล์ static ──
    // โค้ดฝั่งเบราว์เซอร์ตั้ง maxAge เป็น 0 แต่คง ETag ไว้ — เบราว์เซอร์จะถาม
    // ทุกครั้งแล้วได้ 304 เมื่อไฟล์ไม่เปลี่ยน ซึ่งถูกกว่าการเสี่ยงให้ผู้ใช้ค้าง
    // อยู่กับ JS เวอร์ชันเก่าหลังอัปเดตระบบ (โปรเจกต์นี้ไม่มีขั้นตอน build
    // จึงไม่มีชื่อไฟล์ติดแฮชให้ใช้ cache-busting)
    app.use(express.static(join(root, 'src/public'), { maxAge: 0, etag: true }));

    // ไฟล์ภาพมีชื่อไม่ซ้ำตามวันเวลาและไม่ถูกเขียนทับ จึงแคชยาวได้อย่างปลอดภัย
    app.use('/storage', express.static(this.#config.storagePath, {
      maxAge: '7d',
      immutable: true,
      index: false,
      dotfiles: 'deny',
    }));

    this.#applySession();

    // ── ด่านตรวจ CSRF (ยกเว้น /webhooks/ ที่ยืนยันด้วยลายเซ็น HMAC แทน) ──
    app.use(this.#container.csrfMiddleware.handle());

    this.#applyViewHelpers();

    // ── ลงทะเบียนเส้นทางทั้งหมด ──
    new RouteRegistry(this.#container).register(
      app,
      (req, res) => this.#healthHandler(req, res),
    );

    // ── ด่านสุดท้าย: 404 และตัวจัดการข้อผิดพลาดรวม ──
    const errorMiddleware = this.#container.errorMiddleware;
    app.use(errorMiddleware.notFound());
    app.use(errorMiddleware.handler());

    return this;
  }

  /**
   * เริ่มรับคำขอและเริ่มงานตามเวลา
   * @param {number} [port] พอร์ตที่ต้องการ (ค่าเริ่มต้นจาก `.env`)
   * @returns {Promise<import('node:http').Server>}
   */
  async listen(port = this.#config.int('PORT', 3000)) {
    this.#ensureStorageDirectories();

    // ค่าตั้งค่าที่แก้จากหน้าเว็บต้องพร้อมก่อนงานตามเวลาเริ่มทำงาน
    // ไม่งั้นรอบแจ้งเตือนรอบแรกจะใช้ค่าจาก `.env` ทั้งที่ผู้ดูแลตั้งค่าใหม่ไว้แล้ว
    if (this.#container) await this.#container.settingsService.load();

    if (this.#setupMode) {
      return new Promise((resolve, reject) => {
        this.#server = this.#app.listen(port, () => {
          this.#logger.info('setup server started', { port, url: `${this.#config.baseUrl}/setup` });
          resolve(this.#server);
        });
        this.#server.once('error', (error) => reject(Application.describeListenError(error, port)));
      });
    }

    if (this.#config.bool('SCHEDULER_ENABLED', true) && !this.#config.isTest) {
      // ประกอบงานใหม่ก่อนเริ่ม — `configure()` สร้างตัวจับเวลาไปแล้วตอนที่ยังไม่ได้
      // โหลดค่าตั้งค่า งานจึงถือตารางเวลาค่าเริ่มต้นอยู่ ไม่ใช่ค่าที่ผู้ดูแลตั้งไว้
      this.#container.restartScheduler();
      // ซิงก์ใบอนุญาตครั้งแรกทันทีโดยไม่รอรอบ cron — ถ้าคีย์ถูกต่ออายุหรือถูกยกเลิก
      // ตอนที่ระบบปิดอยู่ ผู้ดูแลจะเห็นผลตั้งแต่เปิดหน้าแรก ไม่ใช่อีก 6 ชั่วโมงข้างหน้า
      // ไม่ `await` เพราะบริการปลายทางที่ตอบช้าไม่ควรถ่วงการเปิดรับคำขอ
      this.#container.licenseSyncJob.run();
    } else {
      // ยังต้องให้ AlertJob รับเหตุการณ์ แม้ไม่ได้ตั้งเวลางานอื่น
      this.#container.alertJob.subscribe();
      this.#logger.info('scheduler disabled by configuration');
    }

    return new Promise((resolve, reject) => {
      this.#server = this.#app.listen(port, () => {
        this.#logger.info('server started', {
          port,
          env: this.#config.get('NODE_ENV', 'development'),
          detection: this.#container.detectionService.driver,
          notification: this.#container.notificationChannel.channel,
          baseUrl: this.#config.baseUrl,
        });
        resolve(this.#server);
      });
      // ต้องดักที่นี่ มิฉะนั้น Node จะโยน 'error' ออกมาเป็น stack trace ที่อ่านยาก
      this.#server.once('error', (error) => reject(Application.describeListenError(error, port)));
    });
  }

  /**
   * ปิดระบบอย่างเรียบร้อย — หยุดรับคำขอใหม่ หยุดงานตามเวลา แล้วปิดฐานข้อมูล
   * @param {{closeLogger?: boolean}} [options={}] ส่ง `closeLogger: false` เมื่อจะเริ่มระบบใหม่ต่อทันที
   * @returns {Promise<void>}
   */
  async shutdown({ closeLogger = true } = {}) {
    this.#logger.info('shutting down');

    if (this.#container) {
      this.#container.scheduler.stop();
      this.#container.sessionStore.close();
    }

    if (this.#server) {
      await new Promise((resolve) => { this.#server.close(resolve); });
      this.#server = null;
    }

    await this.#db?.close();
    if (closeLogger) this.#logger.close();
  }

  /**
   * ตั้งค่าส่วนหัวความปลอดภัยด้วย `helmet`
   *
   * CSP อนุญาต inline script เท่าที่จำเป็นสำหรับ JSON-LD และข้อมูลกราฟที่ฝังในหน้า
   * และอนุญาต CDN ของ Chart.js กับ hls.js ที่หน้าสาธารณะใช้
   *
   * @returns {void}
   */
  #applySecurityHeaders() {
    this.#app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          mediaSrc: ["'self'", 'blob:', 'https:'],
          connectSrc: ["'self'", 'https:'],
          frameAncestors: ["'self'"],
          objectSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      // ภาพจาก /storage ต้องฝังในหน้าอื่นได้ (เช่น LINE ดึงไปแสดง)
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }));
  }

  /**
   * ตั้งค่า session ที่เก็บใน MySQL
   * @returns {void}
   */
  #applySession() {
    const settings = this.#container.settingsService;
    /** อายุ session สูงสุดตามค่าตั้งค่าล่าสุด (มิลลิวินาที) */
    const maxAgeMs = () => settings.int('SESSION_MAX_AGE_HOURS', 8) * 3600 * 1000;
    /** ระยะเวลาที่ปล่อยให้เงียบได้ก่อนถือว่าหมดอายุ (มิลลิวินาที) */
    const idleMs = () => settings.int('SESSION_IDLE_TIMEOUT_HOURS', 2) * 3600 * 1000;

    // ⚠️ `SESSION_SECRET` ตั้งจากหน้าเว็บไม่ได้โดยเจตนา — เป็นกุญแจเซ็นคุกกี้
    // เปลี่ยนเมื่อไรทุกคนหลุดจากระบบทันที และไม่ควรอยู่ในมือผู้ถือสิทธิ์ setting.manage
    const secret = this.#config.get('SESSION_SECRET');

    if (!secret && this.#config.isProduction) {
      throw new Error('SESSION_SECRET is required in production');
    }

    this.#app.use(session({
      name: 'wl.sid',
      secret: secret ?? 'development-only-insecure-secret',
      store: this.#container.sessionStore,
      resave: false,
      saveUninitialized: false,
      rolling: true, // ต่ออายุอัตโนมัติเมื่อมีกิจกรรม
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: this.#config.baseUrl.startsWith('https://'),
        maxAge: maxAgeMs(),
      },
    }));

    this.#app.use((req, res, next) => {
      if (!req.session?.userId) { next(); return; }

      // เขียนทับอายุคุกกี้รายคำขอ — `session()` อ่าน `cookie.maxAge` ตอนสร้าง
      // มิดเดิลแวร์เพียงครั้งเดียว ถ้าไม่ตั้งตรงนี้ ค่าที่ผู้ดูแลแก้ในหน้าเว็บ
      // จะไม่มีผลจนกว่าจะรีสตาร์ต ส่วน `rolling: true` เป็นตัวส่งคุกกี้ใหม่ให้ทุกคำขอ
      req.session.cookie.maxAge = maxAgeMs();

      const now = Date.now();
      if (req.session.lastSeenAt && now - req.session.lastSeenAt > idleMs()) {
        this.#logger.info('session expired due to inactivity', { userId: req.session.userId });
        req.session.destroy(() => { res.redirect('/login?expired=1'); });
        return;
      }
      req.session.lastSeenAt = now;
      next();
    });
  }

  /**
   * เติมตัวช่วยที่ทุก view เรียกใช้ได้
   *
   * ⚠️ `can()` เป็นเพียงชั้นประสบการณ์ผู้ใช้สำหรับซ่อนปุ่ม **ไม่ใช่ความปลอดภัย**
   * การป้องกันจริงอยู่ที่ middleware และชั้น Service (CLAUDE.md ข้อ 8.4)
   *
   * @returns {void}
   */
  #applyViewHelpers() {
    this.#app.use((req, res, next) => {
      res.locals.currentUser = req.user ?? null;
      res.locals.can = (permissionKey) => Boolean(req.user?.can(permissionKey));
      res.locals.currentPath = req.path;
      res.locals.baseUrl = this.#config.baseUrl;
      res.locals.zoneLevels = ZoneLevel.all().map((zone) => zone.toJSON());
      res.locals.thaiDate = (value) => DailyReport.toThaiDate(value);
      res.locals.formatDateTime = Application.formatDateTime;
      res.locals.formatNumber = (value, digits = 2) => (
        value === null || value === undefined ? '—' : Number(value).toFixed(digits)
      );
      res.locals.query = req.query;
      res.locals.title = 'ระบบวัดระดับน้ำอัตโนมัติ';
      res.locals.seo = null;
      res.locals.jsonLd = null;
      next();
    });
  }

  /**
   * ตอบสถานะระบบสำหรับ `GET /health`
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async #healthHandler(req, res) {
    const dbHealthy = await this.#db.ping();
    let lastMeasuredAt = null;

    if (dbHealthy) {
      try {
        const row = await this.#db.queryOne('SELECT MAX(measured_at) AS last FROM measurements');
        lastMeasuredAt = row?.last ?? null;
      } catch {
        lastMeasuredAt = null;
      }
    }

    const payload = {
      healthy: dbHealthy,
      database: dbHealthy ? 'ok' : 'unreachable',
      uptimeSeconds: Math.floor(process.uptime()),
      lastMeasuredAt,
      detectionDriver: this.#container.detectionService.driver,
      notificationDriver: this.#container.notificationChannel.channel,
      scheduler: this.#container.scheduler.isStarted ? 'running' : 'stopped',
      timestamp: new Date().toISOString(),
    };

    res.status(dbHealthy ? 200 : 503).json({ success: dbHealthy, data: payload });
  }

  /**
   * สร้างโฟลเดอร์เก็บไฟล์หากยังไม่มี
   * @returns {void}
   */
  #ensureStorageDirectories() {
    const base = this.#config.storagePath;
    for (const sub of ['images/cron', 'images/alert', 'images/thumb', 'images/report', 'logs']) {
      const path = join(base, sub);
      if (!existsSync(path)) mkdirSync(path, { recursive: true });
    }
  }

  /**
   * แปลงข้อผิดพลาดตอนเปิดพอร์ตเป็นข้อความภาษาไทยที่บอกทางแก้
   *
   * `EADDRINUSE` เป็นกรณีที่พบบ่อยที่สุดตอนพัฒนา (ลืมปิดโปรเซสเดิม)
   * ข้อความเริ่มต้นของ Node เป็น stack trace ที่ไม่ช่วยให้รู้ว่าต้องทำอะไรต่อ
   *
   * @param {Error & {code?: string}} error ข้อผิดพลาดจาก `server.listen()`
   * @param {number} port พอร์ตที่พยายามเปิด
   * @returns {Error} ข้อผิดพลาดที่มีข้อความอ่านรู้เรื่อง
   */
  static describeListenError(error, port) {
    const messages = {
      EADDRINUSE:
        `พอร์ต ${port} ถูกใช้งานอยู่แล้ว\n` +
        '     • ปิดโปรเซสเดิมก่อน หรือ\n' +
        `     • เปลี่ยนพอร์ตด้วย PORT=3001 npm start (อย่าลืมแก้ BASE_URL ให้ตรงกัน)`,
      EACCES:
        `ไม่มีสิทธิ์เปิดพอร์ต ${port}\n` +
        '     พอร์ตต่ำกว่า 1024 ต้องใช้สิทธิ์ root — แนะนำให้ใช้พอร์ตสูงกว่าแล้ววาง Nginx ข้างหน้าแทน',
      EADDRNOTAVAIL: 'ที่อยู่ที่ระบุใช้เปิดพอร์ตไม่ได้',
    };

    const described = new Error(messages[error.code] ?? `เปิดพอร์ต ${port} ไม่ได้: ${error.message}`);
    described.code = error.code;
    described.stack = error.stack;
    return described;
  }

  /**
   * จัดรูปแบบวันเวลาเป็นภาษาไทยพร้อมปี พ.ศ. — ใช้ใน view
   * @param {Date|string|null} value เวลา
   * @returns {string}
   */
  static formatDateTime(value) {
    if (!value) return '—';
    const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear() + 543} ${hh}:${mm}`;
  }
}
