import { join, basename } from 'node:path';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { LegacyDumpReader } from './LegacyDumpReader.js';
import { Station } from '../../src/models/Station.js';
import { Roi } from '../../src/models/Roi.js';
import { CalibrationPoint } from '../../src/models/CalibrationPoint.js';
import { Measurement } from '../../src/models/Measurement.js';
import { ValidationLog } from '../../src/models/ValidationLog.js';
import { DailyReport } from '../../src/models/DailyReport.js';
import { License } from '../../src/models/License.js';
import { User } from '../../src/models/User.js';
import { Role } from '../../src/models/Role.js';
import { ZoneLevel } from '../../src/models/values/ZoneLevel.js';
import { PixelLevel } from '../../src/models/values/PixelLevel.js';
import { WaterLevelCalculator } from '../../src/services/WaterLevelCalculator.js';

/** จำนวนรายการต่อชุดเมื่อคัดลอกไฟล์ภาพ */
const IMAGE_BATCH_SIZE = 100;

/**
 * ตัวย้ายข้อมูลจากระบบเดิม (PHP) เข้าสู่ระบบใหม่ (CLAUDE.md ข้อ 17)
 *
 * **รันซ้ำได้โดยไม่ทำข้อมูลซ้ำ** — ใช้คีย์ธรรมชาติของแต่ละตารางตรวจก่อนเพิ่มเสมอ
 * รองรับ `--dry-run` เพื่อดูผลก่อนลงมือจริง
 *
 * สิ่งที่ระบบใหม่ทำต่างจากการคัดลอกตรง ๆ:
 * - **คำนวณ `water_level_m` ย้อนหลัง** จากจุดเทียบค่าของจุดวัดนั้น (ระบบเดิมไม่เก็บไว้)
 * - แปลง `zone_name` ภาษาไทยเป็น `zone_key` ภาษาอังกฤษ
 * - แตก `config_data` JSON ออกเป็นตาราง `station_rois` และคอลัมน์ PDPA
 * - ย้ายไฟล์ภาพเข้าโครงพาธใหม่ที่แยกตามวันที่
 *
 * ⚠️ เวลาในระบบเดิมเป็นเวลาไทยอยู่แล้ว และระบบใหม่ก็เก็บเป็นเวลาไทย
 * จึงคัดลอกได้ตรง ๆ **ห้ามบวกลบชั่วโมง**
 */
export class LegacyMigrator {
  /**
   * รหัสจุดวัดจำลองที่ใช้เฉพาะโหมด `--dry-run`
   *
   * ต้องเป็นจำนวนบวกเพราะโมเดลตรวจว่ารหัสจุดวัดต้องมากกว่าศูนย์ และต้องอยู่ในช่วง
   * ที่ไม่มีทางชนกับรหัสจริง เพื่อให้ขั้นตอนถัดไปนับจำนวนได้อย่างมีความหมาย
   */
  static DRY_RUN_ID_BASE = 1_000_000;

  /** @type {import('../../src/core/Database.js').Database} */
  #db;
  /** @type {LegacyDumpReader} */
  #reader;
  /** @type {string} */
  #imageSourceDir;
  /** @type {string} */
  #storagePath;
  /** @type {boolean} */
  #dryRun;
  /** @type {(message: string) => void} */
  #report;
  /** @type {Map<number, number>} */
  #stationIdMap = new Map();
  /** @type {Array<string>} */
  #warnings = [];

  /**
   * @param {object} options ตัวเลือก
   * @param {import('../../src/core/Database.js').Database} options.db ตัวเชื่อมฐานข้อมูล
   * @param {string} options.dumpPath พาธไฟล์ `bangpai.sql`
   * @param {string} options.imageSourceDir โฟลเดอร์ภาพของระบบเดิม
   * @param {string} options.storagePath โฟลเดอร์เก็บไฟล์ของระบบใหม่
   * @param {boolean} [options.dryRun=false] ดูผลโดยไม่บันทึกจริง
   * @param {(message: string) => void} [options.report] ฟังก์ชันรายงานความคืบหน้า
   */
  constructor({ db, dumpPath, imageSourceDir, storagePath, dryRun = false, report }) {
    this.#db = db;
    this.#reader = new LegacyDumpReader(dumpPath);
    this.#imageSourceDir = imageSourceDir;
    this.#storagePath = storagePath;
    this.#dryRun = dryRun;
    this.#report = report ?? ((message) => process.stdout.write(`${message}\n`));
  }

