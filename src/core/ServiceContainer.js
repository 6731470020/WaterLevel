import { Database } from './Database.js';
import { Logger } from './Logger.js';
import { EventBus } from './EventBus.js';
import { MemoryCache } from './MemoryCache.js';
import { ValidationError } from './errors/index.js';

// ── ชั้นข้อมูล ──
import { UserRepository } from '../repositories/UserRepository.js';
import { RoleRepository } from '../repositories/RoleRepository.js';
import { PermissionRepository } from '../repositories/PermissionRepository.js';
import { SessionRepository } from '../repositories/SessionRepository.js';
import { PasswordResetRepository } from '../repositories/PasswordResetRepository.js';
import { AuditLogRepository } from '../repositories/AuditLogRepository.js';
import { StationRepository } from '../repositories/StationRepository.js';
import { RoiRepository } from '../repositories/RoiRepository.js';
import { CalibrationRepository } from '../repositories/CalibrationRepository.js';
import { MeasurementRepository } from '../repositories/MeasurementRepository.js';
import { ValidationLogRepository } from '../repositories/ValidationLogRepository.js';
import { AlertStateRepository } from '../repositories/AlertStateRepository.js';
import { BroadcastLogRepository } from '../repositories/BroadcastLogRepository.js';
import { DailyReportRepository } from '../repositories/DailyReportRepository.js';
import { ReportLogRepository } from '../repositories/ReportLogRepository.js';
import { CaptureRepository } from '../repositories/CaptureRepository.js';
import { LineRepository } from '../repositories/LineRepository.js';
import { LicenseRepository } from '../repositories/LicenseRepository.js';

// ── กลยุทธ์ที่สลับได้ ──
import { ScryptHasher } from '../services/security/ScryptHasher.js';
import { BcryptHasher } from '../services/security/BcryptHasher.js';
import { PasswordPolicy } from '../services/security/PasswordPolicy.js';
import { CsrfProtection } from '../services/security/CsrfProtection.js';
import { SignatureVerifier } from '../services/security/SignatureVerifier.js';
import { HttpDetectionService } from '../services/detection/HttpDetectionService.js';
import { ConfiguredDetectionService } from '../services/detection/ConfiguredDetectionService.js';
import { HttpKeyRegistry } from '../services/license/HttpKeyRegistry.js';
import { NullKeyRegistry } from '../services/license/NullKeyRegistry.js';
import { ConfiguredKeyRegistry } from '../services/license/ConfiguredKeyRegistry.js';
import { MockDetectionService } from '../services/detection/MockDetectionService.js';
import { LineChannel } from '../services/notification/LineChannel.js';
import { ConsoleChannel } from '../services/notification/ConsoleChannel.js';
import { MessageFactory } from '../services/notification/MessageFactory.js';
import { DiscordChannel } from '../services/notification/DiscordChannel.js';
import { TelegramChannel } from '../services/notification/TelegramChannel.js';
import { CompositeChannel } from '../services/notification/CompositeChannel.js';
import { ConfiguredChannel } from '../services/notification/ConfiguredChannel.js';
import { SettingRepository } from '../repositories/SettingRepository.js';
import { SettingsService } from '../services/SettingsService.js';
import { CameraProxyService } from '../services/camera/CameraProxyService.js';
import { CameraController } from '../controllers/CameraController.js';
import { LocalStorageService } from '../services/storage/LocalStorageService.js';

// ── ชั้นธุรกิจ ──
import { AuditService } from '../services/AuditService.js';
import { PermissionService } from '../services/PermissionService.js';
import { AuthService } from '../services/AuthService.js';
import { UserService } from '../services/UserService.js';
import { RoleService } from '../services/RoleService.js';
import { LicenseService } from '../services/LicenseService.js';
import { StationService } from '../services/StationService.js';
import { CalibrationService } from '../services/CalibrationService.js';
import { ForecastService } from '../services/ForecastService.js';
import { RoiService } from '../services/RoiService.js';
import { MeasurementService } from '../services/MeasurementService.js';
import { AlertService } from '../services/AlertService.js';
import { ReportService } from '../services/ReportService.js';
import { CommandHandler } from '../services/CommandHandler.js';
import { LineService } from '../services/LineService.js';
import { MailService } from '../services/mail/MailService.js';
import { MailjetMailService } from '../services/mail/MailjetMailService.js';
import { ConsoleMailService } from '../services/mail/ConsoleMailService.js';
import { ConfiguredMailService } from '../services/mail/ConfiguredMailService.js';
import { VariationValidator } from '../services/VariationValidator.js';

// ── ชั้นนำเสนอ ──
import { LicenseMiddleware } from '../middlewares/LicenseMiddleware.js';
import { AuthMiddleware } from '../middlewares/AuthMiddleware.js';
import { PermissionMiddleware } from '../middlewares/PermissionMiddleware.js';
import { StationScopeMiddleware } from '../middlewares/StationScopeMiddleware.js';
import { CsrfMiddleware } from '../middlewares/CsrfMiddleware.js';
import { ErrorMiddleware } from '../middlewares/ErrorMiddleware.js';

