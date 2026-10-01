'use strict';
/**
 * 学生端接口
 *   学习目录树 / 单元详情 / 打卡 / 撤销打卡 / 我的记录与统计 / 督促消息 / 练习
 */
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const { ah, bad, notFound, logActivity, unitPaths, clampInt, percent, str } = require('../util');

const router = express.Router();

// 双保险：本路由挂在 /api 下，遇到 /api/admin/* 直接放行，
// 交由管理端路由（已优先注册）或 404 处理，避免误判权限。
router.use((req, res, next) => {
  if (req.path.startsWith('/admin')) return next();
  return auth.requireRole('student')(req, res, next);
});

/* ───────────────────────── 目录树 ───────────────────────── */

/**
 * GET /api/tree?withProgress=1&checkableOnly=0
 * 返回扁平目录树 + 每个节点的打卡统计（含子孙累计）
 */
router.get('/tree', ah(async (req, res) => {
  const sid = req.session.id;
  const units = await db.q(
    `SELECT id, parent_id, level, title, summary, content_type, difficulty,
            is_checkable, sort_order, example
       FROM units WHERE status = 1
      ORDER BY level, sort_order, id`
  );
  const checkable = units.filter((u) => u.is_checkable);
  const ids = checkable.map((u) => u.id);
  const doneSet = new Set();
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    const rows = await db.q(
      `SELECT unit_id FROM checkins WHERE student_id = ? AND status = 'done' AND unit_id IN (${ph})`,
      [sid, ...ids]
    );
    rows.forEach((r) => doneSet.add(Number(r.unit_id)));
  }

  const byParent = new Map();
  units.forEach((u) => {
    const p = u.parent_id == null ? 0 : Number(u.parent_id);
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(u);
  });

  // 自底向上累计：可打卡数 / 已完成数
  const stat = new Map();
  function calc(id) {
    if (stat.has(id)) return stat.get(id);
    let total = 0, done = 0;
    const self = units.find((u) => u.id === id);
    if (self && self.is_checkable) { total += 1; if (doneSet.has(id)) done += 1; }
    (byParent.get(id) || []).forEach((c) => {
      const s = calc(Number(c.id));
      total += s.total; done += s.done;
    });
    const r = { total, done };
    stat.set(id, r);
    return r;
  }
  units.forEach((u) => calc(Number(u.id)));

  res.json({
    tree: units.map((u) => {
      const s = stat.get(Number(u.id)) || { total: 0, done: 0 };
      return {
        id: Number(u.id), parentId: u.parent_id == null ? null : Number(u.parent_id),
        level: u.level, title: u.title, summary: u.summary,
        contentType: u.content_type, difficulty: u.difficulty,
        checkable: !!u.is_checkable, example: u.example,
        done: doneSet.has(Number(u.id)),
        total: s.total, completed: s.done,
        percent: percent(s.done, s.total),
      };
    }),
    totals: stat.get(0) || { total: 0, done: 0 },
  });
}));

/**
 * GET /api/units/:id  单元详情：自身 + 子节点 + 我的打卡
 */
router.get('/units/:id', ah(async (req, res) => {
  const id = clampInt(req.params.id, 1, 1e9, 0);
  const u = await db.one('SELECT * FROM units WHERE id = ?', [id]);
  if (!u) throw notFound('该学习内容不存在');
  const children = await db.q(
    `SELECT id, parent_id, level, title, summary, content_type, body, lang, example,
            difficulty, is_checkable, sort_order
       FROM units WHERE parent_id = ? AND status = 1 ORDER BY sort_order, id`,
    [id]
  );
  const ck = await db.one(
    `SELECT checkin_date, status, created_at, updated_at FROM checkins
      WHERE student_id = ? AND unit_id = ?`,
    [req.session.id, id]
  );
  const paths = await unitPaths([id]);
  res.json({
    unit: {
      id: Number(u.id), parentId: u.parent_id == null ? null : Number(u.parent_id),
      level: u.level, title: u.title, summary: u.summary,
      contentType: u.content_type, body: u.body, lang: u.lang,
      difficulty: u.difficulty, checkable: !!u.is_checkable, example: u.example,
      path: paths.get(id) || u.title,
    },
    children: children.map((c) => ({
      id: Number(c.id), level: c.level, title: c.title, summary: c.summary,
      contentType: c.content_type, body: c.body, lang: c.lang,
      difficulty: c.difficulty, checkable: !!c.is_checkable, example: c.example,
    })),
    checkin: ck && ck.status === 'done'
      ? { done: true, date: ck.checkin_date, at: ck.updated_at }
      : { done: false },
  });
}));

