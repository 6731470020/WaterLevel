import { NotImplementedError } from '../../core/errors/index.js';

/**
 * คลาสนามธรรมของบริการส่งอีเมล (Strategy + Template Method)
 *
 * ระบบใช้อีเมลเพียงเรื่องเดียวคือ **ลิงก์ตั้งรหัสผ่านใหม่** เนื้อหาจดหมายจึงถูก
 * ประกอบไว้ที่คลาสฐานนี้ที่เดียว (`sendPasswordReset()` เป็น Template Method)
 * คลาสลูกรับผิดชอบแค่ "ส่งออกไปยังไง" ผ่าน `send()` เท่านั้น
 *
 * ผลที่ได้: เปลี่ยนผู้ให้บริการอีเมลเมื่อไร ข้อความที่ผู้ใช้เห็นก็ยังเหมือนเดิมเป๊ะ
 * และไม่มีทางที่จดหมายสองฉบับจะเพี้ยนจากกันเพราะลืมแก้ที่ใดที่หนึ่ง
 *
 * @abstract
 */
export class MailService {
  /** @throws {NotImplementedError} เมื่อสร้างวัตถุจากคลาสนามธรรมโดยตรง */
  constructor() {
    if (new.target === MailService) {
      throw new NotImplementedError('MailService เป็นคลาสนามธรรม สร้างวัตถุโดยตรงไม่ได้');
    }
  }

  /**
   * ชื่อไดรเวอร์ — ใช้ใน log และหน้าสถานะระบบ
   * @abstract
   * @returns {string}
   * @throws {NotImplementedError} เมื่อคลาสลูกไม่ override
   */
  get driver() {
    throw new NotImplementedError(`${this.constructor.name} ต้อง override driver`);
  }

  /**
   * ตั้งค่าครบพอที่จะส่งจริงหรือยัง
   * @returns {boolean}
   */
  get isConfigured() { return true; }

  /**
   * ส่งอีเมลหนึ่งฉบับ
   * @abstract
   * @param {{to: string, toName?: string, subject: string, text: string, html?: string}} message เนื้อหาจดหมาย
   * @returns {Promise<{sent: boolean, reason?: string}>}
   * @throws {NotImplementedError} เมื่อคลาสลูกไม่ override
   */
  async send(message) {
    throw new NotImplementedError(`${this.constructor.name} ต้อง override send()`);
  }

  /**
   * ตรวจว่าบริการพร้อมใช้งานหรือไม่ — ใช้ในหน้าทดสอบการเชื่อมต่อ
   * @returns {Promise<{healthy: boolean, message: string}>}
   */
  async healthCheck() {
    return { healthy: true, message: `ไดรเวอร์ ${this.driver} พร้อมใช้งาน` };
  }

  /**
   * ส่งลิงก์ตั้งรหัสผ่านใหม่ — **Template Method** ประกอบเนื้อหาแล้วส่งต่อให้ `send()`
   * @param {{to: string, fullName: string, resetUrl: string}} params ข้อมูลผู้รับ
   * @returns {Promise<{sent: boolean, reason?: string}>}
   */
  async sendPasswordReset({ to, fullName, resetUrl }) {
    return this.send({
      to,
      toName: fullName,
      subject: 'ตั้งรหัสผ่านใหม่ — ระบบวัดระดับน้ำอัตโนมัติ',
      text: MailService.passwordResetText({ fullName, resetUrl }),
      html: MailService.passwordResetHtml({ fullName, resetUrl }),
    });
  }

