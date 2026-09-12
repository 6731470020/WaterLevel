import { BaseService } from '../core/BaseService.js';
import { EventBus } from '../core/EventBus.js';
import { NotFoundError } from '../core/errors/index.js';
import { BroadcastLog } from '../models/BroadcastLog.js';
import { ZoneLevel } from '../models/values/ZoneLevel.js';

/**
 * บริการประเมินและส่งการแจ้งเตือน
 *
 * **กฎการส่ง** (CLAUDE.md ข้อ 6.5) — ระบบเดิมยิงทุกชั่วโมงตลอดเวลาที่อยู่ในโซนวิกฤต
 * ระบบใหม่ส่งเมื่อเข้าเงื่อนไขข้อใดข้อหนึ่งเท่านั้น:
 * 1. โซน**เปลี่ยนไปในทางที่แย่ลง** (ส่งทันทีไม่ต้องรอ cooldown)
 * 2. ครบ `alertCooldownMinutes` นับจากครั้งล่าสุดของจุดวัดนั้น
 *
 * บริการนี้ไม่รู้จัก LINE โดยตรง — สื่อสารผ่าน `NotificationChannel` เท่านั้น
 * จึงสลับไปช่องทางอื่นได้โดยไม่แก้โค้ดที่นี่
 */
export class AlertService extends BaseService {
  /** @type {import('../repositories/AlertStateRepository.js').AlertStateRepository} */
  #alertStateRepository;
  /** @type {import('../repositories/BroadcastLogRepository.js').BroadcastLogRepository} */
  #broadcastLogRepository;
  /** @type {import('../repositories/StationRepository.js').StationRepository} */
  #stationRepository;
  /** @type {import('../repositories/LineRepository.js').LineRepository} */
  #lineRepository;
  /** @type {import('./notification/NotificationChannel.js').NotificationChannel} */
  #channel;
  /** @type {import('./notification/MessageFactory.js').MessageFactory} */
  #messageBuilder;
  /** @type {import('./PermissionService.js').PermissionService} */
  #permissionService;
  /** @type {EventBus} */
  #eventBus;
  /** @type {string} */
  #baseUrl;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../repositories/AlertStateRepository.js').AlertStateRepository} deps.alertStateRepository ที่เก็บสถานะการแจ้งเตือน
   * @param {import('../repositories/BroadcastLogRepository.js').BroadcastLogRepository} deps.broadcastLogRepository ที่เก็บบันทึกการส่ง
   * @param {import('../repositories/StationRepository.js').StationRepository} deps.stationRepository ที่เก็บจุดวัด
   * @param {import('../repositories/LineRepository.js').LineRepository} deps.lineRepository ที่เก็บกลุ่ม LINE
   * @param {import('./notification/NotificationChannel.js').NotificationChannel} deps.channel ช่องทางแจ้งเตือน
   * @param {import('./notification/MessageFactory.js').MessageFactory} deps.messageBuilder ตัวสร้างข้อความ
   * @param {import('./PermissionService.js').PermissionService} deps.permissionService บริการสิทธิ์
   * @param {EventBus} deps.eventBus ช่องทางเหตุการณ์
   * @param {string} deps.baseUrl URL ฐานของระบบ
   * @param {import('../core/Logger.js').Logger} [deps.logger] ตัวบันทึกเหตุการณ์
   */
  constructor({
    alertStateRepository, broadcastLogRepository, stationRepository, lineRepository,
    channel, messageBuilder, permissionService, eventBus, baseUrl, logger,
  }) {
    super(broadcastLogRepository, logger);
    this.#alertStateRepository = alertStateRepository;
    this.#broadcastLogRepository = broadcastLogRepository;
    this.#stationRepository = stationRepository;
    this.#lineRepository = lineRepository;
    this.#channel = channel;
    this.#messageBuilder = messageBuilder;
    this.#permissionService = permissionService;
    this.#eventBus = eventBus;
    this.#baseUrl = String(baseUrl ?? '').replace(/\/+$/, '');
  }

