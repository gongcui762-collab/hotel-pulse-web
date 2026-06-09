/**
 * 📈 历史趋势 tab
 *
 * 加载所有 snapshot 数据，展示城市热度的跨 snapshot 变化：
 *   1. 折线图：选定城市在各采集日的平均热度
 *   2. 环比变化表：每城市每 snapshot 的热度 + delta
 */

import { state, cityNameZh } from '../main.js';

const CITY_COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
  '#84cc16', '#e11d48', '#0ea5e9', '#d946ef', '#78716c',
];

let allSnapshotsCache = null;
let selectedCities = new Set();
let isLoading = false;

export async function renderHistory(s) {
  const target = document.getElementById('history-content');
  if (!target) return;

  // 惰性加载：首次切到这个 tab 时才加载全部 snapshot
  if (!allSnapshotsCache && !isLoading) {
    isLoading = true;
    target.innerHTML = '<p style="color:#94a3b8;padding:20px 0;">加载历史数据中...</p>';
    try {
      allSnapshotsCache = await loadAllSnapshots(s);
    } catch (e) {
      target.innerHTML = `<div class="error-msg">加载历史数据失败：${e.message}</div>`;
      isLoading = false;
      return;
    }
    isLoading = false;
  }

  if (!allSnapshotsCache || allSnapshotsCache.length === 0) {
    target.innerHTML = '<p style="color:#94a3b8;padding:20px 0;">暂无足够的历史数据</p>';
    return;
  }

  // 初始化默认选中城市（outbound_rank 前 5）
  if (selectedCities.size === 0) {
    const ranked = (s.meta?.cities || [])
      .filter(c => allSnapshotsCache.some(snap => snap.data.city_heat?.[c.code]))
      .sort((a, b) => (a.outbound_rank || 99) - (b.outbound_rank || 99));
    for (const c of ranked.slice(0, 5)) selectedCities.add(c.code);
  }

  // 渲染
  const allCities = (s.meta?.cities || [])
    .filter(c => allSnapshotsCache.some(snap => snap.data.city_heat?.[c.code]))
    .sort((a, b) => (a.outbound_rank || 99) - (b.outbound_rank || 99));

  target.innerHTML = `
    <div class="history-controls" style="margin-bottom:1rem;display:flex;flex-wrap:wrap;gap:6px;">
      ${allCities.map((c, i) => {
        const checked = selectedCities.has(c.code) ? 'checked' : '';
        const color = CITY_COLORS[i % CITY_COLORS.length];
        return `<label style="display:inline-flex;align-items:center;gap:3px;font-size:13px;color:#334155;cursor:pointer;padding:3px 8px;border-radius:6px;background:${checked ? color + '15' : '#f1f5f9'};border:1px solid ${checked ? color : '#e2e8f0'};">
          <input type="checkbox" value="${c.code}" ${checked} style="accent-color:${color};"> ${c.name_zh || c.code}
        </label>`;
      }).join('')}
    </div>
    <div id="history-line-chart" style="width:100%;"></div>
    <h3 style="margin:1.5rem 0 0.8rem;font-size:16px;color:#0f172a;">环比变化表</h3>
    <div id="history-delta-table" style="overflow-x:auto;"></div>
  `;

  // checkbox 事件
  target.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) selectedCities.add(cb.value);
      else selectedCities.delete(cb.value);
      drawChart(allCities);
      drawDeltaTable(allCities);
    });
  });

  drawChart(allCities);
  drawDeltaTable(allCities);
}

