import { BaseController } from '../core/BaseController.js';
import { SettingsService } from '../services/SettingsService.js';
import { ZoneLevel } from '../models/values/ZoneLevel.js';

/**
 * ควบคุมหน้าภาพรวมของผู้ดูแล (`/admin`) และหน้าตั้งค่าระบบ
 *
 * เข้าถึงได้เพียงแค่เข้าสู่ระบบแล้ว ไม่ต้องมีสิทธิ์เฉพาะ แต่เนื้อหาที่แสดง
 * ถูกจำกัดตามขอบเขตจุดวัดและสิทธิ์ของผู้ใช้แต่ละคน
 */
export class DashboardController extends BaseController {
  /** @type {import('../services/StationService.js').StationService} */
  #stationService;
  /** @type {import('../services/AlertService.js').AlertService} */
  #alertService;
  /** @type {import('../services/LicenseService.js').LicenseService} */
  #licenseService;
  /** @type {import('../jobs/Scheduler.js').Scheduler} */
  #scheduler;
  /** @type {import('../services/detection/DetectionService.js').DetectionService} */
  #detectionService;
  /** @type {import('../services/notification/NotificationChannel.js').NotificationChannel} */
  #channel;
  /** @type {import('../services/MailService.js').MailService} */
  #mailService;
  /** @type {import('../repositories/ValidationLogRepository.js').ValidationLogRepository} */
  #validationLogRepository;
  /** @type {import('../services/SettingsService.js').SettingsService} */
  #settingsService;
  /** @type {import('../core/ServiceContainer.js').ServiceContainer} */
  #container;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../services/StationService.js').StationService} deps.stationService บริการจุดวัด
   * @param {import('../services/AlertService.js').AlertService} deps.alertService บริการแจ้งเตือน
   * @param {import('../services/LicenseService.js').LicenseService} deps.licenseService บริการใบอนุญาต
   * @param {import('../jobs/Scheduler.js').Scheduler} deps.scheduler ตัวจับเวลา
   * @param {import('../services/detection/DetectionService.js').DetectionService} deps.detectionService บริการตรวจจับ
   * @param {import('../services/notification/NotificationChannel.js').NotificationChannel} deps.channel ช่องทางแจ้งเตือน
   * @param {import('../services/MailService.js').MailService} deps.mailService บริการอีเมล
   * @param {import('../repositories/ValidationLogRepository.js').ValidationLogRepository} deps.validationLogRepository ที่เก็บบันทึกการตรวจความผันผวน
   * @param {import('../core/Logger.js').Logger} [deps.logger] ตัวบันทึกเหตุการณ์
   */
  constructor({
    stationService, alertService, licenseService, scheduler,
    detectionService, channel, mailService, validationLogRepository, settingsService,
    container, logger,
  }) {
    super(stationService, logger);
    this.#stationService = stationService;
    this.#alertService = alertService;
    this.#licenseService = licenseService;
    this.#scheduler = scheduler;
    this.#detectionService = detectionService;
    this.#channel = channel;
    this.#mailService = mailService;
    this.#validationLogRepository = validationLogRepository;
    this.#settingsService = settingsService;
    this.#container = container;
  }

