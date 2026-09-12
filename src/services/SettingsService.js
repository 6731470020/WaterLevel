import { BaseService } from '../core/BaseService.js';
import cron from 'node-cron';
import { ValidationError } from '../core/errors/index.js';

/**
 * ค่าที่แก้ได้จากหน้าผู้ดูแล — เป็นรายการปิด ไม่รับคีย์อื่นเด็ดขาด
 *
 * ถ้าเปิดให้ตั้งคีย์อะไรก็ได้ ผู้ที่มีสิทธิ์ `setting.manage` จะเขียนทับค่าอย่าง
 * `DB_PASSWORD` หรือ `SESSION_SECRET` ได้ ซึ่งเกินขอบเขตที่สิทธิ์นี้ควรทำได้มาก
 *
 * ⚠️ `ALLOW_PRIVATE_CAMERA_URL` จงใจ**ไม่อยู่ในรายการนี้** — เป็นด่านกัน SSRF
 * ที่ปิดได้ก็เท่ากับเปิดทางให้ยิงคำขอเข้าเครือข่ายภายในผ่าน URL กล้อง
 * สวิตช์แบบนั้นไม่ควรอยู่ในฟอร์มเว็บที่กดพลาดได้ ใครต้องใช้กล้องในวงแลนจริง ๆ
 * ให้แก้ `.env` บนเซิร์ฟเวอร์ ซึ่งเป็นการกระทำที่ตั้งใจและมีร่องรอยชัดเจนกว่า
 */
