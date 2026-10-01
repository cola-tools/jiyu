/* ══════════════════════════════════════════════════════════════════
   api.js · 后端接口封装
   ──────────────────────────────────────────────────────────────────
   · 统一注入 Bearer Token（Authorization + X-Token 双写，兼容反向代理）
   · 统一错误归一化 → 抛出 ApiError { status, code, message }
   · 401 自动清理本地会话并广播 lsp:unauthorized 事件
   · 超时控制（默认 20s，大请求可传 timeout）
   · 只依赖 config.js
   ══════════════════════════════════════════════════════════════════ */
(function (w) {
  'use strict';

  var CFG = w.APP_CONFIG;
  var U = w.U;

  /* ───────── 错误类型 ───────── */
  function ApiError(status, code, message, payload) {
    var e = new Error(message || '请求失败');
    e.name = 'ApiError';
    e.status = status || 0;
    e.code = code || 'UNKNOWN';
    e.payload = payload;
    return e;
  }
  w.ApiError = ApiError;

  /* ───────── 令牌读写 ───────── */
  var TOKEN_KEY = CFG.KEY.token;

  function getToken() {
    try { return w.localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }
  function setToken(t) {
    try {
      if (t) w.localStorage.setItem(TOKEN_KEY, t);
      else w.localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* 忽略 */ }
  }

  /* ───────── 核心请求 ───────── */
  var DEFAULT_TIMEOUT = 20000;

  /**
   * request('GET', '/tree', { query: { withProgress: 1 } })
   * request('POST', '/checkins', { body: { unitIds: [1,2] } })
   */
  function request(method, path, opts) {
    var o = opts || {};
    var url = CFG.api(path);

    if (o.query) {
      var qs = [];
      Object.keys(o.query).forEach(function (k) {
        var v = o.query[k];
        if (v === undefined || v === null || v === '') return;
        qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
      });
      if (qs.length) url += (url.indexOf('?') < 0 ? '?' : '&') + qs.join('&');
    }

    var headers = { 'Accept': 'application/json' };
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    var tk = getToken();
    if (tk && o.auth !== false) {
      headers['Authorization'] = 'Bearer ' + tk;
      headers['X-Token'] = tk;
    }

    var init = {
      method: method,
      headers: headers,
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
    };
    if (o.body !== undefined) init.body = JSON.stringify(o.body);

    // 超时
    var ctrl = null, timer = null;
    var timeout = o.timeout || DEFAULT_TIMEOUT;
    if (w.AbortController && timeout > 0) {
      ctrl = new w.AbortController();
      init.signal = ctrl.signal;
      timer = setTimeout(function () { ctrl.abort(); }, timeout);
    }

    return fetch(url, init).then(function (res) {
      if (timer) clearTimeout(timer);
      var ct = res.headers.get('content-type') || '';
      var parse = ct.indexOf('application/json') >= 0
        ? res.json().catch(function () { return null; })
        : res.text().then(function (t) {
            try { return JSON.parse(t); } catch (e) { return { message: String(t).slice(0, 300) }; }
          });

      return parse.then(function (data) {
        if (res.ok) return data;

        // 401：令牌失效 → 清会话
        if (res.status === 401 && o.auth !== false) {
          setToken('');
          try { w.dispatchEvent(new CustomEvent('lsp:unauthorized')); } catch (e) { /* 忽略 */ }
        }

        var msg = (data && (data.message || data.error)) || defaultMsg(res.status);
        throw ApiError(res.status, (data && data.error) || 'HTTP_' + res.status, msg, data);
      });
    }).catch(function (err) {
      if (timer) clearTimeout(timer);
      if (err && err.name === 'ApiError') throw err;
      if (err && (err.name === 'AbortError' || err.code === 20)) {
        throw ApiError(0, 'TIMEOUT', '请求超时，请检查网络或后端服务');
      }
      throw ApiError(0, 'NETWORK_ERROR',
        '无法连接后端服务（' + (CFG.API_BASE || w.location.origin) + '）。请确认服务已启动，且 CORS 已放行当前域名。', err);
    });
  }

  function defaultMsg(status) {
    if (status === 401) return '登录已过期，请重新登录';
    if (status === 403) return '没有权限执行该操作';
    if (status === 404) return '请求的资源不存在';
    if (status >= 500) return '服务器内部错误，请稍后再试';
    return '请求失败（HTTP ' + status + '）';
  }

  var API = {
    get: function (p, o) { return request('GET', p, o); },
    post: function (p, body, o) { return request('POST', p, assign({ body: body == null ? {} : body }, o)); },
    put: function (p, body, o) { return request('PUT', p, assign({ body: body == null ? {} : body }, o)); },
    del: function (p, o) { return request('DELETE', p, o); },
    request: request,
    getToken: getToken,
    setToken: setToken,
    clearToken: function () { setToken(''); },
  };

  function assign(a, b) {
    var out = {};
    Object.keys(a || {}).forEach(function (k) { out[k] = a[k]; });
    Object.keys(b || {}).forEach(function (k) { if (b[k] !== undefined) out[k] = b[k]; });
    return out;
  }

  /* ═══════════════════════════════════════════════════════════════
     接口清单（与后端 routes/ 一一对应）
     ═══════════════════════════════════════════════════════════════ */

  API.health = function () {
    return request('GET', '/health', { auth: false, timeout: 8000 });
  };

  /* ───────── 认证 ───────── */
  API.auth = {
    login: function (username, password, role) {
      return request('POST', '/auth/login', { body: { username: username, password: password, role: role }, auth: false });
    },
    logout: function () { return request('POST', '/auth/logout', { body: {} }); },
    me: function () { return request('GET', '/auth/me'); },
    password: function (oldPassword, newPassword) {
      return request('POST', '/auth/password', { body: { oldPassword: oldPassword, newPassword: newPassword } });
    },
  };

  /* ───────── 学生端 ───────── */
  API.student = {
    /** 目录树 + 我的进度（含子孙累计） */
    tree: function () { return request('GET', '/tree', { query: { withProgress: 1 } }); },
    /** 单元详情（自身 + 子节点 + 我的打卡状态） */
    unit: function (id) { return request('GET', '/units/' + encodeURIComponent(id)); },
    /** 批量打卡 */
    checkin: function (unitIds, date) {
      return request('POST', '/checkins', { body: { unitIds: unitIds, date: date } });
    },
    /** 撤销打卡（后台会看到「已撤销打卡」流水） */
    revoke: function (unitIds) {
      return request('POST', '/checkins/revoke', { body: { unitIds: unitIds } });
    },
    myCheckins: function (limit) { return request('GET', '/my/checkins', { query: { limit: limit || 500 } }); },
    myStats: function () { return request('GET', '/my/stats'); },
    messages: function () { return request('GET', '/my/messages'); },
    readMessage: function (targetId) { return request('POST', '/my/messages/' + targetId + '/read', { body: {} }); },
    doneMessage: function (targetId) { return request('POST', '/my/messages/' + targetId + '/done', { body: {} }); },
    exercises: function (unitId) { return request('GET', '/my/exercises', { query: { unitId: unitId } }); },
    submitAnswer: function (questionId, answer) {
      return request('POST', '/my/exercises/submit', { body: { questionId: questionId, answer: answer } });
    },
  };

  /* ───────── 管理端 ───────── */
  API.admin = {
    /** 数据面板：统计 + 学生排行 + 14 天趋势 + 主目录完成度 */
    overview: function () { return request('GET', '/admin/overview'); },
    /** 实时动态（含撤销打卡） */
    activity: function (limit) { return request('GET', '/admin/activity', { query: { limit: limit || 80 } }); },
    /** 打卡流水，可按学生 / 动作筛选 */
    logs: function (params) { return request('GET', '/admin/logs', { query: params || {} }); },

    /* 学生名单 CRUD */
    students: function () { return request('GET', '/admin/students'); },
    studentCreate: function (data) { return request('POST', '/admin/students', { body: data }); },
    studentUpdate: function (id, data) { return request('PUT', '/admin/students/' + id, { body: data }); },
    studentDelete: function (id) { return request('DELETE', '/admin/students/' + id); },
    studentDetail: function (id) { return request('GET', '/admin/students/' + id + '/detail'); },

    /* 目录与内容 CRUD */
    units: function () { return request('GET', '/admin/units'); },
    unitGet: function (id) { return request('GET', '/admin/units/' + id); },
    unitCreate: function (data) { return request('POST', '/admin/units', { body: data }); },
    unitUpdate: function (id, data) { return request('PUT', '/admin/units/' + id, { body: data }); },
    unitDelete: function (id) { return request('DELETE', '/admin/units/' + id); },
    unitReorder: function (items) { return request('POST', '/admin/units/reorder', { body: { items: items } }); },

    /* 督促 */
    urges: function () { return request('GET', '/admin/urges'); },
    urgeCreate: function (data) { return request('POST', '/admin/urges', { body: data }); },
    urgeTargets: function (id) { return request('GET', '/admin/urges/' + id + '/targets'); },
    urgeDelete: function (id) { return request('DELETE', '/admin/urges/' + id); },

    /* 题库 */
    questions: function (unitId) { return request('GET', '/admin/questions', { query: { unitId: unitId } }); },
    questionCreate: function (data) { return request('POST', '/admin/questions', { body: data }); },
    questionBatch: function (items, unitId) {
      return request('POST', '/admin/questions/batch', { body: { items: items, unitId: unitId } });
    },
    questionUpdate: function (id, data) { return request('PUT', '/admin/questions/' + id, { body: data }); },
    questionDelete: function (id) { return request('DELETE', '/admin/questions/' + id); },
    questionStats: function () { return request('GET', '/admin/questions/stats'); },
  };

  w.API = API;
})(window);
