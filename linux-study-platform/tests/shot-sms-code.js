'use strict';
/* 截图：注册页「获取验证码」9 秒后，页面下方显示后端回传的验证码 */
const path = require('path');
const { launch, sleep, sel, LAST_TOAST, openLogin } = require('./lib/cdp');

const BASE = process.env.BASE || 'http://127.0.0.1:3210';
const PHONE = '139' + String(Date.now()).slice(-8);

(async () => {
  const { cdp, close } = await launch({ port: 9341, shots: path.join(__dirname, 'shots') });
  try {
    await cdp.send('Page.navigate', { url: BASE });
    await cdp.waitFor(sel('#loginGate'), 25000, '登录网关');
    await cdp.waitFor("!!window.STORE", 15000, "脚本就绪");
    await cdp.eval('window.STORE.applyTheme("light", false)');
    await openLogin(cdp, 'student');
    await cdp.eval('document.querySelector(\'.lgm-tabs .ltab[data-tab="register"]\').click()');
    await cdp.waitFor(sel('#regForm'), 15000, '注册表单');
    await sleep(400);

    // 填手机号 + 图形验证码（从库里取答案）
    await cdp.eval('(function(){var p=document.getElementById("regForm");' +
      'p.querySelector(\'[name="phone"]\').value=' + JSON.stringify(PHONE) + ';' +
      'p.querySelector(\'[name="username"]\').value="shotuser";' +
      'p.querySelector(\'[name="password"]\').value="Shot@2026";' +
      'p.querySelector(\'[name="password2"]\').value="Shot@2026";return true;})()');
    await sleep(300);
    const ans = await cdp.eval(
      '(function(){var b=document.getElementById("capImg");return b?(b.getAttribute("data-token")||""):"";})()');
    const mysql = require(path.join(__dirname, '..', 'server', 'node_modules', 'mysql2', 'promise'));
    require(path.join(__dirname, '..', 'server', 'node_modules', 'dotenv'))
      .config({ path: path.join(__dirname, '..', 'server', '.env') });
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'linux_study',
    });
    const [rows] = await conn.query('SELECT answer FROM captcha_codes WHERE token = ?', [ans]);
    const answer = rows[0] ? rows[0].answer : '';
    await conn.end();

    await cdp.eval('(function(){var i=document.querySelector(\'#regForm [name="captcha"]\');' +
      'i.value=' + JSON.stringify(answer) + ';return true;})()');
    await cdp.eval('document.getElementById("smsBtn").click()');
    await sleep(1500);
    console.log('toast：', await cdp.eval(LAST_TOAST));
    console.log('窗内报错：', await cdp.eval('(function(){var e=document.getElementById("loginErr");return e?e.textContent.trim():"";})()'));
    console.log('等待 9 秒后显示…');
    await cdp.waitFor('(function(){var b=document.getElementById("devSmsBox");return !!b && b.style.display!=="none";})()',
      20000, '验证码提示框');
    await sleep(500);
    await cdp.shot('sms-code-shown-light');
    await cdp.eval('window.STORE.applyTheme("dark", false)');
    await sleep(600);
    await cdp.shot('sms-code-shown-dark');
    console.log('✔ 截图完成：tests/shots/sms-code-shown-light.png / -dark.png');
  } catch (e) {
    console.log('✖ ' + (e && e.message));
  } finally { close(); process.exit(0); }
})();
