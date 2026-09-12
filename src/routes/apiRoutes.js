import { Router } from 'express';
import { RateLimitMiddleware } from '../middlewares/RateLimitMiddleware.js';
import { UploadMiddleware } from '../middlewares/UploadMiddleware.js';

/**
 * เส้นทาง API ของผู้ดูแล (`/api/admin/...`)
 *
 * ใช้ด่านตรวจชุดเดียวกับหน้าเว็บทุกประการ — ต่างกันเพียงรูปแบบคำตอบเป็น JSON
 * ระบบเดิมเปิด `api/configs.php?action=delete` ให้ลบข้อมูลได้โดยไม่ต้องเข้าสู่ระบบ
 * และเปิด CORS `*` บน endpoint ที่เขียนข้อมูลได้ (ข้อบกพร่องที่ 2 และ 3)
 *
 * @param {import('../core/ServiceContainer.js').ServiceContainer} container ตัวประกอบวัตถุ
 * @returns {Router} เราเตอร์ของ Express
 */
export function apiRoutes(container) {
  const router = Router();
  const license = container.licenseMiddleware;
  const auth = container.authMiddleware;
  const can = container.permissionMiddleware;
  const scope = container.stationScopeMiddleware;

  const station = container.stationController;
  const roi = container.roiController;
  const calibration = container.calibrationController;
  const measurement = container.measurementController;
  const alert = container.alertController;
  const report = container.reportController;
  const audit = container.auditController;
  const dashboard = container.dashboardController;
  const camera = container.cameraController;

  router.use(RateLimitMiddleware.api(), license.handle(), auth.handle());

  // ── จุดวัด ──
  router.get('/stations', can.require('station.read'), station.handle(station.apiIndex));
  router.get('/stations/:id', can.require('station.read'), scope.fromParam('id'),
    station.handle(station.apiShow));

  // ── ภาพจากกล้อง (ผ่านตัวกลางของเรา ไม่ให้เบราว์เซอร์ต่อกล้องตรง ๆ) ──
  router.get('/stations/:id/camera/snapshot', can.require('station.read'), scope.fromParam('id'),
    camera.handle(camera.snapshot));
  router.get('/stations/:id/camera/stream', can.require('station.read'), scope.fromParam('id'),
    camera.handle(camera.stream));
  router.get('/stations/:id/camera/test', can.require('station.update'), scope.fromParam('id'),
    camera.handle(camera.test));

  // ── ROI ──
  router.get('/stations/:id/rois', can.require('roi.read'), scope.fromParam('id'),
    roi.handle(roi.apiIndex));
  router.post('/stations/:id/rois', can.require('roi.write'), scope.fromParam('id'),
    roi.handle(roi.save));
  router.get('/stations/:id/rois/export', can.require('roi.read'), scope.fromParam('id'),
    roi.handle(roi.exportConfig));
  router.post('/stations/:id/rois/import', can.require('roi.write'), scope.fromParam('id'),
    UploadMiddleware.singleJson('config'), roi.handle(roi.importConfig));

  // ── จุดเทียบค่า ──
  router.get('/stations/:id/calibration', can.require('calibration.read'), scope.fromParam('id'),
    calibration.handle(calibration.apiIndex));
  router.post('/stations/:id/calibration', can.require('calibration.write'), scope.fromParam('id'),
    calibration.handle(calibration.save));
  router.get('/stations/:id/calibration/test', can.require('calibration.read'), scope.fromParam('id'),
    calibration.handle(calibration.test));

  // ── ค่าวัด ──
  router.get('/measurements', can.require('measurement.read'),
    measurement.handle(measurement.apiIndex));
  router.get('/stations/:id/chart', can.require('measurement.read'), scope.fromParam('id'),
    measurement.handle(measurement.apiChart));
  router.post('/stations/:id/capture', can.require('capture.trigger'), scope.fromParam('id'),
    RateLimitMiddleware.heavyAction(), measurement.handle(measurement.triggerCapture));
  router.delete('/measurements/:id', can.require('measurement.delete'),
    measurement.handle(measurement.destroy));

  // ── การแจ้งเตือน ──
  router.post('/stations/:id/alert', can.require('alert.broadcast'), scope.fromParam('id'),
    RateLimitMiddleware.heavyAction(), alert.handle(alert.broadcast));
  router.post('/alerts/test', can.require('alert.broadcast'),
    RateLimitMiddleware.heavyAction(), alert.handle(alert.sendTest));

  // ── รายงาน ──
  router.post('/stations/:id/reports/generate', can.require('report.generate'), scope.fromParam('id'),
    report.handle(report.generate));
  router.post('/stations/:id/reports/send', can.require('report.send'), scope.fromParam('id'),
    RateLimitMiddleware.heavyAction(), report.handle(report.send));

  // ── บันทึกการใช้งานและสถานะระบบ ──
  router.get('/audit', can.require('audit.read'), audit.handle(audit.apiIndex));
  router.get('/jobs', can.require('setting.read'), dashboard.handle(dashboard.jobStatus));
  router.get('/connections/test', can.require('setting.read'),
    dashboard.handle(dashboard.testConnections));

  return router;
}
