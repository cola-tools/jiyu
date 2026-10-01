'use strict';
/** 登录 / 注销 / 当前用户 */
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const { ah, bad, logActivity } = require('../util');

const router = express.Router();

/** POST /api/auth/login  { username, password, role: 'student'|'admin' } */
router.post('/login', ah(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const role = req.body.role === 'admin' ? 'admin' : 'student';
  if (!username || !password) throw bad('请输入账号和密码');

  const table = role === 'admin' ? 'admins' : 'students';
  const user = await db.one(`SELECT * FROM ${table} WHERE username = ?`, [username]);
  if (!user) return res.status(401).json({ error: 'BAD_CREDENTIALS', message: '账号或密码不正确' });
  if (!user.status) return res.status(403).json({ error: 'DISABLED', message: '该账号已被停用，请联系管理员' });
  if (!auth.verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'BAD_CREDENTIALS', message: '账号或密码不正确' });
  }

  await db.run(`UPDATE ${table} SET last_login_at = NOW() WHERE id = ?`, [user.id]);
  const token = await auth.issueToken(role, user.id);
  await logActivity(role, user.id, user.name || user.username, 'login', username, '登录成功');

  res.json({
    token,
    user: publicUser(role, user),
  });
}));

/** POST /api/auth/logout */
router.post('/logout', ah(async (req, res) => {
  await auth.revokeToken(auth.readToken(req));
  res.json({ ok: true });
}));

/** GET /api/auth/me */
router.get('/me', auth.requireAuth, ah(async (req, res) => {
  const table = req.session.type === 'admin' ? 'admins' : 'students';
  const user = await db.one(`SELECT * FROM ${table} WHERE id = ?`, [req.session.id]);
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED', message: '账号不存在' });
  res.json({ user: publicUser(req.session.type, user) });
}));

/** 修改自己的密码 */
router.post('/password', auth.requireAuth, ah(async (req, res) => {
  const oldPwd = String(req.body.oldPassword || '');
  const newPwd = String(req.body.newPassword || '');
  if (newPwd.length < 6) throw bad('新密码至少 6 位');
  const table = req.session.type === 'admin' ? 'admins' : 'students';
  const user = await db.one(`SELECT * FROM ${table} WHERE id = ?`, [req.session.id]);
  if (!auth.verifyPassword(oldPwd, user.password_hash)) throw bad('原密码不正确');
  const hash = auth.hashPassword(newPwd);
  await db.run(`UPDATE ${table} SET password_hash = ? WHERE id = ?`, [hash, user.id]);
  await db.run('DELETE FROM tokens WHERE owner_type = ? AND owner_id = ?', [req.session.type, user.id]);
  res.json({ ok: true });
}));

function publicUser(role, u) {
  if (role === 'admin') {
    return { id: u.id, role: 'admin', username: u.username, name: u.name || u.username, adminRole: u.role };
  }
  return {
    id: u.id, role: 'student', username: u.username, name: u.name,
    sno: u.sno, className: u.class_name, phone: u.phone, email: u.email,
    lastLoginAt: u.last_login_at,
  };
}

module.exports = router;
