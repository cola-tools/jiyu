/* ═══════════════════════════════════════════════════════════════════════
   Linux 学习平台 · 后端桥接层  (bridge.js)
   ─────────────────────────────────────────────────────────────────────
   把原「本地离线学习平台」接入已有后端，实现前后端互通：
     ① 注册 / 登录 / 忘记密码（图形验证码 + 短信验证码，手机号唯一）
     ② 会员分级：普通会员仅可学「① 入门与安装」5 个小节，其余章节加 🔒 并拦截
     ③ 打卡记录上传服务器（超级会员）、三格式导出（CSV / XLSX / PDF）
     ④ 定价页（头像菜单）、我的会员、会员流水
     ⑤ 深色 / 浅色主题切换
     ⑥ 会员到期强制退出弹窗、剩余不足 3 天常驻倒计时
     ⑦ 账号被禁用全屏拦截
   本文件通过 <script src> 在原应用脚本之后加载，不改动原应用任何一行逻辑；
   原应用在文件末尾暴露 window.__lcb 钩子，本层通过这些钩子接管需要鉴权的动作。
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ══════════════ 0. 配置 ══════════════ */
  var CFG = {
    /* 同源部署时留空即可；若前端单独部署（GitHub Pages / 本地双击打开），
       可通过 window.WB_API_BASE 指定后端地址，例如 'https://api.xxx.com' */
    apiBase: (typeof window.WB_API_BASE === 'string') ? window.WB_API_BASE.replace(/\/+$/, '') :
      (location.protocol === 'file:' ? 'http://127.0.0.1:3210' : ''),
    tokenKey: 'wb.token',
    themeKey: 'wb.theme',
    pollMs: 30000,
    /* 是否把「① 入门与安装」之外的所有模块（含命令大全 / 实用技巧）都锁定给普通会员。
       置为 false 则只锁定教程的第二章节及之后，命令大全与实用技巧保持公开。 */
    lockAllBeyondFirstChapter: true,
  };

  var MSG = {
    locked: '你还未开通超级会员，请联系管理员开通后进行学习！',
    needMember: '你还未开通会员，无法使用打卡平台，请联系管理员开通会员后再使用！',
    needMemberLearn: '你还未开通超级会员，请联系管理员开通后进行学习！',
    disabled: '您的账号已被管理员设置为禁用，请联系管理员开通账号使用权限',
    phoneTaken: '该手机号已绑定账号，请直接登录！',
    dueWarn: '你的会员期限已不足3天，为了能够正常使用该平台，请及时联系管理员进行续费！',
  };

  var LEVEL_CN = { none: '普通会员', week: '周会员', month: '月会员', year: '年会员', forever: '永久会员' };
  var FIRST_CHAPTER = '① 入门与安装';

  /* ══════════════ 1. 状态 ══════════════ */
  var S = {
    token: null,
    user: null,
    member: null,
    me: null,                 // /api/member/me 的完整响应（含 account）
    byTitle: {},              // 后端标题 → 后端 unitId
    nodeById: {},             // 后端 unitId → 节点
    frontByBid: {},           // 后端 unitId → 前端 unitId（tut:/cmd:/tip:）
    ready: false,
    expireShown: false,
    cdTimer: null,
    pollTimer: null,
    app: null,                // 原应用钩子快照（tutorials / commands / tips）
  };

  /* ══════════════ 2. 小工具 ══════════════ */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function L() { return window.__lcb; }

  function toast(kind, title, msg, ms) {
    var f = L();
    if (f && f.toast) return f.toast(kind, title, msg, ms);
  }

  /** 'YYYY-MM-DD HH:mm:ss' → 'YYYY年MM月DD日HH时mm分ss秒' */
  function fmtCnDateTime(s) {
    if (!s) return '——';
    var m = String(s).replace('T', ' ').match(/^(\d{4})-(\d{2})-(\d{2})[ ]?(\d{2}):(\d{2}):(\d{2})/);
    if (!m) return String(s);
    return m[1] + '年' + m[2] + '月' + m[3] + '日 ' + m[4] + '时' + m[5] + '分' + m[6] + '秒';
  }
  /** 毫秒 → {d,h,m,s} */
  function splitMs(ms) {
    var t = Math.max(0, Math.floor(ms / 1000));
    return {
      d: Math.floor(t / 86400),
      h: Math.floor((t % 86400) / 3600),
      m: Math.floor((t % 3600) / 60),
      s: t % 60,
    };
  }
  function countdownText(ms) {
    var p = splitMs(ms);
    return p.d + '天' + p.h + '时' + p.m + '分' + p.s + '秒';
  }

  /* ══════════════ 3. API ══════════════ */
  function req(method, path, body, opt) {
    var o = opt || {};
    var headers = {};
    if (body !== undefined && body !== null) headers['Content-Type'] = 'application/json';
    if (S.token) headers.Authorization = 'Bearer ' + S.token;
    if (o.raw) headers.Accept = '*/*';
    return fetch(CFG.apiBase + path, {
      method: method,
      headers: headers,
      body: (body === undefined || body === null) ? undefined : JSON.stringify(body),
    }).then(function (res) {
      if (o.raw) return { status: res.status, res: res, headers: res.headers };
      var ct = res.headers.get('content-type') || '';
      if (ct.indexOf('application/json') >= 0) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          return { status: res.status, data: data, headers: res.headers };
        });
      }
      return res.text().then(function (t) {
        return { status: res.status, data: { message: t }, headers: res.headers };
      });
    }).then(function (r) {
      if (r.status >= 200 && r.status < 300) return r;
      var d = r.data || {};
      var err = new Error(d.message || ('请求失败（' + r.status + '）'));
      err.status = r.status;
      err.code = d.code || d.error || 'HTTP_' + r.status;
      err.data = d;
      throw err;
    });
  }

  /* ══════════════ 4. 主题 ══════════════ */
  function applyTheme(t) {
    var theme = t || localStorage.getItem(CFG.themeKey) || 'dark';
    if (theme !== 'light') theme = 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(CFG.themeKey, theme); } catch (e) {}
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', theme === 'light' ? '#f2f6fc' : '#050a16');
    var btn = $('#wbMiTheme');
    if (btn) {
      btn.innerHTML = '<span class="i">' + (theme === 'light' ? '🌙' : '☀️') + '</span>' +
        '<span>切换为' + (theme === 'light' ? '深色' : '浅色') + '主题</span>';
    }
  }
  function toggleTheme() {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
  }

  /* ══════════════ 5. 初始化 DOM（用户区 / 浮层 / 倒计时） ══════════════ */
  function injectDom() {
    /* 5.1 顶栏用户区（插在「打卡记录」按钮之后） */
    var tr = $('.top-right');
    if (tr && !$('#wbUser')) {
      var wrap = document.createElement('div');
      wrap.className = 'wb-user';
      wrap.id = 'wbUser';
      wrap.innerHTML =
        '<button class="wb-chip" id="wbChip" type="button" aria-haspopup="true" aria-expanded="false">' +
          '<span class="wb-av" id="wbAv">学</span>' +
          '<span class="wb-meta"><b id="wbName">未登录</b>' +
            '<em class="wb-badge" id="wbBadge">普通会员</em></span>' +
          '<span class="arw">▼</span>' +
        '</button>' +
        '<div class="wb-menu" id="wbMenu" role="menu">' +
          '<div class="wb-mh">会员中心</div>' +
          '<button class="wb-mi" type="button" data-wb="pricing"><span class="i">💎</span><span>定价</span></button>' +
          '<button class="wb-mi" type="button" data-wb="mine"><span class="i">👤</span><span>我的会员</span>' +
            '<span class="wb-tag" id="wbMiTag">普通会员</span></button>' +
          '<div class="wb-sep"></div>' +
          '<div class="wb-mh">学习与记录</div>' +
          '<button class="wb-mi" type="button" data-wb="records"><span class="i">📥</span><span>打卡记录与导出</span></button>' +
          '<button class="wb-mi" type="button" id="wbMiTheme" data-wb="theme"><span class="i">☀️</span><span>切换为浅色主题</span></button>' +
          '<div class="wb-sep"></div>' +
          '<button class="wb-mi danger" type="button" data-wb="logout"><span class="i">🚪</span><span>退出登录</span></button>' +
        '</div>';
      tr.appendChild(wrap);
    }

    /* 5.2 登录 / 注册 / 忘记密码门禁 */
    if (!$('#wbGate')) {
      var g = document.createElement('div');
      g.className = 'wb-gate';
      g.id = 'wbGate';
      g.innerHTML =
        '<div class="wb-card">' +
          '<div class="wb-card-h"><div class="lg">🐧</div>' +
            '<div><h2>Linux 学习打卡平台</h2><p>学习平台 · 打卡平台 统一账号</p></div></div>' +
          '<div class="wb-tabs">' +
            '<button class="wb-tab on" type="button" data-tab="login">登录</button>' +
            '<button class="wb-tab" type="button" data-tab="register">注册账号</button>' +
            '<button class="wb-tab" type="button" data-tab="forgot">忘记密码</button>' +
          '</div>' +

          /* 登录 */
          '<form id="wbFormLogin" autocomplete="off">' +
            '<div class="wb-f"><label>账号 <span class="hint">用户名 / 手机号</span></label>' +
              '<input class="wb-in" name="account" placeholder="请输入用户名或手机号" autocomplete="username"></div>' +
            '<div class="wb-f"><label>密码</label>' +
              '<input class="wb-in" name="password" type="password" placeholder="请输入密码" autocomplete="current-password"></div>' +
            '<button class="wb-submit" type="submit">登录</button>' +
          '</form>' +

          /* 注册 */
          '<form id="wbFormRegister" autocomplete="off" style="display:none">' +
            '<div class="wb-f"><label>用户名 <span class="hint">2-20 位，中英文 / 数字 / 下划线</span></label>' +
              '<input class="wb-in" name="username" placeholder="设置用户名"></div>' +
            '<div class="wb-f"><label>密码 <span class="hint">至少 6 位</span></label>' +
              '<input class="wb-in" name="password" type="password" placeholder="设置登录密码"></div>' +
            '<div class="wb-f"><label>确认密码</label>' +
              '<input class="wb-in" name="password2" type="password" placeholder="再次输入密码"></div>' +
            '<div class="wb-f"><label>手机号 <span class="hint">注册后与账号绑定，不可更换</span></label>' +
              '<input class="wb-in" name="phone" inputmode="numeric" maxlength="11" placeholder="请输入 11 位手机号"></div>' +
            '<div class="wb-f"><label>手机号验证码</label><div class="wb-row">' +
              '<input class="wb-in" name="smsCode" inputmode="numeric" maxlength="6" placeholder="6 位短信验证码">' +
              '<button class="wb-btn-sms" type="button" data-sms="register">获取验证码</button></div></div>' +
            '<div class="wb-f"><label>图形验证码 <span class="hint">字母或计算均可，点击图片刷新</span></label><div class="wb-row">' +
              '<input class="wb-in" name="captcha" placeholder="请输入图片中的字符">' +
              '<div class="wb-cap" data-cap="register"></div></div></div>' +
            '<button class="wb-submit" type="submit">注册并登录</button>' +
            '<div class="wb-foot-note">注册后默认<b>普通会员</b>，仅可学习「① 入门与安装」；联系管理员开通后升级为<b style="color:#f59e0b">超级会员</b>。<br>账号创建后不可注销，手机号是唯一性凭证。</div>' +
          '</form>' +

          /* 忘记密码 */
          '<form id="wbFormForgot" autocomplete="off" style="display:none">' +
            '<div class="wb-f"><label>手机号 <span class="hint">须为已注册手机号</span></label>' +
              '<input class="wb-in" name="phone" inputmode="numeric" maxlength="11" placeholder="请输入注册时使用的手机号"></div>' +
            '<div class="wb-f"><label>手机号验证码</label><div class="wb-row">' +
              '<input class="wb-in" name="smsCode" inputmode="numeric" maxlength="6" placeholder="6 位短信验证码">' +
              '<button class="wb-btn-sms" type="button" data-sms="forgot">获取验证码</button></div></div>' +
            '<div class="wb-f"><label>图形验证码</label><div class="wb-row">' +
              '<input class="wb-in" name="captcha" placeholder="请输入图片中的字符">' +
              '<div class="wb-cap" data-cap="forgot"></div></div></div>' +
            '<div class="wb-f"><label>新密码 <span class="hint">至少 6 位</span></label>' +
              '<input class="wb-in" name="newPassword" type="password" placeholder="设置新密码"></div>' +
            '<div class="wb-f"><label>确认新密码</label>' +
              '<input class="wb-in" name="newPassword2" type="password" placeholder="再次输入新密码"></div>' +
            '<button class="wb-submit" type="submit">重置密码并登录</button>' +
          '</form>' +

          '<div class="wb-msg" id="wbGateMsg"></div>' +
          '<div class="wb-demo">' +
            '<b>演示账号</b>（密码见括号）<br>' +
            '永久会员 <code>student1 / xiaoran2026</code>　' +
            '年会员 <code>student2 / linux2026</code><br>' +
            '普通会员 <code>student3 / study2026</code>　' +
            '周会员剩 2 天 <code>student4 / buddy2026</code>　' +
            '已禁用 <code>student5 / hello2026</code><br>' +
            '管理员后台 <code>admin / admin@2026</code>' +
          '</div>' +
        '</div>';
      document.body.appendChild(g);
    }

    /* 5.3 通用浮层（定价 / 我的会员） */
    if (!$('#wbOv')) {
      var ov = document.createElement('div');
      ov.className = 'wb-ov';
      ov.id = 'wbOv';
      ov.innerHTML = '<div class="wb-ov-box" id="wbOvBox"></div>';
      document.body.appendChild(ov);
    }

    /* 5.4 全屏拦截（会员到期 / 账号禁用） */
    if (!$('#wbBlock')) {
      var bk = document.createElement('div');
      bk.className = 'wb-block';
      bk.id = 'wbBlock';
      bk.innerHTML = '<div class="wb-block-box" id="wbBlockBox"></div>';
      document.body.appendChild(bk);
    }

    /* 5.5 右下角常驻倒计时 */
    if (!$('#wbCd')) {
      var cd = document.createElement('div');
      cd.className = 'wb-cd';
      cd.id = 'wbCd';
      cd.innerHTML =
        '<div class="lb"><span class="dt"></span><span>会员即将到期</span></div>' +
        '<div class="tm" id="wbCdTime">—</div>' +
        '<button class="go" type="button" data-wb="pricing">联系管理员续费</button>';
      document.body.appendChild(cd);
    }
  }

  /* ══════════════ 6. 顶栏用户区刷新 ══════════════ */
  function refreshUserChip() {
    var m = S.member || { type: 'none', label: '普通会员', isSuper: false };
    var name = (S.user && (S.user.name || S.user.username)) || '未登录';
    var superMode = !!m.isSuper;

    var av = $('#wbAv'); if (av) {
      av.textContent = String(name).slice(0, 1);
      av.className = 'wb-av' + (superMode ? ' super' : '');
    }
    var nm = $('#wbName'); if (nm) nm.textContent = name;
    var bd = $('#wbBadge'); if (bd) {
      bd.textContent = superMode ? '超级会员' : '普通会员';
      bd.className = 'wb-badge' + (superMode ? ' super' : '');
      bd.title = superMode
        ? (LEVEL_CN[m.type] || '超级会员') + (m.expireAt ? ' · ' + m.expireAt + ' 到期' : ' · 永久有效')
        : '仅可学习「① 入门与安装」';
    }
    var tg = $('#wbMiTag'); if (tg) {
      tg.textContent = superMode ? (LEVEL_CN[m.type] || '超级会员') : '普通会员';
      tg.className = 'wb-tag' + (superMode ? ' gold' : '');
    }
  }

  /* ══════════════ 7. 内容门禁 ══════════════ */
  /** 前端 unitId → 后端 unitId */
  function bidOf(unitId) {
    if (!S.app) return null;
    var m = /^(tut|cmd|tip):(.+)$/.exec(String(unitId || ''));
    if (!m) return null;
    var kind = m[1], key = m[2], title = null;
    if (kind === 'tut') { var i = S.app.tutIndex[key]; if (i != null) title = S.app.tutorials[i].name; }
    else if (kind === 'cmd') { title = key; }
    else { var j = S.app.tipIndex[key]; if (j != null) title = S.app.tips[j].name; }
    if (!title) return null;
    return S.byTitle[title] || null;
  }

  /** 该前端单元是否被锁定（未开通超级会员） */
  function isLockedUnit(unitId) {
    if (!S.member) return true;
    if (S.member.isSuper) return false;
    var bid = bidOf(unitId);
    if (!bid) {
      /* 未映射到后端内容：教程按「是否首章」判断，其余按配置 */
      var m = /^tut:(.+)$/.exec(String(unitId || ''));
      if (m) {
        var i = S.app ? S.app.tutIndex[m[1]] : null;
        var t = (i != null) ? S.app.tutorials[i] : null;
        return !(t && t.group === FIRST_CHAPTER);
      }
      return !!CFG.lockAllBeyondFirstChapter;
    }
    var node = S.nodeById[bid];
    return node ? !!node.locked : true;
  }

  /** 分组是否整体锁定（侧边栏章节标题用） */
  function isLockedGroup(gname) {
    if (!S.member || S.member.isSuper || !S.app) return false;
    if (/^[①②③④⑤⑥⑦⑧⑨]/.test(gname)) {
      var ts = S.app.tutorials.filter(function (t) { return t.group === gname; });
      return ts.length > 0 && ts.every(function (t) { return isLockedUnit('tut:' + t.key); });
    }
    if (gname === '命令大全') {
      return S.app.commands.length > 0 &&
        S.app.commands.every(function (c) { return isLockedUnit('cmd:' + c.name); });
    }
    if (gname === '实用技巧') {
      return S.app.tips.length > 0 &&
        S.app.tips.every(function (p) { return isLockedUnit('tip:' + p.key); });
    }
    return false;
  }

  /** 导航路径是否被锁定 */
  function isLockedPath(path) {
    if (!path) return false;
    if (/^tut\//.test(path)) return isLockedUnit('tut:' + path.slice(4));
    if (path === 'all' || /^cat\//.test(path)) return isLockedGroup('命令大全');
    if (path === 'tips') return isLockedGroup('实用技巧');
    return false;
  }

  /** 锁定提示（统一文案） */
  function warnLocked() {
    toast('err', '需要超级会员', MSG.locked, 4200);
    openPricing();
  }

  /** 受保护页面整页锁定视图 */
  function lockPageHtml(sub) {
    return '<div class="page"><div class="wb-lock-page">' +
      '<div class="ic">🔒</div>' +
      '<h2>该内容需要超级会员</h2>' +
      '<p>' + esc(MSG.locked) + '</p>' +
      '<div class="mini">当前身份：<b>' + esc(LEVEL_CN[(S.member && S.member.type) || 'none'] || '普通会员') +
      '</b>　可学习范围：<b>' + esc(FIRST_CHAPTER) + '</b> 下的 5 个小节' +
      (sub ? '<br>' + esc(sub) : '') + '</p>' +
      '<div class="acts">' +
        '<button class="pri" type="button" data-wb="pricing">💎 查看会员定价</button>' +
        '<button type="button" data-wb="home">← 返回学习看板</button>' +
      '</div></div></div>';
  }

  /** 当前页面是否需要一个整页锁 */
  function pageBlocked() {
    var f = L();
    if (!f || !S.ready || !S.member || S.member.isSuper) return null;
    var v = f.curView && f.curView();
    if (!v) return null;
    if (v.v === 'tut' && isLockedUnit('tut:' + v.key)) {
      var t = S.app.tutorials[S.app.tutIndex[v.key]];
      return lockPageHtml(t ? '该小节：' + t.group + ' · ' + t.name : '');
    }
    if ((v.v === 'all' || v.v === 'cat') && isLockedGroup('命令大全')) {
      return lockPageHtml('「命令大全」模块需要超级会员');
    }
    if (v.v === 'tips' && isLockedGroup('实用技巧')) {
      return lockPageHtml('「实用技巧」模块需要超级会员');
    }
    return null;
  }

  /* ══════════════ 8. 渲染后处理 ══════════════ */
  function afterRender() {
    if (!S.ready) return;
    var f = L();
    var superMode = !!(S.member && S.member.isSuper);

    /* 8.1 整页锁（幂等：每次渲染都按当前视图重新判定） */
    var blocked = pageBlocked();
    if (blocked) {
      var st = $('#stage');
      if (st) st.innerHTML = blocked;
      var c0 = $('#cbar'); if (c0) c0.style.display = 'none';
      return;
    }

    /* 8.2 普通会员：隐藏打卡操作栏与勾选框 */
    var cb = $('#cbar');
    if (cb) cb.style.display = superMode ? '' : 'none';
    if (!superMode) {
      $$('.ck').forEach(function (el) {
        el.checked = false;
        el.disabled = true;
        var lab = el.closest('label');
        if (lab && !lab.querySelector('.wb-mini-lock')) {
          var s = document.createElement('span');
          s.className = 'wb-mini-lock';
          s.style.cssText = 'font-size:11.5px;color:#f59e0b;margin-left:6px';
          s.textContent = '（需超级会员）';
          lab.appendChild(s);
        }
      });
    }

    /* 8.3 侧边栏锁标记（nav 由应用自己生成，这里补一道保险） */
    $$('#sideNav .nav-item[data-go]').forEach(function (b) {
      var lk = isLockedPath(b.getAttribute('data-go'));
      b.classList.toggle('locked', lk);
      var t = b.querySelector('.ni-t');
      if (t) {
        var has = !!t.querySelector('.lk');
        if (lk && !has) {
          var s2 = document.createElement('span');
          s2.className = 'lk';
          s2.textContent = '🔒';
          t.appendChild(s2);
        } else if (!lk && has) {
          t.querySelector('.lk').remove();
        }
      }
    });

    /* 8.4 学习看板：会员状态横幅 */
    var v = f && f.curView && f.curView();
    var homeHead = $('#stage .page-head');
    if (v && v.v === 'home' && homeHead && !homeHead.querySelector('.wb-banner')) {
      var bn = document.createElement('div');
      bn.className = 'wb-banner';
      if (superMode) {
        bn.innerHTML = '<span class="bi">💎</span><span>当前身份：<b>' +
          esc(LEVEL_CN[S.member.type] || '超级会员') + '</b>' +
          (S.member.permanent ? '（永久有效）' : '　到期时间：<b>' + esc(fmtCnDateTime(S.member.expireAt)) + '</b>') +
          '　全章节可学、可打卡、可导出打卡记录。</span>' +
          '<span class="sp"></span><button type="button" data-wb="records">📥 打卡记录与导出</button>';
      } else {
        bn.innerHTML = '<span class="bi">🔒</span><span>当前身份：<b>普通会员</b>　可学习范围：<b>' +
          esc(FIRST_CHAPTER) + '</b> 下的 5 个小节，其余章节已上锁；开通超级会员后可学全章节、打卡与导出记录。</span>' +
          '<span class="sp"></span><button type="button" data-wb="pricing">💎 查看定价</button>';
      }
      homeHead.insertBefore(bn, homeHead.firstChild);
    }

    /* 8.5 打卡记录页：替换“数据仅存于本机浏览器”的说明 */
    if (v && v.v === 'records') {
      var p = $('#stage .page-head p');
      if (p && !p.getAttribute('data-wb-fixed')) {
        p.setAttribute('data-wb-fixed', '1');
        p.innerHTML = '打卡记录已同步到服务器账号，多设备登录可见。' +
          (superMode
            ? '导出表格包含五列：<b>打卡日期 / 学习内容 / 章节路径 / 难度 / 状态</b>，由服务端生成 CSV·Excel·PDF 三种格式。'
            : '<b style="color:#f59e0b">普通会员暂不能导出打卡记录</b>，开通超级会员后即可导出 CSV / Excel / PDF 三种格式。');
      }
    }
  }

  /* ══════════════ 9. 浮层：定价 / 我的会员 ══════════════ */
  function openOv(html, narrow) {
    var ov = $('#wbOv'), box = $('#wbOvBox');
    if (!ov || !box) return;
    box.className = 'wb-ov-box' + (narrow ? ' narrow' : '');
    box.innerHTML = html;
    ov.classList.add('show');
    document.body.style.overflow = 'hidden';
  }
  function closeOv() {
    var ov = $('#wbOv');
    if (ov) ov.classList.remove('show');
    if (!$('#wbBlock').classList.contains('show')) document.body.style.overflow = '';
  }

  var PERK_FREE = ['第一章学习权限', '不可打卡', '不可学习全部章节', '无法登录打卡平台'];
  var PERK_SUPER = ['可学习全章节内容', '可进行学习打卡', '专业团队出题练习', '可导出学习打卡记录'];

  function openPricing() {
    closeOv();
    openOv('<div class="wb-ov-h"><div class="lg" style="width:44px;height:44px;flex:0 0 44px;border-radius:13px;' +
      'display:grid;place-items:center;font-size:21px;background:linear-gradient(135deg,#2563eb,#22d3ee)">💎</div>' +
      '<div><h2>会员定价</h2><p>开通后可学习全部章节、参与学习打卡、导出打卡记录</p></div>' +
      '<button class="wb-ov-x" type="button" data-wb="close">✕</button></div>' +
      '<div id="wbPriceBox" style="color:var(--txt3);font-size:13px;padding:18px 2px">正在加载定价…</div>' +
      '<div class="wb-note"><b>开通与续费方式</b>：本平台的会员由管理员在后台统一设置，请联系管理员开通或续费。<br>' +
      '续费自动叠加：若当前会员尚未到期，新到期时间 = <b>原到期时间 + 本次时长</b>（剩余 2 天 2 小时 45 分 1 秒时充周会员 → 变为 9 天 2 小时 45 分 1 秒）。<br>' +
      '会员到期后将<b>自动降级为普通会员</b>，并会从打卡平台强制退出。</div>');

    req('GET', '/api/member/pricing').then(function (r) {
      var items = (r.data && r.data.items) || [];
      var myType = (S.member && S.member.type) || 'none';
      var h = '<div class="wb-price-grid">';
      items.forEach(function (p) {
        var free = p.isFree;
        var perks = free ? PERK_FREE : PERK_SUPER;
        var cur = p.code === myType;
        h += '<div class="wb-pc' + (p.hot ? ' hot' : '') + (cur ? ' cur' : '') + '">' +
          (cur ? '<div class="wb-pc-tag now">当前身份</div>'
               : (p.hot ? '<div class="wb-pc-tag">最受欢迎</div>' : '')) +
          '<div class="wb-pc-name">' + esc(p.label) + '</div>' +
          '<div class="wb-pc-tl">' + esc(p.tagline || '') + '</div>' +
          '<div class="wb-pc-price"><span class="c">¥</span><span class="v">' +
            esc(p.priceText) + '</span><span class="d">' +
            (p.days > 0 ? ' / ' + p.days + ' 天' : ' / 永久') + '</span></div>' +
          '<ul class="wb-pc-perks">' + perks.map(function (x) {
            return '<li' + (free ? ' class="no"' : '') + '><span class="k">' +
              (free ? '•' : '✓') + '</span><span>' + esc(x) + '</span></li>';
          }).join('') + '</ul>' +
          '<button class="wb-pc-btn' + (free ? ' ghost' : '') + '" type="button" data-wb="' +
            (free ? 'close' : 'contact') + '">' + (free ? '免费使用中' : '联系管理员开通') + '</button>' +
        '</div>';
      });
      h += '</div>';
      var box = $('#wbPriceBox');
      if (box) {
        box.innerHTML = h;
        box.style.color = '';
        box.style.padding = '';
      }
    }).catch(function (e) {
      var box = $('#wbPriceBox');
      if (box) box.textContent = '定价加载失败：' + e.message;
    });
  }

  function openMine() {
    closeOv();
    var m = S.member || { type: 'none', label: '普通会员', isSuper: false };
    var u = S.user || {};
    var superMode = !!m.isSuper;
    openOv('<div class="wb-ov-h">' +
      '<div class="lg" style="width:44px;height:44px;flex:0 0 44px;border-radius:13px;display:grid;place-items:center;' +
      'font-size:21px;background:linear-gradient(135deg,#2563eb,#22d3ee)">👤</div>' +
      '<div><h2>我的会员</h2><p>账号与会员状态总览</p></div>' +
      '<button class="wb-ov-x" type="button" data-wb="close">✕</button></div>' +
      '<div class="wb-kv">' +
        '<div class="it"><div class="l">登录账号</div><div class="v2">' + esc(u.username || '—') + '</div></div>' +
        '<div class="it"><div class="l">姓名</div><div class="v2">' + esc(u.name || '—') + '</div></div>' +
        '<div class="it"><div class="l">手机号（唯一凭证）</div><div class="v2">' + esc(u.phone || '—') + '</div></div>' +
        '<div class="it"><div class="l">会员等级</div><div class="v2' + (superMode ? ' gold' : '') + '">' +
          esc(superMode ? (LEVEL_CN[m.type] || '超级会员') : '普通会员') + '</div></div>' +
        '<div class="it"><div class="l">到期时间</div><div class="v2">' +
          (m.permanent ? '永久有效' : (superMode ? esc(fmtCnDateTime(m.expireAt)) : '——')) + '</div></div>' +
        '<div class="it"><div class="l">剩余时长</div><div class="v2" id="wbMineRemain">' +
          (m.permanent ? '无限期' : (superMode ? esc(countdownText(m.remainMs || 0)) : '——')) + '</div></div>' +
        '<div class="it"><div class="l">账号状态</div><div class="v2" style="color:' +
          ((S.me && S.me.account && S.me.account.disabled) ? 'var(--bad)' : 'var(--ok2)') + '">' +
          ((S.me && S.me.account && S.me.account.disabled) ? '已被禁用' : '正常可用') + '</div></div>' +
        '<div class="it"><div class="l">可学习范围</div><div class="v2" style="font-size:13.5px">' +
          (superMode ? '全部章节' : esc(FIRST_CHAPTER) + '（5 小节）') + '</div></div>' +
      '</div>' +
      (superMode && !m.permanent ? '' :
        '<div class="wb-note" style="margin-top:16px">当前为<b>普通会员</b>：仅可学习「' + esc(FIRST_CHAPTER) +
        '」下的 5 个小节，不能打卡、不能导出打卡记录、无法登录打卡平台。请联系管理员开通超级会员。</div>') +
      '<div class="wb-ov-h" style="margin:22px 0 0"><div><h2 style="font-size:15.5px">会员变更记录</h2></div>' +
        '<button class="wb-ov-x" type="button" data-wb="pricing" title="去开通" style="font-size:13px">💎</button></div>' +
      '<div class="wb-logs" id="wbMineLogs"><div style="padding:16px;font-size:12.8px;color:var(--txt3)">加载中…</div></div>',
      true);

    req('GET', '/api/member/me').then(function (r) {
      S.me = r.data;
      if (r.data.member) { S.member = r.data.member; refreshUserChip(); }
    }).catch(function () {});

    req('GET', '/api/member/logs').then(function (r) {
      var items = (r.data && r.data.items) || [];
      var box = $('#wbMineLogs');
      if (!box) return;
      if (!items.length) {
        box.innerHTML = '<div style="padding:16px;font-size:12.8px;color:var(--txt3)">暂无会员变更记录</div>';
        return;
      }
      var h = '<table><thead><tr><th>时间</th><th>操作</th><th>变更</th><th>到期时间</th><th>操作人</th></tr></thead><tbody>';
      items.forEach(function (x) {
        h += '<tr><td>' + esc(x.createdAt) + '</td>' +
          '<td><b style="color:var(--txt)">' + esc(x.actionText) + '</b></td>' +
          '<td>' + esc(x.typeFrom) + ' → <b style="color:var(--pri2)">' + esc(x.typeTo) + '</b>' +
            (x.daysAdded ? ' <span style="color:var(--ok2)">+' + x.daysAdded + '天</span>' : '') + '</td>' +
          '<td>' + esc(x.expireTo || '永久') + '</td>' +
          '<td>' + esc(x.operator) + '</td></tr>';
      });
      box.innerHTML = h + '</tbody></table>';
    }).catch(function (e) {
      var box = $('#wbMineLogs');
      if (box) box.textContent = '加载失败：' + e.message;
    });
  }

  /* ══════════════ 10. 全屏拦截：会员到期 / 账号禁用 ══════════════ */
  function showBlock(opt) {
    var bk = $('#wbBlock'), box = $('#wbBlockBox');
    if (!bk || !box) return;
    if (opt.kind === 'expired') {
      box.className = 'wb-block-box';
      box.innerHTML =
        '<div class="wb-block-ic">⏰</div>' +
        '<h2>会员到期提醒</h2>' +
        '<p>你的会员于 <b>' + esc(fmtCnDateTime(opt.expireAt)) + '</b> 到期，' +
        '现将强制退出该平台，若想要继续使用，请尽快续费使用</p>' +
        '<div class="tip2">续费方式：联系管理员在后台为你开通 / 续费超级会员。<br>' +
        '到期后学习范围将恢复为「' + esc(FIRST_CHAPTER) + '」下的 5 个小节。</div>' +
        '<button class="wb-block-btn" type="button" data-wb="logout">退出登录</button>';
    } else {
      box.className = 'wb-block-box bad';
      box.innerHTML =
        '<div class="wb-block-ic">🚫</div>' +
        '<h2>账号已被禁用</h2>' +
        '<p>' + esc(MSG.disabled) + '</p>' +
        '<div class="tip2">禁用期间无法使用学习、打卡、个人信息等任何功能。</div>' +
        '<button class="wb-block-btn plain" type="button" data-wb="logout">退出登录</button>';
    }
    bk.classList.add('show');
    document.body.style.overflow = 'hidden';
    stopCountdown();
  }
  function hideBlock() {
    var bk = $('#wbBlock');
    if (bk) bk.classList.remove('show');
    document.body.style.overflow = '';
  }

  /* ══════════════ 11. 剩余不足 3 天：常驻倒计时 ══════════════ */
  function renderCountdown() {
    var el = $('#wbCdTime');
    if (!el || !S.member) return;
    if (S.member.permanent) { stopCountdown(); return; }
    var left = new Date(String(S.member.expireAt).replace(' ', 'T')).getTime() - Date.now();
    if (isNaN(left)) { stopCountdown(); return; }
    if (left <= 0) {
      el.innerHTML = '<span style="color:var(--bad)">已到期</span>';
      onExpired();
      return;
    }
    var p = splitMs(left);
    el.innerHTML = p.d + '<span>天</span>' + p.h + '<span>时</span>' +
      p.m + '<span>分</span>' + p.s + '<span>秒</span>';
  }
  function startCountdown() {
    var cd = $('#wbCd');
    if (!cd || !S.member || S.member.permanent) return;
    cd.classList.add('show');
    renderCountdown();
    if (S.cdTimer) return;
    S.cdTimer = setInterval(renderCountdown, 1000);
  }
  function stopCountdown() {
    var cd = $('#wbCd');
    if (cd) cd.classList.remove('show');
    if (S.cdTimer) { clearInterval(S.cdTimer); S.cdTimer = null; }
  }

  /* ══════════════ 12. 门禁浮层交互 ══════════════ */
  function gateMsg(kind, text) {
    var el = $('#wbGateMsg');
    if (!el) return;
    el.className = 'wb-msg' + (text ? ' show ' + kind : '');
    el.textContent = text || '';
  }
  function showGate(tab) {
    injectDom(); // 确保节点存在
    var g = $('#wbGate');
    g.classList.add('show');
    document.body.style.overflow = 'hidden';
    setTab(tab || 'login');
    refreshCaptcha('login');
    if (tab === 'register' || !tab) refreshCaptcha('register');
    if (tab === 'forgot' || !tab) refreshCaptcha('forgot');
  }
  function hideGate() {
    var g = $('#wbGate');
    if (g) g.classList.remove('show');
    document.body.style.overflow = '';
  }
  function setTab(name) {
    $$('#wbGate .wb-tab').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-tab') === name);
    });
    var map = { login: '#wbFormLogin', register: '#wbFormRegister', forgot: '#wbFormForgot' };
    Object.keys(map).forEach(function (k) {
      var f = $(map[k]);
      if (f) f.style.display = (k === name) ? '' : 'none';
    });
    gateMsg('', '');
    refreshCaptcha(name);
  }

  var CAP = {}; // scene → {token, svg}
  function refreshCaptcha(scene) {
    var box = $('.wb-cap[data-cap="' + scene + '"]');
    if (!box) return Promise.resolve();
    box.innerHTML = '<span style="font-size:11px;color:var(--txt3)">加载中…</span>';
    return req('POST', '/api/auth/captcha').then(function (r) {
      CAP[scene] = { token: r.data.token, svg: r.data.svg };
      box.innerHTML = r.data.svg;
      box.title = '看不清？点击刷新';
      return r.data;
    }).catch(function () {
      box.innerHTML = '<span style="font-size:11px;color:var(--bad)">加载失败，点击重试</span>';
    });
  }
  function captchaOf(scene) {
    var c = CAP[scene];
    return c ? { captchaToken: c.token, captcha: c.input } : {};
  }

  /* 验证码输入联动：把用户输入记录到 CAP 上 */
  document.addEventListener('input', function (ev) {
    var el = ev.target;
    if (!el || !el.name) return;
    var form = el.closest && el.closest('form');
    if (!form) return;
    var scene = form.id === 'wbFormLogin' ? 'login' : (form.id === 'wbFormRegister' ? 'register' : 'forgot');
    if (el.name === 'captcha' && CAP[scene]) CAP[scene].input = el.value;
  });

  /* ══════════════ 13. 认证动作 ══════════════ */
  function saveToken(t) {
    S.token = t;
    try { localStorage.setItem(CFG.tokenKey, t); } catch (e) {}
  }
  function clearToken() {
    S.token = null;
    try { localStorage.removeItem(CFG.tokenKey); } catch (e) {}
  }

  function afterLogin(token, user, member) {
    saveToken(token);
    S.user = user;
    S.member = member || (user && user.member) || { type: 'none', isSuper: false, label: '普通会员' };
    refreshUserChip();
    hideGate();
    return loadContent();
  }

  function doLogin(form) {
    var fd = new FormData(form);
    var btn = form.querySelector('.wb-submit');
    btn.disabled = true;
    gateMsg('', '');
    req('POST', '/api/auth/login', {
      account: String(fd.get('account') || '').trim(),
      password: String(fd.get('password') || ''),
      role: 'student',
      platform: 'learn',
    }).then(function (r) {
      btn.disabled = false;
      return afterLogin(r.data.token, r.data.user, r.data.user && r.data.user.member);
    }).catch(function (e) {
      btn.disabled = false;
      if (e.code === 'ACCOUNT_DISABLED') { hideGate(); showBlock({ kind: 'disabled' }); return; }
      gateMsg('err', e.message);
    });
  }

  function doRegister(form) {
    var fd = new FormData(form);
    var btn = form.querySelector('.wb-submit');
    var scene = 'register';
    var cap = CAP[scene] || {};
    btn.disabled = true;
    gateMsg('', '');
    req('POST', '/api/auth/register', {
      username: String(fd.get('username') || '').trim(),
      password: String(fd.get('password') || ''),
      password2: String(fd.get('password2') || ''),
      phone: String(fd.get('phone') || '').trim(),
      smsCode: String(fd.get('smsCode') || '').trim(),
      captchaToken: cap.token,
      captcha: String(fd.get('captcha') || ''),
    }).then(function (r) {
      btn.disabled = false;
      toast('ok', '注册成功', '当前为普通会员，联系管理员开通超级会员即可学习全部章节。', 4200);
      return afterLogin(r.data.token, r.data.user, r.data.user && r.data.user.member);
    }).catch(function (e) {
      btn.disabled = false;
      gateMsg('err', e.message);
      refreshCaptcha(scene);
      form.querySelector('[name=captcha]').value = '';
    });
  }

  function doForgot(form) {
    var fd = new FormData(form);
    var btn = form.querySelector('.wb-submit');
    var scene = 'forgot';
    var cap = CAP[scene] || {};
    btn.disabled = true;
    gateMsg('', '');
    req('POST', '/api/auth/forgot', {
      phone: String(fd.get('phone') || '').trim(),
      smsCode: String(fd.get('smsCode') || '').trim(),
      newPassword: String(fd.get('newPassword') || ''),
      newPassword2: String(fd.get('newPassword2') || ''),
    }).then(function () {
      btn.disabled = false;
      var phone = String(fd.get('phone') || '').trim();
      var pwd = String(fd.get('newPassword') || '');
      toast('ok', '密码已重置', '正在使用新密码登录…', 3000);
      /* 直接用新密码登录 */
      return req('POST', '/api/auth/login', {
        account: phone, password: pwd, role: 'student', platform: 'learn',
      }).then(function (r) {
        return afterLogin(r.data.token, r.data.user, r.data.user && r.data.user.member);
      });
    }).catch(function (e) {
      btn.disabled = false;
      gateMsg('err', e.message);
      refreshCaptcha(scene);
      form.querySelector('[name=captcha]').value = '';
    });
  }

  function doSendSms(scene, btn) {
    var form = btn.closest('form');
    var fd = new FormData(form);
    var phone = String(fd.get('phone') || '').trim();
    var cap = CAP[scene] || {};
    if (!/^1[3-9]\d{9}$/.test(phone)) { gateMsg('err', '请输入正确的 11 位手机号'); return; }
    if (!String(fd.get('captcha') || '').trim()) { gateMsg('err', '请先填写图形验证码'); return; }

    var old = btn.textContent;
    btn.disabled = true;
    gateMsg('', '');
    req('POST', '/api/auth/sms', {
      phone: phone, scene: scene,
      captchaToken: cap.token, captcha: String(fd.get('captcha') || ''),
    }).then(function (r) {
      var left = Number((r.data && r.data.cooldown) || 60);
      gateMsg('ok', '验证码已发送' + (r.data && r.data.devCode
        ? '（开发环境验证码：' + r.data.devCode + '）' : '') + '，请查收短信。');
      tickSms(btn, old, left);
      refreshCaptcha(scene);
      form.querySelector('[name=captcha]').value = '';
      if (CAP[scene]) CAP[scene].input = '';
    }).catch(function (e) {
      btn.disabled = false;
      gateMsg('err', e.message);
      refreshCaptcha(scene);
      form.querySelector('[name=captcha]').value = '';
      if (CAP[scene]) CAP[scene].input = '';
    });
  }
  function tickSms(btn, label, sec) {
    var n = sec;
    btn.textContent = n + 's 后重发';
    var t = setInterval(function () {
      n--;
      if (n <= 0) { clearInterval(t); btn.disabled = false; btn.textContent = label; return; }
      btn.textContent = n + 's 后重发';
    }, 1000);
  }

  function doLogout(silent) {
    var t = S.token;
    clearToken();
    S.user = null; S.member = null; S.me = null; S.ready = false; S.expireShown = false;
    stopCountdown();
    hideBlock();
    closeOv();
    if (t) req('POST', '/api/auth/logout').catch(function () {});
    var f = L();
    if (f && f.replaceAll) { try { f.replaceAll({}); } catch (e) {} }
    hideGate();
    showGate('login');
    if (!silent) toast('info', '已退出登录', '如需继续学习，请重新登录。');
  }

  /* ══════════════ 14. 内容与记录加载 ══════════════ */
  function buildIndex(tree) {
    S.byTitle = {}; S.nodeById = {}; S.frontByBid = {};
    tree.forEach(function (n) {
      S.nodeById[n.id] = n;
      if (n.checkable) S.byTitle[n.title] = n.id;
    });
    /* 反向映射：后端 unitId → 前端 unitId */
    if (S.app) {
      S.app.tutorials.forEach(function (t) {
        var b = S.byTitle[t.name]; if (b) S.frontByBid[b] = 'tut:' + t.key;
      });
      S.app.commands.forEach(function (c) {
        var b = S.byTitle[c.name]; if (b) S.frontByBid[b] = 'cmd:' + c.name;
      });
      S.app.tips.forEach(function (p) {
        var b = S.byTitle[p.name]; if (b) S.frontByBid[b] = 'tip:' + p.key;
      });
    }
  }

  function loadContent() {
    return req('GET', '/api/tree').then(function (r) {
      buildIndex((r.data && r.data.tree) || []);
      if (r.data && r.data.member) { S.member = r.data.member; refreshUserChip(); }
    }).catch(function () {
      S.byTitle = {}; S.nodeById = {}; S.frontByBid = {};
    }).then(syncRecords).then(function () {
      S.ready = true;
      var f = L();
      if (f && f.render) f.render(true);
      checkMemberTimer();
      startPoll();
    });
  }

  /** 从服务器拉取打卡记录，覆盖本地 store */
  function syncRecords() {
    if (!S.member || !S.member.isSuper) {
      var f0 = L();
      if (f0 && f0.replaceAll) f0.replaceAll({});
      return Promise.resolve();
    }
    return req('GET', '/api/my/checkins?limit=2000').then(function (r) {
      var rec = {};
      ((r.data && r.data.items) || []).forEach(function (it) {
        var front = S.frontByBid[it.unitId];
        if (!front) return;
        rec[front] = { d: it.date, ts: it.at ? new Date(String(it.at).replace(' ', 'T')).getTime() : Date.now() };
      });
      var f = L();
      if (f && f.replaceAll) f.replaceAll(rec);
    }).catch(function () {});
  }

  /* ══════════════ 15. 会员状态巡检 ══════════════ */
  function checkMemberTimer() {
    if (!S.member) return;
    if (S.member.expired || (!S.member.permanent && !S.member.isSuper && S.member.remainMs === 0 && S.member.expireAt)) {
      onExpired();
      return;
    }
    if (S.member.isSuper && !S.member.permanent && S.member.almostDue) {
      startCountdown();
      if (!S.dueWarned) {
        S.dueWarned = true;
        toast('err', '会员期限提醒', MSG.dueWarn, 7000);
      }
    } else {
      stopCountdown();
    }
  }

  function onExpired() {
    if (S.expireShown) return;
    S.expireShown = true;
    var at = (S.member && S.member.expireAt) || '';
    showBlock({ kind: 'expired', expireAt: at });
  }

  function poll() {
    if (!S.token) return;
    req('GET', '/api/member/me').then(function (r) {
      S.me = r.data;
      if (r.data.account) {
        S.user = Object.assign({}, S.user || {}, {
          username: r.data.account.username, name: r.data.account.name, phone: r.data.account.phone,
        });
      }
      var prev = S.member || {};
      S.member = r.data.member;
      refreshUserChip();

      /* 账号被禁用 */
      if (r.data.account && r.data.account.disabled) {
        showBlock({ kind: 'disabled' });
        return;
      }
      /* 会员到期：强制退出 */
      if (prev.isSuper && !S.member.isSuper) {
        onExpired();
        return;
      }
      checkMemberTimer();
      var rem = $('#wbMineRemain');
      if (rem && S.member.isSuper && !S.member.permanent) {
        rem.textContent = countdownText(S.member.remainMs || 0);
      }
    }).catch(function (e) {
      if (e.status === 401) {
        /* 令牌失效（到期被强制退出 / 被禁用 / 会话过期） */
        clearToken();
        S.ready = false;
        hideBlock();
        stopCountdown();
        showGate('login');
        gateMsg('err', e.code === 'NEED_MEMBER' ? MSG.needMember : '登录已失效，请重新登录');
      } else if (e.code === 'ACCOUNT_DISABLED') {
        showBlock({ kind: 'disabled' });
      }
    });
  }
  function startPoll() {
    if (S.pollTimer) return;
    S.pollTimer = setInterval(poll, CFG.pollMs);
  }

  /* ══════════════ 16. 打卡与导出（接管原应用动作） ══════════════ */
  function hookSubmit(ids) {
    if (!S.ready) return false;                  // 未就绪 → 交回原逻辑
    if (!S.member || !S.member.isSuper) { warnLocked(); return true; }
    var f = L();
    var date = ($('#cbDate') && $('#cbDate').value) || f.today();
    var bIds = [], mapped = [];
    ids.forEach(function (id) {
      var b = bidOf(id);
      if (b) { bIds.push(b); mapped.push(id); }
    });
    if (!bIds.length) {
      toast('err', '无法提交打卡', '所选内容未与后端课程匹配，请刷新页面后重试。');
      return true;
    }
    req('POST', '/api/checkins', { unitIds: bIds, date: date }).then(function () {
      mapped.forEach(function (id) { f.setRecord(id, date); });
      f.render(true);
      toast('ok', '打卡成功 ✅', '已提交 ' + mapped.length + ' 项 · 打卡日期 ' + date + '（已同步到服务器）。', 3400);
    }).catch(function (e) {
      if (e.code === 'NEED_MEMBER') warnLocked();
      else if (e.code === 'ACCOUNT_DISABLED') showBlock({ kind: 'disabled' });
      else toast('err', '打卡失败', e.message);
    });
    return true;
  }

  function hookRevoke(unitId) {
    if (!S.ready) return false;
    if (!S.member || !S.member.isSuper) { warnLocked(); return true; }
    var f = L();
    var b = bidOf(unitId);
    if (!b) return false;
    /* 取本机记录的日期作为撤销目标 */
    var cur = null;
    try { cur = JSON.parse(localStorage.getItem('linuxCheckin.v3') || 'null'); } catch (e) {}
    var d = (cur && cur.records && cur.records[unitId] && cur.records[unitId].d) || f.today();
    req('POST', '/api/checkins/revoke', { unitIds: [b], date: d }).then(function () {
      f.delRecord(unitId);
      f.render(true);
      toast('info', '已撤销打卡', '服务器与本地记录已同步删除。');
    }).catch(function (e) {
      toast('err', '撤销失败', e.message);
    });
    return true;
  }

  function hookExport(fmt) {
    if (!S.ready) return false;
    if (!S.member || !S.member.isSuper) {
      toast('err', '普通会员暂不能导出', '开通超级会员后可导出 CSV / Excel / PDF 三种格式的打卡记录。', 4200);
      openPricing();
      return true;
    }
    var label = { csv: 'CSV', xlsx: 'Excel', pdf: 'PDF' }[fmt] || fmt.toUpperCase();
    toast('info', '正在生成 ' + label + '…', '由服务器根据你的打卡记录生成文件。', 2200);
    fetch(CFG.apiBase + '/api/my/export?format=' + encodeURIComponent(fmt), {
      headers: { Authorization: 'Bearer ' + S.token },
    }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (d) {
          var err = new Error(d.message || ('导出失败（' + res.status + '）'));
          err.code = d.code; err.status = res.status;
          throw err;
        });
      }
      var cd = res.headers.get('content-disposition') || '';
      var name = 'Linux学习打卡记录.' + (fmt === 'xlsx' ? 'xlsx' : fmt);
      var m1 = /filename\*=UTF-8''([^;]+)/i.exec(cd);
      var m2 = /filename="([^"]+)"/i.exec(cd);
      if (m1) { try { name = decodeURIComponent(m1[1]); } catch (e) {} }
      else if (m2) name = m2[1];
      return res.blob().then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click();
        setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 900);
        toast('ok', label + ' 已开始下载', '文件名：' + name, 3400);
      });
    }).catch(function (e) {
      if (e.code === 'NEED_MEMBER') { toast('err', '需要超级会员', MSG.locked, 4200); openPricing(); }
      else if (e.code === 'NO_DATA') toast('info', '没有可导出的记录', e.message, 3600);
      else if (e.status === 401) { clearToken(); showGate('login'); }
      else toast('err', '导出失败', e.message);
    });
    return true;
  }

  /* ══════════════ 17. 全局事件 ══════════════ */
  function bindEvents() {
    /* 17.1 捕获阶段拦截被锁定的导航点击（必须早于应用自身的委托） */
    document.addEventListener('click', function (ev) {
      var el = ev.target.closest && ev.target.closest('[data-go]');
      if (!el) return;
      if (!S.ready) { ev.preventDefault(); ev.stopImmediatePropagation(); return; }
      if (isLockedPath(el.getAttribute('data-go'))) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        warnLocked();
      }
    }, true);

    /* 17.2 用户区 / 浮层按钮 */
    document.addEventListener('click', function (ev) {
      var t = ev.target;

      /* 头像菜单开关 */
      if (t.closest && t.closest('#wbChip')) {
        var u = $('#wbUser');
        var open = !u.classList.contains('open');
        u.classList.toggle('open', open);
        $('#wbChip').setAttribute('aria-expanded', open ? 'true' : 'false');
        return;
      }
      if (!t.closest || !t.closest('#wbUser')) {
        var u2 = $('#wbUser'); if (u2) u2.classList.remove('open');
      }

      /* data-wb 动作 */
      var act = t.closest && t.closest('[data-wb]');
      if (act) {
        var a = act.getAttribute('data-wb');
        var u3 = $('#wbUser'); if (u3) u3.classList.remove('open');
        if (a === 'pricing') { openPricing(); return; }
        if (a === 'mine') { openMine(); return; }
        if (a === 'records') { var f = L(); if (f && f.go) f.go('#/records'); return; }
        if (a === 'theme') { toggleTheme(); return; }
        if (a === 'logout') { doLogout(); return; }
        if (a === 'close') { closeOv(); return; }
        if (a === 'home') { var f2 = L(); if (f2 && f2.go) f2.go('#/home'); return; }
        if (a === 'contact') {
          toast('info', '请联系管理员开通',
            (S.user && (S.user.name || S.user.username) ? '你的账号：' + (S.user.name || S.user.username) + '。' : '') +
            '向管理员提供用户名或手机号即可开通 / 续费超级会员。', 6000);
          return;
        }
        return;
      }

      /* 定价浮层背景关闭 */
      if (t.id === 'wbOv') { closeOv(); return; }

      /* 图形验证码刷新 */
      var capBox = t.closest && t.closest('.wb-cap');
      if (capBox) {
        var scene = capBox.getAttribute('data-cap');
        refreshCaptcha(scene);
        var fm = capBox.closest('form');
        if (fm && fm.querySelector('[name=captcha]')) fm.querySelector('[name=captcha]').value = '';
        if (CAP[scene]) CAP[scene].input = '';
        return;
      }

      /* 发送短信验证码 */
      var smsBtn = t.closest && t.closest('[data-sms]');
      if (smsBtn && !smsBtn.disabled) { doSendSms(smsBtn.getAttribute('data-sms'), smsBtn); return; }

      /* 切换登录/注册/忘记密码 */
      var tab = t.closest && t.closest('#wbGate .wb-tab');
      if (tab) { setTab(tab.getAttribute('data-tab')); return; }
    });

    /* 17.3 表单提交 */
    document.addEventListener('submit', function (ev) {
      var f = ev.target;
      if (!f || !f.id) return;
      if (f.id === 'wbFormLogin') { ev.preventDefault(); doLogin(f); return; }
      if (f.id === 'wbFormRegister') { ev.preventDefault(); doRegister(f); return; }
      if (f.id === 'wbFormForgot') { ev.preventDefault(); doForgot(f); return; }
    });

    /* 17.4 ESC：只允许关闭定价浮层，不能关闭门禁与拦截框 */
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        if ($('#wbBlock').classList.contains('show')) { ev.stopPropagation(); return; }
        if ($('#wbGate').classList.contains('show')) { ev.stopPropagation(); return; }
        closeOv();
      }
      /* 门禁打开时屏蔽应用自身快捷键 */
      if ($('#wbGate').classList.contains('show') && ev.key === '/') {
        var ae = document.activeElement || {};
        if (!/input|textarea/i.test(ae.tagName || '')) ev.stopPropagation();
      }
    }, true);
  }

  /* ══════════════ 18. 启动 ══════════════ */
  function boot() {
    var f0 = L();
    if (!f0) { setTimeout(boot, 30); return; }

    S.app = {
      tutorials: f0.tutorials, commands: f0.commands, tips: f0.tips,
      tutIndex: f0.tutorialIndex, cmdIndex: f0.commandIndex, tipIndex: f0.tipIndex,
      groups: f0.groups,
    };

    injectDom();
    applyTheme();
    bindEvents();

    /* 注册钩子 */
    var h = f0.hooks;
    h.locked = function (unitId) { return isLockedUnit(unitId) ? true : null; };
    h.groupLocked = isLockedGroup;
    h.submit = hookSubmit;
    h.revoke = hookRevoke;
    h.export = hookExport;
    h.afterRender = afterRender;

    /* 会话恢复 */
    var t = null;
    try { t = localStorage.getItem(CFG.tokenKey); } catch (e) {}
    if (!t) { showGate('login'); return; }

    S.token = t;
    req('GET', '/api/auth/me').then(function (r) {
      S.user = r.data.user;
      S.member = r.data.member || (r.data.user && r.data.user.member);
      refreshUserChip();
      return loadContent().then(function () {
        hideGate();
        if (S.member && S.member.expired) onExpired();
      });
    }).catch(function (e) {
      clearToken();
      if (e.code === 'ACCOUNT_DISABLED') { showGate('login'); hideGate(); showBlock({ kind: 'disabled' }); return; }
      showGate('login');
      if (e.status !== 401) gateMsg('err', '连接后端失败：' + e.message + '（请确认后端服务已启动）');
    });
  }

  /* ══════════════ 19. 对测试暴露的只读接口 ══════════════ */
  window.__wb = {
    state: function () {
      return {
        ready: S.ready,
        token: !!S.token,
        user: S.user,
        member: S.member,
        app: S.app ? { tutorials: S.app.tutorials.length, commands: S.app.commands.length, tips: S.app.tips.length } : null,
        mapped: Object.keys(S.byTitle).length,
        theme: document.documentElement.getAttribute('data-theme'),
      };
    },
    isLockedUnit: isLockedUnit,
    isLockedPath: isLockedPath,
    isLockedGroup: isLockedGroup,
    bidOf: bidOf,
    openPricing: openPricing,
    openMine: openMine,
    showGate: showGate,
    doLogout: doLogout,
    refreshCaptcha: refreshCaptcha,
    captchaToken: function (scene) { return CAP[scene] ? CAP[scene].token : null; },
    msg: MSG,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
