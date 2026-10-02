'use strict';
const db = require('./db');

/** 包装 async 路由，统一错误处理 */
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** 业务错误 */
class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const bad = (msg) => new ApiError(400, 'BAD_REQUEST', msg);
const notFound = (msg = '资源不存在') => new ApiError(404, 'NOT_FOUND', msg);
const forbidden = (msg = '无权限') => new ApiError(403, 'FORBIDDEN', msg);

/** 记录动态流水 */
async function logActivity(actorType, actorId, actorName, action, target = '', detail = '') {
  try {
    await db.run(
      `INSERT INTO activity (actor_type, actor_id, actor_name, action, target, detail)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [actorType, actorId || null, actorName || '', action, String(target).slice(0, 255), String(detail).slice(0, 500)]
    );
  } catch (e) { /* 动态记录失败不影响主流程 */ }
}

/**
 * 计算单元的完整路径，如「命令大全 / 文件管理 / cat」
 * 目录树固定 4 级，用自连接实现（兼容 MySQL 5.7，无需递归 CTE）
 */
const PATH_SQL = `
  SELECT CONCAT_WS(' / ', a.title, b.title, c.title, d.title) AS path
    FROM units d
    LEFT JOIN units c ON c.id = d.parent_id
    LEFT JOIN units b ON b.id = c.parent_id
    LEFT JOIN units a ON a.id = b.parent_id
   WHERE d.id = ?`;

async function unitPath(unitId) {
  if (!unitId) return '';
  const r = await db.one(PATH_SQL, [unitId]);
  return r ? r.path || '' : '';
}

/** 一次性取多个单元的路径（避免 N+1） */
async function unitPaths(ids) {
  const uniq = [...new Set(ids.filter(Boolean).map(Number))];
  const map = new Map();
  if (!uniq.length) return map;
  const ph = uniq.map(() => '?').join(',');
  const rows = await db.q(
    `SELECT d.id AS id, CONCAT_WS(' / ', a.title, b.title, c.title, d.title) AS path
       FROM units d
       LEFT JOIN units c ON c.id = d.parent_id
       LEFT JOIN units b ON b.id = c.parent_id
       LEFT JOIN units a ON a.id = b.parent_id
      WHERE d.id IN (${ph})`,
    uniq
  );
  rows.forEach((r) => map.set(Number(r.id), r.path || ''));
  return map;
}

/**
 * 取某单元及其全部子孙 id（用于级联统计）
 * 层数固定为 4：自身 / 子 / 孙 / 曾孙
 */
async function descendantIds(rootId) {
  const rows = await db.q(
    `SELECT id FROM units WHERE id = ?
     UNION
     SELECT id FROM units WHERE parent_id = ?
     UNION
     SELECT id FROM units WHERE parent_id IN (SELECT id FROM units WHERE parent_id = ?)
     UNION
     SELECT id FROM units WHERE parent_id IN (
              SELECT id FROM units WHERE parent_id IN (
                SELECT id FROM units WHERE parent_id = ?))`,
    [rootId, rootId, rootId, rootId]
  );
  return rows.map((r) => Number(r.id));
}

const clampInt = (v, min, max, dflt) => {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return dflt;
  return Math.max(min, Math.min(max, n));
};

/**
 * 百分比：进度极小时保留一位小数，避免「刚打完卡却显示 0%」
 */
function percent(done, total) {
  const d = Number(done) || 0, t = Number(total) || 0;
  if (!t || d <= 0) return 0;
  const p = (d / t) * 100;
  if (p < 10) return Math.round(p * 10) / 10;
  return Math.round(p);
}

const str = (v, max = 500) => (v == null ? '' : String(v).slice(0, max));

module.exports = {
  ah, ApiError, bad, notFound, forbidden, logActivity,
  unitPath, unitPaths, descendantIds, clampInt, percent, str,
};
