'use strict';
/**
 * 鉴权：口令哈希（scrypt，与 db/gen_seed.py 生成的格式完全互认）+ Bearer Token 中间件
 *
 * 哈希格式：scrypt$N$r$p$<saltHex>$<hashHex>
 */
const crypto = require('crypto');
const db = require('./db');
const M = require('./member');

const TTL_HOURS = Number(process.env.TOKEN_TTL_HOURS || 720);

/** 账号被禁用时的统一提示 */
const DISABLED_MSG = '您的账号已被管理员设置为禁用，请联系管理员开通账号使用权限';
/** 需要超级会员才能使用的功能提示 */
const NEED_MEMBER_MSG = '你还未开通会员，无法使用打卡平台，请联系管理员开通会员后再使用！';
/** 学习内容被锁定的提示 */
const LOCKED_MSG = '你还未开通超级会员，请联系管理员开通后进行学习！';

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

  if (row.owner_type === 'admin') {
    const a = await db.one('SELECT id, username, name, status FROM admins WHERE id = ?', [row.owner_id]);
    if (!a) return null;
    if (!a.status) return { token, type: 'admin', disabled: true, id: a.id, username: a.username, name: a.name };
    return {
      token, type: 'admin', disabled: false,
      id: a.id, username: a.username, name: a.name,
      isSuper: true, member: { type: 'forever', isSuper: true, levelLabel: '管理员', permanent: true },
    };
  }

  const s = await db.one(
    'SELECT id, username, name, phone, status, member_type, member_expire_at, member_started_at' +
    ' FROM students WHERE id = ?',
    [row.owner_id]
  );
  if (!s) return null;

  const eff = M.effectiveMember(s);
  const sess = {
    token, type: 'student', disabled: !s.status,
    id: s.id, username: s.username, name: s.name, phone: s.phone || '',
    isSuper: eff.isSuper, member: M.memberView(eff),
  };
  // 惰性补写：库里已过期但尚未被定时任务降级的，读到时立即落库为普通会员
  if (eff.expired) {
    db.run("UPDATE students SET member_type='none', member_expire_at=NULL WHERE id=? AND member_type<>'none'", [s.id])
      .catch(() => {});
  }
  return sess;
}

/** 要求已登录（任意角色） */
function requireAuth(req, res, next) {
  loadSession(req).then((s) => {
    if (!s) return res.status(401).json({ error: 'UNAUTHORIZED', message: '登录已失效，请重新登录' });
    if (s.disabled) {
      return res.status(403).json({ error: 'ACCOUNT_DISABLED', code: 'ACCOUNT_DISABLED', message: DISABLED_MSG });
    }
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

/**
 * 要求超级会员（打卡平台门禁）。
 * 普通会员 / 已过期 → 403 NEED_MEMBER；被禁用 → 403 ACCOUNT_DISABLED
 */
function requireSuper(req, res, next) {
  requireAuth(req, res, () => {
    if (req.session.type !== 'student') {
      return res.status(403).json({ error: 'FORBIDDEN', message: '请使用学生账号登录打卡平台' });
    }
    if (!req.session.isSuper) {
      return res.status(403).json({
        error: 'NEED_MEMBER', code: 'NEED_MEMBER', message: NEED_MEMBER_MSG,
        member: req.session.member,
      });
    }
    next();
  });
}

module.exports = {
  hashPassword, verifyPassword,
  issueToken, revokeToken, startTokenGc,
  requireAuth, requireRole, requireSuper, loadSession, readToken,
  DISABLED_MSG, NEED_MEMBER_MSG, LOCKED_MSG,
};
