/**
 * 🎉 节假日窗口 tab
 *
 * 展示中国法定节假日 + 当地节假日期间的城市热度对比表
 */

import { cityNameZh, heatLevel } from '../main.js';

export function renderHolidays(state) {
  const { meta, currentSnapshot } = state;
  const target = document.getElementById('holidays-content');

  if (!currentSnapshot.city_heat || Object.keys(currentSnapshot.city_heat).length === 0) {
    target.innerHTML = `
      <div class="error-msg">本快照暂无 city_heat 数据</div>`;
    return;
  }

  const cnHolidays = (meta.holidays_cn || []).filter((w) => w.code !== 'all');
  const localHolidays = meta.holidays_local || [];

  // 中国节假日：每个 window 期间，每城市的平均热度
  const cnRows = cnHolidays.map((w) => {
    const cityHeats = computeCityHeatsForWindow(
      currentSnapshot.city_heat, w.start, w.end
    );
    return { window: w, cityHeats };
  });

  let html = `
    <h3 style="margin-bottom:0.6rem; font-size:1rem; color:#fafafa;">📅 中国节假日窗口</h3>
    <p class="hint" style="margin-bottom:0.8rem;">每个窗口期间的城市平均热度（取窗口内所有 checkin 的均值）</p>
    ${renderHolidaysTable(cnRows, currentSnapshot.city_heat)}

    <h3 style="margin: 1.5rem 0 0.6rem; font-size:1rem; color:#fafafa;">⭐ 当地节假日</h3>
    <p class="hint" style="margin-bottom:0.8rem;">影响境外特定城市的当地节庆</p>
    ${renderLocalHolidaysTable(localHolidays, currentSnapshot.city_heat)}
  `;

  target.innerHTML = html;
}

function computeCityHeatsForWindow(cityHeat, startDate, endDate) {
  const out = {};
  for (const [city, rows] of Object.entries(cityHeat)) {
    const inWindow = rows.filter((r) => r.ci >= startDate && r.ci <= endDate && r.heat != null);
    if (inWindow.length === 0) continue;
    const avg = inWindow.reduce((a, b) => a + b.heat, 0) / inWindow.length;
    out[city] = { avg, count: inWindow.length };
  }
  return out;
}

function renderHolidaysTable(rows, cityHeat) {
  if (rows.length === 0) return '<p class="hint">无节假日数据</p>';

  // 取所有出现过的城市（按平均热度降序）
  const allCities = new Set();
  for (const r of rows) for (const c of Object.keys(r.cityHeats)) allCities.add(c);
  const sortedCities = [...allCities].sort((a, b) => {
    const aH = (cityHeat[a] || []).filter((r) => r.heat != null);
    const bH = (cityHeat[b] || []).filter((r) => r.heat != null);
    const aAvg = aH.length ? aH.reduce((s, r) => s + r.heat, 0) / aH.length : 0;
    const bAvg = bH.length ? bH.reduce((s, r) => s + r.heat, 0) / bH.length : 0;
    return bAvg - aAvg;
  });

  const head = `
    <thead>
      <tr>
        <th>节假日窗口</th>
        <th>日期</th>
        ${sortedCities.map((c) => `<th>${cityNameZh(c)}</th>`).join('')}
      </tr>
    </thead>`;
  const body = rows.map((r) => {
    const cells = sortedCities.map((c) => {
      const v = r.cityHeats[c]?.avg;
      if (v == null) return '<td>—</td>';
      const lvl = heatLevel(v);
      return `<td class="lvl-${lvl}">${v.toFixed(1)}</td>`;
    }).join('');
    return `
      <tr>
        <td><b>${r.window.name_zh}</b></td>
        <td>${r.window.start} ~ ${r.window.end}</td>
        ${cells}
      </tr>`;
  }).join('');

  return `<table class="data-table">${head}<tbody>${body}</tbody></table>`;
}

function renderLocalHolidaysTable(holidays, cityHeat) {
  if (holidays.length === 0) return '<p class="hint">无当地节假日数据</p>';

  const rows = holidays.map((h) => {
    const heats = h.affects.map((c) => {
      const ch = cityHeat[c];
      const r = ch?.find((x) => x.ci === h.date);
      return { city: c, heat: r?.heat };
    }).filter((x) => x.heat != null);
    return { ...h, heats };
  });

  const html = rows.map((h) => {
    if (h.heats.length === 0) {
      return `<tr><td><b>${h.name_zh}</b></td><td>${h.date}</td><td colspan="2" class="hint">该日期不在数据范围内</td></tr>`;
    }
    return h.heats.map((x, i) => {
      const lvl = heatLevel(x.heat);
      return `
        <tr>
          ${i === 0 ? `<td rowspan="${h.heats.length}"><b>${h.name_zh}</b></td><td rowspan="${h.heats.length}">${h.date}</td>` : ''}
          <td>${cityNameZh(x.city)}</td>
          <td class="lvl-${lvl}">${x.heat.toFixed(1)}</td>
        </tr>`;
    }).join('');
  }).join('');

  return `
    <table class="data-table">
      <thead><tr><th>节假日</th><th>日期</th><th>影响城市</th><th>热度</th></tr></thead>
      <tbody>${html}</tbody>
    </table>`;
}
