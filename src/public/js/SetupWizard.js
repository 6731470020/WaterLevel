/**
 * ตัวช่วยหน้าตั้งค่าระบบครั้งแรก
 *
 * ทำสองอย่าง: สลับแผงรายละเอียดตามชนิดฐานข้อมูลที่เลือก
 * และทดสอบการเชื่อมต่อก่อนกดติดตั้งจริง
 */
class SetupWizard {
  /** @type {NodeListOf<HTMLInputElement>} */
  #radios;
  /** @type {NodeListOf<HTMLElement>} */
  #panels;

  constructor() {
    this.#radios = document.querySelectorAll('[data-driver-radio]');
    this.#panels = document.querySelectorAll('[data-driver-panel]');
  }

  /**
   * เริ่มการทำงาน
   * @returns {void}
   */
  init() {
    this.#radios.forEach((radio) => {
      radio.addEventListener('change', () => this.#applyDriver(radio.value));
    });
    this.#applyDriver(this.#selectedDriver());

    document.getElementById('testConnection')
      ?.addEventListener('click', () => this.#testConnection());

    document.getElementById('setupForm')
      ?.addEventListener('submit', (event) => this.#onSubmit(event));
  }

  /**
   * ชนิดฐานข้อมูลที่เลือกอยู่
   * @returns {string}
   */
  #selectedDriver() {
    return [...this.#radios].find((radio) => radio.checked)?.value ?? 'sqlite';
  }

  /**
   * แสดงเฉพาะแผงของชนิดที่เลือก และปิดการส่งค่าของแผงที่ซ่อน
   * @param {string} driver ชนิดฐานข้อมูล
   */
  #applyDriver(driver) {
    this.#panels.forEach((panel) => {
      const matches = panel.dataset.driverPanel === driver;
      panel.hidden = !matches;
      // ปิดการส่งค่าของช่องที่ซ่อน เพื่อไม่ให้ required บล็อกการส่งฟอร์ม
      panel.querySelectorAll('input, select').forEach((input) => {
        input.disabled = !matches;
      });
    });

    document.querySelectorAll('.db-option').forEach((label) => {
      label.classList.toggle('is-selected',
        label.querySelector('[data-driver-radio]')?.value === driver);
    });

    const result = document.getElementById('testResult');
    if (result) result.textContent = '';
  }

  /**
   * ทดสอบการเชื่อมต่อโดยยังไม่บันทึกอะไร
   * @returns {Promise<void>}
   */
  async #testConnection() {
    const button = document.getElementById('testConnection');
    const output = document.getElementById('testResult');

    button.disabled = true;
    output.innerHTML = 'กำลังทดสอบ…';

    try {
      const result = await window.AppShell.api('/setup/test-connection', {
        method: 'POST',
        body: this.#databasePayload(),
      });
      output.innerHTML = `<span class="badge badge--${result.ok ? 'success' : 'danger'}">` +
        `${result.ok ? '✓' : '✗'}</span> ${SetupWizard.#escape(result.message)}`;
    } catch (error) {
      output.innerHTML = `<span class="badge badge--danger">✗</span> ` +
        SetupWizard.#escape(error.message);
    } finally {
      button.disabled = false;
    }
  }

  /**
   * ค่าฐานข้อมูลที่กรอกไว้
   * @returns {object}
   */
  #databasePayload() {
    const driver = this.#selectedDriver();
    const value = (id) => document.getElementById(id)?.value ?? '';

    return driver === 'sqlite'
      ? { driver, file: value('file') }
      : {
        driver,
        host: value('host'),
        port: value('port'),
        user: value('user'),
        password: value('password'),
        database: value('database'),
      };
  }

  /**
   * ตรวจรหัสผ่านตรงกันก่อนส่ง และล็อกปุ่มกันกดซ้ำ
   * @param {SubmitEvent} event เหตุการณ์ส่งฟอร์ม
   */
  #onSubmit(event) {
    const password = document.getElementById('adminPassword').value;
    const confirm = document.getElementById('adminPasswordConfirm').value;

    if (password !== confirm) {
      event.preventDefault();
      window.AppShell.toast('รหัสผ่านและการยืนยันไม่ตรงกัน', 'danger');
      return;
    }

    const button = document.getElementById('installBtn');
    button.disabled = true;
    button.textContent = 'กำลังติดตั้ง… กรุณารอสักครู่';
  }

  /**
   * หนีอักขระ HTML ก่อนใส่ลง innerHTML
   * @param {string} value ข้อความ
   * @returns {string}
   */
  static #escape(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[char]));
  }
}

document.addEventListener('DOMContentLoaded', () => new SetupWizard().init());
