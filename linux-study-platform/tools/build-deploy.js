'use strict';
/* ══════════════════════════════════════════════════════════════════
   build-deploy.js · 生成「jiyu 仓库」前端部署包（融合后的单平台）
   ──────────────────────────────────────────────────────────────────
   融合说明（第七阶段）：打卡平台与学习平台已合并为**一个平台**。
   学习平台的课程 / 命令大全 / 实用技巧 / 注册 / 忘记密码全部并入
   web/，登录页只剩一个身份网关 + 学生 / 管理员两个入口。
   因此部署包**不再产出 learn/**，也不再生成「两个平台卡片」的门户页。

   仓库结构（用户的 GitHub 仓库根目录是 jiyu，本项目在其下）：
     jiyu/linux-study-platform/index.html   ← 融合平台（唯一入口，本脚本生成）
     jiyu/linux-study-platform/web/         ← 旧书签兼容：跳转到上一级
     jiyu/linux-study-platform/css|js|assets

   用法：node tools/build-deploy.js [后端地址]
     缺省后端地址取 DEFAULT_API（可用 --no-api 打相对同源包）。

   产物：dist/linux-study-platform/  ← 整个文件夹上传/提交到 jiyu 仓库即可
   ══════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_WEB = path.join(ROOT, 'web');
const OUT = path.join(ROOT, 'dist', 'linux-study-platform');

const DEFAULT_API = 'https://jiyu-production-3034.up.railway.app';
const arg = process.argv[2];
const API = (arg === '--no-api' ? '' : (arg || DEFAULT_API)).replace(/\/+$/, '');

let fail = 0;
function check(name, cond, extra) {
  console.log((cond ? '  ✔ ' : '  ✖ ') + name + (extra ? '（' + extra + '）' : ''));
  if (!cond) fail += 1;
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/* 在 </title> 之后注入（<head> 内，早于一切脚本） */
function injectHead(html, varName, value, comment) {
  if (html.includes(varName)) return html;   // 幂等
  const tag = '<script>/* ' + comment + ' */\n' + varName + ' = ' + JSON.stringify(value) + ';</script>';
  const out = html.replace('</title>', '</title>\n' + tag);
  if (!out.includes(varName)) throw new Error('注入失败：' + varName);
  return out;
}

/* 旧书签兼容页：/web/ → /（保留 hash 与查询串） */
function legacyRedirectHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Linux 学习打卡平台</title>
<script>
(function () {
  var to = '../' + (location.search || '') + (location.hash || '');
  location.replace(to);
})();
</script>
<style>body{font:15px/1.8 "PingFang SC","Microsoft YaHei",system-ui,sans-serif;
  display:grid;place-items:center;min-height:100vh;margin:0;background:#fdfbf5;color:#1f2430}
a{color:#2b5d8f}</style>
</head>
<body>
  <p>正在进入平台… 如果没有自动跳转，请点 <a href="../">这里</a>。</p>
</body>
</html>`;
}

/* ═══ 主流程 ═══ */
console.log('后端地址：' + (API || '（同源 / 未注入）'));
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

/* 1. 融合平台 → 部署根目录（唯一入口） */
copyDir(SRC_WEB, OUT);
const idx = path.join(OUT, 'index.html');
fs.writeFileSync(idx, injectHead(fs.readFileSync(idx, 'utf8'),
  'window.LINUX_STUDY_API', API, '部署注入：后端地址（置空 \x27\x27 回退同源）'));

/* 2. 旧书签兼容：/web/ → / */
fs.mkdirSync(path.join(OUT, 'web'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'web', 'index.html'), legacyRedirectHtml());

/* 3. 自检 */
console.log('\n自检：');
const w = fs.readFileSync(idx, 'utf8');
const wApp = fs.readFileSync(path.join(OUT, 'js', 'app.js'), 'utf8');
const wLogin = fs.readFileSync(path.join(OUT, 'js', 'views', 'login.js'), 'utf8');

check('融合平台已注入 LINUX_STUDY_API', w.includes('window.LINUX_STUDY_API'));
check('产物中不再包含 learn/ 目录', !fs.existsSync(path.join(OUT, 'learn')));
check('部署根目录就是融合平台（含 #loginGate 单一登录窗口）', w.includes('id="loginGate"'));
check('单一登录窗口含「学生登录」「管理员登录」两个入口',
  w.includes('id="btnStudentLogin"') && w.includes('id="btnAdminLogin"'));
check('学习平台功能已并入（课程 / 命令大全 / 实用技巧视图）',
  fs.existsSync(path.join(OUT, 'js', 'views', 'learn.js')) &&
  fs.existsSync(path.join(OUT, 'css', 'learn.css')));
check('登录窗含注册 / 忘记密码页签（自助入口已并入）',
  /regForm|注册账号/.test(wLogin) && /forgotForm|忘记密码/.test(wLogin));
check('页面内无 ../learn/ 外链残留',
  !/\.\.\/learn\//.test(w) && !/\.\.\/learn\//.test(wApp));
check('验证码接口走 POST（与后端路由一致）',
  /request\('POST',\s*'\/auth\/captcha'/.test(fs.readFileSync(path.join(OUT, 'js', 'api.js'), 'utf8')));
/* 提醒学生（管理员群发 → 学生端右上角面板，叉号关闭） */
check('提醒功能资源已打包（css/notice.css + js/notice.js）',
  fs.existsSync(path.join(OUT, 'css', 'notice.css')) &&
  fs.existsSync(path.join(OUT, 'js', 'notice.js')));
check('页面含学生端提醒面板容器 #noticeDock', w.includes('id="noticeDock"'));

const du = (d) => fs.readdirSync(d).length + ' 项';
console.log('\n产物：' + OUT);
console.log('  index.html（融合平台 · 唯一入口）');
console.log('  web/index.html（旧书签跳转页）');
console.log('  css/ ' + du(path.join(OUT, 'css')) + '   js/ ' + du(path.join(OUT, 'js')));

if (fail) {
  console.error('\n✖ 自检未通过 ' + fail + ' 项，请修复后重试');
  process.exit(3);
}
console.log('\n✔ 部署包构建完成。把 dist/linux-study-platform 整个目录提交到 jiyu 仓库即可。');
