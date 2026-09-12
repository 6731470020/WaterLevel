import { DetectionService } from './DetectionService.js';
import { DetectionResult } from './DetectionResult.js';
import { UpstreamError, ValidationError } from '../../core/errors/index.js';
import { Logger } from '../../core/Logger.js';

/** ระยะหน่วงก่อนลองใหม่ในแต่ละครั้ง (มิลลิวินาที) */
const RETRY_DELAYS_MS = [2000, 5000];

/**
 * เกณฑ์ความเชื่อมั่นของการตรวจจับ**เสาวัดระดับ** (YOLO)
 *
 * ⚠️ คนละตัวกับ `pdpa.conf_threshold` ที่ใช้ตรวจใบหน้าเพื่อเบลอ ระบบเดิมส่ง 0.3 ตายตัว
 * (`data/bangpai.tspnextsoftware.com/cron_water_level.php:81`) จึงคงค่าเดียวกันไว้
 * ห้ามผูกกับค่า PDPA ของจุดวัด มิฉะนั้นผู้ดูแลที่ปรับความไวการเบลอใบหน้า
 * จะทำให้การวัดระดับน้ำเพี้ยนตามไปด้วยโดยไม่มีอะไรบอก
 */
const STAFF_CONF_THRESHOLD = 0.3;

/**
 * เรียกบริการตรวจจับด้วย AI ผ่าน HTTP — ไดรเวอร์สำหรับใช้งานจริง
 *
 * ป้องกันตัวเองสามชั้น (CLAUDE.md ข้อ 12.1):
 * 1. timeout 30 วินาที ผ่าน `AbortSignal`
 * 2. ลองซ้ำ 2 ครั้ง หน่วง 2 และ 5 วินาที
 * 3. **circuit breaker** — ล้มเหลวติดกัน 5 ครั้ง หยุดเรียกชั่วคราว 5 นาที
 *    เพื่อไม่ให้ยิงคำขอใส่บริการที่ล่มอยู่ซ้ำ ๆ ทุก 5 นาที
 */
export class HttpDetectionService extends DetectionService {
  /** @type {string} */
  #apiUrl;
  /** @type {string|null} */
  #apiKey;
  /** @type {number} */
  #timeoutMs;
  /** @type {import('../../core/Logger.js').Logger} */
  #logger;
  /** @type {number} */
  #consecutiveFailures = 0;
  /** @type {number} */
  #circuitOpenUntil = 0;

  /** จำนวนครั้งที่ล้มเหลวติดกันก่อนตัดวงจร */
  static FAILURE_THRESHOLD = 5;
  /** ระยะเวลาที่ตัดวงจร (มิลลิวินาที) */
  static CIRCUIT_RESET_MS = 5 * 60 * 1000;

  /**
   * @param {{apiUrl: string, apiKey?: string|null, timeoutMs?: number}} options ค่าตั้งค่า
   * @param {import('../../core/Logger.js').Logger} [logger] ตัวบันทึกเหตุการณ์
   * @throws {ValidationError} เมื่อไม่ได้ตั้งค่า `WATER_API_URL`
   */
  constructor({ apiUrl, apiKey = null, timeoutMs = 30000 }, logger = Logger.getInstance()) {
    super();
    if (!apiUrl) {
      throw new ValidationError('ต้องตั้งค่า WATER_API_URL ใน .env เมื่อใช้ DETECTION_DRIVER=http');
    }
    this.#apiUrl = String(apiUrl).replace(/\/+$/, '');
    this.#apiKey = apiKey;
    this.#timeoutMs = Number(timeoutMs);
    this.#logger = logger;
  }

  /** @returns {string} ชื่อไดรเวอร์ */
  get driver() { return 'http'; }

