'use strict';
/**
 * 账号与认证
 * ─────────────────────────────────────────────────────────────────────
 *  公开：
 *    POST /api/auth/captcha    新建图形验证码（返回一次性 token + SVG）
 *    POST /api/auth/sms        发送短信验证码（需先过图形验证码）
 *    POST /api/auth/register   注册（用户名/密码/确认密码/手机号/短信码/图形码）
 *    POST /api/auth/forgot     忘记密码（手机号 + 短信码，直接设置新密码）
 *  登录态：
 *    POST /api/auth/login      登录（支持用户名或手机号；platform 决定门禁平台）
 *    POST /api/auth/logout
 *    GET  /api/auth/me
 *    POST /api/auth/password
 */
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const captcha = require('../captcha');
const sms = require('../sms');
const M = require('../member');
const { ah, bad, logActivity } = require('../util');

const router = express.Router();

const RE_PHONE = /^1[3-9]\d{9}$/;
const RE_USERNAME = /^[A-Za-z0-9_\u4e00-\u9fa5]{2,20}$/;
const MSG_PHONE_TAKEN = '该手机号已绑定账号，请直接登录！';

function clientIp(req) {
  return String(
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket.remoteAddress || ''
  ).slice(0, 64);
}

/* ══════════════ 图形验证码 ══════════════ */

router.post('/captcha', ah(async (req, res) => {
  const c = await captcha.create(clientIp(req));
  res.json({ token: c.token, svg: c.svg, expiresIn: c.expiresIn });
}));

/** 校验图形验证码，失败抛错；不传 token 时按「未开启图形验证」处理由调用方决定 */
async function needCaptcha(token, input) {
  const ok = await captcha.verify(token, input);
  if (!ok) {
    const e = new Error('图形验证码不正确或已过期，请重新获取');
    e.status = 400; e.code = 'BAD_CAPTCHA';
    throw e;
  }
}

/* ══════════════ 短信验证码 ══════════════ */

router.post('/sms', ah(async (req, res) => {
  const phone = String(req.body.phone || '').trim();
  const scene = req.body.scene === 'forgot' ? 'forgot' : 'register';
  if (!phone) throw bad('请输入手机号');
  if (!RE_PHONE.test(phone)) throw bad('手机号格式不正确');

  // 注册场景：手机号已被占用时直接给出明确提示，不必浪费一条短信
  if (scene === 'register') {
    const exist = await db.one('SELECT id FROM students WHERE phone = ?', [phone]);
    if (exist) {
      const e = new Error(MSG_PHONE_TAKEN);
      e.status = 409; e.code = 'PHONE_TAKEN';
      throw e;
    }
  } else {
    const exist = await db.one('SELECT id FROM students WHERE phone = ?', [phone]);
    if (!exist) {
      const e = new Error('该手机号未注册，请先注册账号');
      e.status = 404; e.code = 'PHONE_NOT_FOUND';
      throw e;
    }
  }

  await needCaptcha(req.body.captchaToken, req.body.captcha);
  const out = await sms.send(phone, scene, clientIp(req));
  res.json(Object.assign({ ok: true }, out));
}));

/* ══════════════ 注册 ══════════════ */

