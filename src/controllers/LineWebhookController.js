import { BaseController } from '../core/BaseController.js';
import { ForbiddenError } from '../core/errors/index.js';

/**
 * ควบคุม webhook ของ LINE (`POST /webhooks/line`)
 *
 * **สำคัญ:** ตรวจลายเซ็น `X-Line-Signature` ก่อนแตะข้อมูลใด ๆ ทั้งสิ้น
 * และตอบ `200` ทันทีหลังตรวจผ่าน แล้วจึงประมวลผลเหตุการณ์เบื้องหลัง เพราะ LINE
 * ตัดการเชื่อมต่อและส่งซ้ำหากเราตอบช้าเกิน 1 วินาที
 */
export class LineWebhookController extends BaseController {
  /** @type {import('../services/LineService.js').LineService} */
  #lineService;
  /** @type {import('../services/security/SignatureVerifier.js').SignatureVerifier} */
  #verifier;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../services/LineService.js').LineService} deps.lineService บริการ LINE
   * @param {import('../services/security/SignatureVerifier.js').SignatureVerifier} deps.verifier ตัวตรวจลายเซ็น
   * @param {import('../core/Logger.js').Logger} [deps.logger] ตัวบันทึกเหตุการณ์
   */
  constructor({ lineService, verifier, logger }) {
    super(lineService, logger);
    this.#lineService = lineService;
    this.#verifier = verifier;
  }

  /**
   * รับและประมวลผลเหตุการณ์จาก LINE
   * @param {object} req วัตถุ request
   * @param {object} res วัตถุ response
   * @returns {Promise<void>}
   * @throws {ForbiddenError} เมื่อลายเซ็นไม่ถูกต้องหรือยังไม่ได้ตั้งค่า Channel Secret
   */
  async handleWebhook(req, res) {
    if (!this.#verifier.isConfigured) {
      this.logger.error('line webhook rejected — LINE_CHANNEL_SECRET not configured');
      throw new ForbiddenError('ยังไม่ได้ตั้งค่า LINE Channel Secret');
    }

    const signature = req.get('x-line-signature');
    if (!this.#verifier.verify(req.rawBody, signature)) {
      this.logger.warn('line webhook rejected — invalid signature', { ip: this.clientIp(req) });
      throw new ForbiddenError('ลายเซ็นของคำขอไม่ถูกต้อง');
    }

    const events = Array.isArray(req.body?.events) ? req.body.events : [];

    // ตอบ 200 ทันที ไม่ให้ LINE ต้องรอผลการประมวลผล
    res.status(200).json({ success: true, data: { received: events.length } });

    // ประมวลผลต่อเบื้องหลัง — ข้อผิดพลาดที่นี่ไม่กระทบคำตอบที่ส่งไปแล้ว
    this.#lineService.handleEvents(events)
      .then(({ processed, failed }) => {
        this.logger.info('line webhook processed', { processed, failed });
      })
      .catch((error) => {
        this.logger.error('line webhook processing failed', error);
      });
  }
}
