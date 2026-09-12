import { BaseService } from '../core/BaseService.js';
import { AuditLog } from '../models/AuditLog.js';

/**
 * บริการบันทึกการใช้งานระบบ (audit trail)
 *
 * ออกแบบให้**ไม่มีวันทำให้การทำงานหลักล้มเหลว** — ถ้าบันทึก log ไม่ได้จะเขียนลงไฟล์ log
 * แทนแล้วปล่อยผ่าน เพราะการที่ audit ล้มเหลวไม่ควรทำให้ผู้ใช้บันทึกข้อมูลไม่ได้
 *
 * ผู้ดูแลสูงสุดผ่านทุกด่านสิทธิ์ แต่**ยังถูกบันทึกที่นี่ทุกครั้ง**
 */
export class AuditService extends BaseService {
  /** @type {import('../repositories/AuditLogRepository.js').AuditLogRepository} */
  #auditRepository;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../repositories/AuditLogRepository.js').AuditLogRepository} deps.auditRepository ที่เก็บบันทึก
   * @param {import('../core/Logger.js').Logger} [deps.logger] ตัวบันทึกเหตุการณ์
   */
  constructor({ auditRepository, logger }) {
    super(auditRepository, logger);
    this.#auditRepository = auditRepository;
  }

  /**
   * บันทึกการกระทำหนึ่งรายการ
   * @param {object} entry ข้อมูลการกระทำ
   * @param {number|null} [entry.actorId] รหัสผู้กระทำ (null = ระบบ)
   * @param {string} [entry.actorLabel='ระบบ'] ชื่อผู้กระทำ
   * @param {string} entry.action การกระทำ เช่น `station.update`
   * @param {string} entry.resourceType ชนิดทรัพยากร
   * @param {string|number|null} [entry.resourceId] รหัสทรัพยากร
   * @param {object|null} [entry.beforeData] ข้อมูลก่อนเปลี่ยน
   * @param {object|null} [entry.afterData] ข้อมูลหลังเปลี่ยน
   * @param {string|null} [entry.ip] หมายเลข IP
   * @param {string|null} [entry.userAgent] ข้อมูลเบราว์เซอร์
   * @returns {Promise<void>} ไม่โยนข้อผิดพลาดออกไปเด็ดขาด
   */
  async record(entry) {
    try {
      const log = new AuditLog({
        actorId: entry.actorId ?? null,
        actorLabel: entry.actorLabel ?? 'ระบบ',
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId ?? null,
        beforeData: AuditService.#sanitize(entry.beforeData),
        afterData: AuditService.#sanitize(entry.afterData),
        ip: entry.ip ?? null,
        userAgent: entry.userAgent ?? null,
      });
      log.validate();
      await this.#auditRepository.create(log);
    } catch (error) {
      this.logger.error('failed to write audit log', {
        action: entry?.action, message: error.message,
      });
    }
  }

  /**
   * บันทึกจากบริบทของคำขอ HTTP — ดึง IP และ user agent ให้อัตโนมัติ
   * @param {object} req วัตถุ request
   * @param {object} entry ข้อมูลการกระทำ (ไม่ต้องใส่ actor, ip, userAgent)
   * @returns {Promise<void>}
   */
  async recordFromRequest(req, entry) {
    return this.record({
      ...entry,
      actorId: req.user?.id ?? null,
      actorLabel: req.user?.username ?? 'ผู้ใช้ที่ไม่ระบุตัวตน',
      ip: AuditService.clientIp(req),
      userAgent: req.get?.('user-agent') ?? null,
    });
  }

  /**
   * ค้นบันทึกตามตัวกรอง
   * @param {object} filters ตัวกรอง
   * @returns {Promise<{items: Array<AuditLog>, total: number}>}
   */
  async search(filters) {
    return this.#auditRepository.search(filters);
  }

  /**
   * รายการการกระทำที่พบในระบบ — ใช้เติมตัวเลือกในตัวกรอง
   * @returns {Promise<Array<string>>}
   */
  async knownActions() {
    return this.#auditRepository.distinctActions();
  }

  /**
   * ดึงหมายเลข IP ของผู้เรียกจากคำขอ
   * @param {object} req วัตถุ request
   * @returns {string|null}
   */
  static clientIp(req) {
    const forwarded = req.get?.('x-forwarded-for');
    if (forwarded) return String(forwarded).split(',')[0].trim().slice(0, 45);
    return (req.ip ?? req.socket?.remoteAddress ?? null)?.slice(0, 45) ?? null;
  }

  /**
   * ตัดข้อมูลอ่อนไหวออกก่อนบันทึก — ห้าม audit log เก็บรหัสผ่านหรือ token
   * @param {object|null} data ข้อมูลดิบ
   * @returns {object|null}
   */
  static #sanitize(data) {
    if (!data || typeof data !== 'object') return data ?? null;
    const blocked = ['password', 'passwordhash', 'password_hash', 'token', 'secret',
      'accesstoken', 'access_token', 'csrf', 'sid', 'token_hash'];
    const output = {};
    for (const [key, value] of Object.entries(data)) {
      output[key] = blocked.includes(key.toLowerCase())
        ? '[REDACTED]'
        : (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
          ? AuditService.#sanitize(value) : value);
    }
    return output;
  }
}
