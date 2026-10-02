'use strict';
/**
 * 学习平台构建脚本
 * ─────────────────────────────────────────────────────────────────────
 * 把用户提供的单文件学习平台（study_linux.html）与后端桥接层（learn/bridge.*）
 * 合成最终的 learn/index.html。
 *
 * 做法：不改写原应用的任何渲染逻辑，只做 9 处「注入式补丁」——
 *   ① <head> 引入 bridge.css 与防闪烁主题引导
 *   ② 原应用尾部暴露 window.__lcb 钩子（数据 + 渲染 + 工具函数）
 *   ③ render() 末尾回调桥接层（用于整页锁定 / 会员横幅 / 打卡栏显隐）
 *   ④ navItem() 输出 🔒 锁标记
 *   ⑤⑥⑦ buildNav() 三个分组标题输出 🔒
 *   ⑧ submitCheckin() 前置钩子（改走服务器）
 *   ⑨ 撤销打卡 / 三格式导出按钮前置钩子
 *   ⑩ 页脚与侧栏文案改为「已同步服务器」
 *   ⑪ </body> 前引入 bridge.js
 *
 * 任一补丁未命中会立即报错，避免原文件更新后静默失效。
 *
 * 用法：node tools/build-learn.js [源文件路径] [输出路径]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = process.argv[2] || 'C:/Users/Ran/Downloads/linux-study-platform/study_linux.html';
const OUT = process.argv[3] || path.join(ROOT, 'learn', 'index.html');

/* ── 补丁表 ── */
const PATCHES = [
  {
    name: '① head 引入桥接样式与主题引导',
    from: '</style>\n</head>',
    to: '</style>\n' +
      '<link rel="stylesheet" href="./bridge.css">\n' +
      '<script>/* 主题引导：避免浅色用户看到深色闪屏 */\n' +
      '(function(){try{var t=localStorage.getItem("wb.theme");' +
      'if(t==="light")document.documentElement.setAttribute("data-theme","light");}catch(e){}})();</script>\n' +
      '</head>',
  },

  {
    name: '② 暴露 window.__lcb 钩子',
    from: '  crc32: crc32\n};\n\n})();',
    to: '  crc32: crc32\n};\n\n' +
      '/* ═══ 后端桥接钩子（由 learn/bridge.js 使用）═══\n' +
      '   只暴露必要的数据与能力，不改变原有任何行为 */\n' +
      'window.__lcb = {\n' +
      '  /* 数据快照 */\n' +
      '  tutorials: TUTS, commands: CMDS, tips: TIPS, groups: GROUPS,\n' +
      '  tutorialIndex: TUT_INDEX, commandIndex: CMD_INDEX, tipIndex: TIP_INDEX,\n' +
      '  unitMap: UNIT_MAP, allUnits: UNITS,\n' +
      '  /* 本地存储读写 */\n' +
      '  reload: function(){ store = loadStore(); },\n' +
      '  replaceAll: function(recs){ store.records = recs || {}; saveStore(); },\n' +
      '  setRecord: function(id, d){ store.records[id] = {d:d, ts:Date.now()}; saveStore(); },\n' +
      '  delRecord: function(id){ delete store.records[id]; saveStore(); },\n' +
      '  snapshot: function(){ return {total:TOTAL, done:doneCount()}; },\n' +
      '  /* 视图 */\n' +
      '  render: render, curView: function(){ return curView; },\n' +
      '  go: go, toast: toast, today: todayStr, fmtCn: fmtCn,\n' +
      '  openCmd: openCmd, closeModal: closeModal,\n' +
      '  /* 桥接层注册的回调（默认为空 = 保持纯本地行为） */\n' +
      '  hooks: { locked:null, groupLocked:null, blocked:null, submit:null, revoke:null, export:null, afterRender:null }\n' +
      '};\n\n})();',
  },

  {
    name: '③ render() 末尾回调桥接层',
    from: '  if(afterRender){ try{ afterRender(); }catch(e){} afterRender = null; }\n' +
      '  if(window.innerWidth<=900) closeMobile();',
    to: '  if(afterRender){ try{ afterRender(); }catch(e){} afterRender = null; }\n' +
      '  if(window.__lcb && window.__lcb.hooks.afterRender){ try{ window.__lcb.hooks.afterRender(); }catch(e){} }\n' +
      '  if(window.innerWidth<=900) closeMobile();',
  },

  {
    name: '④ navItem() 输出 🔒 锁标记',
    from: "  if(unitId && isDone(unitId)) done = true;\n" +
      "  return '<button class=\"nav-item'+(on?' on':'')+(done?' done':'')+'\" type=\"button\" data-go=\"'+esc(path)+\n" +
      "    '\" data-srch=\"'+esc((searchKey||label).toLowerCase())+'\">'+\n" +
      "    '<span class=\"ni-ico\">'+ico+'</span><span class=\"ni-t\">'+esc(label)+'</span>'+\n" +
      "    (count!==''&&count!=null?'<span class=\"ni-b\">'+count+'</span>':'')+'</button>';",
    to: "  if(unitId && isDone(unitId)) done = true;\n" +
      "  /* 后端桥接：未开通超级会员时，锁定的小节标题后追加 🔒 */\n" +
      "  var lk = (window.__lcb && window.__lcb.hooks.locked && unitId) ? window.__lcb.hooks.locked(unitId) : false;\n" +
      "  return '<button class=\"nav-item'+(on?' on':'')+(done?' done':'')+(lk?' locked':'')+'\" type=\"button\" data-go=\"'+esc(path)+\n" +
      "    '\" data-srch=\"'+esc((searchKey||label).toLowerCase())+'\">'+\n" +
      "    '<span class=\"ni-ico\">'+ico+'</span><span class=\"ni-t\">'+esc(label)+(lk?' <span class=\"lk\">\\uD83D\\uDD12</span>':'')+'</span>'+\n" +
      "    (count!==''&&count!=null?'<span class=\"ni-b\">'+count+'</span>':'')+'</button>';",
  },

  {
    name: '⑤ 章节分组标题 🔒（教程章节）',
    from: "    h += '<div class=\"nav-group\" data-grp=\"'+esc(gname)+'\">';\n" +
      "    h += '<div class=\"ng-h\"><span>'+esc(gname)+'</span><span class=\"ng-count\">'+arr.length+'</span></div>';",
    to: "    var glk = (window.__lcb && window.__lcb.hooks.groupLocked) ? window.__lcb.hooks.groupLocked(gname) : false;\n" +
      "    h += '<div class=\"nav-group\" data-grp=\"'+esc(gname)+'\">';\n" +
      "    h += '<div class=\"ng-h\"><span>'+esc(gname)+(glk?' <span class=\"lk\">\\uD83D\\uDD12</span>':'')+'</span><span class=\"ng-count\">'+arr.length+'</span></div>';",
  },

  {
    name: '⑥ 命令大全分组标题 🔒',
    from: "  h += '<div class=\"nav-group\" data-grp=\"命令大全\">';\n" +
      "  h += '<div class=\"ng-h\"><span>命令大全</span><span class=\"ng-count\">'+CMDS.length+'</span></div>';",
    to: "  h += '<div class=\"nav-group\" data-grp=\"命令大全\">';\n" +
      "  h += '<div class=\"ng-h\"><span>命令大全'+((window.__lcb && window.__lcb.hooks.groupLocked && window.__lcb.hooks.groupLocked('命令大全'))?' <span class=\"lk\">\\uD83D\\uDD12</span>':'')+'</span><span class=\"ng-count\">'+CMDS.length+'</span></div>';",
  },

  {
    name: '⑦ 实用技巧分组标题 🔒',
    from: "  h += '<div class=\"nav-group\" data-grp=\"实用技巧\">';\n" +
      "  h += '<div class=\"ng-h\"><span>实用技巧</span><span class=\"ng-count\">'+TIPS.length+'</span></div>';",
    to: "  h += '<div class=\"nav-group\" data-grp=\"实用技巧\">';\n" +
      "  h += '<div class=\"ng-h\"><span>实用技巧'+((window.__lcb && window.__lcb.hooks.groupLocked && window.__lcb.hooks.groupLocked('实用技巧'))?' <span class=\"lk\">\\uD83D\\uDD12</span>':'')+'</span><span class=\"ng-count\">'+TIPS.length+'</span></div>';",
  },

  {
    name: '⑧ 提交打卡前置钩子（改走服务器）',
    from: "function submitCheckin(){\n" +
      "  var ids = pendingIds();\n" +
      "  if(!ids.length){ toast('info','还没有勾选内容','请先在教程 / 命令 / 技巧中勾选要打卡的条目。'); return; }\n" +
      "  var date = $('#cbDate').value || todayStr();",
    to: "function submitCheckin(){\n" +
      "  var ids = pendingIds();\n" +
      "  if(!ids.length){ toast('info','还没有勾选内容','请先在教程 / 命令 / 技巧中勾选要打卡的条目。'); return; }\n" +
      "  /* 后端桥接：由服务器负责鉴权与落库（返回 true 表示已接管） */\n" +
      "  if(window.__lcb && window.__lcb.hooks.submit && window.__lcb.hooks.submit(ids)) return;\n" +
      "  var date = $('#cbDate').value || todayStr();",
  },

  {
    name: '⑨ 撤销打卡 / 三格式导出前置钩子',
    from: "    if((el = ev.target.closest('[data-undo]'))){\n" +
      "      var id = el.getAttribute('data-undo');\n" +
      "      delete store.records[id];",
    to: "    if((el = ev.target.closest('[data-undo]'))){\n" +
      "      var id = el.getAttribute('data-undo');\n" +
      "      if(window.__lcb && window.__lcb.hooks.revoke && window.__lcb.hooks.revoke(id)) return;\n" +
      "      delete store.records[id];",
  },

  {
    name: '⑩ 导出按钮前置钩子（服务端生成文件）',
    from: "    if(ev.target.closest('#expCsv')){ doCsv(); return; }\n" +
      "    if(ev.target.closest('#expXls')){ doXlsx(); return; }\n" +
      "    if(ev.target.closest('#expPdf')){ doPdf(); return; }",
    to: "    if(ev.target.closest('#expCsv')){ if(window.__lcb && window.__lcb.hooks.export && window.__lcb.hooks.export('csv')) return; doCsv(); return; }\n" +
      "    if(ev.target.closest('#expXls')){ if(window.__lcb && window.__lcb.hooks.export && window.__lcb.hooks.export('xlsx')) return; doXlsx(); return; }\n" +
      "    if(ev.target.closest('#expPdf')){ if(window.__lcb && window.__lcb.hooks.export && window.__lcb.hooks.export('pdf')) return; doPdf(); return; }",
  },

  {
    name: '⑪ 侧栏底部文案（本地 → 服务器）',
    from: '      <span>数据保存在本机浏览器 · <b id="footVer">v3.1</b></span>',
    to: '      <span>打卡数据已同步服务器 · <b id="footVer">v4.0</b></span>',
  },

  {
    name: '⑫ 页脚版权文案',
    from: '      <div class="cp">© <span id="footYear">2026</span> Linux 学习打卡 · 打卡数据仅存储于您的本地浏览器</div>',
    to: '      <div class="cp">© <span id="footYear">2026</span> Linux 学习打卡 · 打卡记录已同步到你的账号，可跨设备查看与导出</div>',
  },

  {
    name: '⑬ 引入 bridge.js',
    from: '</script>\n</body>',
    to: '</script>\n<script src="./bridge.js"></script>\n</body>',
  },
];

