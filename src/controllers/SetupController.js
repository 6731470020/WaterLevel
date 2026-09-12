import { BaseController } from '../core/BaseController.js';
import { AppError } from '../core/errors/index.js';

/**
 * ควบคุมหน้าตั้งค่าระบบครั้งแรก (`/setup`)
 *
 * เข้าถึงได้เฉพาะเมื่อระบบยังไม่มีผู้ใช้เลย — ตรวจเงื่อนไขนี้ทุกคำขอผ่าน
 * `SetupService.assertStillRequired()` ไม่พึ่งการตรวจที่ route เพียงชั้นเดียว
 */
export class SetupController extends BaseController {
  /** @type {import('../services/SetupService.js').SetupService} */
  #setupService;
  /** @type {string} */
  #baseUrl;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../services/SetupService.js').SetupService} deps.setupService บริการติดตั้ง
   * @param {string} deps.baseUrl URL ฐานของระบบ
   * @param {import('../core/Logger.js').Logger} [deps.logger] ตัวบันทึกเหตุการณ์
   */
  constructor({ setupService, baseUrl, logger }) {
    super(setupService, logger);
    this.#setupService = setupService;
    this.#baseUrl = baseUrl;
  }

  /**
   * หน้าตั้งค่า — แสดงตัวเลือกฐานข้อมูลและฟอร์มผู้ดูแลคนแรก
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async index(req, res) {
    const status = await this.#setupService.status();

    if (!status.required) {
      res.redirect('/login');
      return;
    }

    res.render('setup/index', {
      title: 'ตั้งค่าระบบครั้งแรก',
      status,
      options: this.#setupService.databaseOptions,
      baseUrl: this.#baseUrl,
      form: SetupController.#defaults(),
      error: null,
      details: [],
    });
  }

  /**
   * API: ทดสอบการเชื่อมต่อตามค่าที่กรอก
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async testConnection(req, res) {
    const result = await this.#setupService.testConnection(req.body);
    this.ok(res, result);
  }

  /**
   * ติดตั้งระบบตามค่าที่กรอก
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async install(req, res) {
    try {
      const result = await this.#setupService.install(req.body);
      res.render('setup/done', {
        title: 'ติดตั้งเสร็จสมบูรณ์',
        steps: result.steps,
        username: result.username,
        baseUrl: this.#baseUrl,
      });
    } catch (error) {
      if (!(error instanceof AppError) || error.statusCode >= 500) throw error;

      const status = await this.#setupService.status();
      res.status(error.statusCode).render('setup/index', {
        title: 'ตั้งค่าระบบครั้งแรก',
        status,
        options: this.#setupService.databaseOptions,
        baseUrl: this.#baseUrl,
        form: { ...SetupController.#defaults(), ...SetupController.#echo(req.body) },
        error: error.message,
        details: error.details ?? [],
      });
    }
  }

  /**
   * ค่าเริ่มต้นของฟอร์ม
   * @returns {object}
   */
  static #defaults() {
    return {
      driver: 'sqlite',
      file: './storage/waterlevel.db',
      host: 'localhost',
      port: '3306',
      user: '',
      database: 'waterlevel',
      adminUsername: '',
      adminEmail: '',
      adminFullName: '',
    };
  }

  /**
   * คืนค่าที่ผู้ใช้กรอกไว้กลับไปแสดงในฟอร์ม — **ไม่คืนรหัสผ่านใด ๆ**
   * @param {object} body เนื้อคำขอ
   * @returns {object}
   */
  static #echo(body) {
    const safe = {};
    for (const key of ['driver', 'file', 'host', 'port', 'user', 'database',
      'adminUsername', 'adminEmail', 'adminFullName']) {
      if (body?.[key] !== undefined) safe[key] = String(body[key]);
    }
    return safe;
  }
}