  /**
   * เนื้อหาแบบข้อความล้วน — ต้องมีเสมอ เพราะบางโปรแกรมอ่านเมล (และตัวกรองสแปม
   * หลายตัว) ไม่แสดง HTML ถ้ามีแต่ HTML อย่างเดียวจดหมายอาจถูกตีเป็นสแปม
   * @param {{fullName: string, resetUrl: string}} params ข้อมูลผู้รับ
   * @returns {string}
   */
  static passwordResetText({ fullName, resetUrl }) {
    return [
      `เรียน ${fullName}`,
      '',
      'ระบบได้รับคำขอตั้งรหัสผ่านใหม่สำหรับบัญชีของคุณ',
      'กรุณาเปิดลิงก์ด้านล่างเพื่อตั้งรหัสผ่านใหม่ (ลิงก์มีอายุ 30 นาที และใช้ได้ครั้งเดียว)',
      '',
      resetUrl,
      '',
      'หากคุณไม่ได้เป็นผู้ขอ กรุณาเพิกเฉยต่ออีเมลฉบับนี้ รหัสผ่านเดิมของคุณจะยังใช้งานได้ตามปกติ',
      '',
      '— ระบบวัดระดับน้ำอัตโนมัติ',
    ].join('\n');
  }

  /**
   * เนื้อหาแบบ HTML
   *
   * ใช้ตารางและ inline style ล้วน — โปรแกรมอ่านเมลจำนวนมาก (Outlook เป็นต้น)
   * ตัด `<style>` ในส่วนหัวทิ้งและไม่รองรับ flexbox/grid การจัดหน้าแบบเว็บสมัยใหม่
   * จึงพังทันทีในกล่องจดหมายจริง
   *
   * @param {{fullName: string, resetUrl: string}} params ข้อมูลผู้รับ
   * @returns {string}
   */
  static passwordResetHtml({ fullName, resetUrl }) {
    const name = MailService.escapeHtml(fullName);
    const url = MailService.escapeHtml(resetUrl);
    return `<!DOCTYPE html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:24px 12px;background:#f1f5f9;font-family:'Sarabun','Segoe UI',system-ui,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:540px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.08)">
  <tr><td style="background:#0e7490;padding:20px 28px;color:#ffffff;font-size:15px;font-weight:600">
    🌊 ระบบวัดระดับน้ำอัตโนมัติ
  </td></tr>
  <tr><td style="padding:28px">
    <p style="margin:0 0 16px;font-size:16px">เรียน ${name}</p>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.7;color:#334155">
      ระบบได้รับคำขอตั้งรหัสผ่านใหม่สำหรับบัญชีของคุณ<br>
      กดปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่ — ลิงก์นี้<strong>มีอายุ 30 นาที และใช้ได้ครั้งเดียว</strong>
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px">
      <tr><td style="background:#0e7490;border-radius:8px">
        <a href="${url}" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none">
          ตั้งรหัสผ่านใหม่
        </a>
      </td></tr>
    </table>
    <p style="margin:0 0 6px;font-size:12px;color:#64748b">หากกดปุ่มไม่ได้ ให้คัดลอกลิงก์นี้ไปวางในเบราว์เซอร์:</p>
    <p style="margin:0 0 22px;font-size:12px;word-break:break-all">
      <a href="${url}" style="color:#0e7490">${url}</a>
    </p>
    <div style="border-top:1px solid #e2e8f0;padding-top:16px">
      <p style="margin:0;font-size:12px;line-height:1.7;color:#64748b">
        หากคุณไม่ได้เป็นผู้ขอ กรุณาเพิกเฉยต่ออีเมลฉบับนี้ —
        รหัสผ่านเดิมของคุณจะยังใช้งานได้ตามปกติ และไม่มีการเปลี่ยนแปลงใด ๆ กับบัญชี
      </p>
    </div>
  </td></tr>
  <tr><td style="background:#f8fafc;padding:14px 28px;font-size:11px;color:#94a3b8">
    อีเมลฉบับนี้ส่งจากระบบอัตโนมัติ กรุณาอย่าตอบกลับ
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
  }

  /**
   * หนีอักขระพิเศษก่อนฝังลงเนื้อหา HTML
   *
   * ชื่อผู้ใช้เป็นข้อความที่ผู้ใช้กรอกเอง ถ้าฝังดิบ ๆ จะกลายเป็นช่องฉีด HTML
   * เข้ากล่องจดหมายของคนอื่น
   *
   * @param {string} value ข้อความดิบ
   * @returns {string}
   */
  static escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
