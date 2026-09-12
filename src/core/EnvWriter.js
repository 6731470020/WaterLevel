import { readFileSync, writeFileSync, existsSync, copyFileSync, chmodSync } from 'node:fs';
import { ValidationError } from './errors/index.js';

/** คีย์ที่อนุญาตให้หน้าตั้งค่าเขียนได้ — กันการเขียนค่าอื่นโดยไม่ตั้งใจ */
const WRITABLE_KEYS = [
  'DB_DRIVER', 'DB_FILE', 'DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD',
  'DB_NAME', 'DB_CONNECTION_LIMIT', 'SESSION_SECRET',
];

/**
 * ตัวอ่านและเขียนไฟล์ `.env` อย่างปลอดภัย
 *
 * ใช้โดยหน้าตั้งค่าครั้งแรกเท่านั้น เขียนแบบ**คงบรรทัดเดิมและคอมเมนต์ไว้ทั้งหมด**
 * แก้เฉพาะค่าที่ระบุ เพื่อไม่ให้ค่าที่ผู้ดูแลตั้งไว้เองหายไป
 *
 * ตั้งสิทธิ์ไฟล์เป็น `0600` เสมอ เพราะไฟล์นี้เก็บรหัสผ่านฐานข้อมูลและ session secret
 */
export class EnvWriter {
  /** @type {string} */
  #path;

  /** @param {string} path พาธไฟล์ `.env` */
  constructor(path) {
    this.#path = path;
  }

  /** @returns {string} พาธไฟล์ */
  get path() { return this.#path; }

  /** @returns {boolean} ไฟล์มีอยู่แล้วหรือยัง */
  get exists() { return existsSync(this.#path); }

  /**
   * อ่านค่าทั้งหมดจากไฟล์
   * @returns {Map<string, string>}
   */
  read() {
    const values = new Map();
    if (!this.exists) return values;

    for (const rawLine of readFileSync(this.#path, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const equals = line.indexOf('=');
      if (equals === -1) continue;
      values.set(line.slice(0, equals).trim(), line.slice(equals + 1).trim());
    }
    return values;
  }

  /**
   * เขียนหรือแก้ค่าที่ระบุ โดยคงบรรทัดและคอมเมนต์เดิมไว้
   *
   * ค่าที่มีอยู่แล้วจะถูกแทนที่ในตำแหน่งเดิม ค่าที่ยังไม่มีจะต่อท้ายไฟล์
   *
   * @param {Record<string, string>} updates คู่คีย์-ค่าที่ต้องการเขียน
   * @param {{template?: string|null}} [options={}] ไฟล์ต้นแบบเมื่อยังไม่มี `.env`
   * @returns {Array<string>} รายชื่อคีย์ที่เขียนจริง
   * @throws {ValidationError} เมื่อมีคีย์ที่ไม่อยู่ในรายการที่อนุญาต
   */
  write(updates, { template = null } = {}) {
    const unknown = Object.keys(updates).filter((key) => !WRITABLE_KEYS.includes(key));
    if (unknown.length) {
      throw new ValidationError(`ไม่อนุญาตให้เขียนค่าเหล่านี้ลง .env: ${unknown.join(', ')}`);
    }

    if (!this.exists && template && existsSync(template)) {
      copyFileSync(template, this.#path);
    }

    const lines = this.exists ? readFileSync(this.#path, 'utf8').split(/\r?\n/) : [];
    const remaining = new Map(Object.entries(updates));

    const output = lines.map((rawLine) => {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) return rawLine;

      const equals = line.indexOf('=');
      if (equals === -1) return rawLine;

      const key = line.slice(0, equals).trim();
      if (!remaining.has(key)) return rawLine;

      const value = remaining.get(key);
      remaining.delete(key);
      return `${key}=${EnvWriter.#quote(value)}`;
    });

    if (remaining.size) {
      output.push('');
      output.push('# ── เพิ่มโดยหน้าตั้งค่าครั้งแรก ──');
      for (const [key, value] of remaining) {
        output.push(`${key}=${EnvWriter.#quote(value)}`);
      }
    }

    writeFileSync(this.#path, `${output.join('\n').replace(/\n+$/, '')}\n`, { mode: 0o600 });

    // บังคับสิทธิ์อีกครั้งเผื่อไฟล์มีอยู่ก่อนแล้วด้วยสิทธิ์ที่กว้างกว่า
    try { chmodSync(this.#path, 0o600); } catch { /* บางระบบไฟล์ไม่รองรับ */ }

    return Object.keys(updates);
  }

  /**
   * ครอบค่าด้วยเครื่องหมายคำพูดเมื่อมีอักขระที่อาจทำให้อ่านผิด
   * @param {string} value ค่า
   * @returns {string}
   */
  static #quote(value) {
    const text = String(value ?? '');
    return /[\s#"']/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
  }
}
