/**
 * รีเฟรชหน้าอัตโนมัติตามช่วงเวลาที่กำหนด
 *
 * หยุดนับเมื่อผู้ใช้สลับไปแท็บอื่น เพื่อไม่ให้ยิงคำขอทิ้งไว้โดยเปล่าประโยชน์
 * และรีเฟรชทันทีเมื่อกลับมาที่แท็บหากค้างไว้นานเกินช่วงที่กำหนด
 */
class AutoRefresh {
  /** @type {number} */
  #intervalMs;
  /** @type {number|null} */
  #timer = null;
  /** @type {number} */
  #hiddenAt = 0;
  /** @type {HTMLElement|null} */
  #indicator;

  /**
   * @param {{intervalMs?: number, indicator?: HTMLElement|null}} [options={}] ตัวเลือก
   */
  constructor({ intervalMs = 60000, indicator = null } = {}) {
    this.#intervalMs = intervalMs;
    this.#indicator = indicator;
  }

  /**
   * เริ่มนับเวลา
   * @returns {this}
   */
  start() {
    this.#schedule();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.#clear();
        this.#hiddenAt = Date.now();
        return;
      }
      if (Date.now() - this.#hiddenAt >= this.#intervalMs) {
        window.location.reload();
        return;
      }
      this.#schedule();
    });
    return this;
  }

  /** ตั้งเวลารีเฟรชรอบถัดไป */
  #schedule() {
    this.#clear();
    let remaining = Math.floor(this.#intervalMs / 1000);
    this.#updateIndicator(remaining);

    this.#timer = setInterval(() => {
      remaining -= 1;
      this.#updateIndicator(remaining);
      if (remaining <= 0) window.location.reload();
    }, 1000);
  }

  /** หยุดตัวจับเวลา */
  #clear() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  /**
   * แสดงเวลาที่เหลือก่อนรีเฟรช
   * @param {number} seconds จำนวนวินาทีที่เหลือ
   */
  #updateIndicator(seconds) {
    if (!this.#indicator) return;
    this.#indicator.textContent = `อัปเดตอีกครั้งใน ${Math.max(0, seconds)} วินาที`;
  }
}

window.AutoRefresh = AutoRefresh;

document.addEventListener('DOMContentLoaded', () => {
  // หน้าจุดวัดมี StationPage เป็นผู้เริ่มเอง จึงข้ามเพื่อไม่ให้ซ้อนกันสองตัว
  if (document.querySelector('[data-station-slug]')) return;
  const indicator = document.getElementById('lastRefresh');
  new AutoRefresh({ intervalMs: 60000, indicator }).start();
});
