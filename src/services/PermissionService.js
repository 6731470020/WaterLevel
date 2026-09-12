import { BaseService } from '../core/BaseService.js';
import { ForbiddenError, NotFoundError } from '../core/errors/index.js';
import { EventBus } from '../core/EventBus.js';

/**
 * บริการตรวจสิทธิ์และขอบเขตจุดวัด — **ชั้นป้องกันที่ 2** ของระบบสิทธิ์
 *
 * ด่าน middleware กันคำขอที่ผิดชัดเจนไว้ชั้นแรก แต่ชั้นนี้คือชั้นที่รับประกันจริง
 * เพราะทุกคำสั่งที่ดึงข้อมูลหลายจุดวัดต้องผ่าน `applyStationScope()` ก่อนเสมอ
 * ห้าม Controller เรียก `stationRepository.findAll()` ตรง ๆ (CLAUDE.md ข้อ 8.4)
 */
export class PermissionService extends BaseService {
  /** @type {import('../repositories/PermissionRepository.js').PermissionRepository} */
  #permissionRepository;
  /** @type {import('../repositories/SessionRepository.js').SessionRepository} */
  #sessionRepository;
  /** @type {import('../repositories/UserRepository.js').UserRepository} */
  #userRepository;
  /** @type {import('../core/MemoryCache.js').MemoryCache} */
  #cache;
  /** @type {EventBus} */
  #eventBus;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../repositories/PermissionRepository.js').PermissionRepository} deps.permissionRepository ที่เก็บสิทธิ์
   * @param {import('../repositories/SessionRepository.js').SessionRepository} deps.sessionRepository ที่เก็บ session
   * @param {import('../repositories/UserRepository.js').UserRepository} deps.userRepository ที่เก็บผู้ใช้
   * @param {import('../core/MemoryCache.js').MemoryCache} deps.cache แคชในหน่วยความจำ
   * @param {EventBus} deps.eventBus ช่องทางเหตุการณ์
   * @param {import('../core/Logger.js').Logger} [deps.logger] ตัวบันทึกเหตุการณ์
   */
  constructor({ permissionRepository, sessionRepository, userRepository, cache, eventBus, logger }) {
    super(permissionRepository, logger);
    this.#permissionRepository = permissionRepository;
    this.#sessionRepository = sessionRepository;
    this.#userRepository = userRepository;
    this.#cache = cache;
    this.#eventBus = eventBus;
  }

  /**
   * ตรวจว่าผู้ใช้มีสิทธิ์ที่ระบุหรือไม่
   * @param {import('../models/User.js').User|null} user ผู้ใช้
   * @param {string} permissionKey คีย์สิทธิ์
   * @returns {boolean}
   */
  can(user, permissionKey) {
    return Boolean(user?.can(permissionKey));
  }

  /**
   * ตรวจสิทธิ์และโยนข้อผิดพลาดเมื่อไม่ผ่าน
   * @param {import('../models/User.js').User|null} user ผู้ใช้
   * @param {string} permissionKey คีย์สิทธิ์
   * @returns {void}
   * @throws {ForbiddenError} เมื่อไม่มีสิทธิ์
   */
  assertCan(user, permissionKey) {
    if (!this.can(user, permissionKey)) {
      throw new ForbiddenError('คุณไม่มีสิทธิ์ใช้งานส่วนนี้');
    }
  }

  /**
   * เติมขอบเขตจุดวัดลงในเงื่อนไขการค้นหา — **ต้องเรียกก่อนดึงข้อมูลหลายจุดวัดเสมอ**
   *
   * คืนอ็อบเจกต์ที่มี `stationIds` เป็น `null` เมื่อผู้ใช้เข้าถึงได้ทุกจุดวัด
   * และเป็นอาร์เรย์เมื่อถูกจำกัดขอบเขต Repository ทุกตัวเข้าใจสัญญานี้ตรงกัน
   *
   * @param {import('../models/User.js').User|null} user ผู้ใช้
   * @param {object} [criteria={}] เงื่อนไขเดิม
   * @returns {object} เงื่อนไขที่เติม `stationIds` แล้ว
   */
  applyStationScope(user, criteria = {}) {
    if (!user) return { ...criteria, stationIds: [] };
    if (user.isSuperAdmin || !user.hasStationScope) {
      return { ...criteria, stationIds: null };
    }

    const allowed = user.stationIds;
    // ผู้เรียกอาจระบุจุดวัดเจาะจงมาแล้ว — ต้องยังคงอยู่ในขอบเขตที่อนุญาต
    if (criteria.stationId !== null && criteria.stationId !== undefined && criteria.stationId !== '') {
      const requested = Number(criteria.stationId);
      if (!allowed.includes(requested)) {
        return { ...criteria, stationId: null, stationIds: [] };
      }
      return { ...criteria, stationIds: allowed };
    }
    return { ...criteria, stationIds: allowed };
  }

