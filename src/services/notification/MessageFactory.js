import { NotificationMessage } from './NotificationMessage.js';

/**
 * ประกอบเนื้อหาข้อความแจ้งเตือนจากวัตถุโดเมน (Factory)
 *
 * คืน `NotificationMessage` ซึ่งยังไม่ผูกกับช่องทางใด — ช่องทางแต่ละตัวรับไปเรนเดอร์
 * ตามรูปแบบของตัวเอง คลาสนี้จึงเป็นที่เดียวที่ตัดสินว่า "จะบอกอะไรบ้าง"
 * และไม่มีที่ไหนต้องตัดสินซ้ำอีก ไม่ว่าจะเพิ่มช่องทางกี่ช่องทาง
 */
export class MessageFactory {
  /** @type {string} */
  #baseUrl;

  /** @param {string} [baseUrl] URL ฐานของระบบ ใช้ประกอบลิงก์ดูรายละเอียด */
  constructor(baseUrl = '') {
    this.#baseUrl = String(baseUrl ?? '').replace(/\/$/, '');
  }

  /**
   * ข้อความเตือนภัยเมื่อระดับน้ำเข้าโซนวิกฤต
   * @param {object} params ข้อมูลที่ใช้ประกอบข้อความ
   * @param {import('../../models/Station.js').Station} params.station จุดวัด
   * @param {import('../../models/Measurement.js').Measurement} params.measurement ค่าวัด
   * @param {import('../../models/values/ZoneLevel.js').ZoneLevel} params.zone โซนที่ตกอยู่
   * @param {string|null} [params.imageUrl] URL ภาพประกอบ (ต้องเป็น HTTPS)
   * @returns {NotificationMessage}
   */
  buildAlert({ station, measurement, zone, imageUrl = null }) {
    // ข้อความที่ส่งถึงชาวบ้านต้องเป็นเมตรเท่านั้น พิกเซลเป็นหน่วยภายในที่ตีความไม่ได้
    const level = measurement.waterLevelM
      ? `${measurement.waterLevelM.value.toFixed(2)} ม.`
      : 'ยังไม่มีค่าเป็นเมตร';
    const when = MessageFactory.formatDateTime(measurement.measuredAt);

    const fields = [
      { label: 'ระดับน้ำ', value: level, emphasis: true },
      { label: 'สถานะ', value: zone.label },
      { label: 'จุดวัด', value: station.name },
      { label: 'เวลา', value: when },
    ];

    // ค่าที่ผิวน้ำติดขอบเฟรมเป็นค่าประมาณขั้นต่ำ ต้องบอกในข้อความแจ้งเตือนด้วย
    // ไม่ใช่บอกแค่บนหน้าเว็บ — คนที่ได้รับ LINE อาจไม่ได้เปิดเว็บดูเลย
    const lines = measurement.isEstimate
      ? ['⚠️ เป็นค่าประมาณขั้นต่ำ — กล้องมองไม่เห็นจุดที่เสาวัดระดับบรรจบผิวน้ำ '
        + 'ระดับจริงอาจต่ำกว่านี้']
      : [];

    return new NotificationMessage({
      kind: 'ALERT',
      title: `⚠️ เตือนภัย: ${zone.label}`,
      subtitle: station.name,
      summary: `⚠️ ${zone.label} — ${station.name} ระดับน้ำ ${level} (${when})`,
      color: zone.color,
      imageUrl,
      fields,
      lines,
      links: this.#links(station),
    });
  }

  /**
   * ข้อความรายงานสรุปประจำวัน
   * @param {object} params ข้อมูลที่ใช้ประกอบข้อความ
   * @param {import('../../models/Station.js').Station} params.station จุดวัด
   * @param {import('../../models/DailyReport.js').DailyReport} params.report รายงาน
   * @param {string|null} [params.imageUrl] URL ภาพประกอบ
   * @returns {NotificationMessage}
   */
  buildDailyReport({ station, report, imageUrl = null }) {
    /**
     * จัดรูปแบบค่าระดับน้ำพร้อมเวลาที่เกิด
     * @param {number|undefined} meter ค่าเมตร
     * @param {string|null} at เวลา
     * @returns {string}
     */
    const format = (meter, at) => {
      if (meter === null || meter === undefined) return '—';
      return at ? `${meter.toFixed(2)} ม. (${at.slice(0, 5)} น.)` : `${meter.toFixed(2)} ม.`;
    };

    return new NotificationMessage({
      kind: 'REPORT',
      title: '📊 รายงานระดับน้ำประจำวัน',
      subtitle: `${station.name} · ${report.thaiDate}`,
      summary: `📊 รายงานระดับน้ำ ${station.name} วันที่ ${report.thaiDate}`,
      color: '#1E3A8A',
      imageUrl,
      fields: [
        { label: 'ระดับสูงสุด', value: format(report.highestMeter?.value, report.highestAt) },
        { label: 'ระดับต่ำสุด', value: format(report.lowestMeter?.value, report.lowestAt) },
        {
          label: 'ระดับปัจจุบัน',
          value: report.currentMeter ? `${report.currentMeter.value.toFixed(2)} ม.` : '—',
          emphasis: true,
        },
        {
          label: 'ส่วนต่าง',
          value: report.rangeMeter === null ? '—' : `${report.rangeMeter.toFixed(2)} ม.`,
        },
        { label: 'จำนวนครั้งที่วัด', value: `${report.measurementCount} ครั้ง` },
      ],
      links: this.#links(station),
    });
  }

