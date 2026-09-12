import { Router } from 'express';
import { RateLimitMiddleware } from '../middlewares/RateLimitMiddleware.js';

/**
 * เส้นทาง webhook จากบริการภายนอก (CLAUDE.md ข้อ 9.4)
 *
 * **ไม่มีด่านยืนยันตัวตนหรือ CSRF** เพราะเป็นคำขอจากเซิร์ฟเวอร์ภายนอกที่ไม่มี session
 * ความปลอดภัยมาจากการตรวจลายเซ็น HMAC-SHA256 แบบ timing-safe ภายใน Controller แทน
 *
 * @param {import('../core/ServiceContainer.js').ServiceContainer} container ตัวประกอบวัตถุ
 * @returns {Router} เราเตอร์ของ Express
 */
export function webhookRoutes(container) {
  const router = Router();
  const controller = container.lineWebhookController;

  router.post('/line', RateLimitMiddleware.webhook(),
    controller.handle(controller.handleWebhook));

  return router;
}
