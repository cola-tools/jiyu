'use strict';
/* ══════════════════════════════════════════════════════════════════
   会员体系 · 浏览器端到端测试（零依赖，CDP 直连无头 Chrome）
   ──────────────────────────────────────────────────────────────────
   覆盖：
   ①  学习平台注册（图形验证码 + 短信验证码 + 手机号唯一）
   ②  普通会员章节门禁：🔒 标记 + 精确拦截文案 + 定价浮层
   ③  学习平台定价页（5 档、价格、权益）
   ④  深浅主题切换
   ⑤  打卡平台：普通会员登录被拒（逐字文案）
   ⑥  管理后台会员管理：开通 / 3 秒后叠加续费 / 变更流水 / 禁用恢复 / 筛选
   ⑦  管理后台定价配置：改价 → 前端实时同步
   ⑧  升级为超级会员后：金色「超级会员」徽标 + 全章节解锁
   ⑨  剩余不足 3 天：提示文案 + 右下角动态倒计时（x天x时x分x秒）
   ⑩  会员到期：不可取消的「会员到期提醒」强制退出 → 再登录提示未开通会员

   前置：
     1) MySQL 已初始化（db/schema.sql + 迁移 + 种子数据）
     2) 后端已启动（默认 http://127.0.0.1:3210，DB 默认 127.0.0.1:3399）
   运行：
     node tests/browser-member.js
   ══════════════════════════════════════════════════════════════════ */
const path = require('path');
const mysql = require(path.join(__dirname, '..', 'server', 'node_modules', 'mysql2', 'promise'));
const { T, launch, sleep, sel, LAST_TOAST } = require('./lib/cdp');

const BASE = process.env.BASE || 'http://127.0.0.1:3210';
const DB = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3399),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'linux_study',
  dateStrings: true,
};

const ok = (n, c, e) => T.ok.call(T, n, c, e);
const eq = (n, a, b) => T.eq.call(T, n, a, b);
const section = (t) => T.section(t);

/* ───────── 文案常量（必须与需求逐字一致） ───────── */
const MSG = {
  LOCKED: '你还未开通超级会员，请联系管理员开通后进行学习！',
  NEED_MEMBER: '你还未开通会员，无法使用打卡平台，请联系管理员开通会员后再使用！',
  DISABLED: '您的账号已被管理员设置为禁用，请联系管理员开通账号使用权限',
  DUE_WARN: '你的会员期限已不足3天，为了能够正常使用该平台，请及时联系管理员进行续费！',
  PHONE_TAKEN: '该手机号已绑定账号，请直接登录！',
};

/* ───────── 测试账号（手机号全局唯一，避免污染历史数据） ───────── */
const tail = String(Date.now()).slice(-9);
const ACC = {
  username: 'vip' + tail.slice(-6),
  password: 'Vip@' + tail.slice(-4) + 'a1',
  name: '会员测试' + tail.slice(-4),
  phone: '19' + tail,            // 11 位，1[3-9] 开头
};
const ACC2 = {                   // 第二个账号：用于校验手机号唯一性
  username: 'vipb' + tail.slice(-5),
  password: 'Vip@' + tail.slice(-3) + 'b2',
  phone: '18' + tail,
};

let conn;

