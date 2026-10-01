'use strict';
/**
 * 管理端接口
 *   数据面板 / 学生名单 CRUD / 目录与内容 CRUD / 督促 / 题库 / 动态流水
 */
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const {
  ah, bad, notFound, logActivity, unitPath, unitPaths, descendantIds, clampInt, percent, str,
} = require('../util');

const router = express.Router();
router.use(auth.requireRole('admin'));

/* ═══════════════════ 1. 数据面板 ═══════════════════ */

/** GET /api/admin/overview —— 顶部统计 + 学生排行 + 每日趋势 */
router.get('/overview', ah(async (req, res) => {
  const totalUnits = await db.scalar('SELECT COUNT(*) FROM units WHERE is_checkable = 1 AND status = 1');
  const totalStudents = await db.scalar('SELECT COUNT(*) FROM students WHERE status = 1');
  const totalCheckins = await db.scalar(`SELECT COUNT(*) FROM checkins WHERE status = 'done'`);
  const revokes = await db.scalar(`SELECT COUNT(*) FROM checkin_logs WHERE action = 'revoke'`);
  const todayCheckins = await db.scalar(
    `SELECT COUNT(*) FROM checkins WHERE status = 'done' AND checkin_date = CURDATE()`
  );
  const pendingUrges = await db.scalar(
    `SELECT COUNT(*) FROM urge_targets WHERE read_at IS NULL`
  );

  // 学生进度排行
  const students = await db.q(
    `SELECT s.id, s.name, s.username, s.sno, s.class_name, s.phone, s.last_login_at,
            (SELECT COUNT(*) FROM checkins c JOIN units u ON u.id = c.unit_id
              WHERE c.student_id = s.id AND c.status = 'done' AND u.is_checkable = 1 AND u.status = 1) AS done_cnt,
            (SELECT MAX(c.updated_at) FROM checkins c WHERE c.student_id = s.id AND c.status='done') AS last_checkin_at,
            (SELECT COUNT(*) FROM urge_targets t WHERE t.student_id = s.id AND t.read_at IS NULL) AS unread_urges
       FROM students s WHERE s.status = 1
      ORDER BY done_cnt DESC, s.id`
  );

  // 近 14 天打卡趋势
  const trend = await db.q(
    `SELECT checkin_date AS d, COUNT(DISTINCT student_id) AS students, COUNT(*) AS n
       FROM checkins WHERE status = 'done' AND checkin_date >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
      GROUP BY checkin_date ORDER BY checkin_date`
  );

  // 按主目录统计完成情况
  const byRoot = await db.q(
    `SELECT r.id, r.title,
            (SELECT COUNT(*) FROM units u WHERE u.is_checkable = 1 AND u.status = 1
               AND (u.id = r.id
                    OR u.parent_id = r.id
                    OR u.parent_id IN (SELECT id FROM units WHERE parent_id = r.id)
                    OR u.parent_id IN (SELECT id FROM units WHERE parent_id IN
                         (SELECT id FROM units WHERE parent_id = r.id)))) AS total,
            (SELECT COUNT(*) FROM checkins c JOIN units u ON u.id = c.unit_id
              WHERE c.status = 'done' AND u.is_checkable = 1
               AND (u.id = r.id
                    OR u.parent_id = r.id
                    OR u.parent_id IN (SELECT id FROM units WHERE parent_id = r.id)
                    OR u.parent_id IN (SELECT id FROM units WHERE parent_id IN
                         (SELECT id FROM units WHERE parent_id = r.id)))) AS done
       FROM units r WHERE r.level = 1 AND r.status = 1 ORDER BY r.sort_order, r.id`
  );

  res.json({
    stats: {
      totalUnits: Number(totalUnits || 0),
      totalStudents: Number(totalStudents || 0),
      totalCheckins: Number(totalCheckins || 0),
      todayCheckins: Number(todayCheckins || 0),
      revokes: Number(revokes || 0),
      pendingUrges: Number(pendingUrges || 0),
    },
    students: students.map((s) => ({
      id: Number(s.id), name: s.name, username: s.username, sno: s.sno,
      className: s.class_name, phone: s.phone,
      lastLoginAt: s.last_login_at, lastCheckinAt: s.last_checkin_at,
      done: Number(s.done_cnt || 0),
      percent: percent(s.done_cnt, totalUnits),
      unreadUrges: Number(s.unread_urges || 0),
    })),
    trend: trend.map((t) => ({ date: t.d, students: Number(t.students), count: Number(t.n) })),
    byRoot: byRoot.map((r) => ({
      id: Number(r.id), title: r.title,
      total: Number(r.total || 0), done: Number(r.done || 0),
      percent: percent(r.done, r.total),
    })),
  });
}));

