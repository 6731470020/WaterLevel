/**
 * เครื่องมือวาด ROI ฝั่งเบราว์เซอร์ — พอร์ตจาก `data/roi.html` (976 บรรทัด)
 *
 * เขียนใหม่เป็นคลาสแทนฟังก์ชันลอยของเดิม และเพิ่มความสามารถที่ระบบเดิมไม่มี:
 * **บันทึกเข้าฐานข้อมูลผ่าน API** (ของเดิมส่งออกเป็นไฟล์อย่างเดียว)
 *
 * โครงสร้าง:
 * ```
 * RoiEditor          จัดการ canvas, การเลือก, การลาก, undo/redo
 * ├── CameraSource   นามธรรม → Snapshot · M3u8 · Mjpeg  (อยู่ใน CameraSource.js)
 * ├── Roi            polygon 4 มุม, ชนิด measurement | detection
 * ├── Zone           ชื่อ, สี, ตำแหน่ง y
 * └── ConfigSerializer  อ่าน/เขียน JSON (รองรับ version 2.0 และ 3.0)
 * ```
 */

/** รัศมีที่ถือว่าคลิกโดนมุม (พิกเซลบนภาพต้นทาง) */
const HANDLE_RADIUS = 8;
/** จำนวนขั้นสูงสุดของ undo */
const HISTORY_LIMIT = 50;

/**
 * โซนเตือนภัยหนึ่งช่วงในเครื่องมือวาด
 */
class EditorZone {
  /**
   * @param {{key: string, label: string, color: string, yPosition: number, severity: number, alertEnabled?: boolean}} data ข้อมูลโซน
   */
  constructor(data) {
    this.key = data.key;
    this.label = data.label;
    this.color = data.color;
    this.yPosition = Number(data.yPosition);
    this.severity = Number(data.severity);
    this.alertEnabled = data.alertEnabled ?? data.severity <= 2;
    // ระดับน้ำจริงที่ขอบบนโซน — ใส่แล้วเซิร์ฟเวอร์จะสร้างจุดเทียบค่าให้อัตโนมัติ
    this.meterLevel = EditorZone.normalizeMeter(data.meterLevel);
  }

  /**
   * แปลงค่าเมตรที่กรอกให้เป็นตัวเลขหรือ `null`
   * @param {number|string|null} value ค่าดิบ
   * @returns {number|null}
   */
  static normalizeMeter(value) {
    if (value === null || value === undefined || value === '') return null;
    const meter = Number(value);
    return Number.isFinite(meter) && meter >= 0 ? Math.round(meter * 100) / 100 : null;
  }

  /** @returns {EditorZone} สำเนาของโซนนี้ */
  clone() { return new EditorZone({ ...this }); }

  /** @returns {object} โครงสร้างสำหรับส่งไปยัง API */
  toJSON() {
    return {
      key: this.key, label: this.label, color: this.color,
      yPosition: this.yPosition, severity: this.severity, alertEnabled: this.alertEnabled,
      meterLevel: this.meterLevel,
    };
  }
}

/**
 * ขอบเขต ROI หนึ่งกรอบในเครื่องมือวาด
 */
class EditorRoi {
  /**
   * @param {{id?: number, name: string, type?: string, points?: Array<{x: number, y: number}>, zones?: Array<object>}} data ข้อมูล ROI
   */
  constructor(data) {
    this.id = data.id ?? Date.now() + Math.floor(Math.random() * 1000);
    this.name = data.name ?? 'ROI ใหม่';
    this.type = data.type === 'detection' ? 'detection' : 'measurement';
    this.points = (data.points ?? []).map((point) => ({
      x: Math.round(Number(point.x)), y: Math.round(Number(point.y)),
    }));
    this.zones = this.type === 'measurement'
      ? (data.zones ?? []).map((zone) => new EditorZone(zone))
      : [];
  }

  /** @returns {string} สีเส้นกรอบตามชนิด (เหลือง = วัดระดับ, ม่วง = ตรวจจับ) */
  get strokeColor() { return this.type === 'measurement' ? '#EAB308' : '#A855F7'; }

  /** @returns {boolean} เป็น ROI ชนิดวัดระดับหรือไม่ */
  get isMeasurement() { return this.type === 'measurement'; }

  /**
   * กรอบสี่เหลี่ยมที่ครอบ ROI
   * @returns {{x: number, y: number, width: number, height: number}}
   */
  get bounds() {
    const xs = this.points.map((point) => point.x);
    const ys = this.points.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  }

  /**
   * หาลำดับมุมที่อยู่ใกล้จุดที่คลิกภายในรัศมีที่กำหนด
   * @param {number} x พิกัด X
   * @param {number} y พิกัด Y
   * @param {number} [radius=HANDLE_RADIUS] รัศมี
   * @returns {number} ลำดับมุม หรือ -1 เมื่อไม่โดน
   */
  hitCorner(x, y, radius = HANDLE_RADIUS) {
    for (let i = 0; i < this.points.length; i += 1) {
      const point = this.points[i];
      if (Math.hypot(point.x - x, point.y - y) <= radius) return i;
    }
    return -1;
  }

  /**
   * ตรวจว่าจุดที่คลิกอยู่ในกรอบ ROI หรือไม่ (ใช้กฎ ray casting)
   * @param {number} x พิกัด X
   * @param {number} y พิกัด Y
   * @returns {boolean}
   */
  contains(x, y) {
    let inside = false;
    const points = this.points;
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
      const intersects = (points[i].y > y) !== (points[j].y > y)
        && x < ((points[j].x - points[i].x) * (y - points[i].y))
             / (points[j].y - points[i].y) + points[i].x;
      if (intersects) inside = !inside;
    }
    return inside;
  }

  /**
   * เลื่อนทั้งกรอบ
   * @param {number} dx ระยะแกน X
   * @param {number} dy ระยะแกน Y
   */
  translate(dx, dy) {
    this.points = this.points.map((point) => ({
      x: Math.round(point.x + dx), y: Math.round(point.y + dy),
    }));
  }

  /** @returns {EditorRoi} สำเนาของ ROI นี้ */
  clone() {
    return new EditorRoi({
      id: this.id, name: this.name, type: this.type,
      points: this.points.map((point) => ({ ...point })),
      zones: this.zones.map((zone) => zone.toJSON()),
    });
  }

  /** @returns {object} โครงสร้างสำหรับส่งไปยัง API */
  toJSON() {
    return {
      name: this.name,
      type: this.type,
      points: this.points,
      zones: this.zones.map((zone) => zone.toJSON()),
    };
  }
}

/**
 * ตัวอ่าน/เขียนไฟล์ config — รองรับทั้ง version 2.0 และ 3.0 ของระบบเดิม
 */