  /**
   * หน้าภาพรวม — จุดวัดทุกแห่ง การเตือนล่าสุด และสถานะงานตามเวลา
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async index(req, res) {
    const [rows, alerts, license, validation] = await Promise.all([
      this.#stationService.overview(req.user),
      this.#alertService.history(req.user, { limit: 10, offset: 0 }),
      this.#licenseService.current(),
      this.#validationLogRepository.summary(7),
    ]);

    const stations = rows.map(({ station, latest }) => ({
      ...station.toJSON(),
      latest: latest ? {
        ...latest,
        zone: ZoneLevel.fromKey(latest.zoneKey)?.toJSON() ?? null,
        ageMinutes: latest.measuredAt
          ? Math.floor((Date.now() - new Date(latest.measuredAt).getTime()) / 60000)
          : null,
      } : null,
    }));

    res.render('admin/dashboard', {
      title: 'ภาพรวมระบบ',
      stations,
      alerts: alerts.items.map((item) => item.toJSON()),
      jobs: this.#currentScheduler.status(),
      license: license?.toJSON() ?? null,
      validation,
      counts: {
        stations: stations.length,
        active: stations.filter((station) => station.isActive).length,
        stale: stations.filter((station) => station.latest?.ageMinutes === null
          || (station.latest?.ageMinutes ?? Infinity) > 30).length,
        critical: stations.filter((station) => (station.latest?.zone?.severity ?? 99) <= 2).length,
      },
    });
  }

  /**
   * หน้าตั้งค่าระบบ (สิทธิ์ `setting.read`)
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async settings(req, res) {
    const license = await this.#licenseService.current();
    const groups = SettingsService.groups;
    const settings = this.#settingsService.forDisplay();

    // แท็บที่ไม่รู้จักถอยไปแท็บแรกเสมอ — ผู้ใช้แก้ query string มั่ว ๆ ต้องไม่เจอหน้าว่าง
    const requested = String(req.query.tab ?? '');
    const tab = requested === 'status' || groups.some((group) => group.key === requested)
      ? requested
      : groups[0].key;

    res.render('admin/settings', {
      title: 'ตั้งค่าระบบ',
      license: license?.toJSON() ?? null,
      registry: this.#licenseService.registryStatus(),
      canManageLicense: req.user.can('license.manage'),
      drivers: {
        detection: this.#detectionService.driver,
        notification: this.#channel.channel,
        mail: this.#mailService.isConfigured ? 'smtp' : 'console',
      },
      jobs: this.#currentScheduler.status(),
      canManage: req.user.can('setting.manage'),
      settings,
      groups: groups.map((group) => ({
        ...group,
        count: settings.filter((item) => item.group === group.key).length,
        fromDatabase: settings
          .filter((item) => item.group === group.key && item.source === 'database').length,
      })),
      tab,
      driverOptions: SettingsService.drivers,
      activeDrivers: this.#settingsService.effective('NOTIFICATION_DRIVER', 'console')
        .split(',').map((item) => item.trim()).filter(Boolean),
      saved: req.query.saved === '1',
      synced: req.query.synced ?? null,
    });
  }

  /**
   * ตัวจับเวลาที่ใช้อยู่จริงตอนนี้
   *
   * ⚠️ ห้ามใช้ `#scheduler` ที่ฉีดเข้ามาตอนสร้างวัตถุ — เมื่อผู้ดูแลแก้ตารางเวลา
   * ระบบจะทิ้งตัวเก่าแล้วประกอบใหม่ อ้างอิงเดิมจะชี้ไปยังตัวที่หยุดไปแล้ว
   * ทำให้หน้าสถานะรายงานว่า "ไม่ได้ตั้งเวลา" ทั้งที่งานทำงานอยู่
   *
   * @returns {import('../jobs/Scheduler.js').Scheduler}
   */
  get #currentScheduler() { return this.#container?.scheduler ?? this.#scheduler; }

  /**
   * บันทึกค่าตั้งค่าช่องทางแจ้งเตือน (สิทธิ์ `setting.manage`)
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async saveSettings(req, res) {
    const body = req.body ?? {};
    const clearKeys = body.clearKeys
      ? (Array.isArray(body.clearKeys) ? body.clearKeys : [body.clearKeys])
      : [];

    const result = await this.#settingsService.save(body, {
      actor: req.user,
      clearKeys,
      ip: req.ip,
      userAgent: req.get?.('user-agent') ?? null,
    });

    // ตารางเวลาผูกกับ task ของ node-cron ตั้งแต่ตอนสร้าง แก้ค่าเฉย ๆ ไม่มีผล
    // ต้องสั่งตั้งเวลาใหม่ ต่างจากค่าช่องทางแจ้งเตือนที่ `ConfiguredChannel` ดูแลเอง
    //
    // ค่าในกลุ่ม "การวัด" ก็ต้องตั้งใหม่เหมือนกัน เพราะ `DetectJob` และ `RetentionJob`
    // รับเกณฑ์เข้ามาทาง constructor — ไม่ได้อ่านสดทุกรอบเหมือนบริการตรวจจับ
    const rebuildKeys = new Set([
      'HEALTH_STALE_MINUTES', 'MAX_VARIATION_PX', 'CONFIRMATION_ATTEMPTS',
      'CONFIRMATION_DELAY_SEC', 'CONSISTENCY_THRESHOLD_PX', 'IMAGE_RETENTION_DAYS',
    ]);
    const touchedSchedule = [...result.saved, ...result.cleared]
      .some((key) => key.startsWith('SCHEDULE_') || rebuildKeys.has(key));
    if (touchedSchedule) {
      const status = this.#container.restartScheduler();
      this.logger.info('scheduler restarted after settings change', status);
    }

    const tab = String(body.tab ?? '').replace(/[^a-z]/g, '');
    res.redirect(`/admin/settings?saved=1${tab ? `&tab=${tab}` : ''}`);
  }

  /**
   * API: ทดสอบการเชื่อมต่อบริการภายนอกทั้งหมด (สิทธิ์ `setting.read`)
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async testConnections(req, res) {
    const [detection, notification, mail] = await Promise.all([
      this.#detectionService.healthCheck(),
      this.#channel.healthCheck(),
      this.#mailService.healthCheck(),
    ]);
    this.ok(res, { detection, notification, mail });
  }

  /**
   * API: สถานะงานตามเวลา
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async jobStatus(req, res) {
    this.ok(res, this.#currentScheduler.status());
  }
}
