import { BaseController } from '../core/BaseController.js';
import { Validator } from '../core/Validator.js';

/**
 * ควบคุมหน้าไทม์ไลน์บันทึกการใช้งานระบบ (`/admin/audit`)
 */
export class AuditController extends BaseController {
  /** @type {import('../services/AuditService.js').AuditService} */
  #auditService;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../services/AuditService.js').AuditService} deps.auditService บริการบันทึกการใช้งาน
   * @param {import('../core/Logger.js').Logger} [deps.logger] ตัวบันทึกเหตุการณ์
   */
  constructor({ auditService, logger }) {
    super(auditService, logger);
    this.#auditService = auditService;
  }

  /**
   * หน้าไทม์ไลน์พร้อมตัวกรอง
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async index(req, res) {
    const { page, pageSize, offset } = this.pagination(req.query, 50);
    const clean = new Validator(req.query)
      .integer('actorId', { min: 1, label: 'ผู้กระทำ' })
      .string('action', { max: 80, label: 'การกระทำ' })
      .string('resourceType', { max: 50, label: 'ชนิดทรัพยากร' })
      .date('from', { label: 'วันที่เริ่มต้น' })
      .date('to', { label: 'วันที่สิ้นสุด' })
      .validate();

    const [{ items, total }, actions] = await Promise.all([
      this.#auditService.search({
        actorId: clean.actorId ?? null,
        action: clean.action ?? '',
        resourceType: clean.resourceType ?? '',
        from: clean.from ? `${clean.from} 00:00:00` : null,
        to: clean.to ? `${clean.to} 23:59:59` : null,
        limit: pageSize,
        offset,
      }),
      this.#auditService.knownActions(),
    ]);

    res.render('admin/audit', {
      title: 'บันทึกการใช้งานระบบ',
      logs: items.map((item) => item.toJSON()),
      actions,
      filters: req.query,
      pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) },
    });
  }

  /**
   * API: ค้นบันทึกการใช้งาน
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async apiIndex(req, res) {
    const { page, pageSize, offset } = this.pagination(req.query);
    const { items, total } = await this.#auditService.search({
      actorId: req.query.actorId ?? null,
      action: req.query.action ?? '',
      resourceType: req.query.resourceType ?? '',
      limit: pageSize,
      offset,
    });
    this.ok(res, items.map((item) => item.toJSON()), { page, pageSize, total });
  }
}
