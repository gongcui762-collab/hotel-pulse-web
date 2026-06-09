/**
 * 热度地图（v3.2）
 *
 * v3.2 时间轴重设计：
 *   - 两层分离：窗口标注（上层）+ 全量日期（下层，紧贴热度图）
 *   - 全部日期水平正体展示，月份变化处显示 M/D，其余只显示 D
 *   - 颜色区分：工作日灰、周五六橙、法定假日红
 */

import { cityNameZh, heatLevel, jumpToDrilldown } from '../main.js';

const HEAT_COLORSCALE = [
  [0.00, '#dbeafe'],
  [0.35, '#60a5fa'],
  [0.50, '#34d399'],
  [0.65, '#fbbf24'],
  [0.80, '#f97171'],
  [1.00, '#dc2626'],
];

const WINDOW_COLORS = {
  duanwu_2026:              'rgba(52, 211, 153, 0.10)',
  summer_2026:              'rgba(251, 191, 36, 0.10)',
  mid_autumn_national_2026: 'rgba(249, 115, 22, 0.10)',
  new_year_spring_2027:     'rgba(239, 68, 68, 0.10)',
};

const COUNTRY_FLAGS = {
  JP: '🇯🇵', TH: '🇹🇭', KR: '🇰🇷', HK: '🇭🇰', MO: '🇲🇴',
  SG: '🇸🇬', MY: '🇲🇾', ID: '🇮🇩', VN: '🇻🇳', AE: '🇦🇪',
  MV: '🇲🇻', US: '🇺🇸', CA: '🇨🇦',
};

const GROUP_ORDER = ['日本', '泰国', '韩国', '港澳', '新加坡', '马来西亚', '印尼', '越南', '中东', '南亚', 'US', 'CA'];

const HIGH_HEAT_THRESHOLD = 70;

