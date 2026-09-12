/**
 * ตัวควบคุมหน้ารายละเอียดจุดวัดสาธารณะ
 *
 * ประกอบชิ้นส่วนทั้งหมดเข้าด้วยกัน: กล้องสด, ROI ทับภาพ, กราฟ, แกลเลอรี และการรีเฟรช
 * เป็นตัวเดียวที่รู้จักโครงสร้าง DOM ของหน้านี้ — คลาสอื่นใช้ซ้ำได้ในหน้าอื่น
 */
class StationPage {
  /** จังหวะรีเฟรชภาพสด (มิลลิวินาที) — ใกล้เคียงกับแคชฝั่งเซิร์ฟเวอร์ */
  static LIVE_INTERVAL_MS = 2000;

  /** @type {HTMLElement} */
  #root;
  /** @type {object|null} */
  #camera = null;
  /** @type {number|null} ตัวจับเวลารีเฟรชภาพสด */
  #liveTimer = null;
  /** @type {object|null} */
  #overlay = null;
  /** @type {object|null} */
  #chart = null;
  /** @type {Array<object>} */
  #series24h = [];
  /** @type {Array<object>} */
  #series7d = [];

  /** @param {HTMLElement} root อิลิเมนต์รากของหน้า */
  constructor(root) {
    this.#root = root;
  }

  /**
   * เริ่มการทำงานของหน้า
   * @returns {void}
   */
  init() {
    this.#initChart();
    this.#initCamera();
    this.#initLightbox();
    this.#initAutoRefresh();
  }

  /** ตั้งค่ากราฟและปุ่มเปลี่ยนช่วงเวลา */
  #initChart() {
    const canvas = document.getElementById('waterChart');
    if (!canvas || typeof window.WaterChart === 'undefined') return;

    // ⚠️ ห้ามตั้งชื่อ attribute ว่า `data-series-24h` — ขีดที่ตามด้วย**ตัวเลข**
    // ไม่ถูกแปลงเป็น camelCase ทำให้ `dataset.series24h` เป็น undefined เงียบ ๆ
    // (กฎการแปลงใช้เฉพาะขีดที่ตามด้วยตัวอักษรพิมพ์เล็กเท่านั้น)
    this.#series24h = StationPage.#parseJson(canvas.dataset.seriesDay, []);
    this.#series7d = StationPage.#parseJson(canvas.dataset.seriesWeek, []);
    const zones = StationPage.#parseJson(canvas.dataset.zones, []);

    this.#chart = new window.WaterChart(canvas, zones);
    this.#chart.render(this.#series24h);

