/**
 * แหล่งภาพจากกล้อง — คลาสนามธรรมฝั่งเบราว์เซอร์ (พหุสัณฐาน)
 *
 * ระบบรองรับกล้อง 3 แบบที่ทำงานต่างกันสิ้นเชิง:
 * - `SnapshotSource` — ดึงภาพนิ่งซ้ำเป็นระยะ
 * - `M3u8Source` — สตรีม HLS ผ่าน hls.js
 * - `MjpegSource` — สตรีม MJPEG ผ่านแท็ก <img> โดยตรง
 *
 * ผู้เรียกใช้เพียง `CameraSource.create(...)` แล้วเรียก `start()` / `stop()`
 * เหมือนกันทุกแบบ — ไม่ต้องรู้ว่าเบื้องหลังเป็นชนิดใด
 *
 * @abstract
 */
class CameraSource {
  /** @type {string} */
  #url;
  /** @type {HTMLElement} */
  #container;
  /** @type {(status: string, detail?: string) => void} */
  #onStatus;
  /** @type {boolean} */
  #running = false;

  /**
   * @param {{url: string, container: HTMLElement, onStatus?: Function}} options ตัวเลือก
   * @throws {Error} เมื่อพยายามสร้างวัตถุจากคลาสนามธรรมโดยตรง
   */
  constructor({ url, container, onStatus = () => {} }) {
    if (new.target === CameraSource) {
      throw new Error('CameraSource เป็นคลาสนามธรรม สร้างวัตถุโดยตรงไม่ได้');
    }
    this.#url = url;
    this.#container = container;
    this.#onStatus = onStatus;
  }