router.post('/register', ah(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const password2 = String(req.body.password2 != null ? req.body.password2 : req.body.password);
  const phone = String(req.body.phone || '').trim();
  const smsCode = String(req.body.smsCode || req.body.code || '').trim();

  if (!username) throw bad('请输入用户名');
  if (!RE_USERNAME.test(username)) throw bad('用户名需 2-20 位，支持中英文、数字与下划线');
  if (password.length < 6) throw bad('密码至少 6 位');
  if (password !== password2) throw bad('两次输入的密码不一致');
  if (!RE_PHONE.test(phone)) throw bad('手机号格式不正确');

  await needCaptcha(req.body.captchaToken, req.body.captcha);

  // 手机号唯一性约束（最权威的判断是数据库唯一索引，此处先给出友好提示）
  const byPhone = await db.one('SELECT id FROM students WHERE phone = ?', [phone]);
  if (byPhone) {
    const e = new Error(MSG_PHONE_TAKEN);
    e.status = 409; e.code = 'PHONE_TAKEN';
    throw e;
  }
  const byName = await db.one('SELECT id FROM students WHERE username = ?', [username]);
  if (byName) {
    const e = new Error('该用户名已被使用，请更换后重试');
    e.status = 409; e.code = 'USERNAME_TAKEN';
    throw e;
  }

  const okCode = await sms.verify(phone, 'register', smsCode);
  if (!okCode) {
    const e = new Error('短信验证码不正确或已过期');
    e.status = 400; e.code = 'BAD_SMS_CODE';
    throw e;
  }

  const hash = auth.hashPassword(password);
  let id;
  try {
    const r = await db.run(
      'INSERT INTO students (username, password_hash, name, phone, member_type, status)' +
      " VALUES (?, ?, ?, ?, 'none', 1)",
      [username, hash, username, phone]
    );
    id = r.insertId;
  } catch (e) {
    // 并发注册时由唯一索引兜底
    if (e && e.code === 'ER_DUP_ENTRY') {
      const msg = /phone/.test(e.message || '') ? MSG_PHONE_TAKEN : '该用户名已被使用，请更换后重试';
      const err = new Error(msg);
      err.status = 409; err.code = 'DUPLICATE';
      throw err;
    }
    throw e;
  }

  await logActivity('student', id, username, 'register', username, '注册账号（普通会员）');
  const token = await auth.issueToken('student', id);
  const user = await db.one('SELECT * FROM students WHERE id = ?', [id]);
  res.status(201).json({
    token,
    user: publicUser('student', user),
    message: '注册成功，当前为普通会员',
  });
}));

/* ══════════════ 忘记密码 ══════════════ */

router.post('/forgot', ah(async (req, res) => {
  const phone = String(req.body.phone || '').trim();
  const smsCode = String(req.body.smsCode || req.body.code || '').trim();
  const pwd = String(req.body.newPassword || req.body.password || '');
  const pwd2 = String(req.body.newPassword2 != null ? req.body.newPassword2 : pwd);

  if (!RE_PHONE.test(phone)) throw bad('手机号格式不正确');
  if (pwd.length < 6) throw bad('新密码至少 6 位');
  if (pwd !== pwd2) throw bad('两次输入的新密码不一致');

  const user = await db.one('SELECT id, username, name FROM students WHERE phone = ?', [phone]);
  if (!user) {
    const e = new Error('该手机号未注册，请先注册账号');
    e.status = 404; e.code = 'PHONE_NOT_FOUND';
    throw e;
  }
  const okCode = await sms.verify(phone, 'forgot', smsCode);
  if (!okCode) {
    const e = new Error('短信验证码不正确或已过期');
    e.status = 400; e.code = 'BAD_SMS_CODE';
    throw e;
  }

  await db.run('UPDATE students SET password_hash = ? WHERE id = ?', [auth.hashPassword(pwd), user.id]);
  await db.run("DELETE FROM tokens WHERE owner_type = 'student' AND owner_id = ?", [user.id]);
  await logActivity('student', user.id, user.name || user.username, 'reset_password', user.username, '通过手机号重置密码');
  res.json({ ok: true, message: '密码已重置，请使用新密码登录' });
}));

/* ══════════════ 登录 ══════════════ */

/**
 * POST /api/auth/login
 *   { account | username, password, role, platform }
 *   · account / username 均支持「用户名」或「手机号」
 *   · platform = 'checkin' 时要求超级会员（普通会员/已过期 → 403 NEED_MEMBER）
 */