/** GET /api/admin/activity?limit= —— 实时动态（含"已撤销打卡"） */
router.get('/activity', ah(async (req, res) => {
  const limit = clampInt(req.query.limit, 1, 500, 80);
  const rows = await db.q(
    `SELECT id, actor_type, actor_id, actor_name, action, target, detail, created_at
       FROM activity ORDER BY id DESC LIMIT ${limit}`
  );
  res.json({
    items: rows.map((r) => ({
      id: Number(r.id), actorType: r.actor_type, actorId: r.actor_id,
      actorName: r.actor_name, action: r.action, target: r.target,
      detail: r.detail, at: r.created_at,
    })),
  });
}));

/** GET /api/admin/logs?studentId=&action=&limit= —— 打卡流水 */
router.get('/logs', ah(async (req, res) => {
  const limit = clampInt(req.query.limit, 1, 1000, 200);
  const sid = clampInt(req.query.studentId, 0, 1e9, 0);
  const action = ['checkin', 'revoke', 'update'].includes(req.query.action) ? req.query.action : '';
  const cond = [];
  const params = [];
  if (sid) { cond.push('l.student_id = ?'); params.push(sid); }
  if (action) { cond.push('l.action = ?'); params.push(action); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const rows = await db.q(
    `SELECT l.id, l.student_id, l.unit_id, l.action, l.prev_date, l.new_date,
            l.unit_title, l.unit_path, l.created_at, s.name AS student_name, s.sno
       FROM checkin_logs l LEFT JOIN students s ON s.id = l.student_id
       ${where}
      ORDER BY l.id DESC LIMIT ${limit}`,
    params
  );
  res.json({
    items: rows.map((r) => ({
      id: Number(r.id), studentId: Number(r.student_id), studentName: r.student_name || '（已删除）',
      sno: r.sno || '', unitId: r.unit_id ? Number(r.unit_id) : null,
      unitTitle: r.unit_title, unitPath: r.unit_path,
      action: r.action, prevDate: r.prev_date, newDate: r.new_date, at: r.created_at,
    })),
  });
}));

/* ═══════════════════ 2. 学生名单 CRUD ═══════════════════ */

router.get('/students', ah(async (_req, res) => {
  const rows = await db.q(
    `SELECT s.*, (SELECT COUNT(*) FROM checkins c WHERE c.student_id = s.id AND c.status='done') AS done_cnt
       FROM students s ORDER BY s.id`
  );
  const totalUnits = await db.scalar('SELECT COUNT(*) FROM units WHERE is_checkable=1 AND status=1');
  res.json({
    total: Number(totalUnits || 0),
    items: rows.map((s) => ({
      id: Number(s.id), username: s.username, name: s.name, sno: s.sno,
      className: s.class_name, phone: s.phone, email: s.email, remark: s.remark,
      status: Number(s.status), lastLoginAt: s.last_login_at,
      createdAt: s.created_at, done: Number(s.done_cnt || 0),
      percent: percent(s.done_cnt, totalUnits),
    })),
  });
}));

router.post('/students', ah(async (req, res) => {
  const username = str(req.body.username, 64).trim();
  const password = str(req.body.password, 128) || '123456';
  if (!/^[A-Za-z0-9_.@-]{3,64}$/.test(username)) throw bad('账号需为 3-64 位字母、数字或 _ . @ -');
  if (password.length < 6) throw bad('密码至少 6 位');
  const exist = await db.one('SELECT id FROM students WHERE username = ?', [username]);
  if (exist) throw bad('该账号已存在');
  const r = await db.run(
    `INSERT INTO students (username, password_hash, name, sno, class_name, phone, email, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [username, auth.hashPassword(password), str(req.body.name, 64), str(req.body.sno, 64),
     str(req.body.className, 64), str(req.body.phone, 32), str(req.body.email, 128), str(req.body.remark, 255)]
  );
  await logActivity('admin', req.session.id, req.session.name, 'student_add', username, `新增学生 ${req.body.name || ''}`);
  res.json({ ok: true, id: Number(r.insertId) });
}));

router.put('/students/:id', ah(async (req, res) => {
  const id = clampInt(req.params.id, 1, 1e9, 0);
  const s = await db.one('SELECT * FROM students WHERE id = ?', [id]);
  if (!s) throw notFound('学生不存在');
  const fields = {
    name: str(req.body.name ?? s.name, 64),
    sno: str(req.body.sno ?? s.sno, 64),
    class_name: str(req.body.className ?? s.class_name, 64),
    phone: str(req.body.phone ?? s.phone, 32),
    email: str(req.body.email ?? s.email, 128),
    remark: str(req.body.remark ?? s.remark, 255),
    status: req.body.status == null ? s.status : (Number(req.body.status) ? 1 : 0),
  };
  let sql = `UPDATE students SET name=?, sno=?, class_name=?, phone=?, email=?, remark=?, status=?`;
  const params = [fields.name, fields.sno, fields.class_name, fields.phone,
                  fields.email, fields.remark, fields.status];
  if (req.body.password) {
    if (String(req.body.password).length < 6) throw bad('密码至少 6 位');
    sql += ', password_hash = ?';
    params.push(auth.hashPassword(String(req.body.password)));
  }
  sql += ' WHERE id = ?';
  params.push(id);
  await db.run(sql, params);
  await logActivity('admin', req.session.id, req.session.name, 'student_update', s.username,
    `修改学生资料 ${fields.name}`);
  res.json({ ok: true });
}));

router.delete('/students/:id', ah(async (req, res) => {
  const id = clampInt(req.params.id, 1, 1e9, 0);
  const s = await db.one('SELECT * FROM students WHERE id = ?', [id]);
  if (!s) throw notFound('学生不存在');
  await db.run('DELETE FROM students WHERE id = ?', [id]);
  await logActivity('admin', req.session.id, req.session.name, 'student_delete', s.username,
    `删除学生 ${s.name}`);
  res.json({ ok: true });
}));

/** GET /api/admin/students/:id/detail —— 单个学生完整学习档案 */
router.get('/students/:id/detail', ah(async (req, res) => {
  const id = clampInt(req.params.id, 1, 1e9, 0);
  const s = await db.one('SELECT * FROM students WHERE id = ?', [id]);
  if (!s) throw notFound('学生不存在');
  const checkins = await db.q(
    `SELECT c.unit_id, c.checkin_date, c.updated_at, u.title, u.difficulty
       FROM checkins c JOIN units u ON u.id = c.unit_id
      WHERE c.student_id = ? AND c.status = 'done'
      ORDER BY c.updated_at DESC LIMIT 500`, [id]
  );
  const paths = await unitPaths(checkins.map((c) => Number(c.unit_id)));
  const logs = await db.q(
    `SELECT action, unit_title, prev_date, new_date, created_at FROM checkin_logs
      WHERE student_id = ? ORDER BY id DESC LIMIT 80`, [id]
  );
  const answers = await db.q(
    `SELECT COUNT(*) AS n, SUM(is_correct) AS c FROM answers WHERE student_id = ?`, [id]
  );
  const urges = await db.q(
    `SELECT t.id, t.read_at, t.done_at, g.title, g.deadline, g.priority
       FROM urge_targets t JOIN urges g ON g.id = t.urge_id
      WHERE t.student_id = ? ORDER BY g.id DESC LIMIT 50`, [id]
  );
  res.json({
    student: {
      id: Number(s.id), username: s.username, name: s.name, sno: s.sno,
      className: s.class_name, phone: s.phone, email: s.email, remark: s.remark,
      status: Number(s.status), lastLoginAt: s.last_login_at, createdAt: s.created_at,
    },
    checkins: checkins.map((c) => ({
      unitId: Number(c.unit_id), title: c.title, path: paths.get(Number(c.unit_id)) || c.title,
      difficulty: c.difficulty, date: c.checkin_date, at: c.updated_at,
    })),
    logs: logs.map((l) => ({
      action: l.action, title: l.unit_title, prevDate: l.prev_date,
      newDate: l.new_date, at: l.created_at,
    })),
    quiz: {
      answered: Number(answers[0]?.n || 0),
      correct: Number(answers[0]?.c || 0),
    },
    urges: urges.map((u) => ({
      targetId: Number(u.id), title: u.title, deadline: u.deadline,
      priority: u.priority, read: !!u.read_at, done: !!u.done_at,
    })),
  });
}));

/* ═══════════════════ 3. 目录与内容 CRUD ═══════════════════ */

/** GET /api/admin/units —— 全量树（编辑用） */
router.get('/units', ah(async (_req, res) => {
  const rows = await db.q(
    `SELECT u.*, (SELECT COUNT(*) FROM units x WHERE x.parent_id = u.id) AS child_count
       FROM units u ORDER BY u.level, u.sort_order, u.id`
  );
  res.json({
    items: rows.map((u) => ({
      id: Number(u.id), parentId: u.parent_id == null ? null : Number(u.parent_id),
      level: u.level, title: u.title, summary: u.summary,
      contentType: u.content_type, body: u.body, lang: u.lang, example: u.example,
      difficulty: u.difficulty, sortOrder: u.sort_order,
      checkable: !!u.is_checkable, status: Number(u.status),
      childCount: Number(u.child_count || 0), updatedAt: u.updated_at,
    })),
  });
}));

/** GET /api/admin/units/:id */
router.get('/units/:id', ah(async (req, res) => {
  const id = clampInt(req.params.id, 1, 1e9, 0);
  const u = await db.one('SELECT * FROM units WHERE id = ?', [id]);
  if (!u) throw notFound('节点不存在');
  res.json({
    unit: {
      id: Number(u.id), parentId: u.parent_id == null ? null : Number(u.parent_id),
      level: u.level, title: u.title, summary: u.summary,
      contentType: u.content_type, body: u.body, lang: u.lang, example: u.example,
      difficulty: u.difficulty, sortOrder: u.sort_order,
      checkable: !!u.is_checkable, status: Number(u.status),
      path: await unitPath(id),
    },
  });
}));

/** POST /api/admin/units —— 新增主目录 / 次目录 / 学习目录 / 学习内容 */
router.post('/units', ah(async (req, res) => {
  const parentId = req.body.parentId ? clampInt(req.body.parentId, 1, 1e9, 0) : null;
  let level = 1;
  if (parentId) {
    const p = await db.one('SELECT id, level FROM units WHERE id = ?', [parentId]);
    if (!p) throw notFound('父级节点不存在');
    level = Number(p.level) + 1;
    if (level > 4) throw bad('学习内容已是最底层，无法再添加子级');
  }
  const title = str(req.body.title, 200).trim();
  if (!title) throw bad('请填写标题');

  // 目录级默认不可打卡，学习目录默认可打卡
  const checkable = req.body.checkable == null ? (level === 3 ? 1 : 0) : (req.body.checkable ? 1 : 0);
  let sortOrder = req.body.sortOrder;
  if (sortOrder == null) {
    sortOrder = (await db.scalar(
      'SELECT IFNULL(MAX(sort_order), 0) + 10 FROM units WHERE parent_id <=> ?', [parentId]
    )) || 10;
  }
  const r = await db.run(
    `INSERT INTO units (parent_id, level, title, summary, content_type, body, lang, example,
                        difficulty, sort_order, is_checkable, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [parentId, level, title, str(req.body.summary, 500),
     str(req.body.contentType, 20) || 'text',
     req.body.body == null ? null : String(req.body.body),
     str(req.body.lang, 20) || 'bash', str(req.body.example, 500),
     clampInt(req.body.difficulty, 1, 4, 1), clampInt(sortOrder, -999999, 999999, 10),
     checkable, req.body.status == null ? 1 : (req.body.status ? 1 : 0)]
  );
  await logActivity('admin', req.session.id, req.session.name, 'unit_add',
    `L${level} ${title}`, '新增' + ['', '主目录', '次目录', '学习目录', '学习内容'][level]);
  res.json({ ok: true, id: Number(r.insertId), level });
}));

/** PUT /api/admin/units/:id */
router.put('/units/:id', ah(async (req, res) => {
  const id = clampInt(req.params.id, 1, 1e9, 0);
  const u = await db.one('SELECT * FROM units WHERE id = ?', [id]);
  if (!u) throw notFound('节点不存在');
  await db.run(
    `UPDATE units SET title=?, summary=?, content_type=?, body=?, lang=?, example=?,
                      difficulty=?, sort_order=?, is_checkable=?, status=?
      WHERE id = ?`,
    [str(req.body.title ?? u.title, 200),
     str(req.body.summary ?? u.summary, 500),
     str(req.body.contentType ?? u.content_type, 20),
     req.body.body === undefined ? u.body : (req.body.body == null ? null : String(req.body.body)),
     str(req.body.lang ?? u.lang, 20),
     str(req.body.example ?? u.example, 500),
     clampInt(req.body.difficulty ?? u.difficulty, 1, 4, u.difficulty),
     clampInt(req.body.sortOrder ?? u.sort_order, -999999, 999999, u.sort_order),
     req.body.checkable == null ? u.is_checkable : (req.body.checkable ? 1 : 0),
     req.body.status == null ? u.status : (req.body.status ? 1 : 0),
     id]
  );
  await logActivity('admin', req.session.id, req.session.name, 'unit_update',
    u.title, '修改学习内容');
  res.json({ ok: true });
}));

/** DELETE /api/admin/units/:id —— 级联删除子节点 */
router.delete('/units/:id', ah(async (req, res) => {
  const id = clampInt(req.params.id, 1, 1e9, 0);
  const u = await db.one('SELECT * FROM units WHERE id = ?', [id]);
  if (!u) throw notFound('节点不存在');
  const ids = await descendantIds(id);
  await db.run('DELETE FROM units WHERE id = ?', [id]); // 外键 ON DELETE CASCADE 自动清理子树
  await logActivity('admin', req.session.id, req.session.name, 'unit_delete',
    u.title, `删除节点及其 ${ids.length - 1} 个子项`);
  res.json({ ok: true, removed: ids.length });
}));

/** POST /api/admin/units/reorder  { items: [{id, sortOrder, parentId}] } */
router.post('/units/reorder', ah(async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 500) : [];
  for (const it of items) {
    const id = clampInt(it.id, 1, 1e9, 0);
    if (!id) continue;
    await db.run('UPDATE units SET sort_order = ?, parent_id = ? WHERE id = ?',
      [clampInt(it.sortOrder, -999999, 999999, 0),
       it.parentId ? clampInt(it.parentId, 1, 1e9, 0) : null, id]);
  }
  await logActivity('admin', req.session.id, req.session.name, 'unit_reorder', '', `调整 ${items.length} 个节点`);
  res.json({ ok: true });
}));

