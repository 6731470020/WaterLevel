import { BaseService } from '../core/BaseService.js';
import { NotFoundError } from '../core/errors/index.js';
import { License } from '../models/License.js';
import { NullKeyRegistry } from './license/NullKeyRegistry.js';

/** คีย์แคชของสถานะใบอนุญาต */
const CACHE_KEY = 'license:current';
/** อายุแคช 5 นาที ตาม CLAUDE.md ข้อ 8.5 */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * วันหมดอายุที่ใช้แทนคีย์แบบ "ตลอดชีพ"
 *
 * คอลัมน์ `licenses.expired_at` เป็น `NOT NULL` และ `License.isValid` เทียบกับ
 * เวลาปัจจุบันเสมอ จึงต้องมีวันจริงมาใส่ — เลือกปีที่ไกลจนไม่มีทางถึงแทนการ
 * แก้สคีมาให้รับ `null` ซึ่งจะทำให้ทุกที่ที่อ่านค่านี้ต้องเช็ค null เพิ่ม
 */
const PERPETUAL_EXPIRY = new Date('2999-12-31T23:59:59');

/**
 * บริการตรวจใบอนุญาตใช้งานระบบ
 *
 * แคชสถานะไว้ในหน่วยความจำ 5 นาที เพราะ `LicenseMiddleware` เป็นด่านแรกของ**ทุกคำขอ**
 * การถามฐานข้อมูลทุกครั้งจะเป็นคอขวดโดยไม่จำเป็น
 */
export class LicenseService extends BaseService {
  /** @type {import('../repositories/LicenseRepository.js').LicenseRepository} */
  #licenseRepository;
  /** @type {import('../core/MemoryCache.js').MemoryCache} */
  #cache;
  /** @type {import('./license/KeyRegistry.js').KeyRegistry} */
  #keyRegistry;
  /** @type {{checkedAt: Date, ok: boolean, message: string, keyInfo: object|null}|null} */
  #lastSync = null;
  /** @type {string|null} */
  #registryLicenseKey = null;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../repositories/LicenseRepository.js').LicenseRepository} deps.licenseRepository ที่เก็บใบอนุญาต
   * @param {import('../core/MemoryCache.js').MemoryCache} deps.cache แคชในหน่วยความจำ
   * @param {import('./license/KeyRegistry.js').KeyRegistry} [deps.keyRegistry] ทะเบียนคีย์ของผู้ให้บริการ
   * @param {import('../core/Logger.js').Logger} [deps.logger] ตัวบันทึกเหตุการณ์
   */
  constructor({ licenseRepository, cache, keyRegistry, logger }) {
    super(licenseRepository, logger);
    this.#licenseRepository = licenseRepository;
    this.#cache = cache;
    this.#keyRegistry = keyRegistry ?? new NullKeyRegistry();
  }