  /** @returns {Array<string>} คำเตือนที่พบระหว่างย้ายข้อมูล */
  get warnings() { return [...this.#warnings]; }

  /**
   * ย้ายข้อมูลทั้งหมดตามลำดับที่ Foreign Key ต้องการ
   * @param {{skipImages?: boolean}} [options={}] ตัวเลือก
   * @returns {Promise<object>} สรุปผลแต่ละขั้น
   */
  async run({ skipImages = false } = {}) {
    if (this.#dryRun) {
      this.#report('\n  ⚠️  โหมด --dry-run: จะไม่บันทึกข้อมูลจริง\n');
    }

    const summary = {};
    summary.licenses = await this.#migrateLicenses();
    summary.stations = await this.#migrateStations();
    summary.calibration = await this.#migrateCalibration();
    summary.measurements = await this.#migrateMeasurements();
    summary.validationLogs = await this.#migrateValidationLogs();
    summary.dailyReports = await this.#migrateDailyReports();
    summary.line = await this.#migrateLine();
    summary.users = await this.#migrateUsers();
    summary.images = skipImages
      ? { skipped: true }
      : await this.#migrateImages();
    summary.verification = await this.#verify();
    return summary;
  }

  // ─────────────────────────── ใบอนุญาต ───────────────────────────

  /**
   * ย้ายใบอนุญาต
   * @returns {Promise<{inserted: number, skipped: number}>}
   */
  async #migrateLicenses() {
    this.#section('ใบอนุญาต');
    let inserted = 0;
    let skipped = 0;

    for (const row of this.#reader.rows('licenses')) {
      const existing = await this.#db.queryOne(
        'SELECT id FROM licenses WHERE license_key = ?', [row.license_key],
      );
      if (existing) { skipped += 1; continue; }

      const license = new License({
        licenseKey: row.license_key,
        expiredAt: row.expired_at,
        isActive: Boolean(row.is_active),
        contactEmail: row.contact_email,
        contactPhone: row.contact_phone,
        contactLine: row.contact_line,
      });
      license.validate();

      if (!this.#dryRun) {
        await this.#db.execute(
          `INSERT INTO licenses (license_key, expired_at, is_active,
                                 contact_email, contact_phone, contact_line, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [license.licenseKey, license.expiredAt, license.isActive ? 1 : 0,
            license.contactEmail, license.contactPhone, license.contactLine, row.created_at],
        );
      }
      inserted += 1;
    }

    this.#ok(`เพิ่มใหม่ ${inserted} · ข้ามที่มีอยู่แล้ว ${skipped}`);
    return { inserted, skipped };
  }

  // ─────────────────────────── จุดวัดและ ROI ───────────────────────────

  /**
   * ย้ายตาราง `configs` เป็น `stations` พร้อมแตก `config_data` เป็น `station_rois`
   * @returns {Promise<{inserted: number, skipped: number, rois: number}>}
   */
  async #migrateStations() {
    this.#section('จุดวัดและ ROI');
    let inserted = 0;
    let skipped = 0;
    let roiCount = 0;

    for (const row of this.#reader.rows('configs')) {
      const config = LegacyMigrator.#parseJson(row.config_data) ?? {};
      const slug = Station.slugify(row.location_name);

      const existing = await this.#db.queryOne(
        'SELECT id FROM stations WHERE slug = ?', [slug],
      );

      if (existing) {
        this.#stationIdMap.set(row.id, existing.id);
        skipped += 1;
        this.#ok(`ข้ามจุดวัด "${row.location_name}" (มีอยู่แล้ว slug=${slug})`);
        continue;
      }

      const pdpa = config.pdpa ?? {};
      const station = new Station({
        slug,
        name: row.location_name,
        cameraUrl: row.camera_url,
        cameraType: row.camera_type ?? 'm3u8',
        // ขนาดภาพใน config_data แม่นกว่าคอลัมน์ configs เพราะ ROI อ้างอิงค่านี้
        imageWidth: config.image_width ?? row.image_width ?? 704,
        imageHeight: config.image_height ?? row.image_height ?? 576,
        isActive: Boolean(row.is_active),
        pdpaEnabled: pdpa.enabled ?? true,
        pdpaMethod: pdpa.method ?? 'blur',
        pdpaBlurStrength: pdpa.blur_strength ?? 30,
        pdpaConfThreshold: pdpa.conf_threshold ?? 0.3,
        // ระบบเดิมเก็บ URL กล้องที่อาจชี้ IP ภายใน จึงยอมให้ผ่านตอนย้ายข้อมูล
        allowPrivateCameraUrl: true,
      });
      station.validate();

      let stationId = this.#dryRun ? LegacyMigrator.DRY_RUN_ID_BASE + row.id : 0;
      if (!this.#dryRun) {
        const result = await this.#db.execute(
          `INSERT INTO stations (slug, name, camera_url, camera_type, image_width, image_height,
                                 is_active, alert_zone_keys, alert_cooldown_minutes,
                                 pdpa_enabled, pdpa_method, pdpa_blur_strength,
                                 pdpa_conf_threshold, image_retention_days, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [station.slug, station.name, station.cameraUrl, station.cameraType,
            station.imageWidth, station.imageHeight, station.isActive ? 1 : 0,
            JSON.stringify(station.alertZoneKeys), station.alertCooldownMinutes,
            station.pdpaEnabled ? 1 : 0, station.pdpaMethod, station.pdpaBlurStrength,
            station.pdpaConfThreshold, station.imageRetentionDays,
            row.created_at, row.updated_at],
        );
        stationId = result.insertId;
      }

      this.#stationIdMap.set(row.id, stationId);
      inserted += 1;

      // แตก ROI ออกจาก config_data (รองรับทั้ง version 2.0 และ 3.0)
      const rois = Roi.fromLegacy(config, stationId);
      for (const [index, roi] of rois.entries()) {
        if (!this.#dryRun) {
          await this.#db.execute(
            `INSERT INTO station_rois (station_id, name, type, points, zones, sort_order)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [stationId, roi.name, roi.type, JSON.stringify(roi.points),
              JSON.stringify(roi.zones.map((zone) => zone.toJSON())), index],
          );
        }
        roiCount += 1;
      }
      this.#ok(`ย้ายจุดวัด "${station.name}" (${rois.length} ROI, เวอร์ชัน ${config.version ?? '?'})`);
    }

    this.#ok(`เพิ่มใหม่ ${inserted} จุดวัด · ${roiCount} ROI · ข้าม ${skipped}`);
    return { inserted, skipped, rois: roiCount };
  }

  // ─────────────────────────── จุดเทียบค่า ───────────────────────────

  /**
   * ย้าย `pixel_meter_mapping` เป็น `calibration_points`
   * @returns {Promise<{inserted: number, skipped: number}>}
   */
  async #migrateCalibration() {
    this.#section('จุดเทียบค่าพิกเซล-เมตร');
    let inserted = 0;
    let skipped = 0;

    for (const row of this.#reader.rows('pixel_meter_mapping')) {
      const stationId = this.#stationIdMap.get(row.config_id);
      if (!stationId) { skipped += 1; continue; }

      if (!this.#dryRun) {
        const existing = await this.#db.queryOne(
          'SELECT id FROM calibration_points WHERE station_id = ? AND pixel = ?',
          [stationId, row.pixel],
        );
        if (existing) { skipped += 1; continue; }
      }

      const point = new CalibrationPoint({
        stationId, pixel: row.pixel, meter: row.meter, sortOrder: row.sort_order ?? 0,
      });
      point.validate();

      if (!this.#dryRun) {
        await this.#db.execute(
          `INSERT INTO calibration_points (station_id, pixel, meter, sort_order, created_at)
           VALUES (?, ?, ?, ?, ?)`,
          [stationId, point.pixelValue, point.meterValue, point.sortOrder, row.created_at],
        );
      }
      inserted += 1;
    }

    this.#ok(`เพิ่มใหม่ ${inserted} จุด · ข้าม ${skipped}`);
    return { inserted, skipped };
  }

  // ─────────────────────────── ค่าวัด ───────────────────────────

  /**
   * ย้าย `water_history` เป็น `measurements` พร้อมคำนวณ `water_level_m` ย้อนหลัง
   * @returns {Promise<{inserted: number, skipped: number, withMeter: number, zoneMismatch: number}>}
   */
  async #migrateMeasurements() {
    this.#section('ค่าวัดระดับน้ำ');

    const calculators = await this.#buildCalculators();
    const zonesByStation = await this.#buildZones();

    const rows = this.#reader.rows('water_history');
    let inserted = 0;
    let skipped = 0;
    let withMeter = 0;
    let zoneMismatch = 0;

    // ตรวจว่าเคยย้ายไปแล้วหรือยัง โดยดูจากคู่ (จุดวัด, เวลา) ที่มีอยู่
    const existingKeys = new Set(
      (await this.#db.query("SELECT station_id, measured_at FROM measurements WHERE source = 'LEGACY'"))
        .map((row) => `${row.station_id}|${LegacyMigrator.#toKey(row.measured_at)}`),
    );

    for (const row of rows) {
      const stationId = this.#stationIdMap.get(row.config_id);
      if (!stationId) { skipped += 1; continue; }

      const key = `${stationId}|${LegacyMigrator.#toKey(row.timestamp)}`;
      if (existingKeys.has(key)) { skipped += 1; continue; }

      // คำนวณค่าเมตรย้อนหลังจากจุดเทียบค่าของจุดวัดนั้น
      const calculator = calculators.get(stationId);
      let meter = null;
      if (calculator) {
        meter = calculator.pixelToMeter(row.water_line).value;
        withMeter += 1;
      }

      // แปลงชื่อโซนภาษาไทยเป็นคีย์ — เก็บค่าที่ระบบเดิมบันทึกไว้ตามจริง
      const recordedZone = ZoneLevel.fromLabel(row.zone_name);
      const zones = zonesByStation.get(stationId);
      if (recordedZone && zones?.length) {
        const computed = ZoneLevel.resolve(new PixelLevel(row.water_line), zones);
        if (computed.key !== recordedZone.key) zoneMismatch += 1;
      }

      const measurement = new Measurement({
        stationId,
        measuredAt: row.timestamp,
        waterLine: row.water_line,
        waterLevelM: meter,
        zoneKey: recordedZone?.key ?? null,
        processingTime: row.processing_time,
        source: 'LEGACY',
      });
      measurement.validate();

      if (!this.#dryRun) {
        await this.#db.execute(
          `INSERT INTO measurements (station_id, measured_at, water_line, water_level_m,
                                     zone_key, image_path, processing_time, source, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'LEGACY', ?)`,
          [stationId, row.timestamp, row.water_line, meter,
            recordedZone?.key ?? null, row.image_path, row.processing_time, row.created_at],
        );
      }
      inserted += 1;
    }

    this.#ok(`เพิ่มใหม่ ${inserted} · ข้าม ${skipped} · คำนวณค่าเมตรได้ ${withMeter}`);
    if (zoneMismatch) {
      this.#warn(
        `พบ ${zoneMismatch} แถวที่ชื่อโซนเดิมไม่ตรงกับโซนที่คำนวณจากขอบเขตปัจจุบัน — ` +
        'เกิดจากการแก้ตำแหน่งโซนหลังเก็บข้อมูล ระบบเก็บค่าที่บันทึกไว้ ณ เวลานั้นตามจริง',
      );
    }
    return { inserted, skipped, withMeter, zoneMismatch };
  }

  // ─────────────────────────── บันทึกการตรวจความผันผวน ───────────────────────────

  /**
   * ย้าย `water_validation_log` เป็น `validation_logs`
   * @returns {Promise<{inserted: number, skipped: number}>}
   */
  async #migrateValidationLogs() {
    this.#section('บันทึกการตรวจความผันผวน');
    let inserted = 0;
    let skipped = 0;

    const existing = this.#dryRun
      ? { total: 0 }
      : await this.#db.queryOne('SELECT COUNT(*) AS total FROM validation_logs');
    if (Number(existing?.total ?? 0) > 0) {
      this.#ok('มีข้อมูลอยู่แล้ว — ข้ามทั้งหมด');
      return { inserted: 0, skipped: this.#reader.count('water_validation_log') };
    }

    for (const row of this.#reader.rows('water_validation_log')) {
      const stationId = this.#stationIdMap.get(row.config_id);
      if (!stationId) { skipped += 1; continue; }

      const log = new ValidationLog({
        stationId,
        suspectedLevel: row.suspected_level,
        // ระบบเดิมเก็บ 0 เมื่อยืนยันไม่สำเร็จ ระบบใหม่ใช้ NULL ให้ตรงความหมาย
        confirmedLevel: row.success ? row.confirmed_level : null,
        variation: row.variation,
        attempts: row.attempts,
        success: Boolean(row.success),
        note: 'ย้ายจากระบบเดิม',
      });
      log.validate();

      if (!this.#dryRun) {
        await this.#db.execute(
          `INSERT INTO validation_logs (station_id, suspected_level, confirmed_level,
                                        variation, attempts, spread, success, note, created_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
          [stationId, log.suspectedLevel, log.confirmedLevel, log.variation,
            log.attempts, log.success ? 1 : 0, log.note, row.created_at],
        );
      }
      inserted += 1;
    }

    this.#ok(`เพิ่มใหม่ ${inserted} · ข้าม ${skipped}`);
    return { inserted, skipped };
  }

  // ─────────────────────────── รายงานประจำวัน ───────────────────────────

  /**
   * ย้าย `daily_reports`
   *
   * ⚠️ ระบบเดิมตั้งชื่อคอลัมน์ตาม**ค่าพิกเซล**: `min_water_level` = พิกเซลน้อยสุด
   * ซึ่งหมายถึงระดับน้ำ**สูงสุด** จึงต้องสลับชื่อให้ตรงความหมายจริง
   *
   * @returns {Promise<{inserted: number, skipped: number}>}
   */
  async #migrateDailyReports() {
    this.#section('รายงานประจำวัน');
    let inserted = 0;
    let skipped = 0;

    for (const row of this.#reader.rows('daily_reports')) {
      const stationId = this.#stationIdMap.get(row.config_id);
      if (!stationId) { skipped += 1; continue; }

      if (!this.#dryRun) {
        const existing = await this.#db.queryOne(
          'SELECT id FROM daily_reports WHERE station_id = ? AND report_date = ?',
          [stationId, row.report_date],
        );
        if (existing) { skipped += 1; continue; }
      }

      const report = new DailyReport({
        stationId,
        reportDate: row.report_date,
        highestPixel: row.min_water_level,        // พิกเซลน้อยสุด = น้ำสูงสุด
        lowestPixel: row.max_water_level,         // พิกเซลมากสุด = น้ำต่ำสุด
        highestMeter: row.min_water_level_meter,
        lowestMeter: row.max_water_level_meter,
        highestAt: row.min_level_time,
        lowestAt: row.max_level_time,
        imagePath: row.image_path,
      });
      report.validate();

      if (!this.#dryRun) {
        await this.#db.execute(
          `INSERT INTO daily_reports (station_id, report_date, highest_pixel, lowest_pixel,
                                      highest_meter, lowest_meter, highest_at, lowest_at,
                                      measurement_count, image_path, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
          [stationId, report.reportDate, report.highestPixel?.value ?? null,
            report.lowestPixel?.value ?? null, report.highestMeter?.value ?? null,
            report.lowestMeter?.value ?? null, report.highestAt, report.lowestAt,
            report.imagePath, row.created_at],
        );
      }
      inserted += 1;
    }

    this.#ok(`เพิ่มใหม่ ${inserted} · ข้าม ${skipped}`);
    return { inserted, skipped };
  }

  // ─────────────────────────── LINE ───────────────────────────

  /**
   * ย้าย `line_groups` และ `line_users`
   * @returns {Promise<{groups: number, users: number}>}
   */
  async #migrateLine() {
    this.#section('กลุ่มและผู้ติดตาม LINE');
    let groups = 0;
    let users = 0;

    for (const row of this.#reader.rows('line_groups')) {
      const existing = await this.#db.queryOne(
        'SELECT id FROM line_groups WHERE group_id = ?', [row.group_id],
      );
      if (existing) continue;

      if (!this.#dryRun) {
        await this.#db.execute(
          `INSERT INTO line_groups (group_id, type, status, joined_at, last_active_at, left_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          // ระบบเดิมใช้ 'joined' ระบบใหม่ใช้ 'active' ให้ตรงกับ line_users
          [row.group_id, row.type ?? 'group',
            row.status === 'joined' ? 'active' : (row.status ?? 'active'),
            row.joined_at, row.last_active, row.left_at],
        );
      }
      groups += 1;
    }

    for (const row of this.#reader.rows('line_users')) {
      const existing = await this.#db.queryOne(
        'SELECT id FROM line_users WHERE line_user_id = ?', [row.user_id],
      );
      if (existing) continue;

      if (!this.#dryRun) {
        await this.#db.execute(
          `INSERT INTO line_users (line_user_id, status, followed_at, last_active_at, unfollowed_at)
           VALUES (?, ?, ?, ?, ?)`,
          [row.user_id, row.status ?? 'active', row.followed_at, row.last_active, row.unfollowed_at],
        );
      }
      users += 1;
    }

    this.#ok(`กลุ่ม ${groups} · ผู้ติดตาม ${users}`);
    return { groups, users };
  }

  // ─────────────────────────── ผู้ใช้ ───────────────────────────

  /**
   * ย้าย `admin_users` เป็น `users` โดยคงแฮช bcrypt เดิมไว้
   *
   * ตั้ง `hash_algo = 'bcrypt'` และ `must_change_password = 1` เพื่อให้ผู้ใช้เดิม
   * เข้าสู่ระบบด้วยรหัสผ่านเดิมได้ แล้วระบบจะอัปเกรดเป็น scrypt ให้อัตโนมัติ
   *
   * @returns {Promise<{inserted: number, skipped: number}>}
   */
  async #migrateUsers() {
    this.#section('ผู้ใช้ระบบ');
    let inserted = 0;
    let skipped = 0;

    const adminRole = await this.#db.queryOne(
      'SELECT id FROM roles WHERE role_key = ?', [Role.ADMIN],
    );
    if (!adminRole) {
      this.#warn('ไม่พบบทบาท ADMIN — กรุณารัน npm run db:setup ก่อน');
      return { inserted: 0, skipped: 0 };
    }

    for (const row of this.#reader.rows('admin_users')) {
      const existing = await this.#db.queryOne(
        'SELECT id FROM users WHERE username = ? OR email = ?',
        [row.username, row.email ?? `${row.username}@example.com`],
      );
      if (existing) {
        skipped += 1;
        this.#ok(`ข้ามผู้ใช้ "${row.username}" (มีอยู่แล้ว)`);
        continue;
      }

      const user = new User({
        username: row.username,
        email: row.email ?? `${row.username}@example.com`,
        passwordHash: row.password,
        hashAlgo: 'bcrypt',
        fullName: row.username,
        status: 'ACTIVE',
        mustChangePassword: true,
      });
      user.validate();

      if (!this.#dryRun) {
        const result = await this.#db.execute(
          `INSERT INTO users (username, email, password_hash, hash_algo, full_name,
                              status, is_super_admin, must_change_password,
                              last_login_at, created_at)
           VALUES (?, ?, ?, 'bcrypt', ?, 'ACTIVE', 0, 1, ?, ?)`,
          [user.username, user.email, user.passwordHash, user.fullName,
            row.last_login, row.created_at],
        );
        await this.#db.execute(
          'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)',
          [result.insertId, adminRole.id],
        );
        await this.#db.execute(
          "INSERT INTO password_history (user_id, password_hash, hash_algo) VALUES (?, ?, 'bcrypt')",
          [result.insertId, user.passwordHash],
        );
      }
      inserted += 1;
      this.#ok(`ย้ายผู้ใช้ "${user.username}" (bcrypt · ต้องเปลี่ยนรหัสผ่านเมื่อเข้าครั้งแรก)`);
    }

    this.#ok(`เพิ่มใหม่ ${inserted} · ข้าม ${skipped}`);
    return { inserted, skipped };
  }

  // ─────────────────────────── ไฟล์ภาพ ───────────────────────────

  /**
   * คัดลอกไฟล์ภาพเข้าโครงพาธใหม่และอัปเดตคอลัมน์ `image_path`
   *
   * ทำเป็นชุดละ 100 ไฟล์และทำต่อจากจุดที่ค้างได้ — ไฟล์ที่คัดลอกแล้วจะถูกข้าม
   *
   * @returns {Promise<{copied: number, missing: number, alreadyDone: number}>}
   */
  async #migrateImages() {
    this.#section('ไฟล์ภาพ');

    if (!existsSync(this.#imageSourceDir)) {
      this.#warn(`ไม่พบโฟลเดอร์ภาพต้นทาง: ${this.#imageSourceDir} — ข้ามขั้นตอนนี้`);
      return { copied: 0, missing: 0, alreadyDone: 0 };
    }

    const pending = await this.#db.query(
      `SELECT id, measured_at, station_id, image_path FROM measurements
       WHERE source = 'LEGACY' AND image_path IS NOT NULL AND image_path LIKE 'uploads/%'
       ORDER BY id`,
    );

    let copied = 0;
    let missing = 0;
    const alreadyDone = await this.#db.queryOne(
      `SELECT COUNT(*) AS total FROM measurements
       WHERE source = 'LEGACY' AND image_path LIKE 'images/%'`,
    );