class ConfigSerializer {
  /**
   * อ่านไฟล์ config เป็นรายการ ROI
   *
   * version 3.0 เก็บ `rois: [{ points, zones, type }]`
   * version 2.0 เก็บ `roi: { points }` กับ `zones` แยกไว้ระดับบนสุด
   *
   * @param {object} config วัตถุ config
   * @param {Array<object>} zoneCatalog รายการโซนมาตรฐานสำหรับเทียบชื่อไทย
   * @returns {Array<EditorRoi>}
   * @throws {Error} เมื่ออ่านไม่ได้
   */
  static parse(config, zoneCatalog) {
    if (!config || typeof config !== 'object') {
      throw new Error('ไฟล์ config ไม่ถูกต้อง');
    }

    const toZone = (raw) => {
      const label = raw.name ?? raw.label;
      const match = zoneCatalog.find(
        (zone) => zone.key === (raw.key ?? '').toUpperCase() || zone.label === label,
      );
      if (!match) return null;
      return new EditorZone({
        ...match,
        yPosition: raw.y_position ?? raw.yPosition ?? match.yPosition ?? 0,
        color: raw.color_hex ? `#${String(raw.color_hex).replace('#', '')}` : match.color,
        alertEnabled: raw.alertEnabled ?? raw.alert_enabled,
        // ไฟล์ config เดิม (2.0/3.0) ไม่มีฟิลด์นี้ — จะได้ null แล้วผู้ดูแลค่อยกรอก
        meterLevel: raw.meterLevel ?? raw.meter_level ?? null,
      });
    };

    if (Array.isArray(config.rois)) {
      return config.rois.map((raw, index) => new EditorRoi({
        name: raw.name ?? `ROI_${index + 1}`,
        type: raw.type,
        points: raw.points,
        zones: (raw.zones ?? []).map(toZone).filter(Boolean),
      }));
    }

    if (config.roi?.points) {
      return [new EditorRoi({
        name: config.roi.name ?? config.location_name ?? 'ROI_วัดระดับ',
        type: 'measurement',
        points: config.roi.points,
        zones: (config.zones ?? []).map(toZone).filter(Boolean),
      })];
    }

    throw new Error('อ่าน ROI จากไฟล์นี้ไม่ได้ — รองรับเฉพาะเวอร์ชัน 2.0 และ 3.0');
  }

