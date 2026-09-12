import { DetectionService } from './DetectionService.js';
import { DetectionResult } from './DetectionResult.js';

/**
 * ข้อมูลจำลองสำหรับตอนพัฒนาและตอนทดสอบ — ไม่ต้องพึ่งเซิร์ฟเวอร์ภายนอก
 *
 * คืนค่าที่แกว่งอย่างนุ่มนวลตามเวลา (คลื่นไซน์คาบ 6 ชั่วโมง บวกความสั่นเล็กน้อย)
 * ทำให้กราฟบนหน้าเว็บดูสมจริงและทดสอบการเปลี่ยนโซนได้จริง
 *
 * ตั้ง `DETECTION_DRIVER=mock` แล้วระบบทั้งหมดทำงานได้ทันทีโดยไม่ต้องมี AI —
 * นี่คือประโยชน์รูปธรรมของการออกแบบด้วย Strategy Pattern
 */
export class MockDetectionService extends DetectionService {
  /** @type {number} */
  #centerPx;
  /** @type {number} */
  #amplitudePx;
  /** @type {number} */
  #periodMs;
  /** @type {Map<number, number>} */
  #jitterSeeds = new Map();

  /**
   * @param {{centerPx?: number, amplitudePx?: number, periodHours?: number}} [options={}]
   */
  constructor({ centerPx = 290, amplitudePx = 80, periodHours = 6 } = {}) {
    super();
    this.#centerPx = Number(centerPx);
    this.#amplitudePx = Number(amplitudePx);
    this.#periodMs = Number(periodHours) * 3600 * 1000;
  }

  /** @returns {string} ชื่อไดรเวอร์ */
  get driver() { return 'mock'; }

  /**
   * สร้างผลการตรวจจับจำลอง
   *
   * ใช้รหัสจุดวัดเป็นตัวเลื่อนเฟส เพื่อให้แต่ละจุดวัดมีรูปคลื่นต่างกันแต่คงที่
   *
   * @param {import('../../models/Station.js').Station} station จุดวัด
   * @param {Array<import('../../models/Roi.js').Roi>} [rois=[]] ขอบเขต ROI (ใช้หาโซนที่ตรงกัน)
   * @returns {Promise<DetectionResult>}
   */
  async detect(station, rois = []) {
    const stationId = Number(station?.id ?? 1);
    const phase = (stationId % 12) * (Math.PI / 6);
    const wave = Math.sin(((Date.now() % this.#periodMs) / this.#periodMs) * 2 * Math.PI + phase);
    const jitter = this.#jitterFor(stationId);
    const raw = this.#centerPx + wave * this.#amplitudePx + jitter;
    const maxPx = Number(station?.imageHeight ?? 576);
    const waterLinePx = Math.min(Math.max(Math.round(raw), 1), maxPx);

    const zone = this.#matchZone(waterLinePx, rois);

    return new DetectionResult({
      waterLinePx,
      zoneName: zone?.label ?? null,
      zoneColor: zone?.color ?? null,
      imageBase64: null,
      processingTime: Math.round((0.3 + Math.random() * 0.7) * 100) / 100,
      pdpaStats: {
        peopleCount: Math.floor(Math.random() * 3),
        facesCount: Math.floor(Math.random() * 2),
        method: station?.pdpaMethod ?? 'blur',
      },
      driver: this.driver,
    });
  }

  /**
   * ไดรเวอร์จำลองพร้อมใช้งานเสมอ
   * @returns {Promise<{healthy: boolean, message: string}>}
   */
  async healthCheck() {
    return { healthy: true, message: 'ใช้ข้อมูลจำลอง (ไม่ได้เชื่อมต่อบริการภายนอก)' };
  }

  /**
   * หาโซนที่พิกเซลตกอยู่ จากโซนของ ROI ชนิดวัดระดับ
   * @param {number} pixel ค่าพิกเซล
   * @param {Array<import('../../models/Roi.js').Roi>} rois ขอบเขต ROI
   * @returns {import('../../models/Zone.js').Zone|null}
   */
  #matchZone(pixel, rois) {
    const zones = (rois ?? [])
      .filter((roi) => roi.isMeasurement)
      .flatMap((roi) => roi.zones)
      .sort((a, b) => a.yPosition - b.yPosition);
    if (!zones.length) return null;
    if (pixel < zones[0].yPosition) return zones[0];
    let matched = zones[0];
    for (const zone of zones) {
      if (pixel >= zone.yPosition) matched = zone;
      else break;
    }
    return matched;
  }

  /**
   * ความสั่นสุ่มประจำจุดวัด — คงที่ตลอดอายุอินสแตนซ์เพื่อไม่ให้ค่ากระโดดจนเข้าโหมดยืนยันทุกรอบ
   * @param {number} stationId รหัสจุดวัด
   * @returns {number} ค่าชดเชยเป็นพิกเซล
   */
  #jitterFor(stationId) {
    if (!this.#jitterSeeds.has(stationId)) {
      this.#jitterSeeds.set(stationId, (Math.random() - 0.5) * 6);
    }
    return this.#jitterSeeds.get(stationId) + (Math.random() - 0.5) * 4;
  }
}
