import { BaseService } from '../core/BaseService.js';
import { NotFoundError } from '../core/errors/index.js';
import { DailyReport } from '../models/DailyReport.js';

/**
 * บริการสร้างและส่งรายงานประจำวัน
 *
 * ช่วงเวลาคิดตามเวลาไทยของวันนั้น (00:00–23:59) และแสดงวันที่เป็น พ.ศ.
 * บันทึกแบบ upsert ด้วยคีย์ `(station_id, report_date)` จึงสั่งสร้างซ้ำได้โดยไม่เกิดข้อมูลซ้ำ
 */
export class ReportService extends BaseService {
  /** @type {import('../repositories/DailyReportRepository.js').DailyReportRepository} */
  #dailyReportRepository;
  /** @type {import('../repositories/ReportLogRepository.js').ReportLogRepository} */
  #reportLogRepository;
  /** @type {import('../repositories/StationRepository.js').StationRepository} */
  #stationRepository;
  /** @type {import('./MeasurementService.js').MeasurementService} */
  #measurementService;
  /** @type {import('./notification/NotificationChannel.js').NotificationChannel} */
  #channel;
  /** @type {import('./notification/MessageFactory.js').MessageFactory} */
  #messageBuilder;
  /** @type {import('./PermissionService.js').PermissionService} */
  #permissionService;
  /** @type {string} */
  #baseUrl;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../repositories/DailyReportRepository.js').DailyReportRepository} deps.dailyReportRepository ที่เก็บรายงาน
   * @param {import('../repositories/ReportLogRepository.js').ReportLogRepository} deps.reportLogRepository ที่เก็บประวัติการส่ง
   * @param {import('../repositories/StationRepository.js').StationRepository} deps.stationRepository ที่เก็บจุดวัด
   * @param {import('./MeasurementService.js').MeasurementService} deps.measurementService บริการค่าวัด
   * @param {import('./notification/NotificationChannel.js').NotificationChannel} deps.channel ช่องทางแจ้งเตือน
   * @param {import('./notification/MessageFactory.js').MessageFactory} deps.messageBuilder ตัวสร้างข้อความ
   * @param {import('./PermissionService.js').PermissionService} deps.permissionService บริการสิทธิ์
   * @param {string} deps.baseUrl URL ฐานของระบบ
   * @param {import('../core/Logger.js').Logger} [deps.logger] ตัวบันทึกเหตุการณ์
   */
  constructor({
    dailyReportRepository, reportLogRepository, stationRepository,
    measurementService, channel, messageBuilder, permissionService, baseUrl, logger,
  }) {
    super(dailyReportRepository, logger);
    this.#dailyReportRepository = dailyReportRepository;
    this.#reportLogRepository = reportLogRepository;
    this.#stationRepository = stationRepository;
    this.#measurementService = measurementService;
    this.#channel = channel;
    this.#messageBuilder = messageBuilder;
    this.#permissionService = permissionService;
    this.#baseUrl = String(baseUrl ?? '').replace(/\/+$/, '');
  }

