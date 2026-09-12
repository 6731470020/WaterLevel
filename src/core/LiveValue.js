/**
 * ตัวช่วยแปลง "ค่าคงที่ หรือ ฟังก์ชันอ่านค่า" ให้เป็นฟังก์ชันอ่านค่าเสมอ
 *
 * ทำไมต้องมี: ค่าตั้งค่าที่ย้ายมาไว้ในฐานข้อมูลต้องอ่าน**ตอนใช้งานจริง** ไม่ใช่
 * ตอนสร้างวัตถุ มิฉะนั้นผู้ดูแลแก้ค่าแล้วจะไม่มีผลจนกว่าจะรีสตาร์ต แต่การบังคับให้
 * ทุกที่ส่งฟังก์ชันเข้ามาทำให้เทสต์และสคริปต์ที่ส่งตัวเลขตรง ๆ อ่านยากขึ้นโดยไม่จำเป็น
 *
 * คลาสนี้จึงรับได้ทั้งสองแบบ — ผู้เรียกที่ต้องการค่าสด ๆ ส่งฟังก์ชันมา
 * ส่วนผู้เรียกที่มีค่าตายตัวอยู่แล้วส่งค่านั้นมาได้เลย
 */
export class LiveValue {
  /**
   * แปลงเป็นฟังก์ชันอ่านค่า
   * @template T
   * @param {T|(() => T)|null|undefined} source ค่าคงที่ หรือฟังก์ชันอ่านค่า
   * @param {T} fallback ค่าที่ใช้เมื่อ `source` เป็น `null` หรือ `undefined`
   * @returns {() => T}
   */
  static reader(source, fallback) {
    if (typeof source === 'function') return () => source() ?? fallback;
    const fixed = source ?? fallback;
    return () => fixed;
  }

  /**
   * แปลงเป็นฟังก์ชันอ่านจำนวนเต็ม
   * @param {number|string|(() => number|string)|null|undefined} source ต้นทาง
   * @param {number} fallback ค่าเมื่ออ่านไม่ได้
   * @returns {() => number}
   */
  static intReader(source, fallback) {
    const read = LiveValue.reader(source, fallback);
    return () => {
      const value = Number(read());
      return Number.isFinite(value) ? value : fallback;
    };
  }

  /**
   * แปลงเป็นฟังก์ชันอ่านค่าจริง/เท็จ — รับสตริง `'true'` / `'1'` จากฐานข้อมูลด้วย
   * @param {boolean|string|(() => boolean|string)|null|undefined} source ต้นทาง
   * @param {boolean} fallback ค่าเมื่ออ่านไม่ได้
   * @returns {() => boolean}
   */
  static boolReader(source, fallback) {
    const read = LiveValue.reader(source, fallback);
    return () => {
      const value = read();
      if (typeof value === 'boolean') return value;
      return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
    };
  }
}
