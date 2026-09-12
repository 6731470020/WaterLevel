import { AppError } from './AppError.js';

/** บริการภายนอก (AI detection / LINE / SMTP) ตอบผิดพลาด → HTTP 502 */
export class UpstreamError extends AppError {
  /** @type {string} */
  #service;

  /**
   * @param {string} service ชื่อบริการภายนอก เช่น 'detection', 'line'
   * @param {string} [message='บริการภายนอกไม่ตอบสนอง กรุณาลองใหม่ภายหลัง']
   */
  constructor(service, message = 'บริการภายนอกไม่ตอบสนอง กรุณาลองใหม่ภายหลัง') {
    super(message, 502, 'UPSTREAM_ERROR', [{ service }]);
    this.#service = service;
  }

  /** @returns {string} ชื่อบริการภายนอกที่ล้มเหลว */
  get service() { return this.#service; }
}
