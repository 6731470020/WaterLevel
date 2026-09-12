import { publicRoutes } from './publicRoutes.js';
import { authRoutes } from './authRoutes.js';
import { adminRoutes } from './adminRoutes.js';
import { apiRoutes } from './apiRoutes.js';
import { webhookRoutes } from './webhookRoutes.js';

/**
 * ตัวรวมและลงทะเบียนเส้นทางทั้งหมดของระบบ
 *
 * **ลำดับการลงทะเบียนสำคัญ** — Express จับคู่เส้นทางตามลำดับที่ลงทะเบียน
 * webhook ต้องมาก่อน CSRF, และหน้าสาธารณะที่มี `/:slug` ต้องมาหลังเส้นทางเฉพาะทั้งหมด
 * มิฉะนั้น `/station/login` จะถูกจับเป็น slug
 */
export class RouteRegistry {
  /** @type {import('../core/ServiceContainer.js').ServiceContainer} */
  #container;

  /** @param {import('../core/ServiceContainer.js').ServiceContainer} container ตัวประกอบวัตถุ */
  constructor(container) {
    this.#container = container;
  }

  /**
   * ลงทะเบียนเส้นทางทั้งหมดเข้ากับแอป Express
   * @param {import('express').Express} app แอป Express
   * @param {(req: object, res: object) => Promise<void>} healthHandler ตัวจัดการ `GET /health`
   * @returns {void}
   */
  register(app, healthHandler) {
    // 1. health check — ต้องตอบได้เสมอแม้ใบอนุญาตหมดอายุหรือฐานข้อมูลล่ม
    app.get('/health', healthHandler);

    // 2. webhook — ต้องมาก่อนด่าน CSRF (ลงทะเบียนใน Application ก่อนเรียกเมท็อดนี้)
    app.use('/webhooks', webhookRoutes(this.#container));

    // 3. เส้นทางเข้าสู่ระบบ
    app.use('/', authRoutes(this.#container));

    // 4. หน้าผู้ดูแลและ API
    app.use('/admin', adminRoutes(this.#container));
    app.use('/api/admin', apiRoutes(this.#container));

    // 5. หน้าสาธารณะ — ลงท้ายเพราะมีเส้นทางที่รับพารามิเตอร์กว้าง
    app.use('/', publicRoutes(this.#container));
  }
}
