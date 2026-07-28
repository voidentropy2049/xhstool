/**
 * 小红书管家 - 设置页面脚本
 */

// ===== 状态 =====
let statuses = [];
let settings = {};

// ===== DOM 引用 =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  setupNavigation();
  setupGeneralSettings();
  setupStatusManagement();
  setupDataManagement();
  checkWelcomeHash();
});

async function loadData() {
  try {
    const result = await chrome.storage.local.get([
      'xhs_statuses',
      'xhs_settings',
    ]);
    statuses = result.xhs_statuses || [
      { id: 'unread', label: '未读', color: '#9ca3af', icon: '📄' },
      { id: 'reading', label: '正在看', color: '#3b82f6', icon: '📖' },
      { id: 'done', label: '已看完', color: '#22c55e', icon: '✅' },
      { id: 'favorite', label: '收藏', color: '#ef4444', icon: '❤️' },
      { id: 'archived', label: '归档', color: '#6b7280', icon: '📦' },
    ];
    settings = result.xhs_settings || {
      autoSave: true,
      showCheckboxes: true,
      showStatusBadge: true,
      exportFormat: 'csv',
      batchSize: 50,
    };
  } catch (e) {
    console.error('加载数据失败:', e);
  }
}

// ===== 导航切换 =====
function setupNavigation() {
  $$('.nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      $$('.nav-item').forEach((n) => n.classList.remove('active'));
      $$('.tab-content').forEach((t) => t.classList.remove('active'));
      item.classList.add('active');
      const tab = document.getElementById(`tab-${item.dataset.tab}`);
      if (tab) tab.classList.add('active');
    });
  });
}

function checkWelcomeHash() {
  if (location.hash === '#welcome') {
    const aboutBtn = document.querySelector('[data-tab="about"]');
    if (aboutBtn) aboutBtn.click();
  }
}

// ===== 基本设置 =====
function setupGeneralSettings() {
  // 填充当前值
  $('#setting-autoSave').checked = settings.autoSave;
  $('#setting-showCheckboxes').checked = settings.showCheckboxes;
  $('#setting-showStatusBadge').checked = settings.showStatusBadge;
  $('#setting-exportFormat').value = settings.exportFormat || 'csv';

  // 保存
  $('#btnSaveSettings').addEventListener('click', async () => {
    const newSettings = {
      autoSave: $('#setting-autoSave').checked,
      showCheckboxes: $('#setting-showCheckboxes').checked,
      showStatusBadge: $('#setting-showStatusBadge').checked,
      exportFormat: $('#setting-exportFormat').value,
      batchSize: settings.batchSize,
    };

    try {
      await chrome.storage.local.set({ xhs_settings: newSettings });
      settings = newSettings;
      showStatus('saveSettingsStatus', '✅ 设置已保存', 'success');
    } catch (e) {
      showStatus('saveSettingsStatus', '❌ 保存失败: ' + e.message, 'error');
    }
  });
}

// ===== 状态管理 =====
function setupStatusManagement() {
  renderStatusList();

  $('#btnAddStatus').addEventListener('click', () => {
    const colors = [
      '#3b82f6', '#22c55e', '#ef4444', '#f59e0b',
      '#8b5cf6', '#ec4899', '#14b8a6', '#f97316',
    ];
    const usedColors = statuses.map((s) => s.color);
    const availColor = colors.find((c) => !usedColors.includes(c)) || '#636e72';

    statuses.push({
      id: 'custom_' + Date.now(),
      label: '新状态',
      color: availColor,
      icon: '📌',
    });
    renderStatusList();
  });

  $('#btnSaveStatuses').addEventListener('click', async () => {
    // 收集当前数据
    const items = $$('.status-item');
    const newStatuses = [];

    items.forEach((item) => {
      const id = item.dataset.id;
      const icon = item.querySelector('.status-icon-input').value || '📌';
      const label = item.querySelector('.status-name-input').value.trim();
      const color = item.querySelector('.status-color-input').value;
      if (label) {
        newStatuses.push({ id, label, color, icon });
      }
    });

    if (newStatuses.length === 0) {
      showStatus('saveStatusesStatus', '❌ 至少需要一个状态', 'error');
      return;
    }

    try {
      await chrome.storage.local.set({ xhs_statuses: newStatuses });
      statuses = newStatuses;
      showStatus('saveStatusesStatus', '✅ 状态已保存', 'success');
    } catch (e) {
      showStatus('saveStatusesStatus', '❌ 保存失败: ' + e.message, 'error');
    }
  });

  $('#btnResetStatuses').addEventListener('click', async () => {
    if (!confirm('恢复默认状态配置？')) return;
    statuses = [
      { id: 'unread', label: '未读', color: '#9ca3af', icon: '📄' },
      { id: 'reading', label: '正在看', color: '#3b82f6', icon: '📖' },
      { id: 'done', label: '已看完', color: '#22c55e', icon: '✅' },
      { id: 'favorite', label: '收藏', color: '#ef4444', icon: '❤️' },
      { id: 'archived', label: '归档', color: '#6b7280', icon: '📦' },
    ];
    await chrome.storage.local.set({ xhs_statuses: statuses });
    renderStatusList();
    showStatus('saveStatusesStatus', '✅ 已恢复默认状态', 'success');
  });
}