    for (let offset = 0; offset < pending.length; offset += IMAGE_BATCH_SIZE) {
      const batch = pending.slice(offset, offset + IMAGE_BATCH_SIZE);

      for (const row of batch) {
        const sourceFile = join(this.#imageSourceDir, basename(row.image_path));
        if (!existsSync(sourceFile)) { missing += 1; continue; }

        const measuredAt = new Date(row.measured_at);
        const target = LegacyMigrator.#buildImagePath('cron', row.station_id, measuredAt);
        const targetFile = join(this.#storagePath, target);

        if (!this.#dryRun) {
          await mkdir(join(targetFile, '..'), { recursive: true });
          await copyFile(sourceFile, targetFile);
          await this.#db.execute(
            'UPDATE measurements SET image_path = ? WHERE id = ?', [target, row.id],
          );
        }
        copied += 1;
      }

      this.#report(`    … คัดลอกแล้ว ${Math.min(offset + IMAGE_BATCH_SIZE, pending.length)}/${pending.length}`);
    }

    this.#ok(`คัดลอก ${copied} ไฟล์ · ไม่พบต้นฉบับ ${missing} · เคยคัดลอกแล้ว ${alreadyDone?.total ?? 0}`);
    if (missing) {
      this.#warn(`มี ${missing} ค่าวัดที่อ้างไฟล์ภาพซึ่งไม่มีอยู่ในโฟลเดอร์ต้นทาง`);
    }
    return { copied, missing, alreadyDone: Number(alreadyDone?.total ?? 0) };
  }

