'use strict';
/**
 * 短信验证码
 * ─────────────────────────────────────────────────────────────────────
 * Provider 可插拔，通过环境变量 SMS_PROVIDER 选择：
 *
 *   console（默认）  验证码只写入服务端日志。
 *                    非 production 环境下，接口会额外把验证码放在响应的 devCode 字段，
 *                    便于本地联调与自动化测试；production 下绝不外泄。
 *
 *   http             对接任意短信网关：POST JSON 到 SMS_HTTP_URL。
 *                    请求体： {phone, code, scene, text, sign, template}
 *                    可选自定义请求头：SMS_HTTP_HEADERS='{"Authorization":"Bearer xxx"}'
 *                    适配阿里云 / 腾讯云 / 云片 / 螺丝帽等大多数网关的 HTTP API，
 *                    也可指向自建转发服务。
 *
 *   off              完全关闭短信发送（仅用于纯内网演示），此时 devCode 可用。
 *
 * 验证码回显（前端「获取验证码」后直接显示在页面上，不经过短信）：
 *   · 非生产环境                → 始终回显（本地联调 / 自动化测试依赖它）
 *   · SMS_PROVIDER=off          → 始终回显（没有真实短信通道，页面必须能拿到码）
 *   · SMS_PUBLIC_CODE=1         → 显式强制回显（⚠ 等于任何人都能拿到任意手机号的验证码，
 *                                 注册 / 重置密码将完全失去防爆破能力，仅限内网演示）
 *   · 其余情况（production + 真实短信通道）→ 不回显，验证码只走短信
 *
 * 频率限制（防刷）：
 *   · 同一手机号 + 同一场景，60 秒内只能发送一次
 *   · 同一手机号每天最多 SMS_DAILY_LIMIT 条（默认 10）
 *   · 同一 IP 每小时最多 20 条
 * 校验：
 *   · 验证码 5 分钟有效，一次性使用，连续错误 5 次作废
 */
const db = require('./db');

const PROVIDER = String(process.env.SMS_PROVIDER || 'console').toLowerCase();
const TTL_SECONDS = Number(process.env.SMS_TTL_SECONDS || 300);
const RESEND_GAP = Number(process.env.SMS_RESEND_GAP || 60);
const DAILY_LIMIT = Number(process.env.SMS_DAILY_LIMIT || 10);
const IP_HOURLY_LIMIT = Number(process.env.SMS_IP_HOURLY_LIMIT || 20);
const MAX_TRY = 5;
const IS_PROD = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

/** 开发环境固定验证码（便于自动化测试；生产环境忽略此变量） */
const DEV_CODE = IS_PROD ? '' : String(process.env.SMS_DEV_CODE || '');

/** 是否把验证码回传给前端（让页面直接显示，不经过短信） */
const PUBLIC_CODE = /^(1|true|on|yes)$/i.test(String(process.env.SMS_PUBLIC_CODE || ''));
const ECHO_CODE = !IS_PROD || PROVIDER === 'off' || PUBLIC_CODE;

const SCENE_CN = { register: '注册账号', forgot: '重置密码' };

function buildText(code, scene) {
  return '【Linux 学习平台】您正在进行' + (SCENE_CN[scene] || '身份验证') +
    '，验证码 ' + code + '，' + Math.round(TTL_SECONDS / 60) + ' 分钟内有效。请勿泄露给他人。';
}

function randomCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += String(Math.floor(Math.random() * 10));
  return s;
}

/* ───────── Provider 实现 ───────── */

async function sendByConsole(phone, code, scene) {
  console.log('\n┌─ 短信验证码（console provider）──────────────────────────');
  console.log('│  手机号：' + phone);
  console.log('│  场景  ：' + (SCENE_CN[scene] || scene));
  console.log('│  验证码：' + code);
  console.log('└──────────────────────────────────────────────────────────\n');
  return { ok: true, provider: 'console' };
}

