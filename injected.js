/**
 * 小红书管家 - 页面世界桥接脚本
 * 复用页面自带的签名函数 _webmsxyw，直接调用笔记权限接口
 * 只接受权限设置这一种操作，参数经过严格校验
 */

(function () {
  'use strict';

  // 避免重复注入时重复注册监听
  if (window.__xhsToolPermissionBridgeV2) return;
  window.__xhsToolPermissionBridgeV2 = true;

  const REQUEST_TYPE = 'xhs-tool-permission-request';
  const ACTION_REQUEST_TYPE = 'xhs-tool-note-action-request';
  const NOTES_REQUEST_TYPE = 'xhs-tool-notes-request';
  const RESPONSE_TYPE = 'xhs-tool-permission-response';
  const NOTE_ID_PATTERN = /^[0-9a-f]{24}$/;
  const ALLOWED_PRIVACY = [0, 1, 4];
  const API_ORIGINS = {
    edith: 'https://edith.xiaohongshu.com',
    creator: 'https://creator.xiaohongshu.com',
  };

  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== location.origin) return;

    const request = event.data;
    if (!request || ![REQUEST_TYPE, ACTION_REQUEST_TYPE, NOTES_REQUEST_TYPE, 'xhs-tool-permission-status-request'].includes(request.type)) return;

    const reply = (payload) => {
      window.postMessage(
        { type: RESPONSE_TYPE, id: request.id, ...payload },
        location.origin
      );
    };

    const noteId = String(request.noteId || '');
    const privacy = Number(request.privacy);

    if (request.type !== NOTES_REQUEST_TYPE && !NOTE_ID_PATTERN.test(noteId)) {
      reply({ success: false, error: '权限参数不合法' });
      return;
    }

    if (typeof window._webmsxyw !== 'function') {
      reply({ success: false, error: '页面未就绪，请刷新后重试' });
      return;
    }

    const isStatusRequest = request.type === 'xhs-tool-permission-status-request';
    const isActionRequest = request.type === ACTION_REQUEST_TYPE;
    const isNotesRequest = request.type === NOTES_REQUEST_TYPE;
    if (isActionRequest && !['pin', 'delete'].includes(request.action)) {
      reply({ success: false, error: '管理操作不合法' });
      return;
    }
    if (!isStatusRequest && !isNotesRequest && !ALLOWED_PRIVACY.includes(privacy)) {
      if (!isActionRequest) {
        reply({ success: false, error: '权限参数不合法' });
        return;
      }
    }

    const actionPath = isActionRequest
      ? request.action === 'pin'
        ? `/api/galaxy/creator/sns/note/top?note_id=${noteId}&sticky=${request.value === '0' ? 0 : 1}`
        : `/web_api/sns/capa/postgw/note/delete?note_id=${noteId}`
      : '';
    const notesPage = Number.isInteger(Number(request.page)) && Number(request.page) >= 0
      ? Number(request.page)
      : 0;
    const path = isNotesRequest
      ? `/api/galaxy/v2/creator/note/user/posted?tab=0&page=${notesPage}`
      : isStatusRequest
      ? `/web_api/sns/capa/postgw/note/access_control/visible_info?note_id=${noteId}&privacy_type=0`
      : isActionRequest
        ? actionPath
        : `/web_api/sns/v1/note/privacy?note_id=${noteId}&privacy=${privacy}&user_ids=&source=2`;

    try {
      const sign = window._webmsxyw(path, '');
      const origin = path.startsWith('/api/galaxy/') ? API_ORIGINS.creator : API_ORIGINS.edith;
      const response = await fetch(origin + path, {
        method: isStatusRequest || isNotesRequest ? 'GET' : 'POST',
        credentials: 'include',
        headers: {
          'X-s': sign['X-s'],
          'X-t': String(sign['X-t']),
          'content-type': 'application/x-www-form-urlencoded',
        },
      });
      const body = await response.json();
      const success = response.ok && (body.success === true || body.success === 1 || body.code === 0);
      const visibleType = body.data?.visible?.type
        ?? body.data?.visible_info?.type
        ?? body.data?.type;
      reply(
        success && isNotesRequest
          ? { success: true, notes: body.data?.notes || [] }
          : success && isStatusRequest
          ? { success: true, permission: Number(visibleType) }
          : success
            ? { success: true }
            : { success: false, error: body.msg || `请求失败（${response.status}）` }
      );
    } catch (error) {
      reply({ success: false, error: error.message });
    }
  });
})();
