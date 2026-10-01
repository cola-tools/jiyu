'use strict';
/* ══════════════════════════════════════════════════════════════════
   init-db.js · 一键初始化数据库（结构 + 账号 + 学习内容）

   用法（在 server/ 目录下）：
     npm run init-db
     npm run init-db -- --skip-content     # 只建表和账号，不导入 4485 条内容
     npm run init-db -- --force            # 内容已存在时也重新导入（先清空 units）

   读取的 SQL 文件（位于项目根目录 db/）：
     1. schema.sql         表结构（含 CREATE DATABASE / USE）
     2. seed_accounts.sql  管理员 + 5 个学生账号
     3. seed_content.sql   四级目录树 + 学习内容（约 1.5MB）
   ══════════════════════════════════════════════════════════════════ */

   

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const SKIP_CONTENT = process.argv.includes('--skip-content');
const FORCE = process.argv.includes('--force');

const DB_DIR = path.resolve(__dirname, '..', '..', '..', 'db');
const FILES = [
  { file: 'schema.sql', label: '表结构' },
  { file: 'seed_accounts.sql', label: '账号' },
].concat(SKIP_CONTENT ? [] : [{ file: 'seed_content.sql', label: '学习内容' }]);

(async () => {
  const cfg = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,          // 一次执行整个 SQL 文件
  };
  if (String(process.env.DB_SSL).toLowerCase() === 'true') {
    cfg.ssl = { rejectUnauthorized: false };
  }

  console.log('→ 连接 MySQL：' + cfg.host + ':' + cfg.port + '（用户 ' + cfg.user + '）');
  const conn = await mysql.createConnection(cfg);

  for (const item of FILES) {
    const full = path.join(DB_DIR, item.file);
    if (!fs.existsSync(full)) {
      console.error('✖ 找不到 ' + full);
      process.exit(1);
    }

    /* 幂等保护：学习内容为纯 INSERT，重复导入会翻倍 */
    if (item.file === 'seed_content.sql') {
      await conn.query('USE `' + (process.env.DB_NAME || 'linux_study') + '`');
      const [[st]] = await conn.query('SELECT COUNT(*) AS n FROM `units`');
      if (Number(st.n) > 0 && !FORCE) {
        console.log('→ 跳过学习内容导入：units 已有 ' + st.n + ' 个节点');
        console.log('  （如需清空重导，请加参数 --force）');
        continue;
      }
      if (FORCE) {
        console.log('→ --force：清空旧目录树与关联记录…');
        await conn.query('SET FOREIGN_KEY_CHECKS = 0');
        for (const t of ['checkins', 'checkin_logs', 'urges', 'urge_targets',
          'questions', 'answers', 'activity', 'units']) {
          await conn.query('TRUNCATE TABLE `' + t + '`');
        }
        await conn.query('SET FOREIGN_KEY_CHECKS = 1');
      }
    }

    const sql = fs.readFileSync(full, 'utf8');
    process.stdout.write('→ 导入' + item.label + '（' + item.file + '，' +
      (sql.length / 1024).toFixed(0) + ' KB）… ');
    await conn.query(sql);
    console.log('完成');
  }

  /* 结果核对 */
  const dbname = process.env.DB_NAME || 'linux_study';
  await conn.query('USE `' + dbname + '`');
  const [rows] = await conn.query(
    'SELECT (SELECT COUNT(*) FROM `admins`) AS admins,' +
    '       (SELECT COUNT(*) FROM `students`) AS students,' +
    '       (SELECT COUNT(*) FROM `units`) AS units,' +
    '       (SELECT COUNT(*) FROM `units` u WHERE u.`level` = 3 AND u.`is_checkable` = 1 AND u.`status` = 1) AS checkable'
  );
  const r = rows[0];
  console.log('');
  console.log('✔ 初始化完成（库：' + dbname + '）');
  console.log('  ├─ 管理员：' + r.admins + ' 个');
  console.log('  ├─ 学生：' + r.students + ' 个');
  console.log('  ├─ 目录节点：' + r.units + ' 个');
  console.log('  └─ 可打卡内容：' + r.checkable + ' 个');
  if (SKIP_CONTENT) console.log('  ℹ 本次跳过了学习内容导入（--skip-content）');
  if (Number(r.units) === 0 && SKIP_CONTENT) {
    console.log('  ⚠ 目录为空：请去掉 --skip-content 再执行一次以导入学习内容');
  }

  await conn.end();
})().catch((e) => {
  console.error('✖ 初始化失败：' + (e.message || e));
  process.exit(1);
});
