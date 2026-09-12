/**
 * ห่อ Chart.js สำหรับกราฟระดับน้ำ
 *
 * ซ่อนรายละเอียดการตั้งค่า Chart.js ไว้ในคลาสเดียว ทำให้หน้าอื่นเรียกใช้ได้ด้วย
 * `new WaterChart(canvas).render(series)` และเปลี่ยนช่วงเวลาด้วย `switchRange()`
 */
class WaterChart {
  /** @type {HTMLCanvasElement} */
  #canvas;
  /** @type {object|null} */
  #chart = null;
  /** @type {Array<object>} */
  #zones;

  /**
   * @param {HTMLCanvasElement} canvas พื้นที่วาดกราฟ
   * @param {Array<object>} [zones=[]] โซนเตือนภัยสำหรับวาดเส้นอ้างอิง
   */
  constructor(canvas, zones = []) {
    this.#canvas = canvas;
    this.#zones = zones;
  }

  /**
   * วาดกราฟจากชุดข้อมูล
   * @param {Array<{t: string, waterLine: number, waterLevelM: number|null}>} series ข้อมูล
   * @returns {void}
   */
  render(series) {
    if (typeof window.Chart === 'undefined') return;

    const hasMeters = series.some((point) => point.waterLevelM !== null);
    const labels = series.map((point) => WaterChart.#formatLabel(point.t));
    const values = series.map((point) => (
      hasMeters ? point.waterLevelM : point.waterLine
    ));

    this.#chart?.destroy();
    this.#chart = new window.Chart(this.#canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: hasMeters ? 'ระดับน้ำ (เมตร)' : 'ระดับน้ำ (พิกเซล)',
          data: values,
          borderColor: '#0e7490',
          backgroundColor: 'rgba(14, 116, 144, .12)',
          borderWidth: 2,
          fill: true,
          tension: .25,
          pointRadius: series.length > 80 ? 0 : 2,
          pointHoverRadius: 5,
          spanGaps: true,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          y: {
            // แกนพิกเซลต้องกลับด้าน เพราะพิกเซลน้อย = น้ำสูง
            reverse: !hasMeters,
            title: { display: true, text: hasMeters ? 'เมตร' : 'พิกเซล (น้อย = น้ำสูง)' },
            grid: { color: 'rgba(148, 163, 184, .2)' },
          },
          x: {
            ticks: { maxTicksLimit: 12, autoSkip: true },
            grid: { display: false },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => {
                const value = context.parsed.y;
                if (value === null) return 'ไม่มีข้อมูล';
                return hasMeters ? `${value.toFixed(2)} เมตร` : `${value} พิกเซล`;
              },
            },
          },
        },
      },
    });
  }

  /** ทำลายกราฟและคืนทรัพยากร */
  destroy() {
    this.#chart?.destroy();
    this.#chart = null;
  }

  /**
   * จัดรูปแบบป้ายแกนเวลาให้อ่านง่าย
   * @param {string} value เวลาในรูปแบบ `YYYY-MM-DD HH:MM:SS`
   * @returns {string}
   */
  static #formatLabel(value) {
    const text = String(value);
    if (text.length < 16) return text;
    const [date, time] = text.split(' ');
    const [, month, day] = date.split('-');
    return `${day}/${month} ${time.slice(0, 5)}`;
  }
}

window.WaterChart = WaterChart;
