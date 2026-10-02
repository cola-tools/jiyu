/* ══════════════════════════════════════════════════════════════════
   ui.js · 交互组件层
   ──────────────────────────────────────────────────────────────────
   Toast / Modal（支持嵌套栈）/ Confirm / Prompt / Drawer / 复制
   主题按钮绑定 / 后端状态指示灯 / 滚动锁定
   依赖 util.js、store.js
   ══════════════════════════════════════════════════════════════════ */
(function (w, d) {
  'use strict';

  var U = w.U;
  var STORE = w.STORE;

  function $(s) { return d.querySelector(s); }

  var UI = {};

  /* ═══════════ 1. Toast ═══════════ */

  var TOAST_ICO = { ok: '✅', err: '⛔', warn: '⚠️', info: '💡' };

  /**
   * UI.toast('已打卡', 'ok', '打卡成功')
   * @param {string} msg
   * @param {string} type ok | err | warn | info
   * @param {string} title 可选标题
   * @param {number} ms 停留毫秒（默认按长度自适应，最长 8s）
   */
  UI.toast = function (msg, type, title, ms) {
    var t = type || 'info';
    var box = $('#toasts');
    if (!box) {
      box = U.el('div', { class: 'toasts', id: 'toasts' });
      d.body.appendChild(box);
    }

    var node = U.el('div', { class: 'toast ' + t, role: 'status' });
    U.append(node,
      '<span class="t-ico">' + (TOAST_ICO[t] || '💡') + '</span>' +
      '<div class="t-body">' +
        (title ? '<div class="t-title">' + U.esc(title) + '</div>' : '') +
        '<div class="t-msg">' + U.esc(msg == null ? '' : msg) + '</div>' +
      '</div>'
    );
    box.appendChild(node);

    var life = ms || Math.min(8000, 2600 + String(msg || '').length * 46);
    var timer = setTimeout(close, life);

    node.addEventListener('click', close);

    function close() {
      clearTimeout(timer);
      if (node.classList.contains('out')) return;
      node.classList.add('out');
      setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 280);
    }
    return close;
  };

  UI.ok = function (m, t) { return UI.toast(m, 'ok', t); };
  UI.err = function (m, t) { return UI.toast(m, 'err', t); };
  UI.warn = function (m, t) { return UI.toast(m, 'warn', t); };
  UI.info = function (m, t) { return UI.toast(m, 'info', t); };

  /* ═══════════ 2. Modal（支持嵌套） ═══════════ */

  // index.html 中的 #modal 作为模板（始终保持 hidden），运行时按需克隆，从而支持多层叠加
  var tpl = null;
  var stack = [];

  function getTpl() {
    if (tpl) return tpl;
    var node = $('#modal');
    if (!node) {
      // 兜底：模板缺失时自建
      node = U.el('div', { class: 'modal', hidden: true },
        '<div class="modal-bg" data-close="1"></div>' +
        '<div class="modal-box sketch">' +
          '<div class="modal-head"><h3></h3>' +
            '<button class="icon-btn" type="button" aria-label="关闭">✕</button></div>' +
          '<div class="modal-body"></div><div class="modal-foot"></div>' +
        '</div>');
      d.body.appendChild(node);
    }
    tpl = node;
    return tpl;
  }

  function lockScroll(on) {
    if (on) {
      if (stack.length > 0) {
        var sw = w.innerWidth - d.documentElement.clientWidth;
        d.body.style.overflow = 'hidden';
        if (sw > 0) d.body.style.paddingRight = sw + 'px';
      }
    } else {
      d.body.style.overflow = '';
      d.body.style.paddingRight = '';
    }
  }

  /**
   * UI.modal({ title, body, foot, wide, size, onMount, onClose, closeOnBg })
   * 返回 { close, node, body, foot, setTitle, setFoot }
   */
  UI.modal = function (opts) {
    var o = opts || {};
    var node = getTpl().cloneNode(true);
    node.removeAttribute('id');
    node.removeAttribute('hidden');
    node.classList.add('ui-modal');
    // 克隆会复制内部 id，必须剔除，避免同一文档出现重复 id
    U.qsa('[id]', node).forEach(function (el) { el.removeAttribute('id'); });

    var box = node.querySelector('.modal-box');
    var head = node.querySelector('.modal-head h3');
    var body = node.querySelector('.modal-body');
    var foot = node.querySelector('.modal-foot');
    var xBtn = node.querySelector('.modal-head .icon-btn');

    if (o.wide || o.size === 'wide') box.classList.add('wide');
    if (o.size === 'lg') box.style.maxWidth = '920px';
    if (o.size === 'sm') box.style.maxWidth = '440px';

    head.innerHTML = U.esc(o.title || '');
    body.innerHTML = o.body == null ? '' : String(o.body);
    foot.innerHTML = o.foot == null ? '' : String(o.foot);

    d.body.appendChild(node);
    requestAnimationFrame(function () { node.style.opacity = '1'; });

    var inst = {
      node: node, box: box, body: body, foot: foot,
      title: function (v) { head.innerHTML = U.esc(v); return inst; },
      setBody: function (html) { body.innerHTML = html; return inst; },
      setFoot: function (html) { foot.innerHTML = html; return inst; },
      close: close,
      on: function (sel, evt, fn) {
        return U.on(body, evt, sel, fn);
      },
      query: function (sel) { return body.querySelector(sel); },
      queryAll: function (sel) { return U.qsa(sel, body); },
    };

    function close(reason) {
      if (inst._closed) return;
      inst._closed = true;
      var idx = stack.indexOf(inst);
      if (idx >= 0) stack.splice(idx, 1);
      node.style.opacity = '0';
      setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
        lockScroll(stack.length > 0);
      }, 180);
      if (o.onClose) { try { o.onClose(reason); } catch (e) { /* 忽略 */ } }
    }

    // 关闭交互
    xBtn.addEventListener('click', function () { close('x'); });
    var bg = node.querySelector('.modal-bg');
    bg.addEventListener('click', function () {
      if (o.closeOnBg === false) return;
      close('bg');
    });
    node.addEventListener('click', function (e) {
      if (e.target === node && o.closeOnBg !== false) close('bg');
    });

    // Esc 关闭最上层
    function onKey(e) {
      if (e.key === 'Escape' || e.keyCode === 27) {
        if (stack[stack.length - 1] === inst) { close('esc'); }
      }
    }
    d.addEventListener('keydown', onKey);
    var origClose = inst.close;
    inst.close = function (reason) {
      d.removeEventListener('keydown', onKey);
      origClose(reason);
    };

    stack.push(inst);
    lockScroll(true);
    if (o.onMount) {
      try { o.onMount(inst); } catch (e) { console.error('[ui.modal] onMount', e); }
    }
    // 自动聚焦第一个输入框
    setTimeout(function () {
      var f = body.querySelector('input:not([type=hidden]),textarea,select');
      if (f && !o.noAutofocus && w.matchMedia && !w.matchMedia('(max-width: 768px)').matches) {
        try { f.focus(); } catch (e) { /* 忽略 */ }
      }
    }, 120);

    return inst;
  };

  UI.closeTopModal = function () {
    var top = stack[stack.length - 1];
    if (top) top.close('api');
    return !!top;
  };
  UI.hasModal = function () { return stack.length > 0; };

  /* ═══════════ 3. Confirm / Alert / Prompt ═══════════ */

  /**
   * UI.confirm({ title, message, okText, cancelText, danger, detail })
   * → Promise<boolean>
   *
   * 注意：必须先 fin(v) 再 m.close()。
   * close() 会同步触发 onClose（内部 fin(false)），若顺序反了，
   * Promise 会被提前解析为 false，导致「确定」分支永远不执行。
   */
  UI.confirm = function (opts) {
    var o = (typeof opts === 'string') ? { message: opts } : (opts || {});
    return new Promise(function (resolve) {
      var done = false;
      function fin(v) { if (done) return; done = true; resolve(v); }

      var m = UI.modal({
        title: o.title || '请确认',
        size: 'sm',
        closeOnBg: o.closeOnBg !== false,
        body:
          '<div style="font-size:16px;line-height:1.86;color:var(--ink)">' +
            U.esc(o.message || '确定继续吗？').replace(/\n/g, '<br>') +
          '</div>' +
          (o.detail
            ? '<div class="note ' + (o.danger ? 'warn' : 'info') + '" style="margin-top:14px">' +
                '<span class="n-ico">' + (o.danger ? '⚠️' : '💡') + '</span>' +
                '<span>' + U.esc(o.detail).replace(/\n/g, '<br>') + '</span></div>'
            : ''),
        foot:
          '<button class="btn" data-act="no" type="button">' + U.esc(o.cancelText || '取消') + '</button>' +
          '<button class="btn ' + (o.danger ? 'btn-danger' : 'btn-primary') + '" data-act="yes" type="button">' +
            U.esc(o.okText || '确定') + '</button>',
        onClose: function () { fin(false); },
      });

      m.foot.querySelector('[data-act="no"]').addEventListener('click', function () { fin(false); m.close(); });
      m.foot.querySelector('[data-act="yes"]').addEventListener('click', function () { fin(true); m.close(); });
    });
  };

  /** UI.alert(msg, title) → Promise<void> */
  UI.alert = function (msg, title) {
    return new Promise(function (resolve) {
      var m = UI.modal({
        title: title || '提示',
        size: 'sm',
        body: '<div style="font-size:16px;line-height:1.86">' + U.esc(msg).replace(/\n/g, '<br>') + '</div>',
        foot: '<button class="btn btn-primary" data-act="ok" type="button">知道了</button>',
        onClose: function () { resolve(); },
      });
      m.foot.querySelector('[data-act="ok"]').addEventListener('click', function () { m.close(); });
    });
  };

  /**
   * UI.prompt({ title, label, value, placeholder, multiline, okText })
   * → Promise<string|null>
   */
  UI.prompt = function (opts) {
    var o = opts || {};
    return new Promise(function (resolve) {
      var done = false;
      function fin(v) { if (done) return; done = true; resolve(v); }

      var inputHtml = o.multiline
        ? '<textarea class="textarea" id="promptInput" placeholder="' + U.escAttr(o.placeholder || '') + '">' + U.esc(o.value || '') + '</textarea>'
        : '<input class="input" id="promptInput" type="' + (o.type || 'text') + '" value="' + U.escAttr(o.value || '') +
          '" placeholder="' + U.escAttr(o.placeholder || '') + '">';

      var m = UI.modal({
        title: o.title || '请输入',
        size: 'sm',
        body: (o.label ? '<div class="field-label">' + U.esc(o.label) + '</div>' : '') + inputHtml +
              (o.hint ? '<div class="field-hint">' + U.esc(o.hint) + '</div>' : ''),
        foot:
          '<button class="btn" data-act="no" type="button">取消</button>' +
          '<button class="btn btn-primary" data-act="yes" type="button">' + U.esc(o.okText || '确定') + '</button>',
        onMount: function (inst) {
          var el = inst.query('#promptInput');
          if (el) {
            el.addEventListener('keydown', function (e) {
              if (e.key === 'Enter' && !o.multiline) { e.preventDefault(); submit(); }
            });
          }
        },
        onClose: function () { fin(null); },
      });

      function submit() {
        var el = m.query('#promptInput');
        var v = el ? el.value : '';
        fin(v);          // 必须先解析，理由同 UI.confirm
        m.close();
      }
      m.foot.querySelector('[data-act="no"]').addEventListener('click', function () { fin(null); m.close(); });
      m.foot.querySelector('[data-act="yes"]').addEventListener('click', submit);
    });
  };

  /* ═══════════ 4. 侧栏抽屉（移动端） ═══════════ */

  var drawerOpen = false;

  UI.drawer = function (on) {
    var sidebar = $('#sidebar');
    var scrim = $('#scrim');
    if (!sidebar) return;
    drawerOpen = (on === undefined) ? !drawerOpen : !!on;

    sidebar.classList.toggle('on', drawerOpen);
    if (scrim) scrim.classList.toggle('on', drawerOpen);
  };
  UI.isDrawerOpen = function () { return drawerOpen; };

  /* ═══════════ 5. 主题按钮 ═══════════ */

  UI.bindThemeButtons = function () {
    U.qsa('.theme-fab').forEach(function (btn) {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', function () {
        var t = STORE.toggleTheme();
        UI.toast(t === 'dark' ? '已切换到深蓝科技主题' : '已切换到浅色纸张主题', 'info', '主题已切换', 1800);
      });
    });
  };

  /* ═══════════ 6. 后端状态指示灯 ═══════════ */

  UI.setBackend = function (status, msg) {
    STORE.state.backend = status;
    STORE.state.backendMsg = msg || '';
    var dot = $('#sidebar') && $('#sidebar').querySelector('.sidebar-foot .dot');
    var txt = $('#sideFootText');
    if (dot) {
      dot.classList.remove('err', 'idle');
      if (status === 'err') dot.classList.add('err');
      if (status === 'idle') dot.classList.add('idle');
    }
    if (txt) {
      txt.textContent = status === 'ok'
        ? '已连接 · ' + (STORE.state.user ? STORE.state.user.name || STORE.state.user.username : '')
        : status === 'err' ? '后端未连接' : '连接中…';
    }
  };

  UI.checkBackend = function () {
    UI.setBackend('idle');
    return w.API.health().then(function () {
      UI.setBackend('ok');
      return true;
    }).catch(function (e) {
      UI.setBackend('err', e.message);
      return false;
    });
  };

  /* ═══════════ 7. 全局代理：代码复制 & 外部链接 ═══════════ */

  UI.bindGlobalHandlers = function () {
    // 代码块复制
    d.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('.code-top .c-copy');
      if (!btn) return;
      var wrap = btn.closest('.code');
      if (!wrap) return;
      var code = wrap.getAttribute('data-code') || '';
      U.copy(code).then(function (ok) {
        btn.textContent = ok ? '已复制 ✓' : '复制失败';
        setTimeout(function () { btn.textContent = '复制'; }, 1500);
      });
    });

    // 用户菜单外点关闭
    d.addEventListener('click', function (e) {
      var pop = $('#userPop');
      if (!pop || pop.hidden) return;
      var menu = $('#userMenu');
      if (menu && menu.contains(e.target)) return;
      pop.hidden = true;
    });

    // 窗口尺寸变化：桌面宽度时关闭抽屉
    var onResize = U.debounce(function () {
      if (w.innerWidth > 992 && UI.isDrawerOpen()) UI.drawer(false);
    }, 160);
    w.addEventListener('resize', onResize);

    // 页面切换时关闭抽屉
    w.addEventListener('hashchange', function () { UI.drawer(false); });

    // 401 统一处理
    w.addEventListener('lsp:unauthorized', function () {
      if (STORE.isLogged) {
        STORE.clearSession();
        UI.toast('登录已过期，请重新登录', 'warn', '会话失效');
        w.dispatchEvent(new CustomEvent('lsp:logout'));
      }
    });
  };

  /* ═══════════ 8. 滚动锁定（抽屉） ═══════════ */
  UI.setScrim = function (on) {
    var scrim = $('#scrim');
    if (scrim) scrim.classList.toggle('on', !!on);
  };

  /* ═══════════ 9. 小工具：按钮 loading ═══════════ */

  /** 在按钮上显示 loading，返回恢复函数 */
  UI.btnBusy = function (btn, text) {
    return U.busy(btn, true, text || '处理中…');
  };

  /** 统一错误提示 */
  UI.errToast = function (e, fallback) {
    var msg = (e && e.message) || fallback || '操作失败';
    UI.toast(msg, 'err', (e && e.status === 403) ? '无权限' : '操作失败');
  };

  w.UI = UI;
})(window, document);
