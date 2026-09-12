import { ValidationError } from '../../core/errors/index.js';

/**
 * ข้อความแจ้งเตือนที่ยังไม่ผูกกับช่องทางใด (Data Transfer Object)
 *
 * เก็บแต่**เนื้อหา**ว่าจะบอกอะไร ไม่เก็บว่าจะแสดงอย่างไร — LINE เรนเดอร์เป็น
 * Flex Message, Discord เป็น embed, Telegram เป็น HTML ส่วนคอนโซลเป็นข้อความล้วน
 *
 * เดิมชั้นธุรกิจสร้าง Flex Message ของ LINE ออกมาตรง ๆ ทำให้เพิ่มช่องทางใหม่
 * ไม่ได้เลยโดยไม่แก้ `AlertService` กับ `ReportService` — DTO ตัวนี้ตัดปมนั้นออก
 * ชั้นธุรกิจบอกแค่ "เตือนภัยโซนวิกฤต ที่จุดวัดนี้ ระดับเท่านี้" แล้วจบหน้าที่
 *
 * วัตถุนี้เปลี่ยนแปลงไม่ได้หลังสร้าง เพื่อให้ส่งต่อไปหลายช่องทางพร้อมกันได้อย่างปลอดภัย
 */
export class NotificationMessage {
  /** ชนิดข้อความที่ระบบรู้จัก */
  static KINDS = ['ALERT', 'REPORT', 'STATUS', 'HELP', 'INFO', 'TEST'];

  /** @type {string} */
  #kind;
  /** @type {string} */
  #title;
  /** @type {string|null} */
  #subtitle;
  /** @type {string} */
  #summary;
  /** @type {string|null} */
  #color;
  /** @type {string|null} */
  #imageUrl;
  /** @type {Array<{label: string, value: string, emphasis: boolean}>} */
  #fields;
  /** @type {Array<string>} */
  #lines;
  /** @type {Array<{label: string, url: string}>} */
  #links;