  /** @returns {string} URL ของกล้อง */
  get url() { return this.#url; }

  /** @returns {HTMLElement} กล่องที่บรรจุภาพ */
  get container() { return this.#container; }

  /** @returns {boolean} กำลังทำงานอยู่หรือไม่ */
  get isRunning() { return this.#running; }

  /**
   * แจ้งสถานะกลับไปยังผู้เรียก
   * @param {string} status ข้อความสถานะ
   * @param {string} [detail] รายละเอียดเพิ่มเติม
   */
  report(status, detail) { this.#onStatus(status, detail); }

  /**
   * ตั้งธงว่ากำลังทำงาน
   * @param {boolean} value สถานะใหม่
   */
  setRunning(value) { this.#running = value; }

  /**
   * เริ่มรับภาพ
   * @abstract
   * @returns {Promise<void>}
   * @throws {Error} เมื่อคลาสลูกไม่ override
   */
  async start() { throw new Error(`${this.constructor.name} ต้อง override start()`); }

  /**
   * หยุดรับภาพและคืนทรัพยากร
   * @abstract
   * @returns {void}
   * @throws {Error} เมื่อคลาสลูกไม่ override
   */
  stop() { throw new Error(`${this.constructor.name} ต้อง override stop()`); }

  /**
   * ขนาดจริงของภาพที่กำลังแสดง — ใช้คำนวณอัตราส่วนตอนวาด ROI ทับ
   * @abstract
   * @returns {{width: number, height: number}|null}
   */
  naturalSize() { return null; }

  /**
   * ภาพพร้อมให้วาดลง canvas แล้วหรือยัง
   *
   * ต่างจาก `isRunning` ตรงที่ `isRunning` แปลว่า "สั่งให้เริ่มแล้ว" ส่วนตัวนี้แปลว่า
   * "มีเฟรมจริงให้ใช้แล้ว" — การเชื่อมต่อสตรีมใช้เวลาสักครู่กว่าจะถึงจุดนั้น
   *
   * @returns {boolean}
   */
  get isReady() { return false; }

  /**
   * จับเฟรมปัจจุบันเป็น data URL — ใช้ในเครื่องมือวาด ROI
   *
   * คืนผลเป็นวัตถุพร้อม**เหตุผลที่แท้จริง**เมื่อทำไม่ได้ เพราะการจับเฟรมล้มเหลวได้
   * หลายสาเหตุที่แก้ต่างกันสิ้นเชิง การรายงานว่าเป็น CORS ทุกกรณีทำให้ผู้ใช้
   * ไล่แก้ผิดจุด (เช่นไปตั้งค่าเซิร์ฟเวอร์กล้อง ทั้งที่แค่ยังไม่ได้กดเชื่อมต่อ)
   *
   * @returns {{ok: boolean, dataUrl?: string, reason?: string}}
   */
  captureFrame() {
    if (!this.isRunning) {
      return { ok: false, reason: 'ยังไม่ได้เชื่อมต่อกล้อง — กดปุ่ม "เชื่อมต่อ" ก่อน' };
    }

    const media = this.mediaElement();
    if (!media) {
      return { ok: false, reason: 'ไม่พบพื้นที่แสดงภาพของกล้องในหน้านี้' };
    }

    if (!this.isReady) {
      return { ok: false, reason: 'ภาพจากกล้องยังโหลดไม่เสร็จ รอสักครู่แล้วลองใหม่' };
    }

    const size = this.naturalSize();
    if (!size) {
      return { ok: false, reason: 'ยังอ่านขนาดภาพจากกล้องไม่ได้ รอสักครู่แล้วลองใหม่' };
    }

    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;

    try {
      canvas.getContext('2d').drawImage(media, 0, 0, size.width, size.height);
    } catch (error) {
      return { ok: false, reason: `วาดภาพจากกล้องไม่สำเร็จ: ${error.message}` };
    }

    try {
      return { ok: true, dataUrl: canvas.toDataURL('image/jpeg', 0.9) };
    } catch {
      // ถึงตรงนี้แปลว่า canvas ถูกปนเปื้อนจริง — เป็นกรณี CORS เพียงกรณีเดียว
      return {
        ok: false,
        reason: 'กล้องนี้ไม่ส่งส่วนหัว CORS จึงคัดลอกภาพออกมาไม่ได้ ' +
                '(ยังวาด ROI ทับภาพสดได้ตามปกติ — ใช้วิธีอัปโหลดภาพนิ่งแทนได้)',
      };
    }
  }

  /**
   * อิลิเมนต์ที่แสดงภาพอยู่
   * @returns {HTMLElement|null}
   */
  mediaElement() { return null; }

  /**
   * โหลดภาพเข้าอิลิเมนต์ โดยพยายามขอแบบ CORS ก่อน แล้วถอยเมื่อกล้องไม่รองรับ
   *
   * **เหตุผลที่ต้องถอย:** เมื่อตั้ง `crossOrigin = 'anonymous'` แล้วกล้องไม่ส่ง
   * ส่วนหัว CORS กลับมา เบราว์เซอร์จะ**ไม่แสดงภาพเลย** ซึ่งแย่กว่าการแสดงภาพได้
   * แต่จับเฟรมไม่ได้ — เพราะหน้าที่หลักของเครื่องมือนี้คือการ*วาด ROI ทับภาพ*
   * ส่วนการจับเฟรมเป็นความสะดวกรอง
   *
   * เมื่อถอยแล้ว canvas จะถูกปนเปื้อนและ `captureFrame()` จะรายงานเรื่อง CORS
   * อย่างถูกต้อง ผู้ใช้ยังอัปโหลดภาพนิ่งแทนได้
   *
   * @param {HTMLImageElement} img อิลิเมนต์ปลายทาง
   * @param {string} src URL ของภาพ
   * @param {CameraSource} source แหล่งภาพที่เรียก (ใช้รายงานสถานะ)
   * @returns {void}
   */
  static loadImage(img, src, source) {
    const onError = () => {
      if (img.crossOrigin === null) {
        source.report('เชื่อมต่อกล้องไม่สำเร็จ');
        return;
      }
      // ลองใหม่โดยไม่ขอ CORS — ยอมให้ canvas ปนเปื้อนแลกกับการที่ภาพแสดงได้
      img.removeAttribute('crossorigin');
      img.addEventListener('error', () => source.report('เชื่อมต่อกล้องไม่สำเร็จ'), { once: true });
      img.src = src;
    };

    img.addEventListener('error', onError, { once: true });
    if (!img.hasAttribute('crossorigin')) img.crossOrigin = 'anonymous';
    img.src = src;
  }

  /**
   * สร้างแหล่งภาพตามชนิดที่กำหนด (Factory)
   * @param {string} type ชนิดกล้อง (`snapshot` | `m3u8` | `mjpeg`)
   * @param {object} options ตัวเลือกที่ส่งต่อให้ constructor
   * @returns {CameraSource}
   * @throws {Error} เมื่อชนิดกล้องไม่รู้จัก
   */
  static create(type, options) {
    switch (type) {
      case 'm3u8': return new M3u8Source(options);
      case 'mjpeg': return new MjpegSource(options);
      case 'snapshot': return new SnapshotSource(options);
      default: throw new Error(`ไม่รู้จักชนิดกล้อง: ${type}`);
    }
  }
}

/**
 * กล้องที่ให้ภาพนิ่ง — ดึงซ้ำเป็นระยะเพื่อจำลองภาพสด
 */
class SnapshotSource extends CameraSource {
  /** @type {HTMLImageElement} */
  #img;
  /** @type {number} */
  #intervalMs;
  /** @type {number|null} */
  #timer = null;

  /**
   * @param {{url: string, container: HTMLElement, img?: HTMLImageElement, intervalMs?: number, onStatus?: Function}} options ตัวเลือก
   */
  constructor(options) {
    super(options);
    this.#img = options.img ?? this.container.querySelector('img');
    this.#intervalMs = options.intervalMs ?? 5000;
  }

  /** @returns {Promise<void>} */
  async start() {
    if (!this.#img) { this.report('ไม่พบพื้นที่แสดงภาพ'); return; }
    this.#img.hidden = false;
    this.setRunning(true);
    this.#refresh();
    this.#timer = setInterval(() => this.#refresh(), this.#intervalMs);
    this.report('เชื่อมต่อแล้ว');
  }

  /** @returns {void} */
  stop() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.setRunning(false);
  }

  /** @returns {boolean} โหลดภาพเสร็จแล้วหรือยัง */
  get isReady() { return Boolean(this.#img?.complete && this.#img.naturalWidth); }

  /** @returns {{width: number, height: number}|null} */
  naturalSize() {
    if (!this.#img?.naturalWidth) return null;
    return { width: this.#img.naturalWidth, height: this.#img.naturalHeight };
  }

  /** @returns {HTMLImageElement} */
  mediaElement() { return this.#img; }

  /** ดึงภาพใหม่ พร้อมเติมพารามิเตอร์กันแคช */
  #refresh() {
    const separator = this.url.includes('?') ? '&' : '?';
    CameraSource.loadImage(this.#img, `${this.url}${separator}_t=${Date.now()}`, this);
  }
}

/**
 * กล้องสตรีม HLS (.m3u8) — ใช้ hls.js หรือการรองรับในตัวของ Safari
 */
class M3u8Source extends CameraSource {
  /** @type {HTMLVideoElement} */
  #video;
  /** @type {object|null} */
  #hls = null;
  /** @type {number|null} */
  #watchdog = null;
  /** @type {number} */
  #networkRetries = 0;
  /** @type {boolean} */
  #hasFrame = false;
  /** @type {boolean} */
  #blockedByAutoplay = false;

  /** จำนวนวินาทีที่รอให้มีเฟรมแรก ก่อนบอกผู้ใช้ว่าน่าจะต่อไม่ได้ */
  static CONNECT_TIMEOUT_SECONDS = 12;
  /** จำนวนครั้งสูงสุดที่ลองโหลดใหม่เมื่อเครือข่ายมีปัญหา */
  static MAX_NETWORK_RETRIES = 3;

  /**
   * @param {{url: string, container: HTMLElement, video?: HTMLVideoElement, onStatus?: Function}} options ตัวเลือก
   */
  constructor(options) {
    super(options);
    this.#video = options.video ?? this.container.querySelector('video');
  }

  /** @returns {Promise<void>} */
  async start() {
    if (!this.#video) { this.report('ไม่พบพื้นที่แสดงวิดีโอ'); return; }
    this.#video.hidden = false;
    this.#networkRetries = 0;
    this.#hasFrame = false;
    this.#blockedByAutoplay = false;
    this.report('กำลังเชื่อมต่อ…');
    this.#startWatchdog();
    this.#watchFrames();

    // Safari และ iOS เล่น HLS ได้เองโดยไม่ต้องใช้ไลบรารี
    if (this.#video.canPlayType('application/vnd.apple.mpegurl')) {
      this.#video.src = this.url;
      this.#video.addEventListener('loadedmetadata', () => {
        this.report('เชื่อมต่อแล้ว');
        this.play();
      }, { once: true });
      this.setRunning(true);
      return;
    }

    if (typeof window.Hls === 'undefined' || !window.Hls.isSupported()) {
      this.#clearWatchdog();
      this.report('เบราว์เซอร์นี้ไม่รองรับสตรีม HLS');
      return;
    }

    this.#hls = new window.Hls({ lowLatencyMode: true, liveDurationInfinity: true });
    this.#hls.loadSource(this.url);
    this.#hls.attachMedia(this.#video);

    this.#hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
      this.report('เชื่อมต่อแล้ว');
      // ห้ามกลืนข้อผิดพลาดตรงนี้ — ถ้าเล่นไม่ได้ผู้ใช้ต้องรู้ว่าเพราะอะไร
      this.play();
    });

    this.#hls.on(window.Hls.Events.ERROR, (event, data) => {
      if (!data.fatal) return;

      if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
        this.#networkRetries += 1;
        if (this.#networkRetries <= M3u8Source.MAX_NETWORK_RETRIES) {
          this.report(`เชื่อมต่อไม่ได้ กำลังลองใหม่ (${this.#networkRetries}/${M3u8Source.MAX_NETWORK_RETRIES})…`);
          this.#hls.startLoad();
          return;
        }
        this.#clearWatchdog();
        this.report(M3u8Source.#networkFailureHint(this.url));
        this.stop();
        return;
      }

      if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
        this.report('ข้อมูลวิดีโอมีปัญหา กำลังกู้คืน…');
        this.#hls.recoverMediaError();
        return;
      }

      this.#clearWatchdog();
      this.report(`เชื่อมต่อกล้องไม่สำเร็จ: ${data.details ?? 'ไม่ทราบสาเหตุ'}`);
      this.stop();
    });

    this.setRunning(true);
  }

  /** @returns {void} */
  stop() {
    this.#clearWatchdog();
    this.#hasFrame = false;
    this.#hls?.destroy();
    this.#hls = null;
    if (this.#video) { this.#video.pause(); this.#video.removeAttribute('src'); }
    this.setRunning(false);
  }

  /**
   * เริ่มจับเวลารอเฟรมแรก
   *
   * ถ้าไม่มีเฟรมภายในเวลาที่กำหนด ให้บอกผู้ใช้ว่าน่าจะเกิดจากอะไร — ดีกว่าปล่อยให้
   * ค้างอยู่ที่ "กำลังเชื่อมต่อ…" ไปเรื่อย ๆ โดยไม่รู้ว่าต้องแก้ตรงไหน
   */
  #startWatchdog() {
    this.#clearWatchdog();
    this.#watchdog = setTimeout(() => {
      if (this.isReady) return;
      this.report(this.#blockedByAutoplay
        ? 'เบราว์เซอร์บล็อกการเล่นอัตโนมัติ — คลิกที่ภาพเพื่อเริ่มเล่น'
        : M3u8Source.#networkFailureHint(this.url));
    }, M3u8Source.CONNECT_TIMEOUT_SECONDS * 1000);
  }

  /** หยุดจับเวลารอเฟรมแรก */
  #clearWatchdog() {
    if (this.#watchdog !== null) clearTimeout(this.#watchdog);
    this.#watchdog = null;
  }

  /**
   * ข้อความอธิบายสาเหตุที่เป็นไปได้เมื่อต่อสตรีมไม่ได้
   *
   * hls.js ดึงไฟล์สตรีมผ่าน XHR จึงต้องอาศัยส่วนหัว CORS — ต่างจากแท็ก `<img>`
   * ที่แสดงภาพข้ามโดเมนได้โดยไม่ต้องมี CORS นี่จึงเป็นสาเหตุที่พบบ่อยที่สุด
   *
   * @param {string} url URL ของสตรีม
   * @returns {string}
   */
  static #networkFailureHint(url) {
    const isHttp = url.startsWith('http://');
    const pageIsHttps = window.location.protocol === 'https:';

    if (isHttp && pageIsHttps) {
      return 'ต่อกล้องไม่ได้ — หน้านี้เปิดผ่าน HTTPS แต่ URL กล้องเป็น HTTP ' +
             'เบราว์เซอร์จึงบล็อก (ต้องใช้ HTTPS ทั้งคู่)';
    }
    return 'ต่อกล้องไม่ได้ — ตรวจสอบว่า URL ถูกต้อง เข้าถึงได้จากเครื่องนี้ ' +
           'และเซิร์ฟเวอร์กล้องส่งส่วนหัว CORS (Access-Control-Allow-Origin) มาด้วย';
  }

  /**
   * มีเฟรมที่วาดลง canvas ได้จริงแล้วหรือยัง
   *
   * ⚠️ `readyState >= 2` **ไม่พอ** — วิดีโอที่โหลดข้อมูลครบแล้วแต่ยังไม่เคยเล่น
   * (เช่นเบราว์เซอร์บล็อกการเล่นอัตโนมัติ) จะรายงาน `readyState = 4` ทั้งที่
   * `drawImage()` วาดออกมาไม่ได้อะไรเลย ผลคือ canvas โปร่งใสและผู้ใช้เห็นเป็นสีดำ
   * โดยไม่มีคำอธิบาย จึงต้องยืนยันว่า**มีเฟรมถูกแสดงจริง**แล้วเท่านั้น
   *
   * @returns {boolean}
   */
  get isReady() {
    return Boolean(this.#hasFrame && this.#video?.videoWidth);
  }

  /** @returns {boolean} เบราว์เซอร์บล็อกการเล่นอัตโนมัติอยู่หรือไม่ */
  get isBlockedByAutoplay() { return this.#blockedByAutoplay; }

  /**
   * เริ่มเล่นวิดีโอ พร้อมจัดการกรณีที่เบราว์เซอร์ปฏิเสธ
   *
   * เบราว์เซอร์อนุญาตให้เล่นอัตโนมัติเฉพาะวิดีโอที่ปิดเสียงและมักต้องมีการโต้ตอบ
   * ของผู้ใช้ก่อน การกลืนข้อผิดพลาดตรงนี้ทำให้ผู้ใช้เห็นจอว่างโดยไม่รู้สาเหตุ
   *
   * @returns {Promise<void>}
   */
  async play() {
    if (!this.#video) return;
    try {
      this.#video.muted = true;   // จำเป็นต่อการเล่นอัตโนมัติในทุกเบราว์เซอร์
      await this.#video.play();
      this.#blockedByAutoplay = false;
    } catch (error) {
      this.#blockedByAutoplay = true;
      this.report('เบราว์เซอร์บล็อกการเล่นอัตโนมัติ — คลิกที่ภาพเพื่อเริ่มเล่น');
    }
  }

  /**
   * เริ่มเฝ้าดูว่ามีเฟรมถูกแสดงจริงหรือยัง
   *
   * ใช้ `requestVideoFrameCallback` เมื่อเบราว์เซอร์รองรับ เพราะเป็น API ที่บอกได้
   * ตรง ๆ ว่า "เฟรมถูกนำเสนอแล้ว" ส่วนเบราว์เซอร์เก่าถอยไปใช้เหตุการณ์ `timeupdate`
   */
  #watchFrames() {
    const video = this.#video;
    if (!video) return;

    if (typeof video.requestVideoFrameCallback === 'function') {
      const onFrame = () => {
        this.#hasFrame = true;
        this.#clearWatchdog();
        if (this.isRunning) video.requestVideoFrameCallback(onFrame);
      };
      video.requestVideoFrameCallback(onFrame);
      return;
    }

    const onProgress = () => {
      if (video.readyState >= 2 && video.currentTime > 0) {
        this.#hasFrame = true;
        this.#clearWatchdog();
      }
    };
    video.addEventListener('timeupdate', onProgress);
    video.addEventListener('loadeddata', onProgress);
  }

  /** @returns {{width: number, height: number}|null} */
  naturalSize() {
    if (!this.#video?.videoWidth) return null;
    return { width: this.#video.videoWidth, height: this.#video.videoHeight };
  }

  /** @returns {HTMLVideoElement} */
  mediaElement() { return this.#video; }
}

/**
 * กล้องสตรีม MJPEG — เบราว์เซอร์เล่นได้เองผ่านแท็ก `<img>`
 */
class MjpegSource extends CameraSource {
  /** @type {HTMLImageElement} */
  #img;

  /**
   * @param {{url: string, container: HTMLElement, img?: HTMLImageElement, onStatus?: Function}} options ตัวเลือก
   */
  constructor(options) {
    super(options);
    this.#img = options.img ?? this.container.querySelector('img');
  }

  /** @returns {Promise<void>} */
  async start() {
    if (!this.#img) { this.report('ไม่พบพื้นที่แสดงภาพ'); return; }
    this.#img.hidden = false;
    this.#img.addEventListener('load', () => this.report('เชื่อมต่อแล้ว'), { once: true });
    this.setRunning(true);
    CameraSource.loadImage(this.#img, this.url, this);
  }

  /** @returns {void} */
  stop() {
    if (this.#img) this.#img.removeAttribute('src');
    this.setRunning(false);
  }

  /** @returns {boolean} มีเฟรมให้ใช้แล้วหรือยัง */
  get isReady() { return Boolean(this.#img?.naturalWidth); }

  /** @returns {{width: number, height: number}|null} */
  naturalSize() {
    if (!this.#img?.naturalWidth) return null;
    return { width: this.#img.naturalWidth, height: this.#img.naturalHeight };
  }

  /** @returns {HTMLImageElement} */
  mediaElement() { return this.#img; }
}

window.CameraSource = CameraSource;
window.SnapshotSource = SnapshotSource;
window.M3u8Source = M3u8Source;
window.MjpegSource = MjpegSource;
