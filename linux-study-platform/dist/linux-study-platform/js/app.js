/* ══════════════════════════════════════════════════════════════════
   app.js · 应用入口
   ──────────────────────────────────────────────────────────────────
   职责：启动流程 / 主题初始化 / 导航渲染 / 视图路由 / 打卡操作栏
        全局事件委托（[data-go] / 收起菜单 / 未读轮询）
   加载顺序：config → util → api → store → ui → views/* → app
   ══════════════════════════════════════════════════════════════════ */
(function (w, d) {
  'use strict';

  var U = w.U;
  var UI = w.UI;
  var API = w.API;
  var STORE = w.STORE;
  var CFG = w.APP_CONFIG;
  var LoginView = w.LoginView;
  var SV = w.StudentView;
  var AV = w.AdminView;
  var MG = w.MemberGate;

  var App = {};

  /* ═══════════ 导航定义 ═══════════ */

  var NAV = {
    student: [
      { group: '学习', items: [
        { key: 'dashboard', title: '我的学习', icon: '📊' },
        { key: 'course',    title: '课程学习', icon: '📖' },
        { key: 'cmds',      title: '命令大全', icon: '⌨️' },
        { key: 'tips',      title: '实用技巧', icon: '💡' },
      ] },
      { group: '练习', items: [
        { key: 'catalog',   title: '学习目录', icon: '📚' },
        { key: 'records',   title: '我的打卡', icon: '✅' },
        { key: 'exercises', title: '练习题',   icon: '✏️' },
      ] },
      { group: '互动', items: [
        { key: 'messages', title: '老师督促', icon: '📣', badge: 'unread' },
      ] },
      { group: '设置', items: [
        { key: 'profile', title: '我的资料', icon: '🙍' },
      ] },
    ],
    admin: [
      { group: '概览', items: [
        { key: 'dashboard', title: '数据面板', icon: '📊' },
        { key: 'students',  title: '学生名单', icon: '👥' },
        { key: 'logs',      title: '打卡流水', icon: '📋' },
      ] },
      { group: '会员', items: [
        { key: 'members', title: '会员管理', icon: '👑' },
        { key: 'pricing', title: '定价配置', icon: '💎' },
      ] },
      { group: '内容', items: [
        { key: 'units', title: '目录内容', icon: '📚' },
      ] },
      { group: '互动', items: [
        { key: 'urges',     title: '督促管理', icon: '📣', badge: 'urge' },
        { key: 'questions', title: '题库管理', icon: '✏️' },
      ] },
      { group: '设置', items: [
        { key: 'profile', title: '我的资料', icon: '🙍' },
      ] },
    ],
  };

  /* ═══════════ 启动 ═══════════ */

  function setBoot(text) {
    var el = d.getElementById('bootSub');
    if (el) el.textContent = text;
  }

  function hideBoot() {
    var b = d.getElementById('boot');
    if (!b) return;
    b.classList.add('gone');
    setTimeout(function () { b.hidden = true; }, 420);
  }

  function boot() {
    // 主题（在 CSS 应用之前就已设置 data-theme，避免闪烁）
    STORE.initTheme();

    // 全局交互
    UI.bindGlobalHandlers();
    UI.bindThemeButtons();

    // 视图事件委托
    if (SV && SV.bindEvents) SV.bindEvents();
    if (AV && AV.bindEvents) AV.bindEvents();

    // 登录页
    if (LoginView) {
      LoginView.bind();
      LoginView.hide();
    }

    setBoot('正在连接后端服务…');

    // 后端探活（不阻塞登录流程图）
    var probe = UI.checkBackend();

    // 会话恢复
    setBoot('正在校验登录状态…');
    probe.then(function (ok) {
      if (!ok) {
        // 后端不可达：仍然展示登录页，让用户能修改后端地址
        onNotLogged();
        UI.toast('后端服务未连接，请检查服务地址或联系管理员', 'warn', '连接失败', 6000);
        return null;
      }
      return STORE.restoreSession();
    }).then(function (user) {
      if (user) onLogged(user);
      else if (STORE.state.backend === 'ok') onNotLogged();
      // 后端不可达时已在上面处理过
    }).catch(function () {
      onNotLogged();
    }).then(function () {
      setBoot('');
      hideBoot();
    });

    bindAppShell();

    // 未读轮询（学生端每 90s 刷新一次未读督促数）
    startUnreadPolling();

    // 跨标签页同步：主题与登录态
    w.addEventListener('storage', function (e) {
      if (!e.key) return;
      if (e.key === CFG.KEY.theme) {
        var t = e.newValue === 'dark' ? 'dark' : 'light';
        if (t !== STORE.theme) STORE.applyTheme(t, true);
      }
    });
  }

  function onNotLogged() {
    var app = d.getElementById('app');
    if (app) app.hidden = true;
    d.body.classList.remove('has-checkin-bar');
    var bar = d.getElementById('checkinBar');
    if (bar) bar.hidden = true;
    if (LoginView) LoginView.show();
  }

  function onLogged(user) {
    if (LoginView) LoginView.hide();

    var page = d.getElementById('loginPage');
    if (page) page.hidden = true;

    var appEl = d.getElementById('app');
    if (appEl) appEl.hidden = false;

    renderChrome(user);

    var isAdmin = user.role === 'admin';

    /* 会员门禁：学生端进入打卡平台前必须校验超级会员身份。
       会话恢复（刷新页面）路径没有经过登录页，这里补一次检查；
       若会员已到期 / 被禁用，会弹出不可取消的拦截弹窗并强制退出。 */
    if (!isAdmin && MG) {
      MG.bind();
      MG.ensure();
      MG.startPolling();
    }

    App.go(isAdmin ? 'dashboard' : 'dashboard', { silent: true });

    UI.toast('数据已同步 · ' + (isAdmin ? '管理后台' : '学生端'),
      'info', '欢迎，' + (user.name || user.username), 2400);
  }

  /* ═══════════ 顶栏 / 侧栏 ═══════════ */

  function renderChrome(user) {
    var isAdmin = user.role === 'admin';

    // 品牌副标题
    var sub = d.getElementById('brandSub');
    if (sub) sub.textContent = isAdmin ? '管理后台 · 教师端' : '学生端 · 打卡学习';

    // 用户区
    var avatar = d.getElementById('userAvatar');
    var uName = d.getElementById('userName');
    var uSub = d.getElementById('userSub');
    if (avatar) {
      avatar.textContent = U.initial(user.name, user.username);
      avatar.style.background = isAdmin ? 'var(--ok-solid)' : 'var(--accent-solid)';
    }
    if (uName) uName.textContent = user.name || user.username;
    if (uSub) {
      uSub.textContent = isAdmin
        ? '管理员' + (user.adminRole === 'super' ? '（超级）' : '')
        : ((user.className || '') + (user.sno ? ' · ' + user.sno : '') || '学生');
    }

    // 导航
    renderNav(isAdmin ? 'admin' : 'student');

    // 会员徽标只对学生有意义，管理员隐藏，避免误显示「普通会员」
    var mBadge = d.getElementById('userMember');
    if (mBadge) mBadge.style.display = isAdmin ? 'none' : '';
    var mLine = d.getElementById('userMemberLine');
    if (mLine) mLine.style.display = isAdmin ? 'none' : '';

    // 状态灯文案
    UI.setBackend(STORE.state.backend === 'err' ? 'err' : 'ok');

    // 打卡栏只在学生端目录页出现
    updateCheckinBar();
  }

  function renderNav(role) {
    var nav = d.getElementById('nav');
    if (!nav) return;
    var groups = NAV[role] || NAV.student;
    var cur = STORE.state.view;

    var html = '';
    groups.forEach(function (g) {
      html += '<div class="nav-group">' + U.esc(g.group) + '</div>';
      g.items.forEach(function (it) {
        html += '<button class="nav-item' + (it.key === cur ? ' on' : '') + '" type="button" data-nav="' + it.key + '">' +
          '<span class="n-ico">' + it.icon + '</span>' +
          '<span class="n-label">' + U.esc(it.title) + '</span>' +
          (it.badge ? '<span class="n-badge" data-badge="' + it.badge + '"></span>' : '') +
        '</button>';
      });
    });
    nav.innerHTML = html;
  }

  function markNav() {
    U.qsa('#nav .nav-item').forEach(function (b) {
      b.classList.toggle('on', b.dataset.nav === STORE.state.view);
    });
  }

  function setBadge(kind, n) {
    var el = d.querySelector('[data-badge="' + kind + '"]');
    if (!el) return;
    el.innerHTML = n > 0 ? '<span class="badge">' + (n > 99 ? '99+' : n) + '</span>' : '';
  }

  /* ═══════════ 路由 ═══════════ */

  App.go = function (name, opts) {
    var o = opts || {};
    if (!name) return;
    var role = STORE.role;
    var views = role === 'admin' ? AV : SV;
    if (!views || !views[name]) {
      // 兜底回默认页
      name = 'dashboard';
    }

    STORE.state.view = name;
    STORE.emit('view', name);

    markNav();
    if (!o.silent) UI.drawer(false);

    var host = d.getElementById('view');
    if (!host) return;

    // 清空勾选（切换视图时）
    STORE.picked.clear();

    // 视图容器
    host.innerHTML = '';
    var inner = U.el('div', { class: 'view-inner' });
    host.appendChild(inner);

    views[name].render(inner);

    // 打卡栏
    updateCheckinBar();

    // 记录 hash，便于刷新后回到同一页
    try {
      if (w.history && w.history.replaceState) {
        w.history.replaceState(null, '', '#' + name);
      } else {
        w.location.hash = name;
      }
    } catch (e) { /* file:// 下可能失败，忽略 */ }

    // 滚动到顶
    try { w.scrollTo({ top: 0, behavior: 'auto' }); } catch (e) { w.scrollTo(0, 0); }
  };

  App.logout = function () {
    UI.confirm({
      title: '退出登录',
      message: '确定要退出当前账号吗？',
      okText: '退出登录',
      danger: true,
    }).then(function (ok) {
      if (!ok) return;
      var done = function () {
        if (MG) MG.stopPolling();
        STORE.clearSession();
        onNotLogged();
        if (LoginView) LoginView.show();
        UI.toast('已安全退出', 'info', null, 1800);
      };
      API.auth.logout().then(done).catch(done);
    });
  };

  /* ═══════════ 打卡操作栏 ═══════════ */

  var barDate = U.today();

  function updateCheckinBar() {
    var bar = d.getElementById('checkinBar');
    if (!bar) return;

    var show = STORE.role === 'student' && STORE.state.view === 'catalog' && !!STORE.user;
    bar.hidden = !show;
    d.body.classList.toggle('has-checkin-bar', show);

    if (!show) return;

    var di = d.getElementById('cbarDate');
    if (di && !di.value) di.value = barDate;
    refreshBar();
  }

  function refreshBar() {
    var n = STORE.picked.count();
    var revoke = STORE.revokeMode;

    var c1 = d.getElementById('cbarCount');
    if (c1) c1.textContent = n;

    var mode = d.getElementById('cbarMode');
    if (mode) {
      mode.textContent = revoke ? '撤销打卡' : '提交打卡';
      mode.style.background = revoke ? 'var(--danger-soft)' : 'var(--accent-soft)';
      mode.style.color = revoke ? 'var(--danger)' : 'var(--accent)';
      mode.style.borderColor = revoke ? 'var(--danger)' : 'var(--accent)';
    }

    var tg = d.getElementById('cbarToggle');
    if (tg) {
      tg.textContent = revoke ? '✓ 打卡模式' : '↩️ 撤销模式';
      tg.classList.toggle('btn-danger', revoke);
    }

    var sub = d.getElementById('cbarSubmit');
    if (sub) {
      sub.textContent = revoke ? '↩️ 撤销选中的打卡' : '✓ 提交打卡';
      sub.classList.toggle('btn-primary', !revoke);
      sub.classList.toggle('btn-danger', revoke);
      sub.disabled = n === 0;
      sub.classList.toggle('disabled', n === 0);
    }
  }

  function bindCheckinBar() {
    var bar = d.getElementById('checkinBar');
    if (!bar || bar.dataset.bound) return;
    bar.dataset.bound = '1';

    var di = d.getElementById('cbarDate');
    if (di) {
      di.value = barDate;
      di.addEventListener('change', function () { barDate = di.value || U.today(); });
    }

    var bt = d.getElementById('cbarToday');
    if (bt) bt.addEventListener('click', function () {
      barDate = U.today();
      if (di) di.value = barDate;
      UI.toast('打卡日期已设为今天', 'info', null, 1500);
    });

    var tg = d.getElementById('cbarToggle');
    if (tg) tg.addEventListener('click', function () {
      STORE.state.revokeMode = !STORE.state.revokeMode;
      refreshBar();
      UI.toast(STORE.state.revokeMode
        ? '已进入撤销模式：勾选后提交即可撤销打卡'
        : '已回到打卡模式', 'info', null, 2000);
    });

    var cl = d.getElementById('cbarClear');
    if (cl) cl.addEventListener('click', function () {
      STORE.picked.clear();
      U.qsa('#view [data-pick]').forEach(function (n) { n.checked = false; });
      U.qsa('#view .unit-row.picked').forEach(function (n) { n.classList.remove('picked'); });
      refreshBar();
    });

    var sub = d.getElementById('cbarSubmit');
    if (sub) sub.addEventListener('click', function () {
      var ids = STORE.picked.all();
      if (!ids.length) { UI.warn('请先勾选要操作的「学习目录」'); return; }
      var fn = STORE.state.revokeMode ? SV.doRevoke : SV.doCheckin;
      fn(ids, sub);
    });

    // 勾选变化
    STORE.on('picked', refreshBar);
    STORE.on('checkinbar', function () { updateCheckinBar(); });
  }

  /* ═══════════ 应用外壳事件 ═══════════ */

  function bindAppShell() {
    var appEl = d.getElementById('app');
    if (!appEl || appEl.dataset.shellBound) return;
    appEl.dataset.shellBound = '1';

    // 侧栏导航
    var nav = d.getElementById('nav');
    if (nav) {
      nav.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('[data-nav]');
        if (!b) return;
        App.go(b.dataset.nav);
      });
    }

    // 移动端菜单
    var mb = d.getElementById('btnMenu');
    if (mb) mb.addEventListener('click', function () { UI.drawer(); });

    var scrim = d.getElementById('scrim');
    if (scrim) scrim.addEventListener('click', function () { UI.drawer(false); });

    // 用户菜单
    var ub = d.getElementById('userBtn');
    var pop = d.getElementById('userPop');
    if (ub && pop) {
      ub.addEventListener('click', function (e) {
        e.stopPropagation();
        pop.hidden = !pop.hidden;
      });
      pop.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('[data-act]');
        if (!b) return;
        // 用户菜单位于 #app 内部，若不阻止冒泡，student/admin 视图委托
        // 会再次触发同名动作（如 logout 弹出两个确认框、theme 连切两次）
        e.stopPropagation();
        pop.hidden = true;
        var act = b.dataset.act;
        if (act === 'logout') App.logout();
        else if (act === 'pricing') { if (MG) MG.openPricing(); }
        else if (act === 'member') { if (MG) MG.openMine(); }
        else if (act === 'learn') {
          /* 学习内容已与打卡平台融合：不再跳转外部站点，直接切到「课程学习」 */
          App.go('course');
        }
        else if (act === 'theme') {
          var t = STORE.toggleTheme();
          UI.toast(t === 'dark' ? '已切换到深蓝科技主题' : '已切换到浅色纸张主题', 'info', '主题已切换', 1800);
        } else if (act === 'password') {
          App.go('profile');
          setTimeout(function () {
            var btn = d.querySelector('#view [data-act="pwd"]');
            if (btn) btn.click();
          }, 420);
        } else if (act === 'profile') App.go('profile');
      });
    }

    // 全局 [data-go]（所有视图共用）
    d.addEventListener('click', function (e) {
      var g = e.target.closest && e.target.closest('[data-go]');
      if (!g) return;
      var target = g.dataset.go;
      if (!target) return;
      App.go(target);
    });

    // 登录 / 登出事件
    w.addEventListener('lsp:login', function (e) {
      onLogged(e.detail);
    });
    w.addEventListener('lsp:logout', function () {
      onNotLogged();
      if (LoginView) LoginView.show();
    });

    // 未读变化 → 刷新徽标
    STORE.on('unread-changed', function () { refreshUnread(); });

    // 浏览器前进/后退
    w.addEventListener('hashchange', function () {
      var h = String(w.location.hash || '').replace(/^#/, '');
      if (!h || h === STORE.state.view) return;
      if (!STORE.user) return;
      App.go(h);
    });

    // 键盘快捷键：Esc 关抽屉
    d.addEventListener('keydown', function (e) {
      if ((e.key === 'Escape' || e.keyCode === 27) && UI.isDrawerOpen() && !UI.hasModal()) {
        UI.drawer(false);
      }
    });
  }

  /* ═══════════ 未读轮询 ═══════════ */

  var pollTimer = null;

  function refreshUnread() {
    if (!STORE.user) return;
    if (STORE.user.role === 'admin') {
      API.admin.overview().then(function (r) {
        setBadge('urge', (r.stats && r.stats.pendingUrges) || 0);
      }).catch(function () { /* 静默 */ });
    } else {
      API.student.myStats().then(function (r) {
        setBadge('unread', r.unreadUrges || 0);
      }).catch(function () { /* 静默 */ });
    }
  }

  function startUnreadPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      if (d.hidden) return;             // 页面不可见时跳过
      if (!STORE.user || UI.hasModal()) return;
      refreshUnread();
    }, 90000);

    // 页面重新可见时立即刷新一次
    d.addEventListener('visibilitychange', function () {
      if (!d.hidden && STORE.user) refreshUnread();
    });
  }

  /* ═══════════ 关键数据链路：外部触发刷新 ═══════════ */

  w.addEventListener('lsp:refresh', function () {
    STORE.invalidate();
    if (STORE.role === 'admin') AV.refresh(true); else SV.refresh(true);
    refreshUnread();
  });

  /* ═══════════ 启动 ═══════════ */

  App.boot = boot;
  App.refreshUnread = refreshUnread;
  App.NAV = NAV;
  App.getBarDate = function () { return barDate; };

  w.App = App;

  if (d.readyState === 'loading') {
    d.addEventListener('DOMContentLoaded', function () { boot(); bindCheckinBar(); });
  } else {
    boot();
    bindCheckinBar();
  }
})(window, document);
