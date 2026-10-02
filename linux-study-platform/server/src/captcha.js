'use strict';
/**
 * 图形验证码 · 服务端生成 SVG（零依赖）
 * ─────────────────────────────────────────────────────────────────────
 * 设计要点：
 *   · 答案只存服务端（captcha_codes 表），前端只拿到一次性 token 与图片
 *   · 字符随机旋转 / 位移 / 描边，叠加干扰线与噪点，兼顾可读性与抗 OCR
 *   · 校验成功或过期即作废，防重放
 */
const crypto = require('crypto');
const db = require('./db');

const TTL_SECONDS = Number(process.env.CAPTCHA_TTL_SECONDS || 300);   // 5 分钟
const LEN = 4;

// 去掉易混淆字符（0/O、1/I/l 等），降低用户输入挫败感
const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function rand(n) { return Math.floor(Math.random() * n); }

function randomText() {
  let s = '';
  for (let i = 0; i < LEN; i++) s += CHARS[rand(CHARS.length)];
  return s;
}

/** 生成一张 SVG 验证码图 */
function renderSvg(text) {
  const W = 132, H = 46;
  const palette = ['#2b5d8f', '#1f6f5c', '#8a4b1f', '#5b3f8f', '#a33a3a', '#166a8f'];
  const parts = [];

  // 背景
  parts.push('<rect width="' + W + '" height="' + H + '" rx="8" fill="#f2f6fb"/>');

  // 干扰线
  for (let i = 0; i < 5; i++) {
    const c = palette[rand(palette.length)];
    parts.push('<path d="M' + rand(W) + ' ' + rand(H) +
      ' Q' + rand(W) + ' ' + rand(H) + ' ' + rand(W) + ' ' + rand(H) +
      '" stroke="' + c + '" stroke-width="1.1" fill="none" opacity="0.5"/>');
  }

  // 噪点
  for (let i = 0; i < 34; i++) {
    parts.push('<circle cx="' + rand(W) + '" cy="' + rand(H) + '" r="' + (0.6 + Math.random() * 1.1) +
      '" fill="' + palette[rand(palette.length)] + '" opacity="0.45"/>');
  }

  // 字符
  const step = (W - 22) / LEN;
  for (let i = 0; i < LEN; i++) {
    const ch = text[i];
    const x = 14 + i * step + rand(4);
    const y = 31 + rand(6) - 3;
    const rot = rand(46) - 23;
    const size = 24 + rand(5);
    const c = palette[rand(palette.length)];
    parts.push(
      '<text x="' + x + '" y="' + y + '" font-size="' + size + '" font-weight="700"' +
      ' font-family="Georgia,serif" fill="' + c +
      '" transform="rotate(' + rot + ' ' + x + ' ' + y + ')"' +
      ' style="paint-order:stroke;stroke:#ffffff;stroke-width:1.6px">' + ch + '</text>'
    );
  }

  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H +
    '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="图形验证码">' + parts.join('') + '</svg>';
}

/**
 * 新建一个图形验证码
 * @param {string} ip 请求来源 IP
 * @returns {Promise<{token:string, svg:string, expiresIn:number}>}
 */
async function create(ip) {
  // 顺手清理过期票据，避免表膨胀
  db.run('DELETE FROM captcha_codes WHERE expire_at < NOW()').catch(() => {});

  const token = crypto.randomBytes(16).toString('hex');
  const text = randomText();
  await db.run(
    'INSERT INTO captcha_codes (token, answer, expire_at, request_ip)' +
    ' VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND), ?)',
    [token, text.toLowerCase(), TTL_SECONDS, String(ip || '').slice(0, 64)]
  );
  return { token, svg: renderSvg(text), expiresIn: TTL_SECONDS };
}

/**
 * 校验图形验证码（一次性）
 * @returns {Promise<boolean>}
 */
async function verify(token, input) {
  if (!token || !input) return false;
  const row = await db.one(
    'SELECT token, answer, expire_at, used_at FROM captcha_codes WHERE token = ?',
    [String(token)]
  );
  if (!row || row.used_at) return false;
  if (new Date(row.expire_at).getTime() <= Date.now()) return false;

  await db.run('UPDATE captcha_codes SET used_at = NOW() WHERE token = ?', [row.token]);
  return String(input).trim().toLowerCase() === String(row.answer).toLowerCase();
}

module.exports = { create, verify, TTL_SECONDS };
