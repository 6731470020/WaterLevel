import { BaseController } from '../core/BaseController.js';
import { NotFoundError } from '../core/errors/index.js';

/**
 * เสิร์ฟภาพจากกล้องผ่านเซิร์ฟเวอร์ของเราเอง
 *
 * ทุกเส้นทางเสิร์ฟจาก origin เดียวกับหน้าเว็บ ทำให้เบราว์เซอร์ไม่ติดทั้ง
 * mixed content, CORS และการปนเปื้อนของ canvas — และรหัสผ่านกล้อง
 * ไม่เคยออกจากเครื่องเซิร์ฟเวอร์
 */
export class CameraController extends BaseController {
  /** @type {import('../services/camera/CameraProxyService.js').CameraProxyService} */
  #cameraProxy;
  /** @type {import('../services/StationService.js').StationService} */
  #stationService;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../services/camera/CameraProxyService.js').CameraProxyService} deps.cameraProxy บริการตัวกลางกล้อง
   * @param {import('../services/StationService.js').StationService} deps.stationService บริการจุดวัด
   * @param {import('../core/Logger.js').Logger} [deps.logger] ตัวบันทึกเหตุการณ์
   */
  constructor({ cameraProxy, stationService, logger }) {
    super(cameraProxy, logger);
    this.#cameraProxy = cameraProxy;
    this.#stationService = stationService;
  }

  /**
   * ภาพนิ่งหนึ่งเฟรม (ต้องเข้าสู่ระบบ + อยู่ในขอบเขตจุดวัด)
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async snapshot(req, res) {
    const { buffer, contentType } = await this.#cameraProxy.snapshot(req.stationId);
    CameraController.#sendImage(res, buffer, contentType);
  }

  /**
   * ภาพสดสำหรับหน้าสาธารณะ — เปิดได้เฉพาะจุดวัดที่ผู้ดูแลอนุญาตไว้
   *
   * ⚠️ ภาพนี้**ไม่ผ่านการเบลอใบหน้า** ต่างจากภาพที่บันทึกไว้ จึงต้องเปิดทีละจุดวัด
   * ไม่ใช่เปิดทั้งระบบ และปิดไว้เป็นค่าเริ่มต้น
   *
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async publicSnapshot(req, res) {
    const station = await this.#stationService.findBySlug(req.params.slug);
    if (!station || !station.publicLiveEnabled) {
      throw new NotFoundError('จุดวัดนี้ไม่ได้เปิดให้ดูภาพสด');
    }

    const { buffer, contentType } = await this.#cameraProxy.cachedSnapshot(station.id);
    CameraController.#sendImage(res, buffer, contentType);
  }

  /**
   * ส่งต่อสตรีมจากกล้องแบบเรียลไทม์
   *
   * ส่งต่อทีละก้อนโดยไม่เก็บทั้งหมดไว้ในหน่วยความจำ — สตรีม MJPEG ไม่มีวันจบ
   * ถ้าอ่านจนหมดก่อนค่อยส่งต่อ หน่วยความจำจะโตไม่หยุดจนกระบวนการตาย
   *
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async stream(req, res) {
    const controller = new AbortController();
    // ผู้ชมปิดแท็บ = ต้องตัดการเชื่อมต่อกับกล้องด้วย ไม่งั้นกล้องจะถูกดูดสตรีมค้างไว้
    res.on('close', () => controller.abort());

    const upstream = await this.#cameraProxy.openStream(req.stationId, {
      signal: controller.signal,
    });

    res.status(200);
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'multipart/x-mixed-replace');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Connection', 'close');

    const reader = upstream.body?.getReader();
    if (!reader) { res.end(); return; }

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        // หยุดเมื่อ buffer ของ response เต็ม เพื่อไม่ให้ค้างในหน่วยความจำ
        if (!res.write(Buffer.from(value))) {
          await new Promise((resolve) => res.once('drain', resolve));
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        this.logger.warn('camera stream interrupted', {
          stationId: req.stationId, message: error.message,
        });
      }
    } finally {
      await reader.cancel().catch(() => {});
      res.end();
    }
  }

  /**
   * ทดสอบการเชื่อมต่อกล้อง — คืนขนาดภาพให้ตั้งค่าจุดวัดได้ถูก
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   */
  async test(req, res) {
    this.ok(res, await this.#cameraProxy.test(req.stationId));
  }

  /**
   * ส่งภาพออกไปพร้อมส่วนหัวที่กันการแคช
   *
   * ห้ามแคชเด็ดขาด — ภาพระดับน้ำเปลี่ยนทุกวินาที ถ้าเบราว์เซอร์หรือ proxy
   * แคชไว้ ผู้ดูแลจะวาด ROI บนภาพเก่าโดยไม่รู้ตัว
   *
   * @param {object} res วัตถุ response
   * @param {Buffer} buffer ข้อมูลภาพ
   * @param {string} contentType ชนิดข้อมูล
   * @returns {void}
   */
  static #sendImage(res, buffer, contentType) {
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.end(buffer);
  }
}