/* ───────────────────────── 打卡 ───────────────────────── */

/**
 * POST /api/checkins  { unitIds: [1,2], date: 'YYYY-MM-DD' }
 * 只有 is_checkable 的单元可以被打卡
 */
router.post('/checkins', ah(async (req, res) => {
  const sid = req.session.id;
  const ids = normalizeIds(req.body.unitIds);
  if (!ids.length) throw bad('请先勾选要打卡的内容');
  const date = normalizeDate(req.body.date);

  const ph = ids.map(() => '?').join(',');
  const valid = await db.q(
    `SELECT id FROM units WHERE id IN (${ph}) AND is_checkable = 1 AND status = 1`, ids
  );
  const validIds = valid.map((r) => Number(r.id));
  if (!validIds.length) throw bad('所选内容不支持打卡');

  const paths = await unitPaths(validIds);
  const titles = new Map((await db.q(
    `SELECT id, title FROM units WHERE id IN (${validIds.map(() => '?').join(',')})`, validIds
  )).map((r) => [Number(r.id), r.title]));

  let created = 0, updated = 0;
  for (const uid of validIds) {
    const r = await db.run(
      `INSERT INTO checkins (student_id, unit_id, checkin_date, status)
       VALUES (?, ?, ?, 'done')
       ON DUPLICATE KEY UPDATE
         checkin_date = VALUES(checkin_date),
         status = 'done',
         updated_at = NOW()`,
      [sid, uid, date]
    );
    if (r.affectedRows === 1) created += 1; else updated += 1;
    await db.run(
      `INSERT INTO checkin_logs (student_id, unit_id, action, new_date, unit_title, unit_path)
       VALUES (?, ?, 'checkin', ?, ?, ?)`,
      [sid, uid, date, str(titles.get(uid), 200), str(paths.get(uid), 500)]
    );
    await logActivity('student', sid, req.session.name, 'checkin',
      str(titles.get(uid), 200), `打卡日期 ${date}`);
  }
  res.json({ ok: true, created, updated, date, count: validIds.length });
}));

/**
 * POST /api/checkins/revoke  { unitIds: [] }
 * 学生撤销自己的打卡 → 后台会看到「已撤销打卡」流水
 */
router.post('/checkins/revoke', ah(async (req, res) => {
  const sid = req.session.id;
  const ids = normalizeIds(req.body.unitIds);
  if (!ids.length) throw bad('请先勾选要撤销的内容');
  const ph = ids.map(() => '?').join(',');
  const rows = await db.q(
    `SELECT c.unit_id, c.checkin_date, u.title
       FROM checkins c JOIN units u ON u.id = c.unit_id
      WHERE c.student_id = ? AND c.status = 'done' AND c.unit_id IN (${ph})`,
    [sid, ...ids]
  );
  if (!rows.length) throw bad('所选内容当前没有有效打卡');
  const paths = await unitPaths(rows.map((r) => Number(r.unit_id)));

  for (const r of rows) {
    await db.run(
      `DELETE FROM checkins WHERE student_id = ? AND unit_id = ?`,
      [sid, r.unit_id]
    );
    await db.run(
      `INSERT INTO checkin_logs (student_id, unit_id, action, prev_date, unit_title, unit_path)
       VALUES (?, ?, 'revoke', ?, ?, ?)`,
      [sid, r.unit_id, r.checkin_date, str(r.title, 200), str(paths.get(Number(r.unit_id)), 500)]
    );
    await logActivity('student', sid, req.session.name, 'revoke',
      str(r.title, 200), `撤销 ${r.checkin_date} 的打卡`);
  }
  res.json({ ok: true, count: rows.length });
}));

/** GET /api/my/checkins?limit= */
router.get('/my/checkins', ah(async (req, res) => {
  const limit = clampInt(req.query.limit, 1, 2000, 500);
  const rows = await db.q(
    `SELECT c.unit_id, c.checkin_date, c.created_at, c.updated_at,
            u.title, u.level, u.is_checkable, u.difficulty
       FROM checkins c JOIN units u ON u.id = c.unit_id
      WHERE c.student_id = ? AND c.status = 'done'
      ORDER BY c.checkin_date DESC, c.updated_at DESC
      LIMIT ${limit}`,
    [req.session.id]
  );
  const paths = await unitPaths(rows.map((r) => Number(r.unit_id)));
  res.json({
    items: rows.map((r) => ({
      unitId: Number(r.unit_id), title: r.title, path: paths.get(Number(r.unit_id)) || r.title,
      date: r.checkin_date, at: r.updated_at, difficulty: r.difficulty,
    })),
  });
}));