/* ── 执行 ── */
function main() {
  if (!fs.existsSync(SRC)) {
    console.error('✖ 找不到源文件：' + SRC);
    process.exit(1);
  }
  /* ── 最小作用域自检：__lcb 里引用的标识符必须在原文件里真实存在 ──
   之前 `openModal` 拼错导致整个 window.__lcb 赋值抛 ReferenceError，
   桥接层静默失效。这里在构建阶段就把这类错误拦下来。 */
function assertIdentifiersExist(html, names) {
  const missing = names.filter((n) => {
    const re = new RegExp('(?:var|const|let|function)[^;]*\\b' + n + '\\b\\s*[=(]');
    return !re.test(html);
  });
  if (missing.length) {
    console.error('\n✖ __lcb 引用了原文件中不存在的标识符：' + missing.join(', '));
    process.exit(3);
  }
}

const raw = fs.readFileSync(SRC, 'utf8');
  const crlf = raw.indexOf('\r\n') >= 0;
  /* 统一成 LF 后再打补丁，避免 CRLF/LF 混用导致匹配失败 */
  let html = raw.replace(/\r\n/g, '\n');
  const before = html.length;

  const failed = [];
  PATCHES.forEach((p) => {
    const idx = html.indexOf(p.from);
    if (idx < 0) { failed.push(p.name); return; }
    const again = html.indexOf(p.from, idx + 1);
    if (again >= 0) console.warn('  ! 补丁命中多处（将全部替换）：' + p.name);
    html = html.split(p.from).join(p.to);
    console.log('  ✔ ' + p.name);
  });

  if (failed.length) {
    console.error('\n✖ 以下补丁未命中，源文件可能已更新，请检查 __lcb 注入点：');
    failed.forEach((f) => console.error('   · ' + f));
    process.exit(2);
  }

  /* 版本号标注 */
  html = html.replace(
    /Linux 学习打卡 · v3\.1\n/,
    'Linux 学习打卡 · v4.0（接入后端：会员体系 / 注册登录 / 服务端打卡与导出）\n'
  );

  if (crlf) html = html.replace(/\n/g, '\r\n');

  /* 关键自检：__lcb 暴露的每个标识符都必须在原文件里真实存在，
     否则 window.__lcb 会在赋值时抛 ReferenceError，桥接层整体静默失效 */
  assertIdentifiersExist(html, [
    'TUTS', 'CMDS', 'TIPS', 'GROUPS',
    'TUT_INDEX', 'CMD_INDEX', 'TIP_INDEX', 'UNIT_MAP', 'UNITS',
    'loadStore', 'saveStore', 'store', 'TOTAL', 'doneCount',
    'render', 'curView', 'go', 'toast', 'todayStr', 'fmtCn',
    'openCmd', 'closeModal',
  ]);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html, 'utf8');
  console.log('\n✔ 已生成 ' + OUT);
  console.log('  ├─ 源文件 ' + (raw.length / 1024).toFixed(1) + ' KB（' + (crlf ? 'CRLF' : 'LF') + '）');
  console.log('  └─ 输出   ' + (html.length / 1024).toFixed(1) + ' KB');
}

main();
