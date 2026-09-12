import { BaseModel } from '../core/BaseModel.js';
import { ValidationError } from '../core/errors/index.js';
import { Validator } from '../core/Validator.js';
import { ZoneLevel } from './values/ZoneLevel.js';

/** ชนิดกล้องที่รองรับ (ตรงกับระบบเดิม) */
const CAMERA_TYPES = ['snapshot', 'm3u8', 'mjpeg'];

/**
 * จุดวัดระดับน้ำหนึ่งแห่ง (มาจากตาราง `configs` เดิม)
 *
 * เพิ่มจากระบบเดิม: `slug` สำหรับ URL สาธารณะ, พิกัดแผนที่, ค่าตั้งค่าการแจ้งเตือน
 * รายจุดวัด (แทนที่ `ALERT_ZONES` ที่เคยฮาร์ดโค้ด) และค่าตั้งค่า PDPA แยกเป็นคอลัมน์
 */
export class Station extends BaseModel {
  /** @type {string} */
  #slug;
  /** @type {string} */
  #name;
  /** @type {string|null} */
  #description;
  /** @type {string|null} */
  #cameraUrl;
  /** @type {string} */
  #cameraType;
  /** @type {number} */
  #imageWidth;
  /** @type {number} */
  #imageHeight;
  /** @type {number|null} */
  #latitude;
  /** @type {number|null} */
  #longitude;
  /** @type {boolean} */
  #isActive;
  /** @type {Array<string>} */
  #alertZoneKeys;
  /** @type {number} */
  #alertCooldownMinutes;
  /** @type {string|null} */
  #lineGroupId;
  /** @type {boolean} */
  #pdpaEnabled;
  /** @type {string} */
  #pdpaMethod;
  /** @type {number} */
  #pdpaBlurStrength;
  /** @type {number} */
  #pdpaConfThreshold;
  /** @type {number} */
  #imageRetentionDays;
  /** @type {boolean} */
  #allowPrivateCameraUrl;
  /** @type {string|null} */
  #cameraUsername;
  /** @type {string|null} */
  #cameraPassword;
  /** @type {boolean} */
  #publicLiveEnabled;