function renderStatusList() {
  const container = $('#statusList');
  container.innerHTML = '';

  statuses.forEach((s) => {
    const item = document.createElement('div');
    item.className = 'status-item';
    item.dataset.id = s.id;

    item.innerHTML = `
      <span class="status-drag">⠿</span>
      <input class="status-icon-input" value="${s.icon || '📌'}" maxlength="2" />
      <input class="status-name-input" value="${escapeHtml(s.label)}" placeholder="状态名称" />
      <input class="status-color-input" type="color" value="${s.color}" />
      <button class="status-delete-btn" title="删除">✕</button>
    `;

    // 删除按钮
    const deleteBtn = item.querySelector('.status-delete-btn');
    deleteBtn.addEventListener('click', () => {
      if (statuses.length <= 1) {
        alert('至少需要一个状态');
        return;
      }
      if (!confirm(`删除状态「${s.label}」？`)) return;
      statuses = statuses.filter((st) => st.id !== s.id);
      renderStatusList();
    });

    container.appendChild(item);
  });
}

// ===== 数据管理 =====
function setupDataManagement() {
  $('#btnExportCSV').addEventListener('click', () => exportData('csv'));
  $('#btnExportJSON').addEventListener('click', () => exportData('json'));

  $('#btnImportJSON').addEventListener('click', () => {
    $('#fileInput').click();
  });

  $('#fileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    importData(file);
    e.target.value = '';
  });

  $('#btnClearData').addEventListener('click', async () => {
    if (!confirm('⚠️ 确定要清空所有文章数据吗？此操作不可撤销！')) return;
    if (!confirm('再次确认：真的要删除全部数据吗？')) return;

    try {
      await chrome.storage.local.set({ xhs_articles: [] });
      showStatus('dataStatus', '✅ 所有数据已清空', 'success');
    } catch (e) {
      showStatus('dataStatus', '❌ 清空失败: ' + e.message, 'error');
    }
  });
}

async function exportData(format) {
  try {
    await chrome.runtime.sendMessage({
      type: 'exportArticles',
      payload: { format },
    });
    showStatus('dataStatus', `📥 正在导出 ${format.toUpperCase()} 文件`, 'success');
  } catch (e) {
    showStatus('dataStatus', '❌ 导出失败: ' + e.message, 'error');
  }
}

async function importData(file) {
  try {
    const text = await file.text();
    const articles = JSON.parse(text);

    if (!Array.isArray(articles)) {
      throw new Error('无效的数据格式');
    }

    // 合并到现有数据
    const result = await chrome.storage.local.get('xhs_articles');
    const existing = result.xhs_articles || [];

    for (const article of articles) {
      const idx = existing.findIndex((a) => a.id === article.id);
      if (idx === -1) {
        existing.push(article);
      }
    }

    await chrome.storage.local.set({ xhs_articles: existing });
    showStatus('dataStatus', `✅ 成功导入 ${articles.length} 篇文章`, 'success');
  } catch (e) {
    showStatus('dataStatus', '❌ 导入失败: ' + e.message, 'error');
  }
}

// ===== 工具函数 =====
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showStatus(elementId, msg, type) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = msg;
  el.style.color = type === 'success' ? '#22c55e' : '#ef4444';
  setTimeout(() => {
    el.textContent = '';
  }, 3000);
}