    document.querySelectorAll('[data-chart-range]').forEach((button) => {
      button.addEventListener('click', () => {
        document.querySelectorAll('[data-chart-range]').forEach((other) => {
          other.classList.toggle('btn--primary', other === button);
        });
        const hours = Number(button.dataset.chartRange);
        this.#chart.render(hours > 48 ? this.#series7d : this.#series24h);
      });
    });
  }

  /** ตั้งค่ากล้องสดและชั้นวาด ROI ทับภาพ */
  #initCamera() {
    const container = document.getElementById('cameraContainer');
    const overlayCanvas = document.getElementById('cameraOverlay');
    if (!container || !overlayCanvas) return;

    const sourceSize = {
      width: Number(container.dataset.imageWidth) || 704,
      height: Number(container.dataset.imageHeight) || 576,
    };

    const zones = StationPage.#parseJson(container.dataset.zones, []);
    const rois = StationPage.#parseJson(container.dataset.rois, []);

    this.#overlay = new window.LiveOverlay({
      canvas: overlayCanvas, rois, zones, sourceSize,
    });

    const latestLine = container.dataset.waterLine;
    if (latestLine) this.#overlay.setWaterLine(Number(latestLine));
    this.#overlay.start();

    // ── ภาพสดผ่านตัวกลางของเรา (กล้องที่ต้องยืนยันตัวตนหรือเป็น HTTP) ──
    //
    // รีเฟรชภาพนิ่งเป็นจังหวะแทนการเปิดสตรีมต่อเนื่อง เพราะสตรีมหนึ่งสายต่อผู้ชม
    // หนึ่งคนจะทำให้กล้อง IP รับไม่ไหวเมื่อมีคนเข้าพร้อมกันหลายคน
    // ฝั่งเซิร์ฟเวอร์แคชไว้ 2 วินาที ผู้ชมกี่คนก็ยิงกล้องเท่าเดิม
    const live = document.getElementById('cameraLive');
    if (live) {
      this.#startLiveRefresh(live, document.getElementById('cameraStatus'));
      return;
    }

    const url = container.dataset.cameraUrl;
    if (!url || typeof window.CameraSource === 'undefined') return;

    const status = document.getElementById('cameraStatus');
    try {
      this.#camera = window.CameraSource.create(container.dataset.cameraType, {
        url,
        container,
        video: document.getElementById('cameraVideo'),
        img: document.getElementById('cameraImage'),
        onStatus: (message) => { if (status) status.textContent = message; },
      });
      this.#camera.start();
    } catch (error) {
      if (status) status.textContent = 'เชื่อมต่อกล้องไม่สำเร็จ';
    }
  }

  /**
   * รีเฟรชภาพสดเป็นจังหวะให้ดูเหมือนวิดีโอ
   *
   * โหลดภาพใหม่ต่อเมื่อภาพก่อนหน้ามาถึงแล้วเท่านั้น — ถ้าตั้งเวลายิงตายตัว
   * แล้วเครือข่ายช้ากว่าจังหวะ คำขอจะกองซ้อนกันจนถล่มทั้งเซิร์ฟเวอร์และกล้อง
   *
   * หยุดเองเมื่อผู้ใช้สลับไปแท็บอื่น เพื่อไม่ให้แท็บที่ไม่มีใครดูยังดูดภาพต่อไป
   *
   * @param {HTMLImageElement} image อิลิเมนต์ภาพ
   * @param {HTMLElement|null} status ป้ายบอกสถานะ
   * @returns {void}
   */
  #startLiveRefresh(image, status) {
    const source = image.dataset.liveSrc;
    let failures = 0;

    const tick = () => {
      if (document.hidden) { this.#liveTimer = setTimeout(tick, 2000); return; }
      image.src = `${source}?t=${Date.now()}`;
    };

    image.addEventListener('load', () => {
      failures = 0;
      if (status) status.textContent = 'ภาพสด';
      this.#liveTimer = setTimeout(tick, StationPage.LIVE_INTERVAL_MS);
    });

    image.addEventListener('error', () => {
      failures += 1;
      if (status) status.textContent = 'ภาพสดขัดข้อง — กำลังลองใหม่';
      // ถอยห่างขึ้นเรื่อย ๆ เมื่อล้มซ้ำ กันการกระหน่ำกล้องที่กำลังมีปัญหา
      const delay = Math.min(StationPage.LIVE_INTERVAL_MS * 2 ** failures, 30000);
      this.#liveTimer = setTimeout(tick, delay);
    });

    if (status) status.textContent = 'กำลังโหลดภาพสด…';
  }

  /** ตั้งค่ากล่องดูภาพขยาย */
  #initLightbox() {
    const root = document.getElementById('lightbox');
    const gallery = document.getElementById('gallery');
    if (root && gallery && typeof window.Lightbox !== 'undefined') {
      new window.Lightbox({ root, gallery });
    }
  }

  /** ตั้งค่าการรีเฟรชอัตโนมัติทุก 60 วินาที */
  #initAutoRefresh() {
    if (typeof window.AutoRefresh === 'undefined') return;
    const indicator = document.getElementById('lastRefresh');
    new window.AutoRefresh({ intervalMs: 60000, indicator }).start();
  }

  /**
   * แปลง JSON จาก data attribute อย่างปลอดภัย
   * @param {string|undefined} value ข้อความ JSON
   * @param {*} fallback ค่าเริ่มต้นเมื่อแปลงไม่ได้
   * @returns {*}
   */
  static #parseJson(value, fallback) {
    if (!value) return fallback;
    try { return JSON.parse(value); } catch { return fallback; }
  }
}

window.StationPage = StationPage;

document.addEventListener('DOMContentLoaded', () => {
  const root = document.querySelector('[data-station-slug]');
  if (root) new StationPage(root).init();
});
