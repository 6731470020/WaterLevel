import { ZoneLevel } from '../models/values/ZoneLevel.js';

/**
 * ตัวแปลและตอบคำสั่งแชทจาก LINE
 *
 * แยกออกจาก `LineWebhookController` เพราะการ*ตีความคำสั่ง*เป็นตรรกะทางธุรกิจ
 * ไม่ใช่เรื่องของ HTTP — ทำให้ทดสอบได้โดยไม่ต้องจำลองคำขอ
 *
 * คำสั่งคงเดิมจากระบบเก่า (CLAUDE.md ข้อ 9.4)
 */
export class CommandHandler {
  /** @type {import('../repositories/StationRepository.js').StationRepository} */
  #stationRepository;
  /** @type {import('./notification/MessageFactory.js').MessageFactory} */
  #messageBuilder;

  /** ตารางคำสั่ง: คำที่ผู้ใช้พิมพ์ → ชื่อคำสั่งภายใน */
  static COMMANDS = Object.freeze({
    สถานะ: 'status', status: 'status', ระดับน้ำ: 'status',
    กลุ่ม: 'group', group: 'group', groupid: 'group',
    ช่วยเหลือ: 'help', help: 'help', คำสั่ง: 'help', เมนู: 'help',
    ทดสอบ: 'test', test: 'test',
  });

  /**
   * @param {object} deps การพึ่งพาที่ฉีดเข้ามา
   * @param {import('../repositories/StationRepository.js').StationRepository} deps.stationRepository ที่เก็บจุดวัด
   * @param {import('./notification/MessageFactory.js').MessageFactory} deps.messageBuilder ตัวสร้างข้อความ
   */
  constructor({ stationRepository, messageBuilder }) {
    this.#stationRepository = stationRepository;
    this.#messageBuilder = messageBuilder;
  }

  /**
   * แปลข้อความเป็นชื่อคำสั่ง
   * @param {string} text ข้อความที่ผู้ใช้พิมพ์
   * @returns {string|null} ชื่อคำสั่ง หรือ null เมื่อไม่ใช่คำสั่งที่รู้จัก
   */
  parse(text) {
    const key = String(text ?? '').trim().toLowerCase().replace(/^[/!]/, '');
    return CommandHandler.COMMANDS[key] ?? null;
  }

  /**
   * ประมวลผลคำสั่งและคืนข้อความที่จะตอบกลับ
   * @param {string} text ข้อความที่ผู้ใช้พิมพ์
   * @param {{sourceId?: string|null, sourceType?: string}} [context={}] บริบทของแหล่งข้อความ
   * @returns {Promise<Array<object>>} รายการข้อความที่จะตอบ (ว่าง = ไม่ตอบ)
   */
  async handle(text, { sourceId = null, sourceType = 'user' } = {}) {
    const command = this.parse(text);
    if (!command) return [];

    switch (command) {
      case 'status':
        return [await this.#buildStatus()];
      case 'group':
        return [sourceId && sourceType !== 'user'
          ? this.#messageBuilder.buildGroupId(sourceId)
          : { type: 'text', text: 'คำสั่งนี้ใช้ได้เฉพาะในกลุ่มเท่านั้น' }];
      case 'help':
        return [this.#messageBuilder.buildHelp()];
      case 'test':
        return [this.#messageBuilder.buildTest()];
      default:
        return [];
    }
  }

  /**
   * ประกอบข้อความสรุปสถานะระดับน้ำล่าสุดทุกจุดวัด
   * @returns {Promise<object>} ข้อความ Flex
   */
  async #buildStatus() {
    const rows = await this.#stationRepository.findWithLatestMeasurement({ activeOnly: true });
    const entries = rows.map(({ station, latest }) => ({
      station,
      latest,
      zone: ZoneLevel.fromKey(latest?.zoneKey),
    }));
    return this.#messageBuilder.buildStatusSummary(entries);
  }
}
