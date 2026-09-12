import { Router } from 'express';
import { RateLimitMiddleware } from '../middlewares/RateLimitMiddleware.js';

/**
 * เส้นทางหน้าตั้งค่าระบบครั้งแรก
 *
 * **ไม่มีด่านยืนยันตัวตน** เพราะยังไม่มีผู้ใช้ในระบบให้เข้าสู่ระบบ
 * ความปลอดภัยมาจากเงื่อนไขเดียว: `SetupService` ปฏิเสธทุกคำขอทันทีที่ระบบมีผู้ใช้แล้ว
 *
 * มีด่านจำกัดอัตราคำขอเพื่อกันการยิงซ้ำระหว่างที่หน้านี้ยังเปิดอยู่
 *
 * @param {object} deps การพึ่งพา
 * @param {import('../controllers/SetupController.js').SetupController} deps.setupController ตัวควบคุม
 * @returns {Router} เราเตอร์ของ Express
 */
export function setupRoutes({ setupController }) {
  const router = Router();

  router.get('/', setupController.handle(setupController.index));

  router.post('/test-connection', RateLimitMiddleware.heavyAction(),
    setupController.handle(setupController.testConnection));

  router.post('/install', RateLimitMiddleware.heavyAction(),
    setupController.handle(setupController.install));

  return router;
}
