/* ══════════════════════════════════════════════════════════════════
   views/login.js · 登录页
   ──────────────────────────────────────────────────────────────────
   · 学生 / 管理员分段切换（同一接口，role 参数区分）
   · 记住账号（密码不落盘，交由浏览器密码管理器）
   · 后端地址现场配置（前后端分离部署时使用）
   · 账号密码一律由用户手动输入，前端不内置任何账号信息
   ══════════════════════════════════════════════════════════════════ */
(function (w, d) {
  'use strict';

  var U = w.U;
  var UI = w.UI;
  var API = w.API;
  var STORE = w.STORE;
  var CFG = w.APP_CONFIG;

  var Login = {
    role: 'student',
    busy: false,
  };

  function els() {
    return {
      page: d.getElementById('loginPage'),
      form: d.getElementById('loginForm'),
      user: d.getElementById('loginUser'),
      pass: d.getElementById('loginPass'),
      remember: d.getElementById('loginRemember'),
      err: d.getElementById('loginErr'),
      btn: d.getElementById('loginBtn'),
      seg: U.qsa('#loginPage .seg-btn'),
    };
  }

  function showErr(msg) {
    var e = els();
    if (!e.err) return;
    e.err.hidden = !msg;
    e.err.textContent = msg || '';
  }

  /* ───────── 后端地址配置 ───────── */
  function openApiSetting() {
    var cur = CFG.API_BASE || '';
    UI.modal({
      title: '后端服务地址',
      size: 'sm',
      body:
        '<div class="field-hint" style="margin-bottom:12px">' +
          '当前前端页面与后端接口可以分别部署在不同服务器上。' +
          '如果后端不在同一域名下，请在此填写后端地址（例如 <code class="inline">https://api.example.com</code>）；' +
          '留空表示与页面同源。' +
        '</div>' +
        '<div class="field">' +
          '<label class="field-label">API 基地址</label>' +
          '<input class="input" id="apiBaseInput" type="text" placeholder="https://api.example.com" value="' + U.escAttr(cur) + '">' +
          '<div class="field-hint">不要带结尾斜杠；不要包含 /api 后缀（会自动拼接）。</div>' +
        '</div>' +
        '<div class="note info" style="margin-top:4px">' +
          '<span class="n-ico">💡</span>' +
          '<span>本机调试时可填 <code class="inline">http://127.0.0.1:3000</code>。' +
          '部署步骤见项目根目录的 <code class="inline">DEPLOY.md</code>。</span>' +
        '</div>',
      foot:
        '<button class="btn" data-act="same" type="button">使用同源</button>' +
        '<button class="btn btn-primary" data-act="save" type="button">保存并刷新</button>',
      onMount: function (m) {
        m.foot.querySelector('[data-act="same"]').addEventListener('click', function () {
          CFG.setApiBase('');
        });
        m.foot.querySelector('[data-act="save"]').addEventListener('click', function () {
          var v = m.query('#apiBaseInput').value.trim();
          if (v && !CFG.setApiBase(v, false)) {
            UI.err('地址格式不正确，需以 http:// 或 https:// 开头');
            return;
          }
          if (!v) CFG.setApiBase('', false);
          w.location.reload();
        });
      },
    });
  }

  /* ───────── 登录流程 ───────── */
  function doLogin() {
    var e = els();
    if (Login.busy) return;

    var username = (e.user.value || '').trim();
    var password = e.pass.value || '';

    if (!username) { showErr('请输入账号'); e.user.focus(); return; }
    if (!password) { showErr('请输入密码'); e.pass.focus(); return; }

    showErr('');
    Login.busy = true;
    var restore = UI.btnBusy(e.btn, '登录中…');
    var finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      Login.busy = false;
      restore();
    }

    /* 本页是「打卡平台」，学生登录时携带 platform=checkin，
       后端会校验超级会员身份：普通会员 / 已过期 → 403 NEED_MEMBER */
    var platform = Login.role === 'student' ? 'checkin' : 'learn';

    API.auth.login(username, password, Login.role, platform).then(function (r) {
      API.setToken(r.token);
      STORE.setSession(r.user);

      if (e.remember && e.remember.checked) STORE.write('lsp.lastUser', username);
      else STORE.write('lsp.lastUser', '');

      /* 会员门禁：普通会员 / 已到期 → 弹不可取消的提示并保持未登录态 */
      var gate = w.MemberGate;
      if (gate && Login.role === 'student') {
        finish();
        return gate.check().then(function (res) {
          if (!res.ok) {
            API.clearToken();
            STORE.clearSession();
            showErr(res.code === 'ACCOUNT_DISABLED'
              ? gate.MSG.DISABLED : gate.MSG.NEED_MEMBER);
            return null;
          }
          UI.setBackend('ok');
          UI.toast('欢迎回来，' + (r.user.name || r.user.username), 'ok', '登录成功', 2200);
          w.dispatchEvent(new CustomEvent('lsp:login', { detail: r.user }));
        });
      }

      UI.setBackend('ok');
      UI.toast('欢迎回来，' + (r.user.name || r.user.username), 'ok', '登录成功', 2200);
      w.dispatchEvent(new CustomEvent('lsp:login', { detail: r.user }));
    }).catch(function (err) {
      var msg = err && err.message ? err.message : '登录失败';

      /* 会员 / 账号状态类错误：给出与需求完全一致的文案 */
      if (err && (err.code === 'NEED_MEMBER' || (err.payload && err.payload.code === 'NEED_MEMBER'))) {
        showErr('你还未开通会员，无法使用打卡平台，请联系管理员开通会员后再使用！');
        API.clearToken();
        STORE.clearSession();
        return;
      }
      if (err && (err.code === 'ACCOUNT_DISABLED' || (err.payload && err.payload.code === 'ACCOUNT_DISABLED'))) {
        showErr('您的账号已被管理员设置为禁用，请联系管理员开通账号使用权限');
        API.clearToken();
        STORE.clearSession();
        return;
      }

      if (err && err.code === 'NETWORK_ERROR') {
        showErr('无法连接后端服务，请检查服务地址是否正确');
        UI.modal({
          title: '后端服务未连接',
          size: 'sm',
          body:
            '<div style="font-size:16px;line-height:1.86">' +
              '当前页面无法访问后端接口：<br>' +
              '<code class="inline">' + U.esc(CFG.API_BASE || w.location.origin) + '/api/health</code>' +
            '</div>' +
            '<div class="note warn" style="margin-top:14px"><span class="n-ico">⚠️</span><span>' +
              '常见原因：① 后端服务尚未启动；② 后端地址配置错误；' +
              '③ 后端未放行当前前端域名（CORS）。详见 DEPLOY.md。' +
            '</span></div>' +
            '<div class="field-hint" style="margin-top:12px">' +
              '本机开发时后端地址一般为 <code class="inline">http://127.0.0.1:3000</code>。' +
            '</div>',
          foot: '<button class="btn" data-act="close" type="button">取消</button>' +
                '<button class="btn btn-primary" data-act="cfg" type="button">配置后端地址</button>',
          onMount: function (m) {
            m.foot.querySelector('[data-act="close"]').addEventListener('click', function () { m.close(); });
            m.foot.querySelector('[data-act="cfg"]').addEventListener('click', function () {
              m.close();
              openApiSetting();
            });
          },
        });
      } else {
        showErr(msg);
      }
      UI.toast(msg, 'err', '登录失败');
    }).then(function () {
      finish();
    });
  }

  /* ───────── 事件绑定 ───────── */
  function bind() {
    var e = els();
    if (!e.page) return;

    // 分段切换
    (e.seg || []).forEach(function (btn) {
      btn.addEventListener('click', function () {
        Login.role = btn.dataset.role === 'admin' ? 'admin' : 'student';
        (e.seg || []).forEach(function (b) { b.classList.toggle('on', b === btn); });
        showErr('');
        var b2 = d.getElementById('loginBtn');
        if (b2) b2.textContent = Login.role === 'admin' ? '进入管理后台' : '进入学习';
        // 切换角色后清空密码，避免误用
        e.pass.value = '';
      });
    });

    // 提交
    if (e.form) {
      e.form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        doLogin();
      });
    }

    // 记住的账号
    var last = STORE.read('lsp.lastUser', '');
    if (last && e.user) {
      e.user.value = last;
      if (e.remember) e.remember.checked = true;
      setTimeout(function () { if (e.pass) e.pass.focus(); }, 420);
    }

    // 右上角主题按钮
    UI.bindThemeButtons();
  }

  /* ───────── 显示 / 隐藏 ───────── */
  function show() {
    var e = els();
    if (!e.page) return;
    e.page.hidden = false;
    Login.role = 'student';
    if (e.seg) e.seg.forEach(function (b) { b.classList.toggle('on', b.dataset.role === 'student'); });
    showErr('');
    if (e.btn) e.btn.textContent = '进入学习';
  }

  function hide() {
    var e = els();
    if (e.page) e.page.hidden = true;
  }

  Login.show = show;
  Login.hide = hide;
  Login.bind = bind;
  Login.openApiSetting = openApiSetting;

  w.LoginView = Login;
})(window, document);
