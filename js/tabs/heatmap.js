/**
 * 🗺 热度地图 tab
 *
 * 复刻 Streamlit 原版关键特性：
 *   - x 轴 categorical + forward-fill（未采样日继承前一采样日色块）
 *   - 周一/周五/周六/节假日色彩编码（Plotly 用 annotations 实现）
 *   - 暑期长窗口（>4 天）背景条带 + 📅 标注
 *   - 当地节假日 ⭐ marker
 *   - 单击单元格 → 跳到「单点钻取」tab 预填
 *
 * 核心数据结构：
 *   - x：所有 checkin 日期（升序，去重）
 *   - y：所有有数据的城市名（中文）
 *   - z[y_idx][x_idx]：heat_score（None → forward-fill）
 */

import { cityNameZh, heatLevel, jumpToDrilldown } from '../main.js';

// 热度档位 colorscale（与 dashboard 视觉一致）
// Plotly colorscale: [[domain_pct, color], ...]
const HEAT_COLORSCALE = [
  [0.00, '#1e3a5f'],   // 深蓝（很冷）
  [0.35, '#4a9eff'],   // 蓝
  [0.55, '#4caf50'],   // 绿
  [0.75, '#ffc107'],   // 黄
  [0.92, '#ff6b35'],   // 橙
  [1.00, '#d32f2f'],   // 红（很烫）
];

// ============================================================
// 渲染入口
// ============================================================
export function renderHeatmap(state) {
  const { meta, currentSnapshot } = state;
  const { city_heat } = currentSnapshot;
  const target = document.getElementById('heatmap-plot');

  // 没有 city_heat 数据（如 5/26 那种采集不完整的 snapshot）
  if (!city_heat || Object.keys(city_heat).length === 0) {
    target.innerHTML = `
      <div class="error-msg">
        本快照（${state.currentDate}）暂无 city_heat 数据，可能是当日采集不完整或还未跑 compute_heat。
        <br>请切换到其他快照查看。
      </div>`;
    return;
  }

  // ----- 构造矩阵 -----
  const cities = Object.keys(city_heat).sort((a, b) => {
    // 优先按当前 snapshot 的城市平均热度降序
    const avgA = avgHeat(city_heat[a]);
    const avgB = avgHeat(city_heat[b]);
    return avgB - avgA;
  });
  const yLabels = cities.map(cityNameZh);

  // 收集所有 checkin 日期，去重排序
  const allDates = new Set();
  for (const c of cities) {
    for (const row of city_heat[c]) allDates.add(row.ci);
  }
  const xDates = [...allDates].sort();

  // 构造 z 矩阵（forward-fill 缺失值）
  const z = [];
  const customdata = [];   // [city, ci] 用于点击事件
  const text = [];         // hover 显示
  for (const c of cities) {
    const cityRows = city_heat[c];
    // 索引化加速查找
    const cityMap = new Map(cityRows.map((r) => [r.ci, r]));

    const row = [];
    const cdRow = [];
    const txtRow = [];
    let lastHeat = null;
    for (const d of xDates) {
      const r = cityMap.get(d);
      if (r && r.heat != null) {
        lastHeat = r.heat;
        row.push(r.heat);
        txtRow.push(formatHover(c, d, r));
      } else if (lastHeat != null) {
        row.push(lastHeat);   // forward-fill
        txtRow.push(`${cityNameZh(c)}<br>${d}<br><i>(承继前一采样日)</i>`);
      } else {
        row.push(null);
        txtRow.push(`${cityNameZh(c)}<br>${d}<br>(无数据)`);
      }
      cdRow.push([c, d]);
    }
    z.push(row);
    customdata.push(cdRow);
    text.push(txtRow);
  }

  // ----- 暑期长窗口 + 节假日 annotations -----
  const summerWindows = findSummerWindows(meta.holidays_cn || []);
  const shapes = summerWindows.map((w) => ({
    type: 'rect',
    xref: 'x', yref: 'paper',
    x0: w.start, x1: w.end,
    y0: 0, y1: 1,
    fillcolor: 'rgba(255, 107, 53, 0.06)',
    line: { width: 0 },
    layer: 'below',
  }));

  // 中国节假日 annotations（顶部红色标注）
  const annotations = [];
  for (const w of meta.holidays_cn || []) {
    if (xDates.includes(w.start)) {
      annotations.push({
        x: w.start, y: 1.04, xref: 'x', yref: 'paper',
        text: `📅 ${w.name_zh}`,
        showarrow: false,
        font: { size: 10, color: '#ff6b6b' },
        xanchor: 'left',
      });
    }
  }
  // 当地节假日 ⭐ marker
  const localStars = [];
  for (const h of meta.holidays_local || []) {
    if (!xDates.includes(h.date)) continue;
    for (const cityCode of h.affects) {
      const yIdx = cities.indexOf(cityCode);
      if (yIdx === -1) continue;
      localStars.push({
        x: h.date, y: yIdx,
        text: '⭐',
        showarrow: false,
        font: { size: 14 },
        hovertext: `${cityNameZh(cityCode)} · ${h.date} · ${h.name_zh}`,
      });
    }
  }
  annotations.push(...localStars);

  // ----- 周末/节假日 tick 着色（用 annotations 替代 ticktext，更可控）-----
  // Plotly 的 ticktext 只能整组一个颜色，要"按 tick 个性化颜色"必须自己画
  const tickAnnotations = makeTickAnnotations(xDates, meta.holidays_cn || []);
  annotations.push(...tickAnnotations);

  // ----- Plotly trace -----
  const trace = {
    type: 'heatmap',
    x: xDates,
    y: yLabels,
    z: z,
    customdata: customdata,
    text: text,
    hovertemplate: '%{text}<br>热度 %{z}<extra></extra>',
    colorscale: HEAT_COLORSCALE,
    zmin: 0,
    zmax: 100,
    xgap: 0,
    ygap: 1,
    colorbar: {
      title: { text: '热度', font: { color: '#8b95a6', size: 11 } },
      tickfont: { color: '#8b95a6', size: 10 },
      thickness: 12,
      len: 0.75,
    },
    showscale: true,
  };

  const layout = {
    autosize: true,
    height: Math.max(500, cities.length * 28 + 120),
    paper_bgcolor: '#0e1117',
    plot_bgcolor: '#0e1117',
    margin: { l: 90, r: 30, t: 60, b: 50 },
    xaxis: {
      type: 'category',
      tickfont: { size: 0, color: 'rgba(0,0,0,0)' },  // 隐藏默认 ticks（用 annotations 替代）
      showgrid: false,
      showline: true, linecolor: '#2a3142',
    },
    yaxis: {
      tickfont: { color: '#c9d1d9', size: 11 },
      showgrid: false,
      autorange: 'reversed',
    },
    shapes,
    annotations,
  };

  const config = {
    displayModeBar: false,
    responsive: true,
  };

  Plotly.newPlot(target, [trace], layout, config);

  // ----- 单击事件 → 跳转 drilldown -----
  target.on('plotly_click', (ev) => {
    const pt = ev.points?.[0];
    if (!pt?.customdata) return;
    const [cityCode, checkinDate] = pt.customdata;
    jumpToDrilldown(cityCode, checkinDate);
  });
}