/** GET /api/my/stats */
router.get('/my/stats', ah(async (req, res) => {
  const sid = req.session.id;
  const total = await db.scalar('SELECT COUNT(*) FROM units WHERE is_checkable = 1 AND status = 1');
  const done = await db.scalar(
    `SELECT COUNT(*) FROM checkins c JOIN units u ON u.id = c.unit_id
      WHERE c.student_id = ? AND c.status = 'done' AND u.is_checkable = 1 AND u.status = 1`, [sid]
  );
  const days = await db.q(
    `SELECT checkin_date AS d, COUNT(*) AS n FROM checkins
      WHERE student_id = ? AND status = 'done' GROUP BY checkin_date ORDER BY checkin_date DESC`,
    [sid]
  );
  const unread = await db.scalar(
    `SELECT COUNT(*) FROM urge_targets t JOIN urges g ON g.id = t.urge_id
      WHERE t.student_id = ? AND t.read_at IS NULL`, [sid]
  );
  const recent = await db.q(
    `SELECT l.action, l.unit_title AS title, l.new_date, l.prev_date, l.created_at
       FROM checkin_logs l WHERE l.student_id = ?
      ORDER BY l.created_at DESC LIMIT 8`, [sid]
  );
  res.json({
    total: Number(total || 0),
    done: Number(done || 0),
    percent: percent(done, total),
    activeDays: days.length,
    today: days.find((d) => d.d === todayStr())?.n || 0,
    streak: calcStreak(days.map((d) => d.d)),
    unreadUrges: Number(unread || 0),
    recent: recent.map((r) => ({
      action: r.action, title: r.title, date: r.new_date || r.prev_date, at: r.created_at,
    })),
  });
}));

/* ───────────────────────── 督促消息 ───────────────────────── */

/** GET /api/my/messages */
router.get('/my/messages', ah(async (req, res) => {
  const sid = req.session.id;
  const rows = await db.q(
    `SELECT t.id AS target_id, t.read_at, t.done_at, g.id AS urge_id, g.title, g.message,
            g.deadline, g.priority, g.created_at, g.unit_id, g.unit_path,
            a.name AS admin_name
       FROM urge_targets t
       JOIN urges g ON g.id = t.urge_id
       LEFT JOIN admins a ON a.id = g.admin_id
      WHERE t.student_id = ?
      ORDER BY t.read_at IS NULL DESC, g.created_at DESC
      LIMIT 200`,
    [sid]
  );
  res.json({
    items: rows.map((r) => ({
      targetId: Number(r.target_id), urgeId: Number(r.urge_id),
      title: r.title, message: r.message, unitId: r.unit_id ? Number(r.unit_id) : null,
      unitPath: r.unit_path, deadline: r.deadline, priority: r.priority,
      adminName: r.admin_name || '管理员', createdAt: r.created_at,
      read: !!r.read_at, done: !!r.done_at,
      overdue: r.deadline ? new Date(r.deadline.replace(' ', 'T')) < new Date() && !r.done_at : false,
    })),
  });
}));

/** POST /api/my/messages/:targetId/read */
router.post('/my/messages/:targetId/read', ah(async (req, res) => {
  const id = clampInt(req.params.targetId, 1, 1e15, 0);
  await db.run(
    `UPDATE urge_targets SET read_at = IFNULL(read_at, NOW())
      WHERE id = ? AND student_id = ?`, [id, req.session.id]
  );
  res.json({ ok: true });
}));

/** POST /api/my/messages/:targetId/done  标记督促已完成 */
router.post('/my/messages/:targetId/done', ah(async (req, res) => {
  const id = clampInt(req.params.targetId, 1, 1e15, 0);
  const t = await db.one('SELECT * FROM urge_targets WHERE id = ? AND student_id = ?', [id, req.session.id]);
  if (!t) throw notFound('该督促不存在');
  await db.run(
    `UPDATE urge_targets SET done_at = NOW(), read_at = IFNULL(read_at, NOW()) WHERE id = ?`, [id]
  );
  await logActivity('student', req.session.id, req.session.name, 'urge_done', `#${t.urge_id}`, '标记督促已完成');
  res.json({ ok: true });
}));

