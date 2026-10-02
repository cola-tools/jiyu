'use strict';
/* 诊断：/api/tree?withProgress=1 是否挂起 + 挂起时 MySQL 侧状态 */
const mysql = require('C:/Users/Ran/WorkBuddy/2026-10-01-00-17-20/linux-study-platform/server/node_modules/mysql2/promise');

const BASE = 'http://127.0.0.1:3210';
const USER = { username: 'student1', password: 'xiaoran2026' };

async function main() {
  const lr = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(USER),
  });
  const token = (await lr.json()).token;
  console.log('登录成功，token 已取得');

  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(BASE + '/api/tree?withProgress=1', {
      headers: { Authorization: 'Bearer ' + token },
      signal: ctrl.signal,
    });
    const d = await r.json();
    console.log('tree 响应:', r.status, '耗时', Date.now() - t0, 'ms, 顶层键:', Object.keys(d).join(','));
  } catch (e) {
    console.log('tree 请求未完成（' + (Date.now() - t0) + 'ms）:', e.name, e.message);
  } finally {
    clearTimeout(timer);
  }

  const conn = await mysql.createConnection({ host: '127.0.0.1', port: 3399, user: 'root', password: '', database: 'linux_study' });
  const [pl] = await conn.query('SHOW FULL PROCESSLIST');
  console.log('=== MySQL Query 状态 ===');
  pl.filter((r) => r.Command === 'Query').forEach((r) => console.log(' ', r.Time + 's', String(r.Info || '').slice(0, 130)));
  const [trx] = await conn.query('SELECT trx_id, trx_state, trx_started, TIMEDIFF(NOW(), trx_started) dur FROM information_schema.INNODB_TRX');
  console.log('=== 运行中事务 ===', trx.length ? '' : '无');
  trx.forEach((r) => console.log(' ', r.trx_state, r.dur));
  await conn.end();
  process.exit(0);
}

main().catch((e) => { console.error('诊断失败:', e.message); process.exit(1); });
