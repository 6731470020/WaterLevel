/**
 * วาดขอบเขต ROI และเส้นโซนทับบนภาพสด
 *
 * พิกัด ROI เก็บไว้ในระบบพิกัดของภาพต้นทาง (เช่น 704×576) แต่ภาพบนหน้าจอถูกย่อ
 * ตามความกว้างของกล่อง คลาสนี้จึงคำนวณอัตราส่วนใหม่ทุกครั้งที่วาด
 */
class LiveOverlay {
  /** @type {HTMLCanvasElement} */
  #canvas;
  /** @type {CanvasRenderingContext2D} */
  #ctx;
  /** @type {Array<object>} */
  #rois;
  /** @type {Array<object>} */
  #zones;
  /** @type {{width: number, height: number}} */
  #sourceSize;
  /** @type {number|null} */
  #currentLevel = null;
  /** @type {number|null} */
  #frameHandle = null;

  /**
   * @param {object} options ตัวเลือก
   * @param {HTMLCanvasElement} options.canvas พื้นที่วาด
   * @param {Array<object>} options.rois ขอบเขต ROI
   * @param {Array<object>} [options.zones=[]] โซนเตือนภัย
   * @param {{width: number, height: number}} options.sourceSize ขนาดภาพต้นทาง
   */
  constructor({ canvas, rois, zones = [], sourceSize }) {
    this.#canvas = canvas;
    this.#ctx = canvas.getContext('2d');
    this.#rois = rois ?? [];
    this.#zones = zones;
    this.#sourceSize = sourceSize;
  }

  /**
   * กำหนดตำแหน่งผิวน้ำปัจจุบันเพื่อวาดเส้นแนวนอน
   * @param {number|null} pixel ค่าพิกเซลแกน Y
   */
  setWaterLine(pixel) {
    this.#currentLevel = pixel === null || pixel === undefined ? null : Number(pixel);
  }

  /**
   * เริ่มวาดต่อเนื่องตามจังหวะการรีเฟรชหน้าจอ
   * @returns {void}
   */
  start() {
    const loop = () => {
      this.draw();
      this.#frameHandle = requestAnimationFrame(loop);
    };
    loop();
  }

  /** หยุดวาด */
  stop() {
    if (this.#frameHandle !== null) cancelAnimationFrame(this.#frameHandle);
    this.#frameHandle = null;
  }

  /**
   * วาดหนึ่งเฟรม
   * @returns {void}
   */
  draw() {
    const rect = this.#canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    // ปรับความละเอียดของ canvas ให้ตรงกับขนาดจริงบนจอ (รองรับจอความละเอียดสูง)
    //
    // ⚠️ ต้องเทียบ**ทั้งสองด้าน** — เดิมเช็คเฉพาะความกว้าง พอความสูงเปลี่ยนโดยที่
    // ความกว้างเท่าเดิม (เช่นวิดีโอโหลดเสร็จแล้วกล่องสูงขึ้น) ขนาดจริงของ canvas
    // จะค้างที่ค่าเก่า ภาพที่วาดจึงถูกยืดตามแนวตั้งและเส้นโซนหลุดออกนอกกรอบ
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);
    if (this.#canvas.width !== width || this.#canvas.height !== height) {
      this.#canvas.width = width;
      this.#canvas.height = height;
    }

    const ctx = this.#ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const view = this.#geometry(rect);
    this.#drawZones(ctx, view);
    this.#drawWaterLine(ctx, view);
  }

  /**
   * คำนวณอัตราส่วนและระยะขอบของภาพภายในกล่อง
   *
   * ภาพถูกแสดงแบบ `object-fit: contain` คือคงสัดส่วนไว้แล้วเว้นขอบด้านที่เหลือ
   * ถ้าคิดอัตราส่วนแกน X กับ Y แยกกันจากขนาดกล่องตรง ๆ (แบบเดิม) เส้นจะเพี้ยน
   * ทันทีที่สัดส่วนกล่องไม่ตรงกับสัดส่วนภาพ — ต้องคิดระยะขอบด้วยเสมอ
   * (ตรงกับ `updateROIOverlaySize()` ของระบบเดิม `data/…/index.php:1325`)
   *
   * @param {DOMRect} rect ขนาดพื้นที่วาด
   * @returns {{scaleX: number, scaleY: number, offsetX: number, offsetY: number,
   *   width: number, height: number}}
   */
  #geometry(rect) {
    const source = this.#sourceSize;
    const boxAspect = rect.width / rect.height;
    const imageAspect = source.width / source.height;

    let displayWidth;
    let displayHeight;
    if (boxAspect > imageAspect) {
      displayHeight = rect.height;
      displayWidth = displayHeight * imageAspect;
    } else {
      displayWidth = rect.width;
      displayHeight = displayWidth / imageAspect;
    }

