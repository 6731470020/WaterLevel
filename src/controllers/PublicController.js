import { BaseController } from '../core/BaseController.js';
import { ZoneLevel } from '../models/values/ZoneLevel.js';
import { DailyReport } from '../models/DailyReport.js';

/**
 * ควบคุมหน้าสาธารณะ — พอร์ตจาก `data/index.php` (1,664 บรรทัด)
 *
 * ไม่ต้องเข้าสู่ระบบ จำกัด 60 คำขอ/นาที/IP และคงระดับ SEO เดิมไว้ทั้งหมด
 * (meta tag, Open Graph, JSON-LD, sitemap.xml, robots.txt)
 */
export class PublicController extends BaseController {
  /** @type {import('../services/StationService.js').StationService} */
  #stationService;
  /** @type {import('../services/MeasurementService.js').MeasurementService} */
  #measurementService;
  /** @type {import('../services/ReportService.js').ReportService} */
  #reportService;
  /** @type {import('../services/RoiService.js').RoiService} */
  #roiService;
  /** @type {import('../services/CalibrationService.js').CalibrationService} */
  #calibrationService;
  /** @type {string} */
  #baseUrl;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../services/StationService.js').StationService} deps.stationService บริการจุดวัด
   * @param {import('../services/MeasurementService.js').MeasurementService} deps.measurementService บริการค่าวัด
   * @param {import('../services/ReportService.js').ReportService} deps.reportService บริการรายงาน
   * @param {import('../services/RoiService.js').RoiService} deps.roiService บริการ ROI
   * @param {import('../services/CalibrationService.js').CalibrationService} deps.calibrationService บริการเทียบค่า
   * @param {string} deps.baseUrl URL ฐานของระบบ
   * @param {import('../core/Logger.js').Logger} [deps.logger] ตัวบันทึกเหตุการณ์
   */
  constructor({
    stationService, measurementService, reportService,
    roiService, calibrationService, baseUrl, logger,
  }) {
    super(stationService, logger);
    this.#stationService = stationService;
    this.#measurementService = measurementService;
    this.#reportService = reportService;
    this.#roiService = roiService;
    this.#calibrationService = calibrationService;
    this.#baseUrl = String(baseUrl ?? '').replace(/\/+$/, '');
  }