  /**
   * ตัดสินว่าควรส่งการแจ้งเตือนหรือไม่ — **ตรรกะบริสุทธิ์ ไม่ส่งอะไรจริง**
   *
   * แยกออกมาเพื่อให้ทดสอบกฎ cooldown ได้โดยไม่ต้องยิงข้อความจริง
   *
   * @param {object} params ข้อมูลที่ใช้ตัดสิน
   * @param {import('../models/Station.js').Station} params.station จุดวัด
   * @param {ZoneLevel|null} params.zone โซนปัจจุบัน
   * @param {import('../models/StationAlertState.js').StationAlertState} params.state สถานะการแจ้งเตือนล่าสุด
   * @returns {{shouldSend: boolean, reason: string, trigger: string|null}}
   */
  evaluate({ station, zone, state }) {
    if (!zone) {
      return { shouldSend: false, reason: 'ยังหาโซนของค่าวัดนี้ไม่ได้', trigger: null };
    }
    if (!station.shouldAlertFor(zone)) {
      return {
        shouldSend: false,
        reason: `โซน "${zone.label}" ไม่ได้ตั้งค่าให้แจ้งเตือนสำหรับจุดวัดนี้`,
        trigger: null,
      };
    }

    // เงื่อนไขที่ 1 — สถานการณ์แย่ลง ส่งทันทีโดยไม่รอ cooldown
    if (ZoneLevel.hasWorsened(state.lastAlertedZone, zone)) {
      return {
        shouldSend: true,
        reason: state.lastAlertedZone
          ? `สถานการณ์แย่ลงจาก "${state.lastAlertedZone.label}" เป็น "${zone.label}"`
          : `เข้าสู่โซน "${zone.label}" เป็นครั้งแรก`,
        trigger: 'ZONE_WORSENED',
      };
    }

    // เงื่อนไขที่ 2 — ยังอยู่ในโซนเดิม ต้องรอให้พ้น cooldown
    if (state.isCooldownOver(station.alertCooldownMinutes)) {
      return {
        shouldSend: true,
        reason: `ยังอยู่ในโซน "${zone.label}" และพ้นระยะกันแจ้งเตือนซ้ำ ` +
                `${station.alertCooldownMinutes} นาทีแล้ว`,
        trigger: 'COOLDOWN_ELAPSED',
      };
    }

    const remaining = Math.ceil(station.alertCooldownMinutes - state.minutesSinceLastAlert);
    return {
      shouldSend: false,
      reason: `เพิ่งแจ้งเตือนไป ต้องรออีก ${remaining} นาที`,
      trigger: null,
    };
  }