  /**
   * @param {object} data เนื้อหาข้อความ
   * @param {string} data.kind ชนิด — ดู `NotificationMessage.KINDS`
   * @param {string} data.title หัวเรื่อง
   * @param {string} [data.subtitle] บรรทัดรอง เช่นชื่อจุดวัดหรือวันที่
   * @param {string} [data.summary] ข้อความสรุปบรรทัดเดียว (ใช้เป็น `altText` ของ LINE
   *   และเป็นเนื้อหาแจ้งเตือนบนหน้าจอล็อกของมือถือ) — ไม่ระบุจะใช้หัวเรื่อง
   * @param {string} [data.color] สีเน้น `#RRGGBB`
   * @param {string} [data.imageUrl] URL ภาพประกอบ (ต้องเป็น HTTPS สาธารณะ)
   * @param {Array<{label: string, value: string, emphasis?: boolean}>} [data.fields] คู่ป้ายกำกับ-ค่า
   * @param {Array<string>} [data.lines] ข้อความอิสระบรรทัดต่อบรรทัด
   * @param {Array<{label: string, url: string}>} [data.links] ลิงก์ท้ายข้อความ
   * @throws {ValidationError} เมื่อชนิดไม่รู้จักหรือไม่มีหัวเรื่อง
   */
  constructor(data = {}) {
    if (!NotificationMessage.KINDS.includes(data.kind)) {
      throw new ValidationError(`ไม่รู้จักชนิดข้อความแจ้งเตือน: ${data.kind}`);
    }
    if (!data.title || !String(data.title).trim()) {
      throw new ValidationError('ข้อความแจ้งเตือนต้องมีหัวเรื่อง');
    }

    this.#kind = data.kind;
    this.#title = String(data.title).trim();
    this.#subtitle = data.subtitle ? String(data.subtitle).trim() : null;
    this.#summary = String(data.summary ?? data.title).trim();
    this.#color = NotificationMessage.#normalizeColor(data.color);
    this.#imageUrl = data.imageUrl ? String(data.imageUrl) : null;

    this.#fields = (data.fields ?? [])
      .filter((field) => field && field.label)
      .map((field) => ({
        label: String(field.label),
        value: String(field.value ?? '—'),
        emphasis: Boolean(field.emphasis),
      }));

    this.#lines = (data.lines ?? []).map((line) => String(line));

    this.#links = (data.links ?? [])
      .filter((link) => link?.url && link?.label)
      .map((link) => ({ label: String(link.label), url: String(link.url) }));

    Object.freeze(this.#fields);
    Object.freeze(this.#lines);
    Object.freeze(this.#links);
    Object.freeze(this);
  }

  /** @returns {string} ชนิดข้อความ */
  get kind() { return this.#kind; }

  /** @returns {string} หัวเรื่อง */
  get title() { return this.#title; }

  /** @returns {string|null} บรรทัดรอง */
  get subtitle() { return this.#subtitle; }

  /** @returns {string} ข้อความสรุปบรรทัดเดียว */
  get summary() { return this.#summary; }

  /** @returns {string|null} สีเน้น */
  get color() { return this.#color; }

  /** @returns {number} สีเน้นในรูปจำนวนเต็ม — Discord ต้องการรูปแบบนี้ */
  get colorInt() { return this.#color ? parseInt(this.#color.slice(1), 16) : 0x64748B; }

  /** @returns {string|null} URL ภาพประกอบ */
  get imageUrl() { return this.#imageUrl; }

  /** @returns {Array<{label: string, value: string, emphasis: boolean}>} คู่ป้ายกำกับ-ค่า */
  get fields() { return this.#fields; }

  /** @returns {Array<string>} ข้อความอิสระ */
  get lines() { return this.#lines; }

  /** @returns {Array<{label: string, url: string}>} ลิงก์ */
  get links() { return this.#links; }

  /**
   * แปลงเป็นข้อความล้วน — ใช้ได้ทุกช่องทางเป็นอย่างน้อย
   *
   * เป็นทางถอยที่รับประกันว่าถ้าช่องทางใดเรนเดอร์แบบสวยไม่ได้ ผู้รับก็ยังได้
   * เนื้อหาครบถ้วน ไม่ใช่ข้อความว่างเปล่า
   *
   * @returns {string}
   */
  toPlainText() {
    const parts = [this.#title];
    if (this.#subtitle) parts.push(this.#subtitle);
    if (this.#fields.length) {
      parts.push('');
      parts.push(...this.#fields.map((field) => `${field.label}: ${field.value}`));
    }
    if (this.#lines.length) {
      parts.push('');
      parts.push(...this.#lines);
    }
    if (this.#links.length) {
      parts.push('');
      parts.push(...this.#links.map((link) => `${link.label}: ${link.url}`));
    }
    return parts.join('\n');
  }

  /** @returns {object} โครงสร้างสำหรับบันทึกลง log */
  toJSON() {
    return {
      kind: this.#kind,
      title: this.#title,
      subtitle: this.#subtitle,
      summary: this.#summary,
      color: this.#color,
      imageUrl: this.#imageUrl,
      fields: this.#fields,
      lines: this.#lines,
      links: this.#links,
    };
  }

  /**
   * ทำให้รหัสสีอยู่ในรูปแบบ `#RRGGBB`
   * @param {string|null} value รหัสสีดิบ
   * @returns {string|null}
   */
  static #normalizeColor(value) {
    if (!value) return null;
    const hex = String(value).trim().replace(/^#/, '').toUpperCase();
    return /^[0-9A-F]{6}$/.test(hex) ? `#${hex}` : null;
  }

  /**
   * เลือกสีตัวอักษรที่อ่านออกบนพื้นหลังที่กำหนด
   *
   * ใช้สูตรความสว่างรับรู้ ITU-R BT.601 — โซน "ปกติ" เป็นสีเทาอ่อน ถ้าใช้ตัวอักษร
   * สีขาวตายตัวจะอ่านไม่ออก
   *
   * @param {string|null} background สีพื้นหลัง
   * @returns {string} `#FFFFFF` หรือ `#111827`
   */
  static textOn(background) {
    const hex = String(background ?? '').replace('#', '');
    if (hex.length !== 6) return '#FFFFFF';
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#111827' : '#FFFFFF';
  }
}
