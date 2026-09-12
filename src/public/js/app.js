/**
 * สคริปต์ที่โหลดในทุกหน้า — งานเล็ก ๆ ที่ใช้ร่วมกัน
 *
 * ตั้งใจให้เล็กที่สุด ความสามารถเฉพาะหน้าอยู่ในคลาสของหน้านั้น ๆ
 */
class AppShell {
  /**
   * เริ่มการทำงานทั้งหมด
   * @returns {void}
   */
  static init() {
    AppShell.#bindNavToggle();
    AppShell.#bindConfirmations();
    AppShell.#bindAutoSubmitFilters();
  }

  /** ปุ่มเปิด/ปิดเมนูบนหน้าจอเล็ก */
  static #bindNavToggle() {
    const toggle = document.querySelector('[data-nav-toggle]');
    const nav = document.getElementById('adminNav');
    if (!toggle || !nav) return;

    toggle.addEventListener('click', () => {
      const isOpen = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(isOpen));
    });
  }

  /**
   * ถามยืนยันก่อนทำการที่ย้อนกลับไม่ได้
   *
   * ใช้กับปุ่มที่มี `data-confirm="ข้อความ"` — เป็นเพียงกันพลาดของผู้ใช้
   * การป้องกันจริงยังอยู่ที่สิทธิ์ฝั่งเซิร์ฟเวอร์
   */
  static #bindConfirmations() {
    document.querySelectorAll('[data-confirm]').forEach((element) => {
      element.addEventListener('click', (event) => {
        if (!window.confirm(element.dataset.confirm)) event.preventDefault();
      });
    });
  }

  /** ส่งฟอร์มตัวกรองอัตโนมัติเมื่อเปลี่ยนค่าใน select */
  static #bindAutoSubmitFilters() {
    document.querySelectorAll('[data-auto-submit]').forEach((element) => {
      element.addEventListener('change', () => element.form?.submit());
    });
  }

  /**
   * เรียก API ของระบบพร้อมแนบ CSRF token อัตโนมัติ
   * @param {string} url ปลายทาง
   * @param {{method?: string, body?: object}} [options={}] ตัวเลือก
   * @returns {Promise<object>} ข้อมูลที่ API คืน
   * @throws {Error} เมื่อ API ตอบว่าไม่สำเร็จ
   */
  static async api(url, { method = 'GET', body = null } = {}) {
    const token = document.querySelector('meta[name="csrf-token"]')?.content
      ?? document.querySelector('input[name="_csrf"]')?.value;

    const response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { 'X-CSRF-Token': token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success === false) {
      throw new Error(payload?.error?.message ?? `คำขอไม่สำเร็จ (HTTP ${response.status})`);
    }
    return payload?.data;
  }

  /**
   * แสดงข้อความแจ้งเตือนชั่วคราวที่มุมบนขวา
   * @param {string} message ข้อความ
   * @param {string} [type='info'] ชนิด (`info` | `success` | `warning` | `danger`)
   * @returns {void}
   */
  static toast(message, type = 'info') {
    const element = document.createElement('div');
    element.className = `alert alert--${type}`;
    element.textContent = message;
    element.style.cssText =
      'position:fixed;top:1rem;right:1rem;z-index:200;max-width:24rem;box-shadow:var(--shadow-lg)';
    document.body.appendChild(element);
    setTimeout(() => element.remove(), 5000);
  }
}

window.AppShell = AppShell;
document.addEventListener('DOMContentLoaded', () => AppShell.init());
