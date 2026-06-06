/**
 * Hotel Pulse v2 · 主入口
 *
 * v2 架构：章节式滚动 + 国家筛选 + 业务窗口 + 信号驱动 KPI
 */

import { renderHeatmap } from './tabs/heatmap.js';
import { renderDrilldown, prefillDrilldown } from './tabs/drilldown.js';
import { renderDataHealth } from './tabs/data-health.js';

// ============================================================
// 全局状态
// ============================================================
export const state = {
  meta: null,
  snapshotIndex: null,
  currentSnapshot: null,
  currentDate: null,
  activeCountry: null,
  activeWindow: null,
  insights: null,
};

// ============================================================
// 数据加载
// ============================================================
async function fetchJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Fetch failed: ${path} - ${res.status}`);
  return res.json();
}

async function loadInitialData() {
  const [meta, snapshotIndex] = await Promise.all([
    fetchJSON('./data/meta.json'),
    fetchJSON('./data/snapshots/index.json'),
  ]);
  state.meta = meta;
  state.snapshotIndex = snapshotIndex;

  const defaultDate = meta.latest_complete_snapshot || meta.latest_snapshot
    || snapshotIndex.snapshots[0]?.date;
  if (!defaultDate) throw new Error('No snapshot available');
  await loadSnapshot(defaultDate);

  try { state.insights = await fetchJSON('./data/insights.json'); }
  catch { state.insights = null; }
}

async function loadSnapshot(snapshotDate) {
  state.currentSnapshot = await fetchJSON(`./data/snapshots/${snapshotDate}.json`);
  state.currentDate = snapshotDate;
  renderAll();
}

// ============================================================
// 渲染
// ============================================================
function renderAll() {
  renderHero();
  renderSnapshotPicker();
  renderKPIBar();
  renderCountryTabs();
  renderWindowSelector();
  renderInsights();
  renderCityTable();
  try { renderHeatmap(state); } catch (e) {
    document.getElementById('heatmap-plot').innerHTML = `<div class="error-msg">热度图渲染失败：${e.message}</div>`;
  }
  renderSpeedTable();
  try { renderDrilldown(state); } catch {}
  try { renderDataHealth(state); } catch {}
  renderFooter();
}

function renderHero() {
  const { meta } = state;
  if (!meta) return;
  const groups = [...new Set((meta.cities || []).map(c => c.country_group || c.country))];
  document.getElementById('hero-cities').textContent = groups.join(' · ');
  document.getElementById('hero-snapshot').textContent =
    `📊 数据截至 ${meta.generated_at ? meta.generated_at.replace('T', ' ').substring(0, 16) : '—'}`;
  document.getElementById('hero-scale').textContent =
    `🏨 ${(meta.hotels || []).length} 家基准酒店 · ${(meta.cities || []).length} 城`;
}

function renderSnapshotPicker() {
  const sel = document.getElementById('snapshot-select');
  sel.innerHTML = '';
  for (const s of state.snapshotIndex.snapshots) {
    const opt = document.createElement('option');
    opt.value = s.date;
    const cities = s.cities || 0;
    opt.textContent = `${s.date} (${cities} 城${cities === 0 ? ' · 采集不完整' : ''})`;
    if (s.date === state.currentDate) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.onchange = async (e) => {
    showLoading();
    try { await loadSnapshot(e.target.value); }
    catch (err) { showError(`加载快照失败：${err.message}`); }
    finally { hideLoading(); }
  };
}

function renderKPIBar() {
  const { currentSnapshot, meta } = state;
  const kpi = currentSnapshot?.kpi;
  if (!kpi) return;

  // ---- 卡 1: 最热目的地 ----
  if (kpi.max_heat) {
    document.getElementById('kpi-hot-target').textContent = `${cityNameZh(kpi.max_heat.city)} · ${kpi.max_heat.ci}`;
    document.getElementById('kpi-hot-value').textContent = kpi.max_heat.heat;
    document.getElementById('kpi-hot-desc').textContent = '窗口内最高热度';
    document.getElementById('kpi-hot-conf').textContent = '置信度 高';
    document.getElementById('kpi-hot-conf').className = 'confidence high';
  }

  // ---- 卡 2: 最大涨幅（排除异常值 out=1 及极端 delta>300%） ----
  const details = currentSnapshot.hotel_details || [];
  const windowDetails = details.filter(d => d.delta != null && d.status === 'ok' && !d.out && d.delta <= 3.0 && windowFilter(d.ci));
  const topSurge = windowDetails.length ? windowDetails.reduce((max, d) => d.delta > max.delta ? d : max, windowDetails[0]) : null;
  if (topSurge) {
    document.getElementById('kpi-surge-target').textContent = `${cityNameZh(topSurge.city)} · ${topSurge.ci}`;
    document.getElementById('kpi-surge-value').textContent = `+${(topSurge.delta * 100).toFixed(0)}%`;
    const h = hotelById(topSurge.hid);
    document.getElementById('kpi-surge-desc').textContent = h ? (h.name_zh || h.name_en) : '单酒店最大涨幅';
    document.getElementById('kpi-surge-conf').textContent = '置信度 高';
    document.getElementById('kpi-surge-conf').className = 'confidence high';
  } else {
    document.getElementById('kpi-surge-target').textContent = '暂无数据';
    document.getElementById('kpi-surge-value').textContent = '—';
    document.getElementById('kpi-surge-desc').textContent = '窗口内无涨价记录';
  }

  // ---- 卡 3: 异常稀缺（售罄率最高的城市） ----
  const cityCodes = [...new Set(details.filter(d => windowFilter(d.ci)).map(d => d.city))];
  let maxSoCity = null, maxSoRate = 0, maxSoCount = 0, maxSoTotal = 0;
  for (const cc of cityCodes) {
    const cityItems = details.filter(d => d.city === cc && windowFilter(d.ci));
    const soCount = cityItems.filter(d => d.so).length;
    const rate = cityItems.length ? soCount / cityItems.length : 0;
    if (rate > maxSoRate) {
      maxSoRate = rate; maxSoCity = cc; maxSoCount = soCount; maxSoTotal = cityItems.length;
    }
  }
  if (maxSoCity && maxSoRate > 0) {
    document.getElementById('kpi-scarce-target').textContent = `${cityNameZh(maxSoCity)} · 窗口内`;
    document.getElementById('kpi-scarce-value').textContent = `${(maxSoRate * 100).toFixed(0)}%`;
    document.getElementById('kpi-scarce-desc').textContent = `${maxSoCount}/${maxSoTotal} 售罄`;
    document.getElementById('kpi-scarce-conf').textContent = maxSoRate > 0.3 ? '置信度 高' : '置信度 中';
    document.getElementById('kpi-scarce-conf').className = `confidence ${maxSoRate > 0.3 ? 'high' : 'mid'}`;
  } else {
    document.getElementById('kpi-scarce-target').textContent = '异常稀缺';
    document.getElementById('kpi-scarce-value').textContent = kpi.sold_out_count || 0;
    document.getElementById('kpi-scarce-desc').textContent = '售罄总数';
  }

  // ---- 卡 4: 涨速 TOP（涨价最普遍的城市） ----
  let maxUpCity = null, maxUpRate = 0, maxUpCnt = 0, maxUpTotal = 0;
  for (const cc of cityCodes) {
    const cityOk = windowDetails.filter(d => d.city === cc);
    const upCnt = cityOk.filter(d => d.delta > 0.05).length;
    const rate = cityOk.length ? upCnt / cityOk.length : 0;
    if (rate > maxUpRate && cityOk.length >= 5) {
      maxUpRate = rate; maxUpCity = cc; maxUpCnt = upCnt; maxUpTotal = cityOk.length;
    }
  }
  if (maxUpCity) {
    document.getElementById('kpi-speed-target').textContent = `${cityNameZh(maxUpCity)} · 窗口内`;
    document.getElementById('kpi-speed-value').textContent = `${(maxUpRate * 100).toFixed(0)}%`;
    document.getElementById('kpi-speed-desc').textContent = `${maxUpCnt}/${maxUpTotal} 酒店涨价超 5%`;
    document.getElementById('kpi-speed-conf').textContent = '置信度 高';
    document.getElementById('kpi-speed-conf').className = 'confidence high';
  } else {
    document.getElementById('kpi-speed-target').textContent = '涨速';
    document.getElementById('kpi-speed-value').textContent = '—';
    document.getElementById('kpi-speed-desc').textContent = '窗口内暂无足够数据';
  }
}

function renderCountryTabs() {
  const { meta } = state;
  if (!meta?.cities) return;
  const container = document.getElementById('country-tabs');
  const groups = {};
  for (const c of meta.cities) {
    const g = c.country_group || c.country || '其他';
    groups[g] = (groups[g] || 0) + 1;
  }
  const flags = { '日本': '🇯🇵', '泰国': '🇹🇭', '韩国': '🇰🇷', '港澳': '🇭🇰', '新加坡': '🇸🇬',
                  '马来西亚': '🇲🇾', '印尼': '🇮🇩', '越南': '🇻🇳', '中东': '🇦🇪', '南亚': '🇲🇻' };
  let html = `<span class="filter-tab active" data-country="">🌐 全部 <span class="count">(${meta.cities.length})</span></span>`;
  for (const [g, cnt] of Object.entries(groups)) {
    html += `<span class="filter-tab" data-country="${g}">${flags[g] || '🌍'} ${g} <span class="count">(${cnt})</span></span>`;
  }
  container.innerHTML = html;
  container.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.activeCountry = tab.dataset.country || null;
      renderCityTable();
      renderSpeedTable();
    });
  });
}

function renderWindowSelector() {
  const sel = document.getElementById('window-select');
  const windows = state.meta?.business_windows || [];
  sel.innerHTML = '';
  const today = new Date().toISOString().substring(0, 10);
  let defaultIdx = windows.length - 1; // fallback: last = "全部"
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${w.emoji || ''} ${w.name_zh}`;
    sel.appendChild(opt);
    if (w.auto_default_before && today < w.auto_default_before && defaultIdx === windows.length - 1) {
      defaultIdx = i;
    }
  }
  sel.value = defaultIdx;
  state.activeWindow = windows[defaultIdx] || null;
  sel.onchange = () => {
    state.activeWindow = windows[parseInt(sel.value)] || null;
    renderCityTable();
    renderSpeedTable();
    renderInsights();
  };
}

