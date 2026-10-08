/* ══════════════════════════════════════════════════════════════════
   notice.js · 学生端「提醒」面板
   ──────────────────────────────────────────────────────────────────
   规则（与需求一致）：
     · 管理员在「提醒学生」页群发提醒
     · 学生未登录 → 登录后右上角立即显示
     · 学生已登录 → 直接在右上角显示（每 60s 静默拉取一次新提醒）
     · 只能通过右上角「✕」关闭，绝不自动关闭
     · 未关闭的提醒，下次登录继续显示，直到学生手动关闭
   ══════════════════════════════════════════════════════════════════ */
(function (w, d) {
  'use strict';

  var U = w.U;
  var UI = w.UI;
  var API = w.API;
  var STORE = w.STORE;

  var N = {};

  var PRI = {
    1: { t: '普通', ico: '📝', cls: 'np1' },
    2: { t: '重要', ico: '❗', cls: 'np2' },
    3: { t: '紧急', ico: '🚨', cls: 'np3' },
  };

  var state = {
    items: [],
    mounted: false,
    timer: null,
    loading: false,
    closing: {},          // 正在关闭中的 id，避免重复请求
    closed: {},           // 本次会话已关闭的 id，防止轮询把提醒"复活"
  };

  function dock() { return d.getElementById('noticeDock'); }

  function pri(p) { return PRI[Number(p)] || PRI[1]; }

  function itemHtml(n) {
    var p = pri(n.priority);
    return '<div class="notice-card sketch ' + p.cls + '" data-notice="' + n.id + '">' +
      '<span class="nc-tape" aria-hidden="true"></span>' +
      '<button class="nc-close" type="button" data-notice-close="' + n.id +
        '" aria-label="关闭这条提醒" title="关闭">✕</button>' +
      '<div class="nc-head">' +
        '<span class="nc-bell">🔔</span>' +
        '<span class="nc-title">来自' + U.esc(n.adminName || '管理员') + '的提醒</span>' +
        '<span class="nc-pri">' + p.ico + ' ' + p.t + '</span>' +
      '</div>' +
      '<div class="nc-body">' + U.esc(n.content) + '</div>' +
      '<div class="nc-foot">' +
        '<span>' + U.esc(U.fmtDT(n.createdAt, true)) + '</span>' +
        '<span class="nc-hint">关闭后不再显示</span>' +
      '</div>' +
    '</div>';
  }

  /** 渲染面板（无提醒时隐藏） */
  function paint() {
    var box = dock();
    if (!box) return;
    if (!state.items.length) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    var html = '';
    // 多条提醒时给一个可折叠的标题条
    if (state.items.length > 1) {
      html += '<div class="notice-dock-head">' +
        '<span>🔔 你有 ' + state.items.length + ' 条未关闭的提醒</span>' +
        '</div>';
    }
    html += state.items.map(itemHtml).join('');
    box.innerHTML = html;
    box.hidden = false;
  }

  /** 拉取未关闭的提醒 */
  N.refresh = function () {
    if (!STORE.user || STORE.user.role !== 'student') return Promise.resolve(null);
    if (state.loading) return Promise.resolve(null);
    state.loading = true;
    return API.student.notices().then(function (r) {
      // 过滤掉本次会话已关闭的：轮询返回的数据可能早于 dismiss 提交，
      // 不过滤会把刚关掉的提醒重新显示出来
      state.items = (r.items || []).filter(function (x) { return !state.closed[Number(x.id)]; });
      paint();
      return state.items;
    }).catch(function () {
      /* 静默失败：不影响主流程，下次轮询会重试 */
      return null;
    }).then(function (v) {
      state.loading = false;
      return v;
    });
  };

  /** 只关闭单条（叉号）：本地移除 + 通知服务端 */
  function closeOne(id) {
    id = Number(id);
    if (!id || state.closing[id]) return;
    state.closing[id] = 1;

    var box = dock();
    var card = box ? box.querySelector('[data-notice="' + id + '"]') : null;

    function drop() {
      state.items = state.items.filter(function (x) { return Number(x.id) !== id; });
      if (card) {
        card.classList.add('closing');
        // 动画结束后再按「最新 state」重绘：期间若有轮询覆盖 items，这里再过滤一次
        setTimeout(function () {
          state.items = state.items.filter(function (x) { return Number(x.id) !== id; });
          paint();
        }, 220);
      } else {
        paint();
      }
    }

    API.student.noticeDismiss(id).then(function () {
      state.closed[id] = 1;
      drop();
      UI.toast('提醒已关闭，下次登录不再显示', 'ok', '已关闭', 2400);
    }).catch(function (e) {
      delete state.closing[id];
      state.lastErr = String((e && e.message) || e || '未知错误');
      UI.errToast(e);
    });
  }

  /** 事件绑定（只需执行一次） */
  N.mount = function () {
    if (state.mounted) return;
    var box = dock();
    if (!box) return;
    state.mounted = true;

    box.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-notice-close]') : null;
      if (!b) return;
      e.stopPropagation();
      state.hits = (state.hits || 0) + 1;
      closeOne(b.dataset.noticeClose);
    });

    // 页面重新可见 / 收到刷新广播时，立即补一次
    d.addEventListener('visibilitychange', function () {
      if (!d.hidden && STORE.user && STORE.user.role === 'student') N.refresh();
    });
    w.addEventListener('lsp:refresh', function () {
      if (STORE.user && STORE.user.role === 'student') N.refresh();
    });
  };

  /** 登录后调用：立即显示 + 开启静默轮询 */
  N.start = function () {
    N.mount();
    if (!STORE.user || STORE.user.role !== 'student') {
      N.stop();
      var box = dock();
      if (box) { box.hidden = true; box.innerHTML = ''; }
      return;
    }
    if (state.timer) clearInterval(state.timer);
    // 60s 静默刷新：管理员在学生在登录状态也能即时看到新提醒
    state.timer = setInterval(function () {
      if (d.hidden) return;
      N.refresh();
    }, 60000);
    return N.refresh();
  };

  /** 退出登录 / 切换管理员时清理 */
  N.stop = function () {
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    state.items = [];
    state.closing = {};
    state.closed = {};
    state.loading = false;
    var box = dock();
    if (box) { box.hidden = true; box.innerHTML = ''; }
  };

  N.count = function () { return state.items.length; };
  N.items = function () { return state.items.slice(); };
  /** 排障用：面板内部状态快照 */
  N.debug = function () {
    return {
      mounted: state.mounted, hasDock: !!dock(), role: STORE.user ? STORE.user.role : null,
      hits: state.hits || 0, loading: state.loading,
      closing: Object.keys(state.closing), closed: Object.keys(state.closed),
      items: state.items.map(function (x) { return Number(x.id); }),
      lastErr: state.lastErr || '',
    };
  };

  w.NoticePanel = N;
})(window, document);
