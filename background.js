/**
 * 小红书管家 - Background Service Worker
 * 处理消息路由、数据同步等后台逻辑
 */

// 从 storage.js 导入函数（全局 XHS 对象）
importScripts('lib/storage.js');

const MSG = XHS.MSG_TYPES;
MSG.RUN_CREATOR_BATCH_ACTION = 'runCreatorBatchAction';
let sidePanelTabId = null;

chrome.action.onClicked.addListener((tab) => {
  sidePanelTabId = tab.id;
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
});

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  if (sidePanelTabId === null || tabId === sidePanelTabId) return;
  sidePanelTabId = null;
  chrome.sidePanel.close({ windowId }).catch(() => {});
});

// 监听消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse(result))
    .catch((error) =>
      sendResponse({ success: false, error: error.message })
    );
  return true;
});

async function handleMessage(message, sender) {
  const { type, payload } = message;
  const S = XHS; // storage 模块别名

  switch (type) {
    case MSG.GET_ARTICLES:
      return { success: true, data: await S.getAllArticles() };

    case MSG.SAVE_ARTICLE:
      return { success: true, data: await S.saveArticle(payload) };

    case MSG.SAVE_ARTICLES:
      return { success: true, data: await S.saveArticles(payload) };

    case MSG.BATCH_UPDATE_STATUS:
      return {
        success: true,
        data: await S.batchUpdateStatus(payload.ids, payload.status),
      };

    case MSG.DELETE_ARTICLES:
      return { success: true, data: await S.deleteArticles(payload) };

    case MSG.SEARCH_ARTICLES:
      return { success: true, data: await S.searchArticles(payload) };

    case MSG.GET_ARTICLES_BY_STATUS:
      return { success: true, data: await S.getArticlesByStatus(payload) };

    case MSG.EXPORT_ARTICLES:
      await S.exportArticles(payload.format, payload.ids);
      return { success: true };

    case MSG.GET_STATUSES:
      return { success: true, data: await S.getStatuses() };

    case MSG.SAVE_STATUSES:
      return { success: true, data: await S.saveStatuses(payload) };

    case MSG.RESET_STATUSES:
      return { success: true, data: await S.resetStatuses() };

    case MSG.GET_SETTINGS:
      return { success: true, data: await S.getSettings() };

    case MSG.SAVE_SETTINGS:
      return { success: true, data: await S.saveSettings(payload) };

    case MSG.GET_PAGE_ARTICLES:
      return await forwardToContent(sender.tab?.id, {
        type: MSG.GET_PAGE_ARTICLES,
      });

    case MSG.TOGGLE_SELECT_MODE:
      return await forwardToContent(sender.tab?.id, {
        type: MSG.TOGGLE_SELECT_MODE,
        payload,
      });

    case MSG.RUN_CREATOR_BATCH_ACTION:
      return await forwardToContent(sender.tab?.id, {
        type: MSG.RUN_CREATOR_BATCH_ACTION,
        payload,
      });

    case 'ensurePageBridge':
      return await injectPageBridge(sender.tab?.id);

    default:
      throw new Error(`未知消息类型: ${type}`);
  }
}

async function forwardToContent(tabId, message) {
  if (!tabId) {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    tabId = tab?.id;
  }
  if (!tabId) throw new Error('无法找到目标页面');

  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    // 页面在扩展加载前已打开时，内容脚本尚未注入，这里按需补注入后重试
    await injectContentScript(tabId);
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (retryError) {
      throw new Error('无法连接到页面，请确保在创作者后台的笔记管理页使用');
    }
  }
}

async function injectPageBridge(tabId) {
  if (!tabId) throw new Error('无法找到目标页面');
  try {
    // 注入到页面世界，才能复用页面自带的签名函数；此方式不受页面 CSP 限制
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      files: ['injected.js'],
    });
    return { success: true };
  } catch (e) {
    throw new Error('无法注入页面脚本，请刷新笔记管理页后重试');
  }
}

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['content.css'],
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['lib/storage.js', 'content.js'],
    });
  } catch (e) {
    throw new Error('无法连接到页面，请确保在创作者后台的笔记管理页使用');
  }
}

// 安装事件
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({
      xhs_articles: [],
      xhs_statuses: XHS.DEFAULT_STATUSES,
      xhs_settings: XHS.DEFAULT_SETTINGS,
    });
  }
});
