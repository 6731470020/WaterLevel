import { ValidationError } from '../../core/errors/index.js';

/**
 * ผลลัพธ์จาก `GET {WATER_API_URL}/key-info` ของบริการตรวจจับ (Data Transfer Object)
 *
 * ทำหน้าที่แปลงคำตอบ `snake_case` ของฝั่ง Python ให้เป็นวัตถุ `camelCase` ที่มี
 * ความหมายชัดเจน — ชั้นบนจึงไม่ต้องรู้เลยว่าคำตอบดิบหน้าตาอย่างไร ถ้าฝั่งบริการ
 * เปลี่ยนชื่อฟิลด์ ต้องแก้ที่ไฟล์นี้ไฟล์เดียว
 *
 * โครงคำตอบจริง (`app.py:2078` → `key_to_dict()`):
 * ```json
 * { "success": true, "data": {
 *     "id": 3, "api_key": "abc12345...wxyz", "owner_name": "อบต.บางไผ่",
 *     "owner_email": "...", "owner_phone": "...", "company": "...", "plan": "standard",
 *     "purchased_at": "2026-01-05 09:00:00", "expires_at": "2027-01-05 09:00:00",
 *     "is_active": true, "is_expired": false, "days_remaining": 135,
 *     "expire_text": "05/01/2027 09:00", "status": "active",
 *     "usage_count": 8421, "last_used_at": "...", "last_used_ip": "..." } }
 * ```
 */
export class KeyInfo {
  /** @type {string} */
  #maskedKey;
  /** @type {string} */
  #ownerName;
  /** @type {string|null} */
  #company;
  /** @type {string|null} */
  #plan;
  /** @type {Date|null} */
  #expiresAt;
  /** @type {number|null} */
  #daysRemaining;
  /** @type {boolean} */
  #isActive;
  /** @type {boolean} */
  #isExpired;
  /** @type {string} */
  #status;
  /** @type {number} */
  #usageCount;
  /** @type {Date|null} */
  #lastUsedAt;
  /** @type {Date} */
  #checkedAt;

  /**
   * @param {object} data ข้อมูลที่แปลงแล้ว
   */
  constructor(data = {}) {
    this.#maskedKey = String(data.maskedKey ?? '');
    this.#ownerName = String(data.ownerName ?? '');
    this.#company = data.company ? String(data.company) : null;
    this.#plan = data.plan ? String(data.plan) : null;
    this.#expiresAt = data.expiresAt ?? null;
    this.#daysRemaining = data.daysRemaining ?? null;
    this.#isActive = Boolean(data.isActive);
    this.#isExpired = Boolean(data.isExpired);
    this.#status = String(data.status ?? 'unknown');
    this.#usageCount = Number(data.usageCount ?? 0);
    this.#lastUsedAt = data.lastUsedAt ?? null;
    this.#checkedAt = data.checkedAt ?? new Date();
    Object.freeze(this);
  }

