import { Router } from 'express';
import { RateLimitMiddleware } from '../middlewares/RateLimitMiddleware.js';

/**
 * เส้นทางหน้าผู้ดูแล (CLAUDE.md ข้อ 9.3)
 *
 * **สายด่านตรวจครบทั้ง 4 ชั้นตามลำดับที่กำหนด:**
 * ```
 * licenseMiddleware  → 402   ใบอนุญาตยังใช้ได้?
 * authMiddleware     → 401   เข้าสู่ระบบแล้ว?
 * permissionMiddleware → 403 มีสิทธิ์นี้?
 * stationScopeMiddleware → 404 จุดวัดอยู่ในขอบเขต?
 * ```
 * ด่านที่ 1 และ 2 ติดตั้งครั้งเดียวที่ระดับเราเตอร์ ส่วนด่านที่ 3 และ 4
 * ระบุรายเส้นทางเพราะแต่ละเส้นทางต้องการสิทธิ์ต่างกัน
 *
 * @param {import('../core/ServiceContainer.js').ServiceContainer} container ตัวประกอบวัตถุ
 * @returns {Router} เราเตอร์ของ Express
 */
export function adminRoutes(container) {
  const router = Router();
  const license = container.licenseMiddleware;
  const auth = container.authMiddleware;
  const can = container.permissionMiddleware;
  const scope = container.stationScopeMiddleware;

  const dashboard = container.dashboardController;
  const station = container.stationController;
  const roi = container.roiController;
  const calibration = container.calibrationController;
  const measurement = container.measurementController;
  const alert = container.alertController;
  const report = container.reportController;
  const user = container.userController;
  const role = container.roleController;
  const audit = container.auditController;
  const licenseCtl = container.licenseController;
  const line = container.lineController;

  // ── ด่านที่ 1 และ 2 ครอบทุกเส้นทางใน `/admin` ──
  router.use(license.handle(), auth.handle());

  // ── ภาพรวม (แค่เข้าสู่ระบบก็พอ) ──
  router.get('/', dashboard.handle(dashboard.index));

  // ── จุดวัด ──
  router.get('/stations', can.require('station.read'), station.handle(station.index));
  router.get('/stations/new', can.require('station.create'), station.handle(station.showCreate));
  router.post('/stations', can.require('station.create'), station.handle(station.create));

  router.get('/stations/:id/edit', can.require('station.update'), scope.fromParam('id'),
    station.handle(station.showEdit));
  router.get('/stations/:id', can.require('station.read'), scope.fromParam('id'),
    station.handle(station.show));
  router.post('/stations/:id', can.require('station.update'), scope.fromParam('id'),
    station.handle(station.update));
  router.post('/stations/:id/active', can.require('station.update'), scope.fromParam('id'),
    station.handle(station.toggleActive));
  router.post('/stations/:id/delete', can.require('station.delete'), scope.fromParam('id'),
    station.handle(station.destroy));

  // ── เครื่องมือวาด ROI ──
  router.get('/stations/:id/roi', can.require('roi.write'), scope.fromParam('id'),
    roi.handle(roi.editor));

  // ── จุดเทียบค่า ──
  router.get('/stations/:id/calibration', can.require('calibration.write'), scope.fromParam('id'),
    calibration.handle(calibration.page));

  // ── ค่าวัด ──
  router.get('/measurements', can.require('measurement.read'),
    measurement.handle(measurement.index));
  router.get('/measurements/export', can.require('measurement.export'),
    measurement.handle(measurement.exportCsv));

  // ── การแจ้งเตือน ──
  router.get('/alerts', can.require('alert.read'), alert.handle(alert.index));

  // ── รายงาน ──
  router.get('/reports', can.require('report.read'), report.handle(report.index));
  // เอกสารสำหรับพิมพ์ — ต้องมาก่อนเส้นทางที่มีพารามิเตอร์ มิฉะนั้น "print" จะถูกอ่านเป็นรหัส
  router.get('/reports/print', can.require('report.read'), report.handle(report.print));

  // ── กลุ่ม LINE ──
  router.get('/line', can.require('line.read'), line.handle(line.index));
  router.post('/line/:id/rename', can.require('line.manage'), line.handle(line.rename));
  router.post('/line/test', can.require('alert.broadcast'), RateLimitMiddleware.heavyAction(),
    line.handle(line.sendTest));

  // ── ผู้ใช้ ──
  router.get('/users', can.require('user.read'), user.handle(user.index));
  router.get('/users/new', can.require('user.create'), user.handle(user.showCreate));
  router.post('/users', can.require('user.create'), user.handle(user.create));
  router.get('/users/:id/edit', can.require('user.update'), user.handle(user.showEdit));
  router.post('/users/:id', can.require('user.update'), user.handle(user.update));
  router.post('/users/:id/password', can.require('user.reset_password'),
    user.handle(user.resetPassword));
  router.post('/users/:id/delete', can.require('user.delete'), user.handle(user.destroy));

  // ── บทบาทและสิทธิ์ ──
  router.get('/roles', can.require('role.read'), role.handle(role.index));
  router.post('/roles', can.require('role.manage'), role.handle(role.create));
  router.post('/roles/:id/permissions', can.require('role.manage'),
    role.handle(role.updatePermissions));
  router.post('/roles/:id/delete', can.require('role.manage'), role.handle(role.destroy));

  // ── บันทึกการใช้งาน ──
  router.get('/audit', can.require('audit.read'), audit.handle(audit.index));

  // ── ใบอนุญาต ──
  // ไม่มีหน้าจัดการใบอนุญาตแยกแล้ว — คีย์บริการตรวจจับคือใบอนุญาตในตัว
  // สถานะจึงไปอยู่ในแท็บ "สถานะระบบ" ของหน้าตั้งค่า เหลือไว้แค่ปุ่มสั่งตรวจเดี๋ยวนี้
  router.post('/license/sync', can.require('license.manage'), licenseCtl.handle(licenseCtl.sync));

  // ── ตั้งค่าระบบ ──
  router.get('/settings', can.require('setting.read'), dashboard.handle(dashboard.settings));
  router.post('/settings/notifications', can.require('setting.manage'),
    dashboard.handle(dashboard.saveSettings));

  return router;
}