  /** @returns {import('./license/KeyRegistry.js').KeyRegistry} ทะเบียนคีย์ที่ใช้อยู่ */
  get keyRegistry() { return this.#keyRegistry; }

  /**
   * ใบอนุญาตปัจจุบัน (ผ่านแคช)
   * @returns {Promise<License|null>}
   */
  async current() {
    const cached = this.#cache.get(CACHE_KEY);
    if (cached !== null) return cached.license;
    const license = await this.#resolveCurrent();
    this.#cache.set(CACHE_KEY, { license }, CACHE_TTL_MS);
    return license;
  }

  /**
   * เลือกใบอนุญาตที่ถือเป็นตัวชี้ขาด
   *
   * เมื่อเชื่อมกับทะเบียนคีย์แล้ว **แถวที่ซิงก์มาชนะเสมอ** แม้จะถูกปิดใช้งานไปแล้ว
   * — ถ้าปล่อยให้ `findCurrent()` เลือกแถวที่ยัง `is_active = 1` ตามปกติ ใบอนุญาต
   * ที่ผู้ดูแลเคยกรอกเองไว้จะกลายเป็นทางลัดที่ทำให้คีย์ซึ่งถูกยกเลิกจากต้นทาง
   * ยังเปิดระบบต่อได้เงียบ ๆ
   *
   * @returns {Promise<License|null>}
   */
  async #resolveCurrent() {
    if (this.#registryLicenseKey) {
      const synced = await this.#licenseRepository.findOneBy({
        license_key: this.#registryLicenseKey,
      });
      if (synced) return synced;
    }
    return this.#licenseRepository.findCurrent();
  }

  /**
   * ตรวจว่าระบบยังใช้งานได้อยู่หรือไม่
   *
   * **ระบบที่ยังไม่ได้ตั้งค่าใบอนุญาตถือว่าใช้งานได้** เพื่อไม่ให้ระบบที่เพิ่งติดตั้ง
   * ถูกกั้นทุกหน้าจนเข้าไปตั้งค่าไม่ได้
   *
   * @returns {Promise<{valid: boolean, license: License|null}>}
   */
  async check() {
    const license = await this.current();
    return { valid: license === null ? true : license.isValid, license };
  }

  /**
   * ข้อมูลติดต่อผู้ให้บริการ — แสดงบนหน้าแจ้งใบอนุญาตหมดอายุ
   * @returns {Promise<{email: string|null, phone: string|null, line: string|null}>}
   */
  async contactInfo() {
    const license = await this.current();
    return {
      email: license?.contactEmail ?? null,
      phone: license?.contactPhone ?? null,
      line: license?.contactLine ?? null,
    };
  }

  /**
   * ล้างแคชด้วยตนเอง — ใช้หลังแก้ไขใบอนุญาตจากภายนอก
   */
  clearCache() { this.#cache.forget(CACHE_KEY); }

  /**
   * ดึงสถานะคีย์จากผู้ให้บริการแล้วอัปเดตใบอนุญาตในระบบให้ตรงกัน
   *
   * **ทำไมต้องคัดลอกลงฐานข้อมูลแทนที่จะถามสดทุกครั้ง** — `LicenseMiddleware`
   * เป็นด่านแรกของ*ทุก*คำขอ การยิง HTTP ออกนอกเครื่องตรงนั้นจะทำให้ทั้งเว็บ
   * ช้าตามบริการปลายทาง และเว็บจะล่มทันทีที่อินเทอร์เน็ตหลุด งานนี้จึงเป็น
   * **การซิงก์เป็นรอบ** ส่วนด่านตรวจยังอ่านจากฐานข้อมูลในเครื่องเหมือนเดิม
   *
   * เมื่อติดต่อไม่ได้จะ **ไม่แตะใบอนุญาตเดิม** — ระบบยังทำงานต่อจนถึงวันหมดอายุ
   * ที่ซิงก์มาได้ครั้งล่าสุด ซึ่งเป็นพฤติกรรมที่ถูกต้องสำหรับหน่วยงานที่เน็ตไม่นิ่ง
   *
   * @returns {Promise<{synced: boolean, reason?: string, keyInfo: import('./license/KeyInfo.js').KeyInfo|null, license: License|null}>}
   */
  async syncFromRegistry() {
    if (!this.#keyRegistry.isConfigured) {
      return this.#recordSync(false, 'ยังไม่ได้กรอกคีย์บริการตรวจจับในหน้าตั้งค่า', null, null);
    }

    let keyInfo = null;
    try {
      keyInfo = await this.#keyRegistry.fetchKeyInfo();
    } catch (error) {
      // ติดต่อไม่ได้ ≠ หมดอายุ — คงใบอนุญาตเดิมไว้ทั้งดุ้น
      this.logger.warn('license sync failed, keeping local license', { message: error.message });
      return this.#recordSync(false, error.message, null, await this.current());
    }

    const license = await this.#applyKeyInfo(keyInfo);
    return this.#recordSync(true, undefined, keyInfo, license);
  }

  /**
   * สถานะการซิงก์ครั้งล่าสุด — ใช้แสดงบนหน้าใบอนุญาตและ `/health`
   * @returns {{driver: string, configured: boolean, lastSync: object|null}}
   */
  registryStatus() {
    return {
      driver: this.#keyRegistry.driver,
      configured: this.#keyRegistry.isConfigured,
      lastSync: this.#lastSync,
    };
  }

  /**
   * เขียนสถานะคีย์ที่ได้มาลงตาราง `licenses`
   *
   * ⚠️ **ไม่เขียนทับ `contact_*`** — ฟิลด์เหล่านั้นคือช่องทางติดต่อ*ผู้ให้บริการ*
   * ที่แสดงบนหน้า `/license-expired` ส่วน `owner_email` / `owner_phone` จาก
   * `/key-info` คือข้อมูลของ*ลูกค้าเอง* คนละความหมายกันคนละทาง ถ้าคัดลอกมาใส่
   * หน้าแจ้งหมดอายุจะบอกให้ผู้ใช้โทรหาตัวเอง
   *
   * @param {import('./license/KeyInfo.js').KeyInfo} keyInfo สถานะคีย์ที่ได้มา
   * @returns {Promise<License>}
   */
  async #applyKeyInfo(keyInfo) {
    // เก็บเฉพาะคีย์ที่ปิดบังแล้วตามที่บริการส่งมา — ค่าจริงอยู่ใน .env ที่เดียวพอ
    // ไม่ต้องให้มันไปโผล่ในหน้าเว็บ, audit log หรือไฟล์สำรองฐานข้อมูลอีกชุด
    const licenseKey = keyInfo.maskedKey || `remote:${keyInfo.ownerName || 'unknown'}`;
    const expiredAt = keyInfo.expiresAt ?? PERPETUAL_EXPIRY;
    const isActive = keyInfo.isUsable;

    this.#registryLicenseKey = licenseKey;

    const existing = await this.#licenseRepository.findOneBy({ license_key: licenseKey });
    const saved = existing
      ? await this.#licenseRepository.update(existing.id, {
        expired_at: expiredAt,
        is_active: isActive ? 1 : 0,
      })
      : await this.#licenseRepository.create(new License({ licenseKey, expiredAt, isActive }));

    this.#cache.forget(CACHE_KEY);
    this.logger.info('license synced from key registry', {
      owner: keyInfo.ownerName,
      // ส่งเป็นสตริง — ตัวบันทึกแปลง `Date` เป็น `{}` ทำให้บรรทัด log ไร้ประโยชน์
      expiredAt: expiredAt.toISOString(),
      perpetual: keyInfo.isPerpetual,
      active: isActive,
    });
    return saved;
  }

  /**
   * จดผลการซิงก์ไว้ให้หน้าเว็บอ่าน
   * @param {boolean} ok สำเร็จหรือไม่
   * @param {string|undefined} reason เหตุผลเมื่อไม่สำเร็จ
   * @param {import('./license/KeyInfo.js').KeyInfo|null} keyInfo สถานะคีย์
   * @param {License|null} license ใบอนุญาตหลังซิงก์
   * @returns {{synced: boolean, reason?: string, keyInfo: object|null, license: License|null}}
   */
  #recordSync(ok, reason, keyInfo, license) {
    this.#lastSync = {
      checkedAt: new Date(),
      ok,
      message: reason ?? 'ซิงก์สำเร็จ',
      keyInfo: keyInfo?.toJSON() ?? null,
    };
    return { synced: ok, reason, keyInfo, license };
  }

  /**
   * ใบอนุญาตปัจจุบันแบบต้องมี
   * @returns {Promise<License>}
   * @throws {NotFoundError} เมื่อยังไม่ได้ตั้งค่าใบอนุญาต
   */
  async requireCurrent() {
    const license = await this.current();
    if (!license) throw new NotFoundError('ยังไม่ได้ตั้งค่าใบอนุญาตในระบบ');
    return license;
  }
}