  /** @returns {string} คีย์ที่ถูกปิดบังบางส่วนแล้ว (`abc12345...wxyz`) */
  get maskedKey() { return this.#maskedKey; }

  /** @returns {string} ชื่อเจ้าของคีย์ */
  get ownerName() { return this.#ownerName; }

  /** @returns {string|null} หน่วยงาน */
  get company() { return this.#company; }

  /** @returns {string|null} แพ็กเกจที่ซื้อ */
  get plan() { return this.#plan; }

  /** @returns {Date|null} วันหมดอายุ (`null` = ตลอดชีพ) */
  get expiresAt() { return this.#expiresAt; }

  /** @returns {boolean} คีย์นี้เป็นแบบไม่มีวันหมดอายุหรือไม่ */
  get isPerpetual() { return this.#expiresAt === null; }

  /** @returns {number|null} จำนวนวันคงเหลือ (`null` = ตลอดชีพ) */
  get daysRemaining() { return this.#daysRemaining; }

  /** @returns {boolean} คีย์ยังไม่ถูกยกเลิก */
  get isActive() { return this.#isActive; }

  /** @returns {boolean} คีย์หมดอายุแล้ว */
  get isExpired() { return this.#isExpired; }

  /** @returns {string} สถานะจากฝั่งบริการ: active | expiring_soon | expired | revoked */
  get status() { return this.#status; }

  /** @returns {boolean} คีย์ยังเรียกใช้บริการตรวจจับได้จริง */
  get isUsable() { return this.#isActive && !this.#isExpired; }

  /** @returns {number} จำนวนครั้งที่เรียกใช้สะสม */
  get usageCount() { return this.#usageCount; }

  /** @returns {Date|null} เวลาที่ใช้งานล่าสุด */
  get lastUsedAt() { return this.#lastUsedAt; }

  /** @returns {Date} เวลาที่ระบบนี้ไปถามมา */
  get checkedAt() { return this.#checkedAt; }

  /**
   * สร้างจากคำตอบดิบของ `GET /key-info`
   * @param {object} body คำตอบทั้งก้อน (`{ success, data }`)
   * @returns {KeyInfo}
   * @throws {ValidationError} เมื่อคำตอบไม่มีส่วน `data`
   */
  static fromApiResponse(body) {
    const data = body?.data;
    if (!data || typeof data !== 'object') {
      throw new ValidationError('คำตอบจาก /key-info ไม่มีส่วน data — อาจไม่ใช่บริการตรวจจับที่ถูกต้อง');
    }

    return new KeyInfo({
      maskedKey: KeyInfo.#ensureMasked(data.api_key),
      ownerName: data.owner_name,
      company: data.company,
      plan: data.plan,
      // `expires_at: null` ฝั่ง Python แปลว่า "ตลอดชีพ" ไม่ใช่ "ไม่มีข้อมูล"
      expiresAt: KeyInfo.#toDate(data.expires_at),
      daysRemaining: data.days_remaining === null || data.days_remaining === undefined
        ? null : Number(data.days_remaining),
      isActive: data.is_active,
      isExpired: data.is_expired,
      status: data.status,
      usageCount: data.usage_count,
      lastUsedAt: KeyInfo.#toDate(data.last_used_at),
    });
  }

  /**
   * ปิดบังคีย์ให้แน่ใจก่อนนำไปเก็บหรือแสดงผล
   *
   * ⚠️ **ห้ามเชื่อว่าต้นทางปิดบังมาให้แล้ว** — `key_to_dict()` ใน `app.py:139`
   * ปิดบังเฉพาะคีย์ที่ยาวเกิน 12 ตัวอักษร (`if len(k) > 12`) คีย์สั้นอย่างที่
   * ย้ายมาจาก `.env` เดิมจึงถูกส่งกลับมา**เต็มใบ** ถ้าเก็บตามที่ได้มาตรง ๆ
   * ความลับจะไปโผล่ในฐานข้อมูล ไฟล์สำรอง และหน้าเว็บผู้ดูแลทันที
   *
   * @param {string|null|undefined} value คีย์ที่ได้จากบริการ
   * @returns {string}
   */
  static #ensureMasked(value) {
    const raw = String(value ?? '').trim();
    if (!raw || raw.includes('...')) return raw;
    if (raw.length <= 6) return '*'.repeat(raw.length);
    // เหลือหัว 4 ท้าย 2 — พอให้ผู้ดูแลเทียบได้ว่าตรงกับคีย์ที่ถืออยู่ไหม
    // และยังต่างกันพอที่จะไม่ชนคีย์อื่นในคอลัมน์ที่เป็น UNIQUE
    return `${raw.slice(0, 4)}...${raw.slice(-2)}`;
  }

  /**
   * แปลงเวลารูปแบบ `YYYY-MM-DD HH:MM:SS` (เวลาไทย ไม่มีโซนต่อท้าย) เป็น `Date`
   *
   * ⚠️ ต้องแทรก `T` เอง — `new Date('2027-01-05 09:00:00')` ใช้ได้บน V8 ก็จริง
   * แต่ไม่ใช่รูปแบบตามมาตรฐาน จึงไม่รับประกันผลบน runtime อื่น และเมื่อระบบ
   * ตั้ง `TZ=Asia/Bangkok` อยู่แล้ว การตีความแบบเวลาท้องถิ่นก็ตรงกับฝั่ง Python พอดี
   *
   * @param {string|null|undefined} value ค่าเวลาดิบ
   * @returns {Date|null}
   */
  static #toDate(value) {
    if (!value) return null;
    const parsed = new Date(String(value).trim().replace(' ', 'T'));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  /** @returns {object} โครงสร้างสำหรับส่งออกหน้าเว็บ */
  toJSON() {
    return {
      maskedKey: this.#maskedKey,
      ownerName: this.#ownerName,
      company: this.#company,
      plan: this.#plan,
      expiresAt: this.#expiresAt,
      isPerpetual: this.isPerpetual,
      daysRemaining: this.#daysRemaining,
      isActive: this.#isActive,
      isExpired: this.#isExpired,
      isUsable: this.isUsable,
      status: this.#status,
      usageCount: this.#usageCount,
      lastUsedAt: this.#lastUsedAt,
      checkedAt: this.#checkedAt,
    };
  }
}