async function loadAllSnapshots(s) {
  const index = s.snapshotIndex;
  if (!index?.snapshots) return [];

  // 按日期升序排列，跳过明显不完整的 snapshot
  const validSnaps = index.snapshots
    .filter(snap => snap.cities > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const results = await Promise.all(
    validSnaps.map(async (snap) => {
      try {
        const res = await fetch(`./data/snapshots/${snap.date}.json`, { cache: 'no-cache' });
        if (!res.ok) return null;
        const data = await res.json();
        return { date: snap.date, data };
      } catch { return null; }
    })
  );

  return results.filter(Boolean);
}

function getWindowFilter() {
  const w = state.activeWindow;
  if (!w || w.start === 'auto') return () => true;
  return (ci) => ci >= w.start && ci <= w.end;
}

function computeCityAvgHeat(cityHeat, cityCode, windowFilter) {
  const rows = cityHeat?.[cityCode] || [];
  const inWindow = rows.filter(r => windowFilter(r.ci) && (r.bh != null || r.heat != null));
  if (inWindow.length === 0) return null;
  const avg = inWindow.reduce((sum, r) => sum + (r.bh ?? r.heat), 0) / inWindow.length;
  return Math.round(avg * 10) / 10;
}

function drawChart(allCities) {
  const chartDiv = document.getElementById('history-line-chart');
  if (!chartDiv || !allSnapshotsCache) return;

  const windowFilter = getWindowFilter();
  const xDates = allSnapshotsCache.map(s => s.date);
  const traces = [];

  let colorIdx = 0;
  for (const c of allCities) {
    const color = CITY_COLORS[colorIdx % CITY_COLORS.length];
    colorIdx++;
    if (!selectedCities.has(c.code)) continue;

    const yValues = allSnapshotsCache.map(snap =>
      computeCityAvgHeat(snap.data.city_heat, c.code, windowFilter)
    );

    // 计算环比
    const deltaTexts = yValues.map((v, i) => {
      if (v == null || i === 0 || yValues[i - 1] == null) return '';
      const d = v - yValues[i - 1];
      return `${d > 0 ? '+' : ''}${d.toFixed(1)}`;
    });

    traces.push({
      x: xDates,
      y: yValues,
      name: c.name_zh || c.code,
      type: 'scatter',
      mode: 'lines+markers',
      line: { color, width: 2.5 },
      marker: { size: 7 },
      text: yValues.map((v, i) => {
        if (v == null) return '';
        let t = `${c.name_zh} · ${xDates[i]}<br>平均热度: ${v}`;
        if (deltaTexts[i]) t += `<br>环比: ${deltaTexts[i]}`;
        return t;
      }),
      hovertemplate: '%{text}<extra></extra>',
      connectgaps: true,
    });
  }

  if (traces.length === 0) {
    chartDiv.innerHTML = '<p style="color:#94a3b8;text-align:center;padding:40px 0;">请选择至少一个城市</p>';
    return;
  }

  const layout = {
    autosize: true,
    height: 400,
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    margin: { l: 50, r: 30, t: 30, b: 50 },
    xaxis: {
      title: { text: '采集日', font: { color: '#64748b', size: 12 } },
      tickfont: { color: '#334155', size: 12 },
      showgrid: true, gridcolor: '#f1f5f9',
    },
    yaxis: {
      title: { text: '平均热度', font: { color: '#64748b', size: 12 } },
      tickfont: { color: '#334155', size: 12 },
      showgrid: true, gridcolor: '#f1f5f9',
      range: [0, 100],
    },
    legend: {
      orientation: 'h', y: -0.2,
      font: { size: 12, color: '#334155' },
    },
    hovermode: 'x unified',
  };

  Plotly.newPlot(chartDiv, traces, layout, { displayModeBar: false, responsive: true });
}

function drawDeltaTable(allCities) {
  const tableDiv = document.getElementById('history-delta-table');
  if (!tableDiv || !allSnapshotsCache) return;

  const windowFilter = getWindowFilter();
  const snapDates = allSnapshotsCache.map(s => s.date);
  const selected = allCities.filter(c => selectedCities.has(c.code));

  if (selected.length === 0) {
    tableDiv.innerHTML = '<p style="color:#94a3b8;">请选择城市</p>';
    return;
  }

  // 表头
  const latestDate = snapDates[snapDates.length - 1];
  const header = `<thead><tr>
    <th style="position:sticky;left:0;background:#fff;z-index:1;">城市</th>
    ${snapDates.map(d => `<th style="${d === latestDate ? 'background:#eff6ff;font-weight:700;' : ''}">${d.substring(5)}</th>`).join('')}
  </tr></thead>`;

  // 表体
  const rows = selected.map(c => {
    const heats = allSnapshotsCache.map(snap =>
      computeCityAvgHeat(snap.data.city_heat, c.code, windowFilter)
    );

    const cells = heats.map((h, i) => {
      if (h == null) return `<td style="${snapDates[i] === latestDate ? 'background:#eff6ff;' : ''}">—</td>`;
      let delta = '';
      let cls = '';
      if (i > 0 && heats[i - 1] != null) {
        const d = h - heats[i - 1];
        if (d > 0) { delta = ` <span style="color:#dc2626;font-size:11px;">+${d.toFixed(1)}</span>`; cls = ''; }
        else if (d < 0) { delta = ` <span style="color:#16a34a;font-size:11px;">${d.toFixed(1)}</span>`; cls = ''; }
      }
      const bg = snapDates[i] === latestDate ? 'background:#eff6ff;' : '';
      return `<td style="${bg}font-variant-numeric:tabular-nums;">${h}${delta}</td>`;
    }).join('');

    return `<tr>
      <td style="position:sticky;left:0;background:#fff;z-index:1;font-weight:600;">${c.name_zh || c.code}</td>
      ${cells}
    </tr>`;
  }).join('');

  tableDiv.innerHTML = `<table class="data-table" style="font-size:13px;">${header}<tbody>${rows}</tbody></table>`;
}