/* ═══════════════════ 4. 督促 ═══════════════════ */

/** POST /api/admin/urges
 *  { studentIds:[], unitId, title, message, deadline, priority }
 */
router.post('/urges', ah(async (req, res) => {
  const studentIds = (Array.isArray(req.body.studentIds) ? req.body.studentIds : [])
    .map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n) && n > 0).slice(0, 500);
  if (!studentIds.length) throw bad('请至少选择一名学生');

  const unitId = req.body.unitId ? clampInt(req.body.unitId, 1, 1e9, 0) : null;
  let path = '', unitTitle = '';
  if (unitId) {
    const u = await db.one('SELECT id, title FROM units WHERE id = ?', [unitId]);
    if (!u) throw notFound('所选章节不存在');
    unitTitle = u.title;
    path = str(await unitPath(unitId), 500);
  }
  const title = str(req.body.title, 200).trim() ||
    (unitTitle ? `请学习：${unitTitle}` : '管理员督促');
  const message = str(req.body.message, 2000);
  let deadline = null;
  if (req.body.deadline) {
    const d = String(req.body.deadline).replace('T', ' ').slice(0, 19);
    if (/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(d)) {
      deadline = d.length === 10 ? d + ' 23:59:59' : d;
    }
  }
  const priority = clampInt(req.body.priority, 1, 3, 1);

  const r = await db.run(
    `INSERT INTO urges (admin_id, unit_id, unit_path, title, message, deadline, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [req.session.id, unitId, path, title, message, deadline, priority]
  );
  const urgeId = Number(r.insertId);

  for (const sid of studentIds) {
    await db.run(
      `INSERT INTO urge_targets (urge_id, student_id) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE urge_id = VALUES(urge_id)`,
      [urgeId, sid]
    );
  }
  await logActivity('admin', req.session.id, req.session.name, 'urge',
    title, `督促 ${studentIds.length} 人${deadline ? '，截止 ' + deadline : ''}`);
  res.json({ ok: true, urgeId, targets: studentIds.length });
}));

/** GET /api/admin/urges */
router.get('/urges', ah(async (_req, res) => {
  const rows = await db.q(
    `SELECT g.id, g.title, g.message, g.unit_id, g.unit_path, g.deadline, g.priority,
            g.created_at, a.name AS admin_name,
            COUNT(t.id) AS targets,
            SUM(t.read_at IS NOT NULL) AS read_cnt,
            SUM(t.done_at IS NOT NULL) AS done_cnt
       FROM urges g
       LEFT JOIN admins a ON a.id = g.admin_id
       LEFT JOIN urge_targets t ON t.urge_id = g.id
      GROUP BY g.id ORDER BY g.id DESC LIMIT 200`
  );
  res.json({
    items: rows.map((r) => ({
      id: Number(r.id), title: r.title, message: r.message,
      unitId: r.unit_id ? Number(r.unit_id) : null, unitPath: r.unit_path,
      deadline: r.deadline, priority: r.priority, createdAt: r.created_at,
      adminName: r.admin_name || '', targets: Number(r.targets || 0),
      readCount: Number(r.read_cnt || 0), doneCount: Number(r.done_cnt || 0),
    })),
  });
}));

/** GET /api/admin/urges/:id/targets —— 查看某个督促的送达/已读/完成明细 */
router.get('/urges/:id/targets', ah(async (req, res) => {
  const id = clampInt(req.params.id, 1, 1e15, 0);
  const rows = await db.q(
    `SELECT t.id, t.read_at, t.done_at, s.id AS student_id, s.name, s.sno, s.class_name
       FROM urge_targets t JOIN students s ON s.id = t.student_id
      WHERE t.urge_id = ? ORDER BY s.id`, [id]
  );
  res.json({
    items: rows.map((r) => ({
      targetId: Number(r.id), studentId: Number(r.student_id), name: r.name,
      sno: r.sno, className: r.class_name, read: !!r.read_at, readAt: r.read_at,
      done: !!r.done_at, doneAt: r.done_at,
    })),
  });
}));

router.delete('/urges/:id', ah(async (req, res) => {
  const id = clampInt(req.params.id, 1, 1e15, 0);
  await db.run('DELETE FROM urges WHERE id = ?', [id]);
  await logActivity('admin', req.session.id, req.session.name, 'urge_delete', `#${id}`, '删除督促');
  res.json({ ok: true });
}));

