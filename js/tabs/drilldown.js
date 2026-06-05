/**
 * 🔍 单点钻取（v2 浅色主题）
 * 事实先行 + 价格明细表 + 算法折叠
 */

import { state, cityNameZh, fmtPct, fmtCNY, hotelById } from '../main.js';

let pendingPrefill = null;

export function prefillDrilldown(cityCode, checkinDate) {
  pendingPrefill = { cityCode, checkinDate };
}

export function renderDrilldown(s) {
  const { meta, currentSnapshot } = s;
  const citySel = document.getElementById('drilldown-city');
  const ciSel = document.getElementById('drilldown-checkin');

  const citiesWithHeat = Object.keys(currentSnapshot.city_heat || {});
  if (citiesWithHeat.length === 0) {
    document.getElementById('drilldown-content').innerHTML =
      '<p style="color:#94a3b8;padding:20px 0;">本快照无 city_heat 数据</p>';
    return;
  }

  // 按 outbound_rank 排序
  const ranked = (meta.cities || [])
    .filter(c => citiesWithHeat.includes(c.code))
    .sort((a, b) => (a.outbound_rank || 99) - (b.outbound_rank || 99));

  citySel.innerHTML = ranked
    .map(c => `<option value="${c.code}">${c.name_zh}</option>`)
    .join('');

  if (pendingPrefill) citySel.value = pendingPrefill.cityCode;

  fillCheckinOptions(citySel.value);
  if (pendingPrefill) {
    ciSel.value = pendingPrefill.checkinDate;
    pendingPrefill = null;
  }

  citySel.onchange = () => { fillCheckinOptions(citySel.value); drawDetails(citySel.value, ciSel.value); };
  ciSel.onchange = () => drawDetails(citySel.value, ciSel.value);
  drawDetails(citySel.value, ciSel.value);

  function fillCheckinOptions(cityCode) {
    const heatRows = currentSnapshot.city_heat[cityCode] || [];
    ciSel.innerHTML = heatRows.map(r => `<option value="${r.ci}">${r.ci}</option>`).join('');
  }

  function drawDetails(cityCode, checkinDate) {
    const target = document.getElementById('drilldown-content');
    const details = currentSnapshot.hotel_details.filter(d => d.city === cityCode && d.ci === checkinDate);
    const heatRow = (currentSnapshot.city_heat[cityCode] || []).find(r => r.ci === checkinDate);

    if (details.length === 0 || !heatRow) {
      target.innerHTML = `<div class="error-msg">${cityNameZh(cityCode)} · ${checkinDate} 没有数据</div>`;
      return;
    }

    details.sort((a, b) => (b.delta ?? -99) - (a.delta ?? -99));

    const deltas = details.filter(d => d.delta != null && d.status === 'ok').map(d => d.delta);
    const upCount = deltas.filter(x => x > 0).length;
    const total = details.filter(d => d.status === 'ok').length;
    const avgDelta = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
    const maxDelta = deltas.length ? Math.max(...deltas) : 0;
    const soldOut = details.filter(d => d.so).length;
    const notListed = details.filter(d => d.status === 'not_listed').length;
    const outliers = details.filter(d => d.out).length;

    // 按 district 分组
    const byDistrict = {};
    for (const d of details) {
      const hotel = hotelById(d.hid);
      const dist = hotel?.district || '其他';
      (byDistrict[dist] = byDistrict[dist] || []).push(d);
    }

    target.innerHTML = `
      <div class="facts-card">
        <h3>📊 这个分数的来源</h3>
        <ul>
          <li><span class="em">${upCount}/${total}</span> 家基准酒店当日房价高于淡季中位</li>
          <li>平均涨幅 <span class="em ${avgDelta > 0 ? 'up' : ''}">${fmtPct(avgDelta)}</span>，最大涨幅 <span class="em up">${fmtPct(maxDelta)}</span></li>
          <li>稀缺：<span class="em">${soldOut}</span> 家售罄 · <span class="em">${notListed}</span> 家未上架${outliers ? ` · <span class="em">${outliers}</span> 家极端高价` : ''}</li>
          <li>热度 <span class="em">${heatRow.heat}</span></li>
        </ul>
      </div>

      <h3 style="margin:1.5rem 0 0.8rem;font-size:18px;color:#0f172a;">🏨 价格明细（按涨幅降序）</h3>

      ${Object.keys(byDistrict).length > 1 ? renderByDistrict(byDistrict) : renderDetailsTable(details)}

      <details class="collapse" style="margin-top:1.5rem;">
        <summary>⚙ 算法细节</summary>
        <div style="color:#64748b;font-size:13px;line-height:1.6;padding:8px 0;">
          <p>heat_score = 0.60×A + 0.25×B + 0.15×C</p>
          <p>A 价格水平 (price_level)：${heatRow.lvl ?? '—'}</p>
          <p>B 售罄率 (sold_out_ratio)：${heatRow.so == null ? '—' : (heatRow.so * 100).toFixed(0) + '%'}</p>
          <p>C 最近斜率 (recent_slope)：${heatRow.slope ?? '—'}</p>
          <p style="margin-top:8px;">异常剔除：z_MAD &gt; 4 且 |delta| &gt; 30% → A 维剔除<br>
          Tier 2 极端：delta &gt; 300% 或 z_MAD &gt; 10 → A 维剔除 + B 维计入售罄</p>
        </div>
      </details>`;
  }
}

function renderByDistrict(byDistrict) {
  return Object.entries(byDistrict).map(([dist, items]) => {
    items.sort((a, b) => (b.delta ?? -99) - (a.delta ?? -99));
    const upCnt = items.filter(d => d.delta != null && d.delta > 0).length;
    return `
      <details class="collapse" open style="margin-bottom:8px;">
        <summary style="font-size:15px;font-weight:600;color:#0f172a;">
          📍 ${dist} <span style="font-weight:400;color:#64748b;font-size:13px;">(${items.length} 家 · ${upCnt} 涨价)</span>
        </summary>
        <div style="padding-top:8px;">${renderDetailsTable(items)}</div>
      </details>`;
  }).join('');
}

function renderDetailsTable(details) {
  const rows = details.map(d => {
    const hotel = hotelById(d.hid);
    const name = hotel ? (hotel.name_zh || hotel.name_en) : d.hid;
    const deltaCls = d.delta == null ? '' : d.delta > 0 ? 'delta-up' : 'delta-down';
    const deltaTxt = d.delta == null ? '—' : (d.delta > 0 ? '+' : '') + fmtPct(d.delta);
    const tags = [];
    if (d.so) tags.push('<span class="tag priority-high" style="font-size:11px;">售罄</span>');
    if (d.status === 'not_listed') tags.push('<span class="tag" style="background:#f1f5f9;color:#64748b;font-size:11px;">未上架</span>');
    if (d.out) tags.push('<span class="tag priority-mid" style="font-size:11px;">异常</span>');
    return `<tr>
      <td>${esc(name)}</td>
      <td class="right">${fmtCNY(d.price)}</td>
      <td class="right">${fmtCNY(d.p50)}</td>
      <td class="right ${deltaCls}">${deltaTxt}</td>
      <td>${tags.join(' ') || '—'}</td>
    </tr>`;
  }).join('');

  return `<table class="data-table">
    <thead><tr><th>酒店</th><th class="right">当前价</th><th class="right">淡季中位</th><th class="right">涨幅</th><th>状态</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