  /** @returns {boolean} วงจรถูกตัดอยู่หรือไม่ */
  get isCircuitOpen() { return Date.now() < this.#circuitOpenUntil; }

  /**
   * ตรวจจับตำแหน่งผิวน้ำผ่าน `POST {WATER_API_URL}/detect-with-zones`
   * @param {import('../../models/Station.js').Station} station จุดวัด
   * @param {Array<import('../../models/Roi.js').Roi>} [rois=[]] ขอบเขต ROI
   * @returns {Promise<DetectionResult>}
   * @throws {UpstreamError} เมื่อบริการไม่ตอบ ตอบผิดพลาด หรือวงจรถูกตัดอยู่
   * @throws {ValidationError} เมื่อจุดวัดยังไม่ได้ตั้งค่า URL กล้อง
   */
  async detect(station, rois = []) {
    if (this.isCircuitOpen) {
      const seconds = Math.ceil((this.#circuitOpenUntil - Date.now()) / 1000);
      throw new UpstreamError(
        'detection',
        `บริการตรวจจับล้มเหลวติดต่อกันหลายครั้ง หยุดเรียกชั่วคราวอีก ${seconds} วินาที`,
      );
    }
    if (!station.cameraUrl) {
      throw new ValidationError(`จุดวัด "${station.name}" ยังไม่ได้ตั้งค่า URL กล้อง`);
    }

    const payload = this.#buildPayload(station, rois);
    let lastError = null;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        const result = await this.#post('/detect-with-zones', payload);
        const detection = DetectionResult.fromApiResponse(result, this.driver);
        HttpDetectionService.#assertSameCoordinateSpace(station, detection);
        if (detection.isAtFrameEdge) {
          // ไม่ปฏิเสธ — ผู้ดูแลต้องการเก็บข้อมูลไว้ดีกว่าไม่มีอะไรเลย
          // ค่าจะถูกบันทึกพร้อมธง AT_FRAME_EDGE ให้หน้าจอเตือนว่าเป็นค่าประมาณขั้นต่ำ
          this.#logger.warn('water line sits on the frame edge', {
            station: station.slug,
            waterLine: detection.waterLinePx.value,
            imageHeight: detection.imageSize?.height ?? station.imageHeight,
          });
        }
        this.#consecutiveFailures = 0;
        return detection;
      } catch (error) {
        if (error instanceof ValidationError) throw error;

        lastError = error;
        this.#logger.warn('detection attempt failed', {
          station: station.slug, attempt: attempt + 1, message: error.message,
        });
        // ข้อผิดพลาดที่แน่นอนแล้ว ลองซ้ำก็ได้ผลเดิม — ออกจากลูปทันที
        if (error.deterministic) break;
        if (attempt < RETRY_DELAYS_MS.length) {
          await HttpDetectionService.#sleep(RETRY_DELAYS_MS[attempt]);
        }
      }
    }

    this.#recordFailure();
    throw new UpstreamError('detection', `เรียกบริการตรวจจับไม่สำเร็จ: ${lastError?.message ?? 'ไม่ทราบสาเหตุ'}`);
  }

  /**
   * ตรวจว่าบริการภายนอกยังตอบสนอง
   * @returns {Promise<{healthy: boolean, message: string}>}
   */
  async healthCheck() {
    if (this.isCircuitOpen) {
      return { healthy: false, message: 'วงจรถูกตัดชั่วคราวจากความล้มเหลวติดต่อกัน' };
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(`${this.#apiUrl}/health`, {
          method: 'GET',
          headers: this.#headers(),
          signal: controller.signal,
        });
        return response.ok
          ? { healthy: true, message: 'บริการตรวจจับตอบสนองปกติ' }
          : { healthy: false, message: `บริการตรวจจับตอบรหัส ${response.status}` };
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      return { healthy: false, message: `เชื่อมต่อบริการตรวจจับไม่ได้: ${error.message}` };
    }
  }

  /**
   * ประกอบเนื้อคำขอให้ตรงกับสัญญาของบริการเดิม
   * @param {import('../../models/Station.js').Station} station จุดวัด
   * @param {Array<import('../../models/Roi.js').Roi>} rois ขอบเขต ROI
   * @returns {object}
   */
  #buildPayload(station, rois) {
    // ฝังข้อมูลยืนยันตัวตนกลับเข้า URL เฉพาะตอนส่งให้บริการตรวจจับ
    // (ดูเหตุผลใน `#detectionCameraUrl`) — ไม่เคยเก็บรูปแบบนี้ลงฐานข้อมูล
    const cameraUrl = HttpDetectionService.#detectionCameraUrl(station);

    // ⚠️ บริการตรวจจับตัดสินบทบาทของ ROI จาก**ลำดับในอาร์เรย์** ไม่ใช่ฟิลด์ `type`
    // (ตัวแรกถือเป็น ROI วัดระดับเสมอ) ถ้าส่งผิดลำดับ โซนเตือนภัยจะหายไปทั้งหมด
    // และค่าที่วัดได้จะมาจากกรอบผิดใบโดยไม่มีสัญญาณเตือน
    const ordered = [...rois].sort((a, b) => {
      if (a.isMeasurement === b.isMeasurement) return a.sortOrder - b.sortOrder;
      return a.isMeasurement ? -1 : 1;
    });

    return {
      m3u8_url: cameraUrl,
      camera_url: cameraUrl,
      camera_type: station.cameraType,
      conf_threshold: STAFF_CONF_THRESHOLD,
      config: {
        version: '3.0',
        image_width: station.imageWidth,
        image_height: station.imageHeight,
        camera_url: cameraUrl,
        camera_type: station.cameraType,
        rois: ordered.map((roi) => ({
          id: roi.id,
          name: roi.name,
          type: roi.type,
          points: roi.points,
          zones: roi.zones.map((zone) => ({
            name: zone.label,
            color_hex: zone.color.replace('#', ''),
            y_position: zone.yPosition,
          })),
        })),
        pdpa: {
          enabled: station.pdpaEnabled,
          method: station.pdpaMethod,
          blur_strength: station.pdpaBlurStrength,
          conf_threshold: station.pdpaConfThreshold,
        },
      },
    };
  }

  /**
   * ส่งคำขอ POST พร้อม timeout
   * @param {string} path พาธปลายทาง
   * @param {object} payload เนื้อคำขอ
   * @returns {Promise<object>} คำตอบที่แปลงเป็นวัตถุแล้ว
   * @throws {Error} เมื่อคำขอล้มเหลวหรือบริการตอบว่าไม่สำเร็จ
   */
  async #post(path, payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await fetch(`${this.#apiUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.#headers() },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        // อ่านเนื้อคำตอบก่อนเสมอ — บริการตรวจจับส่งเหตุผลเป็นภาษาไทยมาให้ใน body
        // (เช่น "ต้องการอย่างน้อย 1 ROI") การทิ้งไปแล้วรายงานแค่รหัส HTTP
        // ทำให้ผู้ดูแลไม่รู้เลยว่าต้องแก้อะไร
        const detail = await HttpDetectionService.#describeError(response);
        const error = new Error(detail);
        // 4xx คือคำขอของเราไม่ถูกต้อง ลองซ้ำอีกกี่ครั้งก็ได้ผลเดิม
        if (response.status < 500) error.deterministic = true;
        throw error;
      }
      const body = await response.json();
      if (body?.success === false) {
        // บริการตอบ HTTP 200 พร้อม success:false = ตรรกะทางธุรกิจไม่ผ่าน
        // (เช่น "No staff detected in detection ROI") ลองซ้ำอีกกี่ครั้งก็ได้ผลเดิม
        // จึงทำเครื่องหมายไว้ให้ detect() ข้ามการลองซ้ำ ประหยัดเวลาและโควตา GPU
        const error = new Error(body.error ?? 'บริการตอบว่าประมวลผลไม่สำเร็จ');
        error.deterministic = true;
        throw error;
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * URL ที่บริการตรวจจับใช้ดึงภาพได้จริง
   *
   * ฝังชื่อผู้ใช้และรหัสผ่านลงใน URL เมื่อกล้องต้องยืนยันตัวตน — บริการตรวจจับ
   * ใช้ `cv2.VideoCapture()` ซึ่งมี FFmpeg เป็นเบื้องหลัง และ**FFmpeg ทำ Digest ได้**
   * (ทดสอบกับกล้อง Axis จริงแล้ว) จึงไม่ต้องพึ่ง URL สาธารณะของเราเลย
   *
   * ⚠️ แปลว่ารหัสผ่านกล้องเดินทางไปถึงบริการตรวจจับ — ยอมรับได้เพราะเป็นบริการ
   * ของหน่วยงานเองและส่งผ่าน HTTPS แต่ต่างจากการใส่ไว้ใน `camera_url` ตรง ๆ
   * ตรงที่**ไม่มีวันหลุดไปที่เบราว์เซอร์** ซึ่งเป็นช่องรั่วที่ร้ายแรงกว่ามาก
   *
   * @param {import('../../models/Station.js').Station} station จุดวัด
   * @returns {string}
   */
  static #detectionCameraUrl(station) {
    if (!station.cameraNeedsAuth) return station.cameraUrl;

    const url = new URL(station.cameraUrl);
    url.username = encodeURIComponent(station.cameraUsername ?? '');
    url.password = encodeURIComponent(station.cameraPassword ?? '');
    return url.toString();
  }

  /**
   * ตรวจว่าภาพที่บริการประมวลผลอยู่ในระบบพิกัดเดียวกับที่จุดวัดตั้งค่าไว้
   *
   * ⚠️ บริการตรวจจับ (`app.py`) ใช้พิกัด ROI ทับเฟรมดิบตรง ๆ **ไม่มีการย่อขยาย**
   * และไม่เคยอ่าน `image_width`/`image_height` ที่เราส่งไป ถ้าขนาดสตรีมเปลี่ยนไป
   * จากตอนวาด ROI กรอบทั้งหมดจะเคลื่อน และค่าที่ได้จะผิดโดยไม่มีสัญญาณเตือน
   * — ปฏิเสธไปเลยดีกว่าบันทึกค่าที่ผิด (CLAUDE.md ข้อ 6.2)
   *
   * @param {import('../../models/Station.js').Station} station จุดวัด
   * @param {DetectionResult} detection ผลที่ได้
   * @throws {ValidationError} เมื่อขนาดภาพไม่ตรงกับที่ตั้งค่าไว้
   */
  static #assertSameCoordinateSpace(station, detection) {
    const actual = detection.imageSize;
    if (!actual) return;
    if (actual.width === station.imageWidth && actual.height === station.imageHeight) return;

    throw new ValidationError(
      `ขนาดภาพจากกล้องคือ ${actual.width}×${actual.height} พิกเซล `
      + `แต่จุดวัด "${station.name}" ตั้งค่าไว้ ${station.imageWidth}×${station.imageHeight} — `
      + 'กรอบ ROI จุดเทียบค่า และตำแหน่งโซนทั้งหมดอยู่คนละระบบพิกัด '
      + 'ระบบจึงไม่บันทึกค่านี้ กรุณาแก้ขนาดภาพของจุดวัดแล้ววาด ROI กับใส่จุดเทียบค่าใหม่',
    );
  }

  /**
   * อ่านเหตุผลที่บริการปฏิเสธคำขอ
   * @param {Response} response คำตอบที่ไม่สำเร็จ
   * @returns {Promise<string>}
   */
  static async #describeError(response) {
    const fallback = `บริการตอบรหัส HTTP ${response.status}`;
    try {
      const body = await response.json();
      return body?.error ? `${body.error} (HTTP ${response.status})` : fallback;
    } catch {
      return fallback;
    }
  }

  /**
   * ส่วนหัวยืนยันตัวตน
   * @returns {Record<string, string>}
   */
  #headers() {
    return this.#apiKey ? { 'X-API-Key': this.#apiKey } : {};
  }

  /** บันทึกความล้มเหลวและตัดวงจรเมื่อถึงเกณฑ์ */
  #recordFailure() {
    this.#consecutiveFailures += 1;
    if (this.#consecutiveFailures >= HttpDetectionService.FAILURE_THRESHOLD) {
      this.#circuitOpenUntil = Date.now() + HttpDetectionService.CIRCUIT_RESET_MS;
      this.#consecutiveFailures = 0;
      this.#logger.error('detection circuit opened', {
        resetInMinutes: HttpDetectionService.CIRCUIT_RESET_MS / 60000,
      });
    }
  }

  /**
   * หน่วงเวลาแบบไม่บล็อก event loop
   * @param {number} ms มิลลิวินาที
   * @returns {Promise<void>}
   */
  static #sleep(ms) {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
  }
}
