/* ══════════════════════════════════════════════════════════════════
   store.js · 会话与全局状态
   ──────────────────────────────────────────────────────────────────
   · 会话（用户 / 令牌）持久化到 localStorage，刷新不掉线
   · 主题（浅色纸张 / 深蓝科技）持久化，并优先跟随系统
   · 极简发布订阅：STORE.on(evt, fn) / STORE.emit(evt, payload)
   · 视图路由状态（当前视图 + 参数）保存在内存，刷新回到默认视图
   ══════════════════════════════════════════════════════════════════ */
(function (w) {
  'use strict';

  var CFG = w.APP_CONFIG;
  var U = w.U;
  var API = w.API;

  var KEY = CFG.KEY;

  function read(key, dflt) {
    try {
      var v = w.localStorage.getItem(key);
      return v == null ? dflt : v;
    } catch (e) { return dflt; }
  }
  function write(key, val) {
    try {
      if (val == null) w.localStorage.removeItem(key);
      else w.localStorage.setItem(key, val);
    } catch (e) { /* 忽略 */ }
  }
  function readJSON(key, dflt) {
    var s = read(key, null);
    if (!s) return dflt;
    try { return JSON.parse(s); } catch (e) { return dflt; }
  }

  /* ───────── 事件总线 ───────── */
  var listeners = {};

  function on(evt, fn) {
    if (!listeners[evt]) listeners[evt] = [];
    listeners[evt].push(fn);
    return function () {
      listeners[evt] = (listeners[evt] || []).filter(function (f) { return f !== fn; });
    };
  }
  function emit(evt, payload) {
    (listeners[evt] || []).forEach(function (fn) {
      try { fn(payload); } catch (e) { console.error('[store] listener error', evt, e); }
    });
    if (evt !== '*') emitAsterisk(evt, payload);
  }
  function emitAsterisk(evt, payload) {
    (listeners['*'] || []).forEach(function (fn) {
      try { fn(evt, payload); } catch (e) { /* 忽略 */ }
    });
  }

  /* ───────── 主题 ───────── */
  var THEME_KEY = KEY.theme;

  function systemTheme() {
    try {
      if (w.matchMedia && w.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    } catch (e) { /* 忽略 */ }
    return 'light';
  }

  function applyTheme(theme, animate, persist) {
    var t = theme === 'dark' ? 'dark' : 'light';
    var root = document.documentElement;

    if (animate !== false) {
      root.classList.add('theme-anim');
      setTimeout(function () { root.classList.remove('theme-anim'); }, 460);
    }
    root.setAttribute('data-theme', t);

    // 同步移动端浏览器地址栏配色
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#050e21' : '#fdfbf5');

    var colorScheme = document.querySelector('meta[name="color-scheme"]');
    if (!colorScheme) {
      colorScheme = document.createElement('meta');
      colorScheme.setAttribute('name', 'color-scheme');
      document.head.appendChild(colorScheme);
    }
    colorScheme.setAttribute('content', t);

    // 只有用户主动切换才落盘；首次进入时跟随系统，且不留下记录，
    // 这样用户从未点过切换按钮时，界面会持续跟随系统深浅色变化。
    if (persist) write(THEME_KEY, t);

    state.theme = t;
    emit('theme', t);
    return t;
  }

  function initTheme() {
    var saved = read(THEME_KEY, '');
    var t = (saved === 'light' || saved === 'dark') ? saved : systemTheme();
    // 首次进入不做动画，避免闪烁
    applyTheme(t, false, false);
    // 未手动设置过时跟随系统变化
    try {
      if (w.matchMedia) {
        var mq = w.matchMedia('(prefers-color-scheme: dark)');
        var handler = function () {
          if (!read(THEME_KEY, '')) applyTheme(systemTheme(), true, false);
        };
        if (mq.addEventListener) mq.addEventListener('change', handler);
        else if (mq.addListener) mq.addListener(handler);
      }
    } catch (e) { /* 忽略 */ }
    return t;
  }

  function toggleTheme() {
    return applyTheme(state.theme === 'dark' ? 'light' : 'dark', true, true);
  }

  /* ───────── 状态 ───────── */
  var state = {
    /** 当前登录用户；null = 未登录 */
    user: null,
    /** 'student' | 'admin' */
    role: read(KEY.role, 'student') === 'admin' ? 'admin' : 'student',
    theme: 'light',

    /** 后端连通性：'idle' | 'ok' | 'err' */
    backend: 'idle',
    backendMsg: '',

    /** 当前视图 */
    view: '',
    params: {},

    /** 缓存 */
    tree: null,          // 学生端目录树 { tree, totals }
    treeAt: 0,
    adminUnits: null,    // 管理端全量节点
    adminUnitsAt: 0,

    /** 学生端撤销模式（true 时勾选提交为撤销） */
    revokeMode: false,
    /** 勾选集合：unitId -> true */
    picked: {},

    /** 已注册的视图定义 */
    views: {},
  };

  /* ───────── 会话 ───────── */
  function setSession(user) {
    state.user = user || null;
    state.role = user && user.role === 'admin' ? 'admin' : 'student';
    write(KEY.role, state.role);
    if (user) write(KEY.lastUser, user.username || '');
    emit('session', state.user);
  }

  function clearSession() {
    API.clearToken();
    state.user = null;
    state.tree = null;
    state.adminUnits = null;
    state.picked = {};
    state.revokeMode = false;
    emit('session', null);
  }

  /** 启动时用本地令牌恢复会话，失败静默降级为未登录 */
  function restoreSession() {
    if (!API.getToken()) return Promise.resolve(null);
    return API.auth.me().then(function (r) {
      setSession(r.user);
      return r.user;
    }).catch(function (e) {
      // 401 → 令牌已失效；其它错误（网络）保留令牌，仅置为未登录
      if (e && e.status === 401) API.clearToken();
      state.user = null;
      return null;
    });
  }

  /* ───────── 勾选管理 ───────── */
  var picked = {
    all: function () { return Object.keys(state.picked).map(Number); },
    count: function () { return Object.keys(state.picked).length; },
    has: function (id) { return !!state.picked[id]; },
    add: function (id) { state.picked[id] = true; emit('picked', picked.all()); },
    remove: function (id) { delete state.picked[id]; emit('picked', picked.all()); },
    toggle: function (id) {
      if (state.picked[id]) delete state.picked[id];
      else state.picked[id] = true;
      emit('picked', picked.all());
    },
    setAll: function (ids) {
      state.picked = {};
      (ids || []).forEach(function (i) { state.picked[i] = true; });
      emit('picked', picked.all());
    },
    clear: function () { state.picked = {}; emit('picked', []); },
  };

  /* ───────── 视图注册 ───────── */
  function registerView(name, def) {
    state.views[name] = def;
    return def;
  }

  /* ───────── 缓存工具 ───────── */
  var CACHE_TTL = 25000;   // 25s 内的目录树不重复拉取

  function treeFresh() {
    return state.tree && (Date.now() - state.treeAt) < CACHE_TTL;
  }
  function adminUnitsFresh() {
    return state.adminUnits && (Date.now() - state.adminUnitsAt) < CACHE_TTL;
  }
  function invalidate(what) {
    if (!what || what === 'tree') { state.tree = null; state.treeAt = 0; }
    if (!what || what === 'units') { state.adminUnits = null; state.adminUnitsAt = 0; }
  }

  /* ───────── 暴露 ───────── */
  var STORE = {
    state: state,
    on: on,
    emit: emit,

    initTheme: initTheme,
    applyTheme: applyTheme,
    toggleTheme: toggleTheme,
    get theme() { return state.theme; },
    get isDark() { return state.theme === 'dark'; },

    setSession: setSession,
    clearSession: clearSession,
    restoreSession: restoreSession,
    get user() { return state.user; },
    get role() { return state.role; },
    get isLogged() { return !!state.user; },

    picked: picked,

    registerView: registerView,

    treeFresh: treeFresh,
    adminUnitsFresh: adminUnitsFresh,
    invalidate: invalidate,

    read: read, write: write, readJSON: readJSON,
  };

  // 通知主题变化给非 STORE 模块
  on('theme', function (t) {
    try { w.dispatchEvent(new CustomEvent('lsp:theme', { detail: { theme: t } })); } catch (e) { /* 忽略 */ }
  });

  w.STORE = STORE;
})(window);
