/**
 * คลาสฐานของข้อผิดพลาดทั้งระบบ
 *
 * ทุกข้อผิดพลาดในชั้น business ต้องสืบทอดจากคลาสนี้ เพื่อให้ `ErrorMiddleware`
 * แปลงเป็นรหัส HTTP และรูปแบบ JSON ที่ถูกต้องได้โดยอัตโนมัติ
 * ห้าม `throw new Error()` ดิบ ๆ ในชั้น business (ดู CLAUDE.md ข้อ 21)
 */
export class AppError extends Error {
  /** @type {number} */
  #statusCode;
  /** @type {string} */
  #code;
  /** @type {Array<object>} */
  #details;
  /** @type {boolean} */
  #expected;

  /**
   * @param {string} message ข้อความภาษาไทยสำหรับผู้ใช้
   * @param {number} [statusCode=500] รหัสสถานะ HTTP
   * @param {string} [code='INTERNAL_ERROR'] รหัสข้อผิดพลาดของระบบ
   * @param {Array<object>} [details=[]] รายละเอียดเพิ่มเติม เช่น ฟิลด์ที่ผิด
   */
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = []) {
    super(message);
    this.name = new.target.name;
    this.#statusCode = statusCode;
    this.#code = code;
    this.#details = Array.isArray(details) ? details : [details];
    this.#expected = statusCode < 500;
    Error.captureStackTrace?.(this, new.target);
  }

  /** @returns {number} รหัสสถานะ HTTP */
  get statusCode() { return this.#statusCode; }

  /** @returns {string} รหัสข้อผิดพลาด */
  get code() { return this.#code; }

  /** @returns {Array<object>} รายละเอียดเพิ่มเติม */
  get details() { return this.#details; }

  /** @returns {boolean} true = ข้อผิดพลาดที่คาดไว้ (ไม่ใช่บั๊ก) ไม่ต้อง log เป็น error */
  get isExpected() { return this.#expected; }

  /**
   * แปลงเป็นรูปแบบตอบกลับ API ตามข้อตกลงในข้อ 9 ของ CLAUDE.md
   * @returns {{success: false, error: {code: string, message: string, details: Array}}}
   */
  toJSON() {
    return {
      success: false,
      error: { code: this.#code, message: this.message, details: this.#details },
    };
  }
}
