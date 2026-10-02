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

    var timeout = o.timeout || DEFAULT_TIMEOUT;

    function attempt() {
      // 每次尝试使用独立的超时控制器（重试时上一次的 signal 已 abort，不能复用）
      var ctrl = null, timer = null, thisInit = init;
      if (w.AbortController && timeout > 0) {
        ctrl = new w.AbortController();
        thisInit = assign({}, init, { signal: ctrl.signal });
        timer = setTimeout(function () { ctrl.abort(); }, timeout);
      }

      return fetch(url, thisInit).then(function (res) {
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
          '网络连接不稳定，无法访问后端服务（' + (CFG.API_BASE || w.location.origin) + '）。请稍后重试；若持续失败请联系管理员检查服务状态。', err);
      });
    }

    /* 网络层自动重试：GET 与图形验证码（幂等）最多重试 2 次，
       应对 Railway / GitHub Pages 偶发的网络抖动，
       尽量避免「图形验证码获取失败 / 列表加载失败」这类一次抖动就报错的情况 */
    var retries = (method === 'GET' || path === '/auth/captcha') ? 2 : 0;
    function run(n) {
      return attempt().catch(function (err) {
        var retriable = err && (err.code === 'NETWORK_ERROR' || err.code === 'TIMEOUT');
        if (n < retries && retriable) {
          return new Promise(function (res) { setTimeout(res, n === 0 ? 500 : 1200); })
            .then(function () { return run(n + 1); });
        }
        throw err;
      });
    }
    return run(0);
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
    /**
     * platform: 'checkin' → 打卡平台（普通会员会被 403 NEED_MEMBER 拦截）
     *           'learn'   → 学习平台（默认）
     */
    login: function (username, password, role, platform) {
      return request('POST', '/auth/login', {
        body: {
          username: username, password: password, role: role,
          platform: platform || 'learn',
        },
        auth: false,
      });
    },
    logout: function () { return request('POST', '/auth/logout', { body: {} }); },
    me: function () { return request('GET', '/auth/me'); },
    password: function (oldPassword, newPassword) {
      return request('POST', '/auth/password', { body: { oldPassword: oldPassword, newPassword: newPassword } });
    },

    /* ── 注册 / 忘记密码 / 验证码 ── */
    captcha: function () { return request('POST', '/auth/captcha', { body: {}, auth: false }); },
    sms: function (phone, scene, captchaToken, captcha) {
      return request('POST', '/auth/sms', {
        body: { phone: phone, scene: scene || 'register', captchaToken: captchaToken, captcha: captcha },
        auth: false,
      });
    },
    register: function (data) {
      return request('POST', '/auth/register', { body: data, auth: false });
    },
    forgot: function (data) {
      return request('POST', '/auth/forgot', { body: data, auth: false });
    },
  };

  /* ───────── 会员 ───────── */
  API.member = {
    /** 会员定价表（公开） */
    pricing: function () { return request('GET', '/member/pricing', { auth: false }); },
    /** 我的会员详情（类型 / 到期 / 剩余毫秒 / 是否不足 3 天） */
    me: function () { return request('GET', '/member/me'); },
    /** 打卡平台门禁：403 NEED_MEMBER / ACCOUNT_DISABLED */
    gate: function () { return request('GET', '/member/gate'); },
    /** 我的会员变更流水 */
    logs: function () { return request('GET', '/member/logs'); },
  };

  /* ───────── 学生端 ───────── */
  API.student = {
    /** 目录树 + 我的进度（含子孙累计、locked / isFree 门禁标记） */
    tree: function () { return request('GET', '/tree', { query: { withProgress: 1 } }); },
    /** 单元详情（自身 + 子节点 + 我的打卡状态） */
    unit: function (id) { return request('GET', '/units/' + encodeURIComponent(id)); },
    /** 批量打卡（超级会员） */
    checkin: function (unitIds, date) {
      return request('POST', '/checkins', { body: { unitIds: unitIds, date: date } });
    },
    /** 撤销打卡（超级会员） */
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

    /** 导出打卡记录（csv / xlsx / pdf）→ 由服务端生成，浏览器直接下载 */
    export: function (format, params) {
      var q = ['format=' + encodeURIComponent(format)];
      if (params && params.from) q.push('from=' + encodeURIComponent(params.from));
      if (params && params.to) q.push('to=' + encodeURIComponent(params.to));
      var url = CFG.api('/my/export') + '?' + q.join('&');
      var tk = getToken();
      var name = '打卡记录.' + (format === 'xlsx' ? 'xlsx' : format);
      return fetch(url, {
        method: 'GET',
        headers: tk ? { Authorization: 'Bearer ' + tk, 'X-Token': tk } : {},
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
      }).then(function (res) {
        if (!res.ok) {
          return res.json().catch(function () { return {}; }).then(function (d) {
            throw ApiError(res.status, (d && d.code) || 'HTTP_' + res.status,
              (d && d.message) || defaultMsg(res.status), d);
          });
        }
        var cd = res.headers.get('content-disposition') || '';
        var m1 = /filename\*=UTF-8''([^;]+)/i.exec(cd);
        var m2 = /filename="([^"]+)"/i.exec(cd);
        if (m1) { try { name = decodeURIComponent(m1[1]); } catch (e) { /* 忽略 */ } }
        else if (m2) name = m2[1];
        return res.blob().then(function (blob) { return { blob: blob, name: name }; });
      });
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

    /* 会员管理 */
    members: function (params) { return request('GET', '/admin/members', { query: params || {} }); },
    memberGrant: function (id, memberType, remark) {
      return request('POST', '/admin/members/' + id + '/grant', { body: { memberType: memberType, remark: remark } });
    },
    memberStatus: function (id, status) {
      return request('POST', '/admin/members/' + id + '/status', { body: { status: status } });
    },
    memberLogs: function (id) { return request('GET', '/admin/members/' + id + '/logs'); },
    pricing: function () { return request('GET', '/admin/pricing'); },
    pricingUpdate: function (code, data) {
      return request('PUT', '/admin/pricing/' + encodeURIComponent(code), { body: data });
    },
    exportLogs: function (limit) { return request('GET', '/admin/export-logs', { query: { limit: limit || 100 } }); },

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