  /**
   * @param {object} data ข้อมูลจุดวัด
   * @param {string} data.slug ชื่อย่อสำหรับ URL
   * @param {string} data.name ชื่อจุดวัด
   * @param {string|null} [data.cameraUrl] URL กล้อง
   * @param {string} [data.cameraType='m3u8'] ชนิดกล้อง
   * @param {number} [data.imageWidth=704] ความกว้างภาพต้นทาง
   * @param {number} [data.imageHeight=576] ความสูงภาพต้นทาง
   * @param {boolean} [data.allowPrivateCameraUrl=false] อนุญาตให้ URL กล้องชี้ไปยัง
   *        เครือข่ายภายในหรือไม่ — มาจากค่า `ALLOW_PRIVATE_CAMERA_URL` ใน `.env`
   *        เก็บไว้ในวัตถุเพื่อให้ `validate()` ให้ผลเหมือนกันทุกที่ที่ถูกเรียก
   */
  constructor(data = {}) {
    super(data);
    this.#name = String(data.name ?? '').trim();
    this.#slug = Station.slugify(data.slug || this.#name);
    this.#description = data.description ? String(data.description) : null;
    this.#cameraUrl = data.cameraUrl ? String(data.cameraUrl).trim() : null;
    this.#cameraType = CAMERA_TYPES.includes(data.cameraType) ? data.cameraType : 'm3u8';
    this.#imageWidth = Number(data.imageWidth ?? 704);
    this.#imageHeight = Number(data.imageHeight ?? 576);
    this.#latitude = data.latitude === null || data.latitude === undefined || data.latitude === ''
      ? null : Number(data.latitude);
    this.#longitude = data.longitude === null || data.longitude === undefined || data.longitude === ''
      ? null : Number(data.longitude);
    this.#isActive = data.isActive === undefined ? true : Boolean(data.isActive);
    this.#alertZoneKeys = Station.#normalizeZoneKeys(data.alertZoneKeys);
    this.#alertCooldownMinutes = Number(data.alertCooldownMinutes ?? 60);
    this.#lineGroupId = data.lineGroupId ? String(data.lineGroupId).trim() : null;
    this.#pdpaEnabled = data.pdpaEnabled === undefined ? true : Boolean(data.pdpaEnabled);
    this.#pdpaMethod = String(data.pdpaMethod ?? 'blur');
    this.#pdpaBlurStrength = Number(data.pdpaBlurStrength ?? 30);
    this.#pdpaConfThreshold = Number(data.pdpaConfThreshold ?? 0.3);
    this.#imageRetentionDays = Number(data.imageRetentionDays ?? 90);
    this.#allowPrivateCameraUrl = Boolean(data.allowPrivateCameraUrl);
    // ⚠️ แยกรหัสผ่านออกจาก URL เสมอ ไม่ว่าจะมาจากฟอร์มหรือจากฐานข้อมูลเก่า
    //
    // เหตุผลสามข้อ: (1) `fetch` ของ Node ปฏิเสธ URL ที่มีข้อมูลยืนยันตัวตนฝังอยู่
    // (2) รูปแบบนั้นพาได้เฉพาะ Basic ใช้กับกล้องที่ต้องใช้ Digest ไม่ได้
    // (3) `camera_url` ถูกส่งไปเบราว์เซอร์ ถ้ารหัสผ่านติดไปด้วยก็รั่วสู่สาธารณะ
    const embedded = Station.#extractCredentials(data.cameraUrl);
    if (embedded) this.#cameraUrl = embedded.url;

    // ค่าที่กรอกในช่องแยกชนะค่าที่ฝังใน URL เสมอ
    this.#cameraUsername = data.cameraUsername
      ? String(data.cameraUsername)
      : (embedded?.username ?? null);
    this.#cameraPassword = data.cameraPassword
      ? String(data.cameraPassword)
      : (embedded?.password ?? null);
    this.#publicLiveEnabled = Boolean(data.publicLiveEnabled);
  }

