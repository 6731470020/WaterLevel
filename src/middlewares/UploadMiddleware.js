import multer from 'multer';
import { ValidationError } from '../core/errors/index.js';

/** ขนาดไฟล์สูงสุด 10 MB (CLAUDE.md ข้อ 13) */
const MAX_BYTES = 10 * 1024 * 1024;
/** ชนิดไฟล์ที่ยอมรับตาม MIME type ที่เบราว์เซอร์แจ้งมา */
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * ตัวสร้างด่านรับไฟล์อัปโหลด
 *
 * เก็บไฟล์ไว้ในหน่วยความจำเท่านั้น ไม่เขียนลงดิสก์โดยตรง เพราะ `LocalStorageService`
 * จะเป็นผู้ตรวจ magic bytes และ re-encode ด้วย `sharp` ก่อนบันทึกจริง
 * ทำให้ไฟล์ที่แฝง payload มาไม่มีทางถูกเขียนลงดิสก์ในรูปเดิม
 *
 * MIME type ที่เบราว์เซอร์ส่งมาปลอมได้ จึงเป็นเพียงด่านคัดกรองชั้นแรกเท่านั้น
 */
export class UploadMiddleware {
  /**
   * ด่านรับไฟล์ภาพหนึ่งไฟล์
   * @param {string} [fieldName='image'] ชื่อฟิลด์ในฟอร์ม
   * @returns {Function} middleware ของ Express
   */
  static singleImage(fieldName = 'image') {
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: MAX_BYTES, files: 1 },
      fileFilter: (req, file, callback) => {
        if (!ALLOWED_MIME.includes(file.mimetype)) {
          callback(new ValidationError('รองรับเฉพาะไฟล์ภาพ JPEG, PNG และ WebP'));
          return;
        }
        callback(null, true);
      },
    }).single(fieldName);

    return (req, res, next) => {
      upload(req, res, (error) => {
        if (!error) { next(); return; }
        if (error instanceof multer.MulterError) {
          next(new ValidationError(UploadMiddleware.#describe(error)));
          return;
        }
        next(error);
      });
    };
  }

  /**
   * ด่านรับไฟล์ JSON (ใช้นำเข้า config ROI เดิม) — จำกัด 2 MB
   * @param {string} [fieldName='config'] ชื่อฟิลด์ในฟอร์ม
   * @returns {Function} middleware ของ Express
   */
  static singleJson(fieldName = 'config') {
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024, files: 1 },
      fileFilter: (req, file, callback) => {
        const ok = file.mimetype === 'application/json'
          || file.originalname.toLowerCase().endsWith('.json');
        if (!ok) {
          callback(new ValidationError('รองรับเฉพาะไฟล์ .json'));
          return;
        }
        callback(null, true);
      },
    }).single(fieldName);

    return (req, res, next) => {
      upload(req, res, (error) => {
        if (!error) { next(); return; }
        if (error instanceof multer.MulterError) {
          next(new ValidationError(UploadMiddleware.#describe(error)));
          return;
        }
        next(error);
      });
    };
  }

  /**
   * แปลงรหัสข้อผิดพลาดของ multer เป็นข้อความภาษาไทย
   * @param {import('multer').MulterError} error ข้อผิดพลาด
   * @returns {string}
   */
  static #describe(error) {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return `ไฟล์ใหญ่เกินไป (จำกัด ${MAX_BYTES / 1024 / 1024} MB)`;
      case 'LIMIT_FILE_COUNT':
        return 'อัปโหลดได้ครั้งละ 1 ไฟล์เท่านั้น';
      case 'LIMIT_UNEXPECTED_FILE':
        return 'ชื่อฟิลด์ของไฟล์ไม่ถูกต้อง';
      default:
        return 'อัปโหลดไฟล์ไม่สำเร็จ';
    }
  }
}
