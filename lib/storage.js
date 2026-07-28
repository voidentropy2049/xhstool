/**
 * 小红书管家 - 数据存储模块
 * 使用 chrome.storage.local 存储文章数据
 */

// 包裹为 IIFE，扩展重载后可安全重复注入，不会重复声明顶层常量
(function () {

const STORAGE_KEYS = {
  ARTICLES: 'xhs_articles',
  SETTINGS: 'xhs_settings',
  STATUSES: 'xhs_statuses',
};

// 默认状态配置
const DEFAULT_STATUSES = [
  { id: 'unread', label: '未读', color: '#9ca3af', icon: '📄' },
  { id: 'reading', label: '正在看', color: '#3b82f6', icon: '📖' },
  { id: 'done', label: '已看完', color: '#22c55e', icon: '✅' },
  { id: 'favorite', label: '收藏', color: '#ef4444', icon: '❤️' },
  { id: 'archived', label: '归档', color: '#6b7280', icon: '📦' },
];

// 默认设置
const DEFAULT_SETTINGS = {
  autoSave: true,
  showCheckboxes: true,
  showStatusBadge: true,
  exportFormat: 'csv', // csv | json
  batchSize: 50,
};

// ========== 文章数据操作 ==========

/**
 * 获取所有文章
 */
async function getAllArticles() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.ARTICLES);
  return result[STORAGE_KEYS.ARTICLES] || [];
}

/**
 * 根据 ID 获取文章
 */
async function getArticleById(id) {
  const articles = await getAllArticles();
  return articles.find((a) => a.id === id) || null;
}

/**
 * 保存单篇文章（不存在则新增，存在则更新）
 */
async function saveArticle(article) {
  const articles = await getAllArticles();
  const index = articles.findIndex((a) => a.id === article.id);
  const now = Date.now();

  if (index === -1) {
    article.createdAt = now;
    article.updatedAt = now;
    article.status = article.status || 'unread';
    articles.unshift(article);
  } else {
    articles[index] = { ...articles[index], ...article, updatedAt: now };
  }

  await chrome.storage.local.set({ [STORAGE_KEYS.ARTICLES]: articles });
  return article;
}

/**
 * 批量保存文章
 */
async function saveArticles(newArticles) {
  const articles = await getAllArticles();
  const now = Date.now();

  for (const newArticle of newArticles) {
    const index = articles.findIndex((a) => a.id === newArticle.id);
    if (index === -1) {
      newArticle.createdAt = now;
      newArticle.updatedAt = now;
      newArticle.status = newArticle.status || 'unread';
      articles.unshift(newArticle);
    }
  }

  await chrome.storage.local.set({ [STORAGE_KEYS.ARTICLES]: articles });
  return articles;
}

/**
 * 批量更新文章状态
 */
async function batchUpdateStatus(ids, status) {
  const articles = await getAllArticles();
  const now = Date.now();

  for (const article of articles) {
    if (ids.includes(article.id)) {
      article.status = status;
      article.updatedAt = now;
    }
  }

  await chrome.storage.local.set({ [STORAGE_KEYS.ARTICLES]: articles });
  return articles;
}

/**
 * 删除文章
 */
async function deleteArticles(ids) {
  const articles = await getAllArticles();
  const filtered = articles.filter((a) => !ids.includes(a.id));
  await chrome.storage.local.set({ [STORAGE_KEYS.ARTICLES]: filtered });
  return filtered;
}

/**
 * 搜索文章
 */
async function searchArticles(query) {
  const articles = await getAllArticles();
  const q = query.toLowerCase();
  return articles.filter(
    (a) =>
      a.title?.toLowerCase().includes(q) ||
      a.author?.toLowerCase().includes(q) ||
      a.notes?.toLowerCase().includes(q)
  );
}

/**
 * 按状态筛选文章
 */
async function getArticlesByStatus(status) {
  const articles = await getAllArticles();
  if (!status || status === 'all') return articles;
  return articles.filter((a) => a.status === status);
}

