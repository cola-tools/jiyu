'use strict';
/* 诊断：为什么 units 表的普通 SELECT 要几十秒 */
const mysql = require('C:/Users/Ran/WorkBuddy/2026-10-01-00-17-20/linux-study-platform/server/node_modules/mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({ host: '127.0.0.1', port: 3399, user: 'root', password: '', database: 'linux_study' });

  const [st] = await conn.query("SHOW TABLE STATUS LIKE 'units'");
  console.log('=== units 表状态 ===');
  ['Rows', 'Data_length', 'Index_length', 'Engine', 'Create_options'].forEach((k) =>
    console.log(' ', k, '=', st[0] ? st[0][k] : 'N/A'));

  const [v] = await conn.query("SHOW VARIABLES LIKE 'innodb_buffer_pool_size'");
  console.log('innodb_buffer_pool_size =', v[0] && v[0].Value, '(字节)');
  const [v2] = await conn.query("SHOW VARIABLES LIKE 'version'");
  console.log('version =', v2[0] && v2[0].Value);

  console.log('=== 再跑一次 SELECT 并同时观察 processlist ===');
  const slow = conn.query("SELECT id, parent_id, level, title, summary, content_type, difficulty, is_checkable, is_free, sort_order, example FROM units WHERE status = 1 ORDER BY level, sort_order, id");
  const t0 = Date.now();
  // 每 5 秒看一眼 processlist
  const watcher = setInterval(async () => {
    try {
      const c2 = await mysql.createConnection({ host: '127.0.0.1', port: 3399, user: 'root', password: '', database: 'linux_study' });
      const [pl] = await c2.query('SHOW FULL PROCESSLIST');
      pl.filter((r) => r.Command === 'Query' && String(r.Info || '').indexOf('PROCESSLIST') < 0)
        .forEach((r) => console.log('  [watch ' + Math.round((Date.now() - t0) / 1000) + 's]', r.Time + 's', r.State, String(r.Info || '').slice(0, 90)));
      const [trx] = await c2.query('SELECT trx_state, TIMEDIFF(NOW(), trx_started) dur, trx_rows_locked FROM information_schema.INNODB_TRX');
      if (trx.length) console.log('  [watch trx]', JSON.stringify(trx));
      await c2.end();
    } catch (e) { /* 忽略 */ }
  }, 5000);

  try {
    const [rows] = await slow;
    console.log('SELECT 完成：', rows.length, '行，耗时', Date.now() - t0, 'ms');
  } catch (e) {
    console.log('SELECT 失败:', e.message);
  } finally { clearInterval(watcher); }

  // 单独测各列的代价
  const t1 = Date.now();
  await conn.query('SELECT id, parent_id, level, title FROM units WHERE status = 1 ORDER BY level, sort_order, id');
  console.log('不带 example 列:', Date.now() - t1, 'ms');
  const t2 = Date.now();
  await conn.query('SELECT example FROM units WHERE status = 1');
  console.log('仅 example 列:', Date.now() - t2, 'ms');
  const [sz] = await conn.query("SELECT LENGTH(example) n FROM units WHERE example IS NOT NULL ORDER BY n DESC LIMIT 3");
  console.log('example 最大长度 TOP3:', sz.map((r) => r.n).join(', '));

  await conn.end();
  process.exit(0);
}
main().catch((e) => { console.error('诊断失败:', e.message); process.exit(1); });
