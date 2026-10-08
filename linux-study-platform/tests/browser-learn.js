'use strict';
/* ══════════════════════════════════════════════════════════════════
   融合后的学习视图端到端测试（零依赖，CDP 直连无头 Chrome）
   覆盖：单一登录入口 / 课程学习 / 命令大全 / 实用技巧 / 打卡回归 / 主题 / 移动端
   ──────────────────────────────────────────────────────────────────
   前置：
     1) MySQL 已导入 db/schema.sql + seed_accounts.sql + seed_content.sql
     2) 后端已启动（默认 http://127.0.0.1:3210）
   运行：
     node tests/browser-learn.js
   可选环境变量：BASE / CHROME / SHOTS / CDP_PORT
   ══════════════════════════════════════════════════════════════════ */

const path = require('path');
const mysql = require(path.join(__dirname, '..', 'server', 'node_modules', 'mysql2', 'promise'));
const {
  T, launch, sleep, sel, LAST_TOAST, LAST_M, LAST_M_CLICK,
  CLICK_ROLE, SUBMIT_LOGIN, openLogin,
} = require('./lib/cdp');

const BASE = process.env.BASE || 'http://127.0.0.1:3210';
const STUDENT = { u: 'student1', p: 'xiaoran2026' };
const DB = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3399),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'linux_study',
  dateStrings: true,
};

/** 测试用注册账号（§10 注册 / 忘记密码） */
const REG = {
  username: 'e2e' + Date.now().toString().slice(-6),
  password: 'e2e@2026abc',
  newPassword: 'e2e@2026xyz',
  phone: '137' + String(Date.now()).slice(-8),
};

let conn = null;

/** 从 DOM 读取当前图形验证码 token，再从库里取回答案 */
async function currentCaptcha(cdp) {
  let tok = '';
  for (let i = 0; i < 30 && !tok; i++) {
    tok = await cdp.eval(
      '(function(){var b=document.getElementById("capImg");return b?(b.getAttribute("data-token")||""):"";})()');
    if (!tok) await sleep(150);
  }
  let ans = null;
  for (let i = 0; i < 20 && !ans; i++) {
    const [rows] = await conn.execute('SELECT answer FROM captcha_codes WHERE token = ?', [tok]);
    ans = rows[0] ? rows[0].answer : null;
    if (!ans) await sleep(120);
  }
  return { token: tok, answer: ans };
}