  /**
   * เขียนรายการ ROI เป็นไฟล์ config version 3.0
   * @param {Array<EditorRoi>} rois รายการ ROI
   * @param {object} station ข้อมูลจุดวัด
   * @returns {object}
   */
  static serialize(rois, station) {
    return {
      version: '3.0',
      location_name: station.name,
      image_width: station.imageWidth,
      image_height: station.imageHeight,
      camera_url: station.cameraUrl,
      camera_type: station.cameraType,
      rois: rois.map((roi) => ({
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
      pdpa: station.pdpa,
      created_at: new Date().toISOString(),
    };
  }
}

window.EditorZone = EditorZone;
window.EditorRoi = EditorRoi;
window.ConfigSerializer = ConfigSerializer;
window.ROI_HANDLE_RADIUS = HANDLE_RADIUS;
window.ROI_HISTORY_LIMIT = HISTORY_LIMIT;

/**
 * ตัวควบคุมเครื่องมือวาด ROI ทั้งหมด
 *
 * ความสามารถครบตามระบบเดิม (CLAUDE.md ข้อ 10):
 * - แหล่งภาพ 2 ทาง: อัปโหลดไฟล์ / ต่อกล้อง (snapshot, m3u8, mjpeg) พร้อมปุ่มจับเฟรม
 * - ROI 2 ชนิด: measurement (เหลือง มีโซน) และ detection (ม่วง ไม่มีโซน)
 * - ลากย้ายทั้งกรอบและลากทีละมุม (ตรวจการชนรัศมี 8 พิกเซล)
 * - แก้ไขโซน 6 ระดับ ปรับ y ทีละ ±1 / ±5 พิกเซล
 * - แสดงพิกัดและขนาด ROI แบบสด
 * - นำเข้า/ส่งออก JSON (version 2.0 และ 3.0)
 * - undo / redo
 * - **บันทึกเข้าฐานข้อมูลผ่าน API** (เพิ่มจากระบบเดิม)
 * - เตือนเมื่อโซนเรียงผิดลำดับหรืออยู่นอกกรอบ ROI
 */
class RoiEditor {
  /** @type {HTMLCanvasElement} */
  #canvas;
  /** @type {CanvasRenderingContext2D} */
  #ctx;
  /** @type {object} */
  #station;
  /** @type {Array<object>} */
  #zoneCatalog;
  /** @type {Array<EditorRoi>} */
  #rois = [];
  /** @type {number} */
  #selectedIndex = -1;
  /** @type {HTMLImageElement|null} */
  #backgroundImage = null;
  /** @type {object|null} */
  #camera = null;
  /** @type {Array<string>} */
  #history = [];
  /** @type {Array<string>} */
  #future = [];
  /** @type {{mode: string, cornerIndex: number, lastX: number, lastY: number}|null} */
  #drag = null;
  /** @type {Array<{pixel: number, meter: number}>} */
  #calibration = [];
  /** @type {number|null} */
  #testLevel = null;
  /** @type {object} */
  #elements;

  /**
   * @param {object} options ตัวเลือก
   * @param {HTMLCanvasElement} options.canvas พื้นที่วาด
   * @param {object} options.station ข้อมูลจุดวัด
   * @param {Array<object>} options.rois ROI ที่มีอยู่แล้ว
   * @param {Array<object>} options.zoneCatalog รายการโซนมาตรฐาน 6 ระดับ
   * @param {Array<object>} [options.calibration=[]] จุดเทียบค่า
   * @param {object} options.elements อิลิเมนต์ควบคุมต่าง ๆ ในหน้า
   */
  constructor({ canvas, station, rois, zoneCatalog, calibration = [], elements }) {
    this.#canvas = canvas;
    this.#ctx = canvas.getContext('2d');
    this.#station = station;
    this.#zoneCatalog = zoneCatalog;
    this.#calibration = calibration;
    this.#elements = elements;

    this.#canvas.width = station.imageWidth;
    this.#canvas.height = station.imageHeight;

    this.#rois = (rois ?? []).map((raw) => new EditorRoi(raw));
    if (this.#rois.length) this.#selectedIndex = 0;
  }

  /** @returns {EditorRoi|null} ROI ที่กำลังเลือกอยู่ */
  get selected() {
    return this.#selectedIndex >= 0 ? this.#rois[this.#selectedIndex] : null;
  }

  /** @returns {Array<EditorRoi>} ROI ทั้งหมด */
  get rois() { return this.#rois; }

  /**
   * เริ่มการทำงาน — ผูกเหตุการณ์ทั้งหมดและวาดครั้งแรก
   * @returns {this}
   */
  init() {
    this.#bindCanvas();
    this.#bindToolbar();
    this.#bindImageSources();
    this.#bindKeyboard();
    this.#renderRoiList();
    this.#renderZonePanel();
    this.draw();
    return this;
  }

  // ───────────────────────── การวาด ─────────────────────────

  /**
   * วาดทุกอย่างลง canvas หนึ่งเฟรม
   * @returns {void}
   */
  draw() {
    const ctx = this.#ctx;
    const { width, height } = this.#canvas;

    ctx.clearRect(0, 0, width, height);

    // พื้นหลัง: ภาพจากกล้อง/ไฟล์ หรือลายตารางเมื่อยังไม่มีภาพ
    if (this.#backgroundImage?.complete && this.#backgroundImage.naturalWidth) {
      ctx.drawImage(this.#backgroundImage, 0, 0, width, height);
    } else if (this.#camera?.isReady) {
      try {
        ctx.drawImage(this.#camera.mediaElement(), 0, 0, width, height);
      } catch { this.#drawPlaceholder(ctx, width, height); }
    } else {
      this.#drawPlaceholder(ctx, width, height);
    }

    this.#drawCalibrationLines(ctx, width);
    this.#drawZones(ctx, width);
    this.#drawRois(ctx);
    this.#drawTestLevel(ctx, width);
  }

  /**
   * วาดลายตารางเมื่อยังไม่มีภาพพื้นหลัง
   * @param {CanvasRenderingContext2D} ctx บริบทการวาด
   * @param {number} width ความกว้าง
   * @param {number} height ความสูง
   */
  #drawPlaceholder(ctx, width, height) {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = 0; y < height; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    ctx.fillStyle = '#94a3b8';
    ctx.font = '16px "IBM Plex Sans Thai", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('อัปโหลดภาพหรือเชื่อมต่อกล้องเพื่อเริ่มวาด ROI', width / 2, height / 2);
    ctx.textAlign = 'left';
  }

  /**
   * วาดเส้นจุดเทียบค่าเพื่อให้ตรวจสอบความถูกต้อง
   * @param {CanvasRenderingContext2D} ctx บริบทการวาด
   * @param {number} width ความกว้าง
   */
  #drawCalibrationLines(ctx, width) {
    if (!this.#calibration.length) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(56, 189, 248, .55)';
    ctx.setLineDash([2, 6]);
    ctx.lineWidth = 1;
    ctx.font = '10px monospace';
    ctx.fillStyle = 'rgba(56, 189, 248, .95)';

    for (const point of this.#calibration) {
      ctx.beginPath();
      ctx.moveTo(0, point.pixel);
      ctx.lineTo(width, point.pixel);
      ctx.stroke();
      ctx.fillText(`${point.meter.toFixed(2)} ม.`, 4, point.pixel - 3);
    }
    ctx.restore();
  }

  /**
   * วาดเส้นแบ่งโซนของ ROI ที่เลือกอยู่
   * @param {CanvasRenderingContext2D} ctx บริบทการวาด
   * @param {number} width ความกว้าง
   */
  #drawZones(ctx, width) {
    const roi = this.selected;
    if (!roi?.isMeasurement) return;

    ctx.save();
    ctx.lineWidth = 2;
    ctx.font = '12px "IBM Plex Sans Thai", sans-serif';

    for (const zone of roi.zones) {
      ctx.strokeStyle = zone.color;
      ctx.beginPath();
      ctx.moveTo(0, zone.yPosition);
      ctx.lineTo(width, zone.yPosition);
      ctx.stroke();

      const textWidth = ctx.measureText(zone.label).width + 12;
      ctx.fillStyle = zone.color;
      ctx.fillRect(width - textWidth - 4, zone.yPosition - 17, textWidth, 17);
      ctx.fillStyle = RoiEditor.textOn(zone.color);
      ctx.fillText(zone.label, width - textWidth + 2, zone.yPosition - 5);
    }
    ctx.restore();
  }

  /**
   * วาดกรอบ ROI ทั้งหมด พร้อมเน้นกรอบที่เลือก
   * @param {CanvasRenderingContext2D} ctx บริบทการวาด
   */
  #drawRois(ctx) {
    this.#rois.forEach((roi, index) => {
      if (roi.points.length < 3) return;
      const isSelected = index === this.#selectedIndex;

      ctx.save();
      ctx.strokeStyle = roi.strokeColor;
      ctx.fillStyle = `${roi.strokeColor}${isSelected ? '33' : '18'}`;
      ctx.lineWidth = isSelected ? 3 : 2;

      ctx.beginPath();
      roi.points.forEach((point, i) => {
        if (i === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // จุดจับที่มุม — แสดงเฉพาะกรอบที่เลือก
      if (isSelected) {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = roi.strokeColor;
        ctx.lineWidth = 2;
        roi.points.forEach((point) => {
          ctx.beginPath();
          ctx.arc(point.x, point.y, ROI_HANDLE_RADIUS, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        });
      }

      // ป้ายชื่อ ROI
      const bounds = roi.bounds;
      ctx.fillStyle = roi.strokeColor;
      ctx.font = '12px "IBM Plex Sans Thai", sans-serif';
      const labelWidth = ctx.measureText(roi.name).width + 10;
      ctx.fillRect(bounds.x, bounds.y - 18, labelWidth, 17);
      ctx.fillStyle = RoiEditor.textOn(roi.strokeColor);
      ctx.fillText(roi.name, bounds.x + 5, bounds.y - 6);
      ctx.restore();
    });
  }

  /**
   * วาดเส้นทดสอบระดับน้ำ
   * @param {CanvasRenderingContext2D} ctx บริบทการวาด
   * @param {number} width ความกว้าง
   */
  #drawTestLevel(ctx, width) {
    if (this.#testLevel === null) return;
    ctx.save();
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, this.#testLevel);
    ctx.lineTo(width, this.#testLevel);
    ctx.stroke();
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(4, this.#testLevel - 18, 92, 17);
    ctx.fillStyle = '#fff';
    ctx.font = '12px "IBM Plex Sans Thai", sans-serif';
    ctx.fillText(`ทดสอบ ${this.#testLevel} px`, 8, this.#testLevel - 6);
    ctx.restore();
  }

  // ───────────────────────── การโต้ตอบบน canvas ─────────────────────────

  /**
   * ผูกเหตุการณ์เมาส์และการสัมผัสบน canvas
   * @returns {void}
   */
  #bindCanvas() {
    const canvas = this.#canvas;

    // เบราว์เซอร์บล็อกการเล่นอัตโนมัติได้ — การคลิกของผู้ใช้คือสิ่งที่ปลดล็อกได้
    canvas.addEventListener('click', () => {
      if (this.#camera?.isBlockedByAutoplay) this.#camera.play();
    });

    canvas.addEventListener('mousedown', (event) => {
      const { x, y } = this.#toImageCoords(event);
      this.#startDrag(x, y);
    });

    canvas.addEventListener('mousemove', (event) => {
      const { x, y } = this.#toImageCoords(event);
      this.#updateCursorInfo(x, y);
      if (this.#drag) this.#moveDrag(x, y);
      else this.#updateCursorStyle(x, y);
    });

    window.addEventListener('mouseup', () => this.#endDrag());
    canvas.addEventListener('mouseleave', () => this.#endDrag());

    // รองรับการสัมผัสบนแท็บเล็ต — ผู้ดูแลมักใช้หน้างานจริง
    canvas.addEventListener('touchstart', (event) => {
      const { x, y } = this.#toImageCoords(event.touches[0]);
      this.#startDrag(x, y);
      event.preventDefault();
    }, { passive: false });

    canvas.addEventListener('touchmove', (event) => {
      if (!this.#drag) return;
      const { x, y } = this.#toImageCoords(event.touches[0]);
      this.#moveDrag(x, y);
      event.preventDefault();
    }, { passive: false });

    canvas.addEventListener('touchend', () => this.#endDrag());
  }

  /**
   * แปลงพิกัดบนหน้าจอเป็นพิกัดบนภาพต้นทาง
   *
   * canvas ถูกย่อด้วย CSS ตามความกว้างของกล่อง จึงต้องคูณอัตราส่วนกลับ
   *
   * @param {MouseEvent|Touch} event เหตุการณ์
   * @returns {{x: number, y: number}}
   */
  #toImageCoords(event) {
    const rect = this.#canvas.getBoundingClientRect();
    return {
      x: Math.round((event.clientX - rect.left) * (this.#canvas.width / rect.width)),
      y: Math.round((event.clientY - rect.top) * (this.#canvas.height / rect.height)),
    };
  }

  /**
   * เริ่มลาก — เลือก ROI ที่คลิกโดน แล้วดูว่าโดนมุมหรือตัวกรอบ
   * @param {number} x พิกัด X บนภาพ
   * @param {number} y พิกัด Y บนภาพ
   */
  #startDrag(x, y) {
    // ตรวจจากกรอบบนสุดลงล่าง เพื่อให้เลือกกรอบที่วาดทับได้ถูกตัว
    for (let i = this.#rois.length - 1; i >= 0; i -= 1) {
      const roi = this.#rois[i];
      const cornerIndex = roi.hitCorner(x, y);

      if (cornerIndex >= 0) {
        this.#pushHistory();
        this.select(i);
        this.#drag = { mode: 'corner', cornerIndex, lastX: x, lastY: y };
        return;
      }
      if (roi.contains(x, y)) {
        this.#pushHistory();
        this.select(i);
        this.#drag = { mode: 'move', cornerIndex: -1, lastX: x, lastY: y };
        return;
      }
    }
    this.select(-1);
  }

  /**
   * ลากต่อเนื่อง
   * @param {number} x พิกัด X บนภาพ
   * @param {number} y พิกัด Y บนภาพ
   */
  #moveDrag(x, y) {
    const roi = this.selected;
    if (!roi || !this.#drag) return;

    if (this.#drag.mode === 'corner') {
      roi.points[this.#drag.cornerIndex] = {
        x: RoiEditor.#clamp(x, 0, this.#canvas.width),
        y: RoiEditor.#clamp(y, 0, this.#canvas.height),
      };
    } else {
      roi.translate(x - this.#drag.lastX, y - this.#drag.lastY);
    }

    this.#drag.lastX = x;
    this.#drag.lastY = y;
    this.draw();
    this.#updateRoiInfo();
  }

  /** จบการลาก */
  #endDrag() {
    if (!this.#drag) return;
    this.#drag = null;
    this.#renderRoiList();
    this.#validateZones();
  }

  /**
   * เปลี่ยนรูปเคอร์เซอร์ตามสิ่งที่อยู่ใต้เมาส์
   * @param {number} x พิกัด X
   * @param {number} y พิกัด Y
   */
  #updateCursorStyle(x, y) {
    let cursor = 'crosshair';
    for (const roi of this.#rois) {
      if (roi.hitCorner(x, y) >= 0) { cursor = 'grab'; break; }
      if (roi.contains(x, y)) { cursor = 'move'; }
    }
    this.#canvas.style.cursor = cursor;
  }

  /**
   * แสดงพิกัดเมาส์และค่าเมตรที่ตรงกันแบบสด
   * @param {number} x พิกัด X
   * @param {number} y พิกัด Y
   */
  #updateCursorInfo(x, y) {
    const element = this.#elements.cursorInfo;
    if (!element) return;
    const meter = this.#pixelToMeter(y);
    element.textContent = meter === null
      ? `X: ${x}  Y: ${y}`
      : `X: ${x}  Y: ${y}  ≈ ${meter.toFixed(2)} ม.`;
  }

  /**
   * แปลงพิกเซลเป็นเมตรด้วยจุดเทียบค่าที่โหลดมา (ประมาณค่าเชิงเส้นทีละช่วง)
   *
   * ใช้ตรรกะเดียวกับ `WaterLevelCalculator` ฝั่งเซิร์ฟเวอร์ แต่เป็นเพียง
   * ตัวช่วยแสดงผลระหว่างวาด — ค่าที่บันทึกจริงคำนวณฝั่งเซิร์ฟเวอร์เสมอ
   *
   * @param {number} pixel ค่าพิกเซล
   * @returns {number|null} ค่าเมตร หรือ null เมื่อจุดเทียบค่าไม่ครบ
   */
  #pixelToMeter(pixel) {
    const points = this.#calibration;
    if (points.length < 2) return null;

    const interpolate = (a, b) => {
      const span = b.pixel - a.pixel;
      if (span === 0) return a.meter;
      return a.meter + ((pixel - a.pixel) / span) * (b.meter - a.meter);
    };

    if (pixel <= points[0].pixel) return interpolate(points[0], points[1]);
    const last = points.length - 1;
    if (pixel >= points[last].pixel) return interpolate(points[last - 1], points[last]);
    for (let i = 0; i < last; i += 1) {
      if (pixel >= points[i].pixel && pixel <= points[i + 1].pixel) {
        return interpolate(points[i], points[i + 1]);
      }
    }
    return null;
  }

  // ───────────────────────── การจัดการ ROI ─────────────────────────

  /**
   * เลือก ROI ตามลำดับ
   * @param {number} index ลำดับ (-1 = ไม่เลือกอะไร)
   * @returns {void}
   */
  select(index) {
    this.#selectedIndex = index;
    this.draw();
    this.#renderRoiList();
    this.#renderZonePanel();
    this.#updateRoiInfo();
  }

  /**
   * เพิ่ม ROI ใหม่ตรงกลางภาพ
   * @param {string} type ชนิด (`measurement` | `detection`)
   * @returns {void}
   */
  addRoi(type) {
    this.#pushHistory();

    const width = this.#canvas.width;
    const height = this.#canvas.height;
    const boxWidth = Math.round(width * 0.12);
    const top = Math.round(height * 0.15);
    const bottom = Math.round(height * 0.9);
    const centerX = Math.round(width / 2);

    const count = this.#rois.filter((roi) => roi.type === type).length + 1;
    const roi = new EditorRoi({
      name: type === 'measurement' ? `ROI_วัดระดับ_${count}` : `ROI_ตรวจจับ_${count}`,
      type,
      points: [
        { x: centerX - boxWidth, y: top },
        { x: centerX + boxWidth, y: top },
        { x: centerX + boxWidth, y: bottom },
        { x: centerX - boxWidth, y: bottom },
      ],
      zones: type === 'measurement' ? this.#defaultZones() : [],
    });

    this.#rois.push(roi);
    this.select(this.#rois.length - 1);
    this.#validateZones();
  }

  /**
   * ลบ ROI ที่เลือกอยู่
   * @returns {void}
   */
  removeSelected() {
    if (this.#selectedIndex < 0) return;
    this.#pushHistory();
    this.#rois.splice(this.#selectedIndex, 1);
    this.select(this.#rois.length ? 0 : -1);
    this.#validateZones();
  }

  /**
   * เปลี่ยนชื่อ ROI ที่เลือกอยู่
   * @param {string} name ชื่อใหม่
   * @returns {void}
   */
  renameSelected(name) {
    const roi = this.selected;
    if (!roi) return;
    this.#pushHistory();
    roi.name = String(name).trim().slice(0, 255) || roi.name;
    this.draw();
    this.#renderRoiList();
  }

  /**
   * ชุดโซนเริ่มต้น 6 ระดับ กระจายเท่า ๆ กันตามความสูงภาพ
   * @returns {Array<EditorZone>}
   */
  #defaultZones() {
    const step = Math.floor(this.#canvas.height / (this.#zoneCatalog.length + 1));
    return this.#zoneCatalog.map((zone, index) => new EditorZone({
      ...zone,
      yPosition: step * (index + 1),
    }));
  }

  // ───────────────────────── การจัดการโซน ─────────────────────────

  /**
   * ปรับตำแหน่ง Y ของโซน
   * @param {string} zoneKey คีย์โซน
   * @param {number} delta ระยะที่ต้องการขยับ (พิกเซล)
   * @returns {void}
   */
  nudgeZone(zoneKey, delta) {
    const roi = this.selected;
    const zone = roi?.zones.find((item) => item.key === zoneKey);
    if (!zone) return;
    this.#pushHistory();
    zone.yPosition = RoiEditor.#clamp(zone.yPosition + delta, 0, this.#canvas.height);
    this.draw();
    this.#renderZonePanel();
    this.#validateZones();
  }

  /**
   * ตั้งตำแหน่ง Y ของโซนโดยตรง
   * @param {string} zoneKey คีย์โซน
   * @param {number} value ค่าพิกเซล
   * @returns {void}
   */
  setZonePosition(zoneKey, value) {
    const roi = this.selected;
    const zone = roi?.zones.find((item) => item.key === zoneKey);
    if (!zone) return;
    this.#pushHistory();
    zone.yPosition = RoiEditor.#clamp(Number(value) || 0, 0, this.#canvas.height);
    this.draw();
    this.#validateZones();
  }

  /**
   * กำหนดระดับน้ำจริง (เมตร) ของขอบบนโซน
   *
   * ค่านี้ทำให้โซนกลายเป็นจุดเทียบค่าไปในตัว — เซิร์ฟเวอร์จะสร้างจุดที่พิกเซล
   * `yPosition` ให้อัตโนมัติเมื่อบันทึก ไม่ต้องไปกรอกซ้ำในหน้าเทียบค่าอีก
   *
   * @param {string} zoneKey คีย์โซน
   * @param {string|number} value ค่าเมตร (ว่าง = ไม่ใช้โซนนี้เป็นจุดเทียบค่า)
   * @returns {void}
   */
  setZoneMeter(zoneKey, value) {
    const zone = this.selected?.zones.find((item) => item.key === zoneKey);
    if (!zone) return;
    this.#pushHistory();
    zone.meterLevel = EditorZone.normalizeMeter(value);
    this.#validateZones();
  }

  /**
   * เปิด/ปิดการแจ้งเตือนของโซน
   * @param {string} zoneKey คีย์โซน
   * @param {boolean} enabled เปิดหรือไม่
   * @returns {void}
   */
  setZoneAlert(zoneKey, enabled) {
    const zone = this.selected?.zones.find((item) => item.key === zoneKey);
    if (zone) zone.alertEnabled = Boolean(enabled);
  }

  /**
   * ตรวจความสมเหตุสมผลของโซนแล้วแสดงคำเตือน
   *
   * โซนที่ร้ายแรงกว่าต้องอยู่สูงกว่า (พิกเซล Y น้อยกว่า) เพราะน้ำสูงกว่า
   *
   * @returns {Array<string>} รายการคำเตือน
   */
  #validateZones() {
    const roi = this.selected;
    const warnings = [];

    if (roi?.isMeasurement) {
      const sorted = [...roi.zones].sort((a, b) => a.yPosition - b.yPosition);
      for (let i = 1; i < sorted.length; i += 1) {
        if (sorted[i].severity <= sorted[i - 1].severity) {
          warnings.push(
            `ลำดับโซนผิด — "${sorted[i].label}" อยู่ต่ำกว่า "${sorted[i - 1].label}" ` +
            'แต่ควรร้ายแรงน้อยกว่า',
          );
        }
        if (sorted[i].yPosition === sorted[i - 1].yPosition) {
          warnings.push(`"${sorted[i].label}" กับ "${sorted[i - 1].label}" อยู่ตำแหน่งเดียวกัน`);
        }
      }

      // พิกเซลมาก = น้ำต่ำ ระดับน้ำจึงต้องลดลงตามพิกเซลที่เพิ่มขึ้น
      const withMeter = sorted.filter((zone) => zone.meterLevel !== null);
      for (let i = 1; i < withMeter.length; i += 1) {
        if (withMeter[i].meterLevel >= withMeter[i - 1].meterLevel) {
          warnings.push(
            `ระดับน้ำของ "${withMeter[i].label}" (${withMeter[i].meterLevel} ม.) ` +
            `ไม่ต่ำกว่า "${withMeter[i - 1].label}" (${withMeter[i - 1].meterLevel} ม.) ` +
            'ทั้งที่อยู่ต่ำกว่าในภาพ',
          );
        }
      }
      if (withMeter.length === 1) {
        warnings.push('ใส่ระดับน้ำให้โซนอย่างน้อย 2 โซน ระบบจึงจะสร้างจุดเทียบค่าให้ได้');
      }

      const bounds = roi.bounds;
      for (const zone of roi.zones) {
        if (zone.yPosition < bounds.y || zone.yPosition > bounds.y + bounds.height) {
          warnings.push(`โซน "${zone.label}" อยู่นอกกรอบ ROI`);
        }
      }
    }

    const element = this.#elements.warnings;
    if (element) {
      element.innerHTML = warnings.length
        ? `<div class="alert alert--warning"><strong>ตรวจพบปัญหา</strong><ul>${
          warnings.map((warning) => `<li>${RoiEditor.#escape(warning)}</li>`).join('')}</ul></div>`
        : '';
    }
    return warnings;
  }

  // ───────────────────────── undo / redo ─────────────────────────

  /** บันทึกสถานะปัจจุบันลงประวัติก่อนเปลี่ยนแปลง */
  #pushHistory() {
    this.#history.push(JSON.stringify(this.#rois.map((roi) => roi.toJSON())));
    if (this.#history.length > ROI_HISTORY_LIMIT) this.#history.shift();
    this.#future = [];
    this.#updateHistoryButtons();
  }

  /**
   * ย้อนกลับหนึ่งขั้น
   * @returns {void}
   */
  undo() {
    if (!this.#history.length) return;
    this.#future.push(JSON.stringify(this.#rois.map((roi) => roi.toJSON())));
    this.#restore(this.#history.pop());
  }

  /**
   * ทำซ้ำหนึ่งขั้น
   * @returns {void}
   */
  redo() {
    if (!this.#future.length) return;
    this.#history.push(JSON.stringify(this.#rois.map((roi) => roi.toJSON())));
    this.#restore(this.#future.pop());
  }

  /**
   * คืนสถานะจากสตริง JSON
   * @param {string} snapshot สถานะที่บันทึกไว้
   */
  #restore(snapshot) {
    this.#rois = JSON.parse(snapshot).map((raw) => new EditorRoi(raw));
    this.#selectedIndex = this.#rois.length ? Math.min(this.#selectedIndex, this.#rois.length - 1) : -1;
    this.select(this.#selectedIndex);
    this.#updateHistoryButtons();
    this.#validateZones();
  }

  /** เปิด/ปิดปุ่ม undo และ redo ตามสถานะประวัติ */
  #updateHistoryButtons() {
    if (this.#elements.undo) this.#elements.undo.disabled = this.#history.length === 0;
    if (this.#elements.redo) this.#elements.redo.disabled = this.#future.length === 0;
  }

  /**
   * ปุ่มลัดบนแป้นพิมพ์
   * @returns {void}
   */
  #bindKeyboard() {
    document.addEventListener('keydown', (event) => {
      // ไม่ดักปุ่มขณะผู้ใช้กำลังพิมพ์ในช่องกรอก
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;

      const ctrl = event.ctrlKey || event.metaKey;
      if (ctrl && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) this.redo(); else this.undo();
        return;
      }
      if (ctrl && event.key.toLowerCase() === 'y') { event.preventDefault(); this.redo(); return; }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (this.selected) { event.preventDefault(); this.removeSelected(); }
        return;
      }

      // ลูกศรขยับ ROI ทีละพิกเซล (กด Shift = 10 พิกเซล)
      const roi = this.selected;
      if (!roi) return;
      const step = event.shiftKey ? 10 : 1;
      const moves = {
        ArrowUp: [0, -step], ArrowDown: [0, step],
        ArrowLeft: [-step, 0], ArrowRight: [step, 0],
      };
      if (moves[event.key]) {
        event.preventDefault();
        this.#pushHistory();
        roi.translate(...moves[event.key]);
        this.draw();
        this.#updateRoiInfo();
      }
    });
  }

  // ───────────────────────── แหล่งภาพ ─────────────────────────

  /**
   * ผูกปุ่มอัปโหลดไฟล์และเชื่อมต่อกล้อง
   * @returns {void}
   */
  #bindImageSources() {
    const { imageInput, connectCamera, disconnectCamera, captureFrame,
            cameraUrl, cameraType, cameraStatus } = this.#elements;

    imageInput?.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => this.setBackgroundImage(reader.result, { stopCamera: true });
      reader.readAsDataURL(file);
    });

    connectCamera?.addEventListener('click', () => {
      const url = cameraUrl?.value?.trim();
      if (!url) {
        window.AppShell?.toast('กรุณากรอก URL กล้องก่อน', 'warning');
        return;
      }
      // กล้องที่ต้องยืนยันตัวตน หรือกล้อง HTTP บนหน้า HTTPS ต่อจากเบราว์เซอร์ไม่ได้
      // ให้ผ่านตัวกลางของเราแทน — ภาพมาจาก origin เดียวกัน จับเฟรมได้ไม่ปนเปื้อน
      const relay = this.#relayStreamUrl();
      this.connectCamera(
        relay ?? url,
        relay ? 'mjpeg' : (cameraType?.value ?? 'm3u8'),
        (message) => { if (cameraStatus) cameraStatus.textContent = message; },
      );
    });

    disconnectCamera?.addEventListener('click', () => {
      this.#camera?.stop();
      this.#camera = null;
      if (cameraStatus) cameraStatus.textContent = 'ตัดการเชื่อมต่อแล้ว';
      this.draw();
    });

    captureFrame?.addEventListener('click', () => {
      if (!this.#camera) {
        window.AppShell?.toast('ยังไม่ได้เชื่อมต่อกล้อง — กดปุ่ม "เชื่อมต่อ" ก่อน', 'warning');
        return;
      }

      const result = this.#camera.captureFrame();
      if (!result.ok) {
        window.AppShell?.toast(`จับเฟรมไม่สำเร็จ — ${result.reason}`, 'warning');
        return;
      }

      this.setBackgroundImage(result.dataUrl);
      window.AppShell?.toast(
        'ตรึงเฟรมเป็นภาพพื้นหลังแล้ว — กล้องยังเชื่อมต่ออยู่ กดซ้ำเพื่อจับเฟรมใหม่ได้', 'success');
    });
  }

  /**
   * ตั้งภาพพื้นหลังจาก data URL
   *
   * การตรึงเฟรมไว้ช่วยให้วาด ROI ได้แม่นยำกว่าการวาดทับภาพที่ขยับตลอดเวลา
   *
   * @param {string} dataUrl ข้อมูลภาพ
   * @param {{stopCamera?: boolean}} [options={}] ตัวเลือก
   *        `stopCamera: true` เมื่อผู้ใช้อัปโหลดไฟล์เอง (ตั้งใจเลิกใช้ภาพสด)
   *        ค่าเริ่มต้นคือ **ไม่ตัดการเชื่อมต่อ** เพื่อให้จับเฟรมใหม่ได้อีกโดยไม่ต้องต่อกล้องซ้ำ
   * @returns {void}
   */
  setBackgroundImage(dataUrl, { stopCamera = false } = {}) {
    const image = new Image();
    image.onload = () => {
      this.#backgroundImage = image;
      if (stopCamera) {
        this.#camera?.stop();
        this.#camera = null;
      }
      this.draw();
      // ภาพที่อัปโหลดก็เป็นตัวกำหนดระบบพิกัดได้เท่ากับสตรีม — `data/roi.html` ทำแบบนี้
      this.#checkStreamSize();
    };
    image.src = dataUrl;
  }

  /**
   * เชื่อมต่อกล้องสด แล้ววาดภาพลง canvas ต่อเนื่อง
   * @param {string} url URL กล้อง
   * @param {string} type ชนิดกล้อง
   * @param {(message: string) => void} onStatus ตัวรับสถานะ
   * @returns {void}
   */
  connectCamera(url, type, onStatus) {
    return this.#connectCamera(url, type, onStatus);
  }

  /**
   * URL สตรีมผ่านตัวกลางของเรา เมื่อเบราว์เซอร์ต่อกล้องเองไม่ได้
   *
   * คืน `null` เมื่อต่อตรงได้ตามปกติ — กล้องสาธารณะที่เป็น HTTPS และไม่ต้อง
   * ยืนยันตัวตนไม่ต้องผ่านเซิร์ฟเวอร์เรา จะได้ไม่เปลืองแบนด์วิดท์โดยใช่เหตุ
   *
   * @returns {string|null}
   */
  #relayStreamUrl() {
    const needsAuth = Boolean(this.#station?.cameraNeedsAuth);
    const mixedContent = window.location.protocol === 'https:'
      && String(this.#elements.cameraUrl?.value ?? '').startsWith('http:');

    if ((!needsAuth && !mixedContent) || !this.#station?.id) return null;
    return `/api/admin/stations/${this.#station.id}/camera/stream?t=${Date.now()}`;
  }

  /**
   * เชื่อมต่อกล้องจริง
   * @param {string} url URL ที่จะต่อ
   * @param {string} type ชนิดกล้อง
   * @param {(message: string) => void} onStatus ตัวรับสถานะ
   * @returns {void}
   */
  #connectCamera(url, type, onStatus) {
    this.#camera?.stop();
    // ล้างเฟรมที่ตรึงไว้ มิฉะนั้นจะเห็นภาพเก่าทับภาพสดที่เพิ่งต่อใหม่
    this.#backgroundImage = null;

    try {
      this.#camera = window.CameraSource.create(type, {
        url,
        container: this.#elements.cameraContainer ?? document.body,
        video: this.#elements.cameraVideo,
        img: this.#elements.cameraImage,
        onStatus,
      });
      this.#camera.start();

      // วาดต่อเนื่องเพื่อให้ภาพสดปรากฏใต้ ROI พร้อมตรวจขนาดภาพเมื่อได้เฟรมแรก
      let sizeChecked = false;
      const loop = () => {
        if (!this.#camera) return;
        this.draw();
        if (!sizeChecked && this.#camera.isReady) {
          sizeChecked = true;
          this.#checkStreamSize();
        }
        requestAnimationFrame(loop);
      };
      loop();
    } catch (error) {
      onStatus(`เชื่อมต่อไม่สำเร็จ: ${error.message}`);
    }
  }

  /**
   * เตือนเมื่อขนาดภาพจริงจากกล้องไม่ตรงกับที่ตั้งไว้ในจุดวัด
   *
   * **สำคัญต่อความถูกต้องของข้อมูล** — พิกัด ROI ถูกเก็บในระบบพิกัดของภาพต้นทาง
   * ตามที่ตั้งค่าไว้ ถ้าขนาดจริงต่างออกไป บริการตรวจจับจะนำพิกัดไปวางผิดตำแหน่ง
   * ทำให้วัดระดับน้ำผิดโดยไม่มีสัญญาณเตือน
   *
   * @returns {void}
   */
  #checkStreamSize() {
    const actual = this.#camera?.naturalSize() ?? this.#backgroundSize();
    if (!actual) return;

    const configured = { width: this.#canvas.width, height: this.#canvas.height };
    if (actual.width === configured.width && actual.height === configured.height) return;

    // ยังไม่มีอะไรวาด — ใช้ขนาดจากภาพจริงได้ทันทีเหมือน `data/roi.html`
    // ไม่มีพิกัดเดิมให้เสียหาย จึงไม่ต้องถาม
    if (!this.#rois.length) {
      this.adoptImageSize(actual, { scalePoints: false });
      window.AppShell?.toast(
        `ใช้ขนาดภาพจริงจากกล้อง ${actual.width}×${actual.height} พิกเซล`, 'info',
      );
      return;
    }

    // มี ROI อยู่แล้ว — พิกัดเดิมอยู่ในระบบพิกัดเก่า ต้องให้ผู้ดูแลตัดสินใจเอง
    // เพราะการสเกลอัตโนมัติทำให้กรอบคลาดจากเสาจริงได้ถ้ามุมกล้องเปลี่ยนไปด้วย
    this.#showSizeMismatch(actual, configured);
  }

  /**
   * แสดงคำเตือนขนาดไม่ตรงพร้อมปุ่มปรับให้ตรง
   * @param {{width: number, height: number}} actual ขนาดจริงของภาพ
   * @param {{width: number, height: number}} configured ขนาดที่จุดวัดตั้งไว้
   * @returns {void}
   */
  #showSizeMismatch(actual, configured) {
    const box = this.#elements.warnings;
    if (!box || box.dataset.sizeWarned === `${actual.width}x${actual.height}`) return;
    box.dataset.sizeWarned = `${actual.width}x${actual.height}`;

    box.insertAdjacentHTML('afterbegin', `
      <div class="alert alert--warning" data-size-warning>
        ⚠ ขนาดภาพจริงคือ <strong>${actual.width}×${actual.height}</strong> พิกเซล
        แต่จุดวัดตั้งไว้ <strong>${configured.width}×${configured.height}</strong>
        — พิกัด ROI โซน และจุดเทียบค่าทั้งหมดอยู่คนละระบบพิกัด ระบบจะไม่บันทึกค่าที่วัดได้
        <div class="alert__actions">
          <button type="button" class="btn btn--sm" data-adopt-size="scale">
            ปรับขนาดและสเกลพิกัดเดิมตามสัดส่วน
          </button>
          <button type="button" class="btn btn--sm" data-adopt-size="keep">
            ปรับขนาดอย่างเดียว (วาดใหม่เอง)
          </button>
        </div>
        <p class="small muted" style="margin:.4rem 0 0">
          ถ้าเพิ่งขยับหรือเปลี่ยนมุมกล้อง ให้เลือก “วาดใหม่เอง” — การสเกลช่วยได้เฉพาะ
          กรณีที่กล้องอยู่ที่เดิมแล้วเปลี่ยนแค่ความละเอียดของสตรีม
        </p>
      </div>`);

    box.querySelectorAll('[data-adopt-size]').forEach((button) => {
      button.addEventListener('click', () => {
        this.adoptImageSize(actual, { scalePoints: button.dataset.adoptSize === 'scale' });
        box.querySelector('[data-size-warning]')?.remove();
        window.AppShell?.toast(
          `ปรับเป็น ${actual.width}×${actual.height} แล้ว — กด “บันทึกเข้าระบบ” เพื่อยืนยัน`,
          'success',
        );
      });
    });
  }

  /**
   * ขนาดของภาพนิ่งที่ใช้เป็นพื้นหลัง (ถ้ามี)
   * @returns {{width: number, height: number}|null}
   */
  #backgroundSize() {
    const image = this.#backgroundImage;
    return image?.naturalWidth
      ? { width: image.naturalWidth, height: image.naturalHeight }
      : null;
  }

  /**
   * เปลี่ยนระบบพิกัดของเครื่องมือวาดให้เป็นขนาดภาพจริง
   *
   * `data/roi.html` ของระบบเดิมตั้ง `canvas.width = img.width` เสมอ คือเดินตามภาพจริง
   * ไม่เคยบังคับใช้ขนาดที่บันทึกไว้ ระบบใหม่ทำแบบเดียวกัน เพราะบริการตรวจจับ
   * ใช้พิกัด ROI ทับเฟรมดิบตรง ๆ โดยไม่ย่อขยายให้ (`app.py` ไม่อ่าน image_width เลย)
   * ขนาดที่ตั้งไว้จึง**ต้อง**เท่ากับขนาดสตรีมจริง ไม่ใช่ค่าที่เดาเอาไว้
   *
   * @param {{width: number, height: number}} size ขนาดใหม่
   * @param {{scalePoints?: boolean}} [options] ปรับพิกัดเดิมตามสัดส่วนด้วยหรือไม่
   * @returns {void}
   */
  adoptImageSize(size, { scalePoints = false } = {}) {
    const from = { width: this.#canvas.width, height: this.#canvas.height };
    if (size.width === from.width && size.height === from.height) return;

    if (scalePoints && this.#rois.length) {
      this.#pushHistory();
      const sx = size.width / from.width;
      const sy = size.height / from.height;
      for (const roi of this.#rois) {
        roi.points = roi.points.map((point) => ({
          x: Math.round(point.x * sx), y: Math.round(point.y * sy),
        }));
        for (const zone of roi.zones) zone.yPosition = Math.round(zone.yPosition * sy);
      }
    }

    this.#canvas.width = size.width;
    this.#canvas.height = size.height;
    this.#station.imageWidth = size.width;
    this.#station.imageHeight = size.height;
    this.draw();
    this.#validateZones();
    this.#updateRoiInfo();
  }

  // ───────────────────────── แถบเครื่องมือ ─────────────────────────

  /**
   * ผูกปุ่มทั้งหมดในแถบเครื่องมือ
   * @returns {void}
   */
  #bindToolbar() {
    const el = this.#elements;

    el.addMeasurement?.addEventListener('click', () => this.addRoi('measurement'));
    el.addDetection?.addEventListener('click', () => this.addRoi('detection'));
    el.removeRoi?.addEventListener('click', () => this.removeSelected());
    el.undo?.addEventListener('click', () => this.undo());
    el.redo?.addEventListener('click', () => this.redo());
    el.save?.addEventListener('click', () => this.save());
    el.exportConfig?.addEventListener('click', () => this.exportConfig());
    el.importInput?.addEventListener('change', (event) => this.importConfig(event.target.files?.[0]));

    el.testLevel?.addEventListener('input', (event) => {
      const value = Number(event.target.value);
      this.#testLevel = Number.isFinite(value) && event.target.value !== '' ? value : null;
      this.draw();
      this.#updateTestResult();
    });

    el.clearTest?.addEventListener('click', () => {
      this.#testLevel = null;
      if (el.testLevel) el.testLevel.value = '';
      this.draw();
      this.#updateTestResult();
    });

    this.#updateHistoryButtons();
  }

  /** แสดงผลการทดสอบระดับน้ำ (โซนและค่าเมตร) */
  #updateTestResult() {
    const element = this.#elements.testResult;
    if (!element) return;

    if (this.#testLevel === null) { element.textContent = ''; return; }

    const roi = this.selected;
    const meter = this.#pixelToMeter(this.#testLevel);
    let zoneLabel = 'ยังไม่ได้กำหนดโซน';

    if (roi?.isMeasurement && roi.zones.length) {
      const sorted = [...roi.zones].sort((a, b) => a.yPosition - b.yPosition);
      let matched = sorted[0];
      for (const zone of sorted) {
        if (this.#testLevel >= zone.yPosition) matched = zone;
        else break;
      }
      zoneLabel = matched.label;
    }

    element.textContent = meter === null
      ? `ที่ ${this.#testLevel} px → โซน "${zoneLabel}" (ยังแปลงเป็นเมตรไม่ได้)`
      : `ที่ ${this.#testLevel} px → ${meter.toFixed(2)} ม. · โซน "${zoneLabel}"`;
  }

  // ───────────────────────── การบันทึกและนำเข้า/ส่งออก ─────────────────────────

  /**
   * บันทึก ROI ทั้งชุดเข้าฐานข้อมูลผ่าน API
   *
   * **ความสามารถที่ระบบเดิมไม่มี** — ของเดิมส่งออกเป็นไฟล์อย่างเดียว
   *
   * @returns {Promise<void>}
   */
  async save() {
    if (!this.#rois.some((roi) => roi.isMeasurement)) {
      window.AppShell?.toast('ต้องมี ROI ชนิดวัดระดับอย่างน้อย 1 กรอบ', 'warning');
      return;
    }

    const button = this.#elements.save;
    if (button) { button.disabled = true; button.textContent = 'กำลังบันทึก…'; }

    try {
      const result = await window.AppShell.api(
        `/api/admin/stations/${this.#station.id}/rois`,
        {
          method: 'POST',
          body: {
            rois: this.#rois.map((roi) => roi.toJSON()),
            // พิกัด ROI ไม่มีความหมายถ้าไม่รู้ว่าอยู่ในภาพขนาดเท่าไร จึงส่งไปด้วยกันเสมอ
            imageWidth: this.#canvas.width,
            imageHeight: this.#canvas.height,
          },
        },
      );
      window.AppShell.toast(`บันทึก ROI ${result.rois.length} กรอบเรียบร้อยแล้ว`, 'success');
      if (result.warnings?.length) {
        window.AppShell.toast(`มีคำเตือน ${result.warnings.length} ข้อ — ตรวจสอบด้านล่าง`, 'warning');
      }
    } catch (error) {
      window.AppShell.toast(`บันทึกไม่สำเร็จ: ${error.message}`, 'danger');
    } finally {
      if (button) { button.disabled = false; button.textContent = '💾 บันทึกเข้าระบบ'; }
    }
  }

  /**
   * ส่งออกเป็นไฟล์ JSON version 3.0
   * @returns {void}
   */
  exportConfig() {
    const config = ConfigSerializer.serialize(this.#rois, this.#station);
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `roi-config-${this.#station.slug}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  /**
   * นำเข้าไฟล์ config (รองรับ version 2.0 และ 3.0)
   * @param {File|undefined} file ไฟล์ที่เลือก
   * @returns {Promise<void>}
   */
  async importConfig(file) {
    if (!file) return;
    try {
      const config = JSON.parse(await file.text());
      const imported = ConfigSerializer.parse(config, this.#zoneCatalog);
      this.#pushHistory();
      this.#rois = imported;
      this.select(this.#rois.length ? 0 : -1);
      this.#validateZones();
      window.AppShell?.toast(
        `นำเข้า ROI ${imported.length} กรอบ (เวอร์ชัน ${config.version ?? 'ไม่ระบุ'})`, 'success');
    } catch (error) {
      window.AppShell?.toast(`นำเข้าไม่สำเร็จ: ${error.message}`, 'danger');
    }
  }

  // ───────────────────────── การแสดงผลแผงควบคุม ─────────────────────────

  /** วาดรายการ ROI ในแผงด้านข้าง */
  #renderRoiList() {
    const element = this.#elements.roiList;
    if (!element) return;

    if (!this.#rois.length) {
      element.innerHTML = '<p class="muted small">ยังไม่มี ROI — กดปุ่มด้านบนเพื่อเพิ่ม</p>';
      return;
    }

    element.innerHTML = this.#rois.map((roi, index) => `
      <button type="button" class="roi-item ${index === this.#selectedIndex ? 'is-active' : ''}"
              data-roi-index="${index}" style="--roi-color: ${roi.strokeColor}">
        <span class="roi-item__swatch"></span>
        <span class="roi-item__body">
          <span class="roi-item__name">${RoiEditor.#escape(roi.name)}</span>
          <span class="roi-item__meta">
            ${roi.type === 'measurement' ? 'วัดระดับ' : 'ตรวจจับ'} ·
            ${Math.round(roi.bounds.width)}×${Math.round(roi.bounds.height)} px
          </span>
        </span>
      </button>
    `).join('');

    element.querySelectorAll('[data-roi-index]').forEach((button) => {
      button.addEventListener('click', () => this.select(Number(button.dataset.roiIndex)));
    });
  }

  /** วาดแผงแก้ไขโซนของ ROI ที่เลือก */
  #renderZonePanel() {
    const element = this.#elements.zonePanel;
    if (!element) return;

    const roi = this.selected;
    if (!roi) {
      element.innerHTML = '<p class="muted small">เลือก ROI เพื่อแก้ไขโซน</p>';
      return;
    }
    if (!roi.isMeasurement) {
      element.innerHTML = '<p class="muted small">ROI ชนิดตรวจจับไม่มีโซนเตือนภัย</p>';
      return;
    }

    element.innerHTML = roi.zones
      .slice()
      .sort((a, b) => a.severity - b.severity)
      .map((zone) => `
        <div class="zone-editor" style="--zone-color: ${zone.color}">
          <span class="zone-editor__swatch"></span>
          <span class="zone-editor__label">${RoiEditor.#escape(zone.label)}</span>
          <div class="zone-editor__controls">
            <button type="button" class="btn btn--sm" data-zone="${zone.key}" data-delta="-5">−5</button>
            <button type="button" class="btn btn--sm" data-zone="${zone.key}" data-delta="-1">−1</button>
            <input class="input input--sm zone-editor__input" type="number"
                   data-zone-input="${zone.key}" value="${zone.yPosition}"
                   min="0" max="${this.#canvas.height}">
            <button type="button" class="btn btn--sm" data-zone="${zone.key}" data-delta="1">+1</button>
            <button type="button" class="btn btn--sm" data-zone="${zone.key}" data-delta="5">+5</button>
          </div>
          <label class="zone-editor__meter">
            <span class="zone-editor__meter-label">ระดับน้ำ</span>
            <input class="input input--sm" type="number" step="0.01" min="0" max="100"
                   data-zone-meter="${zone.key}" placeholder="—"
                   value="${zone.meterLevel ?? ''}">
            <span class="zone-editor__unit">ม.</span>
          </label>
          <label class="checkbox zone-editor__alert">
            <input type="checkbox" data-zone-alert="${zone.key}" ${zone.alertEnabled ? 'checked' : ''}>
            แจ้งเตือน
          </label>
        </div>
      `).join('');

    element.querySelectorAll('[data-delta]').forEach((button) => {
      button.addEventListener('click', () => {
        this.nudgeZone(button.dataset.zone, Number(button.dataset.delta));
      });
    });
    element.querySelectorAll('[data-zone-input]').forEach((input) => {
      input.addEventListener('change', () => {
        this.setZonePosition(input.dataset.zoneInput, input.value);
      });
    });
    element.querySelectorAll('[data-zone-meter]').forEach((input) => {
      input.addEventListener('change', () => {
        this.setZoneMeter(input.dataset.zoneMeter, input.value);
      });
    });
    element.querySelectorAll('[data-zone-alert]').forEach((input) => {
      input.addEventListener('change', () => {
        this.setZoneAlert(input.dataset.zoneAlert, input.checked);
      });
    });
  }

  /** แสดงพิกัดและขนาดของ ROI ที่เลือกแบบสด */
  #updateRoiInfo() {
    const element = this.#elements.roiInfo;
    const nameInput = this.#elements.roiName;
    const roi = this.selected;

    if (nameInput) nameInput.value = roi?.name ?? '';
    if (!element) return;

    if (!roi) { element.textContent = 'ยังไม่ได้เลือก ROI'; return; }
    const bounds = roi.bounds;
    element.textContent =
      `ตำแหน่ง (${bounds.x}, ${bounds.y}) · ขนาด ${Math.round(bounds.width)}×${Math.round(bounds.height)} px · ` +
      `มุม: ${roi.points.map((point) => `(${point.x},${point.y})`).join(' ')}`;
  }

  /**
   * จำกัดค่าให้อยู่ในช่วงที่กำหนด
   * @param {number} value ค่า
   * @param {number} min ค่าต่ำสุด
   * @param {number} max ค่าสูงสุด
   * @returns {number}
   */
  static #clamp(value, min, max) {
    return Math.min(Math.max(Math.round(value), min), max);
  }

  /**
   * หนีอักขระ HTML ก่อนใส่ลง innerHTML
   * @param {string} value ข้อความ
   * @returns {string}
   */
  static #escape(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[char]));
  }

  /**
   * เลือกสีตัวอักษรที่อ่านออกบนพื้นหลังที่กำหนด
   * @param {string} background สีพื้นหลัง hex
   * @returns {string}
   */
  static textOn(background) {
    const hex = String(background).replace('#', '');
    if (hex.length !== 6) return '#ffffff';
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#111827' : '#ffffff';
  }
}

window.RoiEditor = RoiEditor;