function renderInsights() {
  const container = document.getElementById('insight-list');
  const subtitle = document.getElementById('insights-subtitle');
  if (!state.insights?.signals?.length) {
    subtitle.textContent = '洞察信号将在多日数据积累后自动生成';
    container.innerHTML = '<p style="color:#94a3b8;font-size:14px;padding:20px 0;">暂无洞察数据。首次部署后 2-3 天积累足够 snapshot 即可自动生成。</p>';
    return;
  }
  const w = state.activeWindow;
  subtitle.textContent = w ? `关注窗口：${w.name_zh}` : '全部窗口';
  container.innerHTML = state.insights.signals.map(s => {
    const icons = { consecutive_high: '🔥', surge: '📈', anomaly_sold_out: '⚠️', price_stable: '✅' };
    const cls = { consecutive_high: 'surge', surge: 'surge', anomaly_sold_out: 'alert', price_stable: 'calm' };
    const prio = { high: '<span class="tag priority-high">高优先级</span>', mid: '<span class="tag priority-mid">需关注</span>', low: '<span class="tag priority-low">无需调整</span>' };
    const conf = s.confidence ? `<span class="confidence ${s.confidence}">置信度 ${{ high:'高', mid:'中', low:'低' }[s.confidence] || s.confidence}</span>` : '';
    return `<div class="insight-card ${cls[s.type] || 'calm'}">
      <div class="icon-box">${icons[s.type] || '📊'}</div>
      <div class="body">
        <h3>${s.city_name_zh || s.city_code} ${prio[s.priority] || ''} ${conf}</h3>
        <p class="lead">${s.summary || ''}</p>
        ${s.evidence ? `<div class="evidence-blocks"><details class="evidence-block" open>
          <summary>📊 数据证据</summary>
          <div class="content"><ul>${s.evidence.map(e => `<li>${e}</li>`).join('')}</ul></div>
        </details></div>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ---- 城市排行表（三级下钻 + 关键信号） ----
const COUNTRY_FLAGS = { JP:'🇯🇵', TH:'🇹🇭', KR:'🇰🇷', HK:'🇭🇰', MO:'🇲🇴', SG:'🇸🇬', MY:'🇲🇾', ID:'🇮🇩', VN:'🇻🇳', AE:'🇦🇪', MV:'🇲🇻' };
const SIGNAL_MAP = {
  consecutive_high: { icon: '🔥', label: '连续高热' },
  surge:            { icon: '📈', label: '涨速异动' },
  anomaly_sold_out: { icon: '⚠️', label: '异常售罄' },
  price_stable:     { icon: '✅', label: '平稳' },
};

function windowFilter(ci) {
  const w = state.activeWindow;
  if (!w || w.start === 'auto') return true;
  return ci >= w.start && ci <= w.end;
}

function getCitySignal(cityCode) {
  const signals = state.insights?.signals;
  if (!signals) return null;
  return signals.find(s => s.city_code === cityCode) || null;
}

function renderCityTable() {
  const { meta, currentSnapshot } = state;
  if (!currentSnapshot?.city_heat || !meta?.cities) {
    document.getElementById('city-table-wrap').innerHTML = '<p class="error-msg">无数据</p>';
    return;
  }
  const cities = [...meta.cities].sort((a, b) => (a.outbound_rank || 99) - (b.outbound_rank || 99));
  const filtered = state.activeCountry
    ? cities.filter(c => (c.country_group || c.country) === state.activeCountry)
    : cities;

  const rows = filtered.map((city, idx) => {
    const heats = (currentSnapshot.city_heat[city.code] || []).filter(r => windowFilter(r.ci));
    const vH = heats.filter(r => r.heat != null).map(r => r.heat);
    const avg = vH.length ? vH.reduce((a, b) => a + b, 0) / vH.length : null;
    const hc = avg == null ? '' : avg >= 85 ? 'heat-red' : avg >= 65 ? 'heat-yellow' : avg >= 35 ? 'heat-green' : 'heat-blue';
    const soR = heats.filter(r => r.so != null).map(r => r.so);
    const avgSo = soR.length ? soR.reduce((a, b) => a + b, 0) / soR.length : 0;
    const allDetails = (currentSnapshot.hotel_details || []).filter(d => d.city === city.code && windowFilter(d.ci));
    const okDetails = allDetails.filter(d => d.delta != null && d.status === 'ok');
    const upCnt = okDetails.filter(d => d.delta > 0.05).length;
    const soldOut = allDetails.filter(d => d.so).length;

    // 商圈数
    const districtSet = new Set();
    for (const d of allDetails) {
      const h = hotelById(d.hid);
      if (h?.district) districtSet.add(h.district);
    }

    // 平均涨幅
    const deltas = okDetails.map(d => d.delta).filter(x => x != null);
    const avgDelta = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null;
    const deltaCls = avgDelta == null ? 'delta-flat' : avgDelta > 0.02 ? 'delta-up' : avgDelta < -0.02 ? 'delta-down' : 'delta-flat';
    const deltaTxt = avgDelta == null ? '—' : `${avgDelta > 0 ? '+' : ''}${(avgDelta * 100).toFixed(1)}%`;

    // 关键信号
    const sig = getCitySignal(city.code);
    const sigHtml = sig
      ? `<span class="signal">${SIGNAL_MAP[sig.type]?.icon || '📊'} ${SIGNAL_MAP[sig.type]?.label || sig.type}${sig.price_change_pct != null ? ` ${sig.price_change_pct > 0 ? '+' : ''}${(sig.price_change_pct * 100).toFixed(0)}%` : ''}</span>`
      : '<span class="signal" style="color:#94a3b8;">—</span>';

    return `<tr class="city-main-row" data-city="${city.code}" style="cursor:pointer;">
      <td><span class="rank ${idx < 3 ? 'top' : ''}">${city.outbound_rank || idx + 1}</span></td>
      <td><span class="city-row">${COUNTRY_FLAGS[city.country] || ''} ${city.name_zh}</span></td>
      <td class="center">${avg != null ? `<span class="heat-pill ${hc}">${avg.toFixed(1)}</span>` : '—'}</td>
      <td class="center"><span class="${deltaCls}">${deltaTxt}</span></td>
      <td class="center">${avgSo > 0 ? `${(avgSo * 100).toFixed(0)}%` : '—'}</td>
      <td class="center">${districtSet.size}</td>
      <td><div class="evidence-cell"><span><strong>${upCnt}/${okDetails.length}</strong> 涨价</span>${soldOut > 0 ? `<span><strong>${soldOut}</strong> 售罄</span>` : ''}</div></td>
      <td>${sigHtml}</td>
    </tr>`;
  }).join('');

  document.getElementById('city-table-wrap').innerHTML = `
    <table class="data-table" id="city-rank-table">
      <thead><tr>
        <th>排名</th><th>目的地</th><th class="center">窗口热度</th><th class="center">平均涨幅</th>
        <th class="center">售罄率</th><th class="center">商圈</th><th>热度证据</th><th>关键信号</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  // 绑定展开/折叠事件
  document.querySelectorAll('.city-main-row').forEach(row => {
    row.addEventListener('click', () => toggleCityExpand(row));
  });
}

function toggleCityExpand(row) {
  const cityCode = row.dataset.city;
  const tbody = row.closest('tbody');
  const isOpen = row.classList.contains('expanded');

  // 收起：移除所有子行
  if (isOpen) {
    row.classList.remove('expanded');
    const tag = row.querySelector('.expand-tag');
    if (tag) tag.remove();
    let next = row.nextElementSibling;
    while (next && next.classList.contains('sub-row')) {
      const toRemove = next;
      next = next.nextElementSibling;
      toRemove.remove();
    }
    return;
  }

  // 展开：生成商圈子行
  row.classList.add('expanded');
  const nameCell = row.querySelector('.city-row');
  if (nameCell && !nameCell.querySelector('.expand-tag')) {
    nameCell.insertAdjacentHTML('beforeend', ' <span class="expand-tag">展开中</span>');
  }

  const { currentSnapshot, meta } = state;
  const allDetails = (currentSnapshot.hotel_details || []).filter(d => d.city === cityCode && windowFilter(d.ci));

  // 按 district 分组，聚合每个商圈的指标
  const byDistrict = {};
  for (const d of allDetails) {
    const hotel = hotelById(d.hid);
    const dist = hotel?.district || '其他';
    (byDistrict[dist] = byDistrict[dist] || []).push(d);
  }

  const fragment = document.createDocumentFragment();
  for (const [dist, items] of Object.entries(byDistrict)) {
    // 商圈聚合
    const hotelIds = [...new Set(items.map(d => d.hid))];
    const okItems = items.filter(d => d.delta != null && d.status === 'ok');
    const upCnt = okItems.filter(d => d.delta > 0.05).length;
    const soCount = items.filter(d => d.so).length;
    const deltas = okItems.map(d => d.delta).filter(x => x != null);
    const avgDelta = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null;
    const deltaCls = avgDelta == null ? 'delta-flat' : avgDelta > 0.02 ? 'delta-up' : avgDelta < -0.02 ? 'delta-down' : 'delta-flat';
    const deltaTxt = avgDelta == null ? '—' : `${avgDelta > 0 ? '+' : ''}${(avgDelta * 100).toFixed(0)}%`;

    const distRow = document.createElement('tr');
    distRow.className = 'sub-row district';
    distRow.dataset.district = dist;
    distRow.dataset.city = cityCode;
    distRow.style.cursor = 'pointer';
    distRow.innerHTML = `
      <td></td>
      <td><span class="row-label">└─ ${esc(dist)}</span></td>
      <td class="center">—</td>
      <td class="center"><span class="${deltaCls}">${deltaTxt}</span></td>
      <td class="center">${soCount > 0 ? soCount + ' 售罄' : '—'}</td>
      <td class="center">${hotelIds.length} 家</td>
      <td><div class="evidence-cell"><span>${upCnt}/${okItems.length} 涨价</span></div></td>
      <td></td>`;
    distRow.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDistrictExpand(distRow, items);
    });
    fragment.appendChild(distRow);
  }

  // 插入到城市行后面
  const nextSibling = row.nextElementSibling;
  if (nextSibling) {
    tbody.insertBefore(fragment, nextSibling);
  } else {
    tbody.appendChild(fragment);
  }
}

function toggleDistrictExpand(distRow, items) {
  const isOpen = distRow.classList.contains('expanded');

  if (isOpen) {
    distRow.classList.remove('expanded');
    const tag = distRow.querySelector('.expand-tag');
    if (tag) tag.remove();
    let next = distRow.nextElementSibling;
    while (next && next.classList.contains('sub-row') && next.classList.contains('hotel')) {
      const toRemove = next;
      next = next.nextElementSibling;
      toRemove.remove();
    }
    return;
  }

  distRow.classList.add('expanded');
  const label = distRow.querySelector('.row-label');
  if (label && !label.querySelector('.expand-tag')) {
    label.insertAdjacentHTML('beforeend', ' <span class="expand-tag">展开中</span>');
  }

  // 按酒店聚合（同一酒店可能有多个 checkin 日期）
  const byHotel = {};
  for (const d of items) {
    (byHotel[d.hid] = byHotel[d.hid] || []).push(d);
  }

  const fragment = document.createDocumentFragment();
  // 排序：按平均 delta 降序
  const hotelEntries = Object.entries(byHotel).sort((a, b) => {
    const avgA = a[1].filter(x => x.delta != null).reduce((s, x) => s + x.delta, 0) / (a[1].filter(x => x.delta != null).length || 1);
    const avgB = b[1].filter(x => x.delta != null).reduce((s, x) => s + x.delta, 0) / (b[1].filter(x => x.delta != null).length || 1);
    return avgB - avgA;
  });

  for (const [hid, records] of hotelEntries) {
    const hotel = hotelById(hid);
    const name = hotel ? (hotel.name_zh || hotel.name_en) : hid;
    const okRecs = records.filter(r => r.delta != null && r.status === 'ok');
    const avgDelta = okRecs.length ? okRecs.reduce((s, r) => s + r.delta, 0) / okRecs.length : null;
    const avgPrice = okRecs.length ? okRecs.reduce((s, r) => s + (r.price || 0), 0) / okRecs.length : null;
    const isSoldOut = records.some(r => r.so);
    const deltaCls = avgDelta == null ? '' : avgDelta > 0.02 ? 'delta-up' : avgDelta < -0.02 ? 'delta-down' : 'delta-flat';
    const deltaTxt = avgDelta == null ? '—' : `${avgDelta > 0 ? '+' : ''}${(avgDelta * 100).toFixed(1)}%`;

    let statusTag = '';
    if (isSoldOut) statusTag = '<span class="tag priority-high" style="font-size:11px;">售罄</span>';
    else if (avgDelta != null && avgDelta < 0.02) statusTag = '<span class="signal" style="color:#059669;">✅ 可包房</span>';
    else if (avgDelta != null && avgDelta > 0.15) statusTag = '<span class="signal" style="color:#dc2626;">🔴 涨价中</span>';

    const hotelRow = document.createElement('tr');
    hotelRow.className = 'sub-row hotel';
    hotelRow.innerHTML = `
      <td></td>
      <td><span class="row-label">◦ ${esc(name)}</span></td>
      <td class="center">${isSoldOut ? '售罄' : (avgPrice ? fmtCNY(Math.round(avgPrice)) : '—')}</td>
      <td class="center"><span class="${deltaCls}">${deltaTxt}</span></td>
      <td class="center"></td>
      <td class="center"></td>
      <td><div class="evidence-cell"><span>${records.length} 个入住日</span></div></td>
      <td>${statusTag}</td>`;
    fragment.appendChild(hotelRow);
  }

  const nextSibling = distRow.nextElementSibling;
  if (nextSibling) {
    distRow.parentNode.insertBefore(fragment, nextSibling);
  } else {
    distRow.parentNode.appendChild(fragment);
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderSpeedTable() {
  const { currentSnapshot, meta } = state;
  if (!currentSnapshot?.hotel_details) {
    document.getElementById('speed-table-wrap').innerHTML = '';
    return;
  }
  const wf = (ci) => {
    const w = state.activeWindow;
    if (!w || w.start === 'auto') return true;
    return ci >= w.start && ci <= w.end;
  };
  let items = currentSnapshot.hotel_details
    .filter(d => d.delta != null && d.delta > 0 && d.delta <= 3.0 && d.status === 'ok' && !d.out)
    .filter(d => wf(d.ci));
  if (state.activeCountry) {
    const cc = new Set((meta.cities || []).filter(c => (c.country_group || c.country) === state.activeCountry).map(c => c.code));
    items = items.filter(d => cc.has(d.city));
  }
  items.sort((a, b) => (b.delta || 0) - (a.delta || 0));
  // 每酒店只保留涨幅最大的一条，避免同一酒店刷屏
  const seenHotels = new Set();
  items = items.filter(d => {
    if (seenHotels.has(d.hid)) return false;
    seenHotels.add(d.hid);
    return true;
  });
  items = items.slice(0, 20);
  if (!items.length) {
    document.getElementById('speed-table-wrap').innerHTML = '<p style="color:#94a3b8;padding:20px 0;">当前窗口内无涨价数据</p>';
    return;
  }
  const rows = items.map(d => {
    const h = hotelById(d.hid);
    const name = h ? (h.name_zh || h.name_en || d.hid) : d.hid;
    // 查热度
    const heatRow = (currentSnapshot.city_heat?.[d.city] || []).find(r => r.ci === d.ci);
    const heat = heatRow?.heat;
    const hc = heat == null ? '' : heat >= 85 ? 'heat-red' : heat >= 65 ? 'heat-yellow' : heat >= 35 ? 'heat-green' : 'heat-blue';
    const heatHtml = heat != null ? `<span class="heat-pill ${hc}">${heat.toFixed(1)}</span>` : '—';
    return `<tr>
      <td>${cityNameZh(d.city)} · ${d.ci}</td>
      <td style="color:#334155;">${name}</td>
      <td class="right">${fmtCNY(d.price)}</td>
      <td class="right" style="color:#94a3b8;">${fmtCNY(d.p50)}</td>
      <td class="right delta-up">+${(d.delta * 100).toFixed(1)}%</td>
      <td class="center">${heatHtml}</td>
    </tr>`;
  }).join('');
  document.getElementById('speed-table-wrap').innerHTML = `
    <table class="data-table">
      <thead><tr><th>城市 / 入住日</th><th>酒店</th><th class="right">当前价</th><th class="right">淡季中位</th><th class="right">涨幅</th><th class="center">当前热度</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderFooter() {
  const ts = state.meta?.generated_at;
  document.getElementById('footer-update-time').textContent =
    `最新：${ts ? ts.replace('T', ' ').substring(0, 16) : '—'} · 下次：每日 03:00`;
}

// ============================================================
// 导出工具
// ============================================================
export function jumpToDrilldown(cityCode, checkinDate) {
  prefillDrilldown(cityCode, checkinDate);
  document.getElementById('drilldown').scrollIntoView({ behavior: 'smooth' });
}
export function cityNameZh(code) {
  return state.meta?.cities?.find(c => c.code === code)?.name_zh || code;
}
export function hotelById(id) {
  return state.meta?.hotels?.find(h => h.id === id) || null;
}
export function heatLevel(score) {
  if (score == null) return 'na';
  return score < 35 ? 'blue' : score < 65 ? 'green' : score < 85 ? 'yellow' : 'red';
}
export function fmtPct(x, d = 1) { return x == null ? '—' : (x * 100).toFixed(d) + '%'; }
export function fmtCNY(x) { return x == null ? '—' : '¥' + x.toLocaleString('zh-CN'); }

function showLoading() { document.getElementById('loading-overlay').classList.remove('hidden'); }
function hideLoading() { document.getElementById('loading-overlay').classList.add('hidden'); }
function showError(msg) {
  document.getElementById('loading-overlay').innerHTML =
    `<div class="error-msg" style="max-width:480px;">${msg}</div>`;
}

async function bootstrap() {
  showLoading();
  try { await loadInitialData(); hideLoading(); }
  catch (err) { showError(`启动失败：${err.message}<br><small>请确认 data/ 目录下文件存在。</small>`); }
}
document.addEventListener('DOMContentLoaded', bootstrap);