import { AuthController } from '../controllers/AuthController.js';
import { DashboardController } from '../controllers/DashboardController.js';
import { StationController } from '../controllers/StationController.js';
import { RoiController } from '../controllers/RoiController.js';
import { CalibrationController } from '../controllers/CalibrationController.js';
import { MeasurementController } from '../controllers/MeasurementController.js';
import { AlertController } from '../controllers/AlertController.js';
import { ReportController } from '../controllers/ReportController.js';
import { UserController } from '../controllers/UserController.js';
import { RoleController } from '../controllers/RoleController.js';
import { AuditController } from '../controllers/AuditController.js';
import { LicenseController } from '../controllers/LicenseController.js';
import { LineController } from '../controllers/LineController.js';
import { LineWebhookController } from '../controllers/LineWebhookController.js';
import { PublicController } from '../controllers/PublicController.js';

// ── งานตามเวลา ──
import { Scheduler } from '../jobs/Scheduler.js';
import { DetectJob } from '../jobs/DetectJob.js';
import { AlertJob } from '../jobs/AlertJob.js';
import { DailyReportJob } from '../jobs/DailyReportJob.js';
import { RetentionJob } from '../jobs/RetentionJob.js';
import { HealthCheckJob } from '../jobs/HealthCheckJob.js';
import { LicenseSyncJob } from '../jobs/LicenseSyncJob.js';

import { MySqlSessionStore } from '../session/MySqlSessionStore.js';

/**
 * ตัวประกอบวัตถุทั้งระบบ (Factory Pattern)
 *
 * เป็น**ที่เดียว**ที่รู้ว่าคลาสใดต้องพึ่งคลาสใด และเป็นที่เดียวที่อ่านค่าจาก `Config`
 * เพื่อเลือกกลยุทธ์ — ทำให้การสลับ `DETECTION_DRIVER` จาก `mock` เป็น `http`
 * แก้ที่ไฟล์นี้ไฟล์เดียว (จริง ๆ คือแก้ที่ `.env` ไฟล์เดียว) โดยที่ `DetectJob`,
 * `MeasurementController` และโค้ดอื่นทั้งหมดไม่ต้องแก้แม้แต่บรรทัดเดียว
 *
 * วัตถุทุกตัวสร้างครั้งเดียวแล้วเก็บไว้ (singleton ระดับ container)
 * และรับการพึ่งพาผ่าน constructor ทั้งหมด — ไม่มีการ import วัตถุสำเร็จรูปข้ามชั้น
 */
export class ServiceContainer {
  /** @type {Map<string, *>} */
  #instances = new Map();
  /** @type {import('./Config.js').Config} */
  #config;
  /** @type {Logger} */
  #logger;
  /** @type {Database} */
  #db;
  /** @type {EventBus} */
  #eventBus;
  /** @type {MemoryCache} */
  #cache;

  /**
   * @param {import('./Config.js').Config} config ค่าตั้งค่าของระบบ
   * @param {Database} db ตัวเชื่อมฐานข้อมูล
   * @param {Logger} logger ตัวบันทึกเหตุการณ์
   */
  constructor(config, db, logger) {
    this.#config = config;
    this.#db = db;
    this.#logger = logger;
    this.#eventBus = new EventBus();
    this.#cache = new MemoryCache();
  }