async function sendByHttp(phone, code, scene) {
  const url = String(process.env.SMS_HTTP_URL || '').trim();
  if (!url) {
    const e = new Error('SMS_PROVIDER=http 但未配置 SMS_HTTP_URL');
    e.status = 500; e.code = 'SMS_MISCONFIG';
    throw e;
  }
  let headers = { 'Content-Type': 'application/json' };
  try {
    if (process.env.SMS_HTTP_HEADERS) headers = Object.assign(headers, JSON.parse(process.env.SMS_HTTP_HEADERS));
  } catch (e) { /* 忽略非法 JSON，使用默认头 */ }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      signal: ctrl.signal,
      body: JSON.stringify({
        phone, code, scene,
        text: buildText(code, scene),
        sign: process.env.SMS_SIGN || '',
        template: process.env.SMS_TEMPLATE || '',
      }),
    });
    const body = await res.text();
    if (!res.ok) {
      const e = new Error('短信网关返回 ' + res.status + '：' + body.slice(0, 160));
      e.status = 502; e.code = 'SMS_GATEWAY_ERROR';
      throw e;
    }
    return { ok: true, provider: 'http', raw: body.slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

async function dispatch(phone, code, scene) {
  if (PROVIDER === 'off') return { ok: true, provider: 'off' };
  if (PROVIDER === 'http') return sendByHttp(phone, code, scene);
  return sendByConsole(phone, code, scene);
}

/* ───────── 对外接口 ───────── */

/**
 * 发送验证码
 * @returns {Promise<{cooldown:number, devCode?:string}>}
 */
async function send(phone, scene, ip) {
  const p = String(phone || '').trim();
  const sc = scene === 'forgot' ? 'forgot' : 'register';

  // 频率限制：同号同场景 60 秒
  const recent = await db.one(
    'SELECT created_at FROM sms_codes WHERE phone = ? AND scene = ?' +
    ' ORDER BY id DESC LIMIT 1',
    [p, sc]
  );
  if (recent) {
    const gap = Date.now() - new Date(recent.created_at).getTime();
    if (gap < RESEND_GAP * 1000) {
      const e = new Error('验证码已发送，请 ' + Math.ceil((RESEND_GAP * 1000 - gap) / 1000) + ' 秒后再试');
      e.status = 429; e.code = 'SMS_TOO_FREQUENT';
      e.retryAfter = Math.ceil((RESEND_GAP * 1000 - gap) / 1000);
      throw e;
    }
  }
  // 每日上限
  const daily = await db.one(
    'SELECT COUNT(*) AS n FROM sms_codes WHERE phone = ? AND created_at >= CURDATE()',
    [p]
  );
  if (daily && Number(daily.n) >= DAILY_LIMIT) {
    const e = new Error('该手机号今日验证码发送次数已达上限，请明日再试或联系管理员');
    e.status = 429; e.code = 'SMS_DAILY_LIMIT';
    throw e;
  }
  // IP 上限
  if (ip) {
    const ipCnt = await db.one(
      'SELECT COUNT(*) AS n FROM sms_codes WHERE request_ip = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)',
      [String(ip).slice(0, 64)]
    );
    if (ipCnt && Number(ipCnt.n) >= IP_HOURLY_LIMIT) {
      const e = new Error('当前网络发送过于频繁，请稍后再试');
      e.status = 429; e.code = 'SMS_IP_LIMIT';
      throw e;
    }
  }

  const code = DEV_CODE && DEV_CODE.length === 6 ? DEV_CODE : randomCode();
  await dispatch(p, code, sc);

  await db.run(
    'INSERT INTO sms_codes (phone, code, scene, expire_at, request_ip)' +
    ' VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND), ?)',
    [p, code, sc, TTL_SECONDS, String(ip || '').slice(0, 64)]
  );
  db.run('DELETE FROM sms_codes WHERE expire_at < DATE_SUB(NOW(), INTERVAL 1 DAY)').catch(() => {});

  const out = { cooldown: RESEND_GAP, expiresIn: TTL_SECONDS, provider: PROVIDER };
  // 把验证码回传给前端，页面在「获取验证码」后直接显示（不再依赖短信）
  if (ECHO_CODE) {
    out.devCode = code;
    out.devHint = IS_PROD
      ? '验证码已直接回传（SMS_PROVIDER=off 或 SMS_PUBLIC_CODE=1），请直接填入页面。'
      : '开发环境回显验证码；生产环境（NODE_ENV=production）默认不返回。';
  }
  return out;
}

/**
 * 校验验证码（一次性）
 * @returns {Promise<boolean>}
 */
async function verify(phone, scene, input) {
  const p = String(phone || '').trim();
  const sc = scene === 'forgot' ? 'forgot' : 'register';
  const code = String(input || '').trim();
  if (!p || !code) return false;

  const row = await db.one(
    'SELECT id, code, expire_at, used_at, send_count FROM sms_codes' +
    ' WHERE phone = ? AND scene = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1',
    [p, sc]
  );
  if (!row) return false;
  if (new Date(row.expire_at).getTime() <= Date.now()) return false;

  if (String(row.code) !== code) {
    const tries = Number(row.send_count || 1) + 1;
    if (tries > MAX_TRY) {
      await db.run('UPDATE sms_codes SET used_at = NOW() WHERE id = ?', [row.id]);
    } else {
      await db.run('UPDATE sms_codes SET send_count = ? WHERE id = ?', [tries, row.id]);
    }
    return false;
  }
  await db.run('UPDATE sms_codes SET used_at = NOW() WHERE id = ?', [row.id]);
  return true;
}

module.exports = {
  send, verify, PROVIDER, TTL_SECONDS, RESEND_GAP, IS_PROD,
  buildText, SCENE_CN,
};
