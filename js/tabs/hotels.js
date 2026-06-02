/**
 * 🏨 酒店清单 tab
 *
 * 列出 100/200 家基准酒店：city / name_zh / name_en / 淡季中位价
 */

import { cityNameZh, fmtCNY } from '../main.js';

export function renderHotels(state) {
  const { meta } = state;
  const target = document.getElementById('hotels-content');

  const hotels = meta.hotels || [];
  if (hotels.length === 0) {
    target.innerHTML = '<div class="error-msg">无酒店数据</div>';
    return;
  }

  // 按 city → tier → name 排序
  const sorted = [...hotels].sort((a, b) => {
    if (a.city !== b.city) return a.city.localeCompare(b.city);
    return (a.name_zh || '').localeCompare(b.name_zh || '');
  });

  // 简易筛选 input
  let html = `
    <div style="margin-bottom:0.8rem; display:flex; gap:0.6rem; align-items:center; flex-wrap:wrap;">
      <input id="hotel-filter" placeholder="按城市/酒店名搜索…"
             style="background:#161b22; border:1px solid #2a3142; border-radius:6px;
                    color:#fafafa; padding:0.45rem 0.7rem; font-size:0.9rem; min-width:240px;" />
      <span class="hint" id="hotel-count">共 ${sorted.length} 家</span>
    </div>
    <div id="hotels-table-wrap"></div>
  `;
  target.innerHTML = html;

  const renderTable = (filter) => {
    const filtered = filter
      ? sorted.filter((h) => {
          const f = filter.toLowerCase();
          return (
            (h.name_zh || '').toLowerCase().includes(f) ||
            (h.name_en || '').toLowerCase().includes(f) ||
            cityNameZh(h.city).toLowerCase().includes(f) ||
            (h.city || '').toLowerCase().includes(f)
          );
        })
      : sorted;
    document.getElementById('hotel-count').textContent = `显示 ${filtered.length} / ${sorted.length} 家`;

    const rows = filtered.map((h) => `
      <tr>
        <td>${cityNameZh(h.city)}</td>
        <td>${escapeHTML(h.name_zh || '')}</td>
        <td style="color:#8b95a6;">${escapeHTML(h.name_en || '')}</td>
        <td>${fmtCNY(h.p20)}</td>
        <td>${fmtCNY(h.p50)}</td>
      </tr>`).join('');

    document.getElementById('hotels-table-wrap').innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>城市</th>
            <th>酒店中文名</th>
            <th>英文名</th>
            <th>淡季 P20</th>
            <th>淡季 P50</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  };

  renderTable('');
  document.getElementById('hotel-filter').addEventListener('input', (e) => {
    renderTable(e.target.value.trim());
  });
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
