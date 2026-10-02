'use strict';
/**
 * 会员体系核心逻辑
 * ─────────────────────────────────────────────────────────────────────
 * 会员类型：none 普通（0 元）｜week 周｜month 月｜year 年｜forever 永久
 *
 * 时长规则（与需求一致）：
 *   · 周会员 = 自设置时刻起 7 天整
 *   · 月会员 = 自设置时刻起 30 天整
 *   · 年会员 = 自设置时刻起 365 天整
 *   · 永久会员 = 无到期时间（member_expire_at 为 NULL）
 *
 * 续费叠加规则：
 *   新到期时刻 = max(当前时刻, 原到期时刻) + 本次时长
 *   例：剩余 2 天 2 小时 45 分 1 秒时充值周会员
 *      → 2d2h45m1s + 7d = 9d2h45m1s
 *   管理员可在任意时刻（含 3 秒内、连续多次）对同一账号重复设置，
 *   可叠加同类型或不同类型；一旦拥有永久会员，其后再设置仍保持永久。
 *
 * 到期处理：
 *   ① 惰性判定 —— 每次鉴权读取会员态时，若已过期则实时按普通会员处理；
 *   ② 定时降级 —— 每分钟扫描一次，把过期账号批量落库为 none 并清除其登录令牌
 *      （实现「会员期限结束后，无论是否在登录状态都会被强制退出」）。
 */
const db = require('./db');

/** 会员类型 → 时长天数（0 表示永久） */
const MEMBER_DAYS = { none: 0, week: 7, month: 30, year: 365, forever: 0 };
/** 需要付费的会员类型（即「超级会员」） */
const SUPER_TYPES = ['week', 'month', 'year', 'forever'];
/** 会员类型中文名 */
const MEMBER_CN = {
  none: '普通会员', week: '周会员', month: '月会员',
  year: '年会员', forever: '永久会员',
};

function isSuperType(t) { return SUPER_TYPES.indexOf(String(t)) >= 0; }

/**
 * 计算新的到期时刻。
 * @param {string} curType    当前会员类型
 * @param {Date|string|null} curExpire 当前到期时刻
 * @param {string} newType    本次要设置的类型
 * @param {Date} [now]        基准时刻（默认当前）
 * @returns {{type: string, expire: Date|null, daysAdded: number, baseFrom: Date|null}}
 */
function computeGrant(curType, curExpire, newType, now) {
  const t = now || new Date();
  const nt = isSuperType(newType) ? newType : 'none';

  if (nt === 'none') {
    // 管理员把用户改回普通会员：立即失效
    return { type: 'none', expire: null, daysAdded: 0, baseFrom: null };
  }

  // 已经是永久会员 → 永久不可逆（再充值仍为永久）
  if (String(curType) === 'forever') {
    return { type: 'forever', expire: null, daysAdded: 0, baseFrom: null };
  }

  // 本次设置永久 → 直接永久
  if (nt === 'forever') {
    return { type: 'forever', expire: null, daysAdded: 0, baseFrom: null };
  }

  // 叠加：以「当前时刻」与「原到期时刻」中较晚者为基准
  const cur = curExpire ? new Date(curExpire) : null;
  let base = t;
  if (cur && cur.getTime() > t.getTime()) base = cur;

  const days = MEMBER_DAYS[nt] || 0;
  const expire = new Date(base.getTime() + days * 24 * 3600 * 1000);
  return { type: nt, expire, daysAdded: days, baseFrom: base };
}

/**
 * 依据数据库行计算「当前有效」的会员态（惰性判定，不写库）。
 * @returns {{type:string, isSuper:boolean, expire:Date|null, expired:boolean,
 *            remainMs:number, permanent:boolean, levelLabel:string}}
 */
