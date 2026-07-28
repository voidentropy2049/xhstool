const MANAGER_URL = 'https://creator.xiaohongshu.com/new/note-manager';
let articles = [];
const selectedIds = new Set();
let isLoading = false;
const $ = (selector) => document.querySelector(selector);
const isManagerPageUrl = (url) => typeof url === 'string' && url.startsWith(MANAGER_URL);

document.addEventListener('DOMContentLoaded', () => {
  $('#btnRefresh').addEventListener('click', () => loadPageArticles());
  $('#selectAll').addEventListener('change', toggleSelectAll);
  $('#btnOpenManager').addEventListener('click', () => chrome.tabs.create({ url: MANAGER_URL }));
  document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.locked) { setFeedback('后续版本解锁', 'info'); return; }
    if (button.dataset.action === 'permission') togglePermissionMenu();
    else if (button.dataset.action === 'pin') togglePinMenu();
    else runBatchAction(button.dataset.action);
  }));
  document.querySelectorAll('[data-permission]').forEach((button) => button.addEventListener('click', () => {
    runBatchAction('permission', button.dataset.permission);
  }));
  document.querySelectorAll('[data-pin]').forEach((button) => button.addEventListener('click', () => {
    runBatchAction('pin', button.dataset.pin);
  }));
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== 'creatorBatchProgress' || !isLoading) return;
    const { current, total } = message.payload || {};
    if (!Number.isInteger(current) || !Number.isInteger(total)) return;
    const progress = `正在处理第 ${current} / ${total} 篇…`;
    setPageState(progress);
    setFeedback(progress, 'info');
  });
  loadPageArticles();
});

async function loadPageArticles(retries = 0, allowReload = true) {
  isLoading = true;
  renderSelectionState();
  setPageState('正在读取列表…');
  updateManagerButton();
  try {
    const response = await chrome.runtime.sendMessage({ type: 'getPageArticles' });
    if (!response?.success) throw new Error(response?.error || '无法读取当前页面');
    articles = response.data || [];
    selectedIds.clear();
    render();
    setPageState('已连接创作者后台');
    setManagerButtonVisible(false);
  } catch (error) {
    if (retries > 0) {
      await wait(1000);
      return loadPageArticles(retries - 1, allowReload);
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const onManagerPage = isManagerPageUrl(tab?.url);
    // 读取失败通常是页面脚本失联，重载页面后重试一次
    if (onManagerPage && allowReload && tab?.id) {
      setPageState('正在重载笔记管理页…');
      await reloadTab(tab.id);
      return loadPageArticles(0, false);
    }
    articles = [];
    selectedIds.clear();
    render();
    setPageState(onManagerPage ? '读取失败，请刷新页面后重试' : '请先打开笔记管理页');
    setManagerButtonVisible(!onManagerPage);
  } finally {
    isLoading = false;
    renderSelectionState();
  }
}

function reloadTab(tabId) {
  return new Promise((resolve) => {
    const onUpdated = (updatedTabId, info) => {
      if (updatedTabId !== tabId || info.status !== 'complete') return;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      setTimeout(resolve, 800);
    };
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }, 20000);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.reload(tabId).catch(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve();
    });
  });
}

function wait(duration) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

async function updateManagerButton() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  setManagerButtonVisible(!isManagerPageUrl(tab?.url));
}

function setManagerButtonVisible(visible) {
  $('#btnOpenManager').hidden = !visible;
}

function render() {
  const list = $('#articleList');
  list.innerHTML = '';
  $('#totalCount').textContent = `${articles.length} 篇`;
  $('#emptyState').hidden = articles.length > 0;
  articles.forEach((article) => {
    const item = document.createElement('label');
    item.className = 'article-item';
    const status = getPermissionStatus(article.permission);
    const pinStatus = article.pinned ? '<span class="pin-status" title="已置顶" aria-label="已置顶">置顶</span>' : '';
    item.innerHTML = `<input type="checkbox" data-id="${escapeAttribute(article.id)}" ${selectedIds.has(article.id) ? 'checked' : ''} /><span class="article-copy"><strong>${escapeHtml(article.title || '未命名笔记')}</strong><small>${escapeHtml(article.time || '当前列表')}</small></span>${pinStatus}<span class="permission-status permission-status-${status.className}" title="${status.label}" aria-label="${status.label}">${status.icon}</span>`;
    item.querySelector('input').addEventListener('change', (event) => setSelected(article.id, event.target.checked));
    list.appendChild(item);
  });
  renderSelectionState();
}

function setSelected(id, checked) {
  if (checked) selectedIds.add(id);
  else selectedIds.delete(id);
  renderSelectionState();
}

function toggleSelectAll(event) {
  if (event.target.checked) articles.forEach((article) => selectedIds.add(article.id));
  else selectedIds.clear();
  render();
}

