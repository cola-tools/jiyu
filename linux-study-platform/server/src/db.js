'use strict';
/**
 * MySQL 连接池 + 查询辅助
 */
const mysql = require('mysql2/promise');

const cfg = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'linux_study',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL || 10),
  queueLimit: 0,
  charset: 'utf8mb4_unicode_ci',
  timezone: '+08:00',
  dateStrings: ['DATE', 'DATETIME'],
  multipleStatements: false,
  supportBigNumbers: true,
  decimalNumbers: true,
};

if (String(process.env.DB_SSL).toLowerCase() === 'true') {
  cfg.ssl = { rejectUnauthorized: false };
}

const pool = mysql.createPool(cfg);

/** 查询，返回行数组 */
async function q(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}
/** 查询单行 */
async function one(sql, params = []) {
  const rows = await q(sql, params);
  return rows[0] || null;
}
/** 取标量 */
async function scalar(sql, params = []) {
  const r = await one(sql, params);
  if (!r) return null;
  return r[Object.keys(r)[0]];
}
/** 写入，返回 { insertId, affectedRows } */
async function run(sql, params = []) {
  const [res] = await pool.execute(sql, params);
  return res;
}
/** 事务 */
async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const r = await fn(conn);
    await conn.commit();
    return r;
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    throw e;
  } finally {
    conn.release();
  }
}

async function ping() {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
  } finally {
    conn.release();
  }
}

module.exports = { pool, q, one, scalar, run, tx, ping };
