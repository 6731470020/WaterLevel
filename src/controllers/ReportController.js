import { BaseController } from '../core/BaseController.js';
import { Validator } from '../core/Validator.js';

/**
 * ควบคุมหน้ารายงานประจำวัน
 */
export class ReportController extends BaseController {
  /** @type {import('../services/ReportService.js').ReportService} */
  #reportService;
  /** @type {import('../services/StationService.js').StationService} */
  #stationService;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../services/ReportService.js').ReportService} deps.reportService บริการรายงาน
   * @param {import('../services/StationService.js').StationService} deps.stationService บริการจุดวัด
   * @param {import('../core/Logger.js').Logger} [deps.logger] ตัวบันทึกเหตุการณ์
   */
  constructor({ reportService, stationService, logger }) {
    super(reportService, logger);
    this.#reportService = reportService;
    this.#stationService = stationService;
  }

  /**
   * หน้ารายการรายงาน
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async index(req, res) {
    const { page, pageSize, offset } = this.pagination(req.query, 30);
    const clean = new Validator(req.query)
      .integer('stationId', { min: 1, label: 'จุดวัด' })
      .date('from', { label: 'วันที่เริ่มต้น' })
      .date('to', { label: 'วันที่สิ้นสุด' })
      .validate();

    const [{ items, total }, stations] = await Promise.all([
      this.#reportService.search(req.user, {
        stationId: clean.stationId ?? null,
        from: clean.from ?? null,
        to: clean.to ?? null,
        limit: pageSize,
        offset,
      }),
      this.#stationService.list(req.user, { limit: 200 }),
    ]);

    res.render('admin/reports', {
      title: 'รายงานประจำวัน',
      reports: items.map((item) => item.toJSON()),
      stations: stations.items.map((station) => station.toJSON()),
      filters: req.query,
      pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) },
    });
  }

  /**
   * เอกสารรายงานสำหรับพิมพ์เป็น PDF ขนาด A4 (สิทธิ์ `report.read`)
   *
   * ใช้การพิมพ์ของเบราว์เซอร์ (`@page size: A4`) แทนการสร้าง PDF ฝั่งเซิร์ฟเวอร์ —
   * ได้การจัดหน้าและการตัดคำภาษาไทยที่ถูกต้องโดยไม่ต้องฝังฟอนต์เอง
   * และไม่ต้องเพิ่มไลบรารีขนาดใหญ่เข้าโปรเจกต์ (ดู CLAUDE.md ข้อ 15)
   *
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async print(req, res) {
    const clean = new Validator(req.query)
      .integer('stationId', { min: 1, label: 'จุดวัด' })
      .date('from', { label: 'วันที่เริ่มต้น' })
      .date('to', { label: 'วันที่สิ้นสุด' })
      .validate();

    const { groups, total, truncated } = await this.#reportService.groupedForPrint(req.user, {
      stationId: clean.stationId ?? null,
      from: clean.from ?? null,
      to: clean.to ?? null,
    });

    res.render('admin/reportPrint', {
      layout: false,
      title: 'รายงานระดับน้ำ',
      groups: groups.map((group) => ({
        station: group.station.toJSON(),
        reports: group.reports.map((report) => report.toJSON()),
        summary: group.summary,
      })),
      total,
      truncated,
      range: { from: clean.from ?? null, to: clean.to ?? null },
      printedBy: req.user.fullName,
      printedAt: new Date(),
      autoPrint: req.query.auto === '1',
    });
  }

  /**
   * สั่งสร้างรายงาน (สิทธิ์ `report.generate`)
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async generate(req, res) {
    const date = req.body?.date || new Date().toLocaleDateString('sv-SE');
    const { report, sent } = await this.#reportService.generateManual(req.stationId, date, {
      actor: req.user, send: false,
    });
    this.ok(res, { report: report.toJSON(), sent });
  }

  /**
   * สั่งสร้างและส่งรายงานเข้ากลุ่ม LINE (สิทธิ์ `report.send`)
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async send(req, res) {
    const date = req.body?.date || new Date().toLocaleDateString('sv-SE');
    const { report, sent } = await this.#reportService.generateManual(req.stationId, date, {
      actor: req.user, send: true,
    });
    this.ok(res, { report: report.toJSON(), sent });
  }
}