    return {
      scaleX: displayWidth / source.width,
      scaleY: displayHeight / source.height,
      offsetX: (rect.width - displayWidth) / 2,
      offsetY: (rect.height - displayHeight) / 2,
      width: rect.width,
      height: rect.height,
    };
  }

  /**
   * ขอบซ้าย-ขวาของกรอบวัดระดับในพิกัดหน้าจอ
   *
   * เส้นโซนลากคร่อมเฉพาะช่วงกว้างของกรอบวัดระดับ ไม่ใช่เต็มความกว้างภาพ
   * เพื่อให้ชี้ไปที่เสาวัดระดับตรง ๆ และไม่บังส่วนอื่นของภาพ
   *
   * @param {object} view ค่าจาก `#geometry()`
   * @returns {{minX: number, maxX: number}}
   */
  #measurementBounds(view) {
    let minX = Infinity;
    let maxX = -Infinity;

    for (const roi of this.#rois) {
      if (roi.type === 'detection' || !roi.points?.length) continue;
      for (const point of roi.points) {
        const x = point.x * view.scaleX + view.offsetX;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    }

    if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
      return { minX: view.offsetX, maxX: view.offsetX + this.#sourceSize.width * view.scaleX };
    }
    return { minX, maxX };
  }

  /**
   * วาดเส้นแบ่งโซนพร้อมป้ายชื่อและระดับน้ำเป็นเมตร
   *
   * ป้ายชื่อสลับซ้าย-ขวาตามลำดับโซน เพื่อไม่ให้ทับกันเมื่อโซนอยู่ชิดกัน
   * และมีเส้นประเชื่อมจากป้ายไปยังปลายเส้น (ตรงกับ `drawROIOverlay()` ของระบบเดิม)
   *
   * @param {CanvasRenderingContext2D} ctx บริบทการวาด
   * @param {object} view ค่าจาก `#geometry()`
   * @returns {void}
   */
  #drawZones(ctx, view) {
    if (!this.#zones.length) return;

    const { minX, maxX } = this.#measurementBounds(view);
    const ordered = [...this.#zones].sort((a, b) => a.yPosition - b.yPosition);

    ctx.save();
    ctx.font = 'bold 12px "IBM Plex Sans Thai", sans-serif';
    ctx.textBaseline = 'alphabetic';

    ordered.forEach((zone, index) => {
      const y = zone.yPosition * view.scaleY + view.offsetY;
      if (y < 0 || y > view.height) return;

      // ── เส้นระดับ ──
      ctx.setLineDash([]);
      ctx.strokeStyle = zone.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(minX - 10, y);
      ctx.lineTo(maxX + 10, y);
      ctx.stroke();

      // ── ป้ายชื่อ ──
      const meter = zone.meterLevel;
      const label = meter === null || meter === undefined
        ? zone.label
        : `${zone.label} (${Number(meter).toFixed(2)}m)`;
      const textWidth = ctx.measureText(label).width;
      const onLeft = index % 2 === 0;
      const labelX = onLeft ? minX - textWidth - 25 : maxX + 15;
      const labelY = y - 12;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.fillRect(labelX, labelY, textWidth + 10, 20);
      ctx.setLineDash([]);
      ctx.strokeStyle = zone.color;
      ctx.lineWidth = 1;
      ctx.strokeRect(labelX, labelY, textWidth + 10, 20);
      ctx.fillStyle = zone.color;
      ctx.fillText(label, labelX + 5, labelY + 14);

      // ── เส้นประเชื่อมป้ายกับเส้นระดับ ──
      ctx.setLineDash([2, 2]);
      ctx.strokeStyle = zone.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (onLeft) {
        ctx.moveTo(labelX + textWidth + 10, labelY + 10);
        ctx.lineTo(minX - 5, y);
      } else {
        ctx.moveTo(labelX, labelY + 10);
        ctx.lineTo(maxX + 5, y);
      }
      ctx.stroke();
    });

    ctx.restore();
  }

  /**
   * วาดเส้นแสดงตำแหน่งผิวน้ำปัจจุบัน
   *
   * ใช้ภาษาภาพเดียวกับเส้นโซนแต่ลากเต็มความกว้างของภาพ เพื่อให้แยกออกได้ทันที
   * ว่าเส้นไหนคือค่าที่วัดได้จริง เส้นไหนคือขอบเขตที่ตั้งไว้ล่วงหน้า
   *
   * @param {CanvasRenderingContext2D} ctx บริบทการวาด
   * @param {object} view ค่าจาก `#geometry()`
   * @returns {void}
   */
  #drawWaterLine(ctx, view) {
    if (this.#currentLevel === null) return;
    const y = this.#currentLevel * view.scaleY + view.offsetY;
    if (y < 0 || y > view.height) return;

    const left = view.offsetX;
    const right = view.width - view.offsetX;

    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = '#0EA5E9';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();

    const label = 'ระดับน้ำปัจจุบัน';
    ctx.font = 'bold 12px "IBM Plex Sans Thai", sans-serif';
    const textWidth = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(left + 6, y - 12, textWidth + 10, 20);
    ctx.strokeStyle = '#0EA5E9';
    ctx.lineWidth = 1;
    ctx.strokeRect(left + 6, y - 12, textWidth + 10, 20);
    ctx.fillStyle = '#0EA5E9';
    ctx.fillText(label, left + 11, y + 2);
    ctx.restore();
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

window.LiveOverlay = LiveOverlay;