  /**
   * ประเมินและส่งการแจ้งเตือนจากค่าวัดที่เพิ่งบันทึก
   *
   * เป็นตัวจัดการเหตุการณ์ `measurement.recorded` — เชื่อมโดย `ServiceContainer`
   *
   * @param {object} params ข้อมูลค่าวัด
   * @param {import('../models/Station.js').Station} params.station จุดวัด
   * @param {import('../models/Measurement.js').Measurement} params.measurement ค่าวัด
   * @param {ZoneLevel|null} params.zone โซนที่ตกอยู่
   * @returns {Promise<{sent: boolean, reason: string}>}
   */
  async evaluateAndSend({ station, measurement, zone }) {
    const state = await this.#alertStateRepository.findByStation(station.id);
    const decision = this.evaluate({ station, zone, state });

    if (!decision.shouldSend) {
      this.logger.debug('alert skipped', { stationId: station.id, reason: decision.reason });
      return { sent: false, reason: decision.reason };
    }

    const result = await this.#dispatch({
      station, measurement, zone, messageType: 'ALERT', triggeredBy: null,
    });

    if (result.success) {
      await this.#alertStateRepository.recordAlert(station.id, zone.key);
      this.#eventBus.publish(EventBus.EVENTS.ALERT_SENT, {
        station, zone, trigger: decision.trigger,
      });
    }
    return { sent: result.success, reason: decision.reason };
  }

  /**
   * ส่งการแจ้งเตือนด้วยตนเองจากหน้าผู้ดูแล (สิทธิ์ `alert.broadcast`)
   * @param {number} stationId รหัสจุดวัด
   * @param {object} context ข้อมูลผู้กระทำ
   * @param {import('../models/User.js').User} context.actor ผู้สั่งส่ง
   * @param {import('../models/Measurement.js').Measurement|null} context.measurement ค่าวัดที่ต้องการแนบ
   * @returns {Promise<{sent: boolean, reason: string}>}
   * @throws {NotFoundError} เมื่อไม่พบจุดวัดหรือยังไม่มีค่าวัด
   */
  async sendManual(stationId, { actor, measurement }) {
    this.#permissionService.assertStationAccess(actor, stationId);
    const station = await this.#stationRepository.findById(stationId);
    if (!station) throw new NotFoundError('ไม่พบจุดวัดที่ต้องการ');
    if (!measurement) throw new NotFoundError('ยังไม่มีค่าวัดของจุดวัดนี้ให้แจ้งเตือน');

    const result = await this.#dispatch({
      station,
      measurement,
      zone: measurement.zone ?? ZoneLevel.NORMAL,
      messageType: 'ALERT',
      triggeredBy: actor?.id ?? null,
    });

    if (result.success && measurement.zone) {
      await this.#alertStateRepository.recordAlert(station.id, measurement.zone.key);
    }
    return {
      sent: result.success,
      reason: result.success ? 'ส่งการแจ้งเตือนแล้ว' : `ส่งไม่สำเร็จ: ${result.error}`,
    };
  }

  /**
   * ส่งข้อความทดสอบไปยังกลุ่มที่ระบุ
   * @param {string|null} target รหัสกลุ่มปลายทาง (null = ใช้ค่าเริ่มต้น)
   * @param {import('../models/User.js').User} actor ผู้สั่งส่ง
   * @returns {Promise<{sent: boolean, error?: string}>}
   */
  async sendTest(target, actor) {
    const message = this.#messageBuilder.buildTest();
    const log = await this.#broadcastLogRepository.create(new BroadcastLog({
      stationId: null, messageType: 'TEST', channel: this.#channel.channel,
      target, messageContent: message, status: 'PENDING', triggeredBy: actor?.id ?? null,
    }));

    const result = await this.#channel.send(message, { target });
    await this.#broadcastLogRepository.markResult(log.id, {
      status: result.success ? 'SENT' : 'FAILED',
      response: result.response ?? null,
      errorMessage: result.error ?? null,
    });
    return { sent: result.success, error: result.error };
  }

  /**
   * ประวัติการแจ้งเตือนตามขอบเขตสิทธิ์
   * @param {import('../models/User.js').User} user ผู้ใช้
   * @param {object} [filters={}] ตัวกรอง
   * @returns {Promise<{items: Array<BroadcastLog>, total: number}>}
   */
  async history(user, filters = {}) {
    const scoped = this.#permissionService.applyStationScope(user, filters);
    return this.#broadcastLogRepository.search(scoped);
  }

  /**
   * ประกอบข้อความ ส่ง และบันทึกผลลง `broadcast_logs` เสมอ
   *
   * บันทึกแถวสถานะ `PENDING` ก่อนส่ง แล้วอัปเดตผลทีหลัง เพื่อให้แม้โปรเซสตายกลางคัน
   * ก็ยังมีร่องรอยว่าเคยพยายามส่ง
   *
   * @param {object} params ข้อมูลการส่ง
   * @param {import('../models/Station.js').Station} params.station จุดวัด
   * @param {import('../models/Measurement.js').Measurement} params.measurement ค่าวัด
   * @param {ZoneLevel} params.zone โซน
   * @param {string} params.messageType ชนิดข้อความ
   * @param {number|null} params.triggeredBy รหัสผู้สั่งส่ง
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async #dispatch({ station, measurement, zone, messageType, triggeredBy }) {
    const imageUrl = this.#publicImageUrl(measurement.imagePath);
    const message = this.#messageBuilder.buildAlert({ station, measurement, zone, imageUrl });
    const target = station.lineGroupId ?? null;

    const log = await this.#broadcastLogRepository.create(new BroadcastLog({
      stationId: station.id,
      messageType,
      zoneKey: zone.key,
      channel: this.#channel.channel,
      target,
      messageContent: { altText: message.altText },
      status: 'PENDING',
      triggeredBy,
    }));

    const result = await this.#channel.send(message, { target });

    await this.#broadcastLogRepository.markResult(log.id, {
      status: result.success ? 'SENT' : 'FAILED',
      response: result.response ?? null,
      errorMessage: result.error ?? null,
    });

    if (result.success) {
      this.logger.info('alert sent', { stationId: station.id, zone: zone.key, target });
    } else {
      this.logger.error('alert failed', { stationId: station.id, error: result.error });
    }
    return result;
  }

  /**
   * แปลงพาธภาพเป็น URL สาธารณะแบบเต็ม
   *
   * LINE ต้องการ URL แบบ HTTPS สาธารณะจึงจะแสดงภาพได้ — ถ้า `BASE_URL` ยังเป็น
   * `http://localhost` จะคืน null เพื่อไม่ให้ส่งข้อความที่ภาพเสีย
   *
   * @param {string|null} imagePath พาธสัมพัทธ์
   * @returns {string|null}
   */
  #publicImageUrl(imagePath) {
    if (!imagePath || !this.#baseUrl.startsWith('https://')) return null;
    return `${this.#baseUrl}/storage/${imagePath}`;
  }
}