  /**
   * สร้าง (หรือสร้างซ้ำ) รายงานประจำวันของจุดวัดหนึ่งแห่ง
   *
   * ⚠️ ระวังทิศทางแกน: `highestPixel` มาจาก `MIN(water_line)` เพราะพิกเซลน้อย = น้ำสูง
   *
   * @param {number} stationId รหัสจุดวัด
   * @param {Date|string} [date=new Date()] วันที่ของรายงาน
   * @returns {Promise<DailyReport>}
   */
  async generate(stationId, date = new Date()) {
    const day = ReportService.toDateString(date);
    const summary = await this.#measurementService.summarize(stationId, {
      from: `${day} 00:00:00`,
      to: `${day} 23:59:59`,
    });

    const report = new DailyReport({
      stationId,
      reportDate: day,
      highestPixel: summary.highestPixel,
      lowestPixel: summary.lowestPixel,
      highestMeter: summary.highestMeter,
      lowestMeter: summary.lowestMeter,
      highestAt: summary.highestAt,
      lowestAt: summary.lowestAt,
      currentMeter: summary.currentMeter,
      measurementCount: summary.count,
    });

    const saved = await this.#dailyReportRepository.upsert(report);
    this.logger.info('daily report generated', {
      stationId, date: day, measurements: summary.count,
    });
    return saved;
  }

  /**
   * สร้างรายงานของทุกจุดวัดที่เปิดใช้งาน
   * @param {Date|string} [date=new Date()] วันที่ของรายงาน
   * @returns {Promise<Array<{station: import('../models/Station.js').Station, report: DailyReport}>>}
   */
  async generateForAllStations(date = new Date()) {
    const stations = await this.#stationRepository.findActive();
    const results = [];
    for (const station of stations) {
      try {
        const report = await this.generate(station.id, date);
        results.push({ station, report });
      } catch (error) {
        this.logger.error('failed to generate daily report', {
          stationId: station.id, message: error.message,
        });
      }
    }
    return results;
  }

  /**
   * ส่งรายงานเข้ากลุ่ม LINE
   * @param {import('../models/Station.js').Station} station จุดวัด
   * @param {DailyReport} report รายงาน
   * @returns {Promise<{sent: boolean, error?: string}>}
   */
  async send(station, report) {
    const message = this.#messageBuilder.buildDailyReport({
      station, report, imageUrl: this.#publicImageUrl(report.imagePath),
    });
    const target = station.lineGroupId ?? null;
    const result = await this.#channel.send(message, { target });

    await this.#reportLogRepository.record({
      stationId: station.id,
      reportDate: report.reportDate,
      reportType: 'DAILY',
      status: result.success ? 'SENT' : 'FAILED',
      recipients: target ? [target] : ['broadcast'],
      messageContent: { altText: message.altText },
    });

    if (!result.success) {
      this.logger.error('daily report send failed', {
        stationId: station.id, error: result.error,
      });
    }
    return { sent: result.success, error: result.error };
  }

  /**
   * สร้างและส่งรายงานของทุกจุดวัด — ใช้โดย `DailyReportJob`
   * @param {Date|string} [date=new Date()] วันที่ของรายงาน
   * @returns {Promise<{generated: number, sent: number, failed: number}>}
   */
  async generateAndSendAll(date = new Date()) {
    const results = await this.generateForAllStations(date);
    let sent = 0;
    let failed = 0;

    for (const { station, report } of results) {
      // จุดวัดที่ไม่มีค่าวัดเลยทั้งวัน ไม่ต้องส่งรายงานเปล่าเข้ากลุ่ม
      if (report.measurementCount === 0) {
        this.logger.info('skip empty daily report', { stationId: station.id });
        continue;
      }
      const outcome = await this.send(station, report);
      if (outcome.sent) sent += 1;
      else failed += 1;
    }
    return { generated: results.length, sent, failed };
  }

  /**
   * สั่งสร้างและส่งรายงานด้วยตนเอง (สิทธิ์ `report.generate` / `report.send`)
   * @param {number} stationId รหัสจุดวัด
   * @param {string|Date} date วันที่
   * @param {{actor: import('../models/User.js').User, send?: boolean}} context ข้อมูลผู้กระทำ
   * @returns {Promise<{report: DailyReport, sent: boolean}>}
   * @throws {NotFoundError} เมื่อไม่พบจุดวัด
   */
  async generateManual(stationId, date, { actor, send = false }) {
    this.#permissionService.assertStationAccess(actor, stationId);
    const station = await this.#stationRepository.findById(stationId);
    if (!station) throw new NotFoundError('ไม่พบจุดวัดที่ต้องการ');

    const report = await this.generate(stationId, date);
    if (!send) return { report, sent: false };

    const outcome = await this.send(station, report);
    return { report, sent: outcome.sent };
  }

  /**
   * ค้นรายงานตามขอบเขตสิทธิ์
   * @param {import('../models/User.js').User} user ผู้ใช้
   * @param {object} [filters={}] ตัวกรอง
   * @returns {Promise<{items: Array<DailyReport>, total: number}>}
   */
  async search(user, filters = {}) {
    const scoped = this.#permissionService.applyStationScope(user, filters);
    return this.#dailyReportRepository.search(scoped);
  }

  /**
   * รายงานสำหรับพิมพ์ — จัดกลุ่มตามจุดวัดพร้อมสรุปของแต่ละจุด
   *
   * แยกออกมาจาก `search()` เพราะเอกสารสำหรับพิมพ์ต้องการข้อมูลคนละรูป:
   * ไม่แบ่งหน้า (เอกสารต้องครบในไฟล์เดียว) จัดกลุ่มตามจุดวัด และมีตัวเลขสรุป
   * ระดับจุดวัดที่หน้าตารางปกติไม่ต้องใช้
   *
   * ⚠️ ทิศทางแกน: "สูงสุดของช่วง" คือ**ค่าเมตรที่มากที่สุด**ในบรรดายอดรายวัน
   * ไม่ใช่พิกเซลที่มากที่สุด — พิกเซลมาก = น้ำต่ำ (CLAUDE.md ข้อ 6.1)
   *
   * @param {import('../models/User.js').User} user ผู้ใช้
   * @param {object} [filters={}] ตัวกรอง (`stationId`, `from`, `to`)
   * @param {number} [maxRows=2000] เพดานจำนวนแถว กันเอกสารบานปลาย
   * @returns {Promise<{groups: Array<object>, total: number, truncated: boolean}>}
   */
  async groupedForPrint(user, filters = {}, maxRows = 2000) {
    const { items, total } = await this.search(user, { ...filters, limit: maxRows, offset: 0 });

    const stations = await this.#stationRepository.findAll({ limit: 500 });
    const stationById = new Map(stations.map((station) => [station.id, station]));

    /** @type {Map<number, Array<DailyReport>>} */
    const byStation = new Map();
    for (const report of items) {
      if (!byStation.has(report.stationId)) byStation.set(report.stationId, []);
      byStation.get(report.stationId).push(report);
    }

    const groups = [...byStation.entries()]
      .map(([stationId, reports]) => {
        // เรียงจากเก่าไปใหม่ในเอกสาร — อ่านไล่ตามเวลาเป็นธรรมชาติกว่าตารางบนหน้าเว็บ
        const ordered = [...reports].sort((a, b) => a.reportDate.localeCompare(b.reportDate));
        return {
          station: stationById.get(stationId) ?? null,
          stationId,
          reports: ordered,
          summary: ReportService.#summarize(ordered),
        };
      })
      .filter((group) => group.station !== null)
      .sort((a, b) => a.station.name.localeCompare(b.station.name, 'th'));

    return { groups, total, truncated: total > items.length };
  }

  /**
   * สรุปตัวเลขระดับจุดวัดจากรายงานรายวันทั้งช่วง
   * @param {Array<DailyReport>} reports รายงานที่เรียงตามวันแล้ว
   * @returns {{days: number, measurements: number, peak: object|null, trough: object|null, avgRange: number|null}}
   */
  static #summarize(reports) {
    const withHigh = reports.filter((report) => report.highestMeter !== null);
    const withLow = reports.filter((report) => report.lowestMeter !== null);

    const peak = withHigh.length
      ? withHigh.reduce((best, item) => (item.highestMeter.value > best.highestMeter.value ? item : best))
      : null;
    const trough = withLow.length
      ? withLow.reduce((worst, item) => (item.lowestMeter.value < worst.lowestMeter.value ? item : worst))
      : null;

    const ranges = reports.map((report) => report.rangeMeter).filter((value) => value !== null);
    const avgRange = ranges.length
      ? Math.round((ranges.reduce((sum, value) => sum + value, 0) / ranges.length) * 100) / 100
      : null;

    return {
      days: reports.length,
      measurements: reports.reduce((sum, report) => sum + report.measurementCount, 0),
      peak: peak ? { meter: peak.highestMeter.value, thaiDate: peak.thaiDate, at: peak.highestAt } : null,
      trough: trough ? { meter: trough.lowestMeter.value, thaiDate: trough.thaiDate, at: trough.lowestAt } : null,
      avgRange,
    };
  }

  /**
   * รายงานของจุดวัดในวันที่ระบุ
   * @param {number} stationId รหัสจุดวัด
   * @param {string} date วันที่ (`YYYY-MM-DD`)
   * @returns {Promise<DailyReport|null>}
   */
  async findFor(stationId, date) {
    return this.#dailyReportRepository.findByStationAndDate(stationId, date);
  }

  /**
   * แปลงวันที่เป็นสตริง `YYYY-MM-DD` ตามเวลาไทย
   * @param {Date|string} value วันที่
   * @returns {string}
   */
  static toDateString(value) {
    if (typeof value === 'string') return value.slice(0, 10);
    const date = value instanceof Date ? value : new Date(value);
    return date.toLocaleDateString('sv-SE');
  }

  /**
   * แปลงพาธภาพเป็น URL สาธารณะแบบเต็ม (ต้องเป็น HTTPS จึงจะแนบไปกับ LINE ได้)
   * @param {string|null} imagePath พาธสัมพัทธ์
   * @returns {string|null}
   */
  #publicImageUrl(imagePath) {
    if (!imagePath || !this.#baseUrl.startsWith('https://')) return null;
    return `${this.#baseUrl}/storage/${imagePath}`;
  }
}
