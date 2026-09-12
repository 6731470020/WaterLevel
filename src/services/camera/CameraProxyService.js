import { BaseService } from '../../core/BaseService.js';
import { DigestClient } from './DigestClient.js';
import { NotFoundError, UpstreamError, ValidationError } from '../../core/errors/index.js';

/** อายุของภาพที่แคชไว้สำหรับหน้าสาธารณะ (มิลลิวินาที) */
const PUBLIC_CACHE_MS = 2000;

/** เส้นทาง snapshot มาตรฐานของกล้องแต่ละยี่ห้อ เรียงตามความน่าจะเป็น */
const SNAPSHOT_PATHS = Object.freeze([
  '/axis-cgi/jpg/image.cgi',        // Axis
  '/cgi-bin/snapshot.cgi',          // Dahua
  '/ISAPI/Streaming/channels/101/picture', // Hikvision
  '/snapshot.jpg',                  // ทั่วไป
]);

/**
 * ตัวกลางระหว่างเบราว์เซอร์กับกล้อง IP
 *
 * ทำไมต้องมี — ต่อกล้องจากเบราว์เซอร์ตรง ๆ ติดกำแพงสี่ชั้นพร้อมกัน:
 *
 * 1. **Digest auth** — `http://user:pass@host/…` พาได้เฉพาะ Basic และเบราว์เซอร์
 *    ตัดรหัสผ่านทิ้งจาก URL ของ subresource มาตั้งแต่ Chrome 59
 * 2. **Mixed content** — หน้าเว็บเป็น HTTPS แต่กล้องเป็น HTTP เบราว์เซอร์บล็อก
 * 3. **Canvas ปนเปื้อน** — กล้องไม่ส่งส่วนหัว CORS จับเฟรมด้วย `toDataURL()` ไม่ได้
 * 4. **รหัสผ่านรั่ว** — `camera_url` ถูกพิมพ์ลงหน้าสาธารณะ
 *
 * ให้เซิร์ฟเวอร์ดึงภาพมาแล้วเสิร์ฟต่อจาก origin ของเราเอง แก้ได้ทั้งสี่ข้อในทางเดียว
 * รหัสผ่านไม่เคยออกจากเครื่องเซิร์ฟเวอร์
 */
export class CameraProxyService extends BaseService {
  /** @type {import('../../repositories/StationRepository.js').StationRepository} */
  #stationRepository;
  /**
   * ภาพล่าสุดต่อจุดวัด พร้อมคำขอที่กำลังทำงานอยู่
   * @type {Map<number, {at: number, buffer: Buffer|null, pending: Promise<object>|null}>}
   */
  #cache = new Map();

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../../repositories/StationRepository.js').StationRepository} deps.stationRepository ที่เก็บจุดวัด
   * @param {import('../../core/Logger.js').Logger} [deps.logger] ตัวบันทึกเหตุการณ์
   */
  constructor({ stationRepository, logger }) {
    super(stationRepository, logger);
    this.#stationRepository = stationRepository;
  }

