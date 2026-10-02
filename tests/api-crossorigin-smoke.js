'use strict';
/**
 * 跨域全链路冒烟测试（零依赖）
 * ─────────────────────────────────────────────────────────────────────
 * 模拟线上真实场景：前端部署在 https://eojjr.cn（GitHub Pages / 自定义域），
 * 后端在 Railway —— 每个请求都带 Origin 头，验证 CORS + 完整账号链路：
 *   图形验证码 → 短信验证码 → 注册 → 登录(学习/打卡) → 会员信息
 *   → 忘记密码 → 新密码登录 → 退出登录 → 清理测试账号
 *
 * 用法：node tests/api-crossorigin-smoke.js [后端地址]
 *      默认 http://127.0.0.1:3210；线上可传 https://jiyu-production-3034.up.railway.app
 */
const path = require('path');
const mysql = require(path.join(__dirname, '..', 'server', 'node_modules', 'mysql2', 'promise'));

const BASE = (process.argv[2] || process.env.BASE || 'http://127.0.0.1:3210').replace(/\/+$/, '');
const ORIGIN = 'https://eojjr.cn';
const DB = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3399),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'linux_study',
  dateStrings: true,
};

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2714 ' + name); }
  else { fail++; console.log('  \u2716 ' + name + (extra ? '  → ' + extra : '')); }
}
function group(t) { console.log('\n' + t); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, p, body, token) {
  const headers = { 'Content-Type': 'application/json', 'Origin': ORIGIN };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + p, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const cors = res.headers.get('access-control-allow-origin');
  const ct = res.headers.get('content-type') || '';
  return {
    status: res.status,
    cors,
    json: ct.includes('application/json') ? await res.json() : null,
  };
}

async function main() {
  const conn = await mysql.createConnection(DB);
  const phone = '1390000' + String(Date.now()).slice(-4);
  const username = 'cors_' + String(Date.now()).slice(-6);
  const pwd1 = 'corsPwd123', pwd2 = 'corsPwd456';

  group('── 1. CORS 预检与公开接口 ──');
  const opt = await fetch(BASE + '/api/auth/captcha', {
    method: 'OPTIONS',
    headers: { 'Origin': ORIGIN, 'Access-Control-Request-Method': 'POST' },
  });
  ok('OPTIONS 预检返回 2xx（' + opt.status + '）', opt.status >= 200 && opt.status < 300);
  ok('预检放行 Origin（' + opt.headers.get('access-control-allow-origin') + '）',
    opt.headers.get('access-control-allow-origin') === ORIGIN);
  const pricing = await api('GET', '/api/member/pricing');
  ok('定价接口公开可用且带 CORS 头', pricing.status === 200 && pricing.cors === ORIGIN
    && pricing.json.items.length === 5);

  group('── 2. 图形验证码 → 短信验证码 ──');
  /* 图形验证码是一次性核销的：每个消费点都必须取新的 */
  async function freshCaptcha() {
    const c = await api('POST', '/api/auth/captcha', {});
    if (c.status !== 200) throw new Error('图形验证码获取失败：' + c.status);
    const [r] = await conn.execute('SELECT answer FROM captcha_codes WHERE token = ?', [c.json.token]);
    return { token: c.json.token, answer: r[0] ? r[0].answer : '' };
  }

  let cap = await freshCaptcha();
  ok('图形验证码获取（200）', !!cap.token);
  const sms = await api('POST', '/api/auth/sms',
    { phone, scene: 'register', captchaToken: cap.token, captcha: cap.answer });
  ok('短信验证码下发（' + sms.status + '，console 模式回显 devCode）',
    sms.status === 200 && !!sms.json.devCode);
  const smsCode = sms.json ? (sms.json.devCode || sms.json.code) : '';

  group('── 3. 注册 → 登录 → 会员信息 ──');
  cap = await freshCaptcha();   // 注册时图形码已被短信步骤核销，必须取新的
  const reg = await api('POST', '/api/auth/register', {
    username, password: pwd1, password2: pwd1, phone, smsCode,
    captchaToken: cap.token, captcha: cap.answer,
  });
  ok('注册成功（' + reg.status + '）默认普通会员', reg.status === 201
    && reg.json.user && reg.json.user.member && reg.json.user.member.type === 'none',
    JSON.stringify(reg.json).slice(0, 120));
  cap = await freshCaptcha();
  const dup = await api('POST', '/api/auth/sms', {
    phone, scene: 'register', captchaToken: cap.token, captcha: cap.answer });
  ok('重复注册手机号被拒（该手机号已绑定账号）', dup.status === 409
    && /已绑定账号/.test(dup.json.message || ''));
  const badCap = await api('POST', '/api/auth/sms',
    { phone: '13900009999', scene: 'register', captchaToken: 'x', captcha: '0' });
  ok('错误图形验证码被拒（BAD_CAPTCHA）', badCap.status === 400);

  const login = await api('POST', '/api/auth/login',
    { username, password: pwd1, role: 'student', platform: 'learn' });
  ok('学习平台登录成功', login.status === 200 && !!login.json.token);
  const gate = await api('POST', '/api/auth/login',
    { username, password: pwd1, role: 'student', platform: 'checkin' });
  ok('普通会员登录打卡平台被拒（NEED_MEMBER 逐字文案）', gate.status === 403
    && gate.json.message === '你还未开通会员，无法使用打卡平台，请联系管理员开通会员后再使用！');
  const me = await api('GET', '/api/member/me', undefined, login.json.token);
  ok('会员信息可查询（带 token + CORS）', me.status === 200 && me.cors === ORIGIN
    && me.json.member && me.json.member.type === 'none');

  group('── 4. 忘记密码 → 新密码登录 ──');
  const cap2 = await freshCaptcha();
  const sms2 = await api('POST', '/api/auth/sms',
    { phone, scene: 'forgot', captchaToken: cap2.token, captcha: cap2.answer });
  ok('忘记密码场景短信下发', sms2.status === 200 && !!sms2.json.devCode);
  const forgot = await api('POST', '/api/auth/forgot', {
    phone, smsCode: sms2.json.devCode, newPassword: pwd2, newPassword2: pwd2,
  });
  ok('密码重置成功', forgot.status === 200);
  const oldLogin = await api('POST', '/api/auth/login', { username, password: pwd1 });
  ok('旧密码已失效（' + oldLogin.status + '）', oldLogin.status === 401);
  const newLogin = await api('POST', '/api/auth/login', { username, password: pwd2 });
  ok('新密码登录成功', newLogin.status === 200 && !!newLogin.json.token);

  group('── 5. 退出登录 + 清理 ──');
  const out = await api('POST', '/api/auth/logout', {}, newLogin.json.token);
  ok('退出登录成功', out.status === 200);
  await conn.execute("DELETE FROM tokens WHERE owner_type='student' AND owner_id=?",
    [reg.json.user ? reg.json.user.id : -1]);
  await conn.execute('DELETE FROM students WHERE id = ?', [reg.json.user ? reg.json.user.id : -1]);
  console.log('  · 测试账号已清理：' + username + ' / ' + phone);

  await conn.end();
  console.log('\n──────────────────────────────────────────────');
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项' + (fail ? '  ← 存在问题！' : '  ✅'));
  console.log('──────────────────────────────────────────────');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