  /**
   * ข้อความตอบคำสั่ง "สถานะ" ในแชท
   * @param {Array<{station: object, latest: object|null, zone: object|null}>} entries รายการจุดวัด
   * @returns {NotificationMessage}
   */
  buildStatusSummary(entries) {
    if (!entries?.length) {
      return new NotificationMessage({
        kind: 'INFO',
        title: 'ยังไม่มีข้อมูลระดับน้ำในระบบ',
      });
    }

    const fields = entries.slice(0, 10).map(({ station, latest, zone }) => ({
      label: `${station.name}${zone ? ` · ${zone.label}` : ''}`,
      value: latest?.waterLevelM !== null && latest?.waterLevelM !== undefined
        ? `${Number(latest.waterLevelM).toFixed(2)} ม.`
        : '—',
    }));

    return new NotificationMessage({
      kind: 'STATUS',
      title: '💧 สถานะระดับน้ำล่าสุด',
      subtitle: MessageFactory.formatDateTime(new Date()),
      summary: `สถานะระดับน้ำ ${entries.length} จุดวัด`,
      color: '#0F766E',
      fields,
    });
  }

  /**
   * ข้อความช่วยเหลือแสดงคำสั่งที่ใช้ได้ในแชท
   * @returns {NotificationMessage}
   */
  buildHelp() {
    return new NotificationMessage({
      kind: 'HELP',
      title: '📋 คำสั่งที่ใช้ได้',
      color: '#0F766E',
      lines: [
        '• สถานะ / status — ดูระดับน้ำล่าสุดทุกจุดวัด',
        '• กลุ่ม / group / groupid — ดูรหัสกลุ่มนี้',
        '• ช่วยเหลือ / help / คำสั่ง — แสดงข้อความนี้',
        '• ทดสอบ / test — ทดสอบว่าบอทตอบสนอง',
      ],
    });
  }

  /**
   * ข้อความแจ้งรหัสกลุ่ม (ใช้ตั้งค่า `LINE_DEFAULT_GROUP_ID`)
   * @param {string} groupId รหัสกลุ่ม
   * @returns {NotificationMessage}
   */
  buildGroupId(groupId) {
    return new NotificationMessage({
      kind: 'INFO',
      title: 'รหัสกลุ่มนี้คือ',
      lines: [String(groupId)],
    });
  }

  /**
   * ข้อความทดสอบการเชื่อมต่อ
   * @returns {NotificationMessage}
   */
  buildTest() {
    return new NotificationMessage({
      kind: 'TEST',
      title: '✅ ระบบวัดระดับน้ำทำงานปกติ',
      subtitle: `เวลา ${MessageFactory.formatDateTime(new Date())}`,
      color: '#16A34A',
    });
  }

  /**
   * ลิงก์ท้ายข้อความ — ดูรายละเอียดและเปิดแผนที่
   * @param {import('../../models/Station.js').Station} station จุดวัด
   * @returns {Array<{label: string, url: string}>}
   */
  #links(station) {
    const links = [];
    if (this.#baseUrl) {
      links.push({ label: 'ดูกราฟและภาพล่าสุด', url: `${this.#baseUrl}${station.publicPath}` });
    }
    if (station.latitude !== null && station.longitude !== null) {
      links.push({
        label: 'เปิดแผนที่',
        url: `https://www.google.com/maps/search/?api=1&query=${station.latitude},${station.longitude}`,
      });
    }
    return links;
  }

  /**
   * จัดรูปแบบวันเวลาเป็นภาษาไทยพร้อมปี พ.ศ.
   * @param {Date} date เวลา
   * @returns {string} เช่น `21 ส.ค. 2569 14:35 น.`
   */
  static formatDateTime(date) {
    const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const at = date instanceof Date ? date : new Date(date);
    const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    return `${at.getDate()} ${months[at.getMonth()]} ${at.getFullYear() + 543} ${time} น.`;
  }
}