/* ═══════════════ HTTP 辅助（Node 侧） ═══════════════ */
async function api(method, url, opts) {
  const o = opts || {};
  const headers = { 'Content-Type': 'application/json' };
  if (o.token) headers.Authorization = 'Bearer ' + o.token;
  const res = await fetch(BASE + url, {
    method,
    headers,
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, json: ct.includes('application/json') ? await res.json() : null, headers: res.headers };
}

let ADMIN_TOKEN = '';
async function adminLogin() {
  const r = await api('POST', '/api/auth/login', {
    body: { account: 'admin', password: 'admin@2026', role: 'admin', platform: 'learn' },
  });
  if (!r.json || !r.json.token) throw new Error('管理员登录失败：' + JSON.stringify(r.json));
  ADMIN_TOKEN = r.json.token;
  return ADMIN_TOKEN;
}

async function studentIdOf(username) {
  const [rows] = await conn.execute('SELECT id FROM students WHERE username = ?', [username]);
  return rows[0] ? rows[0].id : null;
}

async function grantViaApi(id, memberType) {
  const r = await api('POST', '/api/admin/members/' + id + '/grant', {
    token: ADMIN_TOKEN, body: { memberType, remark: '浏览器测试' },
  });
  if (r.status !== 200) throw new Error('开通会员失败：' + JSON.stringify(r.json));
  return r.json;
}

/** 直接改库：把会员到期时刻设成 NOW() + n 秒（测试专用，绕开 7/30/365 天限制） */
async function setExpireSeconds(id, sec, type) {
  await conn.execute(
    'UPDATE students SET member_type = ?, member_expire_at = DATE_ADD(NOW(), INTERVAL ? SECOND) WHERE id = ?',
    [type || 'week', sec, id]
  );
}
async function setExpirePast(id, type) {
  await conn.execute(
    'UPDATE students SET member_type = ?, member_expire_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ?',
    [type || 'week', id]
  );
}
async function setStatusDb(id, st) {
  await conn.execute('UPDATE students SET status = ? WHERE id = ?', [st, id]);
}

/** 从数据库取图形验证码答案 */
async function captchaAnswer(token) {
  if (!token) return null;
  const [rows] = await conn.execute('SELECT answer FROM captcha_codes WHERE token = ?', [token]);
  return rows[0] ? rows[0].answer : null;
}

/* ═══════════════ 页面辅助 ═══════════════ */

/** 主动刷新学习平台的图形验证码，并取回服务端答案（等待异步完成，避免竞态） */
async function learnCaptcha(cdp, scene) {
  await cdp.eval(`window.__wb.refreshCaptcha(${JSON.stringify(scene)})`);
  let tok = null;
  for (let i = 0; i < 40 && !tok; i++) {
    tok = await cdp.eval(`window.__wb.captchaToken(${JSON.stringify(scene)})`);
    if (!tok) await sleep(150);
  }
  let ans = null;
  for (let i = 0; i < 20 && !ans; i++) {
    ans = await captchaAnswer(tok);
    if (!ans) await sleep(120);
  }
  return { token: tok, answer: ans };
}

/** 进入学习平台并等待桥接层就绪 */
async function gotoLearn(cdp) {
  await cdp.send('Page.navigate', { url: BASE + '/learn/' });
  await cdp.waitFor('document.readyState === "complete"', 30000, '学习平台 DOM 就绪');
  await cdp.waitFor(
    '!!(window.__lcb && window.__lcb.hooks && window.__wb && document.getElementById("wbGate"))',
    30000, '学习平台桥接层就绪');
}

async function learnLogout(cdp) {
  await cdp.eval('window.__wb.doLogout(true)');
  await cdp.waitFor('document.getElementById("wbGate").classList.contains("show")', 10000, '门禁浮层重新出现');
}

/** 在学习平台填写表单（含 input/change 事件，保证桥接层同步） */
async function fillLearnForm(cdp, formId, fields) {
  await cdp.eval(`(function(){
    var f = document.getElementById(${JSON.stringify(formId)});
    if (!f) return false;
    var vals = ${JSON.stringify(fields)};
    Object.keys(vals).forEach(function (k) {
      var el = f.querySelector('[name="' + k + '"]');
      if (!el) return;
      el.value = vals[k];
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    return true;
  })()`);
}

async function learnSubmit(cdp, formId) {
  await cdp.eval(`(function(){
    var f = document.getElementById(${JSON.stringify(formId)});
    f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    return true;
  })()`);
}

/* ═══════════════ 打卡平台辅助 ═══════════════ */
async function gotoCheckin(cdp) {
  await cdp.send('Page.navigate', { url: BASE + '/' });
  await cdp.waitFor('document.readyState === "complete"', 30000, '打卡平台 DOM 就绪');
  await cdp.waitFor('!!(window.MemberGate && window.API && document.getElementById("loginPage"))', 25000, '打卡平台脚本就绪');
}

async function checkinLogin(cdp, user, pass, role) {
  /* 打卡平台登录页有「学生登录 / 管理员登录」角色切换，必须先切对角色 */
  await cdp.eval(`(function(){
    var b = document.querySelector('#loginPage .seg-btn[data-role="' + ${JSON.stringify(role || 'student')} + '"]');
    if (b && !b.classList.contains('on')) b.click();
    return true;
  })()`);
  await sleep(220);
  await cdp.eval(`(function(){
    var u = document.getElementById('loginUser'), p = document.getElementById('loginPass');
    u.value = ${JSON.stringify(user)}; p.value = ${JSON.stringify(pass)};
    var f = document.getElementById('loginForm');
    f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    return true;
  })()`);
}

/** 等「登录成功进入应用」或「登录页出现错误」二选一 */
async function waitLoginOutcome(cdp, timeout) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeout || 20000)) {
    const st = await cdp.eval(`(function(){
      var app = document.getElementById('app');
      var err = document.getElementById('loginErr');
      return {
        appVisible: !!(app && !app.hidden),
        errVisible: !!(err && !err.hidden && String(err.textContent || '').trim()),
        errText: err ? String(err.textContent || '').trim() : ''
      };
    })()`);
    if (st.appVisible) return { ok: true };
    if (st.errVisible) return { ok: false, text: st.errText };
    await sleep(220);
  }
  return { ok: false, text: '(超时)' };
}

/* ═══════════════════════ 主流程 ═══════════════════════ */

