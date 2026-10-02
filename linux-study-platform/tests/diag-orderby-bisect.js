'use strict';
/* 诊断：二分定位 ORDER BY 慢的根源 */
const mysql = require('C:/Users/Ran/WorkBuddy/2026-10-01-00-17-20/linux-study-platform/server/node_modules/mysql2/promise');

async function timed(conn, label, sql, limitMs) {
  const t = Date.now();
  try {
    const p = conn.query(sql);
    let done = false;
    p.then(() => {}).catch(() => {});
    // 超时观测：超过 limitMs 放弃等待（连接会话会被 KILL）
    const rows = await Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT>' + limitMs + 'ms')), limitMs)),
    ]);
    console.log(label, '→', Date.now() - t, 'ms，', Array.isArray(rows) ? rows[0].length + ' 行' : '');
    return true;
  } catch (e) {
    console.log(label, '→', Date.now() - t, 'ms，', e.message);
    if (e.message.indexOf('TIMEOUT') === 0) {
      // kill 这个查询
      try {
        const c2 = await mysql.createConnection({ host: '127.0.0.1', port: 3399, user: 'root', password: '', database: 'linux_study' });
        const [pl] = await c2.query('SHOW FULL PROCESSLIST');
        for (const r of pl) {
          if (r.Command === 'Query' && String(r.Info || '').indexOf('PROCESSLIST') < 0 && String(r.Info || '').indexOf('SELECT') === 0) {
            await c2.query('KILL ' + r.Id);
            console.log('  已 KILL', r.Id);
          }
        }
        await c2.end();
      } catch (_) {}
    }
    return false;
  }
}

async function main() {
  const conn = await mysql.createConnection({ host: '127.0.0.1', port: 3399, user: 'root', password: '', database: 'linux_study' });

  const [hl] = await conn.query("SELECT COUNT(*) n FROM information_schema.INNODB_METRICS WHERE NAME='trx_rseg_history_len'");
  console.log('（history list 检查）', hl[0].n);
  try {
    const [h2] = await conn.query("SHOW ENGINE INNODB STATUS");
    const s = String(h2[0][2] ? h2[0][2].Status || h2[0][2].Status : '');
    const m = s.match(/History list length\s+(\d+)/);
    console.log('History list length =', m ? m[1] : '(未找到)');
    const pend = s.match(/\d+ pending\w*/g);
    if (pend) console.log('pending:', pend.join(', '));
  } catch (e) { console.log('INNODB STATUS 读取失败:', e.message); }

  await timed(conn, 'COUNT(*)', 'SELECT COUNT(*) FROM units', 8000);
  await timed(conn, '无排序全取 id', 'SELECT id FROM units WHERE status = 1', 8000);
  await timed(conn, 'ORDER BY id', 'SELECT id FROM units WHERE status = 1 ORDER BY id', 8000);
  await timed(conn, 'ORDER BY level', 'SELECT id FROM units WHERE status = 1 ORDER BY level', 8000);
  await timed(conn, 'ORDER BY sort_order', 'SELECT id FROM units WHERE status = 1 ORDER BY sort_order', 8000);
  await timed(conn, 'ORDER BY title', 'SELECT id, title FROM units WHERE status = 1 ORDER BY title', 8000);

  await conn.end();
  process.exit(0);
}
main().catch((e) => { console.error('诊断失败:', e.message); process.exit(1); });