export function renderHeatmap(state) {
  const { meta, currentSnapshot } = state;
  const { city_heat } = currentSnapshot;
  const target = document.getElementById('heatmap-plot');

  if (!city_heat || Object.keys(city_heat).length === 0) {
    target.innerHTML = `<div class="error-msg">本快照暂无 city_heat 数据</div>`;
    return;
  }

  // ===== 按国家分组排序城市 =====
  const citiesWithData = (meta.cities || []).filter(c => city_heat[c.code]);
  const groupOrderMap = Object.fromEntries(GROUP_ORDER.map((g, i) => [g, i]));
  const sortedCities = citiesWithData.sort((a, b) => {
    const ga = groupOrderMap[a.country_group] ?? 99;
    const gb = groupOrderMap[b.country_group] ?? 99;
    if (ga !== gb) return ga - gb;
    return (a.outbound_rank || 99) - (b.outbound_rank || 99);
  });
  const cities = sortedCities.map(c => c.code);
  const yLabels = sortedCities.map(c => `${COUNTRY_FLAGS[c.country] || ''} ${c.name_zh || c.code}`);

  const allDates = new Set();
  for (const c of cities) for (const r of city_heat[c]) allDates.add(r.ci);
  const xDates = [...allDates].sort();

  // ===== 预计算酒店明细索引（供 hover 用） =====
  const detailIndex = {};
  for (const d of currentSnapshot.hotel_details || []) {
    const key = `${d.city}|${d.ci}`;
    if (!detailIndex[key]) detailIndex[key] = { up: 0, down: 0, flat: 0, total: 0, soldOut: 0 };
    if (d.status === 'ok' && !d.out) {
      detailIndex[key].total++;
      if (d.delta != null) {
        if (d.delta > 0.05) detailIndex[key].up++;
        else if (d.delta < -0.05) detailIndex[key].down++;
        else detailIndex[key].flat++;
      }
    }
    if (d.so) detailIndex[key].soldOut++;
  }

  // ===== 事件索引（供 hover 高热原因推断） =====
  const eventIndex = {};
  for (const h of meta.holidays_local || []) {
    for (const cc of h.affects) {
      const key = `${cc}|${h.date}`;
      if (!eventIndex[key]) eventIndex[key] = [];
      if (!eventIndex[key].includes(h.name_zh)) eventIndex[key].push(h.name_zh);
    }
  }

  // z 矩阵 + forward-fill
  const z = [], customdata = [], text = [];
  for (const c of cities) {
    const cityMap = new Map((city_heat[c] || []).map(r => [r.ci, r]));
    const row = [], cdRow = [], txtRow = [];
    let lastHeat = null;
    for (const d of xDates) {
      const r = cityMap.get(d);
      const heatVal = r ? (r.bh != null ? r.bh : r.heat) : null;
      if (r && heatVal != null) {
        lastHeat = heatVal;
        row.push(heatVal);
        txtRow.push(formatHover(c, d, r, detailIndex, eventIndex));
      } else if (lastHeat != null) {
        row.push(lastHeat);
        txtRow.push(`${cityNameZh(c)}<br>${d}<br>(承继前采样日)`);
      } else {
        row.push(null);
        txtRow.push(`${cityNameZh(c)}<br>${d}<br>(无数据)`);
      }
      cdRow.push([c, d]);
    }
    z.push(row); customdata.push(cdRow); text.push(txtRow);
  }

  // ===== Annotations =====
  const annotations = [];

  // 当地事件 ⭐ — 前端额外过滤：≥3 城市的通用节日跳过
  const eventCityCounts = {};
  for (const h of meta.holidays_local || []) {
    if (!eventCityCounts[h.name_zh]) eventCityCounts[h.name_zh] = new Set();
    for (const cc of h.affects) eventCityCounts[h.name_zh].add(cc);
  }
  for (const h of meta.holidays_local || []) {
    if (!xDates.includes(h.date)) continue;
    if ((eventCityCounts[h.name_zh]?.size || 0) >= 3) continue;
    for (const cc of h.affects) {
      const yIdx = cities.indexOf(cc);
      if (yIdx === -1) continue;
      annotations.push({
        x: h.date, y: yIdx, text: '⭐', showarrow: false,
        font: { size: 14 }, hovertext: `${cityNameZh(cc)} · ${h.date} · ${h.name_zh}`,
      });
    }
  }

  // ===== 第二层：全量日期标注（紧贴热度图上方） =====
  const holidaySet = new Set();
  for (const w of meta.holidays_cn || []) {
    const s = new Date(w.start), e = new Date(w.end);
    if ((e - s) / 86400000 > 10) continue; // 跳过暑期高点等长周期旺季标记
    let cur = new Date(s);
    while (cur <= e) { holidaySet.add(cur.toISOString().substring(0, 10)); cur.setDate(cur.getDate() + 1); }
  }

  let prevMonth = null;
  for (const d of xDates) {
    const dt = new Date(d);
    const dow = dt.getDay();
    const m = dt.getMonth() + 1, day = dt.getDate();
    const isHoliday = holidaySet.has(d);
    const isWeekend = dow === 5 || dow === 6; // 周五/六（出行高峰日）

    let color = '#94a3b8';               // 工作日：灰
    if (isHoliday) color = '#dc2626';    // 法定假日：红
    else if (isWeekend) color = '#d97706'; // 周末：琥珀

    const showMonth = (m !== prevMonth);
    const label = showMonth ? `${m}/${day}` : `${day}`;
    prevMonth = m;

    annotations.push({
      x: d, y: 1.02, xref: 'x', yref: 'paper',
      text: label,
      showarrow: false,
      font: {
        size: showMonth ? 11 : 10,
        color,
        weight: (isHoliday || showMonth) ? 'bold' : 'normal',
      },
      xanchor: 'center',
    });
  }

  // ===== 业务窗口 shapes + 第一层：窗口名称标注（顶部）=====
  const shapes = [];

  for (const w of meta.business_windows || []) {
    if (w.start === 'auto' || !w.start || !w.end) continue;
    const color = WINDOW_COLORS[w.code] || 'rgba(148, 163, 184, 0.08)';
    const wStart = w.start < xDates[0] ? xDates[0] : w.start;
    const wEnd = w.end > xDates[xDates.length - 1] ? xDates[xDates.length - 1] : w.end;
    if (wStart > xDates[xDates.length - 1] || wEnd < xDates[0]) continue;
    const i0 = xDates.findIndex(d => d >= wStart);
    const i1 = xDates.length - 1 - [...xDates].reverse().findIndex(d => d <= wEnd);
    if (i0 === -1 || i1 === -1 || i0 > i1) continue;
    shapes.push({
      type: 'rect', xref: 'x', yref: 'paper',
      x0: i0 - 0.5, x1: i1 + 0.5, y0: 0, y1: 1,
      fillcolor: color, line: { width: 0 }, layer: 'below',
    });
    const borderColor = color.replace(/[\d.]+\)$/, '0.35)');
    shapes.push(
      { type: 'line', xref: 'x', yref: 'paper', x0: i0 - 0.5, x1: i0 - 0.5, y0: 0, y1: 1, line: { color: borderColor, width: 1.5, dash: 'dot' }, layer: 'below' },
      { type: 'line', xref: 'x', yref: 'paper', x0: i1 + 0.5, x1: i1 + 0.5, y0: 0, y1: 1, line: { color: borderColor, width: 1.5, dash: 'dot' }, layer: 'below' },
    );
    const midIdx = Math.round((i0 + i1) / 2);
    annotations.push({
      x: midIdx, y: 1.10, xref: 'x', yref: 'paper',
      text: `${w.emoji || ''} ${w.name_zh}`,
      showarrow: false,
      font: { size: 13, color: '#334155', weight: 'bold' },
      xanchor: 'center',
    });
  }

  // 国家分隔线
  let prevGroup = null;
  for (let i = 0; i < sortedCities.length; i++) {
    const group = sortedCities[i].country_group;
    if (prevGroup && group !== prevGroup) {
      shapes.push({
        type: 'line', xref: 'paper', yref: 'y',
        x0: 0, x1: 1, y0: i - 0.5, y1: i - 0.5,
        line: { color: '#cbd5e1', width: 1, dash: 'dot' },
        layer: 'above',
      });
    }
    prevGroup = group;
  }

  // ===== Trace + Layout =====
  const trace = {
    type: 'heatmap', x: xDates, y: yLabels, z, customdata, text,
    hovertemplate: '%{text}<extra></extra>',
    colorscale: HEAT_COLORSCALE, zmin: 0, zmax: 100,
    xgap: 0, ygap: 1,
    colorbar: {
      title: { text: '热度', font: { color: '#64748b', size: 12 } },
      tickfont: { color: '#64748b', size: 11 },
      thickness: 14, len: 0.75,
    },
  };

  const layout = {
    autosize: true,
    height: Math.max(500, cities.length * 32 + 200),
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    margin: { l: 120, r: 40, t: 140, b: 20 },
    xaxis: {
      type: 'category',
      side: 'top',
      showticklabels: false,
      showgrid: false, showline: true, linecolor: '#e5e7eb',
    },
    yaxis: {
      tickfont: { color: '#334155', size: 13 },
      showgrid: false, autorange: 'reversed',
    },
    annotations,
    shapes,
  };

  Plotly.newPlot(target, [trace], layout, { displayModeBar: false, responsive: true });

  target.on('plotly_click', (ev) => {
    const pt = ev.points?.[0];
    if (!pt?.customdata) return;
    jumpToDrilldown(pt.customdata[0], pt.customdata[1]);
  });
}

