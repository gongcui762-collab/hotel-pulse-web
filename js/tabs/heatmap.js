/**
 * 🗺 热度地图（v2 浅色主题版）
 * 全宽 + 白底 + 更大字号 tick + 色块连贯
 */

import { cityNameZh, heatLevel, jumpToDrilldown } from '../main.js';

const HEAT_COLORSCALE = [
  [0.00, '#dbeafe'],   // 浅蓝（冷）
  [0.35, '#60a5fa'],   // 蓝
  [0.50, '#34d399'],   // 绿
  [0.65, '#fbbf24'],   // 黄
  [0.80, '#f97171'],   // 橙红
  [1.00, '#dc2626'],   // 深红（烫）
];

export function renderHeatmap(state) {
  const { meta, currentSnapshot } = state;
  const { city_heat } = currentSnapshot;
  const target = document.getElementById('heatmap-plot');

  if (!city_heat || Object.keys(city_heat).length === 0) {
    target.innerHTML = `<div class="error-msg">本快照暂无 city_heat 数据</div>`;
    return;
  }

  // 按 outbound_rank 排序城市
  const rankedCities = (meta.cities || [])
    .filter(c => city_heat[c.code])
    .sort((a, b) => (a.outbound_rank || 99) - (b.outbound_rank || 99));
  const cities = rankedCities.map(c => c.code);
  const yLabels = rankedCities.map(c => c.name_zh || c.code);

  // 所有 checkin 日期
  const allDates = new Set();
  for (const c of cities) for (const r of city_heat[c]) allDates.add(r.ci);
  const xDates = [...allDates].sort();

  // z 矩阵 + forward-fill
  const z = [], customdata = [], text = [];
  for (const c of cities) {
    const cityMap = new Map((city_heat[c] || []).map(r => [r.ci, r]));
    const row = [], cdRow = [], txtRow = [];
    let lastHeat = null;
    for (const d of xDates) {
      const r = cityMap.get(d);
      // 优先用 blended_heat（bh），fallback 到 heat
      const heatVal = r ? (r.bh != null ? r.bh : r.heat) : null;
      if (r && heatVal != null) {
        lastHeat = heatVal;
        row.push(heatVal);
        txtRow.push(formatHover(c, d, r));
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

  // 节假日标注
  const annotations = [];
  for (const w of meta.holidays_cn || []) {
    if (xDates.includes(w.start)) {
      annotations.push({
        x: w.start, y: 1.04, xref: 'x', yref: 'paper',
        text: `📅 ${w.name_zh}`, showarrow: false,
        font: { size: 11, color: '#dc2626' }, xanchor: 'left',
      });
    }
  }
  // 当地节假日 ⭐
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

  // tick annotations（周末/节假日色编码）
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
      x: d, y: -0.04, xref: 'x', yref: 'paper',
      text: dow === 1 ? `${m}/${day}` : `${day}`,
      showarrow: false, font: { color, size: 11, weight: isH ? 'bold' : 'normal' },
      xanchor: 'center',
    });
  }

  const trace = {
    type: 'heatmap', x: xDates, y: yLabels, z, customdata, text,
    hovertemplate: '%{text}<br>热度 %{z}<extra></extra>',
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
    height: Math.max(500, cities.length * 32 + 140),
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    margin: { l: 100, r: 40, t: 60, b: 50 },
    xaxis: {
      type: 'category',
      tickfont: { size: 0, color: 'rgba(0,0,0,0)' },
      showgrid: false, showline: true, linecolor: '#e5e7eb',
    },
    yaxis: {
      tickfont: { color: '#334155', size: 13 },
      showgrid: false, autorange: 'reversed',
    },
    annotations,
  };

  Plotly.newPlot(target, [trace], layout, { displayModeBar: false, responsive: true });

  target.on('plotly_click', (ev) => {
    const pt = ev.points?.[0];
    if (!pt?.customdata) return;
    jumpToDrilldown(pt.customdata[0], pt.customdata[1]);
  });
}

function formatHover(cityCode, date, row) {
  const displayHeat = row.bh != null ? row.bh : row.heat;
  const lvl = heatLevel(displayHeat);
  const emoji = { blue: '🔵', green: '🟢', yellow: '🟡', red: '🔴', na: '⚫' }[lvl];
  const dt = new Date(date);
  const dow = ['日', '一', '二', '三', '四', '五', '六'][dt.getDay()];
  let t = `<b>${cityNameZh(cityCode)}</b><br>${date} (周${dow}) ${emoji}<br>`;
  if (row.bh != null) t += `融合热度 ${row.bh}`;
  if (row.heat != null && row.bh != null) t += ` (原始 ${row.heat})`;
  t += '<br>';
  if (row.strk > 0) t += `🔥 连续 ${row.strk} 次高热<br>`;
  if (row.conf) t += `置信度 ${({high:'高',mid:'中',low:'低'})[row.conf] || row.conf}<br>`;
  if (row.lvl != null) t += `价格水平 ${row.lvl}<br>`;
  if (row.so != null && row.so > 0) t += `售罄率 ${(row.so * 100).toFixed(0)}%<br>`;
  if (row.n != null) t += `酒店数 ${row.n}`;
  return t;
}