function effectiveMember(row, now) {
  const t = now || new Date();
  const rawType = String((row && row.member_type) || 'none');
  const rawExpire = row && row.member_expire_at ? new Date(row.member_expire_at) : null;

  if (rawType === 'forever') {
    return {
      type: 'forever', isSuper: true, expire: null, expired: false,
      remainMs: Infinity, permanent: true, levelLabel: '超级会员',
    };
  }
  if (!isSuperType(rawType)) {
    return {
      type: 'none', isSuper: false, expire: null, expired: false,
      remainMs: 0, permanent: false, levelLabel: '普通会员',
    };
  }
  // 有限期会员：判断是否已到期
  if (!rawExpire || rawExpire.getTime() <= t.getTime()) {
    return {
      type: 'none', isSuper: false, expire: rawExpire, expired: true,
      remainMs: 0, permanent: false, levelLabel: '普通会员',
      expiredFrom: rawType,
    };
  }
  return {
    type: rawType, isSuper: true, expire: rawExpire, expired: false,
    remainMs: rawExpire.getTime() - t.getTime(), permanent: false,
    levelLabel: '超级会员',
  };
}

/** 由会员态生成前端需要的展示字段 */
function memberView(m, now) {
  const t = now || new Date();
  const out = {
    type: m.type,
    label: MEMBER_CN[m.type] || '普通会员',
    levelLabel: m.levelLabel,
    isSuper: m.isSuper,
    permanent: !!m.permanent,
    expired: !!m.expired,
    expireAt: m.expire ? fmt(m.expire) : null,
    // ⚠️ 必须用 Math.floor，不能用 `| 0`：按位或会截断成 32 位有符号整数，
    // 剩余超过 ~24.8 天（2^31 ms）就会溢出为负数 → 被 Math.max 归零，
    // 导致月/年会员被误判成「剩余 0 天 / 不足 3 天」，倒计时也完全错乱。
    remainMs: m.permanent ? null
      : (Number.isFinite(m.remainMs) ? Math.max(0, Math.floor(m.remainMs)) : 0),
    remainDays: 0,
    almostDue: false,          // 剩余不足 3 天
    dueWarning: '',
  };
  if (!m.permanent && m.isSuper) {
    out.remainDays = Math.floor(out.remainMs / 86400000);
    out.almostDue = out.remainMs < 3 * 24 * 3600 * 1000;
    if (out.almostDue) {
      out.dueWarning = '你的会员期限已不足3天，为了能够正常使用该平台，请及时联系管理员进行续费！';
    }
  }
  return out;
}

/** Date → 'YYYY-MM-DD HH:mm:ss'（本地时区，与 MySQL DATETIME 对齐） */
function fmt(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return null;
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate()) + ' ' +
    p(dt.getHours()) + ':' + p(dt.getMinutes()) + ':' + p(dt.getSeconds());
}

/** 写会员变更流水 */
async function logMember(studentId, payload) {
  const p = payload || {};
  await db.run(
    'INSERT INTO member_logs (student_id, action, type_from, type_to, expire_from, expire_to,' +
    ' days_added, operator_type, operator_id, operator_name, remark)' +
    ' VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [studentId, p.action || 'grant', p.typeFrom || '', p.typeTo || '',
      p.expireFrom ? fmt(p.expireFrom) : null, p.expireTo ? fmt(p.expireTo) : null,
      p.daysAdded || 0, p.operatorType || 'admin',
      p.operatorId || null, p.operatorName || '', p.remark || '']
  );
}

/**
 * 给用户设置会员（管理员操作）。
 * 不限制频率：3 秒内、甚至连续多次设置都会正确叠加。
 * @param {object} opts { studentId, memberType, operatorId, operatorName, remark }
 * @returns {Promise<object>} 变更前后信息
 */
