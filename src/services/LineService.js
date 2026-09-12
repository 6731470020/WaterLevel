import { BaseService } from '../core/BaseService.js';
import { NotFoundError } from '../core/errors/index.js';

/**
 * บริการจัดการเหตุการณ์และข้อมูลฝั่ง LINE
 *
 * รับเหตุการณ์จาก webhook มาปรับปรุงตาราง `line_groups` / `line_users`
 * และตอบคำสั่งแชทผ่าน `CommandHandler`
 */
export class LineService extends BaseService {
  /** @type {import('../repositories/LineRepository.js').LineRepository} */
  #lineRepository;
  /** @type {import('./notification/NotificationChannel.js').NotificationChannel} */
  #channel;
  /** @type {import('./CommandHandler.js').CommandHandler} */
  #commandHandler;

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../repositories/LineRepository.js').LineRepository} deps.lineRepository ที่เก็บข้อมูล LINE
   * @param {import('./notification/NotificationChannel.js').NotificationChannel} deps.channel ช่องทางแจ้งเตือน
   * @param {import('./CommandHandler.js').CommandHandler} deps.commandHandler ตัวจัดการคำสั่งแชท
   * @param {import('../core/Logger.js').Logger} [deps.logger] ตัวบันทึกเหตุการณ์
   */
  constructor({ lineRepository, channel, commandHandler, logger }) {
    super(lineRepository, logger);
    this.#lineRepository = lineRepository;
    this.#channel = channel;
    this.#commandHandler = commandHandler;
  }

  /**
   * ประมวลผลเหตุการณ์ทั้งชุดจาก webhook
   *
   * เหตุการณ์แต่ละตัวถูกดักข้อผิดพลาดแยกกัน เพื่อไม่ให้เหตุการณ์เดียวที่พังทำให้
   * ทั้งชุดล้มเหลว — LINE จะส่งซ้ำทั้งชุดหากเราตอบไม่สำเร็จ
   *
   * @param {Array<object>} events รายการเหตุการณ์
   * @returns {Promise<{processed: number, failed: number}>}
   */
  async handleEvents(events) {
    let processed = 0;
    let failed = 0;
    for (const event of events ?? []) {
      try {
        await this.handleEvent(event);
        processed += 1;
      } catch (error) {
        failed += 1;
        this.logger.error('line event handling failed', {
          type: event?.type, message: error.message,
        });
      }
    }
    return { processed, failed };
  }

  /**
   * ประมวลผลเหตุการณ์เดียว
   * @param {object} event เหตุการณ์จาก LINE
   * @returns {Promise<void>}
   */
  async handleEvent(event) {
    const sourceType = event?.source?.type ?? 'user';
    const sourceId = event?.source?.groupId ?? event?.source?.roomId ?? event?.source?.userId ?? null;

    switch (event?.type) {
      case 'join':
        if (sourceId) await this.#lineRepository.recordJoin(sourceId, sourceType);
        if (event.replyToken) {
          await this.#channel.reply(event.replyToken, [
            { type: 'text', text: '🙏 ขอบคุณที่เพิ่มระบบวัดระดับน้ำเข้ากลุ่ม\nพิมพ์ "ช่วยเหลือ" เพื่อดูคำสั่งที่ใช้ได้' },
          ]);
        }
        break;

      case 'leave':
        if (sourceId) await this.#lineRepository.recordLeave(sourceId);
        break;

      case 'follow':
        if (event.source?.userId) await this.#lineRepository.recordFollow(event.source.userId);
        if (event.replyToken) {
          await this.#channel.reply(event.replyToken, [
            { type: 'text', text: '🙏 ขอบคุณที่ติดตามระบบวัดระดับน้ำ\nพิมพ์ "สถานะ" เพื่อดูระดับน้ำล่าสุด' },
          ]);
        }
        break;

      case 'unfollow':
        if (event.source?.userId) await this.#lineRepository.recordUnfollow(event.source.userId);
        break;

      case 'message':
        await this.#handleMessage(event, { sourceId, sourceType });
        break;

      case 'postback':
        await this.#handlePostback(event, { sourceId, sourceType });
        break;

      default:
        this.logger.debug('unhandled line event type', { type: event?.type });
    }
  }

  /**
   * กลุ่มและผู้ติดตามทั้งหมด — ใช้ในหน้า `/admin/line`
   * @returns {Promise<{groups: Array<object>, users: Array<object>, counts: {groups: number, users: number}}>}
   */
  async overview() {
    const [groups, users, counts] = await Promise.all([
      this.#lineRepository.allGroups(),
      this.#lineRepository.allUsers(),
      this.#lineRepository.counts(),
    ]);
    return { groups, users, counts };
  }

  /**
   * กลุ่มที่ยังใช้งานอยู่ — ใช้เติมตัวเลือกกลุ่มปลายทางในฟอร์มจุดวัด
   * @returns {Promise<Array<import('../models/LineGroup.js').LineGroup>>}
   */
  async activeGroups() {
    return this.#lineRepository.activeGroups();
  }

  /**
   * ตั้งชื่อกลุ่มเพื่อให้ผู้ดูแลจำได้
   * @param {number} id รหัสแถวในตาราง `line_groups`
   * @param {string|null} displayName ชื่อที่ตั้ง
   * @returns {Promise<void>}
   * @throws {NotFoundError} เมื่อไม่พบกลุ่ม
   */
  async renameGroup(id, displayName) {
    const group = await this.#lineRepository.findById(id);
    if (!group) throw new NotFoundError('ไม่พบกลุ่ม LINE ที่ต้องการ');
    await this.#lineRepository.renameGroup(id, displayName);
  }

  /**
   * จัดการเหตุการณ์ข้อความ — ตอบเฉพาะข้อความที่เป็นคำสั่งที่รู้จัก
   * @param {object} event เหตุการณ์
   * @param {{sourceId: string|null, sourceType: string}} context บริบท
   * @returns {Promise<void>}
   */
  async #handleMessage(event, { sourceId, sourceType }) {
    if (sourceId) {
      if (sourceType === 'user') await this.#lineRepository.touchUser(sourceId).catch(() => {});
      else await this.#lineRepository.touchGroup(sourceId).catch(() => {});
    }
    if (event.message?.type !== 'text') return;

    const replies = await this.#commandHandler.handle(event.message.text, { sourceId, sourceType });
    if (replies.length && event.replyToken) {
      await this.#channel.reply(event.replyToken, replies);
    }
  }

  /**
   * จัดการเหตุการณ์ postback (ปุ่มในข้อความ) — ใช้ตารางคำสั่งชุดเดียวกัน
   * @param {object} event เหตุการณ์
   * @param {{sourceId: string|null, sourceType: string}} context บริบท
   * @returns {Promise<void>}
   */
  async #handlePostback(event, { sourceId, sourceType }) {
    const data = event.postback?.data ?? '';
    const replies = await this.#commandHandler.handle(data, { sourceId, sourceType });
    if (replies.length && event.replyToken) {
      await this.#channel.reply(event.replyToken, replies);
    }
  }
}
