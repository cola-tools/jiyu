/* ══════════════════════════════════════════════════════════════════
   views/login.js · 单一登录窗口
   ──────────────────────────────────────────────────────────────────
   · 登录页本身只有一个「身份网关」：标题 + 两个身份按钮
   · 点击「学生登录 / 管理员登录」才弹出对应的登录窗（同一接口，role 区分）
   · 登录窗内三个页签：登录 / 注册账号 / 忘记密码（自助入口已并入）
       —— 管理员身份只开放「登录」
   · UX：自动聚焦、回车提交、密码明文切换、大写锁定提示、记住账号、
     图形验证码 + 短信验证码、60s 重发倒计时、错误抖动、登录中按钮锁定、
     窗内可切换身份
   · 账号密码一律由用户手动输入，前端不内置任何账号信息
   ══════════════════════════════════════════════════════════════════ */
(function (w, d) {
  'use strict';

  var U = w.U;
  var UI = w.UI;
  var API = w.API;
  var STORE = w.STORE;
  var CFG = w.APP_CONFIG;

  var ROLE = {
    student: {
      key: 'student', icon: '🙋',
      title: '学生登录', desc: '课程学习 · 命令大全 · 每日打卡',
      btn: '进入学习', user: '请输入学生账号',
      other: 'admin', otherText: '我是管理员，换个身份登录 →',
    },
    admin: {
      key: 'admin', icon: '🧑‍🏫',
      title: '管理员登录', desc: '学生管理 · 督促提醒 · 练习出题',
      btn: '进入管理后台', user: '请输入管理员账号',
      other: 'student', otherText: '我是学生，换个身份登录 →',
    },
  };

  var MODE = {
    login: { name: '登录' },
    register: { name: '注册账号' },
    forgot: { name: '忘记密码' },
  };

  var Login = {
    role: 'student',
    mode: 'login',
    busy: false,
    modal: null,
    cap: { token: '', scene: 'register' },
    smsTimer: null,
    smsLeft: 0,
    lastUser: '',
  };

  /* ───────── DOM 取用（登录窗打开时 id 才存在） ───────── */
  function els() {
    return {
      page: d.getElementById('loginPage'),
      gate: d.getElementById('loginGate'),
      /* 登录 */
      form: d.getElementById('loginForm'),
      user: d.getElementById('loginUser'),
      pass: d.getElementById('loginPass'),
      remember: d.getElementById('loginRemember'),
      btn: d.getElementById('loginBtn'),
      eye: d.getElementById('loginEye'),
      caps: d.getElementById('loginCaps'),
      /* 注册 */
      regForm: d.getElementById('regForm'),
      regBtn: d.getElementById('regBtn'),
      /* 忘记密码 */
      forgotForm: d.getElementById('forgotForm'),
      forgotBtn: d.getElementById('forgotBtn'),
      /* 共用 */
      err: d.getElementById('loginErr') || d.getElementById('regErr') || d.getElementById('forgotErr'),
      switcher: d.getElementById('loginSwitch'),
      capImg: d.getElementById('capImg'),
      capInput: d.getElementById('capInput'),
      capRefresh: d.getElementById('capRefresh'),
      smsBtn: d.getElementById('smsBtn'),
    };
  }

  function errBox() {
    return d.getElementById('loginErr') || d.getElementById('regErr') || d.getElementById('forgotErr');
  }

  function showErr(msg) {
    var box = errBox();
    if (!box) return;
    box.hidden = !msg;
    box.textContent = msg || '';
    if (msg) {
      box.classList.remove('shake');
      void box.offsetWidth;
      box.classList.add('shake');
    }
  }

  /* ───────── 图形验证码 ───────── */
  function loadCaptcha(scene) {
    var e = els();
    Login.cap.scene = scene || Login.cap.scene || 'register';
    if (e.capImg) e.capImg.innerHTML = '<span class="cap-ph">加载中…</span>';
    return API.auth.captcha().then(function (r) {
      Login.cap.token = r && r.token ? r.token : '';
      var box = d.getElementById('capImg');
      if (box) {
        box.innerHTML = r && r.svg ? r.svg : '<span class="cap-ph">（无）</span>';
        box.setAttribute('data-token', Login.cap.token);
      }
      return Login.cap.token;
    }).catch(function () {
      Login.cap.token = '';
      var box = d.getElementById('capImg');
      if (box) box.innerHTML = '<span class="cap-ph">点击刷新</span>';
      return '';
    });
  }

  function refreshCaptcha(scene) {
    return loadCaptcha(scene);
  }

  /* ───────── 短信验证码 ───────── */
  function startSmsCountdown() {
    var btn = d.getElementById('smsBtn');
    if (!btn) return;
    Login.smsLeft = 60;
    btn.disabled = true;
    btn.textContent = Login.smsLeft + 's 后重发';
    if (Login.smsTimer) clearInterval(Login.smsTimer);
    Login.smsTimer = setInterval(function () {
      Login.smsLeft -= 1;
      var b = d.getElementById('smsBtn');
      if (!b) { clearInterval(Login.smsTimer); Login.smsTimer = null; return; }
      if (Login.smsLeft <= 0) {
        clearInterval(Login.smsTimer);
        Login.smsTimer = null;
        b.disabled = false;
        b.textContent = '获取验证码';
        return;
      }
      b.textContent = Login.smsLeft + 's 后重发';
    }, 1000);
  }

  function sendSms(scene, formEl) {
    var e = els();
    var phone = formEl ? String((formEl.querySelector('[name="phone"]') || {}).value || '').trim() : '';
    var capIn = formEl ? String((formEl.querySelector('[name="captcha"]') || {}).value || '').trim() : '';

    if (!phone) { showErr('请输入手机号'); return; }
    if (!capIn) { showErr('请输入图形验证码中的字符'); return; }

    var btn = e.smsBtn;
    var restore = btn ? UI.btnBusy(btn, '发送中…') : function () {};
    showErr('');

    API.auth.sms(phone, scene, Login.cap.token, capIn).then(function (r) {
      restore();
      startSmsCountdown();
      var dev = r && r.devCode ? String(r.devCode) : '';
      var msg = '验证码已发送至 ' + phone + (dev ? '（开发环境验证码：' + dev + '）' : '');
      UI.toast(msg, 'ok', '短信已发送', dev ? 8000 : 3000);
      // 短信发出后图形验证码作废，换一张
      refreshCaptcha(scene);
      if (formEl) {
        var ci = formEl.querySelector('[name="captcha"]');
        if (ci) ci.value = '';
      }
    }).catch(function (err) {
      restore();
      showErr(err && err.message ? err.message : '短信发送失败');
      refreshCaptcha(scene);
    });
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

  /* ═══════════ 登录窗 HTML ═══════════ */

  function inp(icon, id, name, type, ph, val, extra) {
    return '<span class="inp-wrap' + (extra === 'eye' ? ' has-eye' : '') + '">' +
      '<span class="inp-ico">' + icon + '</span>' +
      '<input class="input" id="' + id + '" name="' + name + '" type="' + type + '"' +
        ' autocomplete="' + (type === 'password' ? 'current-password' : 'off') + '"' +
        ' placeholder="' + U.escAttr(ph) + '"' +
        (val ? ' value="' + U.escAttr(val) + '"' : '') + '>' +
      (extra === 'eye'
        ? '<button class="eye-btn" id="loginEye" type="button" aria-label="显示密码" title="显示密码">👁</button>'
        : '') +
      '</span>';
  }

  function capRow() {
    return '<div class="cap-row">' +
      '<span class="cap-img" id="capImg" data-token="' + U.escAttr(Login.cap.token) + '"' +
        ' title="点击换一张"><span class="cap-ph">加载中…</span></span>' +
      '<input class="input" id="capInput" name="captcha" type="text" maxlength="6"' +
        ' autocomplete="off" placeholder="图中字符">' +
      '<button class="btn btn-sm" id="capRefresh" type="button" title="换一张">🔄</button>' +
      '</div>';
  }

  function smsRow(scene) {
    return '<div class="field">' +
      '<label class="field-label">短信验证码</label>' +
      '<span class="sms-wrap">' +
        '<input class="input" name="smsCode" type="text" maxlength="6" inputmode="numeric"' +
          ' autocomplete="one-time-code" placeholder="6 位数字">' +
        '<button class="btn" id="smsBtn" type="button" data-scene="' + scene + '">获取验证码</button>' +
      '</span>' +
      '</div>';
  }

  function loginFormHtml(r) {
    var lastUser = STORE.read('lsp.lastUser', '') || Login.lastUser || '';
    return '<form id="loginForm" autocomplete="on" novalidate>' +
      '<div class="field">' +
        '<label class="field-label" for="loginUser">账号</label>' +
        inp('👤', 'loginUser', 'username', 'text', r.user, lastUser) +
      '</div>' +
      '<div class="field">' +
        '<label class="field-label" for="loginPass">密码</label>' +
        inp('🔒', 'loginPass', 'password', 'password', '请输入密码', '', 'eye') +
      '</div>' +
      '<div class="lgm-row">' +
        '<label class="checkline"><input type="checkbox" id="loginRemember"' +
          (lastUser ? ' checked' : '') + '> <span>记住账号</span></label>' +
        '<span class="caps-hint" id="loginCaps" hidden>⌨ 大写锁定已开启</span>' +
      '</div>' +
      '<div class="login-err" id="loginErr" hidden></div>' +
      '<button class="btn btn-primary btn-lg btn-block" id="loginBtn" type="submit">' + r.btn + '</button>' +
      '</form>';
  }

  function registerFormHtml() {
    return '<form id="regForm" autocomplete="off" novalidate>' +
      '<div class="field">' +
        '<label class="field-label" for="regUser">用户名</label>' +
        inp('👤', 'regUser', 'username', 'text', '2-20 位，中英文 / 数字 / 下划线') +
      '</div>' +
      '<div class="field">' +
        '<label class="field-label" for="regPass">密码</label>' +
        inp('🔒', 'regPass', 'password', 'password', '至少 6 位') +
      '</div>' +
      '<div class="field">' +
        '<label class="field-label" for="regPass2">确认密码</label>' +
        inp('🔒', 'regPass2', 'password2', 'password', '请再输入一次密码') +
      '</div>' +
      '<div class="field">' +
        '<label class="field-label" for="regPhone">手机号 <i class="fh">注册后与账号绑定</i></label>' +
        inp('📱', 'regPhone', 'phone', 'tel', '11 位手机号') +
      '</div>' +
      smsRow('register') +
      '<div class="field">' +
        '<label class="field-label">图形验证码</label>' +
        capRow() +
      '</div>' +
      '<div class="login-err" id="regErr" hidden></div>' +
      '<button class="btn btn-primary btn-lg btn-block" id="regBtn" type="submit">注册账号</button>' +
      '<div class="lgm-note">注册后默认<b>普通会员</b>，请联系管理员开通<b>超级会员</b>后登录。</div>' +
      '</form>';
  }

  function forgotFormHtml() {
    return '<form id="forgotForm" autocomplete="off" novalidate>' +
      '<div class="field">' +
        '<label class="field-label" for="fgPhone">手机号 <i class="fh">须为注册时使用的手机号</i></label>' +
        inp('📱', 'fgPhone', 'phone', 'tel', '11 位手机号') +
      '</div>' +
      smsRow('forgot') +
      '<div class="field">' +
        '<label class="field-label" for="fgPass">新密码</label>' +
        inp('🔒', 'fgPass', 'newPassword', 'password', '至少 6 位') +
      '</div>' +
      '<div class="field">' +
        '<label class="field-label" for="fgPass2">确认新密码</label>' +
        inp('🔒', 'fgPass2', 'newPassword2', 'password', '请再输入一次新密码') +
      '</div>' +
      '<div class="field">' +
        '<label class="field-label">图形验证码</label>' +
        capRow() +
      '</div>' +
      '<div class="login-err" id="forgotErr" hidden></div>' +
      '<button class="btn btn-primary btn-lg btn-block" id="forgotBtn" type="submit">重置密码</button>' +
      '</form>';
  }

  function bodyHtml(role, mode) {
    var r = ROLE[role] || ROLE.student;
    var m = MODE[mode] ? mode : 'login';
    var isStudent = r.key === 'student';

    var tabs = '';
    if (isStudent) {
      tabs = '<div class="lgm-tabs" role="tablist">' +
        Object.keys(MODE).map(function (k) {
          return '<button class="ltab' + (k === m ? ' on' : '') + '" data-tab="' + k +
            '" type="button" role="tab">' + MODE[k].name + '</button>';
        }).join('') +
        '</div>';
    }

    var sub = m === 'login' ? r.desc
      : (m === 'register' ? '注册后请联系管理员开通超级会员' : '通过注册手机号重置登录密码');

    var body = m === 'login' ? loginFormHtml(r)
      : (m === 'register' ? registerFormHtml() : forgotFormHtml());

    var switcher = m === 'login'
      ? '<button class="lgm-switch" id="loginSwitch" type="button">' + r.otherText + '</button>'
      : '<button class="lgm-switch" id="loginSwitch" type="button">← 返回登录</button>';

    return '<div class="lgm">' +
      '<div class="lgm-head">' +
        '<span class="lgm-ico">' + r.icon + '</span>' +
        '<span class="lgm-txt"><b>' + r.title + '</b><i>' + sub + '</i></span>' +
      '</div>' +
      tabs + body + switcher +
      '</div>';
  }

  /* ═══════════ 绑定 ═══════════ */

  function bindLoginForm() {
    var e = els();
    if (!e.form) return;

    e.form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      doLogin();
    });

    if (e.pass && e.eye) {
      e.eye.addEventListener('click', function () {
        var show = e.pass.type === 'password';
        e.pass.type = show ? 'text' : 'password';
        e.eye.textContent = show ? '🙈' : '👁';
        e.eye.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
        e.eye.setAttribute('title', show ? '隐藏密码' : '显示密码');
        try { e.pass.focus(); } catch (x) { /* 忽略 */ }
      });
    }

    if (e.pass && e.caps) {
      var capsHandler = function (ev) {
        var on = false;
        try { on = !!ev.getModifierState && ev.getModifierState('CapsLock'); } catch (x) { on = false; }
        e.caps.hidden = !on;
      };
      e.pass.addEventListener('keydown', capsHandler);
      e.pass.addEventListener('keyup', capsHandler);
      e.pass.addEventListener('blur', function () { e.caps.hidden = true; });
    }
  }

  function bindCaptcha(scene) {
    var e = els();

    if (e.capImg) {
      e.capImg.addEventListener('click', function () { refreshCaptcha(scene); });
    }
    if (e.capRefresh) {
      e.capRefresh.addEventListener('click', function () { refreshCaptcha(scene); });
    }
    if (e.smsBtn) {
      e.smsBtn.addEventListener('click', function () {
        var form = e.smsBtn.closest('form');
        sendSms(e.smsBtn.dataset.scene || scene, form);
      });
    }
    // 首次进入注册 / 忘记密码页签时自动取一张图形验证码
    loadCaptcha(scene);
  }

  function bindRegisterForm() {
    var e = els();
    if (!e.regForm) return;
    e.regForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      doRegister(e.regForm);
    });
    bindCaptcha('register');
  }

  function bindForgotForm() {
    var e = els();
    if (!e.forgotForm) return;
    e.forgotForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      doForgot(e.forgotForm);
    });
    bindCaptcha('forgot');
  }

  function val(form, name) {
    var el = form.querySelector('[name="' + name + '"]');
    return el ? String(el.value || '').trim() : '';
  }

  function doRegister(form) {
    if (Login.busy) return;
    var data = {
      username: val(form, 'username'),
      password: val(form, 'password'),
      password2: val(form, 'password2'),
      phone: val(form, 'phone'),
      smsCode: val(form, 'smsCode'),
      captchaToken: Login.cap.token,
      captcha: val(form, 'captcha'),
    };
    if (!data.username) { showErr('请输入用户名'); return; }
    if (data.password.length < 6) { showErr('密码至少 6 位'); return; }
    if (data.password !== data.password2) { showErr('两次输入的密码不一致'); return; }
    if (!data.phone) { showErr('请输入手机号'); return; }
    if (!data.smsCode) { showErr('请输入短信验证码'); return; }
    if (!data.captcha) { showErr('请输入图形验证码中的字符'); return; }

    showErr('');
    Login.busy = true;
    var restore = UI.btnBusy(d.getElementById('regBtn'), '注册中…');
    var done = function () { Login.busy = false; restore(); };

    API.auth.register(data).then(function () {
      done();
      Login.lastUser = data.username;
      UI.toast('注册成功，当前为普通会员，请联系管理员开通超级会员后登录', 'ok', '注册成功', 5000);
      // 注册成功后回到登录页签，并预填用户名
      switchMode('login');
      var u = d.getElementById('loginUser');
      if (u) { u.value = data.username; }
      var p = d.getElementById('loginPass');
      if (p) { p.focus(); }
    }).catch(function (err) {
      done();
      showErr(err && err.message ? err.message : '注册失败');
      refreshCaptcha('register');
    });
  }

  function doForgot(form) {
    if (Login.busy) return;
    var data = {
      phone: val(form, 'phone'),
      smsCode: val(form, 'smsCode'),
      newPassword: val(form, 'newPassword'),
      newPassword2: val(form, 'newPassword2'),
    };
    if (!data.phone) { showErr('请输入手机号'); return; }
    if (data.newPassword.length < 6) { showErr('新密码至少 6 位'); return; }
    if (data.newPassword !== data.newPassword2) { showErr('两次输入的新密码不一致'); return; }
    if (!data.smsCode) { showErr('请输入短信验证码'); return; }

    showErr('');
    Login.busy = true;
    var restore = UI.btnBusy(d.getElementById('forgotBtn'), '提交中…');
    var done = function () { Login.busy = false; restore(); };

    API.auth.forgot(data).then(function () {
      done();
      UI.toast('密码已重置，请使用新密码登录', 'ok', '重置成功', 4000);
      switchMode('login');
    }).catch(function (err) {
      done();
      showErr(err && err.message ? err.message : '重置失败');
      refreshCaptcha('forgot');
    });
  }

  /* ───────── 登录流程 ───────── */
  function doLogin() {
    var e = els();
    if (Login.busy) return;
    if (!e.user || !e.pass) return;

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

    function okToast(r) {
      UI.setBackend('ok');
      UI.toast('欢迎回来，' + (r.user.name || r.user.username), 'ok', '登录成功', 2200);
    }

    API.auth.login(username, password, Login.role, platform).then(function (r) {
      API.setToken(r.token);
      STORE.setSession(r.user);

      if (e.remember && e.remember.checked) STORE.write('lsp.lastUser', username);
      else STORE.write('lsp.lastUser', '');

      /* 会员门禁：普通会员 / 已到期 → 在登录窗内提示并保持未登录态 */
      var gate = w.MemberGate;
      if (gate && Login.role === 'student') {
        return gate.check().then(function (res) {
          if (!res.ok) {
            API.clearToken();
            STORE.clearSession();
            showErr(res.code === 'ACCOUNT_DISABLED'
              ? gate.MSG.DISABLED : gate.MSG.NEED_MEMBER);
            return null;
          }
          closeModal('ok');
          okToast(r);
          w.dispatchEvent(new CustomEvent('lsp:login', { detail: r.user }));
        });
      }

      closeModal('ok');
      okToast(r);
      w.dispatchEvent(new CustomEvent('lsp:login', { detail: r.user }));
    }).catch(function (err) {
      var msg = err && err.message ? err.message : '登录失败';

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

  /* ═══════════ 窗口生命周期 ═══════════ */

  function mount(role, mode) {
    if (!Login.modal) return;
    Login.mode = MODE[mode] ? mode : 'login';
    Login.modal.setBody(bodyHtml(role, Login.mode));

    if (Login.mode === 'login') bindLoginForm();
    else if (Login.mode === 'register') bindRegisterForm();
    else bindForgotForm();

    // 页签切换
    U.qsa('.lgm-tabs .ltab', Login.modal.body).forEach(function (b) {
      b.addEventListener('click', function () { switchMode(b.dataset.tab); });
    });

    // 窗内切换身份 / 返回登录
    var sw = Login.modal.query('#loginSwitch');
    if (sw) {
      sw.addEventListener('click', function () {
        if (Login.mode === 'login') open((ROLE[role] || ROLE.student).other, 'login');
        else switchMode('login');
      });
    }

    // 自动聚焦
    setTimeout(function () {
      var first = Login.modal.body.querySelector('input:not([type=hidden])');
      if (!first) return;
      if (Login.mode === 'login') {
        var u = d.getElementById('loginUser');
        var p = d.getElementById('loginPass');
        try { (u && u.value ? p : u || first).focus(); } catch (x) { /* 忽略 */ }
      } else {
        try { first.focus(); } catch (x) { /* 忽略 */ }
      }
    }, 180);
  }

  function switchMode(mode) {
    if (!Login.modal) return;
    if (Login.smsTimer) { clearInterval(Login.smsTimer); Login.smsTimer = null; }
    mount(Login.role, mode);
  }

  /**
   * 打开对应身份的登录窗
   * @param {'student'|'admin'} role
   * @param {'login'|'register'|'forgot'} mode
   */
  function open(role, mode) {
    var r = ROLE[role] ? role : 'student';
    var m = MODE[mode] ? mode : 'login';
    if (r === 'admin') m = 'login';

    if (Login.modal) { try { Login.modal.close('switch'); } catch (e) { /* 忽略 */ } Login.modal = null; }
    if (Login.smsTimer) { clearInterval(Login.smsTimer); Login.smsTimer = null; }

    Login.role = r;
    Login.busy = false;

    var cfg = ROLE[r];
    var m2 = UI.modal({
      title: cfg.title,
      size: 'sm',
      body: bodyHtml(r, m),
      foot: '',
      onClose: function () {
        Login.busy = false;
        if (Login.smsTimer) { clearInterval(Login.smsTimer); Login.smsTimer = null; }
        if (Login.modal === m2) Login.modal = null;
      },
    });
    Login.modal = m2;
    if (m2.foot) m2.foot.style.display = 'none';

    mount(r, m);
    return m2;
  }

  function closeModal(reason) {
    if (Login.modal) {
      try { Login.modal.close(reason || 'done'); } catch (e) { /* 忽略 */ }
      Login.modal = null;
    }
  }

  /* ───────── 显示 / 隐藏 ───────── */
  function bind() {
    var e = els();
    if (!e.page) return;

    U.qsa('#loginGate .role-card', e.page).forEach(function (btn) {
      btn.addEventListener('click', function () {
        open(btn.dataset.role === 'admin' ? 'admin' : 'student', 'login');
      });
    });

    UI.bindThemeButtons();
  }

  function show() {
    var e = els();
    if (!e.page) return;
    closeModal('reset');
    Login.mode = 'login';
    Login.busy = false;
    e.page.hidden = false;
    if (e.gate) {
      e.gate.classList.remove('in');
      void e.gate.offsetWidth;
      e.gate.classList.add('in');
    }
  }

  function hide() {
    var e = els();
    if (!e.page) return;
    closeModal('logged');
    e.page.hidden = true;
  }

  Login.show = show;
  Login.hide = hide;
  Login.bind = bind;
  Login.open = open;
  Login.switchMode = switchMode;
  Login.refreshCaptcha = refreshCaptcha;
  Login.captchaToken = function () { return Login.cap.token; };
  Login.openApiSetting = openApiSetting;

  w.LoginView = Login;
})(window, document);
