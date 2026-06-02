/**
 * 🔍 单点钻取 tab
 *
 * 复刻 Streamlit「事实先行」三段式：
 *   1. 文字事实（涨价家数 / 平均涨幅 / 售罄数）
 *   2. 价格明细表（按涨幅 DESC）
 *   3. ⚙ 算法细节（折叠：A/B/C 拆解）
 */

import { state, cityNameZh, fmtPct, fmtCNY } from '../main.js';

let pendingPrefill = null;   // 跨 tab 跳转预填

export function prefillDrilldown(cityCode, checkinDate) {
  pendingPrefill = { cityCode, checkinDate };
}

export function renderDrilldown(s) {
  const { meta, currentSnapshot } = s;
  const citySel = document.getElementById('drilldown-city');
  const ciSel = document.getElementById('drilldown-checkin');

  // 填充 city options（仅有数据的城市）
  const citiesWithHeat = Object.keys(currentSnapshot.city_heat || {});
  citySel.innerHTML = citiesWithHeat
    .map((c) => `<option value="${c}">${cityNameZh(c)}</option>`)
    .join('');

  // 应用预填
  if (pendingPrefill) {
    citySel.value = pendingPrefill.cityCode;
  }

  fillCheckinOptions(citySel.value);
  if (pendingPrefill) {
    ciSel.value = pendingPrefill.checkinDate;
    pendingPrefill = null;
  }

  citySel.onchange = () => {
    fillCheckinOptions(citySel.value);
    drawDetails(citySel.value, ciSel.value);
  };
  ciSel.onchange = () => drawDetails(citySel.value, ciSel.value);

  drawDetails(citySel.value, ciSel.value);

  function fillCheckinOptions(cityCode) {
    const heatRows = currentSnapshot.city_heat[cityCode] || [];
    ciSel.innerHTML = heatRows
      .map((r) => `<option value="${r.ci}">${r.ci}</option>`)
      .join('');
  }

  function drawDetails(cityCode, checkinDate) {
    const target = document.getElementById('drilldown-content');

    // 拿当前 snapshot 里 (city, ckin) 的酒店明细
    const details = currentSnapshot.hotel_details.filter(
      (d) => d.city === cityCode && d.ci === checkinDate
    );

    // 拿对应 city_heat 行
    const heatRow = (currentSnapshot.city_heat[cityCode] || [])
      .find((r) => r.ci === checkinDate);

    if (details.length === 0 || !heatRow) {
      target.innerHTML = `
        <div class="error-msg">
          ${cityNameZh(cityCode)} · ${checkinDate} 没有数据
        </div>`;
      return;
    }

    // 排序：按 delta 降序（涨幅最大在前）
    details.sort((a, b) => (b.delta ?? -99) - (a.delta ?? -99));

    // 事实统计
    const deltas = details.filter((d) => d.delta != null && d.status === 'ok').map((d) => d.delta);
    const upCount = deltas.filter((x) => x > 0).length;
    const total = details.filter((d) => d.status === 'ok').length;
    const avgDelta = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
    const maxDelta = deltas.length ? Math.max(...deltas) : 0;
    const soldOut = details.filter((d) => d.so).length;
    const notListed = details.filter((d) => d.status === 'not_listed').length;
    const outliers = details.filter((d) => d.out).length;

    // 渲染：事实卡 → 表格 → 算法折叠
    target.innerHTML = `
      <div class="facts-card">
        <h3>📊 这个分数的来源</h3>
        <ul>
          <li><span class="em">${upCount}/${total}</span> 家基准酒店当日房价高于淡季中位</li>
          <li>平均涨幅 <span class="em">${fmtPct(avgDelta)}</span> · 最大涨幅 <span class="em">${fmtPct(maxDelta)}</span></li>
          <li>稀缺：<span class="em">${soldOut}</span> 家售罄 · <span class="em">${notListed}</span> 家未上架${outliers ? ` · <span class="em">${outliers}</span> 家被识别为极端高价` : ''}</li>
          <li>热度 <span class="em">${heatRow.heat}</span></li>
        </ul>
      </div>

      <h3 style="margin: 1.2rem 0 0.5rem; font-size: 1rem; color:#fafafa;">
        🏨 价格明细（按涨幅降序）
      </h3>
      ${renderDetailsTable(details)}

      <details class="collapse">
        <summary>⚙ 算法细节</summary>
        <pre style="color:#8b95a6; font-size:0.8rem; line-height:1.5; white-space:pre-wrap;">heat_score 三段式（A 价格水平 + B 库存稀缺 + C 涨价斜率）：
A 价格水平 (price_level)：${heatRow.lvl ?? '—'}
B 售罄率 (sold_out_ratio)：${heatRow.so == null ? '—' : (heatRow.so * 100).toFixed(0) + '%'}
C 最近斜率 (recent_slope)：${heatRow.slope ?? '—'}

A 维剔除：z_MAD &gt; 4 且 |delta| &gt; 30% → 视为统计异常，不计入 A
Tier 2 极端：delta &gt; 300% 或 z_MAD &gt; 10 → A 维剔除 + B 维计入售罄
            （业务上"挂高价防拍 / 只剩贵房"= 库存级售罄）</pre>
      </details>
    `;
  }
}

function renderDetailsTable(details) {
  const rows = details.map((d) => {
    const hotel = (state.meta?.hotels || []).find((h) => h.id === d.hid);
    const name = hotel ? (hotel.name_zh || hotel.name_en) : d.hid;
    const deltaCls = d.delta == null ? '' : d.delta > 0 ? 'delta-up' : 'delta-down';
    const deltaTxt = d.delta == null ? '—' : (d.delta > 0 ? '+' : '') + fmtPct(d.delta);
    const tags = [];
    if (d.so) tags.push('<span class="tag tag-sold-out">售罄</span>');
    if (d.status === 'not_listed') tags.push('<span class="tag tag-not-listed">未上架</span>');
    if (d.out) tags.push('<span class="tag tag-outlier">异常</span>');
    return `
      <tr>
        <td>${escapeHTML(name)}</td>
        <td>${fmtCNY(d.price)}</td>
        <td>${fmtCNY(d.p50)}</td>
        <td class="${deltaCls}">${deltaTxt}</td>
        <td>${tags.join(' ') || '—'}</td>
      </tr>`;
  }).join('');

  return `
    <table class="data-table">
      <thead>
        <tr><th>酒店</th><th>当前价</th><th>淡季中位</th><th>涨幅</th><th>状态</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