async function grantMember(opts) {
  const studentId = Number(opts.studentId);
  const rows = await db.q(
    'SELECT id, username, name, member_type, member_expire_at, status FROM students WHERE id = ?',
    [studentId]
  );
  if (!rows.length) {
    const e = new Error('用户不存在');
    e.status = 404; e.code = 'NOT_FOUND';
    throw e;
  }
  const s = rows[0];
  const before = effectiveMember(s);
  const g = computeGrant(s.member_type, s.member_expire_at, opts.memberType);

  await db.run(
    'UPDATE students SET member_type = ?, member_expire_at = ?, member_started_at = NOW() WHERE id = ?',
    [g.type, g.expire ? fmt(g.expire) : null, studentId]
  );
  await logMember(studentId, {
    action: before.isSuper ? 'renew' : 'grant',
    typeFrom: before.type,
    typeTo: g.type,
    expireFrom: before.expire,
    expireTo: g.expire,
    daysAdded: g.daysAdded,
    operatorType: 'admin',
    operatorId: opts.operatorId,
    operatorName: opts.operatorName,
    remark: opts.remark || '',
  });

  const after = effectiveMember({ member_type: g.type, member_expire_at: g.expire });
  return {
    student: { id: s.id, username: s.username, name: s.name },
    before: memberView(before),
    after: memberView(after),
    daysAdded: g.daysAdded,
    baseFrom: g.baseFrom ? fmt(g.baseFrom) : null,
    stacked: !!(g.baseFrom && before.expire && before.expire.getTime() > Date.now()),
  };
}

/** 禁用 / 启用账号 */
async function setStatus(studentId, status, opts) {
  const st = Number(status) ? 1 : 0;
  await db.run('UPDATE students SET status = ? WHERE id = ?', [st, Number(studentId)]);
  await logMember(studentId, {
    action: st ? 'enable' : 'disable',
    typeFrom: '', typeTo: '',
    operatorType: 'admin',
    operatorId: (opts || {}).operatorId,
    operatorName: (opts || {}).operatorName,
    remark: st ? '恢复使用' : '禁止使用',
  });
  if (!st) {
    // 禁用时立刻踢下线
    await db.run("DELETE FROM tokens WHERE owner_type = 'student' AND owner_id = ?", [Number(studentId)]);
  }
  return { id: Number(studentId), status: st };
}

/**
 * 扫描并降级所有已过期会员。
 * 同时清除其登录令牌 → 实现「不管是否在登录状态，直接退出登录」。
 * @returns {Promise<number>} 本次降级的账号数
 */
async function downgradeExpired() {
  const expired = await db.q(
    "SELECT id, username, member_type, member_expire_at FROM students" +
    " WHERE member_type NOT IN ('none','forever')" +
    "   AND member_expire_at IS NOT NULL AND member_expire_at <= NOW()"
  );
  if (!expired.length) return 0;

  for (const s of expired) {
    await db.run(
      "UPDATE students SET member_type = 'none', member_expire_at = NULL WHERE id = ?",
      [s.id]
    );
    await db.run("DELETE FROM tokens WHERE owner_type = 'student' AND owner_id = ?", [s.id]);
    await logMember(s.id, {
      action: 'expire', typeFrom: s.member_type, typeTo: 'none',
      expireFrom: s.member_expire_at, expireTo: null,
      operatorType: 'system', remark: '会员到期自动降级为普通会员',
    });
    await db.run(
      "INSERT INTO activity (actor_type, actor_id, actor_name, action, target, detail)" +
      " VALUES ('system', ?, ?, 'member_expire', ?, ?)",
      [s.id, s.username, s.username, '会员到期，已自动降级为普通会员']
    );
  }
  return expired.length;
}

/** 启动到期扫描定时任务（60 秒一次） */
function startMemberGc() {
  const tick = () => downgradeExpired().catch(() => {});
  tick();
  const timer = setInterval(tick, 60 * 1000);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = {
  MEMBER_DAYS, MEMBER_CN, SUPER_TYPES, isSuperType,
  computeGrant, effectiveMember, memberView, fmt,
  grantMember, setStatus, downgradeExpired, startMemberGc, logMember,
};
