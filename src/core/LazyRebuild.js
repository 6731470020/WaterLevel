/**
 * ตัวถือวัตถุที่ **ประกอบตัวเองใหม่เมื่อค่าตั้งค่าเปลี่ยน** (Lazy Factory)
 *
 * ปัญหาที่แก้: บริการต่าง ๆ ถูกฉีดเข้า constructor ของผู้ใช้งานแล้ว**ถืออ้างอิงเดิม**
 * ไว้ตลอดอายุโปรเซส เมื่อผู้ดูแลแก้ค่าในหน้าเว็บ วัตถุที่ถืออยู่จะยังเป็นตัวเก่า
 * จนกว่าจะรีสตาร์ต — ซึ่งขัดกับเจตนาของการย้ายค่าตั้งค่ามาไว้ในฐานข้อมูล
 *
 * คลาสนี้เก็บ "เลขรุ่นตอนที่ประกอบ" ไว้ แล้วเทียบกับเลขรุ่นปัจจุบันก่อนคืนวัตถุทุกครั้ง
 * ต่างกันเมื่อไรก็ประกอบใหม่เมื่อนั้น ใช้ด้วยการ**ประกอบร่าง (composition)** จึงนำไป
 * ใช้กับคลาสห่อหุ้มตัวไหนก็ได้โดยไม่ไปกินสิทธิ์การสืบทอดของมัน
 *
 * @template T
 */
export class LazyRebuild {
  /** @type {() => number} */
  #versionOf;
  /** @type {() => T} */
  #factory;
  /** @type {T|null} */
  #instance = null;
  /** @type {number|null} */
  #builtVersion = null;

  /**
   * @param {() => number} versionOf ฟังก์ชันอ่านเลขรุ่นปัจจุบันของค่าตั้งค่า
   * @param {() => T} factory ฟังก์ชันประกอบวัตถุจากค่าล่าสุด
   */
  constructor(versionOf, factory) {
    this.#versionOf = versionOf;
    this.#factory = factory;
  }

  /**
   * วัตถุที่ใช้อยู่ตอนนี้ — ประกอบใหม่อัตโนมัติเมื่อค่าตั้งค่าเปลี่ยน
   * @returns {T}
   */
  get current() {
    const version = this.#versionOf();
    if (this.#instance === null || this.#builtVersion !== version) {
      this.#instance = this.#factory();
      this.#builtVersion = version;
    }
    return this.#instance;
  }

  /** @returns {boolean} เคยประกอบไปแล้วหรือยัง — ใช้เลี่ยงการสร้างวัตถุโดยไม่จำเป็น */
  get isBuilt() { return this.#instance !== null; }

  /** ทิ้งวัตถุที่ถืออยู่ บังคับให้ประกอบใหม่ในครั้งถัดไป */
  invalidate() {
    this.#instance = null;
    this.#builtVersion = null;
  }
}
