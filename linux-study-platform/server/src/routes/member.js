'use strict';
/**
 * 会员（学生端）
 * ─────────────────────────────────────────────────────────────────────
 *  公开：
 *    GET  /api/member/pricing    会员定价表（学习平台「定价」页用）
 *  登录态：
 *    GET  /api/member/me         我的会员详情（类型 / 到期时刻 / 剩余毫秒 / 是否不足3天）
 *    GET  /api/member/gate       打卡平台门禁检查（进入打卡平台前调用）
 *    GET  /api/member/logs       我的会员变更记录
 */
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const M = require('../member');
const { ah } = require('../util');

const router = express.Router();

/* ── 定价（公开） ── */
router.get('/pricing', ah(async (_req, res) => {
  const rows = await db.q(
    'SELECT code, label, price, days, perks, tagline, is_hot, enabled FROM pricing' +
    ' WHERE enabled = 1 ORDER BY sort_order, price'
  );
  res.json({
    items: rows.map((r) => ({
      code: r.code,
      label: r.label,
      price: Number(r.price),
      priceText: Number(r.price).toFixed(2),
      days: Number(r.days),
      durationText: Number(r.days) > 0 ? Number(r.days) + ' 天' : '永久',
      tagline: r.tagline,
      perks: String(r.perks || '').split('｜').filter(Boolean),
      hot: !!r.is_hot,
      isFree: Number(r.price) <= 0,
    })),
  });
}));

/* ── 我的会员 ── */
router.get('/me', auth.requireAuth, ah(async (req, res) => {
  if (req.session.type !== 'student') {
    return res.json({ member: { type: 'forever', label: '管理员', isSuper: true, permanent: true } });
  }
  const s = await db.one(
    'SELECT id, username, name, phone, status, member_type, member_expire_at, member_started_at' +
    ' FROM students WHERE id = ?',
    [req.session.id]
  );
  const eff = M.effectiveMember(s);
  res.json({
    member: M.memberView(eff),
    account: {
      id: s.id, username: s.username, name: s.name, phone: s.phone,
      status: s.status, disabled: !s.status,
      startedAt: M.fmt(s.member_started_at),
    },
  });
}));

/* ── 打卡平台门禁 ── */
router.get('/gate', auth.requireAuth, ah(async (req, res) => {
  if (req.session.type !== 'student') {
    return res.json({ ok: true, admin: true });
  }
  const s = await db.one(
    'SELECT id, status, member_type, member_expire_at FROM students WHERE id = ?',
    [req.session.id]
  );
  if (!s.status) {
    return res.status(403).json({
      ok: false, code: 'ACCOUNT_DISABLED', message: auth.DISABLED_MSG,
    });
  }
  const eff = M.effectiveMember(s);
  if (!eff.isSuper) {
    return res.status(403).json({
      ok: false, code: 'NEED_MEMBER', message: auth.NEED_MEMBER_MSG,
      member: M.memberView(eff),
    });
  }
  res.json({ ok: true, member: M.memberView(eff) });
}));

/* ── 我的会员变更记录 ── */
router.get('/logs', auth.requireAuth, ah(async (req, res) => {
  const rows = await db.q(
    'SELECT action, type_from, type_to, expire_from, expire_to, days_added,' +
    ' operator_type, operator_name, remark, created_at' +
    ' FROM member_logs WHERE student_id = ? ORDER BY id DESC LIMIT 50',
    [req.session.id]
  );
  const ACT = {
    grant: '开通会员', renew: '续费', expire: '会员到期',
    disable: '账号被禁用', enable: '账号恢复使用',
  };
  res.json({
    items: rows.map((r) => ({
      action: r.action,
      actionText: ACT[r.action] || r.action,
      typeFrom: M.MEMBER_CN[r.type_from] || r.type_from || '',
      typeTo: M.MEMBER_CN[r.type_to] || r.type_to || '',
      expireFrom: r.expire_from,
      expireTo: r.expire_to,
      daysAdded: r.days_added,
      operator: r.operator_type === 'system' ? '系统' : (r.operator_name || '管理员'),
      remark: r.remark,
      createdAt: r.created_at,
    })),
  });
}));

module.exports = router;