const EDITABLE = Object.freeze({
  NOTIFICATION_DRIVER: {
    label: 'ช่องทางแจ้งเตือน',
    type: 'drivers',
    secret: false,
    hint: 'เลือกได้หลายช่องทางพร้อมกัน · ไม่เลือกเลยจะใช้ console (ไม่ส่งจริง)',
  },
  LINE_CHANNEL_ACCESS_TOKEN: { label: 'LINE Channel Access Token', type: 'text', secret: true },
  LINE_CHANNEL_SECRET: { label: 'LINE Channel Secret', type: 'text', secret: true },
  LINE_DEFAULT_GROUP_ID: {
    label: 'รหัสกลุ่ม LINE ปลายทาง', type: 'text', secret: false,
    hint: 'พิมพ์ "กลุ่ม" ในแชทเพื่อให้บอทบอกรหัสกลุ่ม',
  },
  DISCORD_WEBHOOK_URL: {
    label: 'Discord Webhook URL', type: 'url', secret: true,
    hint: 'ตั้งค่าช่อง → Integrations → Webhooks → คัดลอก URL',
  },
  DISCORD_USERNAME: { label: 'ชื่อผู้ส่งใน Discord', type: 'text', secret: false },
  TELEGRAM_BOT_TOKEN: {
    label: 'Telegram Bot Token', type: 'text', secret: true,
    hint: 'ขอจาก @BotFather',
  },
  TELEGRAM_CHAT_ID: {
    label: 'Telegram Chat ID', type: 'text', secret: false,
    hint: 'ดูได้จาก https://api.telegram.org/bot<TOKEN>/getUpdates',
  },

  // ── ตารางเวลาของงานอัตโนมัติ ──
  SCHEDULE_DETECT: {
    label: 'ตรวจวัดระดับน้ำ', type: 'cron', secret: false, group: 'schedule',
    default: '*/5 * * * *', hint: 'ค่าเริ่มต้น */5 * * * * (ทุก 5 นาที)',
  },
  SCHEDULE_DAILY_REPORT: {
    label: 'รายงานประจำวัน', type: 'cron', secret: false, group: 'schedule',
    default: '0 18 * * *', hint: 'ค่าเริ่มต้น 0 18 * * * (ทุกวัน 18:00 น.)',
  },
  SCHEDULE_RETENTION: {
    label: 'ลบข้อมูลเก่าตามนโยบาย', type: 'cron', secret: false, group: 'schedule',
    default: '0 3 * * *', hint: 'ค่าเริ่มต้น 0 3 * * * (ทุกวัน 03:00 น.)',
  },
  SCHEDULE_HEALTH_CHECK: {
    label: 'ตรวจสุขภาพระบบ', type: 'cron', secret: false, group: 'schedule',
    default: '*/15 * * * *', hint: 'ค่าเริ่มต้น */15 * * * * (ทุก 15 นาที)',
  },
  SCHEDULE_LICENSE_SYNC: {
    label: 'ซิงก์ใบอนุญาตกับทะเบียนคีย์', type: 'cron', secret: false, group: 'schedule',
    default: '7 */6 * * *', hint: 'ค่าเริ่มต้น 7 */6 * * * (ทุก 6 ชั่วโมง)',
  },
  HEALTH_STALE_MINUTES: {
    label: 'แจ้งเตือนเมื่อจุดวัดเงียบเกิน (นาที)', type: 'integer', secret: false,
    group: 'schedule', default: '30', min: 5, max: 1440,
  },

  // ── บริการตรวจจับด้วย AI ──
  DETECTION_DRIVER: {
    label: 'ไดรเวอร์ตรวจจับ', type: 'select', secret: false, group: 'detection',
    default: 'mock',
    options: [
      { value: 'mock', label: 'mock — ข้อมูลจำลอง (ไม่เรียกบริการภายนอก)' },
      { value: 'http', label: 'http — เรียก API ตรวจจับจริง' },
    ],
    hint: 'สลับได้ทันทีโดยไม่ต้องรีสตาร์ต',
  },
  WATER_API_URL: {
    label: 'URL บริการตรวจจับ', type: 'url', secret: false, group: 'detection',
    hint: 'เช่น https://apiwater.example.com — ไม่ต้องใส่ /detect ต่อท้าย',
  },
  WATER_API_KEY: {
    label: 'API Key บริการตรวจจับ', type: 'text', secret: true, group: 'detection',
    hint: 'คีย์ที่ผู้ให้บริการออกให้ — หมดอายุเมื่อไรระบบตรวจจับหยุดทำงานทันที',
  },
  DETECTION_TIMEOUT_MS: {
    label: 'หมดเวลารอผลตรวจจับ (มิลลิวินาที)', type: 'integer', secret: false,
    group: 'detection', default: '30000', min: 1000, max: 300000,
  },
  // ── การวัดและการเก็บข้อมูล ──
  MAX_VARIATION_PX: {
    label: 'ค่าผันผวนสูงสุดที่ยอมรับ (พิกเซล)', type: 'integer', secret: false,
    group: 'measurement', default: '50', min: 1, max: 1000,
    hint: 'ต่างจากค่าเฉลี่ยเกินนี้จะเข้าโหมดยืนยันก่อนบันทึก',
  },
  CONFIRMATION_ATTEMPTS: {
    label: 'จำนวนครั้งที่วัดซ้ำตอนยืนยัน', type: 'integer', secret: false,
    group: 'measurement', default: '3', min: 1, max: 10,
  },
  CONFIRMATION_DELAY_SEC: {
    label: 'เว้นระยะระหว่างการวัดซ้ำ (วินาที)', type: 'integer', secret: false,
    group: 'measurement', default: '10', min: 1, max: 120,
  },
  CONSISTENCY_THRESHOLD_PX: {
    label: 'ค่ากระจายสูงสุดตอนยืนยัน (พิกเซล)', type: 'integer', secret: false,
    group: 'measurement', default: '25', min: 1, max: 500,
    hint: 'วัดซ้ำแล้ว max − min ไม่เกินนี้จึงใช้ค่าเฉลี่ยบันทึก',
  },
  IMAGE_RETENTION_DAYS: {
    label: 'เก็บภาพย้อนหลัง (วัน)', type: 'integer', secret: false,
    group: 'measurement', default: '90', min: 1, max: 3650,
    hint: 'ภาพที่เก่ากว่านี้ถูกลบโดยงานลบข้อมูลเก่า (PDPA)',
  },

  // ── ความปลอดภัยการเข้าสู่ระบบ ──
  PASSWORD_MIN_LENGTH: {
    label: 'ความยาวรหัสผ่านขั้นต่ำ', type: 'integer', secret: false,
    group: 'security', default: '10', min: 8, max: 128,
    hint: 'มีผลกับการตั้งรหัสผ่านครั้งถัดไป ไม่บังคับผู้ใช้เดิมย้อนหลัง',
  },
  LOGIN_MAX_ATTEMPTS: {
    label: 'ใส่รหัสผิดได้กี่ครั้งก่อนล็อก', type: 'integer', secret: false,
    group: 'security', default: '5', min: 1, max: 50,
  },
  LOGIN_LOCK_MINUTES: {
    label: 'ล็อกบัญชีนานกี่นาที', type: 'integer', secret: false,
    group: 'security', default: '15', min: 1, max: 1440,
  },
  SESSION_MAX_AGE_HOURS: {
    label: 'อายุ session สูงสุด (ชั่วโมง)', type: 'integer', secret: false,
    group: 'security', default: '8', min: 1, max: 720,
    hint: 'นับจากเข้าสู่ระบบ ต่ออายุอัตโนมัติเมื่อมีกิจกรรม',
  },
  SESSION_IDLE_TIMEOUT_HOURS: {
    label: 'ออกจากระบบเมื่อไม่ใช้งานนาน (ชั่วโมง)', type: 'integer', secret: false,
    group: 'security', default: '2', min: 1, max: 720,
    hint: 'แยกจากอายุรวม — เงียบเกินนี้ถือว่าหมดอายุแม้ยังไม่ครบอายุรวม',
  },

  // ── อีเมล (ลืมรหัสผ่าน) — ส่งผ่าน Mailjet Send API ──
  MAILJET_API_KEY: {
    label: 'Mailjet API Key', type: 'text', secret: true, group: 'mail',
    hint: 'ดูที่ Mailjet → Account Settings → API Key Management',
  },
  MAILJET_SECRET_KEY: {
    label: 'Mailjet Secret Key', type: 'text', secret: true, group: 'mail',
    hint: 'คู่กับ API Key ด้านบน · เว้นทั้งคู่ไว้ = ไม่ส่งอีเมลจริง',
  },
  MAIL_FROM: {
    label: 'อีเมลผู้ส่ง', type: 'text', secret: false, group: 'mail',
    default: 'noreply@example.go.th',
    hint: '⚠️ ต้องเป็นอีเมลหรือโดเมนที่ยืนยันกับ Mailjet แล้ว มิฉะนั้นจะถูกปฏิเสธทุกฉบับ',
  },
  MAIL_FROM_NAME: {
    label: 'ชื่อผู้ส่งที่แสดงในกล่องจดหมาย', type: 'text', secret: false, group: 'mail',
    default: 'ระบบวัดระดับน้ำอัตโนมัติ',
  },
});

