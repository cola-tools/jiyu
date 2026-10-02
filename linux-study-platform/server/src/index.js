'use strict';
/**
 * Linux 学习打卡平台 · 后端入口
 *   - Express + mysql2
 *   - 单端口监听（PORT 环境变量），可直接部署到 Railway / Render / Fly.io / 自建服务器
 *   - 同时把 web/ 目录作为静态站点对外提供（前后端同源部署时无需配置跨域）
 */
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');

const db = require('./db');
const auth = require('./auth');
const member = require('./member');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

/* ── 跨域：前端部署在 GitHub Pages / 域名时使用 ── */
const origins = String(process.env.CORS_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);                       // curl / 同源
    if (origins.length === 0) return cb(null, true);           // 未配置则允许全部（开发期）
    if (origins.includes(origin)) return cb(null, true);
    // 允许 GitHub Pages 与任意子域
    if (/^https:\/\/[a-z0-9-]+\.github\.io$/i.test(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Token'],
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));

/* ── 简易访问日志 ── */
app.use((req, _res, next) => {
  if (process.env.NODE_ENV !== 'test') {
    const t = new Date().toISOString().slice(11, 19);
    console.log(`[${t}] ${req.method} ${req.originalUrl}`);
  }
  next();
});

/* ── 健康检查（Railway / Render 用） ──
   进程活着就返回 200（db 字段单独反映数据库状态），
   避免数据库瞬断时被平台判定「部署失败」而反复重启。 */
app.get('/api/health', async (_req, res) => {
  let dbOk = true, dbError = null;
  try {
    await db.ping();
  } catch (e) {
    dbOk = false;
    dbError = String(e.message || e);
  }
  res.json({
    ok: true,
    db: dbOk,
    dbError: dbOk ? undefined : dbError,
    time: new Date().toISOString(),
    version: '1.0.0',
  });
});

/* ── 业务路由 ── */
// 注意顺序：/api/auth 与 /api/member 必须先于 /api 注册，
// 否则学生端守卫中间件会先拦截这些不需要学生身份或公开的接口
app.use('/api/auth', require('./routes/auth'));
app.use('/api/member', require('./routes/member'));  // 会员：定价 / 我的会员 / 门禁 / 流水
app.use('/api/admin', require('./routes/admin'));   // 管理端：/api/admin/*
app.use('/api', require('./routes/student'));       // 学生端：/api/tree /api/checkins /api/my/*

/* ── 静态前端（可选：把 web/ 与 learn/ 一起部署时） ── */
/*   /        → 打卡平台（web/）
     /learn/  → 学习平台（learn/，由 study_linux.html 接入后端生成）  */
const WEB_DIR = path.resolve(__dirname, '..', '..', 'web');
const LEARN_DIR = path.resolve(__dirname, '..', '..', 'learn');

if (fs.existsSync(LEARN_DIR)) {
  app.use('/learn', express.static(LEARN_DIR, { extensions: ['html'], maxAge: '5m' }));
  app.get('/learn', (_req, res) => res.redirect('/learn/'));
}