/* ═══════════════════ 5. 题库 ═══════════════════ */

router.get('/questions', ah(async (req, res) => {
  const unitId = clampInt(req.query.unitId, 0, 1e9, 0);
  const where = unitId ? 'WHERE q.unit_id = ?' : '';
  const rows = await db.q(
    `SELECT q.*, (SELECT COUNT(*) FROM answers a WHERE a.question_id = q.id) AS answer_cnt,
            (SELECT SUM(a.is_correct) FROM answers a WHERE a.question_id = q.id) AS correct_cnt
       FROM questions q ${where} ORDER BY q.id DESC LIMIT 500`,
    unitId ? [unitId] : []
  );
  const paths = await unitPaths(rows.map((r) => Number(r.unit_id)));
  res.json({
    items: rows.map((r) => ({
      id: Number(r.id), unitId: r.unit_id ? Number(r.unit_id) : null,
      unitPath: paths.get(Number(r.unit_id)) || '',
      unitTitle: r.unit_id ? null : null,
      type: r.type, stem: r.stem, options: safeJson(r.options), answer: r.answer,
      analysis: r.analysis, difficulty: r.difficulty, score: r.score,
      status: Number(r.status), answerCount: Number(r.answer_cnt || 0),
      correctCount: Number(r.correct_cnt || 0),
      correctRate: r.answer_cnt ? Math.round((r.correct_cnt / r.answer_cnt) * 100) : null,
    })),
  });
}));