/** 填指定表单的字段（含 input/change 事件） */
async function fillForm(cdp, formId, fields) {
  return cdp.eval(`(function(){
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

async function submitForm(cdp, formId) {
  return cdp.eval(`(function(){
    var f = document.getElementById(${JSON.stringify(formId)});
    if (!f) return false;
    f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    return true;
  })()`);
}

/** 从「…开发环境验证码：123456」里取出 6 位验证码
    （注意不能直接 match 第一个 6 位数字——手机号前缀也可能是 6 位） */
const DEV_CODE_RE = /开发环境验证码[：:]\s*(\d{6})/;

/** 等待 toast 出现并匹配正则；返回 toast 文本 */
async function waitToast(cdp, re, timeout, label) {
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < (timeout || 20000)) {
    last = String(await cdp.eval(LAST_TOAST) || '');
    if (re.test(last)) return last;
    await sleep(200);
  }
  return '(超时) ' + last + ' @' + (label || '');
}

/* ───────── 小工具 ───────── */

const txt = (css) => 'document.querySelector(' + JSON.stringify(css) + ').textContent.trim()';
const cnt = (css) => 'document.querySelectorAll(' + JSON.stringify(css) + ').length';
/** 计数比较必须拼成表达式：cnt() 返回的是字符串，不能直接与数字比较 */
const cntGt = (css, n) => cnt(css) + ' > ' + (n == null ? 0 : n);
const cntEq = (css, n) => cnt(css) + ' === ' + n;
const flat = '(function(){var v=document.getElementById("view");return v?v.textContent.replace(/\\s+/g," ").trim():"(无 #view)";})()';
const CLOSE_TOP_MODAL =
  '(function(){var m=document.querySelectorAll(".ui-modal");if(!m.length)return false;' +
  'var x=m[m.length-1].querySelector(".modal-head .icon-btn");if(x)x.click();return true;})()';
const THEME = 'document.documentElement.getAttribute("data-theme")';
/** 显式设置主题（headless Chrome 默认 prefers-color-scheme: dark，不能依赖初始状态） */
const setTheme = (t) =>
  '(function(){if(window.STORE&&window.STORE.theme!==' + JSON.stringify(t) + '){' +
  'window.STORE.applyTheme(' + JSON.stringify(t) + ',false,true);}})()';
/** 清空 toast，避免把上一步的提示误当成新提示 */
const CLEAR_TOASTS = '(function(){var b=document.getElementById("toasts");if(b)b.innerHTML="";return true;})()';

async function gotoView(cdp, key, expectRe) {
  await cdp.eval('(function(){var n=document.querySelector(\'#nav [data-nav="' + key + '"]\');if(n)n.click();})()');
  try {
    await cdp.waitFor(sel('#view .page-head h2'), 25000, '视图 ' + key);
  } catch (e) {
    const dump = await cdp.eval(flat);
    T.ok('视图 ' + key + ' 渲染成功（实际内容：' + String(dump).slice(0, 220) + '）', false);
    return false;
  }
  const title = await cdp.eval(txt('#view .page-head h2'));
  T.ok('视图 ' + key + ' 渲染成功：' + title, !expectRe || expectRe.test(title));
  return true;
}

async function login(cdp) {
  await cdp.waitFor('document.getElementById("loginPage") && !document.getElementById("loginPage").hidden', 25000, '登录页可见');
  await cdp.waitFor('!!document.getElementById("btnStudentLogin")', 20000, '身份网关已渲染');
  await openLogin(cdp, 'student');
  await cdp.eval(SUBMIT_LOGIN(STUDENT.u, STUDENT.p));
  await cdp.waitFor('document.getElementById("app") && !document.getElementById("app").hidden', 30000, '进入主应用');
  await cdp.waitFor(sel('#nav .nav-item'), 15000, '导航渲染');
  await sleep(500);
}

(async () => {
  try { conn = await mysql.createConnection(DB); } catch (e) { conn = null; }
  const { cdp, close } = await launch({ port: Number(process.env.CDP_PORT || 9337) });

  /* 采集页面脚本异常 / console.error —— 融合后任何一处引用错误都会在这里暴露 */
  const pageErrors = [];
  cdp.on(function (msg) {
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params && msg.params.exceptionDetails;
      pageErrors.push('exception: ' + ((d && d.text) || ''));
    } else if (msg.method === 'Log.entryAdded') {
      const e = msg.params && msg.params.entry;
      if (e && e.level === 'error') pageErrors.push('log: ' + String(e.text).slice(0, 160));
    }
  });

  try {
    /* ══════════ 1. 单一登录入口 ══════════ */
    T.section('1. 单一登录入口（打卡平台与学习平台已合并）');

    await cdp.send('Page.navigate', { url: BASE + '/' });
    await sleep(1500);

    const htmlLen = await cdp.eval('document.documentElement.outerHTML.length');
    T.ok('页面已载入（HTML 长度 ' + htmlLen + '）', htmlLen > 3000);

    const externals = await cdp.eval(
      '(function(){var out=[];document.querySelectorAll("a[href]").forEach(function(a){' +
      'var h=a.getAttribute("href")||"";if(h.indexOf("learn")>=0)out.push(h);});return out;})()');
    T.eq('页面内无 ../learn/ 外链残留', JSON.stringify(externals), '[]');

    const scripts = await cdp.eval(
      '(function(){var s=[];document.querySelectorAll("script[src]").forEach(function(x){s.push(x.getAttribute("src"));});return s;})()');
    T.ok('已加载 views/learn.js', scripts.indexOf('js/views/learn.js') >= 0, JSON.stringify(scripts));
    T.ok('已加载 css/learn.css', await cdp.eval(
      '(function(){var s=false;document.querySelectorAll("link[rel=stylesheet]").forEach(function(x){' +
      'if((x.getAttribute("href")||"").indexOf("learn.css")>=0)s=true;});return s;})()'));

    /* ── 单一登录窗口：一张网关卡 + 两个身份按钮，点按钮才弹出对应登录窗 ── */
    T.ok('登录页只有一张登录窗口（#loginGate）',
      await cdp.eval('document.querySelectorAll("#loginPage .login-gate").length===1'));
    T.ok('未点按钮时不出现账号 / 密码输入框',
      await cdp.eval('!document.getElementById("loginUser")'));
    T.ok('网关含「学生登录」按钮', await cdp.eval('!!document.getElementById("btnStudentLogin")'));
    T.ok('网关含「管理员登录」按钮', await cdp.eval('!!document.getElementById("btnAdminLogin")'));
    const roleTxt = await cdp.eval(
      '(function(){var a=[];document.querySelectorAll("#loginGate .role-card").forEach(function(b){' +
      'a.push(b.textContent.replace(/\\s+/g," ").trim());});return a;})()');
    T.ok('身份按钮文案：' + JSON.stringify(roleTxt),
      /学生登录/.test(roleTxt[0] || '') && /管理员登录/.test(roleTxt[1] || ''));
    T.ok('已移除旧的 seg 分段控件',
      await cdp.eval('document.querySelectorAll("#loginPage .seg-btn").length===0'));

    const modalTitle = '(function(){var m=document.querySelectorAll(".ui-modal");' +
      'return m.length?m[m.length-1].querySelector(".modal-head h3").textContent.trim():"(无弹窗)";})()';

    await openLogin(cdp, 'student');
    T.ok('点击「学生登录」弹出登录窗', await cdp.eval('document.querySelectorAll(".ui-modal").length>0'));
    T.ok('登录窗含账号 / 密码 / 提交按钮', await cdp.eval(
      '!!(document.getElementById("loginUser")&&document.getElementById("loginPass")&&document.getElementById("loginBtn"))'));
    T.eq('学生登录窗标题', await cdp.eval(modalTitle), '学生登录');
    T.eq('学生登录窗按钮文案', await cdp.eval(
      '(function(){var b=document.getElementById("loginBtn");return b?b.textContent.trim():"";})()'), '进入学习');
    T.ok('登录窗含「记住账号」', await cdp.eval('!!document.getElementById("loginRemember")'));
    T.ok('登录窗含密码明文切换按钮', await cdp.eval('!!document.getElementById("loginEye")'));
    await cdp.shot('L0-login-window');

    await cdp.eval(CLOSE_TOP_MODAL);
    await sleep(450);
    T.ok('登录窗可关闭', await cdp.eval('document.querySelectorAll(".ui-modal").length===0'));

    await openLogin(cdp, 'admin');
    T.eq('点击「管理员登录」弹出管理员窗', await cdp.eval(modalTitle), '管理员登录');
    T.eq('管理员登录窗按钮文案', await cdp.eval(
      '(function(){var b=document.getElementById("loginBtn");return b?b.textContent.trim():"";})()'), '进入管理后台');

    // 窗内「换个身份」
    await cdp.eval(
      '(function(){var b=document.getElementById("loginSwitch");if(!b)return false;b.click();return true;})()');
    await sleep(600);
    T.eq('窗内「换个身份」切回学生登录', await cdp.eval(modalTitle), '学生登录');

    await cdp.eval(CLOSE_TOP_MODAL);
    await sleep(450);

    await login(cdp);
    T.ok('student1（永久会员）登录成功', await cdp.eval(
      '!!document.getElementById("app") && !document.getElementById("app").hidden'));
    T.ok('登录成功后登录窗已关闭（不遮挡主界面）',
      await cdp.eval('document.querySelectorAll(".ui-modal").length===0'));

    // headless Chrome 默认深色偏好，先固定为浅色，保证截图命名与实际一致
    await cdp.eval(setTheme('light'));
    await sleep(600);
    T.eq('已固定为浅色主题', await cdp.eval(THEME), 'light');

    /* ══════════ 2. 侧栏导航并集 ══════════ */
    T.section('2. 侧栏导航：学习 + 练习 + 互动 + 设置');

    const navKeys = await cdp.eval(
      '(function(){var o=[];document.querySelectorAll("#nav [data-nav]").forEach(function(b){o.push(b.dataset.nav);});return o;})()');
    const NAV = ['dashboard', 'course', 'cmds', 'tips', 'catalog', 'records', 'exercises', 'messages', 'profile'];
    T.eq('导航项数量', navKeys.length, NAV.length);
    T.ok('含用户点名要求的六项：我的学习 / 学习目录 / 我的打卡 / 练习题 / 老师督促 / 我的资料',
      ['dashboard', 'catalog', 'records', 'exercises', 'messages', 'profile'].every(function (k) {
        return navKeys.indexOf(k) >= 0;
      }), JSON.stringify(navKeys));
    T.ok('并入学习平台内容：课程学习 / 命令大全 / 实用技巧',
      ['course', 'cmds', 'tips'].every(function (k) { return navKeys.indexOf(k) >= 0; }));

    const navGroups = await cdp.eval(
      '(function(){var o=[];document.querySelectorAll("#nav .nav-group").forEach(function(n){o.push(n.textContent.trim());});return o;})()');
    T.ok('导航分组：' + navGroups.join(' / '), navGroups.length >= 3);

    /* ══════════ 3. 课程学习 ══════════ */
    T.section('3. 课程学习（31 讲教程）');

    if (await gotoView(cdp, 'course', /课程学习/)) {
      T.eq('课程分组数（应为 8 组）', await cdp.eval(cnt('#view .lv-groups > section.panel')), 8);
      T.eq('教程条目数（应为 31 讲）', await cdp.eval(cnt('#view .lv-tut')), 31);

      const progress = await cdp.eval(
        'document.querySelector("#view .stats-grid .stat-card .s-num").textContent.trim()');
      T.ok('课程总进度卡片：' + progress, /%/.test(progress));

      await cdp.shot('L1-course-list-light');

      // 打开第一讲
      await cdp.eval('(function(){document.querySelector("#view [data-lv-tut]").click();})()');
      await cdp.waitFor(sel('#view .lv-art .art'), 25000, '教程正文渲染');

      const tTitle = await cdp.eval(txt('#view .page-head h2'));
      T.ok('教程阅读器标题：' + tTitle, /教程|Linux/i.test(tTitle));
      T.ok('展示「本讲目录」', await cdp.eval(sel('#view .lv-toc')));

      const hN = await cdp.eval(cnt('#view .lv-art .blk-h'));
      const pN = await cdp.eval(cnt('#view .lv-art .content-body p'));
      T.ok('渲染章节小标题 ' + hN + ' 个', hN >= 1);
      T.ok('正文段落可见 ' + pN + ' 段（连续正文已合并成文章）', pN > 3);

      const crumbs = await cdp.eval(txt('#view .lv-crumbs'));
      T.ok('面包屑：' + crumbs.replace(/\s+/g, ' ').slice(0, 60), /课程学习/.test(crumbs));

      const footBtns = await cdp.eval(cnt('#view .lv-foot .btn'));
      T.ok('阅读底栏含打卡与上下讲按钮（' + footBtns + ' 个）', footBtns >= 2);

      await cdp.shot('L2-course-reader-light');

      // 打卡 / 撤销
      if (await cdp.eval(sel('#view [data-lv-ck]'))) {
        await cdp.eval(CLEAR_TOASTS);
        await cdp.eval('(function(){document.querySelector("#view [data-lv-ck]").click();})()');
        try {
          await cdp.waitFor('(function(){return /打卡/.test(' + LAST_TOAST + ');})()', 15000, '打卡提示');
          T.ok('本讲打卡提示：' + (await cdp.eval(LAST_TOAST)).slice(0, 40), true);
        } catch (e) {
          T.ok('本讲打卡提示', false, await cdp.eval(LAST_TOAST));
        }
        await sleep(1400);
        T.ok('打卡后按钮变为「撤销本讲打卡」', await cdp.eval(sel('#view [data-lv-rv]')));
        T.ok('打卡后顶部出现「已打卡」标记', await cdp.eval(
          '(function(){return /已打卡/.test(document.querySelector("#view .chips-row").textContent);})()'));
      } else {
        T.ok('本讲此前已打卡（自动跳过打卡动作）', await cdp.eval(sel('#view .lv-foot')));
      }

      // 返回目录
      await cdp.eval('(function(){document.querySelector("#view [data-lv-tutback]").click();})()');
      await cdp.waitFor(sel('#view .lv-groups'), 20000, '返回课程列表');
      T.ok('「返回目录」可回到课程列表', await cdp.eval(cntGt('#view .lv-tut')));
    }

    /* ══════════ 4. 命令大全 ══════════ */
    T.section('4. 命令大全（441 条 / 11 分类）');

    if (await gotoView(cdp, 'cmds', /命令大全/)) {
      T.eq('分类标签数（全部 + 11 类）', await cdp.eval(cnt('#view .lv-cat')), 12);
      T.eq('首页表格行数（每页 60）', await cdp.eval(cnt('#view .lv-cmdtbl tbody tr')), 60);

      const total = await cdp.eval(
        'document.querySelectorAll("#view .stats-grid .stat-card .s-num")[0].textContent.trim()');
      T.ok('命令总数显示：' + total, /44[01]/.test(String(total).replace(/,/g, '')));

      await cdp.shot('L3-cmds-light');

      // 切换分类
      await cdp.eval('(function(){document.querySelectorAll("#view .lv-cat")[1].click();})()');
      await sleep(600);
      T.ok('切换分类后表格重绘（' + (await cdp.eval(cnt('#view .lv-cmdtbl tbody tr'))) + ' 行）',
        (await cdp.eval(cnt('#view .lv-cmdtbl tbody tr'))) > 0);
      T.ok('分类切换后 pills 高亮更新', await cdp.eval(
        'document.querySelectorAll("#view .lv-cat")[1].classList.contains("on")'));
      const hit = await cdp.eval('document.querySelector("#view [data-lv-count]").textContent');
      T.ok('命中数提示：' + hit.trim(), /命中/.test(hit));

      // 回全部 + 搜索
      await cdp.eval('(function(){document.querySelectorAll("#view .lv-cat")[0].click();})()');
      await sleep(500);
      await cdp.eval(
        '(function(){var i=document.querySelector("#view [data-lv-q]");' +
        'i.value="chmod";i.dispatchEvent(new Event("input",{bubbles:true}));})()');
      await sleep(800);
      const sRows = await cdp.eval(cnt('#view .lv-cmdtbl tbody tr'));
      T.ok('搜索 chmod 命中 ' + sRows + ' 条（跨页搜索）', sRows >= 1 && sRows < 60);
      const names = await cdp.eval(
        '(function(){var o=[];document.querySelectorAll("#view .lv-cmdname").forEach(function(b){o.push(b.textContent.trim());});return o.join(",");})()');
      T.ok('命中内容与 chmod 相关：' + String(names).slice(0, 60), /chmod/i.test(names));

      await cdp.eval('(function(){document.querySelector("#view [data-lv-qclear]").click();})()');
      await sleep(700);

      // 分页
      await cdp.eval(
        '(function(){var b=document.querySelectorAll("#view [data-lv-page]");' +
        'for(var i=0;i<b.length;i++){if(b[i].textContent.trim()==="2"){b[i].click();break;}}})()');
      await sleep(700);
      T.ok('翻到第 2 页仍有数据（' + (await cdp.eval(cnt('#view .lv-cmdtbl tbody tr'))) + ' 行）',
        (await cdp.eval(cnt('#view .lv-cmdtbl tbody tr'))) > 0);
      T.ok('分页器高亮第 2 页', await cdp.eval(
        '(function(){var n=document.querySelector("#view .lv-pager .pg-btn.on");return !!n&&n.textContent.trim()==="2";})()'));

      // 命令详情
      await cdp.eval('(function(){document.querySelector("#view .lv-cmdname").click();})()');
      await cdp.waitFor('document.querySelectorAll(".ui-modal").length>0', 20000, '详情弹层');
      await cdp.waitFor(
        '(function(){var m=document.querySelectorAll(".ui-modal");' +
        'return m.length>0&&/语法|简介|实例|参数/.test(m[m.length-1].textContent);})()', 20000, '详情内容');

      const mTxt = await cdp.eval(LAST_M('m.textContent.replace(/\\s+/g," ")'));
      T.ok('详情含「语法 / 实例 / 参数」之一', /语法|实例|参数/.test(mTxt));
      const mSecs = await cdp.eval(LAST_M('m.querySelectorAll(".card-sect").length'));
      T.ok('详情分节数 ' + mSecs + '（简介 / 语法 / 参数 / 实例 / 打卡）', mSecs >= 2);
      T.ok('详情内含代码块', await cdp.eval(LAST_M('m.querySelectorAll(".code").length>0')));

      await cdp.shot('L4-cmd-detail-light');

      // 复制按钮：复制由 ui.js 的全局处理器接管，反馈是按钮文案变化（与全站一致）
      // 注意 LAST_M(inner) 会把 inner 包进 return (...)，inner 必须是「表达式」，
      // 语句要再包一层 IIFE。
      const copyBtnOf = 'var b=m.querySelector(".code .c-copy");return b?b.textContent:"";';
      const copyBtn0 = await cdp.eval(LAST_M('(function(){' + copyBtnOf + '})()'));
      const clickedCopy = await cdp.eval(LAST_M_CLICK('.code .c-copy'));
      T.ok('点击详情内「复制」按钮', clickedCopy === true);
      await sleep(500);
      const copyBtn1 = await cdp.eval(LAST_M('(function(){' + copyBtnOf + '})()'));
      T.ok('复制反馈：' + JSON.stringify(copyBtn0) + ' → ' + JSON.stringify(copyBtn1),
        copyBtn0 === '复制' && /已复制/.test(copyBtn1));

      await cdp.eval(CLOSE_TOP_MODAL);
      await sleep(500);
      T.ok('弹层已关闭', await cdp.eval('document.querySelectorAll(".ui-modal").length===0'));
    }

    /* ══════════ 5. 实用技巧 ══════════ */
    T.section('5. 实用技巧（12 条）');

    if (await gotoView(cdp, 'tips', /实用技巧/)) {
      T.eq('技巧卡片数（应为 12）', await cdp.eval(cnt('#view .lv-tip')), 12);
      T.ok('含可复制命令的卡片 ' + (await cdp.eval(cnt('#view .lv-tip .lt-code'))) + ' 条',
        (await cdp.eval(cnt('#view .lv-tip .lt-code'))) >= 10);

      await cdp.shot('L5-tips-light');

      await cdp.eval('(function(){document.querySelector("#view [data-lv-cp]").click();})()');
      await sleep(700);
      const t1 = await cdp.eval(LAST_TOAST);
      T.ok('技巧命令复制提示：' + t1.slice(0, 26), /复制/.test(t1));

      await cdp.eval('(function(){document.querySelector("#view [data-lv-cmd]").click();})()');
      await cdp.waitFor('document.querySelectorAll(".ui-modal").length>0', 20000, '技巧详情弹层');
      await sleep(600);
      T.ok('技巧详情弹层已打开', await cdp.eval('document.querySelectorAll(".ui-modal").length>0'));
      await cdp.eval(CLOSE_TOP_MODAL);
      await sleep(500);

      await cdp.eval(
        '(function(){var i=document.querySelector("#view [data-lv-tq]");' +
        'i.value="date";i.dispatchEvent(new Event("input",{bubbles:true}));})()');
      await sleep(700);
      const fN = await cdp.eval(cnt('#view .lv-tip'));
      T.ok('技巧搜索 date 命中 ' + fN + ' 条', fN >= 1 && fN < 12);
      await cdp.eval('(function(){document.querySelector("#view [data-lv-tqclear]").click();})()');
      await sleep(500);
      T.eq('清空后恢复 12 条', await cdp.eval(cnt('#view .lv-tip')), 12);
    }

    /* ══════════ 6. 既有功能回归 ══════════ */
    T.section('6. 既有打卡功能回归');

    if (await gotoView(cdp, 'catalog', /学习目录/)) {
      const treeN = await cdp.eval(cnt('#view .tree-node'));
      T.ok('学习目录树仍有节点（' + treeN + ' 个）', treeN > 0);
      await cdp.shot('L6-catalog-light');
    }
    if (await gotoView(cdp, 'records', /我的打卡/)) {
      T.ok('我的打卡页可用', await cdp.eval(sel('#view .mem-strip')));
    }
    if (await gotoView(cdp, 'dashboard', /我的学习|今天也要加油/)) {
      T.ok('我的学习页可用', await cdp.eval(sel('#view .stats-grid')));
    }
    if (await gotoView(cdp, 'exercises', /练习/)) {
      T.ok('练习题页可用', await cdp.eval('document.getElementById("view").textContent.length>10'));
    }
    if (await gotoView(cdp, 'messages', /老师督促/)) {
      T.ok('老师督促页可用', await cdp.eval('document.getElementById("view").textContent.length>10'));
    }

    /* ══════════ 7. 深色主题 ══════════ */
    T.section('7. 深色主题下的学习视图');

    // 先验证主题按钮真的能切换（不假设初始是浅色：headless Chrome 默认深色偏好）
    const th0 = await cdp.eval(THEME);
    await cdp.eval('(function(){var b=document.getElementById("themeFab");if(b)b.click();})()');
    await sleep(1000);
    const th1 = await cdp.eval(THEME);
    T.ok('主题按钮可切换（' + th0 + ' → ' + th1 + '）', th0 !== th1);

    await cdp.eval(setTheme('dark'));
    await sleep(800);
    T.eq('已固定为深色主题', await cdp.eval(THEME), 'dark');

    if (await gotoView(cdp, 'course', /课程学习/)) {
      await cdp.waitFor(sel('#view .lv-tut'), 20000, '课程列表（深色）');
      await cdp.shot('L7-course-dark');
    }
    if (await gotoView(cdp, 'cmds', /命令大全/)) {
      await cdp.waitFor(sel('#view .lv-cmdtbl tbody tr'), 20000, '命令表格（深色）');
      await cdp.shot('L8-cmds-dark');
    }
    if (await gotoView(cdp, 'tips', /实用技巧/)) {
      await cdp.waitFor(sel('#view .lv-tip'), 20000, '技巧卡片（深色）');
      await cdp.shot('L9-tips-dark');
    }

    await cdp.eval(setTheme('light'));
    await sleep(800);
    T.eq('切回浅色主题', await cdp.eval(THEME), 'light');

    /* ══════════ 8. 移动端 ══════════ */
    T.section('8. 移动端 375px');

    await cdp.resize(375, 812);

    if (await gotoView(cdp, 'course', /课程学习/)) {
      await cdp.waitFor(sel('#view .lv-tut'), 20000, '课程列表（移动端）');
      const ovf1 = await cdp.eval(
        'document.documentElement.scrollWidth - document.documentElement.clientWidth');
      T.ok('课程页无横向溢出（overflow=' + ovf1 + 'px）', ovf1 <= 2);
      await cdp.shot('L10-course-mobile');
    }

    if (await gotoView(cdp, 'cmds', /命令大全/)) {
      await cdp.waitFor(sel('#view .lv-cmdtbl'), 20000, '命令表格（移动端）');
      T.ok('宽表格走容器内横向滚动而非撑破页面', await cdp.eval(
        '(function(){var w=document.querySelector("#view .tbl-wrap");return !!w&&w.scrollWidth>=w.clientWidth;})()'));
      const ovf2 = await cdp.eval(
        'document.documentElement.scrollWidth - document.documentElement.clientWidth');
      T.ok('命令页无横向溢出（overflow=' + ovf2 + 'px）', ovf2 <= 2);
      await cdp.shot('L11-cmds-mobile');
    }

    if (await gotoView(cdp, 'tips', /实用技巧/)) {
      await cdp.waitFor(sel('#view .lv-tip'), 20000, '技巧卡片（移动端）');
      await cdp.shot('L12-tips-mobile');
    }

    await cdp.resize(1440, 900);
    await sleep(500);

    /* ══════════ 9. 登录窗内的注册 / 忘记密码 ══════════ */
    T.section('9. 同一登录窗内的「注册账号 / 忘记密码」自助入口');

    // 退出登录 → 回到身份网关
    await cdp.eval('document.getElementById("userBtn").click()');
    await sleep(260);
    await cdp.eval('document.querySelector(\'#userPop [data-act="logout"]\').click()');
    await cdp.waitFor('.ui-modal [data-act="yes"]', 15000, '退出确认');
    await cdp.eval(LAST_M_CLICK('[data-act="yes"]'));
    await cdp.waitFor('document.getElementById("loginPage") && !document.getElementById("loginPage").hidden', 20000, '回到登录页');
    await cdp.waitFor('document.querySelectorAll(".ui-modal").length === 0', 6000, '弹层关闭');
    T.ok('退出后回到唯一登录窗口', await cdp.eval('!!document.getElementById("btnStudentLogin")'));

    await openLogin(cdp, 'student');
    const tabs = await cdp.eval(
      '(function(){var a=[];document.querySelectorAll(".lgm-tabs .ltab").forEach(function(b){a.push(b.dataset.tab);});return a;})()');
    T.eq('登录窗内三个页签', JSON.stringify(tabs), JSON.stringify(['login', 'register', 'forgot']));

    await cdp.eval('document.querySelector(\'.lgm-tabs .ltab[data-tab="register"]\').click()');
    await cdp.waitFor('!!document.getElementById("regForm")', 15000, '注册表单');
    await sleep(300);
    const regFields = await cdp.eval(
      '(function(){var a=[];document.querySelectorAll("#regForm [name]").forEach(function(n){a.push(n.name);});return a.join(",");})()');
    T.ok('注册表单字段齐全：' + regFields,
      ['username', 'password', 'password2', 'phone', 'smsCode', 'captcha'].every(function (k) {
        return regFields.indexOf(k) >= 0;
      }));
    T.ok('注册表单含图形验证码图片', await cdp.eval('!!document.querySelector("#capImg svg")'));

    const regCap1 = await currentCaptcha(cdp);
    T.ok('图形验证码已生成且可在服务端核验', !!regCap1.token && !!regCap1.answer);

    await fillForm(cdp, 'regForm', {
      username: REG.username, password: REG.password, password2: REG.password,
      phone: REG.phone, captcha: regCap1.answer,
    });
    await cdp.eval(CLEAR_TOASTS);
    await cdp.eval('document.getElementById("smsBtn").click()');
    const smsToast = await waitToast(cdp, /开发环境验证码/, 20000, '短信下发');
    const devCode = (String(smsToast).match(DEV_CODE_RE) || [])[1];
    T.ok('短信验证码已下发并回显开发验证码：' + devCode + '（toast：' + String(smsToast).slice(0, 46) + '）',
      !!devCode);
    await sleep(400);

    /* 后端回传的验证码：9 秒后常驻显示在输入框下方，并自动代填 */
    T.ok('获取验证码前提示框不显示',
      await cdp.eval('(function(){var b=document.getElementById("devSmsBox");return !!b && b.style.display==="none";})()') === true);
    await cdp.waitFor('(function(){var b=document.getElementById("devSmsBox");return !!b && b.style.display!=="none";})()',
      15000, '9 秒后显示验证码提示框');
    const devBox = await cdp.eval(
      '(function(){var b=document.getElementById("devSmsBox"),c=document.getElementById("devSmsCode");' +
      'return {text:b?b.textContent.replace(/\\s+/g," ").trim():"",code:c?c.textContent.trim():"",' +
      'filled:(document.querySelector(\'#regForm [name="smsCode"]\')||{}).value||""};})()');
    T.ok('9 秒后页面下方显示「你的验证码：xxxxxx，请注意查收！」：' + devBox.text,
      /你的验证码：\d{6}，请注意查收！/.test(devBox.text));
    T.eq('提示框里的验证码与下发的一致', devBox.code, devCode);
    T.eq('验证码已自动代填进输入框', devBox.filled, devCode);

    const regCap2 = await currentCaptcha(cdp);
    await fillForm(cdp, 'regForm', { captcha: regCap2.answer, smsCode: devCode });
    await cdp.eval(CLEAR_TOASTS);
    await submitForm(cdp, 'regForm');
    const regToast = await waitToast(cdp, /注册成功|失败|不正确|已过期|已被/, 25000, '注册提交');
    T.ok('注册成功提示：' + String(regToast).slice(0, 30), /注册成功/.test(regToast));
    await sleep(500);
    T.ok('注册后自动回到「登录」页签', await cdp.eval('!!document.getElementById("loginForm")'));
    T.eq('注册后用户名已预填到登录框',
      await cdp.eval('(function(){var u=document.getElementById("loginUser");return u?u.value:"";})()'), REG.username);

    /* 普通会员登录打卡平台 → 窗内逐字拒绝文案 */
    await fillForm(cdp, 'loginForm', { password: REG.password });
    await submitForm(cdp, 'loginForm');
    await cdp.waitFor(
      '(function(){var e=document.getElementById("loginErr");return !!(e&&!e.hidden&&e.textContent.length>10);})()',
      20000, '普通会员被拒');
    const needMember = await cdp.eval(
      '(function(){var e=document.getElementById("loginErr");return e?String(e.textContent).trim():"";})()');
    T.eq('普通会员被拒文案逐字一致', needMember,
      '你还未开通会员，无法使用打卡平台，请联系管理员开通会员后再使用！');
    T.ok('被拒时仍停留在登录窗（未进入应用）',
      await cdp.eval('!!document.getElementById("app").hidden'));

    /* 忘记密码：重置为新密码 */
    await cdp.eval('document.querySelector(\'.lgm-tabs .ltab[data-tab="forgot"]\').click()');
    await cdp.waitFor('!!document.getElementById("forgotForm")', 15000, '忘记密码表单');
    await sleep(300);
    const fgCap1 = await currentCaptcha(cdp);
    await fillForm(cdp, 'forgotForm', {
      phone: REG.phone, newPassword: REG.newPassword, newPassword2: REG.newPassword,
      captcha: fgCap1.answer,
    });
    await cdp.eval(CLEAR_TOASTS);
    await cdp.eval('document.getElementById("smsBtn").click()');
    const smsToast2 = await waitToast(cdp, /开发环境验证码/, 20000, '重置短信下发');
    const devCode2 = (String(smsToast2).match(DEV_CODE_RE) || [])[1];
    T.ok('重置密码短信已下发：' + devCode2, !!devCode2);
    await sleep(400);
    T.ok('忘记密码页同样显示验证码提示框',
      await cdp.waitFor('(function(){var b=document.getElementById("devSmsBox");return !!b && b.style.display!=="none";})()',
        15000, '重置页 9 秒后显示').then(() => true).catch(() => false) === true);

    const fgCap2 = await currentCaptcha(cdp);
    await fillForm(cdp, 'forgotForm', { captcha: fgCap2.answer, smsCode: devCode2 });
    await submitForm(cdp, 'forgotForm');
    const resetToast = await waitToast(cdp, /重置成功|密码已重置/, 25000, '重置提交');
    T.ok('重置密码成功提示：' + String(resetToast).slice(0, 30), /重置|成功/.test(resetToast));
    await sleep(500);

    /* 新密码可登录（仍为普通会员 → 依旧被打卡平台拒绝，说明密码校验已通过） */
    await cdp.waitFor('!!document.getElementById("loginForm")', 15000, '回到登录表单');
    await fillForm(cdp, 'loginForm', { username: REG.username, password: REG.newPassword });
    await submitForm(cdp, 'loginForm');
    await cdp.waitFor(
      '(function(){var e=document.getElementById("loginErr");return !!(e&&!e.hidden&&e.textContent.length>10);})()',
      25000, '新密码登录结果');
    const afterReset = await cdp.eval(
      '(function(){var e=document.getElementById("loginErr");return e?String(e.textContent).trim():"";})()');
    T.ok('新密码校验通过（不是「账号或密码不正确」）：' + afterReset.slice(0, 24),
      afterReset.indexOf('账号或密码不正确') < 0);
    T.eq('重置后新密码可登录（仅剩会员门禁拦截）', afterReset,
      '你还未开通会员，无法使用打卡平台，请联系管理员开通会员后再使用！');

    /* 清理测试账号 */
    if (conn) {
      await conn.execute('DELETE FROM students WHERE username = ?', [REG.username]);
      T.ok('注册流程产生的测试账号已清理', true);
    }

    /* ══════════ 10. 控制台异常 ══════════ */
    T.section('10. 页面异常检查');
    const real = pageErrors.filter(function (x) {
      return !/favicon|net::ERR|status of 4\d\d|status of 5\d\d|\b404\b/i.test(x);
    });
    T.ok('页面脚本无未捕获异常（采集 ' + real.length + ' 条）', real.length === 0,
      real.slice(0, 4).join(' | '));
  } catch (e) {
    console.error('\n✖ 测试中断：' + e.message);
    T.fail++;
    T.failures.push('中断：' + e.message);
  } finally {
    if (conn) { try { await conn.end(); } catch (e) { /* 忽略 */ } }
    close();
  }

  console.log('\n════════════════════════════════════');
  console.log('  通过 ' + T.pass + ' 项，失败 ' + T.fail + ' 项');
  if (T.failures.length) {
    console.log('\n失败明细：');
    T.failures.forEach(function (f) { console.log('  · ' + f); });
  }
  console.log('════════════════════════════════════');
  process.exit(T.fail ? 1 : 0);
})();