  /**
   * ตรวจว่าผู้ใช้เข้าถึงจุดวัดนี้ได้หรือไม่
   * @param {import('../models/User.js').User|null} user ผู้ใช้
   * @param {number} stationId รหัสจุดวัด
   * @returns {boolean}
   */
  canAccessStation(user, stationId) {
    return Boolean(user?.canAccessStation(stationId));
  }

  /**
   * ตรวจขอบเขตจุดวัดและโยน **404** เมื่อไม่ผ่าน
   *
   * ตอบ 404 ไม่ใช่ 403 โดยเจตนา เพราะ 403 เป็นการยืนยันว่า ID นั้นมีอยู่จริง
   * ซึ่งเปิดช่องให้ไล่เดารหัสจุดวัดทั้งระบบได้ (CLAUDE.md ข้อ 8.4)
   *
   * @param {import('../models/User.js').User|null} user ผู้ใช้
   * @param {number} stationId รหัสจุดวัด
   * @returns {void}
   * @throws {NotFoundError} เมื่อจุดวัดอยู่นอกขอบเขตของผู้ใช้
   */
  assertStationAccess(user, stationId) {
    if (!this.canAccessStation(user, stationId)) {
      throw new NotFoundError('ไม่พบจุดวัดที่ต้องการ');
    }
  }

  /**
   * ล้าง session ของผู้ใช้ที่ได้รับผลกระทบเมื่อสิทธิ์เปลี่ยน
   *
   * ทำให้สิทธิ์ใหม่มีผล**ทันที**กับผู้ที่กำลังใช้งานอยู่ ไม่ต้องรอ session หมดอายุ
   * (เกณฑ์ตรวจรับข้อ 19: "แก้สิทธิ์ของบทบาทแล้วมีผลกับผู้ใช้ที่กำลังใช้งานอยู่ทันที")
   *
   * @param {number} roleId รหัสบทบาทที่สิทธิ์เปลี่ยน
   * @returns {Promise<number>} จำนวน session ที่ถูกล้าง
   */
  async invalidateSessionsForRole(roleId) {
    const userIds = await this.#userRepository.userIdsByRole(roleId);
    const revoked = await this.#sessionRepository.destroyForUsers(userIds);
    this.#cache.forgetPrefix('permissions:');
    this.#eventBus.publish(EventBus.EVENTS.PERMISSIONS_CHANGED, { roleId, userIds, revoked });
    this.logger.info('sessions revoked after permission change', { roleId, revoked });
    return revoked;
  }

  /**
   * ล้าง session ของผู้ใช้คนเดียวเมื่อบทบาทหรือขอบเขตของเขาเปลี่ยน
   * @param {number} userId รหัสผู้ใช้
   * @returns {Promise<number>} จำนวน session ที่ถูกล้าง
   */
  async invalidateSessionsForUser(userId) {
    const revoked = await this.#sessionRepository.destroyForUser(userId);
    this.#cache.forget(`permissions:user:${userId}`);
    this.#eventBus.publish(EventBus.EVENTS.PERMISSIONS_CHANGED, { userIds: [userId], revoked });
    return revoked;
  }

  /**
   * คีย์สิทธิ์ทั้งหมดของผู้ใช้ (ผ่านแคช)
   * @param {number} userId รหัสผู้ใช้
   * @returns {Promise<Array<string>>}
   */
  async permissionKeysFor(userId) {
    return this.#cache.remember(
      `permissions:user:${userId}`,
      () => this.#permissionRepository.keysForUser(userId),
      60 * 1000,
    );
  }

  /**
   * สร้างฟังก์ชัน `can()` สำหรับใช้ใน EJS
   *
   * **เป็นเพียงชั้นประสบการณ์ผู้ใช้ (ซ่อนปุ่ม) ไม่ใช่ความปลอดภัย**
   * ห้ามพึ่งเป็นด่านเดียว — การป้องกันจริงอยู่ที่ middleware และชั้น Service
   *
   * @param {import('../models/User.js').User|null} user ผู้ใช้
   * @returns {(permissionKey: string) => boolean}
   */
  helperFor(user) {
    return (permissionKey) => this.can(user, permissionKey);
  }
}
