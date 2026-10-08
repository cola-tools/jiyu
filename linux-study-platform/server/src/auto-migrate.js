'use strict';
/**
 * auto-migrate.js · 启动时幂等补齐「新增功能」所需的表
 * ──────────────────────────────────────────────────────────────────
 * 背景：后端只部署 server/ 目录，运行时拿不到仓库根目录的 db/*.sql，
 *      因此「老库 + 新代码」时会出现
 *      `Table 'xxx.notices' doesn't exist`，页面直接显示「加载失败」。
 *
 * 策略：启动时先查 information_schema 看缺哪些表，只对缺失的表执行
 *      CREATE TABLE IF NOT EXISTS —— 纯新增，不修改任何既有表，
 *      幂等、可重复执行、不影响任何已有功能。
 *      · 表已存在      → 完全不碰
 *      · 没有建表权限 / 库名不匹配 → 打警告并继续启动（服务不因此挂掉）
 *      · 可用环境变量 AUTO_MIGRATE=0 关闭
 *
 * ⚠ 下方 DDL 与 db/migrate_v3_notice.sql、db/schema.sql 三处保持一致。
 */

const db = require('./db');

const OFF = /^(0|false|off|no)$/i.test(String(process.env.AUTO_MIGRATE || ''));

/* ── 迁移清单（新功能往下追加即可） ── */
const MIGRATIONS = [
  {
    label: '提醒学生 (v3)',
    tables: ['notices', 'notice_dismiss'],
    sql: [
      `CREATE TABLE IF NOT EXISTS \`notices\` (
         \`id\`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
         \`admin_id\`     INT UNSIGNED NOT NULL,
         \`admin_name\`   VARCHAR(64)  NOT NULL DEFAULT '',
         \`content\`      TEXT         NOT NULL,
         \`priority\`     TINYINT      NOT NULL DEFAULT 1,
         \`target_count\` INT UNSIGNED NOT NULL DEFAULT 0,
         \`revoked_at\`   DATETIME     NULL,
         \`created_at\`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
         PRIMARY KEY (\`id\`),
         KEY \`idx_notice_admin\` (\`admin_id\`),
         KEY \`idx_notice_created\` (\`created_at\`)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理员提醒'`,

      `CREATE TABLE IF NOT EXISTS \`notice_dismiss\` (
         \`id\`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
         \`notice_id\`    BIGINT UNSIGNED NOT NULL,
         \`student_id\`   INT UNSIGNED NOT NULL,
         \`dismissed_at\` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
         PRIMARY KEY (\`id\`),
         UNIQUE KEY \`uk_notice_student\` (\`notice_id\`, \`student_id\`),
         KEY \`idx_nd_student\` (\`student_id\`)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='提醒关闭记录'`,
    ],
  },
];

/** 查当前库中已存在的表 → 返回缺失的那些 */
async function missingTables(names) {
  const ph = names.map(() => '?').join(',');
  const rows = await db.q(
    'SELECT TABLE_NAME AS t FROM information_schema.TABLES' +
    ' WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (' + ph + ')',
    names
  );
  const have = new Set(rows.map((r) => String(r.t)));
  return names.filter((n) => !have.has(n));
}

/**
 * 启动时调用；**永不抛错**（失败只打警告，不影响服务启动）。
 * @returns {Promise<{checked:number, migrated:string[], failed:string[]}>}
 */
async function run() {
  const out = { checked: 0, migrated: [], failed: [], skipped: false };
  if (OFF) {
    console.log('→ 启动自检：已通过 AUTO_MIGRATE=0 关闭自动补表');
    out.skipped = true;
    return out;
  }

  for (const m of MIGRATIONS) {
    let missing;
    try {
      missing = await missingTables(m.tables);
    } catch (e) {
      console.warn('→ 启动自检：无法读取表清单（' + String((e && e.message) || e) + '），跳过 ' + m.label);
      continue;
    }
    out.checked += m.tables.length;
    if (!missing.length) continue;   // 表齐全 → 什么都不做

    console.log('→ 启动自检：' + m.label + ' 缺少 ' + missing.join(' / ') + '，正在自动建表…');
    for (const sql of m.sql) {
      const name = (/CREATE TABLE IF NOT EXISTS `([^`]+)`/.exec(sql) || [])[1] || '';
      if (name && !missing.includes(name)) continue;   // 只补缺的那张
      try {
        await db.run(sql);
        out.migrated.push(name);
      } catch (e) {
        out.failed.push(name);
        console.warn('  ✖ 建表 ' + name + ' 失败：' + String((e && e.message) || e));
      }
    }
    if (out.migrated.length) {
      console.log('  ✔ 已自动创建：' + out.migrated.join(' / '));
    }
    if (out.failed.length) {
      console.warn('  → 请在后端数据库手动执行一次 db/migrate_v3_notice.sql（幂等脚本）');
    }
  }
  return out;
}

module.exports = { run, MIGRATIONS };