function formatHover(cityCode, date, row, detailIndex, eventIndex) {
  const displayHeat = row.bh != null ? row.bh : row.heat;
  const dt = new Date(date);
  const dow = ['日', '一', '二', '三', '四', '五', '六'][dt.getDay()];

  let t = `<b>${cityNameZh(cityCode)}</b> · ${date} (周${dow})<br>`;

  if (row.bh != null) {
    t += `热度 <b>${row.bh}</b>`;
    if (row.heat != null) t += ` (原始 ${row.heat})`;
  } else if (row.heat != null) {
    t += `热度 <b>${row.heat}</b>`;
  }
  t += '<br>';

  const detail = detailIndex[`${cityCode}|${date}`];
  if (detail && detail.total > 0) {
    const parts = [];
    if (detail.up > 0) parts.push(`${detail.up} 家涨价`);
    if (detail.down > 0) parts.push(`${detail.down} 家降价`);
    if (detail.flat > 0) parts.push(`${detail.flat} 家持平`);
    t += `📊 ${detail.total} 家酒店：${parts.join(' / ')}<br>`;
    if (detail.soldOut > 0) t += `⚠️ ${detail.soldOut} 家售罄<br>`;
  } else if (row.n != null) {
    t += `酒店数 ${row.n}<br>`;
  }

  if (row.so != null && row.so > 0) t += `售罄率 ${(row.so * 100).toFixed(0)}%<br>`;

  if (displayHeat >= HIGH_HEAT_THRESHOLD) {
    if (row.strk > 0) t += `🔥 连续 ${row.strk} 次采集高热<br>`;
    const events = eventIndex[`${cityCode}|${date}`];
    if (events && events.length > 0) {
      t += `💡 可能原因：${events.join('、')}<br>`;
    }
  }

  if (row.conf) t += `置信度 ${({high:'高',mid:'中',low:'低'})[row.conf] || row.conf}`;

  return t;
}
