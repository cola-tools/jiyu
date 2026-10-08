'use strict';
/* ══════════════════════════════════════════════════════════════════
   提醒功能端到端测试（CDP 直连无头 Chrome）
   ──────────────────────────────────────────────────────────────────
   覆盖：
     · 管理端侧栏「提醒学生」入口 + 功能页（内容 / 重要性 / 发送 / 历史）
     · 学生端右上角提醒面板（登录后显示、已登录直接显示）
     · 只能 ✕ 关闭、绝不自动关闭
     · 未关闭 → 下次登录继续显示；已关闭 → 不再显示
     · 管理员撤回后学生端立即消失
     · 深色主题下文字可读
   前置：后端已启动（默认 http://127.0.0.1:3210），数据库已迁移 v3
   运行：node tests/browser-notice.js
   ══════════════════════════════════════════════════════════════════ */

const path = require('path');
const { T, launch, sleep, sel, LAST_TOAST, LAST_M_CLICK, openLogin, SUBMIT_LOGIN } = require('./lib/cdp');

const BASE = process.env.BASE || 'http://127.0.0.1:3210';
const PORT = Number(process.env.CDP_PORT || 9337);
const STAMP = Date.now().toString().slice(-6);
const C1 = '【E2E-' + STAMP + '】第一节已更新，请尽快完成打卡';
const C2 = '【E2E-' + STAMP + '】第二节新内容上线，记得来打卡';

/* ───────── 小工具 ───────── */

const NAV_CLICK = (key) => '(function(){var n=document.querySelector(\'#nav [data-nav="' + key +
  '"]\');if(!n)return false;n.click();return true;})()';

const GATE_SHOWN = '(function(){var p=document.getElementById("loginPage");' +
  'return !!p && !p.hidden && !!document.getElementById("loginGate");})()';

/** 主应用已真正显示（#app 未隐藏）——避免读到上一次会话残留的 DOM */
const APP_SHOWN = '(function(){var a=document.getElementById("app");' +
  'return !!a && !a.hidden && !!document.querySelector("#nav .nav-item");})()';

/** 学生登录并等到主应用真正就绪（含提醒面板刷新完成） */
async function studentLogin(cdp) {
  await openLogin(cdp, 'student');
  await cdp.eval(SUBMIT_LOGIN('student1', 'xiaoran2026'));
  await cdp.waitFor(APP_SHOWN, 25000, '学生端主应用');
  await sleep(600);
}

/** 管理员登录并等到主应用真正就绪 */
async function adminLogin(cdp) {
  await openLogin(cdp, 'admin');
  await cdp.eval(SUBMIT_LOGIN('admin', 'admin@2026'));
  await cdp.waitFor(APP_SHOWN, 25000, '管理端主应用');
  await sleep(600);
}

const DOCK_SHOWN = '(function(){var n=document.getElementById("noticeDock");' +
  'return !!n && !n.hidden && n.children.length > 0;})()';

const DOCK_HIDDEN = '(function(){var n=document.getElementById("noticeDock");' +
  'return !!n && n.hidden;})()';

/** 直接调后端拿管理员令牌（用于准备数据 / 撤回，避免反复走 UI） */
async function adminToken() {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'admin', password: 'admin@2026', role: 'admin', platform: 'learn' }),
  });
  const j = await r.json();
  if (!j.token) throw new Error('管理员登录失败：' + JSON.stringify(j));
  return j.token;
}

async function adminSend(token, content, priority) {
  const r = await fetch(BASE + '/api/admin/notices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ content: content, priority: priority }),
  });
  return r.json();
}

async function adminDelete(token, id) {
  const r = await fetch(BASE + '/api/admin/notices/' + id, {
    method: 'DELETE', headers: { Authorization: 'Bearer ' + token },
  });
  return r.json();
}

/** 从登录页登出（打开用户菜单 → 退出登录 → 确认） */
async function logout(cdp) {
  await cdp.eval('(function(){var b=document.getElementById("userBtn");if(b)b.click();return !!b;})()');
  await sleep(220);
  await cdp.eval('(function(){var b=document.querySelector(\'#userPop [data-act="logout"]\');' +
    'if(!b)return false;b.click();return true;})()');
  await cdp.waitFor(sel('.ui-modal'), 10000, '退出确认弹窗');
  await cdp.eval(LAST_M_CLICK('[data-act="yes"]'));
  await cdp.waitFor(GATE_SHOWN, 20000, '回到登录页');
  await sleep(400);
}