if (fs.existsSync(WEB_DIR)) {
  app.use('/', express.static(WEB_DIR, { extensions: ['html'], maxAge: '5m' }));
  app.get(/^\/(?!api\/|learn\/).*/, (_req, res) => {
    res.sendFile(path.join(WEB_DIR, 'index.html'));
  });
} else {
  /* ── 后端单独部署（如 Railway Root Directory 指向 server/）时，
        根路径提供一页门户，说明服务状态并指向两个前端入口 ── */
  const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const webUrl = esc(process.env.WEB_URL || '');
  const learnUrl = esc(process.env.LEARN_URL || '');
  app.get('/', (_req, res) => {
    res.type('html').send(`<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Linux 学习打卡平台 · 后端服务</title>
<style>
  :root{--bg:#050a16;--card:#0a1a35;--txt:#e8eefc;--dim:#8ba3c7;--acc:#5eb0ff;--ok:#34d399}
  *{box-sizing:border-box;margin:0;padding:0}
  body{min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:radial-gradient(1200px 600px at 70% -10%,#0d2347 0%,var(--bg) 55%);
    color:var(--txt);font:15px/1.7 "PingFang SC","Microsoft YaHei",system-ui,sans-serif;padding:24px}
  .card{max-width:620px;width:100%;background:rgba(10,26,53,.85);border:1px solid #1d3a66;
    border-radius:16px;padding:36px 40px;box-shadow:0 20px 60px rgba(0,0,0,.45)}
  h1{font-size:22px;margin-bottom:4px}
  .sub{color:var(--dim);font-size:13px;margin-bottom:22px}
  .row{display:flex;gap:12px;flex-wrap:wrap;margin:14px 0 22px}
  a.btn{flex:1;min-width:220px;display:block;text-align:center;padding:14px 16px;border-radius:12px;
    background:linear-gradient(135deg,#1667d8,#3b9dff);color:#fff;text-decoration:none;font-weight:600}
  a.btn.ghost{background:none;border:1px solid #2a4d85;color:var(--txt)}
  a.btn small{display:block;font-weight:400;font-size:11px;opacity:.8;margin-top:2px}
  .kv{font-size:12px;color:var(--dim);border-top:1px dashed #1d3a66;padding-top:14px;word-break:break-all}
  .kv b{color:var(--txt);font-weight:600}
  .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--ok);margin-right:6px}
</style></head><body><div class="card">
  <h1>🐧 Linux 学习打卡平台 · 后端服务运行中</h1>
  <div class="sub">API 服务正常 · 数据库 linux_study · 前端入口如下</div>
  <div class="row">
    ${learnUrl ? `<a class="btn" href="${learnUrl}">📖 学习平台<small>${learnUrl}</small></a>` : ''}
    ${webUrl ? `<a class="btn ghost" href="${webUrl}">📝 打卡平台<small>${webUrl}</small></a>` : ''}
  </div>
  <div class="kv">
    <div><span class="dot"></span>健康检查：<b>GET /api/health</b></div>
    <div>接口前缀：<b>/api</b>（注册 / 登录 / 会员 / 打卡 / 管理端）</div>
    <div>后端基地址：<b>${esc(process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : '本服务')}</b></div>
  </div>
</div></body></html>`);
  });
}

/* ── 404 / 错误处理 ── */
app.use('/api', (_req, res) => res.status(404).json({ error: 'NOT_FOUND', message: '接口不存在' }));

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[ERROR]', err);
  res.status(status).json({
    error: err.code || 'INTERNAL_ERROR',
    message: err.message || '服务器内部错误',
  });
});

/* ── 启动 ── */
const PORT = Number(process.env.PORT || 3000);
auth.startTokenGc();
member.startMemberGc();   // 每分钟扫描会员到期 → 自动降级为普通会员并强制退出

/* 数据库启动重试：Railway 上 MySQL 可能比应用晚几秒就绪，
   连不上时指数退避重试，而不是直接放弃（服务必须能自己恢复） */
(function dbBoot() {
  let n = 0;
  const tryPing = async () => {
    try {
      await db.ping();
      console.log('✔ 数据库连接成功：' + (process.env.DB_NAME || 'linux_study'));
    } catch (e) {
      n += 1;
      const wait = Math.min(30000, 1500 * Math.pow(2, n - 1));
      console.error(`✖ 数据库连接失败（第 ${n} 次）：${e.message}，${Math.round(wait / 1000)}s 后重试`);
      setTimeout(tryPing, wait);
    }
  };
  tryPing();
})();

/* 进程级兜底：偶发的异步异常不让进程退出（退出 = 全平台不可用） */
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED_REJECTION]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT_EXCEPTION]', err);
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Linux 学习打卡平台 · 服务已启动`);
  console.log(`  ├─ 本地访问：http://127.0.0.1:${PORT}`);
  console.log(`  ├─ 接口前缀：/api`);
  console.log(`  └─ 环境：${process.env.NODE_ENV || 'development'}\n`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\n正在关闭服务…');
    server.close(() => {
      db.pool.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 5000);
  });
}

module.exports = app;
