/**
 * ✈ 机票价格 tab
 *
 * 展示上海→各城的机票最低价走势 + 酒店热度交叉对比
 */

import { state, cityNameZh } from '../main.js';

const CITY_COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
];

let selectedCities = new Set();

export function renderFlights(s) {
  const target = document.getElementById('flights-content');
  if (!target) return;

  const { currentSnapshot, meta } = s;
  const flightData = currentSnapshot.flight_prices;

  if (!flightData || Object.keys(flightData).length === 0) {
    target.innerHTML = '<p style="color:#94a3b8;padding:20px 0;">本快照暂无机票数据。机票采集启用后将自动显示。</p>';
    return;
  }

  // 初始化默认选中城市
  const allCities = (meta?.cities || [])
    .filter(c => flightData[c.code]?.length > 0)
    .sort((a, b) => (a.outbound_rank || 99) - (b.outbound_rank || 99));

  if (selectedCities.size === 0) {
    for (const c of allCities.slice(0, 5)) selectedCities.add(c.code);
  }

  target.innerHTML = `
    <div style="margin-bottom:1rem;display:flex;flex-wrap:wrap;gap:6px;">
      ${allCities.map((c, i) => {
        const checked = selectedCities.has(c.code) ? 'checked' : '';
        const color = CITY_COLORS[i % CITY_COLORS.length];
        return `<label style="display:inline-flex;align-items:center;gap:3px;font-size:13px;color:#334155;cursor:pointer;padding:3px 8px;border-radius:6px;background:${checked ? color + '15' : '#f1f5f9'};border:1px solid ${checked ? color : '#e2e8f0'};">
          <input type="checkbox" class="flight-city-cb" value="${c.code}" ${checked} style="accent-color:${color};"> ${c.name_zh || c.code}
        </label>`;
      }).join('')}
    </div>
    <div id="flight-price-chart" style="width:100%;"></div>
    <h3 style="margin:1.5rem 0 0.8rem;font-size:16px;color:#0f172a;">酒店热度 vs 机票价格</h3>
    <div id="flight-cross-chart" style="width:100%;"></div>
    <h3 style="margin:1.5rem 0 0.8rem;font-size:16px;color:#0f172a;">机票价格明细</h3>
    <div id="flight-detail-table" style="overflow-x:auto;"></div>
  `;

  target.querySelectorAll('.flight-city-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) selectedCities.add(cb.value);
      else selectedCities.delete(cb.value);
      drawPriceChart(allCities, flightData);
      drawCrossChart(allCities, flightData, currentSnapshot.city_heat);
      drawDetailTable(allCities, flightData);
    });
  });

  drawPriceChart(allCities, flightData);
  drawCrossChart(allCities, flightData, currentSnapshot.city_heat);
  drawDetailTable(allCities, flightData);
}

function drawPriceChart(allCities, flightData) {
  const chartDiv = document.getElementById('flight-price-chart');
  if (!chartDiv) return;

  const traces = [];
  let colorIdx = 0;

  for (const c of allCities) {
    const color = CITY_COLORS[colorIdx % CITY_COLORS.length];
    colorIdx++;
    if (!selectedCities.has(c.code)) continue;

    const rows = flightData[c.code] || [];
    if (rows.length === 0) continue;

    traces.push({
      x: rows.map(r => r.dep),
      y: rows.map(r => r.min),
      name: `${c.name_zh || c.code} 最低价`,
      type: 'scatter',
      mode: 'lines+markers',
      line: { color, width: 2 },
      marker: { size: 5 },
      text: rows.map(r => {
        let t = `${c.name_zh} · ${r.dep}<br>最低价: ¥${r.min}`;
        if (r.direct) t += `<br>直飞: ¥${r.direct}`;
        if (r.airline) t += `<br>航司: ${r.airline}`;
        if (r.cnt) t += `<br>航班数: ${r.cnt}`;
        return t;
      }),
      hovertemplate: '%{text}<extra></extra>',
    });
  }

  if (traces.length === 0) {
    chartDiv.innerHTML = '<p style="color:#94a3b8;text-align:center;padding:40px 0;">请选择城市</p>';
    return;
  }

  Plotly.newPlot(chartDiv, traces, {
    autosize: true, height: 380,
    paper_bgcolor: '#fff', plot_bgcolor: '#fff',
    margin: { l: 60, r: 30, t: 30, b: 50 },
    xaxis: {
      title: { text: '出发日', font: { color: '#64748b', size: 12 } },
      tickfont: { color: '#334155', size: 11 },
      showgrid: true, gridcolor: '#f1f5f9',
    },
    yaxis: {
      title: { text: '机票最低价 (CNY)', font: { color: '#64748b', size: 12 } },
      tickfont: { color: '#334155', size: 11 },
      showgrid: true, gridcolor: '#f1f5f9',
    },
    legend: { orientation: 'h', y: -0.2, font: { size: 12 } },
    hovermode: 'x unified',
  }, { displayModeBar: false, responsive: true });
}