router.post('/questions', ah(async (req, res) => {
  const stem = str(req.body.stem, 4000).trim();
  if (!stem) throw bad('请填写题干');
  const q = await insertQuestion(req, req.body);
  await logActivity('admin', req.session.id, req.session.name, 'question_add', `#${q}`, str(stem, 80));
  res.json({ ok: true, id: q });
}));

/** 批量导入题目 { items: [{...}] } 或 { unitId, raw } 文本解析 */
router.post('/questions/batch', ah(async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 500) : [];
  if (!items.length) throw bad('没有可导入的题目');
  let n = 0;
  for (const it of items) {
    if (!str(it.stem, 4000).trim()) continue;
    await insertQuestion(req, { ...it, unitId: it.unitId || req.body.unitId });
    n++;
  }
  await logActivity('admin', req.session.id, req.session.name, 'question_batch', '', `批量导入 ${n} 题`);
  res.json({ ok: true, count: n });
}));

router.put('/questions/:id', ah(async (req, res) => {
  const id = clampInt(req.params.id, 1, 1e9, 0);
  const q = await db.one('SELECT * FROM questions WHERE id = ?', [id]);
  if (!q) throw notFound('题目不存在');
  await db.run(
    `UPDATE questions SET unit_id=?, type=?, stem=?, options=?, answer=?, analysis=?,
                         difficulty=?, score=?, status=? WHERE id=?`,
    [req.body.unitId ? clampInt(req.body.unitId, 1, 1e9, 0) : q.unit_id,
     normType(req.body.type ?? q.type), str(req.body.stem ?? q.stem, 4000),
     optJson(req.body.options, q.options), str(req.body.answer ?? q.answer, 500),
     str(req.body.analysis ?? q.analysis, 4000),
     clampInt(req.body.difficulty ?? q.difficulty, 1, 4, 2),
     clampInt(req.body.score ?? q.score, 1, 100, 5),
     req.body.status == null ? q.status : (req.body.status ? 1 : 0), id]
  );
  await logActivity('admin', req.session.id, req.session.name, 'question_update', `#${id}`, '修改题目');
  res.json({ ok: true });
}));

