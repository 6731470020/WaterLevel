/**
 * กล่องดูภาพขยายสำหรับแกลเลอรี
 *
 * รองรับการปิดด้วยปุ่ม Esc คลิกพื้นหลัง และเลื่อนดูภาพก่อนหน้า/ถัดไปด้วยลูกศร
 */
class Lightbox {
  /** @type {HTMLElement} */
  #root;
  /** @type {HTMLImageElement} */
  #image;
  /** @type {HTMLElement} */
  #caption;
  /** @type {Array<HTMLElement>} */
  #items = [];
  /** @type {number} */
  #index = 0;

  /**
   * @param {object} options ตัวเลือก
   * @param {HTMLElement} options.root กล่อง lightbox
   * @param {HTMLElement} options.gallery พื้นที่แกลเลอรี
   */
  constructor({ root, gallery }) {
    this.#root = root;
    this.#image = root.querySelector('#lightboxImage');
    this.#caption = root.querySelector('#lightboxCaption');
    this.#items = gallery ? [...gallery.querySelectorAll('[data-full]')] : [];
    this.#bind(root);
  }

  /**
   * ผูกเหตุการณ์ทั้งหมด
   * @param {HTMLElement} root กล่อง lightbox
   */
  #bind(root) {
    this.#items.forEach((item, index) => {
      item.addEventListener('click', () => this.open(index));
    });

    root.querySelector('[data-lightbox-close]')?.addEventListener('click', () => this.close());
    root.addEventListener('click', (event) => {
      // ปิดเมื่อคลิกพื้นหลัง แต่ไม่ปิดเมื่อคลิกที่ตัวภาพ
      if (event.target === root) this.close();
    });

    document.addEventListener('keydown', (event) => {
      if (!this.#root.classList.contains('is-open')) return;
      if (event.key === 'Escape') this.close();
      if (event.key === 'ArrowRight') this.open(this.#index + 1);
      if (event.key === 'ArrowLeft') this.open(this.#index - 1);
    });
  }

  /**
   * เปิดภาพตามลำดับที่ระบุ (วนรอบเมื่อเกินขอบ)
   * @param {number} index ลำดับภาพ
   * @returns {void}
   */
  open(index) {
    if (!this.#items.length) return;
    const total = this.#items.length;
    this.#index = ((index % total) + total) % total;

    const item = this.#items[this.#index];
    this.#image.src = item.dataset.full;
    this.#image.alt = item.dataset.caption ?? '';
    this.#caption.textContent =
      `${item.dataset.caption ?? ''}  (${this.#index + 1}/${total})`;
    this.#root.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  /** ปิดกล่องดูภาพ */
  close() {
    this.#root.classList.remove('is-open');
    this.#image.removeAttribute('src');
    document.body.style.overflow = '';
  }
}

window.Lightbox = Lightbox;