/**
 * กลุ่มของค่าตั้งค่า — คุมทั้งลำดับแท็บบนหน้าเว็บและการจัดหมวดใน `forDisplay()`
 *
 * เก็บไว้ที่เดียวกับ `EDITABLE` เพื่อให้เพิ่มค่าใหม่แล้วหน้าเว็บขึ้นเองโดยไม่ต้อง
 * ตามแก้ EJS — หน้าตั้งค่าวนจากรายการนี้ล้วน ๆ
 */
const GROUPS = Object.freeze([
  {
    key: 'notification',
    label: 'ช่องทางแจ้งเตือน',
    icon: '🔔',
    description: 'เลือกช่องทางและใส่โทเคนสำหรับส่งข้อความเตือนภัย',
  },
  {
    key: 'detection',
    label: 'บริการตรวจจับ',
    icon: '🤖',
    description: 'ปลายทาง API ที่ใช้อ่านระดับน้ำจากภาพ — คีย์นี้เป็นตัวกำหนดวันหมดอายุของระบบด้วย',
  },
  {
    key: 'measurement',
    label: 'การวัดและข้อมูล',
    icon: '📐',
    description: 'เกณฑ์ความผันผวน การยืนยันค่า และอายุการเก็บภาพตาม PDPA',
  },
  {
    key: 'schedule',
    label: 'ตารางเวลา',
    icon: '⏱',
    description: 'นิพจน์ cron ของงานอัตโนมัติทุกตัว (เวลาไทย)',
  },
  {
    key: 'security',
    label: 'ความปลอดภัย',
    icon: '🔐',
    description: 'นโยบายรหัสผ่านและการล็อกบัญชีเมื่อใส่รหัสผิดซ้ำ',
  },
  {
    key: 'mail',
    label: 'อีเมล',
    icon: '✉️',
    description: 'กุญแจ Mailjet สำหรับส่งลิงก์ตั้งรหัสผ่านใหม่',
  },
]);

/** ช่องทางที่เลือกได้ */
const DRIVERS = Object.freeze([
  { key: 'line', label: 'LINE' },
  { key: 'discord', label: 'Discord' },
  { key: 'telegram', label: 'Telegram' },
  { key: 'console', label: 'คอนโซล (ไม่ส่งจริง)' },
]);