function renderSelectionState() {
  document.querySelectorAll('.article-item input').forEach((input) => { input.checked = selectedIds.has(input.dataset.id); });
  $('#selectAll').checked = articles.length > 0 && selectedIds.size === articles.length;
  $('#selectedCount').textContent = `已选 ${selectedIds.size} 篇`;
  const canOperate = articles.length > 0 && selectedIds.size > 0;
  document.querySelectorAll('[data-action]:not([data-locked])').forEach((button) => { button.disabled = isLoading || !canOperate; });
  document.querySelectorAll('[data-permission]').forEach((button) => { button.disabled = isLoading || !canOperate; });
  document.querySelectorAll('[data-pin]').forEach((button) => { button.disabled = isLoading || !canOperate; });
  if (!canOperate) $('#permissionMenu').hidden = true;
  if (!canOperate) $('#pinMenu').hidden = true;
  setFeedback(canOperate ? '已选择文章，可以开始批量操作' : '请选择文章后开始操作', 'info');
}

function togglePermissionMenu() {
  if (selectedIds.size === 0) return;
  $('#pinMenu').hidden = true;
  $('#permissionMenu').hidden = !$('#permissionMenu').hidden;
  setFeedback($('#permissionMenu').hidden ? '请选择要执行的批量操作' : '请选择目标可见范围', 'info');
}

function togglePinMenu() {
  if (selectedIds.size === 0) return;
  $('#permissionMenu').hidden = true;
  $('#pinMenu').hidden = !$('#pinMenu').hidden;
  setFeedback($('#pinMenu').hidden ? '请选择要执行的批量操作' : '请选择置顶操作', 'info');
}

async function runBatchAction(action, permissionValue = '') {
  if (selectedIds.size === 0) return;
  if (action === 'delete') {
    if (!window.confirm(`确定要删除选中的 ${selectedIds.size} 篇笔记吗？`)) return;
    if (!window.confirm('删除后无法恢复，请再次确认继续删除。')) return;
  }
  const payload = { action, ids: [...selectedIds] };
  if (action === 'permission') payload.value = permissionValue;
  if (action === 'pin') payload.value = permissionValue === '0' ? '0' : '1';

  isLoading = true;
  renderSelectionState();
  setBatchDisabled(true);
  $('#permissionMenu').hidden = true;
  $('#pinMenu').hidden = true;
  setPageState(`正在处理 ${payload.ids.length} 篇…`);
  setFeedback(`正在处理 ${payload.ids.length} 篇…`, 'info');
  try {
    const response = await chrome.runtime.sendMessage({ type: 'runCreatorBatchAction', payload });
    if (!response) throw new Error('页面未响应，请刷新笔记管理页后重试');
    const resultMessage = response.data?.message || response.error || '操作失败';
    setPageState(resultMessage);
    setFeedback(resultMessage, response.success ? 'success' : 'error');
    if (response.data?.permissions && action === 'permission') {
      const permissions = response.data.permissions;
      articles = articles.map((article) => Object.prototype.hasOwnProperty.call(permissions, article.id)
        ? { ...article, permission: permissions[article.id] }
        : article);
      render();
    } else if (response.data?.updatedIds && action === 'pin') {
      const updated = new Set(response.data.updatedIds);
      articles = articles.map((article) => updated.has(article.id)
        ? { ...article, pinned: response.data.pinned === true }
        : article);
      render();
    } else if (response.data?.updatedIds && action === 'permission') {
      const updated = new Set(response.data.updatedIds);
      articles = articles.map((article) => updated.has(article.id)
        ? { ...article, permission: null }
        : article);
      render();
    }
    if (response.data?.deletedIds && action === 'delete') {
      const deleted = new Set(response.data.deletedIds);
      articles = articles.filter((article) => !deleted.has(article.id));
      response.data.deletedIds.forEach((id) => selectedIds.delete(id));
      render();
    }
  } catch (error) {
    setPageState(error.message || '操作失败');
    setFeedback(error.message || '操作失败', 'error');
  } finally {
    isLoading = false;
    renderSelectionState();
  }
}

function setBatchDisabled(disabled) {
  document.querySelectorAll('[data-action]:not([data-locked])').forEach((button) => { button.disabled = disabled; });
  document.querySelectorAll('[data-permission]').forEach((button) => { button.disabled = disabled; });
  document.querySelectorAll('[data-pin]').forEach((button) => { button.disabled = disabled; });
}

function setFeedback(message, type) {
  const feedback = $('#batchFeedback');
  feedback.textContent = message;
  feedback.dataset.type = type;
}

function getPermissionStatus(permission) {
  const statuses = {
    0: { icon: '●', label: '公开可见', className: 'public' },
    1: { icon: '◉', label: '仅自己可见', className: 'private' },
    2: { icon: '◌', label: '不给谁看', className: 'restricted' },
    3: { icon: '◍', label: '只给谁看', className: 'limited' },
    4: { icon: '◉', label: '仅互关好友可见', className: 'friends' },
  };
  return statuses[permission] || { icon: '—', label: '权限未知', className: 'unknown' };
}

function setPageState(message) {
  const el = $('#pageState');
  // 以省略号结尾视为进行中状态，交由 CSS 播放动效
  const busy = typeof message === 'string' && message.endsWith('…');
  el.textContent = busy ? message.slice(0, -1) : message;
  el.classList.toggle('is-busy', busy);
}
function escapeHtml(value) { const element = document.createElement('span'); element.textContent = value; return element.innerHTML; }
function escapeAttribute(value) { return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }