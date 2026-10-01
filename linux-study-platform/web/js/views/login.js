/* ══════════════════════════════════════════════════════════════════
   views/login.js · 登录页
   ──────────────────────────────────────────────────────────────────
   · 学生 / 管理员分段切换（同一接口，role 参数区分）
   · 记住账号（密码不落盘，交由浏览器密码管理器）
   · 内置演示账号一键填充
   · 后端地址现场配置（前后端分离部署时使用）
   ══════════════════════════════════════════════════════════════════ */
(function (w, d) {
  'use strict';

  var U = w.U;
  var UI = w.UI;
  var API = w.API;
  var STORE = w.STORE;
  var CFG = w.APP_CONFIG;

  var DEMO = {
    student: [
      { u: 'student1', p: 'xiaoran2026', n: '学生一' },
      { u: 'student2', p: 'linux2026',   n: '学生二' },
      { u: 'student3', p: 'study2026',   n: '学生三' },
      { u: 'student4', p: 'buddy2026',   n: '学生四' },
      { u: 'student5', p: 'hello2026',   n: '学生五' },
    ],
    admin: [
      { u: 'admin', p: 'admin@2026', n: '管理员（教师）' },
    ],
  };

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
      tip: d.getElementById('loginTip'),
      seg: U.qsa('#loginPage .seg-btn'),
    };
  }

  function showErr(msg) {
    var e = els();
    if (!e.err) return;
    e.err.hidden = !msg;
    e.err.textContent = msg || '';
  }

  /* ───────── 演示账号展示 ───────── */
  function renderTip() {
    var e = els();
    if (!e.tip) return;

    var list = DEMO[Login.role] || [];
    var rows = list.map(function (a) {
      return '<button type="button" class="tip-acc" data-u="' + U.escAttr(a.u) + '" data-p="' + U.escAttr(a.p) + '">' +
        '<code>' + U.esc(a.u) + '</code>' +
        '<span class="tip-name">' + U.esc(a.n) + '</span>' +
        '<i>点击填充 ›</i>' +
      '</button>';
    }).join('');

    e.tip.innerHTML =
      '<div class="tip-head">' +
        '<b>' + (Login.role === 'admin' ? '管理员账号' : '学生演示账号') + '</b>' +
        '<span class="dim xsmall">点击任意一行自动填充</span>' +
      '</div>' +
      '<div class="tip-accs">' + rows + '</div>' +
      (Login.role === 'student'
        ? '<div class="tip-foot">5 个账号，密码各不相同；首次登录后请在「我的资料 → 修改密码」中更换。</div>'
        : '<div class="tip-foot">管理员可查看全部学生进度、督促学生、出题与维护目录。请务必修改默认密码。</div>') +
      '<div class="tip-foot dim">数据存储于 MySQL · 支持手机 / 平板 / Windows / macOS / 国产系统</div>';
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

    API.auth.login(username, password, Login.role).then(function (r) {
      API.setToken(r.token);
      STORE.setSession(r.user);

      if (e.remember && e.remember.checked) STORE.write('lsp.lastUser', username);
      else STORE.write('lsp.lastUser', '');

      UI.setBackend('ok');
      UI.toast('欢迎回来，' + (r.user.name || r.user.username), 'ok', '登录成功', 2200);
      w.dispatchEvent(new CustomEvent('lsp:login', { detail: r.user }));
    }).catch(function (err) {
      var msg = err && err.message ? err.message : '登录失败';
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
      restore();
      Login.busy = false;
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
        renderTip();
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

    // 演示账号填充
    if (e.tip) {
      e.tip.addEventListener('click', function (ev) {
        var btn = ev.target.closest && ev.target.closest('.tip-acc');
        if (!btn) return;
        e.user.value = btn.dataset.u || '';
        e.pass.value = btn.dataset.p || '';
        showErr('');
        UI.toast('已填充 ' + btn.dataset.u + ' 的账号密码，点击「进入学习」即可', 'info', null, 2600);
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
    renderTip();
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
  Login.DEMO = DEMO;

  w.LoginView = Login;
})(window, document);
