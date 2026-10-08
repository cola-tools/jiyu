'use strict';
/* ══════════════════════════════════════════════════════════════════
   启动自检（auto-migrate）单元测试
   ──────────────────────────────────────────────────────────────────
   场景：**老库 + 新代码** —— 前端/后端都升级了，但数据库还是旧结构。
   期望：后端启动时自动把缺的表补齐，而不是让页面报
        `Table 'xxx.notices' doesn't exist`。

   覆盖：
     · 缺表时自动创建 notices / notice_dismiss
     · 表结构正确（关键列 + 唯一键）
     · 幂等：表已存在时完全不动作（不重建、CREATE_TIME 不变）
     · AUTO_MIGRATE=0 时可关闭

   前置：后端所用 MySQL 可连接（读 server/.env）
   运行：node tests/db-auto-migrate.js
   ⚠ 会 DROP 测试库里的 notices / notice_dismiss（仅测试数据）
   ══════════════════════════════════════════════════════════════════ */

const path = require('path');

/* dotenv 位于 server/node_modules，显式按路径加载，且必须在 require db 之前 */
require(path.join(__dirname, '..', 'server', 'node_modules', 'dotenv'))
  .config({ path: path.join(__dirname, '..', 'server', '.env') });

const AM_PATH = path.join(__dirname, '..', 'server', 'src', 'auto-migrate');
const DB_PATH = path.join(__dirname, '..', 'server', 'src', 'db');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else {
    fail++;
    failures.push(name + (extra ? ' → ' + String(extra).slice(0, 240) : ''));
    console.log('  ✗ ' + name + (extra ? '  → ' + String(extra).slice(0, 240) : ''));
  }
}
function eq(name, a, b) { ok(name + '  [' + a + ' = ' + b + ']', a === b, 'got ' + JSON.stringify(a)); }
function section(t) { console.log('\n── ' + t + ' ──'); }

const db = require(DB_PATH);

const hasTable = async (t) => Number(await db.scalar(
  'SELECT COUNT(*) FROM information_schema.TABLES' +
  ' WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [t])) > 0;

const columnsOf = async (t) => (await db.q(
  'SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS' +
  ' WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [t])).map((r) => String(r.c));

const indexesOf = async (t) => (await db.q(
  'SELECT DISTINCT INDEX_NAME AS i FROM information_schema.STATISTICS' +
  ' WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [t])).map((r) => String(r.i));

const createTimeOf = async (t) => String(await db.scalar(
  'SELECT CREATE_TIME FROM information_schema.TABLES' +
  ' WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [t]) || '');

async function dropTables() {
  await db.run('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of ['notice_dismiss', 'notices']) {
    await db.run('DROP TABLE IF EXISTS `' + t + '`');
  }
  await db.run('SET FOREIGN_KEY_CHECKS = 1');
}

(async () => {
  try {
    const am = require(AM_PATH);

    /* ═══ 1. 缺表 → 自动创建 ═══ */
    section('1. 老库（缺表）启动时自动补齐');

    await dropTables();
    ok('前置：notices 表已被删除', (await hasTable('notices')) === false);
    ok('前置：notice_dismiss 表已被删除', (await hasTable('notice_dismiss')) === false);

    const r1 = await am.run();
    ok('run() 报告已迁移 notices', (r1.migrated || []).indexOf('notices') >= 0, JSON.stringify(r1));
    ok('run() 报告已迁移 notice_dismiss', (r1.migrated || []).indexOf('notice_dismiss') >= 0, JSON.stringify(r1));
    eq('无失败项', (r1.failed || []).length, 0);
    ok('notices 表已建立', await hasTable('notices'));
    ok('notice_dismiss 表已建立', await hasTable('notice_dismiss'));

    /* ═══ 2. 表结构正确 ═══ */
    section('2. 自动建出来的表结构正确');

    const nCols = await columnsOf('notices');
    ['id', 'admin_id', 'admin_name', 'content', 'priority', 'target_count',
      'revoked_at', 'created_at'].forEach((c) => {
      ok('notices 含列 ' + c, nCols.indexOf(c) >= 0, nCols.join(','));
    });
    const dCols = await columnsOf('notice_dismiss');
    ['id', 'notice_id', 'student_id', 'dismissed_at'].forEach((c) => {
      ok('notice_dismiss 含列 ' + c, dCols.indexOf(c) >= 0, dCols.join(','));
    });
    ok('notice_dismiss 有唯一键 uk_notice_student',
      (await indexesOf('notice_dismiss')).indexOf('uk_notice_student') >= 0);

    /* ═══ 3. 幂等 ═══ */
    section('3. 幂等：表已存在时完全不动作');

    const ct1 = await createTimeOf('notices');
    const r2 = await am.run();
    eq('第二次 run() 不再迁移任何表', (r2.migrated || []).length, 0);
    eq('第二次 run() 检查了 2 张表', r2.checked, 2);
    eq('notices 建表时间未变（没有重建）', await createTimeOf('notices'), ct1);

    /* ═══ 4. 可关闭 ═══ */
    section('4. AUTO_MIGRATE=0 时可关闭');

    delete require.cache[require.resolve(AM_PATH)];
    const old = process.env.AUTO_MIGRATE;
    process.env.AUTO_MIGRATE = '0';
    const amOff = require(AM_PATH);
    await dropTables();
    const r3 = await amOff.run();
    ok('关闭时 run() 返回 skipped', r3.skipped === true, JSON.stringify(r3));
    ok('关闭时不会建表', (await hasTable('notices')) === false);

    // 还原：恢复开关 + 重新加载模块缓存，并把表补回来
    process.env.AUTO_MIGRATE = old || '';
    delete require.cache[require.resolve(AM_PATH)];
    await require(AM_PATH).run();
    ok('恢复后表已补回（供后续测试使用）', await hasTable('notices'));
  } catch (e) {
    fail++;
    failures.push('执行中断：' + (e && e.message));
    console.log('\n✖ 执行中断：' + (e && e.message));
  } finally {
    console.log('\n──────────────────────────────────────────');
    console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
    if (fail) { console.log('\n  失败清单：'); failures.forEach((f) => console.log('   ✗ ' + f)); }
    console.log('──────────────────────────────────────────');
    try { await db.pool.end(); } catch (e) { /* 忽略 */ }
    process.exit(fail ? 1 : 0);
  }
})();
