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
  const kpi = state.currentSnapshot?.kpi;
  if (!kpi) return;
  if (kpi.max_heat) {
    document.getElementById('kpi-hot-target').textContent = `${cityNameZh(kpi.max_heat.city)} · ${kpi.max_heat.ci}`;
    document.getElementById('kpi-hot-value').textContent = kpi.max_heat.heat;
    document.getElementById('kpi-hot-desc').textContent = '窗口内最高热度';
    document.getElementById('kpi-hot-conf').textContent = '置信度 高';
    document.getElementById('kpi-hot-conf').className = 'confidence high';
  }
  document.getElementById('kpi-surge-target').textContent = `${kpi.cities_covered} 城覆盖`;
  document.getElementById('kpi-surge-value').textContent = kpi.hotels_covered;
  document.getElementById('kpi-surge-desc').textContent = '基准酒店总数';
  document.getElementById('kpi-scarce-target').textContent = '异常指标';
  document.getElementById('kpi-scarce-value').textContent = kpi.outlier_count || 0;
  document.getElementById('kpi-scarce-desc').textContent = '异常高价酒店数';
  document.getElementById('kpi-speed-target').textContent = '售罄';
  document.getElementById('kpi-speed-value').textContent = kpi.sold_out_count || 0;
  document.getElementById('kpi-speed-desc').textContent = '售罄 / 未上架';
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
  const wf = (ci) => {
    const w = state.activeWindow;
    if (!w || w.start === 'auto') return true;
    return ci >= w.start && ci <= w.end;
  };
  const flags = { JP:'🇯🇵', TH:'🇹🇭', KR:'🇰🇷', HK:'🇭🇰', MO:'🇲🇴', SG:'🇸🇬', MY:'🇲🇾', ID:'🇮🇩', VN:'🇻🇳', AE:'🇦🇪', MV:'🇲🇻' };
  const rows = filtered.map((city, idx) => {
    const heats = (currentSnapshot.city_heat[city.code] || []).filter(r => wf(r.ci));
    const vH = heats.filter(r => r.heat != null).map(r => r.heat);
    const avg = vH.length ? vH.reduce((a, b) => a + b, 0) / vH.length : null;
    const hc = avg == null ? '' : avg >= 85 ? 'heat-red' : avg >= 65 ? 'heat-yellow' : avg >= 35 ? 'heat-green' : 'heat-blue';
    const soR = heats.filter(r => r.so != null).map(r => r.so);
    const avgSo = soR.length ? soR.reduce((a, b) => a + b, 0) / soR.length : 0;
    const details = (currentSnapshot.hotel_details || []).filter(d => d.city === city.code && d.delta != null && d.status === 'ok').filter(d => wf(d.ci));
    const upCnt = details.filter(d => d.delta > 0.05).length;
    return `<tr>
      <td><span class="rank ${idx < 3 ? 'top' : ''}">${city.outbound_rank || idx + 1}</span></td>
      <td><span class="city-row">${flags[city.country] || ''} ${city.name_zh}</span></td>
      <td class="center">${avg != null ? `<span class="heat-pill ${hc}">${avg.toFixed(1)}</span>` : '—'}</td>
      <td class="center">${avgSo > 0 ? `${(avgSo * 100).toFixed(0)}%` : '—'}</td>
      <td class="center">${heats.length}</td>
      <td><div class="evidence-cell"><span>${upCnt}/${details.length} 涨价超 5%</span></div></td>
    </tr>`;
  }).join('');

  document.getElementById('city-table-wrap').innerHTML = `
    <table class="data-table">
      <colgroup><col style="width:56px" /><col /><col style="width:120px" />
        <col style="width:100px" /><col style="width:100px" /><col /></colgroup>
      <thead><tr>
        <th>排名</th><th>目的地</th><th class="center">窗口热度</th>
        <th class="center">售罄率</th><th class="center">入住日数</th><th>热度证据</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
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
    .filter(d => d.delta != null && d.delta > 0 && d.status === 'ok')
    .filter(d => wf(d.ci));
  if (state.activeCountry) {
    const cc = new Set((meta.cities || []).filter(c => (c.country_group || c.country) === state.activeCountry).map(c => c.code));
    items = items.filter(d => cc.has(d.city));
  }
  items.sort((a, b) => (b.delta || 0) - (a.delta || 0));
  items = items.slice(0, 20);
  if (!items.length) {
    document.getElementById('speed-table-wrap').innerHTML = '<p style="color:#94a3b8;padding:20px 0;">当前窗口内无涨价数据</p>';
    return;
  }
  const rows = items.map(d => {
    const h = hotelById(d.hid);
    const name = h ? (h.name_zh || h.name_en || d.hid) : d.hid;
    return `<tr>
      <td><span class="city-row">${cityNameZh(d.city)} · ${d.ci}</span></td>
      <td class="right">${fmtCNY(d.price)}</td>
      <td class="right">${fmtCNY(d.p50)}</td>
      <td class="right delta-up">+${(d.delta * 100).toFixed(1)}%</td>
    </tr>`;
  }).join('');
  document.getElementById('speed-table-wrap').innerHTML = `
    <table class="data-table">
      <colgroup><col /><col style="width:120px" /><col style="width:120px" /><col style="width:100px" /></colgroup>
      <thead><tr><th>城市 / 入住日</th><th class="right">当前价</th><th class="right">淡季中位</th><th class="right">涨幅</th></tr></thead>
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
