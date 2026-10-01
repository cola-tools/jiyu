'use strict';
/* ══════════════════════════════════════════════════════════════════
   浏览器端到端冒烟测试（零依赖，CDP 直连无头 Chrome）
   ──────────────────────────────────────────────────────────────────
   前置：
     1) MySQL 已导入 db/schema.sql + seed_accounts.sql + seed_content.sql
     2) 后端已启动（默认 http://127.0.0.1:3210）
   运行：
     node tests/browser-smoke.js
   可选环境变量：
     BASE      页面地址（默认 http://127.0.0.1:3210）
     CHROME    Chrome 可执行文件路径
     SHOTS     截图输出目录（默认 tests/shots）
   ══════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const BASE = process.env.BASE || 'http://127.0.0.1:3210';
const PORT = Number(process.env.CDP_PORT || 9333);
const SHOTS = process.env.SHOTS || path.join(__dirname, 'shots');
const CHROME = process.env.CHROME || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find((p) => fs.existsSync(p));

if (!CHROME) {
  console.error('✖ 未找到 Chrome，请通过 CHROME 环境变量指定路径');
  process.exit(1);
}
fs.mkdirSync(SHOTS, { recursive: true });

/* ───────── 测试计数 ───────── */
let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else {
    fail++;
    failures.push(name + (extra ? ' → ' + String(extra).slice(0, 240) : ''));
    console.log('  ✗ ' + name + (extra ? '  → ' + String(extra).slice(0, 240) : ''));
  }
}
function eq(name, a, b) { ok(name + '  [' + a + ' = ' + b + ']', a === b, 'got ' + JSON.stringify(a)); }
function section(t) { console.log('\n── ' + t + ' ──'); }

/* 把 CSS 选择器包装成合法的 JS 布尔表达式（waitFor 只能接受表达式） */
const sel = (css) => '!!document.querySelector(' + JSON.stringify(css) + ')';
const selAll = (css, n) => 'document.querySelectorAll(' + JSON.stringify(css) + ').length ' + (n || '> 0');

/* 取最新一条 Toast 的正文（.toasts 内按 DOM 顺序追加，最新在末尾） */
const LAST_TOAST = `(function(){
  var t = document.querySelectorAll('#toasts .toast .t-msg');
  return t.length ? t[t.length-1].textContent : '';
})()`;

/* 取某元素的计算样式颜色亮度（0-255），用于校验深色主题下的可读性 */
const LUM_HELPER = `function __lum(c){
  var m = c.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
  if (!m) return 999;
  return 0.299*+m[1] + 0.587*+m[2] + 0.114*+m[3];
}`;
const darkTextCheck = (sels) => `(function(){
  ${LUM_HELPER}
  var bad = [];
  ${JSON.stringify(sels)}.forEach(function(s){
    var n = document.querySelector(s);
    if (!n) return;
    var c = getComputedStyle(n).color;
    if (__lum(c) < 150) bad.push(s + '=' + c);
  });
  return bad;
})()`;

/** 点击侧栏导航并等待视图渲染；失败时把视图内容贴出来便于定位，不中断整个测试 */
async function gotoView(cdp, key, expectRe) {
  await cdp.eval('(function(){var n=document.querySelector(\'#nav [data-nav="' + key + '"]\');if(n)n.click();})()');
  try {
    await cdp.waitFor(sel('#view .page-head h2'), 22000, '视图渲染 ' + key);
  } catch (e) {
    const dump = await cdp.eval(
      '(function(){var v=document.getElementById("view");return v?v.textContent.replace(/\\s+/g," ").trim().slice(0,220):"(无 #view)";})()');
    ok('视图 ' + key + ' 渲染成功（实际内容：' + dump + '）', false);
    return false;
  }
  const title = await cdp.eval('document.querySelector("#view .page-head h2").textContent');
  ok('视图 ' + key + ' 渲染成功：' + title.trim(), !expectRe || expectRe.test(title));
  return true;
}

/** 关闭所有遗留弹层（防止上一环节的残留弹层干扰本环节断言），返回关闭数量 */
async function closeStray(cdp) {
  const n = await cdp.eval('(function(){var ms=document.querySelectorAll(".ui-modal");' +
    'for(var i=0;i<ms.length;i++){var x=ms[i].querySelector(".modal-head .icon-btn");if(x)x.click();}' +
    'return ms.length;})()');
  if (n > 0) await sleep(340);
  return n;
}

/* 操作「最上层（最后一个）弹层」的常用表达式 —— 弹层按 DOM 顺序追加，最后打开的在末尾 */
const LAST_M = (inner) => `(function(){var ms=document.querySelectorAll('.ui-modal');` +
  `if(!ms.length)return null;var m=ms[ms.length-1];return (${inner});})()`;
const LAST_M_CLICK = (sel2) => `(function(){var ms=document.querySelectorAll('.ui-modal');` +
  `if(!ms.length)return false;var m=ms[ms.length-1],n=m.querySelector(${JSON.stringify(sel2)});` +
  `if(!n)return false;n.click();return true;})()`;