  /** @returns {import('./Config.js').Config} ค่าตั้งค่า */
  get config() { return this.#config; }

  /** @returns {Database} ตัวเชื่อมฐานข้อมูล */
  get db() { return this.#db; }

  /** @returns {Logger} ตัวบันทึกเหตุการณ์ */
  get logger() { return this.#logger; }

  /** @returns {EventBus} ช่องทางเหตุการณ์ */
  get eventBus() { return this.#eventBus; }

  /** @returns {MemoryCache} แคชในหน่วยความจำ */
  get cache() { return this.#cache; }

  /**
   * ดึงวัตถุตามชื่อ สร้างครั้งแรกแล้วเก็บไว้ใช้ซ้ำ
   * @param {string} name ชื่อวัตถุ
   * @param {() => *} factory ตัวสร้างเมื่อยังไม่มี
   * @returns {*}
   */
  /**
   * ลืมวัตถุที่แคชไว้ เพื่อให้ประกอบใหม่ด้วยค่าตั้งค่าล่าสุด
   * @param {Array<string>} names ชื่อวัตถุ
   * @returns {void}
   */
  forget(names) {
    for (const name of names) this.#instances.delete(name);
  }

  /**
   * ตั้งเวลางานใหม่ทั้งหมดด้วยตารางเวลาล่าสุด
   *
   * `node-cron` ผูกนิพจน์เข้ากับ task ตั้งแต่ตอนสร้าง เปลี่ยนค่าในฐานข้อมูลเฉย ๆ
   * จึงไม่มีผล ต้องหยุดของเดิม ทิ้งวัตถุงานที่ถือตารางเวลาเก่าไว้ แล้วประกอบใหม่
   *
   * @returns {Array<object>} สถานะของงานทุกตัวหลังตั้งเวลาใหม่
   */
  restartScheduler() {
    const running = this.#instances.get('scheduler');
    running?.stop();
    // ทิ้งตัวตรวจความผันผวนด้วย — `DetectJob` ถือมันไว้และเกณฑ์ทั้งชุดตั้งได้จากหน้าเว็บ
    this.forget(['scheduler', 'detectJob', 'alertJob', 'dailyReportJob',
      'retentionJob', 'healthCheckJob', 'licenseSyncJob', 'variationValidator']);
    this.scheduler.start();
    return this.scheduler.status();
  }

  #resolve(name, factory) {
    if (!this.#instances.has(name)) {
      this.#instances.set(name, factory());
    }
    return this.#instances.get(name);
  }

  // ─────────────────────────── ชั้นข้อมูล ───────────────────────────

  /** @returns {UserRepository} ที่เก็บผู้ใช้ */
  get userRepository() { return this.#resolve('userRepository', () => new UserRepository(this.#db)); }

  /** @returns {RoleRepository} ที่เก็บบทบาท */
  get roleRepository() { return this.#resolve('roleRepository', () => new RoleRepository(this.#db)); }

  /** @returns {PermissionRepository} ที่เก็บสิทธิ์ */
  get permissionRepository() { return this.#resolve('permissionRepository', () => new PermissionRepository(this.#db)); }

  /** @returns {SessionRepository} ที่เก็บ session */
  get sessionRepository() { return this.#resolve('sessionRepository', () => new SessionRepository(this.#db)); }

  /** @returns {PasswordResetRepository} ที่เก็บ token ตั้งรหัสผ่านใหม่ */
  get passwordResetRepository() { return this.#resolve('passwordResetRepository', () => new PasswordResetRepository(this.#db)); }

  /** @returns {AuditLogRepository} ที่เก็บบันทึกการใช้งาน */
  get auditLogRepository() { return this.#resolve('auditLogRepository', () => new AuditLogRepository(this.#db)); }

  /** @returns {StationRepository} ที่เก็บจุดวัด */
  get stationRepository() { return this.#resolve('stationRepository', () => new StationRepository(this.#db)); }

  /** @returns {RoiRepository} ที่เก็บ ROI */
  get roiRepository() { return this.#resolve('roiRepository', () => new RoiRepository(this.#db)); }

  /** @returns {CalibrationRepository} ที่เก็บจุดเทียบค่า */
  get calibrationRepository() { return this.#resolve('calibrationRepository', () => new CalibrationRepository(this.#db)); }

  /** @returns {MeasurementRepository} ที่เก็บค่าวัด */
  get measurementRepository() { return this.#resolve('measurementRepository', () => new MeasurementRepository(this.#db)); }

  /** @returns {ValidationLogRepository} ที่เก็บบันทึกการตรวจความผันผวน */
  get validationLogRepository() { return this.#resolve('validationLogRepository', () => new ValidationLogRepository(this.#db)); }

  /** @returns {AlertStateRepository} ที่เก็บสถานะการแจ้งเตือน */
  get alertStateRepository() { return this.#resolve('alertStateRepository', () => new AlertStateRepository(this.#db)); }

  /** @returns {BroadcastLogRepository} ที่เก็บบันทึกการส่งข้อความ */
  get broadcastLogRepository() { return this.#resolve('broadcastLogRepository', () => new BroadcastLogRepository(this.#db)); }

  /** @returns {DailyReportRepository} ที่เก็บรายงานประจำวัน */
  get dailyReportRepository() { return this.#resolve('dailyReportRepository', () => new DailyReportRepository(this.#db)); }

  /** @returns {ReportLogRepository} ที่เก็บประวัติการส่งรายงาน */
  get reportLogRepository() { return this.#resolve('reportLogRepository', () => new ReportLogRepository(this.#db)); }

  /** @returns {CaptureRepository} ที่เก็บภาพจับเฟรม */
  get captureRepository() { return this.#resolve('captureRepository', () => new CaptureRepository(this.#db)); }

  /** @returns {LineRepository} ที่เก็บข้อมูล LINE */
  get lineRepository() { return this.#resolve('lineRepository', () => new LineRepository(this.#db)); }

  /** @returns {SettingRepository} ที่เก็บค่าตั้งค่าที่แก้จากหน้าเว็บได้ */
  get settingRepository() { return this.#resolve('settingRepository', () => new SettingRepository(this.#db)); }

  /** @returns {LicenseRepository} ที่เก็บใบอนุญาต */
  get licenseRepository() { return this.#resolve('licenseRepository', () => new LicenseRepository(this.#db)); }

  // ─────────────────────── กลยุทธ์ที่สลับได้ ───────────────────────

  /** @returns {ScryptHasher} ตัวแฮชรหัสผ่านหลัก */
  get primaryHasher() { return this.#resolve('primaryHasher', () => new ScryptHasher()); }

  /** @returns {BcryptHasher} ตัวตรวจรหัสผ่านเดิมจาก PHP */
  get legacyHasher() { return this.#resolve('legacyHasher', () => new BcryptHasher()); }

  /** @returns {Array<import('../services/security/PasswordHasher.js').PasswordHasher>} ตัวแฮชทั้งหมดที่รองรับ */
  get hashers() { return [this.primaryHasher, this.legacyHasher]; }

  /**
   * ตัวอ่านนโยบายรหัสผ่านที่มีผลอยู่ตอนนี้
   *
   * คืน**ฟังก์ชัน**ไม่ใช่วัตถุ เพราะ `PASSWORD_MIN_LENGTH` แก้ได้จากหน้าเว็บ
   * ส่วน `PasswordPolicy` เป็นวัตถุที่แช่แข็งแล้ว จึงสร้างใหม่ทุกครั้งที่อ่าน
   * แทนการแก้ค่าข้างใน (ราคาถูกมาก เก็บเลขตัวเดียว)
   *
   * @returns {() => PasswordPolicy}
   */
  get passwordPolicy() {
    return this.#resolve('passwordPolicy',
      () => () => new PasswordPolicy(this.settingsService.int('PASSWORD_MIN_LENGTH', 10)));
  }

  /** @returns {CsrfProtection} ตัวป้องกัน CSRF */
  get csrfProtection() { return this.#resolve('csrfProtection', () => new CsrfProtection()); }

  /** @returns {SignatureVerifier} ตัวตรวจลายเซ็นของ LINE */
  get signatureVerifier() {
    // ไม่แคชโดยเจตนา — Channel Secret เปลี่ยนได้จากหน้าเว็บ ถ้าแคชไว้ webhook
    // จะยังตรวจด้วยกุญแจเก่าจนกว่าจะรีสตาร์ต แล้วปฏิเสธข้อความจริงทิ้งทั้งหมด
    // การสร้างวัตถุนี้ราคาถูกมาก (เก็บสตริงตัวเดียว) จึงสร้างใหม่ทุกครั้งได้
    return new SignatureVerifier(this.settingsService.effective('LINE_CHANNEL_SECRET'));
  }

  /**
   * บริการตรวจจับ — **จุดที่สลับพฤติกรรมด้วย `.env` เพียงบรรทัดเดียว**
   * @returns {import('../services/detection/DetectionService.js').DetectionService}
   * @throws {ValidationError} เมื่อค่า `DETECTION_DRIVER` ไม่ถูกต้อง
   */
  get detectionService() {
    return this.#resolve('detectionService', () => new ConfiguredDetectionService({
      versionOf: () => this.settingsService.version,
      factory: () => {
        const driver = this.settingsService.effective('DETECTION_DRIVER', 'mock');
        switch (driver) {
          case 'http':
            return new HttpDetectionService({
              apiUrl: this.settingsService.effective('WATER_API_URL'),
              apiKey: this.settingsService.effective('WATER_API_KEY'),
              timeoutMs: this.settingsService.int('DETECTION_TIMEOUT_MS', 30000),
            }, this.#logger);
          case 'mock':
            return new MockDetectionService();
          default:
            throw new ValidationError(`DETECTION_DRIVER ต้องเป็น http หรือ mock (ได้รับ "${driver}")`);
        }
      },
    }));
  }

  /**
   * ช่องทางแจ้งเตือน — สลับด้วย `NOTIFICATION_DRIVER`
   * @returns {import('../services/notification/NotificationChannel.js').NotificationChannel}
   * @throws {ValidationError} เมื่อค่าไม่ถูกต้อง
   */
  get settingsService() {
    return this.#resolve('settingsService', () => new SettingsService({
      settingRepository: this.settingRepository,
      config: this.#config,
      auditService: this.auditService,
      logger: this.#logger,
    }));
  }

  /** @returns {ConfiguredChannel} ช่องทางแจ้งเตือนที่ตามค่าตั้งค่าล่าสุดเสมอ */
  get notificationChannel() {
    return this.#resolve('notificationChannel', () => new ConfiguredChannel({
      versionOf: () => this.settingsService.version,
      factory: () => this.#buildChannels(),
    }));
  }

  /**
   * ประกอบช่องทางแจ้งเตือนจากค่าที่มีผลอยู่ตอนนี้
   * @returns {import('../services/notification/NotificationChannel.js').NotificationChannel}
   */
  #buildChannels() {
    return (() => {
      // รับหลายค่าคั่นด้วยจุลภาค เช่น `line,discord` — หน่วยงานหนึ่งอาจต้องการ
      // ทั้งกลุ่ม LINE ของชาวบ้านและห้อง Discord ของทีมช่างพร้อมกัน
      const drivers = String(this.settingsService.effective('NOTIFICATION_DRIVER', 'console'))
        .split(',')
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean);

      if (!drivers.length) {
        throw new ValidationError('ต้องระบุ NOTIFICATION_DRIVER อย่างน้อยหนึ่งช่องทาง');
      }

      const channels = drivers.map((driver) => this.#buildChannel(driver));
      return channels.length === 1 ? channels[0] : new CompositeChannel(channels, this.#logger);
    })();
  }

  /**
   * สร้างช่องทางแจ้งเตือนหนึ่งตัวตามชื่อไดรเวอร์
   * @param {string} driver ชื่อไดรเวอร์
   * @returns {import('../services/notification/NotificationChannel.js').NotificationChannel}
   * @throws {ValidationError} เมื่อไม่รู้จักไดรเวอร์
   */
  #buildChannel(driver) {
    switch (driver) {
      case 'line':
        return new LineChannel({
          accessToken: this.settingsService.effective('LINE_CHANNEL_ACCESS_TOKEN'),
          defaultGroupId: this.settingsService.effective('LINE_DEFAULT_GROUP_ID'),
        }, this.#logger);
      case 'discord':
        return new DiscordChannel({
          webhookUrl: this.settingsService.effective('DISCORD_WEBHOOK_URL'),
          username: this.settingsService.effective('DISCORD_USERNAME', 'ระบบวัดระดับน้ำ'),
        }, this.#logger);
      case 'telegram':
        return new TelegramChannel({
          botToken: this.settingsService.effective('TELEGRAM_BOT_TOKEN'),
          defaultChatId: this.settingsService.effective('TELEGRAM_CHAT_ID'),
        }, this.#logger);
      case 'console':
        return new ConsoleChannel(this.#logger);
      default:
        throw new ValidationError(
          `NOTIFICATION_DRIVER ต้องเป็น line, discord, telegram หรือ console (ได้รับ "${driver}")`,
        );
    }
  }

  /** @returns {MessageFactory} ตัวประกอบเนื้อหาข้อความแจ้งเตือน */
  get messageBuilder() {
    return this.#resolve('messageBuilder', () => new MessageFactory(this.#config.baseUrl));
  }

  /** @returns {LocalStorageService} ที่เก็บไฟล์ภาพ */
  get storageService() {
    return this.#resolve('storageService',
      () => new LocalStorageService(this.#config.storagePath, this.#logger));
  }

  /** @returns {VariationValidator} ตัวตรวจความผันผวน */
  get variationValidator() {
    return this.#resolve('variationValidator', () => new VariationValidator({
      maxVariationPx: this.settingsService.int('MAX_VARIATION_PX', 50),
      confirmationAttempts: this.settingsService.int('CONFIRMATION_ATTEMPTS', 3),
      confirmationDelayMs: this.settingsService.int('CONFIRMATION_DELAY_SEC', 10) * 1000,
      consistencyThresholdPx: this.settingsService.int('CONSISTENCY_THRESHOLD_PX', 25),
    }));
  }

  // ─────────────────────────── ชั้นธุรกิจ ───────────────────────────

  /** @returns {AuditService} บริการบันทึกการใช้งาน */
  get auditService() {
    return this.#resolve('auditService', () => new AuditService({
      auditRepository: this.auditLogRepository, logger: this.#logger,
    }));
  }

  /** @returns {PermissionService} บริการสิทธิ์ */
  get permissionService() {
    return this.#resolve('permissionService', () => new PermissionService({
      permissionRepository: this.permissionRepository,
      sessionRepository: this.sessionRepository,
      userRepository: this.userRepository,
      cache: this.#cache,
      eventBus: this.#eventBus,
      logger: this.#logger,
    }));
  }

  /** @returns {AuthService} บริการยืนยันตัวตน */
  get authService() {
    return this.#resolve('authService', () => new AuthService({
      userRepository: this.userRepository,
      sessionRepository: this.sessionRepository,
      resetRepository: this.passwordResetRepository,
      primaryHasher: this.primaryHasher,
      hashers: this.hashers,
      policy: this.passwordPolicy,
      auditService: this.auditService,
      loginPolicy: {
        maxAttempts: () => this.settingsService.int('LOGIN_MAX_ATTEMPTS', 5),
        lockMinutes: () => this.settingsService.int('LOGIN_LOCK_MINUTES', 15),
      },
      logger: this.#logger,
    }));
  }

  /** @returns {UserService} บริการผู้ใช้ */
  get userService() {
    return this.#resolve('userService', () => new UserService({
      userRepository: this.userRepository,
      roleRepository: this.roleRepository,
      hasher: this.primaryHasher,
      policy: this.passwordPolicy,
      permissionService: this.permissionService,
      auditService: this.auditService,
      logger: this.#logger,
    }));
  }

  /** @returns {RoleService} บริการบทบาท */
  get roleService() {
    return this.#resolve('roleService', () => new RoleService({
      roleRepository: this.roleRepository,
      permissionService: this.permissionService,
      auditService: this.auditService,
      logger: this.#logger,
    }));
  }

  /** @returns {LicenseService} บริการใบอนุญาต */
  get licenseService() {
    return this.#resolve('licenseService', () => new LicenseService({
      licenseRepository: this.licenseRepository,
      cache: this.#cache,
      keyRegistry: this.keyRegistry,
      logger: this.#logger,
    }));
  }

