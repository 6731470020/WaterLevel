/**
 * แคชในหน่วยความจำแบบมีอายุ (TTL) สำหรับข้อมูลที่เปลี่ยนช้า
 *
 * ใช้กับสถานะใบอนุญาตและรายการสิทธิ์ตามบทบาท (CLAUDE.md ข้อ 13)
 * ตั้งใจให้เรียบง่าย — ระบบรันโปรเซสเดียว จึงไม่ต้องพึ่ง Redis
 */
export class MemoryCache {
  /** @type {Map<string, {value: *, expiresAt: number}>} */
  #store = new Map();
  /** @type {number} */
  #defaultTtlMs;

  /** @param {number} [defaultTtlMs=300000] อายุเริ่มต้นของรายการ (ค่าเริ่มต้น 5 นาที) */
  constructor(defaultTtlMs = 5 * 60 * 1000) {
    this.#defaultTtlMs = defaultTtlMs;
  }

  /**
   * อ่านค่าจากแคช
   * @param {string} key คีย์
   * @returns {*|null} ค่าที่เก็บไว้ หรือ null เมื่อไม่มี/หมดอายุ
   */
  get(key) {
    const entry = this.#store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.#store.delete(key);
      return null;
    }
    return entry.value;
  }

  /**
   * เก็บค่าลงแคช
   * @param {string} key คีย์
   * @param {*} value ค่าที่ต้องการเก็บ
   * @param {number} [ttlMs] อายุเฉพาะรายการนี้
   * @returns {*} ค่าที่เก็บ (คืนกลับเพื่อเขียนต่อเป็นทอด ๆ ได้)
   */
  set(key, value, ttlMs = this.#defaultTtlMs) {
    this.#store.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }

  /**
   * อ่านจากแคช ถ้าไม่มีให้เรียก factory แล้วเก็บผลไว้
   * @template T
   * @param {string} key คีย์
   * @param {() => Promise<T>} factory ตัวสร้างค่าเมื่อแคชพลาด
   * @param {number} [ttlMs] อายุเฉพาะรายการนี้
   * @returns {Promise<T>}
   */
  async remember(key, factory, ttlMs = this.#defaultTtlMs) {
    const cached = this.get(key);
    if (cached !== null) return cached;
    return this.set(key, await factory(), ttlMs);
  }

  /**
   * ลบรายการเดียว
   * @param {string} key คีย์
   */
  forget(key) { this.#store.delete(key); }

  /**
   * ลบทุกรายการที่คีย์ขึ้นต้นด้วยคำนำหน้าที่กำหนด
   * @param {string} prefix คำนำหน้าคีย์
   */
  forgetPrefix(prefix) {
    for (const key of this.#store.keys()) {
      if (key.startsWith(prefix)) this.#store.delete(key);
    }
  }

  /** ล้างแคชทั้งหมด */
  clear() { this.#store.clear(); }

  /** @returns {number} จำนวนรายการที่เก็บอยู่ (รวมที่หมดอายุแต่ยังไม่ถูกลบ) */
  get size() { return this.#store.size; }
}