  /**
   * หน้าแรก — รายการจุดวัดทั้งหมดพร้อมสถานะปัจจุบัน
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async index(req, res) {
    const rows = await this.#stationService.overview(null, { activeOnly: true });

    const stations = rows.map(({ station, latest }) => ({
      ...station.toJSON(),
      latest: latest ? {
        ...latest,
        zone: ZoneLevel.fromKey(latest.zoneKey)?.toJSON() ?? null,
        measuredAtText: PublicController.formatThaiDateTime(latest.measuredAt),
        ageMinutes: PublicController.#minutesSince(latest.measuredAt),
      } : null,
    }));

    res.render('public/index', {
      title: 'ระบบตรวจวัดระดับน้ำอัตโนมัติ',
      stations,
      zoneLevels: ZoneLevel.all().map((zone) => zone.toJSON()),
      seo: this.#seo({
        title: 'ระบบตรวจวัดระดับน้ำอัตโนมัติ',
        description: 'ติดตามระดับน้ำแบบเรียลไทม์จากกล้องวงจรปิด พร้อมกราฟย้อนหลัง ' +
                     'ภาพถ่ายล่าสุด และการแจ้งเตือนอัตโนมัติเมื่อระดับน้ำเข้าสู่โซนเฝ้าระวัง',
        path: '/',
      }),
      jsonLd: this.#jsonLdForSystem(stations),
    });
  }

  /**
   * หน้ารายละเอียดจุดวัด — พอร์ตเนื้อหาหลักจาก `index.php`
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async station(req, res) {
    const station = await this.#stationService.findBySlug(req.params.slug);
    const today = new Date().toLocaleDateString('sv-SE');

    const [latest, chart24h, chart7d, gallery, report, rois, summary, forecast] = await Promise.all([
      this.#measurementService.latestFor(station.id),
      this.#measurementService.chartSeries(station.id, { hours: 24 }),
      this.#measurementService.chartSeries(station.id, { hours: 24 * 7 }),
      this.#measurementService.gallery(station.id, 12),
      this.#reportService.findFor(station.id, today),
      this.#roiService.listForStation(station.id),
      this.#measurementService.summarize(station.id, {
        from: `${today} 00:00:00`, to: `${today} 23:59:59`,
      }),
      this.#measurementService.forecast(station.id, { hours: 6, historyHours: 24 }),
    ]);

    const zone = latest?.zone ?? null;
    const zones = rois.filter((roi) => roi.isMeasurement).flatMap((roi) => roi.zones);
    const calculator = await this.#calibrationService.tryCalculatorFor(station.id);

    // เส้นเทียบค่าสำหรับวาดทับภาพสด (พิกเซล ↔ เมตร)
    const calibrationLines = calculator
      ? calculator.points.map((point) => ({ pixel: point.pixel, meter: point.meter }))
      : [];

    res.render('public/station', {
      title: station.name,
      station: {
        ...station.toJSON(),
        // ⚠️ กล้องที่ต้องยืนยันตัวตนต่อจากเบราว์เซอร์ไม่ได้ (Digest + mixed content + CORS)
        // และการเปิดเผยที่อยู่กล้องสู่สาธารณะก็ไม่จำเป็น — หน้าสาธารณะจึงแสดง
        // ภาพล่าสุดที่ระบบบันทึกไว้แทน ซึ่งอัปเดตทุกรอบการตรวจวัดอยู่แล้ว
        cameraUrl: station.cameraNeedsAuth ? null : station.cameraUrl,
        // บอกหน้าเว็บว่า "มีกล้องแต่ดูสดจากเบราว์เซอร์ไม่ได้" ต่างจาก "ไม่มีกล้องเลย"
        // — ผู้ดูแลต้องแก้คนละอย่างกันโดยสิ้นเชิง
        hasCamera: Boolean(station.cameraUrl),
        publicLiveEnabled: station.publicLiveEnabled,
      },
      latest: latest ? {
        ...latest.toJSON(),
        measuredAtText: PublicController.formatThaiDateTime(latest.measuredAt),
        ageMinutes: PublicController.#minutesSince(latest.measuredAt),
      } : null,
      zone: zone?.toJSON() ?? null,
      zones: zones.map((item) => item.toJSON()),
      rois: rois.map((roi) => roi.toJSON()),
      calibrationLines,
      chart: { last24h: chart24h, last7d: chart7d },
      gallery: gallery.map((item) => ({
        ...item.toJSON(),
        measuredAtText: PublicController.formatThaiDateTime(item.measuredAt),
      })),
      summary: {
        ...summary,
        thaiDate: DailyReport.toThaiDate(today),
      },
      report: report?.toJSON() ?? null,
      forecast,
      zoneLevels: ZoneLevel.all().map((item) => item.toJSON()),
      seo: this.#seo({
        title: `ระดับน้ำ ${station.name}`,
        description: `ติดตามระดับน้ำที่ ${station.name} แบบเรียลไทม์ ` +
                     `${latest?.waterLevelM ? `ระดับล่าสุด ${latest.waterLevelM.value.toFixed(2)} เมตร ` : ''}` +
                     'พร้อมกราฟย้อนหลัง 24 ชั่วโมงและ 7 วัน ภาพจากกล้องวงจรปิด และการแจ้งเตือนอัตโนมัติ',
        path: station.publicPath,
      }),
      jsonLd: this.#jsonLdForStation(station, latest, zone),
    });
  }

  /**
   * API สาธารณะ: ข้อมูลกราฟของจุดวัด
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async apiMeasurements(req, res) {
    const station = await this.#stationService.findBySlug(req.params.slug);
    const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 24 * 366);
    const series = await this.#measurementService.chartSeries(station.id, { hours });
    const latest = await this.#measurementService.latestFor(station.id);

    this.ok(res, {
      station: { slug: station.slug, name: station.name },
      latest: latest ? {
        measuredAt: latest.measuredAt,
        waterLine: latest.waterLine.value,
        waterLevelM: latest.waterLevelM?.value ?? null,
        zone: latest.zone?.toJSON() ?? null,
        imageUrl: latest.imageUrl,
      } : null,
      series,
    }, { hours, points: series.length });
  }

  /**
   * หน้าตรวจสถานะระบบ (`GET /health`)
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @param {object} health ผลการตรวจสถานะจาก `Application`
   * @returns {Promise<void>}
   */
  async health(req, res, health) {
    res.status(health.healthy ? 200 : 503).json({
      success: health.healthy,
      data: health,
    });
  }