/**
 * จัดการค่าตั้งค่าที่แก้ได้จากหน้าเว็บ
 *
 * **ลำดับความสำคัญ:** ค่าที่ตั้งผ่านหน้าเว็บชนะค่าใน `.env` เสมอ ส่วน `.env`
 * ทำหน้าที่เป็นค่าตั้งต้นตอนติดตั้งใหม่และเป็นทางถอยเมื่อยังไม่เคยตั้งค่าผ่านเว็บ
 * ลบค่าออกจากหน้าเว็บแล้วระบบจะกลับไปใช้ `.env` โดยอัตโนมัติ
 *
 * เก็บสำเนาไว้ในหน่วยความจำเพื่อให้อ่านแบบไม่ต้อง await ได้ — ตัวประกอบวัตถุ
 * (`ServiceContainer`) เป็นแบบซิงโครนัส จึงรอผลจากฐานข้อมูลตอนสร้างวัตถุไม่ได้
 */
export class SettingsService extends BaseService {
  /** @type {import('../repositories/SettingRepository.js').SettingRepository} */
  #repository;
  /** @type {import('../core/Config.js').Config} */
  #config;
  /** @type {import('./AuditService.js').AuditService} */
  #auditService;
  /** @type {Map<string, string>} */
  #values = new Map();
  /** @type {number} */
  #version = 0;
  /** @type {boolean} */
  #loaded = false;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../repositories/SettingRepository.js').SettingRepository} deps.settingRepository ที่เก็บค่าตั้งค่า
   * @param {import('../core/Config.js').Config} deps.config ค่าจาก `.env`
   * @param {import('./AuditService.js').AuditService} deps.auditService บริการบันทึกการใช้งาน
   * @param {import('../core/Logger.js').Logger} [deps.logger] ตัวบันทึกเหตุการณ์
   */
  constructor({ settingRepository, config, auditService, logger }) {
    super(settingRepository, logger);
    this.#repository = settingRepository;
    this.#config = config;
    this.#auditService = auditService;
  }

  /** @returns {Array<{key: string, label: string}>} ช่องทางที่เลือกได้ */
  static get drivers() { return DRIVERS.map((item) => ({ ...item })); }

  /** @returns {Array<{key: string, label: string, icon: string, description: string}>} กลุ่มค่าตั้งค่าตามลำดับที่แสดงบนหน้าเว็บ */
  static get groups() { return GROUPS.map((item) => ({ ...item })); }

