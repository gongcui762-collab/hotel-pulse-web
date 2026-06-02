/**
 * Hotel Pulse · 主入口
 *
 * 启动流程：
 *   1. fetch meta.json（cities / hotels / holidays / 阈值）
 *   2. fetch snapshots/index.json（可用 snapshot 列表）
 *   3. fetch snapshots/<latest>.json（默认渲染最新快照）
 *   4. 渲染 KPI bar + 默认 tab（热度地图）
 *   5. 绑定 tab 切换 + 单击单元格联动
 *
 * 全局状态（导出给各 tab 模块共用）：
 *   state.meta              全局元数据
 *   state.snapshotIndex     快照索引
 *   state.currentSnapshot   当前 snapshot 数据
 *   state.currentDate       当前选中日期
 */

import { renderHeatmap } from './tabs/heatmap.js';
import { renderHolidays } from './tabs/holidays.js';
import { renderDrilldown, prefillDrilldown } from './tabs/drilldown.js';
import { renderHotels } from './tabs/hotels.js';
import { renderDataHealth } from './tabs/data-health.js';

// ============================================================
// 全局状态
// ============================================================
export const state = {
  meta: null,
  snapshotIndex: null,
  currentSnapshot: null,
  currentDate: null,
};

// 各 tab 是否已经渲染过（懒加载）
const renderedTabs = new Set();

// 各 tab 的渲染函数（用 Map 避免 if-else 一坨）
const tabRenderers = {
  'heatmap':     renderHeatmap,
  'holidays':    renderHolidays,
  'drilldown':   renderDrilldown,
  'hotels':      renderHotels,
  'data-health': renderDataHealth,
};

// ============================================================
// 数据加载
// ============================================================
async function fetchJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) {
    throw new Error(`Fetch failed: ${path} → ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function loadInitialData() {
  // 并行 fetch meta + index
  const [meta, snapshotIndex] = await Promise.all([
    fetchJSON('./data/meta.json'),
    fetchJSON('./data/snapshots/index.json'),
  ]);
  state.meta = meta;
  state.snapshotIndex = snapshotIndex;

  // 选默认 snapshot：优先用 meta.latest_snapshot；否则用 index 第一条
  const defaultDate = meta.latest_snapshot || snapshotIndex.snapshots[0]?.date;
  if (!defaultDate) {
    throw new Error('No snapshot available');
  }
  await loadSnapshot(defaultDate);
}

async function loadSnapshot(snapshotDate) {
  const data = await fetchJSON(`./data/snapshots/${snapshotDate}.json`);
  state.currentSnapshot = data;
  state.currentDate = snapshotDate;

  // 切换 snapshot 后，已渲染的 tab 全部失效，重置
  renderedTabs.clear();
  renderKPIBar();
  // 重渲染当前 tab
  const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
  if (activeTab) renderTab(activeTab);
}

// ============================================================
// 渲染：顶部 KPI + Snapshot picker
// ============================================================
function renderKPIBar() {
  const { kpi } = state.currentSnapshot;
  document.getElementById('kpi-snapshot-date').textContent = kpi.snapshot_date;
  document.getElementById('kpi-cities').textContent = kpi.cities_covered;
  document.getElementById('kpi-hotels').textContent = kpi.hotels_covered;

  if (kpi.max_heat) {
    const cityName = cityNameZh(kpi.max_heat.city);
    document.getElementById('kpi-max-heat').textContent =
      `${cityName} · ${kpi.max_heat.ci} · ${kpi.max_heat.heat}`;
  } else {
    document.getElementById('kpi-max-heat').textContent = '—';
  }

  // Footer 时间戳
  const ts = state.meta.generated_at;
  document.getElementById('footer-generated-at').textContent =
    `数据更新时间：${ts ? ts.replace('T', ' ').substring(0, 19) : '未知'}`;
}

function renderSnapshotPicker() {
  const sel = document.getElementById('snapshot-select');
  sel.innerHTML = '';
  for (const s of state.snapshotIndex.snapshots) {
    const opt = document.createElement('option');
    opt.value = s.date;
    // 在选项里附加摘要信息；cities=0 标注「采集不完整」
    const cities = s.cities || 0;
    const tag = cities === 0 ? ' · ⚠ 采集不完整' : '';
    opt.textContent = `${s.date} (${cities} 城${tag})`;
    if (s.date === state.currentDate) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', async (e) => {
    showLoading();
    try {
      await loadSnapshot(e.target.value);
    } catch (err) {
      showError(`加载快照失败：${err.message}`);
    } finally {
      hideLoading();
    }
  });
}

// ============================================================
// Tab 切换
// ============================================================
function bindTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

export function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    const active = btn.dataset.tab === tabName;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab-${tabName}`);
  });
  renderTab(tabName);
}

function renderTab(tabName) {
  // 已经渲染过 + 数据没换 = 跳过
  if (renderedTabs.has(tabName)) return;
  const renderer = tabRenderers[tabName];
  if (!renderer) {
    console.warn(`No renderer for tab: ${tabName}`);
    return;
  }
  try {
    renderer(state);
    renderedTabs.add(tabName);
  } catch (err) {
    console.error(`Render tab "${tabName}" failed:`, err);
    const panel = document.getElementById(`tab-${tabName}`);
    if (panel) {
      panel.innerHTML = `<div class="error-msg">渲染失败：${err.message}</div>`;
    }
  }
}

// 给 heatmap.js 调用：单击单元格 → 跳到 drilldown 并预填
export function jumpToDrilldown(cityCode, checkinDate) {
  prefillDrilldown(cityCode, checkinDate);
  switchTab('drilldown');
}

// ============================================================
// 工具函数（导出给各 tab）
// ============================================================
export function cityNameZh(cityCode) {
  if (!state.meta?.cities) return cityCode;
  const c = state.meta.cities.find((c) => c.code === cityCode);
  return c?.name_zh || cityCode;
}

export function cityNameEn(cityCode) {
  if (!state.meta?.cities) return cityCode;
  const c = state.meta.cities.find((c) => c.code === cityCode);
  return c?.name_en || cityCode;
}

export function hotelById(hotelId) {
  if (!state.meta?.hotels) return null;
  return state.meta.hotels.find((h) => h.id === hotelId) || null;
}

export function heatLevel(score) {
  if (score == null) return 'na';
  if (score < 35)  return 'blue';
  if (score < 65)  return 'green';
  if (score < 85)  return 'yellow';
  return 'red';
}

export function fmtPct(x, digits = 1) {
  if (x == null) return '—';
  return (x * 100).toFixed(digits) + '%';
}

export function fmtCNY(x) {
  if (x == null) return '—';
  return '¥' + x.toLocaleString('zh-CN');
}

// ============================================================
// 加载遮罩 / 错误
// ============================================================
function showLoading() {
  document.getElementById('loading-overlay').classList.remove('hidden');
}
function hideLoading() {
  document.getElementById('loading-overlay').classList.add('hidden');
}
function showError(msg) {
  console.error(msg);
  const overlay = document.getElementById('loading-overlay');
  overlay.innerHTML = `<div class="error-msg" style="max-width:480px;">${msg}</div>`;
}

// ============================================================
// 启动
// ============================================================
async function bootstrap() {
  showLoading();
  try {
    await loadInitialData();
    renderSnapshotPicker();
    bindTabs();
    switchTab('heatmap');
    hideLoading();
  } catch (err) {
    showError(`启动失败：${err.message}<br><small>请确认 data/ 目录下文件存在。</small>`);
  }
}

document.addEventListener('DOMContentLoaded', bootstrap);