  /**
   * ทะเบียนคีย์ของผู้ให้บริการ
   *
   * **ไม่มีให้เลือกแหล่งใบอนุญาต** — คีย์บริการตรวจจับ (`WATER_API_KEY`) *คือ*
   * ใบอนุญาตในตัวมันเอง คีย์หมดอายุเมื่อไรบริการตรวจจับก็ปฏิเสธคำขอทันที
   * ระบบจึงทำงานต่อไม่ได้อยู่ดี การเปิดให้เลือก "ใช้ใบอนุญาตในเครื่องแทน"
   * จึงเป็นทางเลือกที่หลอกตัวเองเปล่า ๆ
   *
   * เมื่อยังไม่ได้กรอกคีย์ จะได้ `NullKeyRegistry` ซึ่งแปลว่า "ยังไม่ได้ตั้งค่า"
   * ไม่ใช่ "ไม่ต้องตรวจ" — ระบบจะใช้ใบอนุญาตที่กรอกเองไปพลางจนกว่าจะกรอกคีย์
   *
   * @returns {import('../services/license/KeyRegistry.js').KeyRegistry}
   */
  get keyRegistry() {
    return this.#resolve('keyRegistry', () => new ConfiguredKeyRegistry({
      versionOf: () => this.settingsService.version,
      factory: () => {
        const apiUrl = this.settingsService.effective('WATER_API_URL');
        const apiKey = this.settingsService.effective('WATER_API_KEY');
        return apiUrl && apiKey
          ? new HttpKeyRegistry({ apiUrl, apiKey }, this.#logger)
          : new NullKeyRegistry();
      },
    }));
  }

  /** @returns {StationService} บริการจุดวัด */
  get stationService() {
    return this.#resolve('stationService', () => new StationService({
      stationRepository: this.stationRepository,
      calibrationRepository: this.calibrationRepository,
      roiRepository: this.roiRepository,
      permissionService: this.permissionService,
      auditService: this.auditService,
      // อ่านจาก `.env` ไม่ใช่ฐานข้อมูล — ด่านกัน SSRF ต้องไม่ถูกปิดจากฟอร์มเว็บ
      // (ดูเหตุผลเต็มใน JSDoc ของ EDITABLE ใน SettingsService)
      allowPrivateCameraUrl: this.#config.bool('ALLOW_PRIVATE_CAMERA_URL', false),
      logger: this.#logger,
    }));
  }

  /** @returns {CalibrationService} บริการเทียบค่า */
  get calibrationService() {
    return this.#resolve('calibrationService', () => new CalibrationService({
      calibrationRepository: this.calibrationRepository,
      permissionService: this.permissionService,
      auditService: this.auditService,
      cache: this.#cache,
      measurementRepository: this.measurementRepository,
      logger: this.#logger,
    }));
  }

  /** @returns {RoiService} บริการ ROI */
  get roiService() {
    return this.#resolve('roiService', () => new RoiService({
      roiRepository: this.roiRepository,
      stationRepository: this.stationRepository,
      permissionService: this.permissionService,
      auditService: this.auditService,
      cache: this.#cache,
      calibrationService: this.calibrationService,
      logger: this.#logger,
    }));
  }

  /** @returns {CameraProxyService} บริการตัวกลางระหว่างเบราว์เซอร์กับกล้อง IP */
  get cameraProxyService() {
    return this.#resolve('cameraProxyService', () => new CameraProxyService({
      stationRepository: this.stationRepository,
      logger: this.#logger,
    }));
  }

  /** @returns {CameraController} ตัวควบคุมภาพจากกล้อง */
  get cameraController() {
    return this.#resolve('cameraController', () => new CameraController({
      cameraProxy: this.cameraProxyService,
      stationService: this.stationService,
      logger: this.#logger,
    }));
  }

  /** @returns {ForecastService} บริการพยากรณ์แนวโน้มระดับน้ำ */
  get forecastService() {
    return this.#resolve('forecastService', () => new ForecastService());
  }

  /** @returns {MeasurementService} บริการค่าวัด */
  get measurementService() {
    return this.#resolve('measurementService', () => new MeasurementService({
      measurementRepository: this.measurementRepository,
      validationLogRepository: this.validationLogRepository,
      alertStateRepository: this.alertStateRepository,
      calibrationService: this.calibrationService,
      roiService: this.roiService,
      permissionService: this.permissionService,
      eventBus: this.#eventBus,
      forecastService: this.forecastService,
      logger: this.#logger,
    }));
  }

  /** @returns {AlertService} บริการแจ้งเตือน */
  get alertService() {
    return this.#resolve('alertService', () => new AlertService({
      alertStateRepository: this.alertStateRepository,
      broadcastLogRepository: this.broadcastLogRepository,
      stationRepository: this.stationRepository,
      lineRepository: this.lineRepository,
      channel: this.notificationChannel,
      messageBuilder: this.messageBuilder,
      permissionService: this.permissionService,
      eventBus: this.#eventBus,
      baseUrl: this.#config.baseUrl,
      logger: this.#logger,
    }));
  }

  /** @returns {ReportService} บริการรายงาน */
  get reportService() {
    return this.#resolve('reportService', () => new ReportService({
      dailyReportRepository: this.dailyReportRepository,
      reportLogRepository: this.reportLogRepository,
      stationRepository: this.stationRepository,
      measurementService: this.measurementService,
      channel: this.notificationChannel,
      messageBuilder: this.messageBuilder,
      permissionService: this.permissionService,
      baseUrl: this.#config.baseUrl,
      logger: this.#logger,
    }));
  }

  /** @returns {CommandHandler} ตัวจัดการคำสั่งแชท */
  get commandHandler() {
    return this.#resolve('commandHandler', () => new CommandHandler({
      stationRepository: this.stationRepository,
      messageBuilder: this.messageBuilder,
    }));
  }

  /** @returns {LineService} บริการ LINE */
  get lineService() {
    return this.#resolve('lineService', () => new LineService({
      lineRepository: this.lineRepository,
      channel: this.notificationChannel,
      commandHandler: this.commandHandler,
      logger: this.#logger,
    }));
  }

  /**
   * บริการอีเมล — ใช้ Mailjet เมื่อกรอกกุญแจครบ มิฉะนั้นพิมพ์ลงคอนโซล
   *
   * ไม่มีตัวเลือกไดรเวอร์ให้ตั้ง เพราะมีทางเดียวที่ส่งจริงได้ — กรอกกุญแจก็ส่ง
   * ไม่กรอกก็ไม่ส่ง การเพิ่มสวิตช์ `MAIL_DRIVER` จึงมีแต่จะสร้างสถานะที่ขัดกันเอง
   * (เลือก mailjet ไว้แต่ไม่มีกุญแจ)
   *
   * @returns {MailService}
   */
  get mailService() {
    return this.#resolve('mailService', () => new ConfiguredMailService({
      versionOf: () => this.settingsService.version,
      factory: () => {
        const apiKey = this.settingsService.effective('MAILJET_API_KEY');
        const secretKey = this.settingsService.effective('MAILJET_SECRET_KEY');
        const fromEmail = this.settingsService.effective('MAIL_FROM', 'noreply@example.go.th');

        if (!apiKey || !secretKey) {
          return new ConsoleMailService({ isProduction: this.#config.isProduction }, this.#logger);
        }
        return new MailjetMailService({
          apiKey,
          secretKey,
          fromEmail,
          fromName: this.settingsService.effective('MAIL_FROM_NAME', 'ระบบวัดระดับน้ำอัตโนมัติ'),
        }, this.#logger);
      },
    }));
  }

  // ─────────────────────────── ด่านตรวจ ───────────────────────────

  /** @returns {LicenseMiddleware} ด่านที่ 1 */
  get licenseMiddleware() {
    return this.#resolve('licenseMiddleware',
      () => new LicenseMiddleware(this.licenseService, this.#logger));
  }

  /** @returns {AuthMiddleware} ด่านที่ 2 */
  get authMiddleware() {
    return this.#resolve('authMiddleware',
      () => new AuthMiddleware(this.authService, this.#logger));
  }

  /** @returns {PermissionMiddleware} ด่านที่ 3 */
  get permissionMiddleware() {
    return this.#resolve('permissionMiddleware',
      () => new PermissionMiddleware(this.permissionService, this.#logger));
  }

  /** @returns {StationScopeMiddleware} ด่านที่ 4 */
  get stationScopeMiddleware() {
    return this.#resolve('stationScopeMiddleware',
      () => new StationScopeMiddleware(this.permissionService, this.#logger));
  }

  /** @returns {CsrfMiddleware} ด่านตรวจ CSRF */
  get csrfMiddleware() {
    return this.#resolve('csrfMiddleware',
      () => new CsrfMiddleware(this.csrfProtection, this.#logger));
  }

  /** @returns {ErrorMiddleware} ตัวจัดการข้อผิดพลาดรวม */
  get errorMiddleware() {
    return this.#resolve('errorMiddleware',
      () => new ErrorMiddleware(this.#config.isProduction, this.#logger));
  }

  /** @returns {MySqlSessionStore} ที่เก็บ session */
  get sessionStore() {
    return this.#resolve('sessionStore',
      () => new MySqlSessionStore(this.sessionRepository, {}, this.#logger));
  }

  // ─────────────────────────── งานตามเวลา ───────────────────────────

  /** @returns {DetectJob} งานตรวจวัดระดับน้ำ */
  get detectJob() {
    return this.#resolve('detectJob', () => new DetectJob({
      stationService: this.stationService,
      measurementService: this.measurementService,
      roiService: this.roiService,
      detectionService: this.detectionService,
      variationValidator: this.variationValidator,
      storageService: this.storageService,
      schedule: this.settingsService.effective('SCHEDULE_DETECT', '*/5 * * * *'),
      logger: this.#logger,
    }));
  }

  /** @returns {AlertJob} งานแจ้งเตือน (ขับเคลื่อนด้วยเหตุการณ์) */
  get alertJob() {
    return this.#resolve('alertJob', () => new AlertJob({
      alertService: this.alertService,
      eventBus: this.#eventBus,
      logger: this.#logger,
    }));
  }

  /** @returns {DailyReportJob} งานรายงานประจำวัน */
  get dailyReportJob() {
    return this.#resolve('dailyReportJob', () => new DailyReportJob({
      reportService: this.reportService,
      schedule: this.settingsService.effective('SCHEDULE_DAILY_REPORT', '0 18 * * *'),
      logger: this.#logger,
    }));
  }

  /** @returns {RetentionJob} งานลบข้อมูลเก่า */
  get retentionJob() {
    return this.#resolve('retentionJob', () => new RetentionJob({
      measurementRepository: this.measurementRepository,
      captureRepository: this.captureRepository,
      sessionRepository: this.sessionRepository,
      resetRepository: this.passwordResetRepository,
      storageService: this.storageService,
      retentionDays: this.settingsService.int('IMAGE_RETENTION_DAYS', 90),
      schedule: this.settingsService.effective('SCHEDULE_RETENTION', '0 3 * * *'),
      logger: this.#logger,
    }));
  }

  /** @returns {HealthCheckJob} งานตรวจสุขภาพระบบ */
  get healthCheckJob() {
    return this.#resolve('healthCheckJob', () => new HealthCheckJob({
      measurementRepository: this.measurementRepository,
      detectionService: this.detectionService,
      eventBus: this.#eventBus,
      schedule: this.settingsService.effective('SCHEDULE_HEALTH_CHECK', '*/15 * * * *'),
      staleMinutes: Number(this.settingsService.effective('HEALTH_STALE_MINUTES', '30')),
      logger: this.#logger,
    }));
  }

  /** @returns {LicenseSyncJob} งานซิงก์ใบอนุญาตกับทะเบียนคีย์ */
  get licenseSyncJob() {
    return this.#resolve('licenseSyncJob', () => new LicenseSyncJob({
      licenseService: this.licenseService,
      schedule: this.settingsService.effective('SCHEDULE_LICENSE_SYNC', '7 */6 * * *'),
      logger: this.#logger,
    }));
  }

  /**
   * ตัวจับเวลาพร้อมงานทั้งหมดที่ลงทะเบียนแล้ว
   * @returns {Scheduler}
   */
  get scheduler() {
    return this.#resolve('scheduler', () => {
      const scheduler = new Scheduler(this.#logger);
      scheduler.registerAll([
        this.detectJob,
        this.alertJob.subscribe(),
        this.dailyReportJob,
        this.retentionJob,
        this.healthCheckJob,
        this.licenseSyncJob,
      ]);
      return scheduler;
    });
  }

  // ─────────────────────────── ชั้นนำเสนอ ───────────────────────────

  /** @returns {AuthController} ควบคุมการเข้าสู่ระบบ */
  get authController() {
    return this.#resolve('authController', () => new AuthController({
      authService: this.authService,
      mailService: this.mailService,
      csrf: this.csrfProtection,
      baseUrl: this.#config.baseUrl,
      logger: this.#logger,
    }));
  }

  /** @returns {DashboardController} ควบคุมหน้าภาพรวม */
  get dashboardController() {
    return this.#resolve('dashboardController', () => new DashboardController({
      stationService: this.stationService,
      alertService: this.alertService,
      licenseService: this.licenseService,
      scheduler: this.scheduler,
      detectionService: this.detectionService,
      channel: this.notificationChannel,
      mailService: this.mailService,
      validationLogRepository: this.validationLogRepository,
      settingsService: this.settingsService,
      container: this,
      logger: this.#logger,
    }));
  }

  /** @returns {StationController} ควบคุมหน้าจุดวัด */
  get stationController() {
    return this.#resolve('stationController', () => new StationController({
      stationService: this.stationService,
      calibrationService: this.calibrationService,
      roiService: this.roiService,
      lineService: this.lineService,
      logger: this.#logger,
    }));
  }

  /** @returns {RoiController} ควบคุมเครื่องมือวาด ROI */
  get roiController() {
    return this.#resolve('roiController', () => new RoiController({
      roiService: this.roiService,
      stationService: this.stationService,
      calibrationService: this.calibrationService,
      logger: this.#logger,
    }));
  }

  /** @returns {CalibrationController} ควบคุมหน้าจุดเทียบค่า */
  get calibrationController() {
    return this.#resolve('calibrationController', () => new CalibrationController({
      calibrationService: this.calibrationService,
      stationService: this.stationService,
      logger: this.#logger,
    }));
  }

  /** @returns {MeasurementController} ควบคุมหน้าค่าวัด */
  get measurementController() {
    return this.#resolve('measurementController', () => new MeasurementController({
      measurementService: this.measurementService,
      stationService: this.stationService,
      detectJob: this.detectJob,
      logger: this.#logger,
    }));
  }

  /** @returns {AlertController} ควบคุมหน้าการแจ้งเตือน */
  get alertController() {
    return this.#resolve('alertController', () => new AlertController({
      alertService: this.alertService,
      stationService: this.stationService,
      measurementService: this.measurementService,
      logger: this.#logger,
    }));
  }

  /** @returns {ReportController} ควบคุมหน้ารายงาน */
  get reportController() {
    return this.#resolve('reportController', () => new ReportController({
      reportService: this.reportService,
      stationService: this.stationService,
      logger: this.#logger,
    }));
  }

  /** @returns {UserController} ควบคุมหน้าผู้ใช้ */
  get userController() {
    return this.#resolve('userController', () => new UserController({
      userService: this.userService,
      authService: this.authService,
      stationService: this.stationService,
      logger: this.#logger,
    }));
  }

  /** @returns {RoleController} ควบคุมหน้าบทบาท */
  get roleController() {
    return this.#resolve('roleController', () => new RoleController({
      roleService: this.roleService,
      logger: this.#logger,
    }));
  }

  /** @returns {AuditController} ควบคุมหน้าบันทึกการใช้งาน */
  get auditController() {
    return this.#resolve('auditController', () => new AuditController({
      auditService: this.auditService,
      logger: this.#logger,
    }));
  }

  /** @returns {LicenseController} ควบคุมหน้าใบอนุญาต */
  get licenseController() {
    return this.#resolve('licenseController', () => new LicenseController({
      licenseService: this.licenseService,
      auditService: this.auditService,
      logger: this.#logger,
    }));
  }

  /** @returns {LineController} ควบคุมหน้ากลุ่ม LINE */
  get lineController() {
    return this.#resolve('lineController', () => new LineController({
      lineService: this.lineService,
      alertService: this.alertService,
      logger: this.#logger,
    }));
  }

  /** @returns {LineWebhookController} ควบคุม webhook ของ LINE */
  get lineWebhookController() {
    return this.#resolve('lineWebhookController', () => new LineWebhookController({
      lineService: this.lineService,
      verifier: this.signatureVerifier,
      logger: this.#logger,
    }));
  }

  /** @returns {PublicController} ควบคุมหน้าสาธารณะ */
  get publicController() {
    return this.#resolve('publicController', () => new PublicController({
      stationService: this.stationService,
      measurementService: this.measurementService,
      reportService: this.reportService,
      roiService: this.roiService,
      calibrationService: this.calibrationService,
      baseUrl: this.#config.baseUrl,
      logger: this.#logger,
    }));
  }
}