  /** @returns {string} ชื่อย่อสำหรับ URL สาธารณะ */
  get slug() { return this.#slug; }

  /** @returns {string} ชื่อจุดวัด */
  get name() { return this.#name; }

  /** @returns {string|null} คำอธิบาย */
  get description() { return this.#description; }

  /** @returns {string|null} URL กล้อง */
  get cameraUrl() { return this.#cameraUrl; }

  /** @returns {string} ชนิดกล้อง */
  get cameraType() { return this.#cameraType; }

  /** @returns {number} ความกว้างภาพต้นทาง */
  get imageWidth() { return this.#imageWidth; }

  /** @returns {string|null} ชื่อผู้ใช้ของกล้อง */
  get cameraUsername() { return this.#cameraUsername; }

  /**
   * รหัสผ่านของกล้อง
   *
   * ⚠️ ห้ามส่งค่านี้ออกไปนอกเซิร์ฟเวอร์ — `toJSON()` ไม่รวมไว้โดยเจตนา
   * เพราะผลของ `toJSON()` ถูกส่งไปยังเบราว์เซอร์และ AI service
   *
   * @returns {string|null}
   */
  get cameraPassword() { return this.#cameraPassword; }

  /** @returns {boolean} กล้องตัวนี้ต้องยืนยันตัวตนหรือไม่ */
  get cameraNeedsAuth() { return Boolean(this.#cameraUsername); }

  /**
   * เปิดให้หน้าสาธารณะดูภาพสดได้หรือไม่
   *
   * ⚠️ ภาพสด**ไม่ผ่านการเบลอใบหน้า** ต่างจากภาพที่บันทึกไว้ซึ่งผ่านบริการตรวจจับ
   * มาแล้ว เปิดเฉพาะกล้องที่ไม่มีคนสัญจรผ่านหน้ากล้อง
   *
   * @returns {boolean}
   */
  get publicLiveEnabled() { return this.#publicLiveEnabled && Boolean(this.cameraUrl); }

  /** @returns {number} ความสูงภาพต้นทาง */
  get imageHeight() { return this.#imageHeight; }

  /**
   * แยกชื่อผู้ใช้และรหัสผ่านที่ฝังอยู่ใน URL ออกมา
   * @param {string|null} rawUrl URL ดิบ
   * @returns {{url: string, username: string|null, password: string|null}|null}
   *   `null` เมื่อ URL ไม่มีข้อมูลยืนยันตัวตนฝังอยู่หรือแปลงไม่ได้
   */
  static #extractCredentials(rawUrl) {
    if (!rawUrl) return null;
    try {
      const parsed = new URL(String(rawUrl));
      if (!parsed.username && !parsed.password) return null;

      const username = parsed.username ? decodeURIComponent(parsed.username) : null;
      const password = parsed.password ? decodeURIComponent(parsed.password) : null;
      parsed.username = '';
      parsed.password = '';
      return { url: parsed.toString(), username, password };
    } catch {
      return null;
    }
  }

  /**
   * ปรับขนาดภาพต้นทางให้ตรงกับภาพจริงจากกล้อง
   *
   * เปิดเป็นเมท็อดเฉพาะแทนการให้ setter ทั่วไป เพราะสองค่านี้ต้องเปลี่ยนพร้อมกันเสมอ
   * — เปลี่ยนแค่ด้านเดียวได้เมื่อไร ก็ได้ระบบพิกัดที่บิดเบี้ยวเมื่อนั้น
   *
   * @param {number} width ความกว้างใหม่
   * @param {number} height ความสูงใหม่
   * @returns {void}
   * @throws {ValidationError} เมื่อค่าที่ให้มาไม่ถูกต้อง
   */
  resizeImage(width, height) {
    const valid = (value) => Number.isInteger(value) && value >= 1 && value <= 8192;
    if (!valid(width) || !valid(height)) {
      throw new ValidationError('ขนาดภาพต้นทางต้องเป็นจำนวนเต็ม 1–8192 พิกเซล');
    }
    this.#imageWidth = width;
    this.#imageHeight = height;
  }

  /** @returns {number|null} ละติจูด */
  get latitude() { return this.#latitude; }

  /** @returns {number|null} ลองจิจูด */
  get longitude() { return this.#longitude; }

  /** @returns {boolean} เปิดใช้งานอยู่หรือไม่ */
  get isActive() { return this.#isActive; }

  /** @returns {Array<string>} คีย์โซนที่ต้องแจ้งเตือนเข้ากลุ่ม LINE */
  get alertZoneKeys() { return [...this.#alertZoneKeys]; }

  /** @returns {number} ระยะกันการแจ้งเตือนซ้ำ (นาที) */
  get alertCooldownMinutes() { return this.#alertCooldownMinutes; }

  /** @returns {string|null} รหัสกลุ่ม LINE เฉพาะของจุดวัดนี้ */
  get lineGroupId() { return this.#lineGroupId; }

  /** @returns {boolean} เปิดการเบลอใบหน้าหรือไม่ */
  get pdpaEnabled() { return this.#pdpaEnabled; }

  /** @returns {string} วิธีปกปิดใบหน้า (`blur` | `pixelate`) */
  get pdpaMethod() { return this.#pdpaMethod; }

  /** @returns {number} ความแรงของการเบลอ */
  get pdpaBlurStrength() { return this.#pdpaBlurStrength; }

  /** @returns {number} ค่าความเชื่อมั่นขั้นต่ำในการตรวจจับใบหน้า */
  get pdpaConfThreshold() { return this.#pdpaConfThreshold; }

  /** @returns {number} จำนวนวันที่เก็บภาพก่อนลบอัตโนมัติ */
  get imageRetentionDays() { return this.#imageRetentionDays; }

  /** @returns {string} URL สาธารณะของจุดวัดนี้ (พาธสัมพัทธ์) */
  get publicPath() { return `/station/${this.#slug}`; }

  /**
   * ค่าตั้งค่า PDPA ในรูปแบบที่ส่งให้บริการตรวจจับ
   * @returns {{enabled: boolean, method: string, blur_strength: number, conf_threshold: number}}
   */
  get pdpaConfig() {
    return {
      enabled: this.#pdpaEnabled,
      method: this.#pdpaMethod,
      blur_strength: this.#pdpaBlurStrength,
      conf_threshold: this.#pdpaConfThreshold,
    };
  }

  /**
   * ตรวจว่าโซนนี้ต้องแจ้งเตือนเข้ากลุ่ม LINE หรือไม่
   *
   * แทนที่ `ALERT_ZONES = ['วิกฤต','วิกฤตมาก']` ที่ระบบเดิมฮาร์ดโค้ดไว้
   *
   * @param {import('./values/ZoneLevel.js').ZoneLevel|string} zone โซนหรือคีย์โซน
   * @returns {boolean}
   */
  shouldAlertFor(zone) {
    const key = typeof zone === 'string' ? zone : zone?.key;
    return this.#alertZoneKeys.includes(key);
  }

  /** @returns {boolean} อนุญาต URL กล้องที่ชี้เครือข่ายภายในหรือไม่ */
  get allowPrivateCameraUrl() { return this.#allowPrivateCameraUrl; }

  /**
   * ตรวจความถูกต้อง
   *
   * ⚠️ ไม่รับพารามิเตอร์โดยเจตนา — นโยบายเรื่อง URL ภายในเก็บอยู่ในวัตถุแล้ว
   * ถ้ารับเป็นอาร์กิวเมนต์ ผู้เรียกที่ลืมส่ง (เช่น `BaseRepository.create()`)
   * จะได้ผลต่างจากผู้เรียกที่ส่ง ทำให้บันทึกไม่ผ่านทั้งที่ตรวจผ่านมาแล้ว
   *
   * @returns {void}
   * @throws {ValidationError} เมื่อข้อมูลไม่ถูกต้อง
   */
  validate() {
    const errors = [];
    if (!this.#name || this.#name.length > 255) {
      errors.push({ field: 'name', message: 'ชื่อจุดวัดต้องยาว 1–255 ตัวอักษร' });
    }
    if (!/^[a-z0-9-]{2,100}$/.test(this.#slug)) {
      errors.push({ field: 'slug', message: 'slug ต้องเป็นตัวพิมพ์เล็ก ตัวเลข หรือขีดกลาง 2–100 ตัว' });
    }
    if (!CAMERA_TYPES.includes(this.#cameraType)) {
      errors.push({ field: 'cameraType', message: `ชนิดกล้องต้องเป็น: ${CAMERA_TYPES.join(', ')}` });
    }
    if (this.#cameraUrl) {
      let parsed = null;
      try { parsed = new URL(this.#cameraUrl); } catch { /* จัดการด้านล่าง */ }
      if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
        errors.push({ field: 'cameraUrl', message: 'URL กล้องต้องขึ้นต้นด้วย http:// หรือ https://' });
      } else if (!this.#allowPrivateCameraUrl && Validator.isPrivateHost(parsed.hostname)) {
        errors.push({ field: 'cameraUrl', message: 'URL กล้องต้องไม่ชี้ไปยังเครือข่ายภายใน' });
      }
    }
    if (!Number.isFinite(this.#imageWidth) || this.#imageWidth < 1 || this.#imageWidth > 8192) {
      errors.push({ field: 'imageWidth', message: 'ความกว้างภาพต้องอยู่ระหว่าง 1–8192 พิกเซล' });
    }
    if (!Number.isFinite(this.#imageHeight) || this.#imageHeight < 1 || this.#imageHeight > 8192) {
      errors.push({ field: 'imageHeight', message: 'ความสูงภาพต้องอยู่ระหว่าง 1–8192 พิกเซล' });
    }
    if (this.#latitude !== null && (this.#latitude < -90 || this.#latitude > 90)) {
      errors.push({ field: 'latitude', message: 'ละติจูดต้องอยู่ระหว่าง -90 ถึง 90' });
    }
    if (this.#longitude !== null && (this.#longitude < -180 || this.#longitude > 180)) {
      errors.push({ field: 'longitude', message: 'ลองจิจูดต้องอยู่ระหว่าง -180 ถึง 180' });
    }
    if (this.#alertCooldownMinutes < 0 || this.#alertCooldownMinutes > 1440) {
      errors.push({ field: 'alertCooldownMinutes', message: 'ระยะกันแจ้งเตือนซ้ำต้องอยู่ระหว่าง 0–1440 นาที' });
    }
    const unknownZones = this.#alertZoneKeys.filter((key) => !ZoneLevel.fromKey(key));
    if (unknownZones.length) {
      errors.push({ field: 'alertZoneKeys', message: `ไม่รู้จักโซน: ${unknownZones.join(', ')}` });
    }
    if (errors.length) throw new ValidationError('ข้อมูลจุดวัดไม่ถูกต้อง', errors);
  }

  /** @returns {object} โครงสร้างสำหรับส่งออก */
  toJSON() {
    return {
      id: this.id,
      slug: this.#slug,
      name: this.#name,
      description: this.#description,
      cameraUrl: this.#cameraUrl,
      cameraType: this.#cameraType,
      cameraUsername: this.#cameraUsername,
      // ⚠️ ไม่มี cameraPassword โดยเจตนา — ดูเหตุผลที่ getter
      cameraHasPassword: Boolean(this.#cameraPassword),
      publicLiveEnabled: this.#publicLiveEnabled,
      imageWidth: this.#imageWidth,
      imageHeight: this.#imageHeight,
      latitude: this.#latitude,
      longitude: this.#longitude,
      isActive: this.#isActive,
      alertZoneKeys: this.alertZoneKeys,
      alertCooldownMinutes: this.#alertCooldownMinutes,
      lineGroupId: this.#lineGroupId,
      pdpa: this.pdpaConfig,
      imageRetentionDays: this.#imageRetentionDays,
      allowPrivateCameraUrl: this.#allowPrivateCameraUrl,
      publicPath: this.publicPath,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * แปลงชื่อเป็น slug สำหรับ URL — รองรับภาษาไทยโดยถอดเป็นรหัสอ่านได้
   * @param {string} value ข้อความต้นทาง
   * @returns {string}
   */
  static slugify(value) {
    const text = String(value ?? '').trim().toLowerCase();
    const ascii = text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (ascii.length >= 2) return ascii.slice(0, 100);

    // ชื่อภาษาไทยล้วน — ใช้รหัสจากจุดโค้ดเพื่อให้ได้ slug ที่คงที่และซ้ำได้
    let hash = 0;
    for (const char of text) {
      hash = (hash * 31 + char.codePointAt(0)) % 0xffffffff;
    }
    return `station-${hash.toString(36)}`;
  }

  /**
   * ทำความสะอาดรายการคีย์โซนที่ต้องแจ้งเตือน
   * @param {Array<string>|string|null} value ค่าดิบ (อาร์เรย์ หรือ JSON string)
   * @returns {Array<string>}
   */
  static #normalizeZoneKeys(value) {
    if (value === null || value === undefined) {
      return ZoneLevel.all().filter((zone) => zone.alertByDefault).map((zone) => zone.key);
    }
    let list = value;
    if (typeof value === 'string') {
      try { list = JSON.parse(value); } catch { list = value.split(',').map((item) => item.trim()); }
    }
    if (!Array.isArray(list)) return [];
    return [...new Set(list.map((item) => String(item).toUpperCase()).filter(Boolean))];
  }
}
