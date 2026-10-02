/* ══════════════════════════════════════════════════════════════════
   config.js · 运行环境与后端地址解析
   ──────────────────────────────────────────────────────────────────
   前后端分离时的连接策略（详见 DEPLOY.md）：
     1. 同源部署（后端同时托管 web/）→ API_BASE = ''，请求 /api/xxx
     2. 前端在 GitHub Pages / 自建域名，后端在 Railway / Render / 云主机
        → 通过「远程地址」配置指向后端，并通过 CORS 放行
   地址解析优先级（高 → 低）：
     A. index.html 中 window.LINUX_STUDY_API        ← 部署时写死，最稳
     B. URL 参数 ?api=https://api.example.com        ← 写入 localStorage，可现场切换
     C. localStorage['lsp.apiBase']                  ← 上次保存
     D. 同源（location.origin）                       ← 本地开发 / 后端托管前端
   ══════════════════════════════════════════════════════════════════ */
(function (w) {
  'use strict';

  var LS_BASE = 'lsp.apiBase';
  var LS_THEME = 'lsp.theme';
  var LS_TOKEN = 'lsp.token';
  var LS_ROLE = 'lsp.role';
  var LS_LAST_USER = 'lsp.lastUser';

  /** 去掉末尾斜杠 */
  function trimSlash(s) {
    return String(s || '').replace(/\/+$/, '');
  }

  function isValidHttp(v) {
    return /^https?:\/\/[^\s"'<>]+$/i.test(String(v || ''));
  }

  function readLS(key) {
    try { return w.localStorage.getItem(key) || ''; } catch (e) { return ''; }
  }
  function writeLS(key, val) {
    try {
      if (val == null || val === '') w.localStorage.removeItem(key);
      else w.localStorage.setItem(key, val);
    } catch (e) { /* 隐私模式 / 存储被禁用时静默降级 */ }
  }

  /** 静态托管回退：前端部署在 GitHub Pages / eojjr.cn 等纯静态环境时，
      同源没有 /api，自动回退到默认后端（index.html 里的 LINUX_STUDY_API 优先） */
  var FALLBACK_API = 'https://jiyu-production-3034.up.railway.app';
  function isStaticHost() {
    var h = w.location.hostname;
    return h === 'eojjr.cn' || /^[a-z0-9-]+\.github\.io$/i.test(h);
  }

  /** 解析后端基地址 */
  function resolveApiBase() {
    // A. 部署时写死（index.html 里可覆盖）
    var forced = w.LINUX_STUDY_API;
    if (typeof forced === 'string' && (forced === '' || isValidHttp(forced))) {
      // 空串代表强制同源
      if (forced !== '' || readLS(LS_BASE) === '') return trimSlash(forced);
    }

    // B. URL 参数 ?api=...  便于现场调试与多环境切换
    try {
      var qs = new URLSearchParams(w.location.search);
      var fromUrl = qs.get('api');
      if (fromUrl !== null) {
        if (fromUrl === '' || fromUrl === 'same') {
          writeLS(LS_BASE, '');
          return '';
        }
        if (isValidHttp(fromUrl)) {
          writeLS(LS_BASE, trimSlash(fromUrl));
          return trimSlash(fromUrl);
        }
      }
    } catch (e) { /* 老浏览器无 URLSearchParams，忽略 */ }

    // C. localStorage（用户显式保存过：含空串「同源」也尊重）
    var raw = null;
    try { raw = w.localStorage.getItem(LS_BASE); } catch (e) { /* 忽略 */ }
    if (raw !== null) {
      if (raw === '') return '';
      if (isValidHttp(raw)) return trimSlash(raw);
    }

    // D. 静态托管环境（GitHub Pages / eojjr.cn）：同源没有后端，回退默认后端
    if (isStaticHost()) {
      // eslint-disable-next-line no-console
      console.warn('[config] 静态托管环境未配置后端地址，回退到：' + FALLBACK_API);
      return FALLBACK_API;
    }

    // E. 同源（本地开发 / 后端托管前端）
    return '';
  }

  var API_BASE = resolveApiBase();

  /** 拼出完整请求地址：api('/auth/login') → https://host/api/auth/login */
  function api(path) {
    var p = String(path || '');
    if (!/^\//.test(p)) p = '/' + p;
    return API_BASE + '/api' + p;
  }

  w.APP_CONFIG = {
    /** 后端基地址（'' = 同源） */
    API_BASE: API_BASE,
    api: api,
    /** 是否前后端分离部署 */
    get isSplit() { return API_BASE !== ''; },
    /** 是否运行在 GitHub Pages 上 */
    get isGitHubPages() { return /\.github\.io$/i.test(w.location.hostname); },
    /** 是否本地开发环境 */
    get isLocal() {
      return /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(w.location.hostname)
        || w.location.protocol === 'file:';
    },
    /** 存储键名（集中管理，避免散落各处拼字符串） */
    KEY: {
      base: LS_BASE, theme: LS_THEME, token: LS_TOKEN, role: LS_ROLE, lastUser: LS_LAST_USER,
    },
    /** 运行时切换后端地址（保存并刷新） */
    setApiBase(url, reload) {
      var v = trimSlash(String(url || '').trim());
      if (v !== '' && !isValidHttp(v)) return false;
      writeLS(LS_BASE, v);
      if (reload !== false) w.location.reload();
      return true;
    },
    read: readLS,
    write: writeLS,
    /** 应用元信息 */
    APP: {
      name: 'Linux 学习打卡平台',
      version: '1.0.0',
      shortName: 'Linux 打卡',
    },
  };
})(window);