/* ───────────────────────── 练习 / 出题 ───────────────────────── */

/** GET /api/my/exercises?unitId= */
router.get('/my/exercises', ah(async (req, res) => {
  const sid = req.session.id;
  const unitId = clampInt(req.query.unitId, 1, 1e9, 0);
  const where = unitId ? 'q.unit_id = ? AND' : '';
  const rows = await db.q(
    `SELECT q.id, q.unit_id, q.type, q.stem, q.options, q.difficulty, q.score,
            a.student_answer, a.is_correct, a.created_at AS answered_at
       FROM questions q
       LEFT JOIN answers a ON a.question_id = q.id AND a.student_id = ?
      WHERE ${where} q.status = 1
      ORDER BY q.id`,
    unitId ? [sid, unitId] : [sid]
  );
  const paths = await unitPaths(rows.map((r) => Number(r.unit_id)));
  res.json({
    items: rows.map((r) => ({
      id: Number(r.id), unitId: r.unit_id ? Number(r.unit_id) : null,
      unitPath: paths.get(Number(r.unit_id)) || '',
      type: r.type, stem: r.stem,
      options: safeJson(r.options),
      difficulty: r.difficulty, score: r.score,
      answered: !!r.answered_at,
      myAnswer: r.student_answer,
      correct: r.is_correct == null ? null : !!r.is_correct,
    })),
  });
}));

/** POST /api/my/exercises/submit  { questionId, answer } */
router.post('/my/exercises/submit', ah(async (req, res) => {
  const sid = req.session.id;
  const qid = clampInt(req.body.questionId, 1, 1e9, 0);
  const ans = str(req.body.answer, 500);
  const q = await db.one('SELECT * FROM questions WHERE id = ? AND status = 1', [qid]);
  if (!q) throw notFound('题目不存在');
  const correct = judge(q, ans);
  await db.run(
    `INSERT INTO answers (student_id, question_id, student_answer, is_correct)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE student_answer = VALUES(student_answer),
                             is_correct = VALUES(is_correct), created_at = NOW()`,
    [sid, qid, ans, correct ? 1 : 0]
  );
  res.json({
    ok: true, correct,
    answer: q.answer,
    analysis: q.analysis || '',
  });
}));

/* ───────────────────────── 辅助 ───────────────────────── */

function normalizeIds(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  v.forEach((x) => {
    const n = parseInt(x, 10);
    if (Number.isFinite(n) && n > 0 && !out.includes(n)) out.push(n);
  });
  return out.slice(0, 500);
}

function normalizeDate(v) {
  const s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + 'T00:00:00');
    if (!Number.isNaN(d.getTime())) return s;
  }
  return todayStr();
}

function todayStr() {
  const d = new Date();
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function calcStreak(dateStrs) {
  const set = new Set(dateStrs);
  let n = 0;
  const cur = new Date();
  for (let i = 0; i < 400; i++) {
    const p = (x) => (x < 10 ? '0' + x : '' + x);
    const s = cur.getFullYear() + '-' + p(cur.getMonth() + 1) + '-' + p(cur.getDate());
    if (set.has(s)) n++;
    else if (i > 0) break;
    cur.setDate(cur.getDate() - 1);
  }
  return n;
}

function safeJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch (e) { return null; }
}

function judge(q, ans) {
  const a = String(q.answer || '').trim();
  const b = String(ans || '').trim();
  if (q.type === 'multiple') {
    const norm = (s) => s.toUpperCase().split('').filter((c) => /[A-Z]/.test(c)).sort().join('');
    return norm(a) === norm(b);
  }
  if (q.type === 'judge') {
    const t = (s) => ({ '1': '1', '0': '0', 'true': '1', 'false': '0', '对': '1', '错': '0', '是': '1', '否': '0' })[String(s).toLowerCase()] ?? String(s);
    return t(a) === t(b);
  }
  if (q.type === 'fill' || q.type === 'short') {
    const norm = (s) => s.replace(/\s+/g, '').toLowerCase();
    if (norm(a) === norm(b)) return true;
    // 多答案以 | 分隔，命中其一即算对
    return a.split('|').some((x) => norm(x) === norm(b));
  }
  return a.toUpperCase() === b.toUpperCase();
}

module.exports = router;