// ============================================================
// helpers
// ============================================================
function avgHeat(rows) {
  const valid = rows.map((r) => r.heat).filter((h) => h != null);
  if (valid.length === 0) return -1;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function formatHover(cityCode, date, row) {
  const lvl = heatLevel(row.heat);
  const lvlEmoji = { blue: '🔵', green: '🟢', yellow: '🟡', red: '🔴', na: '⚫' }[lvl];
  const dt = new Date(date);
  const dow = ['日', '一', '二', '三', '四', '五', '六'][dt.getDay()];
  let txt = `<b>${cityNameZh(cityCode)}</b><br>${date} (周${dow}) ${lvlEmoji}<br>`;
  if (row.lvl != null) txt += `价格水平 ${row.lvl}<br>`;
  if (row.so != null && row.so > 0) txt += `售罄率 ${(row.so * 100).toFixed(0)}%<br>`;
  if (row.n != null) txt += `酒店数 ${row.n}`;
  return txt;
}

/**
 * 找出"长度 >= 4 天"的中国节假日窗口（如暑期、长假）
 * 用于绘制 x 轴背景条带提示
 */
function findSummerWindows(holidays) {
  const result = [];
  for (const w of holidays) {
    const start = new Date(w.start);
    const end = new Date(w.end);
    const days = Math.ceil((end - start) / 86400000) + 1;
    if (days >= 4) {
      result.push({ start: w.start, end: w.end, name: w.name_zh });
    }
  }
  return result;
}

/**
 * 给 x 轴每个日期生成 annotation tick：
 * - 周五：黄色
 * - 周六：橙色
 * - 中国节假日：红色 + 加粗
 * - 工作日：灰色
 */
function makeTickAnnotations(xDates, holidaysCn) {
  const annotations = [];
  // 把节假日所有 date 展开成 set（含日期 ∈ [start, end]）
  const holidayDateSet = new Set();
  for (const w of holidaysCn) {
    let cur = new Date(w.start);
    const end = new Date(w.end);
    while (cur <= end) {
      holidayDateSet.add(cur.toISOString().substring(0, 10));
      cur.setDate(cur.getDate() + 1);
    }
  }

  for (const d of xDates) {
    const dt = new Date(d);
    const dow = dt.getDay();           // 0=Sun, 5=Fri, 6=Sat
    const isHoliday = holidayDateSet.has(d);

    let color = '#5a6678';   // 工作日 - 暗灰
    let weight = 'normal';
    if (isHoliday)       { color = '#ff6b6b'; weight = 'bold'; }
    else if (dow === 6)  { color = '#ff8c5b'; }   // 周六 - 橙
    else if (dow === 5)  { color = '#ffc107'; }   // 周五 - 黄
    else if (dow === 0)  { color = '#ff8c5b'; }   // 周日 - 橙

    // 不每天都标 — 太密。每隔 7 天标一次（周一附近优先）
    if (dow !== 1 && dow !== 5 && dow !== 6 && dow !== 0 && !isHoliday) continue;

    const month = dt.getMonth() + 1;
    const day = dt.getDate();
    const label = dow === 1 ? `${month}/${day}` : `${day}`;

    annotations.push({
      x: d, y: -0.04,
      xref: 'x', yref: 'paper',
      text: label,
      showarrow: false,
      font: { color, size: 9, weight },
      xanchor: 'center',
    });
  }
  return annotations;
}
