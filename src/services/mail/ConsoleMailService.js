import { MailService } from './MailService.js';
import { Logger } from '../../core/Logger.js';

/**
 * ไดรเวอร์อีเมลสำหรับตอนพัฒนา — พิมพ์ลิงก์ลงคอนโซลแทนการส่งจริง
 *
 * ทำให้ทดสอบเส้นทาง "ลืมรหัสผ่าน" ได้ครบตั้งแต่เครื่องพัฒนาที่ยังไม่มีกุญแจ Mailjet
 *
 * ⚠️ ในโหมดใช้งานจริงจะ **ปฏิเสธการส่ง** แทนที่จะพิมพ์ลิงก์ออกมา — ลิงก์ตั้งรหัสผ่าน
 * ที่หลุดลง log ของเซิร์ฟเวอร์คือกุญแจเข้าบัญชีที่ใครอ่าน log ได้ก็ใช้ได้
 */
export class ConsoleMailService extends MailService {
  /** @type {boolean} */
  #isProduction;
  /** @type {import('../../core/Logger.js').Logger} */
  #logger;

  /**
   * @param {{isProduction?: boolean}} [options={}] ตัวเลือก
   * @param {import('../../core/Logger.js').Logger} [logger] ตัวบันทึกเหตุการณ์
   */
  constructor({ isProduction = false } = {}, logger = Logger.getInstance()) {
    super();
    this.#isProduction = Boolean(isProduction);
    this.#logger = logger;
  }

  /** @returns {string} ชื่อไดรเวอร์ */
  get driver() { return 'console'; }

  /** @returns {boolean} ยังไม่ได้ตั้งค่าผู้ให้บริการอีเมลจริง */
  get isConfigured() { return false; }

  /**
   * พิมพ์เนื้อหาลงคอนโซลแทนการส่ง
   * @param {{to: string, subject: string, text: string}} message เนื้อหาจดหมาย
   * @returns {Promise<{sent: boolean, reason?: string}>}
   */
  async send({ to, subject, text }) {
    if (this.#isProduction) {
      this.#logger.error('email provider not configured — message not sent', { subject });
      return { sent: false, reason: 'ยังไม่ได้ตั้งค่าผู้ให้บริการอีเมล (Mailjet)' };
    }

    this.#logger.warn('email provider not configured — printing message (development only)');
    process.stdout.write(
      `\n  ┌─ อีเมลจำลอง (โหมดพัฒนา) ─────────────────────\n`
      + `  │ ถึง    : ${to}\n`
      + `  │ เรื่อง : ${subject}\n`
      + `  ├───────────────────────────────────────────\n`
      + `${text.split('\n').map((line) => `  │ ${line}`).join('\n')}\n`
      + `  └───────────────────────────────────────────\n\n`,
    );
    return { sent: true, reason: 'พิมพ์ลงคอนโซล (โหมดพัฒนา)' };
  }

  /**
   * ไม่มีอะไรให้ตรวจ — แต่บอกให้ชัดว่ายังไม่ได้ส่งจริง
   * @returns {Promise<{healthy: boolean, message: string}>}
   */
  async healthCheck() {
    return this.#isProduction
      ? { healthy: false, message: 'ยังไม่ได้ตั้งค่า Mailjet — ระบบส่งอีเมลไม่ได้' }
      : { healthy: true, message: 'ยังไม่ได้ตั้งค่า Mailjet (ลิงก์จะพิมพ์ลงคอนโซล)' };
  }
}
