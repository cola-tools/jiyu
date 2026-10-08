'use strict';
/* ══════════════════════════════════════════════════════════════════
   CDP 测试脚手架（零依赖，无头 Chrome 直连）
   ──────────────────────────────────────────────────────────────────
   被 tests/browser-member.js 复用；tests/browser-smoke.js 自带一份等价实现，
   保持独立以便基线套件可以单独运行。
   ══════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ───────── 断言计数 ───────── */
const T = {
  pass: 0,
  fail: 0,
  failures: [],
  ok(name, cond, extra) {
    if (cond) { this.pass++; console.log('  ✓ ' + name); }
    else {
      this.fail++;
      this.failures.push(name + (extra ? ' → ' + String(extra).slice(0, 300) : ''));
      console.log('  ✗ ' + name + (extra ? '  → ' + String(extra).slice(0, 300) : ''));
    }
    return !!cond;
  },
  eq(name, a, b) { return this.ok(name + '  [' + a + ' = ' + b + ']', a === b, 'got ' + JSON.stringify(a)); },
  section(t) { console.log('\n── ' + t + ' ──'); },
};

/* ───────── 常用表达式 ───────── */
const sel = (css) => '!!document.querySelector(' + JSON.stringify(css) + ')';
const LAST_TOAST = `(function(){
  var t = document.querySelectorAll('#toasts .toast .t-msg');
  return t.length ? t[t.length-1].textContent : '';
})()`;
/** 操作「最上层（最后打开的）弹层」 */
const LAST_M = (inner) => `(function(){var ms=document.querySelectorAll('.ui-modal');` +
  `if(!ms.length)return null;var m=ms[ms.length-1];return (${inner});})()`;
const LAST_M_CLICK = (css) => `(function(){var ms=document.querySelectorAll('.ui-modal');` +
  `if(!ms.length)return false;var m=ms[ms.length-1],n=m.querySelector(${JSON.stringify(css)});` +
  `if(!n)return false;n.click();return true;})()`;

/* ───────── 登录：身份网关 + 弹窗（新版单一登录窗口） ───────── */
const ROLE_BTN_ID = (role) => (role === 'admin' ? 'btnAdminLogin' : 'btnStudentLogin');
/** 点击网关上的身份按钮，弹出对应登录窗 */
const CLICK_ROLE = (role) => `(function(){var b=document.getElementById(` +
  `${JSON.stringify(ROLE_BTN_ID(role))});if(!b)return false;b.click();return true;})()`;
/** 登录窗已打开时填表并提交（表单 id 固定：loginUser / loginPass / loginForm） */
const SUBMIT_LOGIN = (user, pass) => `(function(){` +
  `var u=document.getElementById('loginUser'),p=document.getElementById('loginPass'),` +
  `f=document.getElementById('loginForm');if(!u||!p||!f)return false;` +
  `u.value=${JSON.stringify(user)};p.value=${JSON.stringify(pass)};` +
  `f.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));return true;})()`;

/** 完整走一遍 UI：点身份按钮 → 等登录窗 → 填表提交 */
async function openLogin(cdp, role) {
  const r = role === 'admin' ? 'admin' : 'student';
  const clicked = await cdp.eval(CLICK_ROLE(r));
  if (clicked !== true) throw new Error('未找到身份按钮：' + ROLE_BTN_ID(r));
  await cdp.waitFor('!!document.getElementById("loginUser")', 20000, '登录窗（' + r + '）');
  await sleep(220);
  return true;
}

/* ───────── CDP 客户端 ───────── */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.waiting = new Map();
    this.handlers = [];
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.id && this.waiting.has(msg.id)) {
        const { resolve, reject } = this.waiting.get(msg.id);
        this.waiting.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
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
        if (this.waiting.has(id)) { this.waiting.delete(id); reject(new Error('CDP timeout: ' + method)); }
      }, 45000);
    });
  }

  on(fn) { this.handlers.push(fn); }

  async eval(expr, awaitPromise = true) {
    const r = await this.send('Runtime.evaluate', {
      expression: '(function(){ try { return (' + expr + '); } catch (e) { return { __err: String(e && e.message || e) }; } })()',
      returnByValue: true,
      awaitPromise: !!awaitPromise,
      userGesture: true,
    });
    if (r.exceptionDetails) {
      const ed = r.exceptionDetails;
      const ex = ed.exception || {};
      const desc = ex.description || ex.value || ed.text || '(无描述)';
      throw new Error('页面脚本异常: ' + desc +
        ' @' + (ed.url || '?') + ':' + (ed.lineNumber || 0) + ':' + (ed.columnNumber || 0));
    }
    if (r.result && r.result.value && r.result.value.__err) throw new Error('页面脚本抛错: ' + r.result.value.__err);
    return r.result ? r.result.value : undefined;
  }

  /** 轮询直到条件成立；既接受 JS 表达式也接受纯 CSS 选择器 */
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
        const r = await this.send('Runtime.evaluate', { expression: wrapped, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) {
          last = r.exceptionDetails.text;
        } else {
          last = r.result ? r.result.value : undefined;
          if (last === true) return true;
        }
      } catch (err) { last = err.message; }
      await sleep(140);
    }
    throw new Error('等待超时' + (label ? '（' + label + '）' : '') + '：' + e + '  最后结果=' + JSON.stringify(last));
  }

  async shot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const f = path.join(this.shots, name + '.png');
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    return f;
  }

  async resize(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 768 });
    await sleep(260);
  }
}

/**
 * 启动无头 Chrome 并连上 CDP。
 * @returns {{cdp:CDP, chrome:ChildProcess, userDir:string, close:Function}}
 */
async function launch(opts) {
  const o = opts || {};
  const PORT = Number(o.port || process.env.CDP_PORT || 9334);
  const shots = o.shots || path.join(__dirname, '..', 'shots');
  const chromePath = o.chrome || process.env.CHROME || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ].find((p) => fs.existsSync(p));
  if (!chromePath) throw new Error('未找到 Chrome，请通过 CHROME 环境变量指定路径');
  fs.mkdirSync(shots, { recursive: true });

  const userDir = path.join(os.tmpdir(), 'lsp-cdp-' + Date.now() + '-' + Math.floor(Math.random() * 1e4));
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + userDir,
    '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking',
    '--disable-features=Translate,BackForwardCache,AcceptCHFrame',
    '--window-size=1440,900',
    '--hide-scrollbars',
    'about:blank',
  ], { stdio: 'ignore', detached: false });

  let list = null;
  for (let i = 0; i < 60 && !list; i++) {
    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      if (res.ok) list = await res.json();
    } catch (e) { /* 尚未就绪 */ }
    if (!list) await sleep(250);
  }
  if (!list) throw new Error('CDP 端点不可用');

  const target = list.find((t) => t.type === 'page') || list[0];
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', () => rej(new Error('WebSocket 连接失败')));
  });

  const cdp = new CDP(ws);
  cdp.shots = shots;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });

  function close() {
    try { chrome.kill(); } catch (e) { /* 忽略 */ }
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  }

  return { cdp, chrome, userDir, close, shots };
}

module.exports = {
  T, CDP, launch, sleep, sel,
  LAST_TOAST, LAST_M, LAST_M_CLICK,
  ROLE_BTN_ID, CLICK_ROLE, SUBMIT_LOGIN, openLogin,
};
