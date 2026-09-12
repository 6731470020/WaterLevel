import { Router } from 'express';
import { RateLimitMiddleware } from '../middlewares/RateLimitMiddleware.js';

/**
 * เส้นทางสาธารณะ — ไม่ต้องเข้าสู่ระบบ จำกัด 60 คำขอ/นาที/IP (CLAUDE.md ข้อ 9.1)
 *
 * `AuthMiddleware.optional()` เติม `req.user` ให้เมื่อมี session อยู่แล้ว
 * เพื่อให้แสดงเมนูผู้ดูแลบนหน้าสาธารณะได้ แต่ไม่บังคับให้เข้าสู่ระบบ
 *
 * @param {import('../core/ServiceContainer.js').ServiceContainer} container ตัวประกอบวัตถุ
 * @returns {Router} เราเตอร์ของ Express
 */
export function publicRoutes(container) {
  const router = Router();
  const controller = container.publicController;
  const license = container.licenseMiddleware;
  const auth = container.authMiddleware;
  const limiter = RateLimitMiddleware.publicPages();

  router.get('/', limiter, license.handle(), auth.optional(),
    controller.handle(controller.index));

  router.get('/station/:slug', limiter, license.handle(), auth.optional(),
    controller.handle(controller.station));

  router.get('/api/public/stations/:slug/measurements', limiter, license.handle(),
    controller.handle(controller.apiMeasurements));

  // หน้าใบอนุญาตหมดอายุ — ต้องเข้าถึงได้เสมอ จึงไม่ผ่านด่านใบอนุญาต
  router.get('/license-expired', limiter,
    container.licenseController.handle(container.licenseController.showExpired));

  // ภาพสดสาธารณะ — เปิดเฉพาะจุดวัดที่ผู้ดูแลอนุญาต และแคชฝั่งเซิร์ฟเวอร์ 2 วินาที
  // เพื่อไม่ให้จำนวนผู้ชมกลายเป็นภาระของกล้อง
  router.get('/api/public/stations/:slug/camera.jpg', limiter, license.handle(),
    container.cameraController.handle(container.cameraController.publicSnapshot));

  router.get('/robots.txt', controller.handle(controller.robots));
  router.get('/sitemap.xml', limiter, controller.handle(controller.sitemap));

  return router;
}