router.delete('/questions/:id', ah(async (req, res) => {
  const id = clampInt(req.params.id, 1, 1e9, 0);
  await db.run('DELETE FROM questions WHERE id = ?', [id]);
  await logActivity('admin', req.session.id, req.session.name, 'question_delete', `#${id}`, '删除题目');
  res.json({ ok: true });
}));

/** GET /api/admin/questions/stats —— 每题正确率（用于出题参考） */
router.get('/questions/stats', ah(async (_req, res) => {
  const rows = await db.q(
    `SELECT q.id, q.stem, q.type, q.difficulty,
            COUNT(a.id) AS n, IFNULL(SUM(a.is_correct),0) AS c
       FROM questions q LEFT JOIN answers a ON a.question_id = q.id
      WHERE q.status = 1 GROUP BY q.id ORDER BY (COUNT(a.id)=0) DESC, c / GREATEST(COUNT(a.id),1) ASC
      LIMIT 100`
  );
  res.json({
    items: rows.map((r) => ({
      id: Number(r.id), stem: r.stem, type: r.type, difficulty: r.difficulty,
      answered: Number(r.n), correct: Number(r.c), wrong: Number(r.n) - Number(r.c),
      rate: r.n ? Math.round((r.c / r.n) * 100) : null,
    })),
  });
}));

/* ───────── 辅助 ───────── */
async function insertQuestion(req, o) {
  const r = await db.run(
    `INSERT INTO questions (unit_id, type, stem, options, answer, analysis, difficulty, score, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [o.unitId ? clampInt(o.unitId, 1, 1e9, 0) : null,
     normType(o.type), str(o.stem, 4000), optJson(o.options, null),
     str(o.answer, 500), str(o.analysis, 4000),
     clampInt(o.difficulty, 1, 4, 2), clampInt(o.score, 1, 100, 5),
     o.status == null ? 1 : (o.status ? 1 : 0)]
  );
  return Number(r.insertId);
}
function normType(t) {
  return ['single', 'multiple', 'judge', 'fill', 'short'].includes(t) ? t : 'single';
}
function optJson(v, dflt) {
  if (v == null) return dflt;
  if (typeof v === 'string') { try { JSON.parse(v); return v; } catch (e) { return dflt; } }
  return JSON.stringify(v);
}
function safeJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch (e) { return null; }
}

module.exports = router;