/* ───────── CDP 客户端 ───────── */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.waiting = new Map();
    this.events = [];
    this.handlers = [];
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.id && this.waiting.has(msg.id)) {
        const { resolve, reject } = this.waiting.get(msg.id);
        this.waiting.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
        this.handlers.forEach((h) => { try { h(msg); } catch (e) { /* 忽略 */ } });
      }
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (this.waiting.has(id)) {
          this.waiting.delete(id);
          reject(new Error('CDP timeout: ' + method));
        }
      }, 45000);
    });
  }
  on(fn) { this.handlers.push(fn); }

  /** 在页面里执行表达式，返回 JS 值 */
  async eval(expr, awaitPromise = true) {
    const r = await this.send('Runtime.evaluate', {
      expression: '(function(){ try { return (' + expr + '); } catch (e) { return { __err: String(e && e.message || e) }; } })()',
      returnByValue: true,
      awaitPromise: !!awaitPromise,
      userGesture: true,
    });
    if (r.exceptionDetails) {
      throw new Error('页面脚本异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    }
    if (r.result && r.result.value && r.result.value.__err) {
      throw new Error('页面脚本抛错: ' + r.result.value.__err);
    }
    return r.result ? r.result.value : undefined;
  }

  /**
   * 轮询直到条件成立。
   * 既接受 JS 表达式（'!!document.querySelector(...)'），
   * 也接受纯 CSS 选择器（'.ui-modal' / '#view .tree'），内部自动转换。
   */
  async waitFor(expr, timeout = 15000, label = '') {
    let e = String(expr).trim();
    if (!/^(!!|!|document\.|window\.|true$|false$|\()/.test(e) && /^[.#\[]/.test(e)) {
      e = '!!document.querySelector(' + JSON.stringify(e) + ')';
    }
    const wrapped = '!!(' + e + ')';

    const t0 = Date.now();
    let last;
    while (Date.now() - t0 < timeout) {
      try {
        const r = await this.send('Runtime.evaluate', {
          expression: wrapped, returnByValue: true, awaitPromise: true,
        });
        if (r.exceptionDetails) {
          last = r.exceptionDetails.text + ' ' +
            ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '');
        } else {
          last = r.result ? r.result.value : undefined;
          if (last === true) return true;
        }
      } catch (err) { last = err.message; }
      await sleep(140);
    }
    throw new Error('等待超时' + (label ? '（' + label + '）' : '') + '：' + e +
      '  最后结果=' + JSON.stringify(last));
  }

  async shot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const f = path.join(SHOTS, name + '.png');
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    return f;
  }

  async resize(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: width <= 768,
    });
    await sleep(260);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ───────── 启动 Chrome ───────── */
const userDir = path.join(os.tmpdir(), 'lsp-cdp-' + Date.now());

function launch() {
  const args = [
    '--headless=new',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + userDir,
    '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking',
    '--disable-features=Translate,BackForwardCache,AcceptCHFrame',
    '--window-size=1440,900',
    '--hide-scrollbars',
    'about:blank',
  ];
  const child = spawn(CHROME, args, { stdio: 'ignore', detached: false });
  return child;
}

async function fetchJson(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch (e) { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('CDP 端点不可用: ' + url);
}

/* ═══════════════════════ 主流程 ═══════════════════════ */

(async function main() {
  console.log('\n════════ 浏览器端到端测试 ════════');
  console.log('页面地址: ' + BASE);

  const chrome = launch();
  let cdp = null;
  let exitCode = 0;

  try {
    const list = await fetchJson('http://127.0.0.1:' + PORT + '/json/list');
    const target = list.find((t) => t.type === 'page') || list[0];
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res);
      ws.addEventListener('error', () => rej(new Error('WebSocket 连接失败')));
    });
    cdp = new CDP(ws);

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');

    /* 收集控制台错误与页面异常 */
    const consoleErrors = [];
    cdp.on((m) => {
      if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
        const txt = (m.params.args || []).map((a) => a.value || a.description || '').join(' ');
        // 后端 503/网络类告警不计入
        if (/net::ERR|Failed to load resource/i.test(txt)) return;
        consoleErrors.push(m.params.type + ': ' + txt);
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails || {};
        consoleErrors.push('exception: ' + (d.exception && d.exception.description || d.text));
      }
      if (m.method === 'Log.entryAdded') {
        const e = m.params.entry || {};
        if (e.level === 'error' && !/net::ERR|Failed to load resource/i.test(e.text || '')) {
          consoleErrors.push('log: ' + e.text);
        }
      }
    });

    /* ═══ 1. 首屏 ═══ */
    section('1. 首屏加载与主题初始化');
    await cdp.send('Page.navigate', { url: BASE + '/' });
    await cdp.waitFor('document.readyState === "complete"', 20000, 'DOM 就绪');

    const theme = await cdp.eval('document.documentElement.getAttribute("data-theme")');
    ok('data-theme 已设置 = ' + theme + '（默认跟随系统深浅色）', theme === 'light' || theme === 'dark');

    ok('工作台全局对象就绪 (U/API/STORE/UI/App)',
      await cdp.eval('!!(window.U && window.API && window.STORE && window.UI && window.App && window.LoginView && window.StudentView && window.AdminView)'));

    await cdp.waitFor('document.getElementById("loginPage") && !document.getElementById("loginPage").hidden', 20000, '登录页可见');
    ok('启动遮罩已隐藏', await cdp.eval('!!(document.getElementById("boot").hidden || document.getElementById("boot").classList.contains("gone"))'));

    /* 演示账号列表 */
    const tipCount = await cdp.eval('document.querySelectorAll("#loginTip .tip-acc").length');
    eq('学生演示账号条目数', tipCount, 5);
    await cdp.shot('01-login-light');

    /* ── 浅色主题：全部为浅底深字 ── */
    await cdp.eval('STORE.applyTheme("light", false)');
    await sleep(300);
    eq('强制浅色主题', await cdp.eval('document.documentElement.getAttribute("data-theme")'), 'light');
    const lightInk = await cdp.eval('getComputedStyle(document.body).color');
    ok('浅色主题正文为深色 ' + lightInk, /rgb\(31,\s*36,\s*48\)/.test(lightInk));
    const lightBg = await cdp.eval('getComputedStyle(document.body).backgroundColor');
    ok('浅色主题背景为纸白 ' + lightBg, /rgb\(253,\s*251,\s*245\)/.test(lightBg));

    /* ── 深色主题：深蓝底 + 全白字 ── */
    await cdp.eval('STORE.applyTheme("dark", false)');
    await sleep(300);
    eq('切换到深色主题', await cdp.eval('document.documentElement.getAttribute("data-theme")'), 'dark');
    const darkInk = await cdp.eval('getComputedStyle(document.body).color');
    ok('深色主题正文为纯白 ' + darkInk, /rgb\(255,\s*255,\s*255\)/.test(darkInk));
    const darkBg = await cdp.eval('getComputedStyle(document.body).backgroundColor');
    ok('深色主题背景为深蓝 ' + darkBg, /rgb\(5,\s*14,\s*33\)/.test(darkBg));
    await cdp.shot('02-login-dark');

    const darkBright = await cdp.eval(darkTextCheck([
      '.login-head h1', '.login-head p', '.field-label', '.seg-btn', '.btn-primary',
      '.login-tip', '.tip-foot', '.input', '.theme-fab',
    ]));
    ok('登录页深色主题下文本均为亮色 ' + (darkBright.length ? JSON.stringify(darkBright) : '（全部通过）'), darkBright.length === 0);

    /* ── 通过界面按钮再切一次，验证交互链路 ── */
    await cdp.eval('document.getElementById("themeFabLogin").click()');
    await sleep(800);
    eq('界面主题按钮可切回浅色', await cdp.eval('document.documentElement.getAttribute("data-theme")'), 'light');
    ok('主题偏好已持久化到 localStorage',
      (await cdp.eval('localStorage.getItem("lsp.theme")')) === 'light');

    /* ═══ 2. 学生登录 ═══ */
    section('2. 学生端登录与数据面板');
    await cdp.eval(`(function(){
      document.getElementById('loginUser').value = 'student1';
      document.getElementById('loginPass').value = 'xiaoran2026';
      document.getElementById('loginForm').dispatchEvent(new Event('submit', {cancelable:true, bubbles:true}));
    })()`);

    await cdp.waitFor('document.getElementById("app") && !document.getElementById("app").hidden', 20000, '进入主应用');
    await cdp.waitFor(sel('#view .view-inner .stats-grid'), 20000, '学生数据面板渲染');
    ok('学生端品牌副标题正确', /学生端/.test(await cdp.eval('document.getElementById("brandSub").textContent')));

    const sStats = await cdp.eval('document.querySelectorAll("#view .stat-card").length');
    ok('学生数据面板统计卡数量 ≥ 4（实际 ' + sStats + '）', sStats >= 4);
    ok('进度环已渲染', await cdp.eval('!!document.querySelector("#view .ring svg")'));
    ok('侧边栏包含 6 个学生端菜单', (await cdp.eval('document.querySelectorAll("#nav .nav-item").length')) === 6);
    await cdp.shot('03-student-dashboard-light');

    /* ═══ 3. 学习目录与打卡 ═══ */
    section('3. 学习目录浏览与打卡');
    await cdp.eval('document.querySelector(\'#nav [data-nav="catalog"]\').click()');
    await cdp.waitFor(sel('#view .tree .tree-node'), 20000, '目录树渲染');

    const navActive = await cdp.eval('document.querySelector(\'#nav [data-nav="catalog"]\').classList.contains("on")');
    ok('导航高亮已切换', navActive);

    const rootCount = await cdp.eval('document.querySelectorAll("#view .tree > .tree-node.lv1").length');
    eq('主目录数量', rootCount, 3);

    ok('打卡操作栏已显示', await cdp.eval('!document.getElementById("checkinBar").hidden'));
    ok('body 具备 has-checkin-bar 类', await cdp.eval('document.body.classList.contains("has-checkin-bar")'));

    /* 展开全部，找到第一个可打卡的学习目录 */
    await cdp.eval('document.querySelector(\'#view [data-act="expand-all"]\').click()');
    await cdp.waitFor('document.querySelectorAll("#view .unit-row [data-pick]").length > 10', 20000, '学习目录行渲染');
    const checkableCount = await cdp.eval('document.querySelectorAll("#view .unit-row [data-pick]").length');
    ok('可见可打卡单元 ' + checkableCount + ' 个', checkableCount > 100);

    /* 勾选前两项（一项稍后保留，一项用于验证撤销） */
    const pickedIds = await cdp.eval(`(function(){
      var cks = document.querySelectorAll('#view .unit-row [data-pick]');
      var ids = [];
      for (var i = 0; i < 2 && i < cks.length; i++) {
        cks[i].checked = true;
        cks[i].dispatchEvent(new Event('change', {bubbles:true}));
        ids.push(Number(cks[i].dataset.pick));
      }
      return ids;
    })()`);
    await sleep(320);
    eq('打卡栏已选计数', await cdp.eval('document.getElementById("cbarCount").textContent'), '2');
    ok('提交按钮已启用', await cdp.eval('!document.getElementById("cbarSubmit").disabled'));
    await cdp.shot('04-catalog-light');

    /* 提交打卡 */
    await cdp.eval(`(function(){ document.querySelectorAll('#toasts .toast').forEach(function(n){n.remove();}); })()`);
    await cdp.eval('document.getElementById("cbarSubmit").click()');
    await cdp.waitFor('document.querySelectorAll("#toasts .toast").length > 0', 12000, '打卡 Toast');
    await sleep(500);
    const toastTxt = await cdp.eval(LAST_TOAST);
    ok('打卡成功提示：' + toastTxt, /已打卡/.test(toastTxt));
    await sleep(1400);
    eq('打卡后已选计数清零', await cdp.eval('document.getElementById("cbarCount").textContent'), '0');

    /* 记录里应出现这两条打卡 */
    await cdp.eval('document.querySelector(\'#nav [data-nav="records"]\').click()');
    await cdp.waitFor(sel('#view [data-day]'), 20000, '打卡记录渲染');
    const recCount = await cdp.eval('document.querySelectorAll("#view [data-rec]").length');
    eq('打卡记录条数', recCount, 2);
    ok('记录中包含刚打卡的单元 #' + pickedIds.join(' / #'),
      (await cdp.eval('!!document.querySelector(\'#view [data-rec="' + pickedIds[0] + '"]\')')) &&
      (await cdp.eval('!!document.querySelector(\'#view [data-rec="' + pickedIds[1] + '"]\')')));
    await cdp.shot('05-records-light');

    /* 撤销其中一条 */
    section('4. 学生撤销打卡（后台应能收到「已撤销打卡」）');
    await closeStray(cdp);
    await cdp.eval('document.querySelector(\'#view [data-rec="' + pickedIds[0] + '"] [data-revoke]\').click()');
    await cdp.waitFor(sel('.ui-modal .modal-box'), 10000, '撤销确认弹层');
    const confirmTxt = await cdp.eval(LAST_M('m.querySelector(".modal-body").textContent'));
    ok('确认弹层提示含「撤销」', /撤销/.test(confirmTxt));
    await cdp.shot('06-revoke-confirm');
    await cdp.eval(`(function(){ document.querySelectorAll('#toasts .toast').forEach(function(n){n.remove();}); })()`);
    await cdp.eval(LAST_M_CLICK('[data-act="yes"]'));
    await cdp.waitFor('document.querySelectorAll("#toasts .toast").length > 0', 12000, '撤销 Toast');
    await sleep(500);
    const rvToast = await cdp.eval(LAST_TOAST);
    ok('撤销成功提示：' + rvToast, /撤销/.test(rvToast));
    await sleep(1800);
    ok('被撤销的记录已从列表消失',
      !(await cdp.eval('!!document.querySelector(\'#view [data-rec="' + pickedIds[0] + '"]\')')));
    ok('未撤销的记录仍然保留',
      await cdp.eval('!!document.querySelector(\'#view [data-rec="' + pickedIds[1] + '"]\')'));
    eq('撤销后剩余记录条数', await cdp.eval('document.querySelectorAll("#view [data-rec]").length'), 1);

    /* 督促消息视图 */
    section('5. 督促消息与练习题视图');
    await gotoView(cdp, 'messages', /督促/);
    await gotoView(cdp, 'exercises', /练习/);

    /* 学生端不应有增删入口 */
    ok('学生端目录页无「新增主目录」按钮',
      !(await cdp.eval('!!document.querySelector(\'#view [data-act="new-root"]\')')));
    ok('学生端无删除目录按钮',
      !(await cdp.eval('!!document.querySelector(\'#view [data-unit-del]\')')));

    /* 学生端深色截图 */
    await cdp.eval('document.querySelector(\'#nav [data-nav="catalog"]\').click()');
    await cdp.waitFor(sel('#view .tree .tree-node'), 15000, '目录树回填');
    await cdp.eval('STORE.applyTheme("dark", true, true)');
    await sleep(900);
    eq('学生端切换到深色', await cdp.eval('document.documentElement.getAttribute("data-theme")'), 'dark');
    await cdp.shot('07-student-catalog-dark');
    const darkBright2 = await cdp.eval(darkTextCheck([
      '#view .page-head h2', '#view .tree-head .t-title', '#view .unit-row .u-title',
      '#view .field-label', '.brand-text b', '.nav-item', '#view .tree-head .t-sum',
      '#view .panel-head h3', '#view .unit-row .u-sub', '.bar-pct', '.chip',
    ]));
    ok('目录页深色主题下文本均为亮色 ' + (darkBright2.length ? JSON.stringify(darkBright2) : '（全部通过）'), darkBright2.length === 0);
    await cdp.eval('STORE.applyTheme("light", true, true)');
    await sleep(700);

    /* ═══ 6. 管理员登录 ═══ */
    section('6. 管理员后台');
    await closeStray(cdp);
    await cdp.eval(`(function(){
      document.getElementById('userBtn').click();
    })()`);
    await sleep(220);
    await cdp.eval(`document.querySelector('#userPop [data-act="logout"]').click()`);
    await cdp.waitFor('.ui-modal [data-act="yes"]', 10000, '退出确认');
    await cdp.eval(LAST_M_CLICK('[data-act="yes"]'));
    await cdp.waitFor('document.getElementById("loginPage") && !document.getElementById("loginPage").hidden', 15000, '回到登录页');
    await cdp.waitFor('document.querySelectorAll(".ui-modal").length === 0', 4000, '退出弹层关闭动画结束');
    ok('退出后无残留弹层', true);

    /* 切换为管理员并登录 */
    await cdp.eval('document.querySelector(\'#loginPage .seg-btn[data-role="admin"]\').click()');
    await sleep(220);
    eq('管理员演示账号条目数', await cdp.eval('document.querySelectorAll("#loginTip .tip-acc").length'), 1);
    await cdp.eval(`(function(){
      document.getElementById('loginUser').value = 'admin';
      document.getElementById('loginPass').value = 'admin@2026';
      document.getElementById('loginForm').dispatchEvent(new Event('submit', {cancelable:true, bubbles:true}));
    })()`);
    await cdp.waitFor('document.getElementById("app") && !document.getElementById("app").hidden', 20000, '管理员进入后台');
    await cdp.waitFor('document.querySelector("#view .stats-grid")', 20000, '管理面板渲染');

    ok('管理端品牌副标题正确', /管理后台/.test(await cdp.eval('document.getElementById("brandSub").textContent')));
    ok('侧边栏包含 7 个管理端菜单', (await cdp.eval('document.querySelectorAll("#nav .nav-item").length')) === 7);

    const admStats = await cdp.eval(`(function(){
      var out = [];
      document.querySelectorAll('#view .stat-card').forEach(function(c){
        out.push(c.querySelector('.s-top span:last-child').textContent.trim() + '=' + c.querySelector('.s-num').textContent.trim());
      });
      return out;
    })()`);
    ok('管理面板统计卡：' + admStats.join(' | '), admStats.length >= 5);

    const trendBars = await cdp.eval('document.querySelectorAll("#view .chart-bars .cb").length');
    ok('趋势图柱子数量 ' + trendBars + ' ≥ 1', trendBars >= 1);

    const tableRows = await cdp.eval('document.querySelectorAll("#view table.tbl tbody tr").length');
    ok('学生进度排行行数 ' + tableRows, tableRows === 5);
    await cdp.shot('08-admin-dashboard-light');

    /* 检查「已撤销打卡」是否在动态里出现 */
    const feedText = await cdp.eval('document.querySelector("#view .timeline") ? document.querySelector("#view .timeline").textContent : ""');
    ok('实时动态含「撤销打卡」记录', /撤销/.test(feedText));

    /* ═══ 7. 打卡流水（撤销痕迹） ═══ */
    section('7. 打卡流水含撤销标记');
    await gotoView(cdp, 'logs', /流水/);
    await cdp.waitFor(sel('#view table.tbl'), 20000, '流水表渲染');
    const logText = await cdp.eval('document.querySelector("#view table.tbl").textContent');
    ok('流水表包含「已撤销打卡」', /已撤销打卡/.test(logText));
    ok('流水表包含「完成打卡」', /完成打卡/.test(logText));
    await cdp.shot('09-admin-logs-light');

    /* 按动作筛选 */
    await cdp.eval(`(function(){
      var s = document.querySelector('#lgAction');
      s.value = 'revoke';
      s.dispatchEvent(new Event('change', {bubbles:true}));
    })()`);
    await sleep(2200);
    const onlyRevoke = await cdp.eval(`(function(){
      var t = document.querySelector('#view table.tbl');
      if (!t) return {rev:0, ck:0};
      var txt = t.textContent;
      return { rev: (txt.match(/已撤销打卡/g)||[]).length, ck: (txt.match(/完成打卡/g)||[]).length };
    })()`);
    ok('筛选「撤销打卡」后无打卡记录（revoke=' + onlyRevoke.rev + ', checkin=' + onlyRevoke.ck + '）',
      onlyRevoke.ck === 0);

    /* ═══ 8. 学生名单 ═══ */
    section('8. 学生名单（姓名/学号/班级/电话）');
    await gotoView(cdp, 'students', /学生名单/);
    await cdp.waitFor(sel('#view [data-row]'), 20000, '学生列表渲染');
    eq('学生列表行数', await cdp.eval('document.querySelectorAll("#view [data-row]").length'), 5);

    const stuInfo = await cdp.eval(`(function(){
      var r = document.querySelector('#view [data-row]');
      return { search: r.dataset.search, sub: r.querySelector('.l-sub').textContent };
    })()`);
    ok('学生字段含姓名/学号/班级/电话：' + stuInfo.sub.replace(/\s+/g, ' ').slice(0, 90),
      /学号/.test(stuInfo.sub) && /📞/.test(stuInfo.sub));

    /* 搜索过滤 */
    await cdp.eval(`(function(){
      var i = document.getElementById('stuSearch');
      i.value = '2026003';
      i.dispatchEvent(new Event('input', {bubbles:true}));
    })()`);
    await sleep(420);
    eq('搜索学号后可见行数', await cdp.eval('Array.prototype.filter.call(document.querySelectorAll("#view [data-row]"), function(n){return !n.hidden}).length'), 1);
    await cdp.eval(`(function(){
      var i = document.getElementById('stuSearch');
      i.value = ''; i.dispatchEvent(new Event('input', {bubbles:true}));
    })()`);
    await sleep(320);
    await cdp.shot('10-admin-students-light');

    /* ═══ 9. 目录内容 CRUD ═══ */
    section('9. 目录内容管理（四级目录增删改）');
    await gotoView(cdp, 'units', /目录/);
    await cdp.waitFor(sel('#admTree .tree-node.lv1'), 30000, '管理目录树渲染');
    eq('管理端主目录数量', await cdp.eval('document.querySelectorAll("#admTree > .tree-node.lv1").length'), 3);
    ok('存在「新增主目录」按钮', await cdp.eval('!!document.querySelector(\'#view [data-act="new-root"]\')'));
    ok('存在「新增子级」按钮', await cdp.eval('!!document.querySelector("#view [data-unit-add]")'));
    ok('存在「编辑」「删除」按钮',
      (await cdp.eval('!!document.querySelector("#view [data-unit-edit]")')) &&
      (await cdp.eval('!!document.querySelector("#view [data-unit-del]")')));
    await cdp.shot('11-admin-units-light');

    /* 打开新增主目录弹层并真实创建 */
    await closeStray(cdp);
    await cdp.eval('document.querySelector(\'#view [data-act="new-root"]\').click()');
    await cdp.waitFor('.ui-modal #uTitle', 12000, '新增目录弹层');
    await sleep(260);
    eq('打开的新增弹层数量为 1（防重复绑定）',
      await cdp.eval('document.querySelectorAll(".ui-modal").length'), 1);
    const newDlgText = await cdp.eval(`(function(){
      var ms = document.querySelectorAll('.ui-modal .modal-body');
      return ms.length ? ms[ms.length-1].textContent : '';
    })()`);
    ok('弹层提示为「主目录」：' + newDlgText.replace(/\s+/g, ' ').slice(0, 64), /主目录/.test(newDlgText));

    const testTitle = '自动测试目录 ' + Date.now().toString().slice(-6);
    await cdp.eval(`(function(){
      var ms = document.querySelectorAll('.ui-modal');
      var m = ms[ms.length-1];
      m.querySelector('#uTitle').value = ${JSON.stringify(testTitle)};
      m.querySelector('#uSummary').value = '由浏览器冒烟测试创建，稍后删除';
    })()`);
    await cdp.eval(`(function(){ document.querySelectorAll('#toasts .toast').forEach(function(n){n.remove();}); })()`);
    await cdp.eval(LAST_M_CLICK('[data-act="yes"]'));
    await cdp.waitFor('document.querySelectorAll("#toasts .toast").length > 0', 20000, '创建结果');
    await sleep(400);
    const createToast = await cdp.eval(LAST_TOAST);
    ok('创建结果提示：' + createToast, /创建/.test(createToast));
    await sleep(2200);

    const treeText = await cdp.eval('(function(){var el=document.getElementById("admTree");return el?el.textContent:"";})()');
    ok('新增主目录已在树中出现', treeText.indexOf(testTitle) >= 0,
      'admTree 长度=' + treeText.length);

    /* 删除它 */
    const delOk = await cdp.eval(`(function(){
      var nodes = document.querySelectorAll('#admTree > .tree-node.lv1');
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].textContent.indexOf(${JSON.stringify(testTitle)}) >= 0) {
          nodes[i].querySelector('[data-unit-del]').click();
          return true;
        }
      }
      return false;
    })()`);
    ok('找到并点击了新增目录的删除按钮', delOk);
    await cdp.waitFor('.ui-modal [data-act="yes"]', 12000, '删除确认');
    await cdp.eval(`(function(){ document.querySelectorAll('#toasts .toast').forEach(function(n){n.remove();}); })()`);
    await cdp.eval(LAST_M_CLICK('[data-act="yes"]'));
    await cdp.waitFor('document.querySelectorAll("#toasts .toast").length > 0', 20000, '删除结果');
    await sleep(400);
    const delToast = await cdp.eval(LAST_TOAST);
    ok('删除结果提示：' + delToast, /删除/.test(delToast));
    await sleep(2200);
    const treeText2 = await cdp.eval('(function(){var el=document.getElementById("admTree");return el?el.textContent:"";})()');
    ok('新增的测试目录已被删除', treeText2.indexOf(testTitle) < 0);

    /* ═══ 10. 督促全链路 ═══ */
    section('10. 督促投递与送达跟踪');
    await closeStray(cdp);
    await gotoView(cdp, 'urges', /督促/);
    await cdp.waitFor(sel('#view [data-act="new"]'), 15000, '督促页工具条');
    await cdp.eval('document.querySelector(\'#view [data-act="new"]\').click()');
    await cdp.waitFor('.ui-modal #ugStudents', 15000, '督促弹层');
    eq('督促弹层内学生可选数', await cdp.eval('document.querySelectorAll(".ui-modal [data-ug-pick]").length'), 5);

    /* 选择章节 */
    await cdp.eval(LAST_M_CLICK('[data-act="pick-unit"]'));
    await cdp.waitFor('.ui-modal #pkTree, .ui-modal #pkSearch', 15000, '章节选择器');
    await cdp.eval(`(function(){
      var ms = document.querySelectorAll('.ui-modal');
      var i = ms[ms.length-1].querySelector('#pkSearch');
      if (i) { i.value = 'cat'; i.dispatchEvent(new Event('input', {bubbles:true})); }
    })()`);
    await sleep(600);
    const hasHit = await cdp.eval(`(function(){
      var ms = document.querySelectorAll('.ui-modal');
      return ms[ms.length-1].querySelectorAll('[data-pk-pick]').length;
    })()`);
    if (hasHit > 0) {
      await cdp.eval(LAST_M_CLICK('[data-pk-pick]'));
      await sleep(500);
    } else {
      await cdp.eval(LAST_M_CLICK('[data-act="close"]'));
      await sleep(400);
    }
    ok('章节选择器可用（命中 ' + hasHit + ' 个节点）', true);

    /* 填表并发送 */
    await cdp.eval(`(function(){
      var m = document.querySelectorAll('.ui-modal');
      m = m[m.length-1];
      var picks = m.querySelectorAll('[data-ug-pick]');
      picks[0].checked = true; picks[0].dispatchEvent(new Event('change',{bubbles:true}));
      picks[1].checked = true; picks[1].dispatchEvent(new Event('change',{bubbles:true}));
      var t = m.querySelector('#ugTitle');
      if (t && !t.value) t.value = '自动化测试督促：请学习 cat 命令';
      var g = m.querySelector('#ugMsg');
      if (g) g.value = '这是浏览器冒烟测试发送的督促消息，请在截止时间前完成打卡。';
      var d = m.querySelector('#ugDeadline');
      if (d) {
        var dt = new Date(Date.now() + 86400000);
        var p = function(x){return x<10?'0'+x:''+x;};
        d.value = dt.getFullYear()+'-'+p(dt.getMonth()+1)+'-'+p(dt.getDate())+'T20:00';
      }
      m.querySelector('.pick-opt[data-p="2"]').click();
    })()`);
    await cdp.shot('12-admin-urge-dialog');
    await cdp.eval(`(function(){ document.querySelectorAll('#toasts .toast').forEach(function(n){n.remove();}); })()`);
    await cdp.eval(`(function(){
      var m = document.querySelectorAll('.ui-modal');
      m = m[m.length-1];
      m.querySelector('[data-act="yes"]').click();
    })()`);
    await cdp.waitFor('document.querySelectorAll("#toasts .toast").length > 0', 15000, '督促发送结果');
    await sleep(500);
    const urgeToast = await cdp.eval(LAST_TOAST);
    ok('督促发送成功：' + urgeToast, /发送|名/.test(urgeToast));
    await sleep(2000);
    ok('督促列表出现新记录', await cdp.eval('document.querySelectorAll("#view .panel").length >= 1'));

    /* 送达明细 */
    const hasDetail = await cdp.eval('!!document.querySelector("#view [data-targets]")');
    if (hasDetail) {
      await closeStray(cdp);
      await cdp.eval('document.querySelector("#view [data-targets]").click()');
      await cdp.waitFor('.ui-modal table.tbl', 15000, '送达明细');
      const detailRows = await cdp.eval(LAST_M('m.querySelectorAll("table.tbl tbody tr").length'));
      ok('送达明细行数 ' + detailRows, detailRows >= 1);
      await cdp.shot('13-admin-urge-targets');
      await cdp.eval(LAST_M_CLICK('[data-act="close"]'));
      await sleep(400);
    } else {
      ok('送达明细按钮存在', false);
    }

    /* ═══ 11. 学生端应看到督促 ═══ */
    section('11. 学生端可见督促并标记完成');
    await closeStray(cdp);
    await cdp.eval('document.getElementById("userBtn").click()');
    await sleep(200);
    await cdp.eval('document.querySelector(\'#userPop [data-act="logout"]\').click()');
    await cdp.waitFor('.ui-modal [data-act="yes"]', 10000, '退出确认');
    await cdp.eval(LAST_M_CLICK('[data-act="yes"]'));
    await cdp.waitFor('document.getElementById("loginPage") && !document.getElementById("loginPage").hidden', 15000, '回到登录页');
    await cdp.waitFor('document.querySelectorAll(".ui-modal").length === 0', 4000, '退出弹层关闭动画结束');
    ok('退出后无残留弹层', true);

    await cdp.eval('document.querySelector(\'#loginPage .seg-btn[data-role="student"]\').click()');
    await sleep(220);
    await cdp.eval(`(function(){
      document.getElementById('loginUser').value = 'student1';
      document.getElementById('loginPass').value = 'xiaoran2026';
      document.getElementById('loginForm').dispatchEvent(new Event('submit', {cancelable:true, bubbles:true}));
    })()`);
    await cdp.waitFor('document.getElementById("app") && !document.getElementById("app").hidden', 20000, '学生重新进入');
    await cdp.eval('document.querySelector(\'#nav [data-nav="messages"]\').click()');
    await cdp.waitFor('document.querySelector("#view .msg")', 20000, '督促消息渲染');

    const msgCount = await cdp.eval('document.querySelectorAll("#view .msg").length');
    ok('学生端收到的督促消息数 ' + msgCount + ' ≥ 1', msgCount >= 1);
    const msgTxt = await cdp.eval('document.querySelector("#view .msg").textContent');
    ok('消息内容含管理员自定义文案', /冒烟测试|截止|学习/.test(msgTxt));
    ok('消息含「已完成」按钮', await cdp.eval('!!document.querySelector("#view [data-done]")'));
    await cdp.shot('14-student-messages');

    /* 去学习该章节 */
    const goto = await cdp.eval('!!document.querySelector("#view [data-goto-unit]")');
    if (goto) {
      await cdp.eval('document.querySelector("#view [data-goto-unit]").click()');
      await sleep(2200);
      ok('跳转到学习目录视图', /学习目录/.test(await cdp.eval('document.querySelector("#view .page-head h2").textContent')));
    } else {
      ok('「去学习该章节」按钮存在', false);
    }

    /* 标记已完成 */
    await cdp.eval('document.querySelector(\'#nav [data-nav="messages"]\').click()');
    await cdp.waitFor('document.querySelector("#view [data-done]")', 20000, '消息回填');
    await cdp.eval('document.querySelector("#view [data-done]").click()');
    await cdp.waitFor('document.querySelector("#toasts .toast .t-msg")', 15000, '完成督促');
    await sleep(1500);

    /* ═══ 12. 全平台尺寸适配 ═══ */
    section('12. 多尺寸适配（手机 / 平板 / 桌面 / Mac / 超宽）');
    const sizes = [
      { w: 320,  h: 568,  label: 'iPhone SE 竖屏 320' },
      { w: 375,  h: 667,  label: 'iPhone 8 375' },
      { w: 414,  h: 896,  label: 'iPhone 11 414' },
      { w: 768,  h: 1024, label: 'iPad 竖屏 768' },
      { w: 992,  h: 768,  label: '平板横屏 992' },
      { w: 1440, h: 900,  label: 'MacBook 1440' },
      { w: 1920, h: 1080, label: '台式机 1920' },
      { w: 2560, h: 1440, label: '2K 显示器 2560' },
    ];
    for (const s of sizes) {
      await cdp.resize(s.w, s.h);
      const info = await cdp.eval(`(function(){
        var doc = document.documentElement;
        var vw = doc.clientWidth;
        var worst = { sel: '-', over: 0 };
        ['.view', '.view-inner', '.checkin-bar', '.topbar', '.panel', '.tree-node',
         '.stats-grid', '.page-head', '.unit-row', '.modal-box', '.list-row'].forEach(function(s){
          document.querySelectorAll(s).forEach(function(n){
            if (n.offsetParent === null && getComputedStyle(n).position !== 'fixed') return;
            var r = n.getBoundingClientRect();
            var over = Math.round(Math.max(0, r.right - vw));
            if (over > worst.over) worst = { sel: s, over: over };
          });
        });
        return {
          vw: vw,
          wholeOverflow: doc.scrollWidth - doc.clientWidth,
          worstSel: worst.sel,
          worstOver: worst.over,
          menuVisible: getComputedStyle(document.getElementById('btnMenu')).display !== 'none',
          viewW: Math.round(document.getElementById('view').getBoundingClientRect().width),
          barVisible: !document.getElementById('checkinBar').hidden
        };
      })()`);
      ok(s.label + ' 无元素超出视口（最宽溢出 ' + info.worstOver + 'px @ ' + info.worstSel +
        '，视口 ' + info.vw + 'px）', info.worstOver <= 1);
      if (s.w <= 992) ok(s.label + ' 显示汉堡菜单', info.menuVisible);
      if (s.w >= 1200) ok(s.label + ' 隐藏汉堡菜单并展示侧栏', !info.menuVisible);
      if (s.w === 375) await cdp.shot('15-mobile-375');
      if (s.w === 768) await cdp.shot('15b-tablet-768');
      if (s.w === 1920) await cdp.shot('16-desktop-1920');
      if (s.w === 2560) await cdp.shot('17-ultrawide-2560');
    }
    await cdp.resize(1440, 900);

    /* ═══ 13. 无障碍与会话持久化 ═══ */
    section('13. 刷新保持登录 + 控制台无错');
    await cdp.send('Page.reload', { ignoreCache: false });
    await cdp.waitFor('document.readyState === "complete"', 20000, '刷新完成');
    await cdp.waitFor('document.getElementById("app") && !document.getElementById("app").hidden', 20000, '自动恢复登录');
    ok('刷新后自动恢复登录态（免登录）', true);
    const restoredView = await cdp.eval('document.querySelector("#view .page-head h2") ? document.querySelector("#view .page-head h2").textContent : ""');
    ok('刷新后视图正常渲染：' + restoredView, restoredView.length > 0);

    const realErrors = consoleErrors.filter((t) => !/Download the React|favicon|preload/i.test(t));
    ok('浏览器控制台无 JS 错误' + (realErrors.length ? '' : '（0 条）'),
      realErrors.length === 0, realErrors.slice(0, 5).join(' || '));

    /* 汇总 */
    console.log('\n════════ 结果 ════════');
    console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
    if (failures.length) {
      console.log('\n失败明细：');
      failures.forEach((f, i) => console.log('  ' + (i + 1) + '. ' + f));
      exitCode = 1;
    }
    console.log('截图目录: ' + SHOTS);

  } catch (e) {
    console.error('\n✖ 测试中断：' + e.message);
    console.error(e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : '');
    exitCode = 1;
  } finally {
    try { chrome.kill(); } catch (e) { /* 忽略 */ }
    await sleep(400);
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
    process.exit(exitCode);
  }
})();
