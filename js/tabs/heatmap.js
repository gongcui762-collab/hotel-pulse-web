/**
 * 🗺 热度地图（v3 优化版）
 *
 * v3 改动：
 *   1. 时间轴移到上方（优先看高热目的地）
 *   2. 按国家一级归类 + 国旗前缀 + 分隔线
 *   3. 通用节假日不标星（端午/中秋/国庆等）
 *   4. hover 增强：高热（≥70）时显示酒店涨价详情 + 可能原因
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

// 国家组排列顺序（决定热度图 Y 轴分组顺序）
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

  // 所有 checkin 日期
  const allDates = new Set();
  for (const c of cities) for (const r of city_heat[c]) allDates.add(r.ci);
  const xDates = [...allDates].sort();

  // ===== 预计算酒店明细索引（供 hover 用） =====
  const detailIndex = {};  // {city_code+ci: {up, total, soldOut}}
  for (const d of currentSnapshot.hotel_details || []) {
    const key = `${d.city}|${d.ci}`;
    if (!detailIndex[key]) detailIndex[key] = { up: 0, total: 0, soldOut: 0 };
    if (d.status === 'ok' && !d.out) {
      detailIndex[key].total++;
      if (d.delta != null && d.delta > 0) detailIndex[key].up++;
    }
    if (d.so) detailIndex[key].soldOut++;
  }

  // ===== 事件索引（供 hover 高热原因推断） =====
  const eventIndex = {};  // {city_code+ci: [event_name, ...]}
  for (const h of meta.holidays_local || []) {
    for (const cc of h.affects) {
      const key = `${cc}|${h.date}`;
      if (!eventIndex[key]) eventIndex[key] = [];
      eventIndex[key].push(h.name_zh);
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
        txtRow.push(`${cityNameZh(c)}<br>${d}<br><i>(承继前采样日)</i>`);
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

  // 当地事件 ⭐（通用节假日已在后端过滤掉）
  for (const h of meta.holidays_local || []) {
    if (!xDates.includes(h.date)) continue;
    for (const cc of h.affects) {
      const yIdx = cities.indexOf(cc);
      if (yIdx === -1) continue;
      annotations.push({
        x: h.date, y: yIdx, text: '⭐', showarrow: false,
        font: { size: 14 }, hovertext: `${cityNameZh(cc)} · ${h.date} · ${h.name_zh}`,
      });
    }
  }

  // 时间轴 tick（放在底部，因为 xaxis 已移到 top）
  const holidaySet = new Set();
  for (const w of meta.holidays_cn || []) {
    let cur = new Date(w.start), end = new Date(w.end);
    while (cur <= end) { holidaySet.add(cur.toISOString().substring(0, 10)); cur.setDate(cur.getDate() + 1); }
  }
  for (const d of xDates) {
    const dt = new Date(d), dow = dt.getDay();
    const isH = holidaySet.has(d);
    let color = '#94a3b8';
    if (isH) color = '#dc2626';
    else if (dow === 6 || dow === 0) color = '#f59e0b';
    else if (dow === 5) color = '#d97706';
    if (dow !== 1 && dow !== 5 && dow !== 6 && dow !== 0 && !isH) continue;
    const m = dt.getMonth() + 1, day = dt.getDate();
    annotations.push({
      x: d, y: -0.03, xref: 'x', yref: 'paper',
      text: dow === 1 ? `${m}/${day}` : `${day}`,
      showarrow: false, font: { color, size: 11, weight: isH ? 'bold' : 'normal' },
      xanchor: 'center',
    });
  }

  // ===== 业务窗口高亮 shapes + 国家分隔线 =====
  const shapes = [];

  // 业务窗口
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
    // 窗口名称标注在顶部
    const midIdx = Math.round((i0 + i1) / 2);
    annotations.push({
      x: midIdx, y: 1.12, xref: 'x', yref: 'paper',
      text: `${w.emoji || ''} ${w.name_zh}`,
      showarrow: false,
      font: { size: 12, color: '#334155', weight: 'bold' },
      xanchor: 'center',
    });
  }

  // 节假日标注（中国法定假日在时间轴上方标注）
  for (const w of meta.holidays_cn || []) {
    if (xDates.includes(w.start)) {
      annotations.push({
        x: w.start, y: 1.07, xref: 'x', yref: 'paper',
        text: `📅 ${w.name_zh}`, showarrow: false,
        font: { size: 11, color: '#dc2626' }, xanchor: 'left',
      });
    }
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
    height: Math.max(500, cities.length * 32 + 160),
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    margin: { l: 120, r: 40, t: 90, b: 40 },
    xaxis: {
      type: 'category',
      side: 'top',
      tickfont: { size: 0, color: 'rgba(0,0,0,0)' },
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
  const lvl = heatLevel(displayHeat);
  const emoji = { blue: '🔵', green: '🟢', yellow: '🟡', red: '🔴', na: '⚫' }[lvl];
  const dt = new Date(date);
  const dow = ['日', '一', '二', '三', '四', '五', '六'][dt.getDay()];

  let t = `<b>${cityNameZh(cityCode)}</b> · ${date} (周${dow}) ${emoji}<br>`;

  // 热度
  if (row.bh != null) t += `融合热度 <b>${row.bh}</b>`;
  else if (row.heat != null) t += `热度 <b>${row.heat}</b>`;
  if (row.heat != null && row.bh != null) t += ` (原始 ${row.heat})`;
  t += '<br>';

  // ===== 高热区（≥70）：展示更多业务信息 =====
  if (displayHeat >= HIGH_HEAT_THRESHOLD) {
    // 连续高热
    if (row.strk > 0) t += `🔥 连续 ${row.strk} 次采集高热<br>`;

    // 酒店涨价详情
    const detail = detailIndex[`${cityCode}|${date}`];
    if (detail && detail.total > 0) {
      t += `📊 ${detail.up}/${detail.total} 家酒店涨价超淡季中位<br>`;
      if (detail.soldOut > 0) t += `⚠️ ${detail.soldOut} 家售罄<br>`;
    }

    // 可能原因（匹配事件知识库）
    const events = eventIndex[`${cityCode}|${date}`];
    if (events && events.length > 0) {
      t += `💡 可能原因：${events.join('、')}<br>`;
    }

    // 置信度
    if (row.conf) t += `置信度 ${({high:'高',mid:'中',low:'低'})[row.conf] || row.conf}<br>`;
  } else {
    // 非高热：简洁展示
    if (row.so != null && row.so > 0) t += `售罄率 ${(row.so * 100).toFixed(0)}%<br>`;
    if (row.n != null) t += `酒店数 ${row.n}`;
  }

  return t;
}