  /**
   * ดึงภาพนิ่งหนึ่งเฟรมจากกล้อง
   *
   * ลอง URL ที่ตั้งไว้ก่อน แล้วค่อยเดาเส้นทางภาพนิ่งของยี่ห้อที่พบบ่อยเป็นทางถอย
   * ถ้าได้สตรีม MJPEG มาจะอ่านเฉพาะเฟรมแรกแล้วตัดการเชื่อมต่อทันที
   *
   * @param {number} stationId รหัสจุดวัด
   * @param {{timeoutMs?: number}} [options={}] ตัวเลือก
   * @returns {Promise<{buffer: Buffer, contentType: string}>}
   * @throws {NotFoundError} เมื่อไม่พบจุดวัด
   * @throws {ValidationError} เมื่อจุดวัดยังไม่ได้ตั้งค่ากล้อง
   * @throws {UpstreamError} เมื่อกล้องไม่ตอบหรือยืนยันตัวตนไม่ผ่าน
   */
  async snapshot(stationId, { timeoutMs = 15000 } = {}) {
    const station = await this.#requireStation(stationId);
    const client = CameraProxyService.#clientFor(station);
    const candidates = CameraProxyService.snapshotCandidates(station);

    let lastError = null;
    for (const url of candidates) {
      try {
        const response = await client.fetch(url, { timeoutMs });
        if (!response.ok) {
          lastError = new UpstreamError('camera', `กล้องตอบรหัส HTTP ${response.status}`);
          await response.body?.cancel().catch(() => {});
          continue;
        }

        const contentType = response.headers.get('content-type') ?? '';

        // ⚠️ สตรีม MJPEG ไม่มีวันจบ เรียก `arrayBuffer()` ใส่จะค้างและกินหน่วยความจำ
        // ไม่จำกัด ต้องอ่านทีละก้อนจนได้เฟรมแรกครบแล้วตัดการเชื่อมต่อทันที
        const buffer = contentType.startsWith('multipart/')
          ? await CameraProxyService.#firstFrameOf(response)
          : Buffer.from(await response.arrayBuffer());

        // กล้องบางรุ่นตอบ 200 พร้อมหน้า HTML แจ้งข้อผิดพลาด — ตรวจ magic bytes
        // แทนการเชื่อ content-type เพราะ MJPEG ก็ขึ้นต้นด้วย image/ เหมือนกัน
        if (!buffer || buffer[0] !== 0xFF || buffer[1] !== 0xD8) {
          lastError = new UpstreamError('camera',
            `เส้นทาง ${new URL(url).pathname} ไม่ได้คืนภาพ JPEG (ได้ ${contentType || 'ไม่ทราบชนิด'})`);
          continue;
        }

        return { buffer, contentType: 'image/jpeg' };
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError ?? new UpstreamError('camera', 'ดึงภาพจากกล้องไม่สำเร็จ');
  }

  /**
   * ภาพนิ่งสำหรับหน้าสาธารณะ — แคชไว้สั้น ๆ และรวมคำขอที่ซ้อนกัน
   *
   * ผู้ชม 100 คนต้องไม่กลายเป็นการยิงกล้อง 100 ครั้ง กล้อง IP ตัวเล็ก ๆ
   * รับไม่ไหวและจะหยุดตอบทั้งระบบรวมถึงรอบตรวจวัดที่สำคัญกว่า
   *
   * นอกจากแคชแล้วยังรวมคำขอที่เข้ามาพร้อมกัน (`pending`) ไว้เป็นคำขอเดียว —
   * ถ้าแคชหมดอายุพอดีตอนมีคนเปิดพร้อมกัน 50 คน จะยังยิงกล้องแค่ครั้งเดียว
   *
   * @param {number} stationId รหัสจุดวัด
   * @returns {Promise<{buffer: Buffer, contentType: string, cached: boolean}>}
   */
  async cachedSnapshot(stationId) {
    const entry = this.#cache.get(stationId);
    const now = Date.now();

    if (entry?.buffer && now - entry.at < PUBLIC_CACHE_MS) {
      return { buffer: entry.buffer, contentType: 'image/jpeg', cached: true };
    }
    if (entry?.pending) return { ...(await entry.pending), cached: true };

    const pending = this.snapshot(stationId)
      .then((result) => {
        this.#cache.set(stationId, { at: Date.now(), buffer: result.buffer, pending: null });
        return result;
      })
      .catch((error) => {
        this.#cache.set(stationId, { at: 0, buffer: null, pending: null });
        throw error;
      });

    this.#cache.set(stationId, { at: entry?.at ?? 0, buffer: entry?.buffer ?? null, pending });
    return { ...(await pending), cached: false };
  }

  /**
   * เปิดสตรีมจากกล้องเพื่อส่งต่อให้เบราว์เซอร์
   *
   * คืน `Response` ดิบเพื่อให้ผู้เรียกส่งต่อสตรีมได้โดยไม่ต้องเก็บทั้งก้อนในหน่วยความจำ
   * — สตรีม MJPEG ไม่มีวันจบ ถ้าอ่านจนหมดก่อนค่อยส่งต่อจะกินหน่วยความจำไม่จำกัด
   *
   * @param {number} stationId รหัสจุดวัด
   * @param {{signal?: AbortSignal}} [options={}] ตัวเลือก
   * @returns {Promise<Response>}
   * @throws {UpstreamError} เมื่อกล้องไม่ตอบ
   */
  async openStream(stationId, { signal = null } = {}) {
    const station = await this.#requireStation(stationId);
    const client = CameraProxyService.#clientFor(station);

    const response = await client.fetch(station.cameraUrl, { timeoutMs: 20000, signal });
    if (!response.ok) {
      throw new UpstreamError('camera', `กล้องตอบรหัส HTTP ${response.status}`);
    }
    return response;
  }

  /**
   * ทดสอบว่าเชื่อมต่อกล้องได้ — ใช้จากหน้าตั้งค่าจุดวัด
   * @param {number} stationId รหัสจุดวัด
   * @returns {Promise<{ok: boolean, message: string, width?: number, height?: number, bytes?: number}>}
   */
  async test(stationId) {
    try {
      const { buffer } = await this.snapshot(stationId, { timeoutMs: 12000 });
      const size = CameraProxyService.readJpegSize(buffer);
      return {
        ok: true,
        bytes: buffer.length,
        ...size,
        message: size
          ? `เชื่อมต่อได้ · ภาพขนาด ${size.width}×${size.height} พิกเซล`
          : 'เชื่อมต่อได้ แต่อ่านขนาดภาพไม่ได้',
      };
    } catch (error) {
      return { ok: false, message: error.message };
    }
  }

  /**
   * รายการ URL ที่ควรลองเพื่อขอภาพนิ่ง เรียงตามลำดับที่ควรลอง
   *
   * @param {import('../../models/Station.js').Station} station จุดวัด
   * @returns {Array<string>}
   */
  static snapshotCandidates(station) {
    const url = new URL(station.cameraUrl);
    const origin = `${url.protocol}//${url.host}`;
    const configured = url.toString();

    // URL ที่ตั้งไว้ได้ลองก่อนเสมอ แล้วค่อยเดาเส้นทางของยี่ห้อที่พบบ่อยเป็นทางถอย
    //
    // ไม่เชื่อค่า `camera_type` ที่ผู้ดูแลเลือกไว้เพียงอย่างเดียว เพราะเลือกเป็น
    // "snapshot" แต่วาง URL ของสตรีมมาเป็นเรื่องที่เกิดง่ายมาก — ถ้าเชื่อตามนั้น
    // ระบบจะล้มทั้งที่กล้องมีเส้นทางภาพนิ่งให้ใช้อยู่แล้ว
    const guesses = SNAPSHOT_PATHS
      .map((path) => `${origin}${path}`)
      .filter((candidate) => candidate !== configured);

    return [configured, ...guesses];
  }

  /**
   * อ่านเฟรม JPEG แรกจากสตรีม multipart แล้วหยุด
   *
   * กล้องที่มีแต่ปลายทาง MJPEG (ไม่มีเส้นทางภาพนิ่ง) ยังต้องดึงภาพเดียวมาใช้ได้
   * — อ่านทีละก้อนจนเจอ `FFD8 … FFD9` ครบหนึ่งเฟรมแล้วตัดการเชื่อมต่อทันที
   * ไม่ปล่อยให้สตรีมไหลต่อจนกินหน่วยความจำ
   *
   * @param {Response} response คำตอบที่เป็นสตรีม multipart
   * @param {number} [maxBytes=8388608] เพดานข้อมูลที่ยอมอ่าน กันสตรีมที่ไม่มีเฟรมเลย
   * @returns {Promise<Buffer|null>}
   */
  static async #firstFrameOf(response, maxBytes = 8 * 1024 * 1024) {
    const reader = response.body?.getReader();
    if (!reader) return null;

    let chunks = Buffer.alloc(0);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks = Buffer.concat([chunks, Buffer.from(value)]);

        const start = chunks.indexOf(Buffer.from([0xFF, 0xD8]));
        if (start !== -1) {
          const end = chunks.indexOf(Buffer.from([0xFF, 0xD9]), start + 2);
          if (end !== -1) return chunks.subarray(start, end + 2);
        }
        if (chunks.length > maxBytes) break;
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return null;
  }

  /**
   * อ่านความกว้าง-สูงจากส่วนหัวของไฟล์ JPEG
   *
   * ทำเองแทนการเรียก `sharp` เพราะต้องการแค่ตัวเลขสองตัวจากไบต์ต้นไฟล์
   * ไม่ต้องถอดรหัสภาพทั้งใบ — เร็วกว่ามากและไม่ต้องผ่านไลบรารีถอดภาพ
   * ซึ่งเป็นจุดที่มีช่องโหว่บ่อยเมื่อรับข้อมูลจากภายนอก
   *
   * @param {Buffer} buffer ข้อมูลภาพ
   * @returns {{width: number, height: number}|null}
   */
  static readJpegSize(buffer) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xFF) { offset += 1; continue; }

