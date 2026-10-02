'use strict';
/* 诊断：/api/tree 路由的两条 SQL + calc 聚合在数据层是否死循环 */
const mysql = require('C:/Users/Ran/WorkBuddy/2026-10-01-00-17-20/linux-study-platform/server/node_modules/mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({ host: '127.0.0.1', port: 3399, user: 'root', password: '', database: 'linux_study', dateStrings: true });
  const t0 = Date.now();
  const [units] = await conn.query(
    'SELECT id, parent_id, level, title, summary, content_type, difficulty, is_checkable, is_free, sort_order, example FROM units WHERE status = 1 ORDER BY level, sort_order, id'
  );
  console.log('SQL1 units:', units.length, '行，', Date.now() - t0, 'ms');

  const t1 = Date.now();
  const ids = units.filter((u) => u.is_checkable).map((u) => u.id);
  const ph = ids.map(() => '?').join(',');
  const [rows] = await conn.query(
    'SELECT unit_id FROM checkins WHERE student_id = ? AND status = ? AND unit_id IN (' + ph + ')',
    [3, 'done', ...ids]
  );
  console.log('SQL2 checkins:', rows.length, '行，', Date.now() - t1, 'ms');

  // 复刻 calc 聚合（带环检测与步数上限）
  const byParent = new Map();
  units.forEach((u) => {
    const p = u.parent_id == null ? 0 : Number(u.parent_id);
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(u);
  });
  const stat = new Map();
  let steps = 0;
  const MAX = 5e6;
  function calc(id, depth) {
    if (++steps > MAX) throw new Error('calc 步数超限：疑似环或异常结构，入口 id=' + arguments[2]);
    if (depth > 100) throw new Error('calc 递归深度超 100：id=' + id);
    if (stat.has(id)) return stat.get(id);
    let total = 0, done = 0;
    const self = units.find((u) => u.id === id);
    if (self && self.is_checkable) { total += 1; }
    (byParent.get(id) || []).forEach((c) => {
      calc(Number(c.id), depth + 1, id);
    });
    const r = { total, done };
    stat.set(id, r);
    return r;
  }
  const t2 = Date.now();
  try {
    units.forEach((u) => calc(Number(u.id), 0, 'root'));
    console.log('calc 聚合: OK，', Date.now() - t2, 'ms，steps =', steps);
  } catch (e) {
    console.log('calc 聚合异常:', e.message);
  }

  // 检查 parent 指向不存在节点 / 自环
  const idset = new Set(units.map((u) => u.id));
  let bad = 0, selfLoop = [];
  units.forEach((u) => {
    if (u.parent_id != null && !idset.has(Number(u.parent_id))) bad++;
    if (u.parent_id != null && Number(u.parent_id) === Number(u.id)) selfLoop.push(u.id);
  });
  console.log('parent 指向不存在节点:', bad, '个；自环:', selfLoop.join(',') || '无');

  await conn.end();
  process.exit(0);
}
main().catch((e) => { console.error('诊断失败:', e.message); process.exit(1); });