router.post('/login', ah(async (req, res) => {
  const account = String(req.body.account || req.body.username || '').trim();
  const password = String(req.body.password || '');
  const role = req.body.role === 'admin' ? 'admin' : 'student';
  const platform = req.body.platform === 'checkin' ? 'checkin' : 'learn';
  if (!account || !password) throw bad('请输入账号和密码');

  if (role === 'admin') {
    const admin = await db.one('SELECT * FROM admins WHERE username = ?', [account]);
    if (!admin) return res.status(401).json({ error: 'BAD_CREDENTIALS', message: '账号或密码不正确' });
    if (!admin.status) {
      return res.status(403).json({ error: 'ACCOUNT_DISABLED', code: 'ACCOUNT_DISABLED', message: auth.DISABLED_MSG });
    }
    if (!auth.verifyPassword(password, admin.password_hash)) {
      return res.status(401).json({ error: 'BAD_CREDENTIALS', message: '账号或密码不正确' });
    }
    await db.run('UPDATE admins SET last_login_at = NOW() WHERE id = ?', [admin.id]);
    const token = await auth.issueToken('admin', admin.id);
    await logActivity('admin', admin.id, admin.name || admin.username, 'login', account, '登录成功');
    return res.json({ token, user: publicUser('admin', admin) });
  }

  // 学生：用户名 或 手机号
  const student = await db.one(
    'SELECT * FROM students WHERE username = ? OR phone = ? LIMIT 1',
    [account, account]
  );
  if (!student) return res.status(401).json({ error: 'BAD_CREDENTIALS', message: '账号或密码不正确' });

  // 被禁用：任何平台都不允许使用
  if (!student.status) {
    return res.status(403).json({
      error: 'ACCOUNT_DISABLED', code: 'ACCOUNT_DISABLED',
      message: auth.DISABLED_MSG,
    });
  }
  if (!auth.verifyPassword(password, student.password_hash)) {
    return res.status(401).json({ error: 'BAD_CREDENTIALS', message: '账号或密码不正确' });
  }

  const eff = M.effectiveMember(student);
  // 打卡平台门禁：普通会员 / 已过期一律拒绝
  if (platform === 'checkin' && !eff.isSuper) {
    return res.status(403).json({
      error: 'NEED_MEMBER', code: 'NEED_MEMBER',
      message: auth.NEED_MEMBER_MSG,
      member: M.memberView(eff),
    });
  }
  // 惰性降级：已过期则立刻落库
  if (eff.expired) {
    await db.run("UPDATE students SET member_type='none', member_expire_at=NULL WHERE id=?", [student.id]);
  }

  await db.run('UPDATE students SET last_login_at = NOW() WHERE id = ?', [student.id]);
  const token = await auth.issueToken('student', student.id);
  await logActivity('student', student.id, student.name || student.username, 'login',
    platform === 'checkin' ? '打卡平台' : '学习平台', '登录成功');

  res.json({ token, user: publicUser('student', student), platform });
}));

/* ══════════════ 注销 / 当前用户 / 改密 ══════════════ */

router.post('/logout', ah(async (req, res) => {
  await auth.revokeToken(auth.readToken(req));
  res.json({ ok: true });
}));

router.get('/me', auth.requireAuth, ah(async (req, res) => {
  const table = req.session.type === 'admin' ? 'admins' : 'students';
  const user = await db.one(`SELECT * FROM ${table} WHERE id = ?`, [req.session.id]);
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED', message: '账号不存在' });
  res.json({ user: publicUser(req.session.type, user), member: req.session.member });
}));

router.post('/password', auth.requireAuth, ah(async (req, res) => {
  const oldPwd = String(req.body.oldPassword || '');
  const newPwd = String(req.body.newPassword || '');
  if (newPwd.length < 6) throw bad('新密码至少 6 位');
  const table = req.session.type === 'admin' ? 'admins' : 'students';
  const user = await db.one(`SELECT * FROM ${table} WHERE id = ?`, [req.session.id]);
  if (!auth.verifyPassword(oldPwd, user.password_hash)) throw bad('原密码不正确');
  await db.run(`UPDATE ${table} SET password_hash = ? WHERE id = ?`, [auth.hashPassword(newPwd), user.id]);
  await db.run('DELETE FROM tokens WHERE owner_type = ? AND owner_id = ?', [req.session.type, user.id]);
  res.json({ ok: true });
}));

/* ══════════════ 公共辅助 ══════════════ */

function publicUser(role, u) {
  if (role === 'admin') {
    return { id: u.id, role: 'admin', username: u.username, name: u.name || u.username, adminRole: u.role };
  }
  const eff = M.effectiveMember(u);
  return {
    id: u.id, role: 'student', username: u.username, name: u.name,
    sno: u.sno, className: u.class_name, phone: u.phone, email: u.email,
    status: u.status,
    member: M.memberView(eff),
    lastLoginAt: u.last_login_at,
  };
}

module.exports = router;
module.exports.publicUser = publicUser;
