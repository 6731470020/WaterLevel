import { BaseController } from '../core/BaseController.js';

/**
 * ควบคุมหน้าจัดการกลุ่มและผู้ติดตาม LINE (`/admin/line`)
 */
export class LineController extends BaseController {
  /** @type {import('../services/LineService.js').LineService} */
  #lineService;
  /** @type {import('../services/AlertService.js').AlertService} */
  #alertService;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../services/LineService.js').LineService} deps.lineService บริการ LINE
   * @param {import('../services/AlertService.js').AlertService} deps.alertService บริการแจ้งเตือน
   * @param {import('../core/Logger.js').Logger} [deps.logger] ตัวบันทึกเหตุการณ์
   */
  constructor({ lineService, alertService, logger }) {
    super(lineService, logger);
    this.#lineService = lineService;
    this.#alertService = alertService;
  }

  /**
   * หน้ารายการกลุ่มและผู้ติดตาม
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async index(req, res) {
    const { groups, users, counts } = await this.#lineService.overview();
    res.render('admin/line', {
      title: 'กลุ่มและผู้ติดตาม LINE',
      groups: groups.map((group) => group.toJSON()),
      users: users.map((user) => user.toJSON()),
      counts,
      canManage: req.user.can('line.manage'),
      sent: req.query.sent ?? null,
    });
  }

  /**
   * ตั้งชื่อกลุ่มให้ผู้ดูแลจำได้ (สิทธิ์ `line.manage`)
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async rename(req, res) {
    const displayName = String(req.body.displayName ?? '').trim().slice(0, 255) || null;
    await this.#lineService.renameGroup(Number(req.params.id), displayName);
    res.redirect('/admin/line');
  }

  /**
   * ส่งข้อความทดสอบเข้ากลุ่ม (สิทธิ์ `alert.broadcast`)
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async sendTest(req, res) {
    const result = await this.#alertService.sendTest(req.body.target || null, req.user);
    res.redirect(`/admin/line?sent=${result.sent ? '1' : '0'}`);
  }
}
