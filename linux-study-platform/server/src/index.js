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

/* ── 健康检查（Railway / Render 用） ── */
app.get('/api/health', async (_req, res) => {
  try {
    await db.ping();
    res.json({ ok: true, time: new Date().toISOString(), version: '1.0.0' });
  } catch (e) {
    res.status(503).json({ ok: false, error: 'DB_UNAVAILABLE', message: String(e.message || e) });
  }
});

/* ── 业务路由 ── */
// 注意顺序：/api/admin 必须先于 /api 注册，否则学生端守卫中间件会先拦截管理端请求
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));   // 管理端：/api/admin/*
app.use('/api', require('./routes/student'));       // 学生端：/api/tree /api/checkins /api/my/*

/* ── 静态前端（可选：把 web/ 一起部署时） ── */
const WEB_DIR = path.resolve(__dirname, '..', '..', 'web');
if (fs.existsSync(WEB_DIR)) {
  app.use('/', express.static(WEB_DIR, { extensions: ['html'], maxAge: '5m' }));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(WEB_DIR, 'index.html'));
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

db.ping()
  .then(() => console.log('✔ 数据库连接成功：' + (process.env.DB_NAME || 'linux_study')))
  .catch((e) => console.error('✖ 数据库连接失败：', e.message));

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