/**
 * 导出文章
 */
async function exportArticles(format, ids) {
  let articles = await getAllArticles();
  if (ids && ids.length > 0) {
    articles = articles.filter((a) => ids.includes(a.id));
  }

  if (format === 'json') {
    const json = JSON.stringify(articles, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    await chrome.downloads.download({
      url,
      filename: `xhs_articles_${formatDate()}.json`,
      saveAs: true,
    });
    URL.revokeObjectURL(url);
  } else {
    // CSV 格式
    const headers = [
      '标题', '作者', '链接', '状态', '收藏时间', '更新时间', '备注',
    ];
    const rows = articles.map((a) => [
      escapeCsv(a.title || ''),
      escapeCsv(a.author || ''),
      a.url || '',
      a.status || '',
      formatDate(a.createdAt),
      formatDate(a.updatedAt),
      escapeCsv(a.notes || ''),
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const bom = '\uFEFF';
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    await chrome.downloads.download({
      url,
      filename: `xhs_articles_${formatDate()}.csv`,
      saveAs: true,
    });
    URL.revokeObjectURL(url);
  }
}

// ========== 状态管理 ==========

async function getStatuses() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.STATUSES);
  return result[STORAGE_KEYS.STATUSES] || DEFAULT_STATUSES;
}

async function saveStatuses(statuses) {
  await chrome.storage.local.set({ [STORAGE_KEYS.STATUSES]: statuses });
}

async function resetStatuses() {
  await chrome.storage.local.set({ [STORAGE_KEYS.STATUSES]: DEFAULT_STATUSES });
  return DEFAULT_STATUSES;
}

// ========== 设置管理 ==========

async function getSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEYS.SETTINGS] || {}) };
}

async function saveSettings(settings) {
  const current = await getSettings();
  const merged = { ...current, ...settings };
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: merged });
  return merged;
}

// ========== 工具函数 ==========

function escapeCsv(str) {
  if (!str) return '';
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 生成唯一 ID
 */
function generateId(url) {
  // 从 URL 中提取 note ID
  const match = url.match(/explore\/([a-f0-9]+)/);
  if (match) return match[1];
  // 或者用 URL + 时间戳
  return 'xhs_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * 从页面元素提取文章信息
 */
function extractArticleInfo(element) {
  // 这个函数会在 content script 中使用
  // 这里保留作为公共工具
  return null;
}

// 全局暴露，供 background.js (importScripts) 和 content.js 使用
globalThis.XHS = {
  getAllArticles,
  getArticleById,
  saveArticle,
  saveArticles,
  batchUpdateStatus,
  deleteArticles,
  searchArticles,
  getArticlesByStatus,
  exportArticles,
  getStatuses,
  saveStatuses,
  resetStatuses,
  getSettings,
  saveSettings,
  generateId,
  extractArticleInfo,
  DEFAULT_STATUSES,
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  MSG_TYPES: {
    GET_ARTICLES: 'getArticles',
    SAVE_ARTICLE: 'saveArticle',
    SAVE_ARTICLES: 'saveArticles',
    BATCH_UPDATE_STATUS: 'batchUpdateStatus',
    DELETE_ARTICLES: 'deleteArticles',
    SEARCH_ARTICLES: 'searchArticles',
    GET_ARTICLES_BY_STATUS: 'getArticlesByStatus',
    EXPORT_ARTICLES: 'exportArticles',
    GET_STATUSES: 'getStatuses',
    SAVE_STATUSES: 'saveStatuses',
    RESET_STATUSES: 'resetStatuses',
    GET_SETTINGS: 'getSettings',
    SAVE_SETTINGS: 'saveSettings',
    EXTRACT_ARTICLES: 'extractArticles',
    GET_PAGE_ARTICLES: 'getPageArticles',
    TOGGLE_SELECT_MODE: 'toggleSelectMode',
  },
};

})();
