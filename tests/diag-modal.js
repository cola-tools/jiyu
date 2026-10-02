'use strict';
/* 诊断：管理员目录页「新增主目录」为何产生两个 .ui-modal */
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = process.env.BASE || 'http://127.0.0.1:3210';
const PORT = Number(process.env.CDP_PORT || 9334);
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpJson(url) {
  const res = await fetch(url);
  return res.json();
}

(async () => {
  const userDir = path.join(os.tmpdir(), 'lsp-diag-' + Date.now());
  const { spawn } = require('child_process');
  const child = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDir, '--window-size=1440,900',
    'about:blank',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try {
      const list = await httpJson('http://127.0.0.1:' + PORT + '/json/list');
      target = (list || []).find((t) => t.type === 'page');
    } catch (e) { /* retry */ }
  }
  if (!target) { console.error('无法连接 Chrome'); child.kill(); process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let id = 0;
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise((r) => ws.addEventListener('open', r));

  const send = (method, params) => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
    ws.send(JSON.stringify({ id: n, method, params: params || {} }));
  });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', {
      expression: '(function(){try{return (' + expr + ')}catch(e){return {__err:String(e.message)}}})()',
      returnByValue: true, awaitPromise: true, userGesture: true,
    });
    if (r.result && r.result.value && r.result.value.__err) throw new Error(r.result.value.__err);
    return r.result.value;
  };
  const waitFor = async (expr, ms, label) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await ev('!!(' + expr + ')')) return true;
      await sleep(150);
    }
    throw new Error('timeout: ' + (label || expr));
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: BASE + '/' });
  await sleep(3600);

  // 管理员登录
  await ev(`(function(){
    var seg=document.querySelectorAll('#loginPage .seg-btn');
    for(var i=0;i<seg.length;i++){ if(seg[i].dataset.role==='admin') seg[i].click(); }
    return true;
  })()`);
  await sleep(400);
  await ev(`(function(){
    document.getElementById('loginUser').value='admin';
    document.getElementById('loginPass').value='admin@2026';
    document.getElementById('loginForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));
    return true;
  })()`);
  await waitFor('document.getElementById("app") && !document.getElementById("app").hidden', 20000, '登录');
  await sleep(800);

  // 进入目录视图
  await ev(`(function(){var n=document.querySelector('#nav [data-nav="units"]');if(n)n.click();})()`);
  await waitFor('!!document.querySelector("#admTree .tree-node.lv1")', 25000, '目录树');
  await sleep(400);

  // 探测：在 body 上挂一个计数器，记录 UI.modal 被调用次数
  await ev(`(function(){
    window.__modalCalls = 0;
    var orig = window.UI.modal;
    window.UI.modal = function(o){ window.__modalCalls++; window.__lastTitle = o && o.title; return orig.apply(this, arguments); };
    return true;
  })()`);

  const before = await ev('document.querySelectorAll(".ui-modal").length');
  console.log('点击前 .ui-modal 数量 =', before);
  if (before > 0) {
    console.log('已有弹层明细 =', JSON.stringify(await ev(`(function(){
      return Array.prototype.map.call(document.querySelectorAll('.ui-modal'), function(m){
        return { title: (m.querySelector('.modal-head h3')||{}).textContent, len: m.querySelector('.modal-body') ? m.querySelector('.modal-body').textContent.length : 0 };
      });
    })()`)));
  }

  await ev(`document.querySelector('#view [data-act="new-root"]').click()`);
  await sleep(600);

  console.log('UI.modal 调用次数 =', await ev('window.__modalCalls'));
  console.log('最后标题 =', await ev('window.__lastTitle'));
  console.log('点击后 .ui-modal 数量 =', await ev('document.querySelectorAll(".ui-modal").length'));
  console.log('明细 =', JSON.stringify(await ev(`(function(){
    return Array.prototype.map.call(document.querySelectorAll('.ui-modal'), function(m){
      return {
        title: (m.querySelector('.modal-head h3')||{}).textContent,
        hasTitleInput: !!m.querySelector('#uTitle'),
        len: m.querySelector('.modal-body') ? m.querySelector('.modal-body').textContent.length : 0,
        hidden: !!m.hidden,
        opacity: m.style.opacity
      };
    });
  })()`)));

  // 检查 #app 委托监听是否重复：统计事件监听（不可直接读），改用计数法
  console.log('#app dataset.abound =', await ev('document.getElementById("app").dataset.abound'));

  ws.close();
  child.kill();
  process.exit(0);
})().catch((e) => { console.error('诊断失败：', e.message); process.exit(1); });