(async function main() {
  console.log('\n════════ 会员体系 · 浏览器端到端测试 ════════');
  console.log('页面地址: ' + BASE);
  console.log('测试账号: ' + ACC.username + ' / ' + ACC.phone);

  conn = await mysql.createConnection(DB);
  await adminLogin();

  const { cdp, close } = await launch({ port: Number(process.env.CDP_PORT || 9334) });
  let exitCode = 0;

  try {
    /* 收集控制台错误 */
    const consoleErrors = [];
    cdp.on((m) => {
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        const txt = (m.params.args || []).map((a) => a.value || a.description || '').join(' ');
        if (/net::ERR|Failed to load resource/i.test(txt)) return;
        consoleErrors.push('console: ' + txt);
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails || {};
        consoleErrors.push('exception: ' + ((d.exception && d.exception.description) || d.text));
      }
      if (m.method === 'Log.entryAdded') {
        const e = m.params.entry || {};
        if (e.level === 'error' && !/net::ERR|Failed to load resource/i.test(e.text || '')) {
          consoleErrors.push('log: ' + e.text);
        }
      }
    });

    /* ═════════ 1. 学习平台 · 注册（图形验证码 + 短信验证码） ═════════ */
    section('1. 学习平台注册（用户名 / 密码 / 确认密码 / 手机号 / 短信码 / 图形码）');
    await gotoLearn(cdp);

    ok('学习平台等待登录门禁浮层', await cdp.eval('document.getElementById("wbGate").classList.contains("show")'));
    ok('门禁提供 登录 / 注册账号 / 忘记密码 三个入口',
      await cdp.eval('document.querySelectorAll("#wbGate .wb-tab").length') === 3);

    await cdp.eval('document.querySelector(\'#wbGate .wb-tab[data-tab="register"]\').click()');
    await cdp.waitFor('document.getElementById("wbFormRegister").style.display !== "none"', 10000, '注册表单显示');
    const regFields = await cdp.eval(`(function(){
      return Array.prototype.map.call(
        document.querySelectorAll('#wbFormRegister [name]'), function(n){ return n.name; }).join(',');
    })()`);
    ok('注册表单字段齐全：' + regFields,
      ['username', 'password', 'password2', 'phone', 'smsCode', 'captcha'].every((k) => regFields.includes(k)));

    /* 1.1 图形验证码 + 发送短信验证码 */
    const cap1 = await learnCaptcha(cdp, 'register');
    ok('图形验证码已生成并可在服务端核验', !!cap1.token && !!cap1.answer);

    await fillLearnForm(cdp, 'wbFormRegister', {
      username: ACC.username, password: ACC.password, password2: ACC.password,
      phone: ACC.phone, captcha: cap1.answer,
    });
    await cdp.eval('document.querySelector(\'#wbFormRegister [data-sms="register"]\').click()');
    await cdp.waitFor('(document.getElementById("wbGateMsg").textContent || "").indexOf("开发环境验证码") >= 0',
      15000, '短信验证码下发');
    const smsMsg = await cdp.eval('document.getElementById("wbGateMsg").textContent');
    const devCode = (String(smsMsg).match(/(\d{6})/) || [])[1];
    ok('短信验证码已发送且回显开发验证码：' + devCode, !!devCode);

    /* 1.2 提交注册（发送短信后图形验证码已刷新，需重新填写） */
    await sleep(400);
    const cap2 = await learnCaptcha(cdp, 'register');
    await fillLearnForm(cdp, 'wbFormRegister', { captcha: cap2.answer, smsCode: devCode });
    await learnSubmit(cdp, 'wbFormRegister');
    await cdp.waitFor('window.__wb.state().ready === true', 25000, '注册并自动登录');
    ok('注册成功并自动登录学习平台', true);

    const regState = await cdp.eval('window.__wb.state()');
    eq('新账号默认会员等级', regState.member && regState.member.type, 'none');
    ok('新账号会员徽标为「普通会员」', (await cdp.eval('document.getElementById("wbBadge").textContent')) === '普通会员');
    ok('普通会员徽标不是金色（class 不含 super）',
      !(await cdp.eval('document.getElementById("wbBadge").className.indexOf("super") >= 0')));
    await cdp.shot('m01-learn-registered-normal');

    /* 1.3 手机号唯一性 */
    await learnLogout(cdp);
    await cdp.eval('document.querySelector(\'#wbGate .wb-tab[data-tab="register"]\').click()');
    await cdp.waitFor('document.getElementById("wbFormRegister").style.display !== "none"', 8000, '注册表单');
    const cap3 = await learnCaptcha(cdp, 'register');
    await fillLearnForm(cdp, 'wbFormRegister', {
      username: ACC2.username, password: ACC2.password, password2: ACC2.password,
      phone: ACC.phone,   // 复用已被占用的手机号
      captcha: cap3.answer,
      smsCode: devCode,
    });
    await learnSubmit(cdp, 'wbFormRegister');
    await cdp.waitFor('(document.getElementById("wbGateMsg").textContent || "").length > 0', 12000, '注册失败提示');
    const dupMsg = await cdp.eval('document.getElementById("wbGateMsg").textContent');
    ok('重复手机号注册被拒绝且文案逐字一致：' + dupMsg, dupMsg === MSG.PHONE_TAKEN);

    /* 重新登录回测试账号 */
    await cdp.eval('document.querySelector(\'#wbGate .wb-tab[data-tab="login"]\').click()');
    await fillLearnForm(cdp, 'wbFormLogin', { account: ACC.username, password: ACC.password });
    await learnSubmit(cdp, 'wbFormLogin');
    await cdp.waitFor('window.__wb.state().ready === true', 25000, '重新登录成功');

    /* ═════════ 2. 学习平台 · 普通会员章节门禁 ═════════ */
    section('2. 普通会员章节门禁（第一章 5 小节可学，第二章起 🔒 并拦截）');
    const lockInfo = await cdp.eval(`(function(){
      var f = window.__lcb, wb = window.__wb;
      var first = f.tutorials.filter(function(t){ return t.group === '① 入门与安装'; });
      var firstNames = first.map(function(t){ return t.name; });
      var firstLocked = first.filter(function(t){ return wb.isLockedUnit('tut:' + t.key); }).length;
      var restAll = f.tutorials.filter(function(t){ return t.group !== '① 入门与安装'; });
      var restLocked = restAll.filter(function(t){ return wb.isLockedUnit('tut:' + t.key); }).length;
      return {
        firstNames: firstNames, firstCount: first.length, firstLocked: firstLocked,
        restCount: restAll.length, restLocked: restLocked,
        cmdLocked: wb.isLockedGroup('命令大全'), tipLocked: wb.isLockedGroup('实用技巧'),
        lockIcons: document.querySelectorAll('.nav-item.locked .lk').length,
        groupLocks: document.querySelectorAll('.ng-h .lk').length
      };
    })()`);
    eq('第一章小节数量', lockInfo.firstCount, 5);
    ok('第一章 5 小节全部可学：' + lockInfo.firstNames.join('、'), lockInfo.firstLocked === 0);
    ok('第二章及之后全部锁定 [' + lockInfo.restLocked + ' / ' + lockInfo.restCount + ']',
      lockInfo.restCount > 0 && lockInfo.restLocked === lockInfo.restCount);
    ok('命令大全模块对普通会员锁定', lockInfo.cmdLocked === true);
    ok('实用技巧模块对普通会员锁定', lockInfo.tipLocked === true);
    ok('侧栏出现 🔒 锁标记（' + lockInfo.lockIcons + ' 个小节 + ' + lockInfo.groupLocks + ' 个分组标题）',
      lockInfo.lockIcons > 0 && lockInfo.groupLocks > 0);
    await cdp.shot('m02-learn-locked-normal');

    /* 点击被锁定的章节 → 精确文案 + 自动打开定价 */
    await cdp.eval('(function(){var n=document.querySelector(".nav-item.locked[data-go]");if(n)n.click();})()');
    await cdp.waitFor('document.querySelectorAll("#toastWrap .toast").length > 0', 10000, '锁定提示 Toast');
    await sleep(400);
    const lockToast = await cdp.eval(`(function(){
      var t=document.querySelectorAll('#toastWrap .toast');
      return t.length ? t[t.length-1].textContent : '';
    })()`);
    ok('锁定提示文案逐字一致：' + lockToast.replace(/\s+/g, ' ').slice(0, 40), lockToast.indexOf(MSG.LOCKED) >= 0);
    await cdp.waitFor('document.getElementById("wbOv").classList.contains("show")', 8000, '定价浮层自动弹出');
    ok('点击锁定章节会自动弹出定价浮层', true);

    /* ═════════ 3. 学习平台 · 定价页 ═════════ */
    section('3. 学习平台定价页（5 档权益与价格）');
    await cdp.waitFor('document.querySelectorAll("#wbPriceBox .wb-pc").length === 5', 10000, '5 档定价卡');
    const priceCards = await cdp.eval(`(function(){
      return Array.prototype.map.call(document.querySelectorAll('#wbPriceBox .wb-pc'), function(c){
        return { name: c.querySelector('.wb-pc-name').textContent.trim(),
                 price: c.querySelector('.wb-pc-price .v').textContent.trim(),
                 tag: c.querySelector('.wb-pc-tag') ? c.querySelector('.wb-pc-tag').textContent.trim() : '' };
      });
    })()`);
    const priceMap = {};
    priceCards.forEach((p) => { priceMap[p.name] = p.price; });
    ok('定价档位：' + priceCards.map((p) => p.name + '¥' + p.price).join(' / '), priceCards.length === 5);
    ok('普通会员 0 元且标记为当前身份', priceMap['普通会员'] === '0.00' && priceCards[0].tag === '当前身份');
    ok('周/月/年/永久价格为 4 / 12 / 24 / 59.90',
      priceMap['周会员'] === '4.00' && priceMap['月会员'] === '12.00' &&
      priceMap['年会员'] === '24.00' && priceMap['永久会员'] === '59.90');
    await cdp.shot('m03-learn-pricing');
    await cdp.eval('document.querySelector(\'#wbOv [data-wb="close"]\').click()');

    /* ═════════ 4. 学习平台 · 深浅主题 ═════════ */
    section('4. 学习平台深浅主题切换');
    const theme0 = await cdp.eval('document.documentElement.getAttribute("data-theme")');
    await cdp.eval('(function(){var c=document.getElementById("wbChip");if(c)c.click();})()');
    await cdp.waitFor('document.getElementById("wbUser").classList.contains("open")', 6000, '头像菜单展开');
    await cdp.eval('document.querySelector(\'#wbMenu [data-wb="theme"]\').click()');
    await sleep(600);
    const theme1 = await cdp.eval('document.documentElement.getAttribute("data-theme")');
    ok('主题可切换：' + theme0 + ' → ' + theme1, theme0 !== theme1 && ['light', 'dark'].indexOf(theme1) >= 0);
    const bg1 = await cdp.eval('getComputedStyle(document.body).backgroundColor');
    await cdp.shot('m04-learn-theme-' + theme1);
    await cdp.eval('(function(){var c=document.getElementById("wbChip");if(c)c.click();})()');
    await cdp.eval('document.querySelector(\'#wbMenu [data-wb="theme"]\').click()');
    await sleep(600);
    const theme2 = await cdp.eval('document.documentElement.getAttribute("data-theme")');
    const bg2 = await cdp.eval('getComputedStyle(document.body).backgroundColor');
    ok('切回原主题且背景色随之变化：' + theme2 + ' / ' + bg1 + ' → ' + bg2,
      theme0 === theme2 && bg1 !== bg2);
    await learnLogout(cdp);

    /* ═════════ 5. 打卡平台 · 普通会员登录被拒 ═════════ */
    section('5. 打卡平台：普通会员无法登录');
    await gotoCheckin(cdp);
    await cdp.waitFor('document.getElementById("loginPage") && !document.getElementById("loginPage").hidden', 20000, '登录页');
    await checkinLogin(cdp, ACC.username, ACC.password);
    const r5 = await waitLoginOutcome(cdp, 20000);
    ok('普通会员被拒绝进入打卡平台', r5.ok === false);
    ok('拒绝文案逐字一致：' + r5.text, r5.text === MSG.NEED_MEMBER);
    await cdp.shot('m05-checkin-need-member');

    /* ═════════ 6. 管理后台 · 会员管理 ═════════ */
    section('6. 管理后台会员管理（开通 / 3 秒后叠加 / 流水 / 禁用恢复）');
    await cdp.send('Page.navigate', { url: BASE + '/' });
    await cdp.waitFor('document.readyState === "complete"', 25000, '打卡平台重载');
    await cdp.waitFor('document.getElementById("loginUser")', 20000, '登录表单');
    await checkinLogin(cdp, 'admin', 'admin@2026', 'admin');
    await cdp.waitFor('document.getElementById("app") && !document.getElementById("app").hidden', 25000, '管理员进入后台');
    await cdp.waitFor(sel('#view .stats-grid'), 25000, '数据面板');

    const navKeys = await cdp.eval(`(function(){
      return Array.prototype.map.call(document.querySelectorAll('#nav [data-nav]'), function(n){ return n.dataset.nav; }).join(',');
    })()`);
    ok('管理端新增「会员管理 / 定价配置」菜单：' + navKeys,
      navKeys.indexOf('members') >= 0 && navKeys.indexOf('pricing') >= 0);

    await cdp.eval('document.querySelector(\'#nav [data-nav="members"]\').click()');
    await cdp.waitFor(sel('#view .page-head h2'), 25000, '会员管理视图');
    ok('会员管理视图渲染：' + (await cdp.eval('document.querySelector("#view .page-head h2").textContent')).trim(), true);
    ok('会员管理顶部 5 张汇总卡', (await cdp.eval('document.querySelectorAll("#view .stats-grid .stat-card").length')) === 5);
    ok('会员列表存在等级徽标', (await cdp.eval('document.querySelectorAll("#view .mchip").length')) > 0);
    ok('会员管理页含导出流水区块',
      (await cdp.eval('(document.getElementById("view").textContent||"").indexOf("打卡记录导出流水") >= 0')));

    /* 6.1 按关键字筛选出测试账号 */
    await cdp.eval(`(function(){
      var i = document.getElementById('memSearch');
      i.value = ${JSON.stringify(ACC.username)};
      i.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await cdp.waitFor('document.querySelectorAll("#memTable tbody tr").length === 1', 15000, '筛选出唯一一行');
    ok('关键字筛选生效（1 行）', true);

    /* 6.2 开通月会员 */
    await cdp.eval('document.querySelector("#view [data-mem-grant]").click()');
    await cdp.waitFor(sel('.ui-modal .type-picker'), 15000, '开通弹层');
    ok('开通弹层提供 5 种会员类型', (await cdp.eval('document.querySelectorAll(".type-picker .tp-opt").length')) === 5);
    await cdp.eval('document.querySelector(\'.type-picker .tp-opt[data-tp="month"]\').click()');
    await sleep(300);
    const pvMonth = await cdp.eval('document.querySelector("#pvBox").textContent');
    ok('选择月会员后实时预览到期时间：' + pvMonth.slice(0, 48), /到期/.test(pvMonth) && /30 天整/.test(pvMonth));
    await cdp.shot('m06-admin-grant-dialog');
    await cdp.eval(`(function(){
      var ms=document.querySelectorAll('.ui-modal');
      var m=ms[ms.length-1];
      m.querySelector('.modal-foot [data-act="yes"]').click();
    })()`);
    await cdp.waitFor('document.querySelectorAll("#toasts .toast").length > 0', 15000, '开通结果');
    await sleep(400);
    const t6a = await cdp.eval(LAST_TOAST);
    const t6aTitle = await cdp.eval(`(function(){
      var t = document.querySelectorAll('#toasts .toast .t-title');
      return t.length ? t[t.length-1].textContent : '';
    })()`);
    ok('开通月会员成功：' + t6aTitle + ' / ' + t6a.slice(0, 36),
      /设置成功/.test(t6aTitle) && /到期时间/.test(t6a));

    const idA = await studentIdOf(ACC.username);
    const [rowA] = await conn.execute('SELECT member_type, member_expire_at FROM students WHERE id = ?', [idA]);
    ok('数据库会员类型已落库为 month', rowA[0].member_type === 'month');
    const daysA = (new Date(String(rowA[0].member_expire_at).replace(' ', 'T')) - Date.now()) / 86400000;
    ok('月会员到期时间约为 30 天后（实际 ' + daysA.toFixed(2) + ' 天）', daysA > 29.9 && daysA < 30.1);

    /* 6.3 3 秒后再次开通周会员 → 叠加 */
    await sleep(3200);
    await cdp.waitFor('document.querySelectorAll("#toasts .toast").length === 0', 12000, 'Toast 消失').catch(() => {});
    await cdp.eval('document.querySelector("#view [data-mem-grant]").click()');
    await cdp.waitFor(sel('.ui-modal .type-picker'), 15000, '开通弹层（第二次）');
    await cdp.eval('document.querySelector(\'.type-picker .tp-opt[data-tp="week"]\').click()');
    await sleep(300);
    const pvWeek = await cdp.eval('document.querySelector("#pvBox").textContent');
    ok('叠加预览提示「在原到期时间上叠加 7 天」', /叠加 7 天/.test(pvWeek));
    await cdp.eval(`(function(){
      var ms=document.querySelectorAll('.ui-modal');
      ms[ms.length-1].querySelector('.modal-foot [data-act="yes"]').click();
    })()`);
    await cdp.waitFor('document.querySelectorAll("#toasts .toast").length > 0', 15000, '叠加结果');
    await sleep(500);
    const t6b = await cdp.eval(LAST_TOAST);
    ok('3 秒后叠加续费成功：' + t6b.slice(0, 50), /叠加续费 \+7 天/.test(t6b));

    const [rowB] = await conn.execute('SELECT member_type, member_expire_at FROM students WHERE id = ?', [idA]);
    const daysB = (new Date(String(rowB[0].member_expire_at).replace(' ', 'T')) - Date.now()) / 86400000;
    ok('月会员 + 周会员 = 约 37 天（实际 ' + daysB.toFixed(2) + ' 天）', daysB > 36.9 && daysB < 37.1);

    /* 6.4 变更流水 */
    await sleep(600);
    await cdp.eval('document.querySelector("#view [data-mem-logs]").click()');
    await cdp.waitFor(sel('.ui-modal .mflow'), 15000, '会员变更流水弹层');
    const flowN = await cdp.eval('document.querySelectorAll(".mflow .mf-item").length');
    ok('会员变更流水至少 2 条 [' + flowN + ']', flowN >= 2);
    const flowTxt = await cdp.eval('document.querySelector(".mflow").textContent');
    ok('流水含「开通会员」「续费叠加」记录', /开通会员/.test(flowTxt) && /续费叠加/.test(flowTxt));
    await cdp.shot('m07-admin-member-logs');
    await cdp.eval(`(function(){
      var ms=document.querySelectorAll('.ui-modal');
      ms[ms.length-1].querySelector('.modal-foot [data-act="ok"]').click();
    })()`);
    await sleep(400);

    /* 6.5 快速开通弹层 */
    await cdp.eval('document.querySelector("#view [data-mem-pick]").click()');
    await cdp.waitFor('!!document.getElementById("pickStu")', 15000, '快速开通：选择账号');
    ok('快速开通弹层可选账号数 ≥ 1', (await cdp.eval('document.querySelectorAll("#pickStu option").length')) >= 1);
    await cdp.eval(`(function(){
      var ms=document.querySelectorAll('.ui-modal');
      ms[ms.length-1].querySelector('.modal-foot [data-act="no"]').click();
    })()`);
    await sleep(300);

    /* 6.6 按钮徽标与状态展示 */
    const rowChip = await cdp.eval('document.querySelector("#memTable tbody tr .mchip").textContent');
    ok('列表徽标显示为会员类型：' + rowChip.trim(), /周会员|月会员|年会员|永久会员/.test(rowChip));
    const expireCell = await cdp.eval('document.querySelectorAll("#memTable tbody tr td")[3].textContent');
    ok('到期列展示到秒 + 剩余时长：' + expireCell.replace(/\s+/g, ' ').trim().slice(0, 46),
      /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(expireCell) && /剩 \d+天\d+时\d+分\d+秒/.test(expireCell));

    /* ═════════ 7. 管理后台 · 定价配置 ═════════ */
    section('7. 管理后台定价配置（改价 → 前端同步）');
    await cdp.eval('document.querySelector(\'#nav [data-nav="pricing"]\').click()');
    await cdp.waitFor(sel('#view .price-admin-grid'), 20000, '定价配置视图');
    ok('定价配置展示 5 个档位', (await cdp.eval('document.querySelectorAll("#view .pcard").length')) === 5);

    const weekCardSel = `(function(){
      var cards = document.querySelectorAll('#view .pcard');
      for (var i=0;i<cards.length;i++){
        var c = cards[i].querySelector('.pcard-code');
        if (c && c.textContent.trim() === 'week') return cards[i];
      }
      return null;
    })()`;
    await cdp.eval(`(function(){
      var c = ${weekCardSel};
      c.querySelector('[data-f="price"]').value = '4.50';
      c.querySelector('[data-price-save]').click();
    })()`);
    await cdp.waitFor('document.querySelectorAll("#toasts .toast").length > 0', 15000, '保存结果');
    await sleep(400);
    const t7 = await cdp.eval(LAST_TOAST);
    ok('定价保存成功提示：' + t7.slice(0, 40), /已保存并同步到前端/.test(t7));

    const pubPricing = await api('GET', '/api/member/pricing');
    const weekPub = (pubPricing.json.items || []).filter((p) => p.code === 'week')[0];
    ok('前端公开定价接口同步为 ¥4.50（实际 ¥' + weekPub.priceText + '）', weekPub.price === 4.5);

    /* 复原，避免污染演示数据 */
    await cdp.eval(`(function(){
      var c = ${weekCardSel};
      c.querySelector('[data-f="price"]').value = '4';
      c.querySelector('[data-price-save]').click();
    })()`);
    await sleep(1200);
    const pubPricing2 = await api('GET', '/api/member/pricing');
    const weekPub2 = (pubPricing2.json.items || []).filter((p) => p.code === 'week')[0];
    ok('定价已复原为 ¥4.00', weekPub2.price === 4);
    await cdp.shot('m08-admin-pricing');

    /* ═════════ 8. 学习平台 · 升级为超级会员 ═════════ */
    section('8. 升级为超级会员：金色徽标 + 全章节解锁');
    await gotoLearn(cdp);
    await cdp.waitFor('document.getElementById("wbGate").classList.contains("show")', 20000, '登录门禁');
    await fillLearnForm(cdp, 'wbFormLogin', { account: ACC.username, password: ACC.password });
    await learnSubmit(cdp, 'wbFormLogin');
    await cdp.waitFor('window.__wb.state().ready === true', 25000, '超级会员登录学习平台');

    const badge = await cdp.eval(`(function(){
      var b = document.getElementById('wbBadge');
      var cs = getComputedStyle(b);
      return {
        text: b.textContent, cls: b.className,
        bgImage: cs.backgroundImage || '',
        fill: cs.webkitTextFillColor || cs.color,
        clip: cs.webkitBackgroundClip || cs.backgroundClip
      };
    })()`);
    ok('徽标文案为「超级会员」：' + badge.text, badge.text === '超级会员');
    ok('徽标带 super 样式类', badge.cls.indexOf('super') >= 0);
    /* 金色字体通过「金色渐变裁切到文字」实现：
       校验渐变里确实含金色（#b45309 / #f59e0b / #fcd34d）且文字填充为裁切模式 */
    const goldGradient = /linear-gradient/.test(badge.bgImage) &&
      (badge.bgImage.indexOf('245, 158, 11') >= 0 || badge.bgImage.indexOf('252, 211, 77') >= 0 ||
       badge.bgImage.indexOf('180, 83, 9') >= 0);
    ok('徽标为金色字体（渐变裁切文字）' + (badge.bgImage ? '：' + badge.bgImage.slice(0, 62) : ''),
      goldGradient && (badge.fill === 'transparent' || /text/.test(badge.clip)),
      'fill=' + badge.fill + ' clip=' + badge.clip);

    const unlocked = await cdp.eval(`(function(){
      var f = window.__lcb, wb = window.__wb;
      var locked = f.tutorials.filter(function(t){ return wb.isLockedUnit('tut:' + t.key); }).length;
      return {
        lockedTuts: locked,
        cmdLocked: wb.isLockedGroup('命令大全'),
        tipLocked: wb.isLockedGroup('实用技巧'),
        lockIcons: document.querySelectorAll('.nav-item.locked .lk').length
      };
    })()`);
    ok('全部教程小节解锁（剩余锁定 ' + unlocked.lockedTuts + ' 个）', unlocked.lockedTuts === 0);
    ok('命令大全/实用技巧解锁', unlocked.cmdLocked === false && unlocked.tipLocked === false);
    ok('侧栏 🔒 标记全部消失', unlocked.lockIcons === 0);
    await cdp.shot('m09-learn-super-gold');

    /* 学习平台 · 到期强制退出（把到期时间设为 6 秒后） */
    section('9. 学习平台：会员到期强制退出');
    const idL = await studentIdOf(ACC.username);
    await setExpireSeconds(idL, 6, 'week');
    await gotoLearn(cdp);
    await cdp.waitFor('document.getElementById("wbBlock").classList.contains("show")', 30000, '学习平台到期拦截');
    const lb = await cdp.eval(`(function(){
      var b = document.getElementById('wbBlock');
      return {
        h2: (b.querySelector('h2') || {}).textContent || '',
        p: (b.querySelector('p') || {}).textContent || '',
        btns: b.querySelectorAll('.wb-block-btn').length,
        btnText: (b.querySelector('.wb-block-btn') || {}).textContent || ''
      };
    })()`);
    ok('学习平台弹出「会员到期提醒」', lb.h2.trim() === '会员到期提醒');
    ok('到期文案含「现将强制退出该平台，若想要继续使用，请尽快续费使用」',
      /到期/.test(lb.p) && /现将强制退出该平台，若想要继续使用，请尽快续费使用/.test(lb.p));
    ok('拦截框仅有 1 个操作按钮，文案为「退出登录」', lb.btns === 1 && lb.btnText.trim() === '退出登录');
    await cdp.shot('m10-learn-expired-block');
    await cdp.eval('document.querySelector(\'#wbBlock [data-wb="logout"]\').click()');
    await cdp.waitFor('document.getElementById("wbGate").classList.contains("show")', 12000, '退出后回到登录门禁');
    ok('点击「退出登录」后返回登录门禁', true);

    /* ═════════ 10. 打卡平台 · 剩余不足 3 天 + 到期强制退出 ═════════ */
    section('10. 打卡平台：不足 3 天倒计时 + 到期强制退出');
    const idC = await studentIdOf(ACC.username);
    await setExpireSeconds(idC, 172803, 'week');   // 2 天 0 时 0 分 3 秒
    /* 上一节用的是管理员会话，先清掉本地会话再进打卡平台 */
    await cdp.eval('(function(){try{localStorage.clear();sessionStorage.clear();}catch(e){} return true;})()');
    await gotoCheckin(cdp);
    await cdp.waitFor('document.getElementById("loginPage") && !document.getElementById("loginPage").hidden', 20000, '登录页');
    await checkinLogin(cdp, ACC.username, ACC.password);
    await cdp.waitFor('document.getElementById("app") && !document.getElementById("app").hidden', 25000, '超级会员进入打卡平台');
    ok('超级会员可正常登录打卡平台', true);

    await cdp.waitFor('document.getElementById("memCd").classList.contains("show")', 20000, '右下角常驻倒计时');
    await cdp.waitFor(
      'Array.prototype.some.call(document.querySelectorAll("#toasts .toast .t-msg"), function(n){ return n.textContent.indexOf("不足3天") >= 0; })',
      20000, '不足 3 天提示');
    const dueTxt = await cdp.eval(`(function(){
      var t = document.querySelectorAll('#toasts .toast .t-msg');
      for (var i = t.length - 1; i >= 0; i--) { if (t[i].textContent.indexOf('不足3天') >= 0) return t[i].textContent; }
      return '';
    })()`);
    ok('不足 3 天提示文案逐字一致：' + dueTxt.slice(0, 30), dueTxt === MSG.DUE_WARN);

    const cd1 = (await cdp.eval('document.getElementById("memCdTime").textContent')).trim();
    ok('倒计时格式为 x天x时x分x秒：' + cd1, /^\d+天\d+时\d+分\d+秒$/.test(cd1));
    await sleep(1400);
    const cd2 = (await cdp.eval('document.getElementById("memCdTime").textContent')).trim();
    ok('倒计时为动态刷新：' + cd1 + ' → ' + cd2, cd1 !== cd2);
    const memBadge = await cdp.eval(`(function(){
      var b = document.getElementById('userMember');
      var cs = getComputedStyle(b);
      var m = (cs.color.match(/[0-9]+/g) || []).map(Number);
      return { text: b.textContent, cls: b.className, color: cs.color, rgb: m };
    })()`);
    ok('打卡平台顶栏徽标显示会员类型：' + memBadge.text, /周会员|超级会员/.test(memBadge.text));
    ok('打卡平台徽标带 super 金色样式类', memBadge.cls.indexOf('super') >= 0);
    ok('打卡平台徽标为金色字体 ' + memBadge.color,
      memBadge.rgb.length >= 3 && memBadge.rgb[0] > memBadge.rgb[1] && memBadge.rgb[1] >= memBadge.rgb[2]);
    await cdp.shot('m11-checkin-countdown');

    /* 10.1 到期 → 不可取消的强制退出
       这里保持学生会话：刷新页面会走「会话恢复 → 会员门禁」路径，
       倒计时归零后由页内定时器直接弹出不可取消的拦截框。 */
    await setExpireSeconds(idC, 12, 'week');
    await gotoCheckin(cdp);
    await cdp.waitFor('document.getElementById("memBlock")', 30000, '到期拦截弹窗');
    const blk = await cdp.eval(`(function(){
      var b = document.getElementById('memBlock');
      return {
        h2: (b.querySelector('h2') || {}).textContent || '',
        p: (b.querySelector('p') || {}).textContent || '',
        btns: b.querySelectorAll('.mem-block-btn').length,
        btnText: (b.querySelector('.mem-block-btn') || {}).textContent || ''
      };
    })()`);
    ok('弹窗标题为「会员到期提醒」', blk.h2.trim() === '会员到期提醒');
    ok('弹窗内容含「你的会员于 xxxx年xx月xx日xx时xx分xx秒 到期」与强制退出说明',
      /你的会员于/.test(blk.p) && /现将强制退出该平台，若想要继续使用，请尽快续费使用/.test(blk.p) &&
      /\d{4}年\d{2}月\d{2}日/.test(blk.p));
    ok('弹窗仅 1 个按钮且为「退出登录」', blk.btns === 1 && blk.btnText.trim() === '退出登录');
    await cdp.shot('m12-checkin-expired-block');

    /* 点击遮罩与 ESC 都不能关闭 */
    await cdp.eval(`(function(){
      var b = document.getElementById('memBlock');
      b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return true;
    })()`);
    await sleep(500);
    ok('点击其它区域 / ESC 均无法关闭拦截弹窗',
      await cdp.eval('!!document.getElementById("memBlock")'));

    /* 点击退出登录 → 回到登录页 */
    await cdp.eval('document.getElementById("memBlockOut").click()');
    await cdp.waitFor('document.getElementById("loginPage") && !document.getElementById("loginPage").hidden', 15000, '回到登录页');
    ok('点击「退出登录」后返回打卡平台登录页', true);

    /* 再次登录（会员已到期）→ 未开通会员文案 */
    await checkinLogin(cdp, ACC.username, ACC.password);
    const r10 = await waitLoginOutcome(cdp, 20000);
    ok('到期后再登录被拒绝', r10.ok === false);
    ok('再次进入时提示未开通会员文案：' + r10.text, r10.text === MSG.NEED_MEMBER);

    /* ═════════ 11. 账号禁用 ═════════ */
    section('11. 账号被管理员禁用后的全平台拦截');
    const idD = await studentIdOf(ACC.username);
    await grantViaApi(idD, 'week');            // 先恢复会员身份
    await setStatusDb(idD, 0);                 // 再禁用

    await gotoLearn(cdp);
    await cdp.waitFor('document.getElementById("wbGate").classList.contains("show")', 20000, '学习平台门禁');
    await fillLearnForm(cdp, 'wbFormLogin', { account: ACC.username, password: ACC.password });
    await learnSubmit(cdp, 'wbFormLogin');
    await cdp.waitFor('document.getElementById("wbBlock").classList.contains("show")', 25000, '禁用拦截');
    const disMsg = await cdp.eval('document.getElementById("wbBlockBox").textContent');
    ok('学习平台禁用文案逐字一致', disMsg.indexOf(MSG.DISABLED) >= 0);

    await gotoCheckin(cdp);
    await cdp.waitFor('document.getElementById("loginUser")', 20000, '打卡平台登录表单');
    await checkinLogin(cdp, ACC.username, ACC.password);
    const r11 = await waitLoginOutcome(cdp, 20000);
    ok('打卡平台禁用提示逐字一致：' + r11.text, r11.text === MSG.DISABLED);
    await cdp.shot('m13-disabled');

    /* 恢复使用 */
    await setStatusDb(idD, 1);
    await grantViaApi(idD, 'year');
    await gotoCheckin(cdp);
    await cdp.waitFor('document.getElementById("loginUser")', 20000, '登录表单');
    await checkinLogin(cdp, ACC.username, ACC.password);
    const r12 = await waitLoginOutcome(cdp, 25000);
    ok('恢复使用后可正常登录打卡平台', r12.ok === true);

    /* ═════════ 12. 清理测试账号 ═════════ */
    section('12. 清理本次测试创建的账号');
    const [del] = await conn.execute(
      'DELETE FROM students WHERE username IN (?, ?)', [ACC.username, ACC2.username]
    );
    ok('测试账号已清理（' + del.affectedRows + ' 个）', del.affectedRows >= 1);
    await conn.execute(
      "DELETE FROM sms_codes WHERE request_ip IN ('127.0.0.1','::1','::ffff:127.0.0.1')"
    );
    await conn.execute(
      "DELETE FROM sms_codes WHERE phone IN (?, ?)", [ACC.phone, ACC2.phone]
    );

    /* ═════════ 13. 控制台无错误 ═════════ */
    section('13. 控制台无 JS 错误');
    const realErrors = consoleErrors.filter((t) => !/favicon|preload/i.test(t));
    ok('浏览器控制台无 JS 错误' + (realErrors.length ? '' : '（0 条）'),
      realErrors.length === 0, realErrors.slice(0, 5).join(' || '));

  } catch (e) {
    console.error('\n✖ 测试中断：' + e.message);
    if (e.stack) console.error(e.stack.split('\n').slice(0, 5).join('\n'));
    exitCode = 1;
  } finally {
    console.log('\n════════ 结果 ════════');
    console.log('通过 ' + T.pass + ' 项，失败 ' + T.fail + ' 项');
    if (T.failures.length) {
      console.log('\n失败明细：');
      T.failures.forEach((f, i) => console.log('  ' + (i + 1) + '. ' + f));
      exitCode = 1;
    }
    try { await conn.end(); } catch (e) { /* 忽略 */ }
    close();
    await sleep(400);
    process.exit(exitCode);
  }
})();
