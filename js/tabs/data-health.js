/**
 * ⚙ 数据健康（v2 浅色主题）
 */

import { fmtPct } from '../main.js';

export function renderDataHealth(state) {
  const { currentSnapshot } = state;
  const target = document.getElementById('data-health-content');
  const { api_health, hotel_details, kpi } = currentSnapshot;

  const apiRows = Object.entries(api_health || {}).map(([src, m]) => {
    const rate = m.total ? m.success / m.total : null;
    return `<tr>
      <td><strong>${src}</strong></td>
      <td class="right">${m.total ?? '—'}</td>
      <td class="right" style="color:#059669;">${m.success ?? '—'}</td>
      <td class="right" style="color:#dc2626;">${m.failed ?? 0}</td>
      <td class="right">${m.rate_limited ?? 0}</td>
      <td class="right">${m.mismatch ?? 0}</td>
      <td class="right">${m.avg_latency != null ? m.avg_latency + ' ms' : '—'}</td>
      <td class="right"><strong>${rate != null ? fmtPct(rate) : '—'}</strong></td>
    </tr>`;
  }).join('');

  const total = hotel_details.length;
  const ok = hotel_details.filter(d => d.status === 'ok').length;
  const soldOut = hotel_details.filter(d => d.status === 'sold_out').length;
  const notListed = hotel_details.filter(d => d.status === 'not_listed').length;
  const outliers = hotel_details.filter(d => d.out).length;

  const bars = [
    { label: '正常', value: ok, color: '#059669' },
    { label: '售罄', value: soldOut, color: '#f59e0b' },
    { label: '未上架', value: notListed, color: '#94a3b8' },
  ];
  const barHtml = total ? bars.map(b => {
    const pct = (b.value / total * 100).toFixed(1);
    return `<div style="background:${b.color};width:${pct}%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:600;"
                 title="${b.label} ${b.value} (${pct}%)">${pct >= 5 ? `${b.label} ${pct}%` : ''}</div>`;
  }).join('') : '';

  target.innerHTML = `
    <h3 style="margin-bottom:12px;font-size:18px;color:#0f172a;">📡 API 调用健康度</h3>
    ${apiRows ? `<table class="data-table">
      <thead><tr><th>数据源</th><th class="right">总量</th><th class="right">成功</th><th class="right">失败</th>
        <th class="right">限流</th><th class="right">错配</th><th class="right">延迟</th><th class="right">成功率</th></tr></thead>
      <tbody>${apiRows}</tbody>
    </table>` : '<p style="color:#94a3b8;">本快照无 API 健康记录</p>'}

    <h3 style="margin:2rem 0 12px;font-size:18px;color:#0f172a;">📊 数据完整度</h3>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:16px;">
      <div class="kpi-card"><div class="kpi-label">总记录</div><div class="kpi-value" style="font-size:28px;">${total}</div></div>
      <div class="kpi-card"><div class="kpi-label">正常</div><div class="kpi-value" style="font-size:28px;color:#059669;">${ok}</div></div>
      <div class="kpi-card"><div class="kpi-label">售罄</div><div class="kpi-value" style="font-size:28px;color:#f59e0b;">${soldOut}</div></div>
      <div class="kpi-card"><div class="kpi-label">未上架</div><div class="kpi-value" style="font-size:28px;color:#94a3b8;">${notListed}</div></div>
      <div class="kpi-card"><div class="kpi-label">极端高价</div><div class="kpi-value" style="font-size:28px;color:#dc2626;">${outliers}</div></div>
    </div>

    <h3 style="margin-bottom:8px;font-size:16px;color:#0f172a;">🚦 状态分布</h3>
    <div style="display:flex;height:32px;border-radius:8px;overflow:hidden;background:#f1f5f9;">${barHtml}</div>

    <details class="collapse" style="margin-top:1.5rem;">
      <summary>本快照 KPI 明细</summary>
      <pre style="color:#64748b;font-size:12px;line-height:1.5;white-space:pre-wrap;padding:8px 0;">${JSON.stringify(kpi, null, 2)}</pre>
    </details>`;
}
