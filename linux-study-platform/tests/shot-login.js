'use strict';
/* 仅用于人工核对登录窗口视觉：采一组截图后退出（不参与断言） */
const { launch, sleep } = require('./lib/cdp');
const BASE = process.env.BASE || 'http://127.0.0.1:3210';

(async () => {
  const { cdp, close } = await launch({ port: Number(process.env.CDP_PORT || 9341) });
  try {
    await cdp.send('Page.navigate', { url: BASE + '/' });
    await sleep(2200);
    await cdp.eval('(function(){if(window.STORE)STORE.applyTheme("light",false,true);})()');
    await sleep(600);
    await cdp.shot('V0-gate-light');

    await cdp.eval('document.getElementById("btnStudentLogin").click()');
    await sleep(900);
    await cdp.shot('V1-login-light');

    await cdp.eval('document.querySelector(\'.lgm-tabs .ltab[data-tab="register"]\').click()');
    await sleep(1200);
    await cdp.shot('V2-register-light');

    await cdp.eval('document.querySelector(\'.lgm-tabs .ltab[data-tab="forgot"]\').click()');
    await sleep(1200);
    await cdp.shot('V3-forgot-light');

    // 深色
    await cdp.eval('(function(){if(window.STORE)STORE.applyTheme("dark",false,true);})()');
    await sleep(600);
    await cdp.shot('V4-forgot-dark');

    await cdp.eval('document.querySelector(\'.lgm-tabs .ltab[data-tab="login"]\').click()');
    await sleep(700);
    await cdp.shot('V5-login-dark');

    await cdp.eval('(function(){var m=document.querySelectorAll(".ui-modal");if(m.length)m[m.length-1].querySelector(".modal-head .icon-btn").click();})()');
    await sleep(600);
    await cdp.eval('(function(){if(window.STORE)STORE.applyTheme("light",false,true);})()');
    await sleep(400);
    await cdp.resize(375, 760);
    await cdp.shot('V6-gate-mobile');
    await cdp.eval('document.getElementById("btnAdminLogin").click()');
    await sleep(900);
    await cdp.shot('V7-admin-login-mobile');
    console.log('截图完成');
  } finally {
    close();
  }
})();