  // ─────────────────────────── ตรวจสอบผล ───────────────────────────

  /**
   * ตรวจสอบว่าข้อมูลย้ายครบและค่าสำคัญตรงกับต้นทาง (CLAUDE.md ข้อ 17.9)
   * @returns {Promise<Array<{check: string, ok: boolean, detail: string}>>}
   */
  async #verify() {
    this.#section('ตรวจสอบผลการย้ายข้อมูล');
    const checks = [];

    /**
     * เพิ่มผลการตรวจหนึ่งข้อ
     * @param {string} label ชื่อรายการตรวจ
     * @param {boolean} ok ผ่านหรือไม่
     * @param {string} detail รายละเอียด
     */
    const add = (label, ok, detail) => {
      checks.push({ check: label, ok, detail });
      this.#report(`  ${ok ? '✓' : '✗'} ${label}: ${detail}`);
      if (!ok) this.#warnings.push(`${label} — ${detail}`);
    };

    if (this.#dryRun) {
      this.#report('  (ข้ามการตรวจสอบในโหมด --dry-run)');
      return checks;
    }

    // 1. จำนวนแถวค่าวัดต้องตรงกัน
    const sourceCount = this.#reader.count('water_history');
    const targetRow = await this.#db.queryOne(
      "SELECT COUNT(*) AS total FROM measurements WHERE source = 'LEGACY'",
    );
    const targetCount = Number(targetRow?.total ?? 0);
    add('จำนวนค่าวัด', sourceCount === targetCount,
      `ต้นทาง ${sourceCount} · ปลายทาง ${targetCount}`);

    // 2. ค่าพิกเซลสูงสุด/ต่ำสุดต้องตรงกัน
    const sourceRows = this.#reader.rows('water_history');
    const sourcePixels = sourceRows.map((row) => row.water_line);
    const bounds = await this.#db.queryOne(
      `SELECT MIN(water_line) AS min_px, MAX(water_line) AS max_px
       FROM measurements WHERE source = 'LEGACY'`,
    );
    const sourceMin = Math.min(...sourcePixels);
    const sourceMax = Math.max(...sourcePixels);
    add('ช่วงค่าพิกเซล',
      Number(bounds?.min_px) === sourceMin && Number(bounds?.max_px) === sourceMax,
      `ต้นทาง ${sourceMin}–${sourceMax} · ปลายทาง ${bounds?.min_px}–${bounds?.max_px}`);

    // 3. ค่าวัดทุกแถวต้องมีค่าเมตร (เมื่อจุดเทียบค่าครบ)
    const noMeter = await this.#db.queryOne(
      `SELECT COUNT(*) AS total FROM measurements
       WHERE source = 'LEGACY' AND water_level_m IS NULL`,
    );
    add('การคำนวณค่าเมตรย้อนหลัง', Number(noMeter?.total ?? 0) === 0,
      `ไม่มีค่าเมตร ${noMeter?.total ?? 0} แถว`);

    // 4. ทุกค่าวัดต้องยังอ้างไฟล์ภาพเหมือนต้นทาง
    const sourceWithImage = sourceRows.filter((row) => row.image_path).length;
    const targetWithImage = await this.#db.queryOne(
      `SELECT COUNT(*) AS total FROM measurements
       WHERE source = 'LEGACY' AND image_path IS NOT NULL`,
    );
    add('จำนวนค่าวัดที่มีภาพ',
      sourceWithImage === Number(targetWithImage?.total ?? 0),
      `ต้นทาง ${sourceWithImage} · ปลายทาง ${targetWithImage?.total ?? 0}`);

    return checks;
  }

  // ─────────────────────────── ตัวช่วยภายใน ───────────────────────────

  /**
   * สร้างตัวคำนวณค่าเมตรของแต่ละจุดวัด
   *
   * อ่านจุดเทียบค่าจาก**ไฟล์ dump โดยตรง** ไม่ใช่จากฐานข้อมูลปลายทาง เพราะ:
   * - โหมด `--dry-run` ยังไม่ได้บันทึกอะไรลงฐานข้อมูล จึงต้องคำนวณจากต้นทาง
   * - ค่าที่ใช้คำนวณย้อนหลังควรมาจากแหล่งเดียวกับข้อมูลที่กำลังย้าย
   *
   * @returns {Promise<Map<number, WaterLevelCalculator>>} รหัสจุดวัดปลายทาง → ตัวคำนวณ
   */
  async #buildCalculators() {
    const byLegacyStation = new Map();
    for (const row of this.#reader.rows('pixel_meter_mapping')) {
      if (!byLegacyStation.has(row.config_id)) byLegacyStation.set(row.config_id, []);
      byLegacyStation.get(row.config_id).push({ pixel: row.pixel, meter: row.meter });
    }

    const calculators = new Map();
    for (const [legacyId, stationId] of this.#stationIdMap) {
      const points = byLegacyStation.get(legacyId) ?? [];
      const calculator = WaterLevelCalculator.tryCreate(points);

      if (calculator) {
        calculators.set(stationId, calculator);
      } else {
        this.#warn(
          `จุดวัดเดิม #${legacyId} มีจุดเทียบค่า ${points.length} จุด (ต้องมีอย่างน้อย 2) — ` +
          'ค่าวัดที่ย้ายมาจะไม่มีค่าเมตร (ระบบไม่ใช้ค่าสำรอง)',
        );
      }
    }
    return calculators;
  }

  /**
   * โหลดขอบเขตโซนของแต่ละจุดวัดจากไฟล์ dump เพื่อใช้เทียบกับชื่อโซนที่บันทึกไว้เดิม
   * @returns {Promise<Map<number, Array<object>>>}
   */
  async #buildZones() {
    const map = new Map();
    for (const row of this.#reader.rows('configs')) {
      const stationId = this.#stationIdMap.get(row.id);
      if (!stationId) continue;

      const config = LegacyMigrator.#parseJson(row.config_data) ?? {};
      const zones = Roi.fromLegacy(config, stationId)
        .filter((roi) => roi.isMeasurement)
        .flatMap((roi) => roi.zones.map((zone) => zone.toJSON()));
      map.set(stationId, zones);
    }
    return map;
  }

  /**
   * สร้างพาธไฟล์ภาพตามโครงใหม่
   * @param {string} kind ชนิดภาพ
   * @param {number} stationId รหัสจุดวัด
   * @param {Date} at เวลาที่จับภาพ
   * @returns {string} พาธสัมพัทธ์
   */
  static #buildImagePath(kind, stationId, at) {
    const yyyy = String(at.getFullYear());
    const mm = String(at.getMonth() + 1).padStart(2, '0');
    const dd = String(at.getDate()).padStart(2, '0');
    const hh = String(at.getHours()).padStart(2, '0');
    const mi = String(at.getMinutes()).padStart(2, '0');
    const ss = String(at.getSeconds()).padStart(2, '0');
    return `images/${kind}/${yyyy}/${mm}/${dd}/${kind}-${stationId}-${yyyy}${mm}${dd}-${hh}${mi}${ss}.jpg`;
  }

  /**
   * แปลงเวลาเป็นคีย์เปรียบเทียบ (ตัดเศษวินาทีและรูปแบบที่ต่างกันออก)
   * @param {Date|string} value เวลา
   * @returns {string}
   */
  static #toKey(value) {
    if (value instanceof Date) return value.toLocaleString('sv-SE');
    return String(value).slice(0, 19).replace('T', ' ');
  }

  /**
   * แปลง JSON อย่างปลอดภัย
   * @param {*} value ค่าดิบ
   * @returns {*|null}
   */
  static #parseJson(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return null; }
  }

  /**
   * พิมพ์หัวข้อขั้นตอน
   * @param {string} title หัวข้อ
   */
  #section(title) { this.#report(`\n▸ ${title}`); }

  /**
   * พิมพ์ข้อความสำเร็จ
   * @param {string} message ข้อความ
   */
  #ok(message) { this.#report(`  ✓ ${message}`); }

  /**
   * พิมพ์และเก็บคำเตือน
   * @param {string} message ข้อความ
   */
  #warn(message) {
    this.#warnings.push(message);
    this.#report(`  ⚠ ${message}`);
  }
}
