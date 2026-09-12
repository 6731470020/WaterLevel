import { EventEmitter } from 'node:events';
import { Logger } from './Logger.js';

/**
 * ช่องทางสื่อสารแบบ Observer ระหว่างส่วนต่าง ๆ ของระบบ
 *
 * ตัวอย่างการใช้: เมื่อ `MeasurementService` บันทึกค่าวัดสำเร็จ จะประกาศเหตุการณ์
 * `measurement.recorded` ส่วน `AlertJob` รับไปประเมินโซนเอง — ทั้งสองฝ่ายไม่รู้จักกัน
 * ทำให้เพิ่มผู้รับเหตุการณ์ใหม่ได้โดยไม่แก้โค้ดผู้ส่ง
 */
export class EventBus extends EventEmitter {
  /** ชื่อเหตุการณ์ทั้งหมดของระบบ — ใช้ค่าคงที่แทนสตริงดิบเพื่อกันพิมพ์ผิด */
  static EVENTS = Object.freeze({
    MEASUREMENT_RECORDED: 'measurement.recorded',
    MEASUREMENT_REJECTED: 'measurement.rejected',
    ZONE_CHANGED: 'zone.changed',
    ALERT_SENT: 'alert.sent',
    PERMISSIONS_CHANGED: 'permissions.changed',
    STATION_OFFLINE: 'station.offline',
  });

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  /**
   * ประกาศเหตุการณ์แบบไม่รอผล — ผู้รับที่โยนข้อผิดพลาดจะไม่ทำให้ผู้ส่งพัง
   * @param {string} eventName ชื่อเหตุการณ์ (ใช้ `EventBus.EVENTS`)
   * @param {object} payload ข้อมูลของเหตุการณ์
   * @returns {boolean} true เมื่อมีผู้รับอย่างน้อยหนึ่งราย
   */
  publish(eventName, payload) {
    Logger.getInstance().debug('event published', { event: eventName });
    return super.emit(eventName, payload);
  }

  /**
   * ลงทะเบียนผู้รับเหตุการณ์ พร้อมดักข้อผิดพลาดให้อัตโนมัติ
   * @param {string} eventName ชื่อเหตุการณ์
   * @param {(payload: object) => Promise<void>|void} handler ตัวจัดการ
   * @returns {this}
   */
  subscribe(eventName, handler) {
    super.on(eventName, async (payload) => {
      try {
        await handler(payload);
      } catch (error) {
        Logger.getInstance().error(`event handler failed: ${eventName}`, error);
      }
    });
    return this;
  }
}