  /**
   * เลขรุ่นของค่าตั้งค่า — เพิ่มขึ้นทุกครั้งที่บันทึก
   *
   * `ConfiguredChannel` ใช้ตรวจว่าต้องประกอบช่องทางใหม่หรือยัง โดยไม่ต้องมีใคร
   * คอยแจ้งข่าวให้ — ผู้ใช้กดบันทึกแล้วการแจ้งเตือนครั้งถัดไปใช้ค่าใหม่ทันที
   * ไม่ต้องรีสตาร์ตระบบ
   *
   * @returns {number}
   */
  get version() { return this.#version; }

  /**
   * โหลดค่าจากฐานข้อมูลสำเร็จแล้วหรือยัง
   *
   * `false` แปลว่าระบบกำลังใช้ค่าจาก `.env` ล้วน ๆ — หน้าตั้งค่าจึงบอกผู้ดูแลได้ว่า
   * ที่แก้ไปอาจยังไม่มีผล แทนที่จะปล่อยให้งงว่าทำไมกดบันทึกแล้วไม่เปลี่ยน
   *
   * @returns {boolean}
   */
  get isLoaded() { return this.#loaded; }

  /**
   * โหลดค่าจากฐานข้อมูลเข้าหน่วยความจำ — เรียกครั้งเดียวตอนระบบเริ่มทำงาน
   *
   * ไม่โยนข้อผิดพลาดเมื่อยังไม่มีตาราง เพราะระบบต้องขึ้นได้แม้ยังไม่ได้รัน migration
   * (`SchemaGuard` เป็นคนจัดการกรณีนั้นด้วยข้อความที่ชัดกว่า)
   *
   * @returns {Promise<void>}
   */
  async load() {
    try {
      const rows = await this.#repository.all();
      this.#values = new Map(rows.map((row) => [row.key, row.value]));
      this.#loaded = true;
      this.#version += 1;
    } catch (error) {
      this.logger.warn('cannot load app settings — falling back to .env', {
        message: error.message,
      });
    }
  }

  /**
   * ค่าที่มีผลจริง — ค่าจากหน้าเว็บก่อน แล้วค่อยถอยไปใช้ `.env`
   * @param {string} key คีย์
   * @param {string} [fallback] ค่าเมื่อไม่มีทั้งสองที่
   * @returns {string}
   */
  effective(key, fallback = '') {
    const stored = this.#values.get(key);
    if (stored !== undefined && stored !== '') return stored;
    const fromEnv = this.#config.get(key, '') ?? '';
    if (fromEnv) return fromEnv;
    return EDITABLE[key]?.default ?? fallback;
  }

  /**
   * ค่าที่มีผลจริงในรูปจำนวนเต็ม
   * @param {string} key คีย์
   * @param {number} fallback ค่าเมื่ออ่านไม่ได้
   * @returns {number}
   */
  int(key, fallback) {
    const value = Number(this.effective(key, String(fallback)));
    return Number.isFinite(value) ? value : fallback;
  }

  /**
   * ค่าที่มีผลจริงในรูปจริง/เท็จ
   *
   * ใช้ได้กับคีย์ที่มีเฉพาะใน `.env` ด้วย เพราะ `effective()` ถอยไปอ่าน `.env` ให้อยู่แล้ว
   *
   * @param {string} key คีย์
   * @param {boolean} [fallback=false] ค่าเมื่อไม่ได้ตั้ง
   * @returns {boolean}
   */
  bool(key, fallback = false) {
    const value = this.effective(key, fallback ? 'true' : 'false');
    return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
  }

  /**
   * รายการค่าสำหรับแสดงบนหน้าเว็บ — ค่าลับถูกปิดบัง
   *
   * ⚠️ ห้ามส่งค่าลับกลับไปที่เบราว์เซอร์เด็ดขาด แม้จะอยู่ในหน้าที่ต้องเข้าสู่ระบบ
   * เพราะโทเคนจะไปโผล่ใน HTML ที่แคชได้ ในประวัติเบราว์เซอร์ และในภาพหน้าจอ
   * ที่ผู้ดูแลอาจส่งต่อเวลาขอความช่วยเหลือ
   *
   * @returns {Array<object>}
   */
  forDisplay() {
    return Object.entries(EDITABLE).map(([key, meta]) => {
      const stored = this.#values.get(key) ?? '';
      const fromEnv = this.#config.get(key, '') ?? '';
      const value = stored || fromEnv || (meta.default ?? '');

      return {
        key,
        label: meta.label,
        type: meta.type,
        group: meta.group ?? 'notification',
        hint: meta.hint ?? null,
        secret: meta.secret,
        options: meta.options ?? null,
        min: meta.min ?? null,
        max: meta.max ?? null,
        configured: Boolean(value),
        source: stored ? 'database' : (fromEnv ? 'env' : (meta.default ? 'default' : 'none')),
        // ค่าลับส่งไปแค่ตัวท้าย ๆ ให้ยืนยันได้ว่าใส่ถูกตัว
        value: meta.secret ? '' : value,
        preview: meta.secret && value ? `••••${value.slice(-4)}` : null,
      };
    });
  }

  /**
   * บันทึกค่าตั้งค่า
   *
   * ช่องที่เว้นว่างไว้**ไม่ถูกลบ** สำหรับค่าลับ — เพราะหน้าเว็บไม่เคยแสดงค่าเดิม
   * ผู้ใช้จึงพิมพ์กลับมาไม่ได้ การเว้นว่างย่อมหมายถึง "ไม่เปลี่ยน" ไม่ใช่ "ลบทิ้ง"
   * ถ้าต้องการลบจริงให้ติ๊กช่อง "ล้างค่านี้"
   *
   * @param {Record<string, string>} input ค่าที่ส่งมาจากฟอร์ม
   * @param {object} context ข้อมูลผู้กระทำ
   * @param {import('../models/User.js').User} context.actor ผู้กระทำ
   * @param {Array<string>} [context.clearKeys] คีย์ที่ต้องการล้างกลับไปใช้ `.env`
   * @param {string|null} [context.ip] หมายเลข IP
   * @param {string|null} [context.userAgent] เบราว์เซอร์
   * @returns {Promise<{saved: Array<string>, cleared: Array<string>}>}
   * @throws {ValidationError} เมื่อค่าไม่ถูกต้อง
   */
  async save(input, { actor, clearKeys = [], ip = null, userAgent = null }) {
    const entries = [];
    const errors = [];

    for (const [key, meta] of Object.entries(EDITABLE)) {
      if (clearKeys.includes(key)) continue;

      const raw = input[key];
      if (raw === undefined) continue;

      const value = SettingsService.#normalize(key, raw, meta, errors);
      if (value === null) continue;
      entries.push({ key, value, isSecret: meta.secret });
    }

    if (errors.length) throw new ValidationError('ค่าตั้งค่าไม่ถูกต้อง', errors);

    const cleared = clearKeys.filter((key) => Object.hasOwn(EDITABLE, key));

    SettingsService.#assertUsable(entries, cleared, {
      current: (key) => this.effective(key),
      // ล้างค่าที่ตั้งผ่านเว็บ = กลับไปใช้ `.env` ไม่ใช่กลายเป็นค่าว่าง
      fallback: (key) => this.#config.get(key, '') ?? '',
    }, errors);
    if (errors.length) throw new ValidationError('ตั้งค่าช่องทางแจ้งเตือนไม่ครบ', errors);

    await this.#repository.saveMany(entries, actor?.id ?? null);
    await this.#repository.removeMany(cleared);
    await this.load();

    await this.#auditService.record({
      actorId: actor?.id ?? null,
      actorLabel: actor?.username ?? 'ระบบ',
      action: 'setting.manage',
      resourceType: 'setting',
      resourceId: null,
      // ⚠️ บันทึกแค่ "คีย์ไหนถูกแก้" ไม่บันทึกค่า — audit log อ่านได้โดยผู้มีสิทธิ์
      // `audit.read` ซึ่งกว้างกว่า `setting.manage` การเก็บโทเคนลงไปคือการรั่ว
      afterData: {
        saved: entries.map((entry) => entry.key),
        cleared,
      },
      ip,
      userAgent,
    });

    return { saved: entries.map((entry) => entry.key), cleared };
  }

  /**
   * ตรวจค่าหนึ่งรายการ
   * @param {string} key คีย์
   * @param {string|Array<string>} raw ค่าดิบจากฟอร์ม
   * @param {object} meta ข้อมูลกำกับของคีย์
   * @param {Array<object>} errors ที่เก็บข้อผิดพลาด
   * @returns {string|null} ค่าที่พร้อมบันทึก หรือ `null` เมื่อไม่ต้องบันทึก
   */
  static #normalize(key, raw, meta, errors) {
    if (meta.type === 'drivers') {
      const list = (Array.isArray(raw) ? raw : [raw])
        .map((item) => String(item).trim().toLowerCase())
        .filter(Boolean);
      const known = DRIVERS.map((item) => item.key);
      const unknown = list.filter((item) => !known.includes(item));
      if (unknown.length) {
        errors.push({ field: key, message: `ไม่รู้จักช่องทาง: ${unknown.join(', ')}` });
        return null;
      }
      // ไม่เลือกอะไรเลยแปลว่าไม่ต้องการส่งจริง — บันทึกเป็น console ให้ชัดเจน
      return list.length ? [...new Set(list)].join(',') : 'console';
    }

    const value = String(raw ?? '').trim();

    // เว้นว่าง = ไม่เปลี่ยน (ดูเหตุผลใน JSDoc ของ save())
    if (!value) return null;

    if (meta.type === 'select') {
      const allowed = (meta.options ?? []).map((option) => option.value);
      if (!allowed.includes(value)) {
        errors.push({
          field: key,
          message: `${meta.label} ต้องเป็นค่าใดค่าหนึ่งใน: ${allowed.join(', ')}`,
        });
        return null;
      }
      return value;
    }

    if (meta.type === 'cron') {
      // ตรวจด้วยตัว parser ของ node-cron เอง จะได้ไม่มีวันตีความต่างจากตอนรันจริง
      if (!cron.validate(value)) {
        errors.push({
          field: key,
          message: `ตารางเวลาของ "${meta.label}" ไม่ถูกต้อง — ต้องเป็นนิพจน์ cron เช่น */5 * * * *`,
        });
        return null;
      }
      return value;
    }

    if (meta.type === 'integer') {
      const number = Number(value);
      if (!Number.isInteger(number) || number < meta.min || number > meta.max) {
        errors.push({
          field: key,
          message: `${meta.label} ต้องเป็นจำนวนเต็มระหว่าง ${meta.min}–${meta.max}`,
        });
        return null;
      }
      return String(number);
    }

    if (meta.type === 'url') {
      try {
        const parsed = new URL(value);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
      } catch {
        errors.push({ field: key, message: `${meta.label} ต้องเป็น URL ที่ขึ้นต้นด้วย https://` });
        return null;
      }
    }

    if (value.length > 500) {
      errors.push({ field: key, message: `${meta.label} ยาวเกิน 500 ตัวอักษร` });
      return null;
    }

    return value;
  }

  /**
   * ตรวจว่าช่องทางที่เลือกมีค่าที่จำเป็นครบ
   *
   * เลือก Discord ไว้แต่ไม่ใส่ webhook URL คือสถานะที่ระบบ "คิดว่าจะส่งได้"
   * แต่ส่งไม่ได้จริง ต้องดักไว้ตั้งแต่ตอนบันทึก ไม่ใช่ปล่อยให้ไปล้มตอนน้ำท่วม
   *
   * @param {Array<{key: string, value: string}>} entries ค่าที่กำลังจะบันทึก
   * @param {Array<string>} cleared คีย์ที่กำลังจะล้าง
   * @param {{current: (key: string) => string, fallback: (key: string) => string}} readers ตัวอ่านค่า
   * @param {Array<object>} errors ที่เก็บข้อผิดพลาด
   * @returns {void}
   */
  static #assertUsable(entries, cleared, readers, errors) {
    /**
     * ค่าที่จะมีผลหลังบันทึกชุดนี้
     * @param {string} key คีย์
     * @returns {string}
     */
    const after = (key) => {
      if (cleared.includes(key)) return readers.fallback(key);
      return entries.find((entry) => entry.key === key)?.value ?? readers.current(key);
    };

    const drivers = after('NOTIFICATION_DRIVER').split(',').map((item) => item.trim());

    const requirements = {
      line: [['LINE_CHANNEL_ACCESS_TOKEN', 'LINE Channel Access Token']],
      discord: [['DISCORD_WEBHOOK_URL', 'Discord Webhook URL']],
      telegram: [
        ['TELEGRAM_BOT_TOKEN', 'Telegram Bot Token'],
        ['TELEGRAM_CHAT_ID', 'Telegram Chat ID'],
      ],
    };

    for (const driver of drivers) {
      for (const [key, label] of requirements[driver] ?? []) {
        if (!after(key)) {
          errors.push({ field: key, message: `เลือกช่องทาง ${driver} แล้วต้องกรอก ${label} ด้วย` });
        }
      }
    }

    // เลือก http ไว้แต่ไม่ใส่ปลายทาง = งานตรวจวัดจะล้มทุก 5 นาทีโดยไม่มีใครรู้
    // จนกว่าจะมีคนไปเปิดดู log — ดักตั้งแต่ตอนบันทึกดีกว่า
    if (after('DETECTION_DRIVER') === 'http') {
      if (!after('WATER_API_URL')) {
        errors.push({ field: 'WATER_API_URL', message: 'เลือกไดรเวอร์ http แล้วต้องกรอก URL บริการตรวจจับ' });
      }
      if (!after('WATER_API_KEY')) {
        errors.push({ field: 'WATER_API_KEY', message: 'เลือกไดรเวอร์ http แล้วต้องกรอก API Key บริการตรวจจับ' });
      }
    }

    // กรอกกุญแจมาข้างเดียวคือสถานะที่ระบบ "คิดว่าส่งอีเมลได้" แต่ส่งไม่ได้จริง
    // ซึ่งจะไปโผล่ตอนมีคนกดลืมรหัสผ่านแล้วไม่ได้รับเมล — ดักตั้งแต่ตอนบันทึกดีกว่า
    const hasApiKey = Boolean(after('MAILJET_API_KEY'));
    const hasSecret = Boolean(after('MAILJET_SECRET_KEY'));
    if (hasApiKey !== hasSecret) {
      errors.push({
        field: hasApiKey ? 'MAILJET_SECRET_KEY' : 'MAILJET_API_KEY',
        message: 'Mailjet ต้องกรอกทั้ง API Key และ Secret Key คู่กัน',
      });
    }
    if (hasApiKey && hasSecret && !after('MAIL_FROM')) {
      errors.push({ field: 'MAIL_FROM', message: 'ตั้งค่า Mailjet แล้วต้องระบุอีเมลผู้ส่งด้วย' });
    }
  }
}