/** 深色主题下的文字亮度校验 */
const LUM_HELPER = 'function __lum(c){var m=c.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);' +
  'if(!m)return 999;return 0.299*+m[1]+0.587*+m[2]+0.114*+m[3];}';
const darkTextCheck = (sels) => '(function(){' + LUM_HELPER +
  'var bad=[];' + JSON.stringify(sels) + '.forEach(function(s){' +
  'var n=document.querySelector(s);if(!n)return;' +
  'var c=getComputedStyle(n).color;if(__lum(c)<150)bad.push(s+"="+c);});return bad;})()';

/* ───────── 主流程 ───────── */

(async () => {
  const { cdp, close } = await launch({ port: PORT });
  /* 记录所有 /api/ 响应，失败时便于定位 401 / 404 */
  const netlog = [];
  cdp.on((m) => {
    if (m.method === 'Network.responseReceived' && /\/api\//.test(m.params.response.url)) {
      netlog.push(m.params.response.status + ' ' + m.params.response.url.replace(/^https?:\/\/[^/]+/, ''));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      netlog.push('EXC ' + String(m.params.exceptionDetails.text || '').slice(0, 120));
    }
  });
  let token = null;
  const mark = (t) => netlog.push('===== ' + t + ' =====');
  let notice1Id = 0;
  let notice2Id = 0;

  try {
    await cdp.send('Page.navigate', { url: BASE });
    await cdp.waitFor(GATE_SHOWN, 25000, '登录网关');

    /* ═══════ 1. 管理员：侧栏入口 + 功能页 ═══════ */
    T.section('1. 管理员登录与「提醒学生」入口');

    await adminLogin(cdp);
    T.ok('管理员登录成功', true);

    T.ok('侧栏出现「提醒学生」入口', await cdp.eval(sel('#nav [data-nav="notices"]')) === true);
    const navTxt = await cdp.eval(
      '(function(){var n=document.querySelector(\'#nav [data-nav="notices"]\');return n?n.textContent:"";})()');
    T.ok('入口文案为「提醒学生」：' + navTxt.replace(/\s+/g, ' '), /提醒学生/.test(navTxt));

    await cdp.eval(NAV_CLICK('notices'));
    await cdp.waitFor(sel('#noticeContent'), 25000, '提醒发送表单');
    T.ok('点侧栏打开「提醒学生」功能页', true);

    const h2 = await cdp.eval('(function(){var n=document.querySelector("#view .page-head h2");' +
      'return n?n.textContent:"";})()');
    T.ok('页面标题含「提醒学生」：' + h2.trim(), /提醒学生/.test(h2));

    /* ═══════ 2. 发送表单 ═══════ */
    T.section('2. 发送表单：内容 / 重要性 / 校验');

    T.ok('存在提醒内容输入框', await cdp.eval(sel('#noticeContent')) === true);
    T.ok('存在发送按钮', await cdp.eval(sel('#btnSendNotice')) === true);
    const btnTxt = await cdp.eval('(function(){var n=document.getElementById("btnSendNotice");' +
      'return n?n.textContent:"";})()');
    T.ok('发送按钮文案为「🔔 提醒学生」：' + btnTxt.trim(), /提醒学生/.test(btnTxt));

    const priN = await cdp.eval('document.querySelectorAll("#noticePri .npri-btn").length');
    T.eq('重要性共 3 档', priN, 3);
    const priTxt = await cdp.eval(
      '(function(){return Array.prototype.map.call(document.querySelectorAll("#noticePri .npri-btn"),' +
      'function(b){return b.querySelector(".np-txt b").textContent;}).join("/");})()');
    T.eq('重要性档位文案', priTxt, '普通/重要/紧急');
    const defOn = await cdp.eval(
      '(function(){var b=document.querySelector("#noticePri .npri-btn.on");' +
      'return b?b.dataset.noticePri:"";})()');
    T.eq('默认选中「普通」', defOn, '1');

    // 空内容拦截
    await cdp.eval('document.getElementById("btnSendNotice").click()');
    await sleep(500);
    const tEmpty = await cdp.eval(LAST_TOAST);
    T.ok('空内容发送被拦截：' + tEmpty, /填写提醒内容/.test(tEmpty));

    // 填内容 + 选紧急
    await cdp.eval('(function(){var t=document.getElementById("noticeContent");' +
      't.value=' + JSON.stringify(C1) + ';' +
      't.dispatchEvent(new Event("input",{bubbles:true}));return true;})()');
    await sleep(150);
    const cntOk = await cdp.eval('(function(){var t=document.getElementById("noticeContent"),' +
      'c=document.getElementById("noticeCount");return c.textContent===String(t.value.length);})()');
    T.ok('字数统计与输入实时同步', cntOk === true);

    await cdp.eval('(function(){var b=document.querySelector(\'[data-notice-pri="3"]\');' +
      'if(b)b.click();return !!b;})()');
    await sleep(220);
    const on3 = await cdp.eval('(function(){var b=document.querySelector(\'[data-notice-pri="3"]\');' +
      'return b?b.classList.contains("on"):false;})()');
    T.ok('重要性可切换到「紧急」', on3 === true);

    // 发送
    await cdp.eval('document.getElementById("btnSendNotice").click()');
    await cdp.waitFor('(function(){return document.querySelectorAll("#view [data-notice-row]").length > 0;})()',
      25000, '历史提醒列表出现新记录');
    const tSend = await cdp.eval(LAST_TOAST);
    T.ok('发送成功提示：' + tSend, /提醒已发送给/.test(tSend));

    /* ═══════ 3. 历史列表 ═══════ */
    T.section('3. 历史提醒列表');

    const firstContent = await cdp.eval(
      '(function(){var n=document.querySelector("#view .notice-content");return n?n.textContent:"";})()');
    T.ok('列表首条为刚发送的内容', firstContent.indexOf(C1) === 0, firstContent.slice(0, 60));
    const chipTxt = await cdp.eval(
      '(function(){var n=document.querySelector("#view .notice-chip");return n?n.textContent:"";})()');
    T.ok('标记为「紧急」：' + chipTxt.trim(), /紧急/.test(chipTxt));
    const bigNum = await cdp.eval(
      '(function(){var n=document.querySelector("#view .notice-big-num");return n?n.textContent:"";})()');
    T.ok('显示待关闭人数：' + bigNum.trim(), /[0-9]/.test(bigNum));
    T.ok('管理端自身不显示学生提醒面板', await cdp.eval(DOCK_HIDDEN) === true);
    await cdp.eval('STORE.applyTheme("light", false)');
    await sleep(500);
    await cdp.shot('notice-00-admin-light');

    token = await adminToken();

    /* ═══════ 4. 学生端：登录后右上角显示 ═══════ */
    mark('S4-start');
    T.section('4. 学生登录后右上角显示提醒');

    await logout(cdp);
    await studentLogin(cdp);
    await cdp.waitFor(DOCK_SHOWN, 25000, '学生端提醒面板');
    T.ok('学生登录后右上角出现提醒面板', true);

    const box = await cdp.eval('(function(){var n=document.getElementById("noticeDock");' +
      'var r=n.getBoundingClientRect();' +
      'return {top:Math.round(r.top),right:Math.round(r.right),w:innerWidth,h:innerHeight};})()');
    T.ok('面板位于右上角：' + JSON.stringify(box),
      box.right > box.w * 0.6 && box.top < box.h * 0.35);

    const body1 = await cdp.eval(
      '(function(){var n=document.querySelector("#noticeDock .nc-body");return n?n.textContent:"";})()');
    T.ok('面板显示提醒内容', body1.indexOf(C1) === 0, body1.slice(0, 60));
    const pri3 = await cdp.eval(
      '(function(){var n=document.querySelector("#noticeDock .nc-pri");return n?n.textContent:"";})()');
    T.ok('面板显示重要性「紧急」：' + pri3.trim(), /紧急/.test(pri3));
    T.ok('面板提供 ✕ 关闭按钮', await cdp.eval(sel('#noticeDock [data-notice-close]')) === true);
    await cdp.eval('STORE.applyTheme("light", false)');
    await sleep(500);
    await cdp.shot('notice-03-student-light');

    /* ═══════ 5. 不会自动关闭 ═══════ */
    mark('S5-start');
    T.section('5. 不自动关闭（等待 4s 仍在）');

    await sleep(4000);
    T.ok('等待 4s 后面板仍显示（绝不自动关闭）', await cdp.eval(DOCK_SHOWN) === true);
    // 切换视图也不应关闭
    await cdp.eval(NAV_CLICK('catalog'));
    await sleep(1200);
    T.ok('切换页面后面板仍显示', await cdp.eval(DOCK_SHOWN) === true);
    await cdp.eval(NAV_CLICK('dashboard'));
    await sleep(800);

    /* ═══════ 6. 未关闭 → 下次登录继续显示 ═══════ */
    mark('S6-start');
    T.section('6. 未关闭的提醒，下次登录继续显示');

    await logout(cdp);
    await studentLogin(cdp);
    await cdp.waitFor(DOCK_SHOWN, 25000, '二次登录仍显示提醒');
    const body2 = await cdp.eval(
      '(function(){var n=document.querySelector("#noticeDock .nc-body");return n?n.textContent:"";})()');
    T.ok('未关闭 → 下次登录继续显示同一条提醒', body2.indexOf(C1) === 0, body2.slice(0, 60));

    /* ═══════ 7. ✕ 关闭 ═══════ */
    mark('S7-start');
    T.section('7. ✕ 关闭后不再显示');

    const clicked = await cdp.eval('(function(){var b=document.querySelector("#noticeDock [data-notice-close]");' +
      'if(!b)return false;b.click();return true;})()');
    T.ok('✕ 按钮存在并已点击', clicked === true);
    try {
      await cdp.waitFor(DOCK_HIDDEN, 12000, '面板关闭');
      T.ok('点 ✕ 后面板关闭', true);
    } catch (e) {
      const diag = await cdp.eval('(function(){' +
        'var n=document.getElementById("noticeDock");' +
        'var b=document.querySelector("#noticeDock [data-notice-close]");' +
        'return {hidden:n?n.hidden:null,children:n?n.children.length:-1,' +
        'cards:document.querySelectorAll("#noticeDock [data-notice]").length,' +
        'closeId:b?b.dataset.noticeClose:null,' +
        'npCount:(window.NoticePanel?window.NoticePanel.count():"noNP"),' +
        'npDebug:(window.NoticePanel?JSON.stringify(window.NoticePanel.debug()):"noNP"),' +
        'toast:(function(){var t=document.querySelectorAll("#toasts .toast .t-msg");' +
        'return t.length?t[t.length-1].textContent:"";})()};})()');
      T.ok('点 ✕ 后面板关闭（诊断：' + JSON.stringify(diag) + '）', false, e.message);
      console.log('   ✕ 关闭失败时的接口流水：');
      netlog.forEach((l, i) => console.log('   [' + i + '] ' + l));
    }
    const tClose = await cdp.eval(LAST_TOAST);
    T.ok('关闭提示：' + tClose, /已关闭/.test(tClose));

    await logout(cdp);
    await studentLogin(cdp);
    await sleep(2500);
    T.ok('已关闭 → 再次登录不再显示', await cdp.eval(DOCK_HIDDEN) === true);

    /* ═══════ 8. 登录状态下直接显示新提醒 ═══════ */
    T.section('8. 已登录状态下，管理员新发提醒即时显示');

    const r2 = await adminSend(token, C2, 2);
    T.ok('管理员发送第二条提醒成功', r2 && r2.ok === true, JSON.stringify(r2));
    notice2Id = r2 && r2.id ? Number(r2.id) : 0;

    await cdp.eval('window.NoticePanel.refresh()');
    await cdp.waitFor(DOCK_SHOWN, 20000, '登录状态下收到新提醒');
    T.ok('登录状态下直接显示新提醒（无需重新登录）', true);
    // 按内容定位卡片：面板里可能同时存在多条提醒（按重要性排序）
    const card3 = await cdp.eval(
      '(function(){var cs=document.querySelectorAll("#noticeDock [data-notice]");' +
      'for(var i=0;i<cs.length;i++){var b=cs[i].querySelector(".nc-body");' +
      'if(b&&b.textContent===' + JSON.stringify(C2) + '){' +
      'var p=cs[i].querySelector(".nc-pri");return {body:b.textContent,pri:p?p.textContent:""};}}' +
      'return null;})()');
    T.ok('面板中出现第二条提醒内容', !!card3, JSON.stringify(card3));
    T.ok('第二条标记为「重要」：' + (card3 ? card3.pri.trim() : ''), !!card3 && /重要/.test(card3.pri));

    /* ═══════ 9. 深色主题可读性 ═══════ */
    T.section('9. 深色主题下提醒面板文字可读');

    await cdp.eval('STORE.applyTheme("dark", false)');
    await sleep(600);
    T.eq('已切换到深色主题',
      await cdp.eval('document.documentElement.getAttribute("data-theme")'), 'dark');
    const badDark = await cdp.eval(darkTextCheck([
      '#noticeDock .nc-title', '#noticeDock .nc-body', '#noticeDock .nc-pri',
      '#noticeDock .nc-foot span', '#noticeDock .nc-hint',
    ]));
    T.ok('深色下面板文字亮度达标', Array.isArray(badDark) && badDark.length === 0, JSON.stringify(badDark));
    await cdp.shot('notice-01-student-dark');
    await cdp.eval('STORE.applyTheme("light", false)');
    await sleep(400);

    /* ═══════ 10. 管理员撤回 ═══════ */
    T.section('10. 管理员撤回后学生端立即消失');

    if (notice2Id) {
      const rd = await adminDelete(token, notice2Id);
      T.ok('管理员撤回提醒成功', rd && rd.ok === true, JSON.stringify(rd));
      await cdp.eval('window.NoticePanel.refresh()');
      await sleep(1200);
      T.ok('撤回后学生端不再显示该提醒', await cdp.eval(DOCK_HIDDEN) === true);
    } else {
      T.ok('管理员撤回提醒成功（未获取到 id，跳过）', false);
    }

    /* ═══════ 11. 管理端历史列表与撤回按钮 ═══════ */
    T.section('11. 管理端历史列表');

    await logout(cdp);
    await adminLogin(cdp);
    await cdp.eval(NAV_CLICK('notices'));
    await cdp.waitFor(sel('#noticeContent'), 25000, '提醒页（二次）');
    const rows = await cdp.eval('document.querySelectorAll("#view [data-notice-row]").length');
    T.ok('历史列表保留发送记录（含已撤回）：' + rows + ' 条', rows >= 1);
    T.ok('每条记录都有撤回按钮', await cdp.eval(sel('#view [data-notice-del]')) === true);
    await cdp.shot('notice-02-admin-list');

    /* ═══════ 12. 清理：删除本次测试产生的数据 ═══════ */
    T.section('12. 清理测试数据');

    const list = await (await fetch(BASE + '/api/admin/notices', {
      headers: { Authorization: 'Bearer ' + token },
    })).json();
    const mine = (list.items || []).filter((x) => String(x.content).indexOf('【E2E-' + STAMP + '】') === 0);
    for (const n of mine) { await adminDelete(token, n.id); }
    T.ok('已清理本次 E2E 提醒 ' + mine.length + ' 条', true);
  } catch (e) {
    T.fail++;
    T.failures.push('执行中断：' + (e && e.message));
    console.log('\n✖ 执行中断：' + (e && e.message));
    console.log('  最近 25 条接口记录：\n   ' + netlog.slice(-25).join('\n   '));
    try { await cdp.shot('notice-99-error'); } catch (e2) { /* 忽略 */ }
  } finally {
    console.log('\n════════════════════════════════════════');
    console.log('  通过 ' + T.pass + ' 项 · 失败 ' + T.fail + ' 项');
    if (T.fail) {
      console.log('\n  失败清单：');
      T.failures.forEach((f) => console.log('   ✗ ' + f));
    }
    console.log('════════════════════════════════════════');
    close();
    process.exit(T.fail ? 1 : 0);
  }
})();
