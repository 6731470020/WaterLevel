import { Router } from 'express';
import { RateLimitMiddleware } from '../middlewares/RateLimitMiddleware.js';

/**
 * เส้นทางเข้าสู่ระบบและจัดการรหัสผ่าน (CLAUDE.md ข้อ 9.2)
 *
 * หน้าเข้าสู่ระบบมีด่านจำกัดอัตราเฉพาะที่นับทั้ง IP และชื่อผู้ใช้
 * ส่วนหน้าที่ต้องเข้าสู่ระบบแล้วใช้ `allowPasswordChange` เพื่อไม่ให้ติดกับดัก
 * "ต้องเปลี่ยนรหัสผ่านก่อน" จนเปลี่ยนรหัสผ่านไม่ได้
 *
 * @param {import('../core/ServiceContainer.js').ServiceContainer} container ตัวประกอบวัตถุ
 * @returns {Router} เราเตอร์ของ Express
 */
export function authRoutes(container) {
  const router = Router();
  const controller = container.authController;
  const auth = container.authMiddleware;

  router.get('/login', controller.handle(controller.showLogin));
  router.post('/login', RateLimitMiddleware.login(), controller.handle(controller.login));

  router.post('/logout', auth.handle({ allowPasswordChange: true }),
    controller.handle(controller.logout));
  router.post('/logout-all', auth.handle({ allowPasswordChange: true }),
    controller.handle(controller.logoutAll));

  router.get('/forgot-password', controller.handle(controller.showForgotPassword));
  router.post('/forgot-password', RateLimitMiddleware.passwordReset(),
    controller.handle(controller.forgotPassword));

  router.get('/reset-password/:token', controller.handle(controller.showResetPassword));
  router.post('/reset-password/:token', RateLimitMiddleware.passwordReset(),
    controller.handle(controller.resetPassword));

  router.get('/change-password', auth.handle({ allowPasswordChange: true }),
    controller.handle(controller.showChangePassword));
  router.post('/change-password', auth.handle({ allowPasswordChange: true }),
    controller.handle(controller.changePassword));

  router.get('/account/sessions', auth.handle(), controller.handle(controller.showSessions));

  return router;
}