  /**
   * `robots.txt`
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async robots(req, res) {
    res.type('text/plain').send([
      'User-agent: *',
      'Allow: /',
      'Disallow: /admin',
      'Disallow: /api/',
      'Disallow: /login',
      '',
      `Sitemap: ${this.#baseUrl}/sitemap.xml`,
    ].join('\n'));
  }

  /**
   * `sitemap.xml` — รวมหน้าแรกและหน้าจุดวัดทุกแห่งที่เปิดใช้งาน
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async sitemap(req, res) {
    const rows = await this.#stationService.overview(null, { activeOnly: true });
    const urls = [
      { loc: `${this.#baseUrl}/`, changefreq: 'hourly', priority: '1.0' },
      ...rows.map(({ station, latest }) => ({
        loc: `${this.#baseUrl}${station.publicPath}`,
        changefreq: 'hourly',
        priority: '0.8',
        lastmod: latest?.measuredAt
          ? new Date(latest.measuredAt).toISOString()
          : null,
      })),
    ];

    const body = urls.map((url) => [
      '  <url>',
      `    <loc>${PublicController.#escapeXml(url.loc)}</loc>`,
      url.lastmod ? `    <lastmod>${url.lastmod}</lastmod>` : null,
      `    <changefreq>${url.changefreq}</changefreq>`,
      `    <priority>${url.priority}</priority>`,
      '  </url>',
    ].filter(Boolean).join('\n')).join('\n');

    res.type('application/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`,
    );
  }

  /**
   * ประกอบข้อมูล SEO สำหรับ view
   * @param {{title: string, description: string, path: string}} params ข้อมูลหน้า
   * @returns {object}
   */
  #seo({ title, description, path }) {
    const canonical = `${this.#baseUrl}${path}`;
    return {
      title,
      description,
      canonical,
      keywords: 'ระดับน้ำ, ตรวจสอบน้ำ, เตือนภัยน้ำท่วม, ระบบตรวจจับน้ำ, water level, monitoring',
      ogType: 'website',
      ogImage: `${this.#baseUrl}/img/share.png`,
      siteName: 'ระบบตรวจวัดระดับน้ำอัตโนมัติ',
      locale: 'th_TH',
    };
  }

  /**
   * JSON-LD ของระบบโดยรวม (`@type: MonitoringSystem` เหมือนระบบเดิม)
   * @param {Array<object>} stations รายการจุดวัด
   * @returns {object}
   */
  #jsonLdForSystem(stations) {
    return {
      '@context': 'https://schema.org',
      '@type': 'MonitoringSystem',
      name: 'ระบบตรวจวัดระดับน้ำอัตโนมัติ',
      description: 'ระบบตรวจวัดระดับน้ำจากภาพกล้องวงจรปิดด้วยปัญญาประดิษฐ์',
      url: `${this.#baseUrl}/`,
      dateModified: new Date().toISOString(),
      hasPart: stations.map((station) => ({
        '@type': 'Place',
        name: station.name,
        url: `${this.#baseUrl}${station.publicPath}`,
        ...(station.latitude !== null && station.longitude !== null ? {
          geo: {
            '@type': 'GeoCoordinates',
            latitude: station.latitude,
            longitude: station.longitude,
          },
        } : {}),
      })),
    };
  }

  /**
   * JSON-LD ของจุดวัดหนึ่งแห่ง
   * @param {import('../models/Station.js').Station} station จุดวัด
   * @param {import('../models/Measurement.js').Measurement|null} latest ค่าวัดล่าสุด
   * @param {ZoneLevel|null} zone โซนปัจจุบัน
   * @returns {object}
   */
  #jsonLdForStation(station, latest, zone) {
    return {
      '@context': 'https://schema.org',
      '@type': 'MonitoringSystem',
      name: `ระบบตรวจวัดระดับน้ำ ${station.name}`,
      url: `${this.#baseUrl}${station.publicPath}`,
      dateModified: latest?.measuredAt
        ? new Date(latest.measuredAt).toISOString()
        : new Date().toISOString(),
      location: {
        '@type': 'Place',
        name: station.name,
        ...(station.latitude !== null && station.longitude !== null ? {
          geo: {
            '@type': 'GeoCoordinates',
            latitude: station.latitude,
            longitude: station.longitude,
          },
        } : {}),
      },
      ...(latest?.waterLevelM ? {
        measurementTechnique: 'การตรวจจับผิวน้ำจากภาพด้วยปัญญาประดิษฐ์',
        value: {
          '@type': 'QuantitativeValue',
          value: latest.waterLevelM.value,
          unitCode: 'MTR',
          description: zone ? `สถานะ: ${zone.label}` : undefined,
        },
      } : {}),
    };
  }

  /**
   * จัดรูปแบบวันเวลาเป็นภาษาไทยพร้อมปี พ.ศ.
   * @param {Date|string} value เวลา
   * @returns {string}
   */
  static formatThaiDateTime(value) {
    if (!value) return '—';
    const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear() + 543} เวลา ${hh}:${mm} น.`;
  }

  /**
   * จำนวนนาทีที่ผ่านไปนับจากเวลาที่ระบุ
   * @param {Date|string} value เวลา
   * @returns {number|null}
   */
  static #minutesSince(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return Math.floor((Date.now() - date.getTime()) / 60000);
  }

  /**
   * หนีอักขระพิเศษของ XML
   * @param {string} value ข้อความ
   * @returns {string}
   */
  static #escapeXml(value) {
    return String(value).replace(/[<>&'"]/g, (char) => ({
      '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
    }[char]));
  }
}