      const marker = buffer[offset + 1];
      // SOF0–SOF3 และ SOF5–SOF15 คือเฟรมที่มีขนาดภาพ (ข้าม DHT/DAC/RST)
      const isFrame = (marker >= 0xC0 && marker <= 0xC3)
        || (marker >= 0xC5 && marker <= 0xC7)
        || (marker >= 0xC9 && marker <= 0xCB)
        || (marker >= 0xCD && marker <= 0xCF);

      if (isFrame) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
        offset += 2;
        continue;
      }
      offset += 2 + buffer.readUInt16BE(offset + 2);
    }
    return null;
  }

  /**
   * ดึงจุดวัดพร้อมตรวจว่าตั้งค่ากล้องไว้แล้ว
   * @param {number} stationId รหัสจุดวัด
   * @returns {Promise<import('../../models/Station.js').Station>}
   * @throws {NotFoundError|ValidationError}
   */
  async #requireStation(stationId) {
    const station = await this.#stationRepository.findById(stationId);
    if (!station) throw new NotFoundError('ไม่พบจุดวัดที่ต้องการ');
    if (!station.cameraUrl) {
      throw new ValidationError(`จุดวัด "${station.name}" ยังไม่ได้ตั้งค่า URL กล้อง`);
    }
    return station;
  }

  /**
   * สร้างตัวเรียกที่ถือข้อมูลยืนยันตัวตนของกล้องนั้น
   * @param {import('../../models/Station.js').Station} station จุดวัด
   * @returns {DigestClient}
   */
  static #clientFor(station) {
    return new DigestClient({
      username: station.cameraUsername ?? '',
      password: station.cameraPassword ?? '',
    });
  }

}
