/**
 * ⚙ 数据健康 tab
 *
 * 展示 FlyAI 调用健康度 + 当前 snapshot 的成功率/异常分布
 */

import { fmtPct } from '../main.js';

export function renderDataHealth(state) {
  const { currentSnapshot } = state;
  const target = document.getElementById('data-health-content');
  const { api_health, hotel_details, kpi } = currentSnapshot;

  // ----- 1. API 调用健康度 -----
  const apiRows = Object.entries(api_health || {}).map(([source, m]) => {
    const successRate = m.total ? m.success / m.total : null;
    return `
      <tr>
        <td><b>${source}</b></td>
        <td>${m.total ?? '—'}</td>
        <td style="color:#4caf50;">${m.success ?? '—'}</td>
        <td style="color:#ff6b6b;">${m.failed ?? 0}</td>
        <td>${m.rate_limited ?? 0}</td>
        <td>${m.mismatch ?? 0}</td>
        <td>${m.avg_latency != null ? m.avg_latency + ' ms' : '—'}</td>
        <td><b>${successRate != null ? fmtPct(successRate) : '—'}</b></td>
      </tr>`;
  }).join('');

  // ----- 2. 当前 snapshot 数据完整度 -----
  const total = hotel_details.length;
  const ok = hotel_details.filter((d) => d.status === 'ok').length;
  const soldOut = hotel_details.filter((d) => d.status === 'sold_out').length;
  const notListed = hotel_details.filter((d) => d.status === 'not_listed').length;
  const outliers = hotel_details.filter((d) => d.out).length;

  const breakdown = [
    { label: '正常', value: ok, color: '#4caf50' },
    { label: '售罄', value: soldOut, color: '#ffc107' },
    { label: '未上架', value: notListed, color: '#8b95a6' },
  ];

  // ----- 渲染 -----
  target.innerHTML = `
    <h3 style="margin-bottom:0.8rem; font-size:1rem; color:#fafafa;">📡 API 调用健康度</h3>
    ${apiRows ? `
      <table class="data-table">
        <thead><tr>
          <th>数据源</th><th>总量</th><th>成功</th><th>失败</th>
          <th>限流</th><th>错配</th><th>平均延迟</th><th>成功率</th>
        </tr></thead>
        <tbody>${apiRows}</tbody>
      </table>
    ` : '<p class="hint">本快照无 API 健康记录</p>'}

    <h3 style="margin: 1.5rem 0 0.8rem; font-size:1rem; color:#fafafa;">📊 数据完整度</h3>
    <div class="kpi-bar" style="padding:0;">
      <div class="kpi-card"><span class="kpi-label">总记录</span><span class="kpi-value">${total}</span></div>
      <div class="kpi-card"><span class="kpi-label">正常</span><span class="kpi-value" style="color:#4caf50;">${ok}</span></div>
      <div class="kpi-card"><span class="kpi-label">售罄</span><span class="kpi-value" style="color:#ffc107;">${soldOut}</span></div>
      <div class="kpi-card"><span class="kpi-label">未上架</span><span class="kpi-value" style="color:#8b95a6;">${notListed}</span></div>
      <div class="kpi-card"><span class="kpi-label">极端高价</span><span class="kpi-value" style="color:#ff6b35;">${outliers}</span></div>
    </div>

    <h3 style="margin: 1.5rem 0 0.8rem; font-size:1rem; color:#fafafa;">🚦 状态分布</h3>
    ${renderBarChart(breakdown, total)}

    <details class="collapse" style="margin-top:1.5rem;">
      <summary>本快照 KPI 明细</summary>
      <pre style="color:#8b95a6; font-size:0.8rem; line-height:1.5; white-space:pre-wrap;">${JSON.stringify(kpi, null, 2)}</pre>
    </details>
  `;
}

function renderBarChart(items, total) {
  if (!total) return '<p class="hint">无数据</p>';
  return `
    <div style="display:flex; height:32px; border-radius:6px; overflow:hidden; background:#0a0d12;">
      ${items.map((it) => {
        const pct = total ? (it.value / total * 100).toFixed(1) : 0;
        return `<div style="background:${it.color}; width:${pct}%; display:flex; align-items:center; justify-content:center; color:#000; font-size:0.78rem; font-weight:500;"
                     title="${it.label} ${it.value} (${pct}%)">
          ${pct >= 5 ? `${it.label} ${pct}%` : ''}
        </div>`;
      }).join('')}
    </div>`;
}
