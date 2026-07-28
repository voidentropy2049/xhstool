/**
 * 小红书管家 - 内容脚本
 * 注入小红书页面，提供文章选择、状态标记和批量操作功能
 */

(function () {
  'use strict';

  // 扩展重载后旧内容脚本可能仍留在页面中，让最新注入实例接管消息。
  const instanceToken = {};
  globalThis.__xhsToolActiveToken = instanceToken;

  // ===== 状态 =====
  let isSelectMode = false;
  let selectedIds = new Set();
  let articleElements = new Map(); // element -> articleData
  let toolbarEl = null;
  let settings = {};
  let statuses = [];
  let observer = null;
  let isInitialized = false;
  let creatorLoadPromise = null;

  // ===== 页面世界桥接 =====
  const PERMISSION_REQUEST = 'xhs-tool-permission-request';
  const PERMISSION_RESPONSE = 'xhs-tool-permission-response';
  const PERMISSION_STATUS_REQUEST = 'xhs-tool-permission-status-request';
  const NOTE_ACTION_REQUEST = 'xhs-tool-note-action-request';
  const NOTES_REQUEST = 'xhs-tool-notes-request';
  const BATCH_ACTION_INTERVAL_MS = 300;
  let bridgeReady = null;
  let bridgeSeq = 0;

  // ===== 配置 =====
  const SELECTORS = {
    // 小红书文章卡片可能的选择器列表（按权重排序）
    articleCards: [
      '.note-card',
      'section.note-item',
      'div.note-item',
      'div[class*="note-item"]',
      'a[href*="/explore/"]',
      'div.feeds-page section',
      'section[class*="note"]',
    ],
    // 文章标题
    title: [
      '.title',
      'h3',
      '.note-title',
      '[class*="title"]',
    ],
    // 作者名
    author: [
      '.author',
      '.name',
      '.username',
      '[class*="author"]',
      '[class*="user"]',
    ],
    // 封面图
    cover: [
      'img',
      '.cover img',
      '[class*="cover"] img',
    ],
    // 点赞数
    likes: [
      '.like-count',
      '.likes',
      '.count',
      '[class*="like"]',
    ],
  };

  // ===== 初始化 =====
  async function init() {
    if (isInitialized) return;
    isInitialized = true;

    // 先注册消息监听，避免后续初始化异常导致内容脚本静默失效
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (globalThis.__xhsToolActiveToken !== instanceToken) return false;
      Promise.resolve(handleMessage(message, sender))
        .then(sendResponse)
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
    });

    // 加载设置和状态配置
    await loadConfig();

    // 注入工具栏
    createToolbar();

    // 扫描现有文章
    scanArticles();

    // 监听 DOM 变化（处理动态加载）
    observeDomChanges();

    console.log('[小红书管家] 已加载');
  }

  async function loadConfig() {
    try {
      const result = await chrome.storage.local.get([
        'xhs_settings',
        'xhs_statuses',
      ]);
      settings = result.xhs_settings || XHS.DEFAULT_SETTINGS;
      statuses = result.xhs_statuses || XHS.DEFAULT_STATUSES;
    } catch (e) {
      settings = XHS.DEFAULT_SETTINGS;
      statuses = XHS.DEFAULT_STATUSES;
    }
  }

  // ===== DOM 观察 =====
  function observeDomChanges() {
    observer = new MutationObserver((mutations) => {
      let hasNewNodes = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          hasNewNodes = true;
          break;
        }
      }
      if (hasNewNodes) {
        // 延迟扫描，等待 DOM 渲染完成
        setTimeout(scanArticles, 500);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // ===== 扫描文章 =====
  function scanArticles() {
    if (
      !isSelectMode &&
      !settings.showStatusBadge &&
      location.hostname !== 'creator.xiaohongshu.com'
    ) return;

    const cards = findArticleCards();
    let newCount = 0;

    for (const card of cards) {
      if (articleElements.has(card)) continue;

      const data = extractArticleData(card);
      if (!data) continue;

      articleElements.set(card, data);
      setupCard(card, data);
      newCount++;
    }

    if (newCount > 0) {
      console.log(`[小红书管家] 发现 ${newCount} 篇新文章`);
    }
  }

  async function loadAllCreatorArticles() {
    if (location.hostname !== 'creator.xiaohongshu.com') return;
    if (creatorLoadPromise) return creatorLoadPromise;

    creatorLoadPromise = (async () => {
      const scrollHost = findCreatorScrollHost();
      let stableRounds = 0;
      let previousCount = 0;
      let previousHeight = 0;

      for (let round = 0; round < 40 && stableRounds < 3; round++) {
        scanArticles();
        const currentCount = document.querySelectorAll('.note-card').length;
        const currentHeight = scrollHost
          ? scrollHost.scrollHeight
          : document.documentElement.scrollHeight;

        if (currentCount === previousCount && currentHeight === previousHeight) stableRounds++;
        else stableRounds = 0;
        previousCount = currentCount;
        previousHeight = currentHeight;

        if (scrollHost) scrollHost.scrollTop = scrollHost.scrollHeight;
        window.scrollTo(0, document.documentElement.scrollHeight);
        await wait(650);
      }
      scanArticles();
    })().finally(() => {
      creatorLoadPromise = null;
    });

    return creatorLoadPromise;
  }

  function findCreatorScrollHost() {
    const card = document.querySelector('.note-card');
    let current = card?.parentElement;
    while (current && current !== document.body) {
      const style = getComputedStyle(current);
      if (current.scrollHeight > current.clientHeight + 20 && /(auto|scroll)/.test(style.overflowY)) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function findArticleCards() {
    if (location.hostname === 'creator.xiaohongshu.com') {
      return Array.from(document.querySelectorAll('.note-card'));
    }

    const cards = [];
    const seen = new Set();

    for (const selector of SELECTORS.articleCards) {
      try {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          // 确保有链接到文章
          const link = el.tagName === 'A' ? el : el.querySelector('a');
          if (link && link.href && link.href.includes('/explore/') && !seen.has(el)) {
            cards.push(el);
            seen.add(el);
          }
        }
      } catch (e) {
        // 忽略无效选择器
      }
    }

    return cards;
  }

  function extractArticleData(card) {
    const link = card.tagName === 'A' ? card : card.querySelector('a');
    const isCreatorPage = location.hostname === 'creator.xiaohongshu.com';
    if (!link && !isCreatorPage) return null;

    const url = link?.href || '';

    // 提取标题
    let title = '';
    for (const sel of SELECTORS.title) {
      const el = card.querySelector(sel);
      if (el && el.textContent) {
        title = el.textContent.trim();
        break;
      }
    }

    if (isCreatorPage) {
      title = card.querySelector('.note-card__title')?.textContent.trim() || title;
    }

    const time = card.querySelector('.note-card__time')?.textContent.trim() || '';
    const id = isCreatorPage
      ? getNoteId(card) || `creator_${title}_${time}`
      : XHS.generateId(url);

    // 提取作者
    let author = '';
    for (const sel of SELECTORS.author) {
      const el = card.querySelector(sel);
      if (el && el.textContent) {
        author = el.textContent.trim();
        break;
      }
    }

    // 提取封面图
    let coverImage = '';
    for (const sel of SELECTORS.cover) {
      const el = card.querySelector(sel);
      if (el) {
        coverImage = el.src || el.getAttribute('data-src') || '';
        if (coverImage) break;
      }
    }

    return {
      id,
      url,
      title: title || url.split('/explore/')[1] || '未命名文章',
      time,
      author,
      coverImage,
      pinned: isCreatorPage && card.getAttribute('show-top') === 'true',
      status: 'unread',
    };
  }

  // ===== 设置卡片 UI =====
  function setupCard(card, data) {
    card.dataset.xhsArticleId = data.id;
    upgradeCreatorAssetUrls(card);
    // 确保卡片是相对定位
    if (window.getComputedStyle(card).position === 'static') {
      card.style.position = 'relative';
    }

    // 添加复选框
    addCheckbox(card, data);

    // 添加状态徽章
    if (settings.showStatusBadge && location.hostname !== 'creator.xiaohongshu.com') {
      addStatusBadge(card, data);
    }
  }

  function upgradeCreatorAssetUrls(card) {
    if (location.hostname !== 'creator.xiaohongshu.com') return;
    card.querySelectorAll('img[src^="http://sns-"]').forEach((image) => {
      image.src = image.src.replace(/^http:\/\//, 'https://');
    });
    card.querySelectorAll('[style*="http://sns-"]').forEach((element) => {
      element.style.backgroundImage = element.style.backgroundImage.replace(/http:\/\//g, 'https://');
    });
  }

  function addCheckbox(card, data) {
    const checkbox = document.createElement('div');
    checkbox.className = 'xhs-checkbox-overlay';
    checkbox.dataset.articleId = data.id;
    checkbox.title = '选择此文章';

    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      toggleSelect(data.id, checkbox);
    });

    card.appendChild(checkbox);

    if (isSelectMode) {
      checkbox.classList.add('visible');
    }
  }

  function addStatusBadge(card, data) {
    // 先移除旧的 badge
    const oldBadge = card.querySelector('.xhs-status-badge');
    if (oldBadge) oldBadge.remove();

    // 从存储中获取文章状态
    getArticleStatus(data.id).then((status) => {
      if (!status || status === 'unread') return;

      const statusConfig = statuses.find((s) => s.id === status);
      if (!statusConfig) return;

      const badge = document.createElement('div');
      badge.className = 'xhs-status-badge';
      badge.textContent = `${statusConfig.icon || ''} ${statusConfig.label}`;
      badge.style.backgroundColor = statusConfig.color;
      card.appendChild(badge);
    });
  }

  async function getArticleStatus(articleId) {
    try {
      const result = await chrome.storage.local.get('xhs_articles');
      const articles = result.xhs_articles || [];
      const article = articles.find((a) => a.id === articleId);
      return article ? article.status : null;
    } catch (e) {
      return null;
    }
  }

  // ===== 选择功能 =====
  function toggleSelect(id, checkboxEl) {
    if (selectedIds.has(id)) {
      selectedIds.delete(id);
      checkboxEl.classList.remove('checked');
    } else {
      selectedIds.add(id);
      checkboxEl.classList.add('checked');
    }
    updateToolbarCount();
  }

  function selectAll() {
    const checkboxes = document.querySelectorAll('.xhs-checkbox-overlay');
    checkboxes.forEach((cb) => {
      const id = cb.dataset.articleId;
      if (id) {
        selectedIds.add(id);
        cb.classList.add('checked');
      }
    });
    updateToolbarCount();
  }

  function deselectAll() {
    document.querySelectorAll('.xhs-checkbox-overlay').forEach((cb) => {
      cb.classList.remove('checked');
    });
    selectedIds.clear();
    updateToolbarCount();
  }

  // ===== 工具栏 =====
  function createToolbar() {
    toolbarEl = document.createElement('div');
    toolbarEl.className = 'xhs-toolbar';
    toolbarEl.innerHTML = `
      <span class="xhs-toolbar-title">📋 小红书管家</span>
      <span class="xhs-toolbar-count">已选 <strong>0</strong> 篇</span>
      <button class="xhs-btn-primary" data-action="select-all">全选</button>
      <button data-action="deselect-all">取消选择</button>
      <span class="xhs-toolbar-spacer"></span>
      <select data-action="batch-status">
        <option value="">— 批量设置状态 —</option>
      </select>
      <button class="xhs-btn-primary" data-action="apply-status">应用状态</button>
      <button data-action="batch-export">导出选中</button>
      <button class="xhs-btn-danger" data-action="batch-delete">删除</button>
      <span class="xhs-toolbar-spacer"></span>
      <button data-action="close-toolbar" class="xhs-toolbar-close">✕</button>
    `;

    document.body.appendChild(toolbarEl);

    // 绑定事件
    toolbarEl.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      if (!action) return;

      switch (action) {
        case 'select-all':
          selectAll();
          break;
        case 'deselect-all':
          deselectAll();
          break;
        case 'apply-status':
          handleBatchStatus();
          break;
        case 'batch-export':
          handleBatchExport();
          break;
        case 'batch-delete':
          handleBatchDelete();
          break;
        case 'close-toolbar':
          deactivateSelectMode();
          break;
      }
    });

    // 加载状态选项
    loadStatusOptions();
  }

  async function loadStatusOptions() {
    const select = toolbarEl.querySelector('[data-action="batch-status"]');
    if (!select) return;

    try {
      const result = await chrome.storage.local.get('xhs_statuses');
      const statusList = result.xhs_statuses || XHS.DEFAULT_STATUSES;

      statusList.forEach((s) => {
        const option = document.createElement('option');
        option.value = s.id;
        option.textContent = `${s.icon} ${s.label}`;
        select.appendChild(option);
      });
    } catch (e) {
      // 使用默认状态
      XHS.DEFAULT_STATUSES.forEach((s) => {
        const option = document.createElement('option');
        option.value = s.id;
        option.textContent = `${s.icon} ${s.label}`;
        select.appendChild(option);
      });
    }
  }

  function updateToolbarCount() {
    const countEl = toolbarEl?.querySelector('.xhs-toolbar-count strong');
    if (countEl) {
      countEl.textContent = selectedIds.size;
    }
  }

  // ===== 批量操作 =====
  async function handleBatchStatus() {
    const select = toolbarEl.querySelector('[data-action="batch-status"]');
    const status = select.value;

    if (!status) {
      showToast('请先选择一个状态');
      return;
    }

    if (selectedIds.size === 0) {
      showToast('请先选择文章');
      return;
    }

    try {
      await chrome.runtime.sendMessage({
        type: XHS.MSG_TYPES.BATCH_UPDATE_STATUS,
        payload: { ids: Array.from(selectedIds), status },
      });

      // 更新状态徽章
      for (const [card, data] of articleElements) {
        if (selectedIds.has(data.id)) {
          data.status = status;
          addStatusBadge(card, data);
        }
      }

      showToast(`✅ 已更新 ${selectedIds.size} 篇文章状态`);
      deselectAll();
    } catch (e) {
      showToast('❌ 操作失败: ' + e.message);
    }
  }

  async function handleBatchExport() {
    if (selectedIds.size === 0) {
      showToast('请先选择文章');
      return;
    }

    try {
      await chrome.runtime.sendMessage({
        type: XHS.MSG_TYPES.EXPORT_ARTICLES,
        payload: { format: 'csv', ids: Array.from(selectedIds) },
      });
      showToast(`📥 正在导出 ${selectedIds.size} 篇文章`);
    } catch (e) {
      showToast('❌ 导出失败: ' + e.message);
    }
  }

  async function handleBatchDelete() {
    if (selectedIds.size === 0) {
      showToast('请先选择文章');
      return;
    }

    if (!confirm(`确定要删除选中的 ${selectedIds.size} 篇文章吗？此操作不可撤销。`)) {
      return;
    }

    try {
      await chrome.runtime.sendMessage({
        type: XHS.MSG_TYPES.DELETE_ARTICLES,
        payload: Array.from(selectedIds),
      });

      // 移除复选框和徽章
      for (const [card, data] of articleElements) {
        if (selectedIds.has(data.id)) {
          const cb = card.querySelector('.xhs-checkbox-overlay');
          const badge = card.querySelector('.xhs-status-badge');
          if (cb) cb.remove();
          if (badge) badge.remove();
          articleElements.delete(card);
        }
      }

      showToast(`🗑️ 已删除 ${selectedIds.size} 篇文章`);
      deselectAll();
    } catch (e) {
      showToast('❌ 删除失败: ' + e.message);
    }
  }

  // ===== 选择模式切换 =====
  function activateSelectMode() {
    isSelectMode = true;

    // 显示所有复选框
    document.querySelectorAll('.xhs-checkbox-overlay').forEach((cb) => {
      cb.classList.add('visible');
    });

    // 显示工具栏
    if (toolbarEl) {
      toolbarEl.classList.add('active');
    }

    // 扫描文章（如果之前没扫过）
    scanArticles();
  }

  function deactivateSelectMode() {
    isSelectMode = false;
    deselectAll();

    // 隐藏复选框
    document.querySelectorAll('.xhs-checkbox-overlay').forEach((cb) => {
      cb.classList.remove('visible');
    });

    // 隐藏工具栏
    if (toolbarEl) {
      toolbarEl.classList.remove('active');
    }
  }

  // ===== 消息处理 =====
  async function handleMessage(message, sender, sendResponse) {
    switch (message.type) {
      case XHS.MSG_TYPES.GET_PAGE_ARTICLES:
        // 返回当前页面的文章列表
        await loadAllCreatorArticles();
        await loadCreatorStatuses();
        const articles = Array.from(articleElements.values());
        return { success: true, data: articles };

      case XHS.MSG_TYPES.TOGGLE_SELECT_MODE:
        if (message.payload?.active) {
          activateSelectMode();
        } else {
          deactivateSelectMode();
        }
        return { success: true, data: isSelectMode };

      case 'runCreatorBatchAction':
        return handleCreatorBatchAction(message.payload);

      default:
        return { success: false, error: '未知消息' };
    }
  }

  async function handleCreatorBatchAction(payload) {
    if (location.hostname !== 'creator.xiaohongshu.com') {
      return { success: false, error: '请在创作者后台的笔记管理页使用' };
    }

    if (!['permission', 'pin', 'delete'].includes(payload?.action)) {
      return { success: false, error: '暂不支持该管理操作' };
    }

    const cards = [...document.querySelectorAll('.note-card')];
    const targetIds = new Set(payload.ids || []);
    const selectedCards = cards.filter(
      (card) => targetIds.has(card.dataset.xhsArticleId) || targetIds.has(getNoteId(card)),
    );
    if (selectedCards.length === 0) {
      return { success: false, error: '当前页找不到选中的笔记，请刷新列表' };
    }

    if (payload.action === 'permission') {
      const permissionResult = await updatePermissions(selectedCards, payload.value);
      await loadCreatorStatuses();
      return {
        success: permissionResult.failed === 0,
        data: {
          message: `已完成 ${permissionResult.completed} 篇，失败 ${permissionResult.failed} 篇`,
          updatedIds: selectedCards.filter((card) => getNoteId(card)).map((card) => getNoteId(card)),
          permissions: selectedCards.reduce((result, card) => {
            const noteId = getNoteId(card);
            if (noteId) result[noteId] = articleElements.get(card)?.permission ?? null;
            return result;
          }, {}),
        },
      };
    }

    await ensureBridge();
    let completed = 0;
    let failed = 0;
    const updatedIds = [];
    for (let index = 0; index < selectedCards.length; index++) {
      const card = selectedCards[index];
      reportBatchProgress(payload.action, index + 1, selectedCards.length);
      const noteId = getNoteId(card);
      if (!noteId) {
        failed++;
        continue;
      }
      try {
        await requestNoteAction(noteId, payload.action, payload.value);
        completed++;
        updatedIds.push(noteId);
      } catch (error) {
        failed++;
      }
      await wait(BATCH_ACTION_INTERVAL_MS);
    }

    return {
      success: failed === 0,
      data: {
        message: `已完成 ${completed} 篇，失败 ${failed} 篇`,
        updatedIds,
        pinned: payload.action === 'pin' && payload.value !== '0',
        deletedIds: payload.action === 'delete' ? updatedIds : [],
      },
    };
  }

  async function updatePermissions(cards, value) {
    const privacy = value === 'private' ? 1 : value === 'friends' ? 4 : 0;
    await ensureBridge();

    let completed = 0;
    let failed = 0;

    for (let index = 0; index < cards.length; index++) {
      const card = cards[index];
      reportBatchProgress('permission', index + 1, cards.length);
      const noteId = getNoteId(card);
      if (!noteId) {
        failed++;
        continue;
      }
      try {
        await requestPermissionChange(noteId, privacy);
        completed++;
      } catch (error) {
        failed++;
      }
      await wait(BATCH_ACTION_INTERVAL_MS);
    }

    return { completed, failed };
  }

  function reportBatchProgress(action, current, total) {
    chrome.runtime.sendMessage({
      type: 'creatorBatchProgress',
      payload: { action, current, total },
    }).catch(() => {});
  }

  async function loadPermissionStatuses() {
    const entries = [...articleElements.entries()]
      .map(([card, data]) => ({ card, data, noteId: getNoteId(card) }))
      .filter((entry) => entry.noteId);
    await ensureBridge();
    for (let index = 0; index < entries.length; index += 8) {
      await Promise.all(entries.slice(index, index + 8).map(async ({ data, noteId }) => {
        try {
          data.permission = await requestPermissionStatus(noteId);
        } catch (error) {
          data.permission = null;
        }
      }));
    }
  }

  async function loadCreatorStatuses() {
    try {
      await ensureBridge();
      const notes = [];
      for (let page = 0; page < 40; page++) {
        const pageNotes = await requestCreatorNotes(page);
        notes.push(...pageNotes);
        if (pageNotes.length === 0) break;
      }
      const statusById = new Map(notes.map((note) => [String(note.id), note]));
      for (const [card, data] of articleElements.entries()) {
        const note = statusById.get(getNoteId(card));
        if (!note) continue;
        data.permission = Number(note.permission_code);
        data.pinned = note.sticky === true;
      }
      // 创作者列表接口的 permission_code 与 permission_msg 是后台列表实际展示值。
    } catch (error) {
      await loadPermissionStatuses();
    }
  }

  async function refreshPermissionStatuses(cards) {
    await ensureBridge();
    await Promise.all(cards.map(async (card) => {
      const data = articleElements.get(card);
      const noteId = getNoteId(card);
      if (!data || !noteId) return;
      try {
        data.permission = await requestPermissionStatus(noteId);
      } catch (error) {
        data.permission = null;
      }
    }));
  }

  function getNoteId(card) {
    try {
      const impression = JSON.parse(card.dataset.impression || '{}');
      return impression?.noteTarget?.value?.noteId || '';
    } catch (error) {
      return '';
    }
  }

  function ensureBridge() {
    if (bridgeReady) return bridgeReady;

    bridgeReady = (async () => {
      const response = await chrome.runtime.sendMessage({ type: 'ensurePageBridge' });
      if (!response?.success) throw new Error(response?.error || '无法注入页面脚本');
    })().catch((error) => {
      bridgeReady = null;
      throw error;
    });

    return bridgeReady;
  }

  function requestPermissionChange(noteId, privacy) {
    return new Promise((resolve, reject) => {
      const id = `xhs_${Date.now()}_${bridgeSeq++}`;

      const onMessage = (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.type !== PERMISSION_RESPONSE || data.id !== id) return;

        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        if (data.success) resolve();
        else reject(new Error(data.error || '权限设置失败'));
      };

      const timer = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        reject(new Error('页面响应超时'));
      }, 15000);

      window.addEventListener('message', onMessage);
      window.postMessage({ type: PERMISSION_REQUEST, id, noteId, privacy }, location.origin);
    });
  }

  function requestPermissionStatus(noteId) {
    return new Promise((resolve, reject) => {
      const id = `xhs_status_${Date.now()}_${bridgeSeq++}`;
      const onMessage = (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (data?.type !== PERMISSION_RESPONSE || data.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        const permission = Number(data.permission);
        if (data.success && Number.isInteger(permission) && permission >= 0 && permission <= 4) resolve(permission);
        else reject(new Error(data.error || '读取权限失败'));
      };
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        reject(new Error('读取权限超时'));
      }, 15000);
      window.addEventListener('message', onMessage);
      window.postMessage({ type: PERMISSION_STATUS_REQUEST, id, noteId }, location.origin);
    });
  }

  function requestCreatorNotes(page) {
    return new Promise((resolve, reject) => {
      const id = `xhs_notes_${Date.now()}_${bridgeSeq++}`;
      const onMessage = (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (data?.type !== PERMISSION_RESPONSE || data.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        if (data.success && Array.isArray(data.notes)) resolve(data.notes);
        else reject(new Error(data.error || '读取笔记状态失败'));
      };
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        reject(new Error('读取笔记状态超时'));
      }, 15000);
      window.addEventListener('message', onMessage);
      window.postMessage({ type: NOTES_REQUEST, id, page }, location.origin);
    });
  }

  function requestNoteAction(noteId, action, value) {
    return new Promise((resolve, reject) => {
      const id = `xhs_action_${Date.now()}_${bridgeSeq++}`;
      const onMessage = (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (data?.type !== PERMISSION_RESPONSE || data.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        if (data.success) resolve();
        else reject(new Error(data.error || '笔记操作失败'));
      };
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        reject(new Error('页面响应超时'));
      }, 15000);
      window.addEventListener('message', onMessage);
      window.postMessage({ type: NOTE_ACTION_REQUEST, id, noteId, action, value }, location.origin);
    });
  }

  function wait(duration) {
    return new Promise((resolve) => setTimeout(resolve, duration));
  }

  // ===== Toast 提示 =====
  function showToast(message, duration) {
    duration = duration || 2500;

    const existing = document.querySelector('.xhs-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'xhs-toast';
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 9999999;
      background: rgba(0, 0, 0, 0.8);
      color: #fff;
      padding: 10px 24px;
      border-radius: 8px;
      font-size: 14px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      animation: xhsFadeIn 0.2s ease;
      pointer-events: none;
    `;

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // 添加 Toast 动画
  const style = document.createElement('style');
  style.textContent = `
    @keyframes xhsFadeIn {
      from { opacity: 0; transform: translateX(-50%) translateY(10px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
  `;
  document.head.appendChild(style);

  // ===== 自动保存文章 =====
  async function autoSaveArticles() {
    if (!settings.autoSave) return;

    const articles = Array.from(articleElements.values());
    if (articles.length === 0) return;

    try {
      await chrome.runtime.sendMessage({
        type: XHS.MSG_TYPES.SAVE_ARTICLES,
        payload: articles,
      });
    } catch (e) {
      // 静默处理
    }
  }

  // ===== 页面离开时触发 =====
  window.addEventListener('beforeunload', () => {
    autoSaveArticles();
  });

  // 定期保存（每 30 秒）
  setInterval(autoSaveArticles, 30000);

  // ===== 启动 =====
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
