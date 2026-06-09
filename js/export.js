/**
 * 📤 导出工具：CSV + PNG
 *
 * 用法：
 *   import { addExportButtons } from './export.js';
 *   addExportButtons('city-table-wrap', 'city-rank-table', '城市热度排行');
 */

/**
 * 在指定容器顶部插入导出按钮组（CSV + PNG）
 * @param {string} containerId - 外层容器 ID
 * @param {string} tableOrPlotId - 表格 ID（CSV 用）或 Plotly div ID（PNG 用）
 * @param {string} filenamePrefix - 文件名前缀
 * @param {object} options - {csv: true, png: true}
 */
export function addExportButtons(containerId, tableOrPlotId, filenamePrefix, options = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const { csv = true, png = true } = options;

  // 避免重复插入
  if (container.querySelector('.export-bar')) return;

  const bar = document.createElement('div');
  bar.className = 'export-bar';
  bar.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-bottom:8px;';

  if (csv) {
    const csvBtn = document.createElement('button');
    csvBtn.className = 'export-btn';
    csvBtn.innerHTML = '📊 导出 CSV';
    csvBtn.style.cssText = btnStyle();
    csvBtn.onclick = () => exportTableCSV(tableOrPlotId, filenamePrefix);
    bar.appendChild(csvBtn);
  }

  if (png) {
    const pngBtn = document.createElement('button');
    pngBtn.className = 'export-btn';
    pngBtn.innerHTML = '🖼 导出 PNG';
    pngBtn.style.cssText = btnStyle();
    pngBtn.onclick = () => exportPlotlyPNG(tableOrPlotId, filenamePrefix);
    bar.appendChild(pngBtn);
  }

  container.insertBefore(bar, container.firstChild);
}

function btnStyle() {
  return 'padding:5px 12px;font-size:12px;border:1px solid #e2e8f0;border-radius:6px;' +
    'background:#fff;color:#475569;cursor:pointer;transition:all .15s;';
}

/**
 * 将 HTML table 导出为 CSV 下载
 */
function exportTableCSV(tableId, filenamePrefix) {
  const table = document.getElementById(tableId);
  if (!table) {
    alert('找不到数据表格');
    return;
  }

  const rows = [];
  // 表头
  const thead = table.querySelector('thead tr');
  if (thead) {
    rows.push(
      Array.from(thead.querySelectorAll('th'))
        .map(th => csvEscape(th.textContent.trim()))
        .join(',')
    );
  }

  // 表体（跳过展开的子行）
  table.querySelectorAll('tbody tr').forEach(tr => {
    // 跳过隐藏行或子行
    if (tr.style.display === 'none') return;
    if (tr.classList.contains('city-expand-row')) return;

    const cells = Array.from(tr.querySelectorAll('td'))
      .map(td => csvEscape(td.textContent.trim()));
    rows.push(cells.join(','));
  });

  const csvContent = '﻿' + rows.join('\n'); // BOM for Excel 中文
  downloadFile(csvContent, `${filenamePrefix}_${today()}.csv`, 'text/csv;charset=utf-8');
}

/**
 * 将 Plotly 图表导出为 PNG 下载
 */
function exportPlotlyPNG(plotId, filenamePrefix) {
  const plotDiv = document.getElementById(plotId);
  if (!plotDiv || !plotDiv.querySelector('.plotly')) {
    alert('找不到图表');
    return;
  }

  Plotly.downloadImage(plotDiv, {
    format: 'png',
    width: 1400,
    height: 800,
    filename: `${filenamePrefix}_${today()}`,
    scale: 2,
  });
}

function csvEscape(val) {
  if (val == null) return '';
  const s = String(val).replace(/"/g, '""');
  return s.includes(',') || s.includes('\n') || s.includes('"') ? `"${s}"` : s;
}

function today() {
  return new Date().toISOString().substring(0, 10);
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
