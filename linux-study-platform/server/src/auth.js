'use strict';
/**
 * 鉴权：口令哈希（scrypt，与 db/gen_seed.py 生成的格式完全互认）+ Bearer Token 中间件
 *
 * 哈希格式：scrypt$N$r$p$<saltHex>$<hashHex>
 */
const crypto = require('crypto');
const db = require('./db');

const TTL_HOURS = Number(process.env.TOKEN_TTL_HOURS || 720);

/* ── 口令 ── */
function hashPassword(plain, N = 16384, r = 8, p = 1) {
  const salt = crypto.randomBytes(16).toString('hex');
  const dk = crypto.scryptSync(String(plain), salt, 64, { N, r, p, maxmem: 256 * 1024 * 1024 });
  return ['scrypt', N, r, p, salt, dk.toString('hex')].join('$');
}

function verifyPassword(plain, stored) {
  if (!stored) return false;
  const parts = String(stored).split('$');
  if (parts[0] !== 'scrypt' || parts.length !== 6) {
    // 兼容手写的明文（仅首次初始化时可能用到，不推荐）
    return String(plain) === String(stored);
  }
  const N = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
  const salt = parts[4];
  const expect = Buffer.from(parts[5], 'hex');
  let dk;
  try {
    dk = crypto.scryptSync(String(plain), salt, expect.length, { N, r, p, maxmem: 256 * 1024 * 1024 });
  } catch (e) {
    return false;
  }
  return dk.length === expect.length && crypto.timingSafeEqual(dk, expect);
}

/* ── Token ── */
async function issueToken(ownerType, ownerId) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.run(
    `INSERT INTO tokens (token, owner_type, owner_id, expires_at)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))`,
    [token, ownerType, ownerId, TTL_HOURS]
  );
  return token;
}

async function revokeToken(token) {
  if (!token) return;
  await db.run('DELETE FROM tokens WHERE token = ?', [token]);
}

/** 定期清过期 token */
function startTokenGc() {
  const gc = () => db.run('DELETE FROM tokens WHERE expires_at < NOW()').catch(() => {});
  gc();
  setInterval(gc, 6 * 3600 * 1000).unref?.();
}

/* ── 中间件 ── */
function readToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  if (req.headers['x-token']) return String(req.headers['x-token']).trim();
  return null;
}

async function loadSession(req) {
  const token = readToken(req);
  if (!token) return null;
  const row = await db.one(
    `SELECT t.token, t.owner_type, t.owner_id, t.expires_at
       FROM tokens t WHERE t.token = ? AND t.expires_at > NOW()`,
    [token]
  );
  if (!row) return null;
  const table = row.owner_type === 'admin' ? 'admins' : 'students';
  const user = await db.one(
    `SELECT id, username, name, status FROM ${table} WHERE id = ?`,
    [row.owner_id]
  );
  if (!user || !user.status) return null;
  return { token, type: row.owner_type, id: user.id, username: user.username, name: user.name };
}

/** 要求已登录（任意角色） */
function requireAuth(req, res, next) {
  loadSession(req).then((s) => {
    if (!s) return res.status(401).json({ error: 'UNAUTHORIZED', message: '登录已失效，请重新登录' });
    req.session = s;
    next();
  }).catch(next);
}

/** 要求指定角色 */
function requireRole(role) {
  return (req, res, next) => {
    requireAuth(req, res, () => {
      if (req.session.type !== role) {
        return res.status(403).json({ error: 'FORBIDDEN', message: '当前账号无该操作权限' });
      }
      next();
    });
  };
}

module.exports = {
  hashPassword, verifyPassword,
  issueToken, revokeToken, startTokenGc,
  requireAuth, requireRole, loadSession, readToken,
};