function drawCrossChart(allCities, flightData, cityHeat) {
  const chartDiv = document.getElementById('flight-cross-chart');
  if (!chartDiv || !cityHeat) return;

  // 取第一个选中的城市做双轴对比
  const firstCity = allCities.find(c => selectedCities.has(c.code));
  if (!firstCity) {
    chartDiv.innerHTML = '<p style="color:#94a3b8;text-align:center;padding:40px 0;">请选择城市</p>';
    return;
  }

  const cc = firstCity.code;
  const flights = flightData[cc] || [];
  const heats = cityHeat[cc] || [];

  if (flights.length === 0) {
    chartDiv.innerHTML = `<p style="color:#94a3b8;text-align:center;padding:20px 0;">${firstCity.name_zh} 无机票数据</p>`;
    return;
  }

  const traces = [
    {
      x: heats.map(r => r.ci),
      y: heats.map(r => r.bh ?? r.heat),
      name: '酒店热度',
      type: 'scatter',
      mode: 'lines',
      line: { color: '#f97316', width: 2.5 },
      yaxis: 'y',
    },
    {
      x: flights.map(r => r.dep),
      y: flights.map(r => r.min),
      name: '机票最低价',
      type: 'scatter',
      mode: 'lines+markers',
      line: { color: '#3b82f6', width: 2 },
      marker: { size: 4 },
      yaxis: 'y2',
    },
  ];

  Plotly.newPlot(chartDiv, traces, {
    autosize: true, height: 350,
    paper_bgcolor: '#fff', plot_bgcolor: '#fff',
    margin: { l: 60, r: 60, t: 40, b: 50 },
    title: { text: `${firstCity.name_zh}：酒店热度 vs 机票价格`, font: { size: 14, color: '#334155' } },
    xaxis: { tickfont: { size: 11 }, showgrid: true, gridcolor: '#f1f5f9' },
    yaxis: {
      title: { text: '酒店热度', font: { color: '#f97316', size: 12 } },
      tickfont: { color: '#f97316', size: 11 },
      range: [0, 100], showgrid: true, gridcolor: '#f1f5f9',
    },
    yaxis2: {
      title: { text: '机票最低价 (CNY)', font: { color: '#3b82f6', size: 12 } },
      tickfont: { color: '#3b82f6', size: 11 },
      overlaying: 'y', side: 'right',
    },
    legend: { orientation: 'h', y: -0.2, font: { size: 12 } },
  }, { displayModeBar: false, responsive: true });
}

function drawDetailTable(allCities, flightData) {
  const tableDiv = document.getElementById('flight-detail-table');
  if (!tableDiv) return;

  const selected = allCities.filter(c => selectedCities.has(c.code));
  if (selected.length === 0) {
    tableDiv.innerHTML = '<p style="color:#94a3b8;">请选择城市</p>';
    return;
  }

  // 取所有出发日期
  const allDeps = new Set();
  for (const c of selected) {
    for (const r of (flightData[c.code] || [])) allDeps.add(r.dep);
  }
  const depDates = [...allDeps].sort();

  if (depDates.length === 0) {
    tableDiv.innerHTML = '<p style="color:#94a3b8;">无机票数据</p>';
    return;
  }

  // 只显示部分日期（每周一个采样）
  const sampleDates = depDates.filter((d, i) => i % 7 === 0 || i === depDates.length - 1);

  const header = `<thead><tr>
    <th style="position:sticky;left:0;background:#fff;z-index:1;">城市</th>
    ${sampleDates.map(d => `<th>${d.substring(5)}</th>`).join('')}
  </tr></thead>`;

  const rows = selected.map(c => {
    const rowMap = new Map((flightData[c.code] || []).map(r => [r.dep, r]));
    const cells = sampleDates.map(d => {
      const r = rowMap.get(d);
      if (!r) return '<td>—</td>';
      const direct = r.direct ? `<br><span style="color:#64748b;font-size:11px;">直飞¥${r.direct}</span>` : '';
      return `<td style="font-variant-numeric:tabular-nums;">¥${r.min}${direct}</td>`;
    }).join('');
    return `<tr>
      <td style="position:sticky;left:0;background:#fff;z-index:1;font-weight:600;">${c.name_zh || c.code}</td>
      ${cells}
    </tr>`;
  }).join('');

  tableDiv.innerHTML = `<table class="data-table" style="font-size:13px;">${header}<tbody>${rows}</tbody></table>`;
}
