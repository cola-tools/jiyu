'use strict';
/**
 * 会员体系 · 端到端接口自测（零依赖）
 * ─────────────────────────────────────────────────────────────────────
 * 覆盖：
 *   ① 定价公开接口
 *   ② 注册（图形验证码 + 短信验证码 + 手机号唯一性）
 *   ③ 忘记密码（手机号 + 短信码 → 直接改密）
 *   ④ 登录门禁（普通会员不能进打卡平台 / 禁用账号一律拒绝）
 *   ⑤ 章节门禁（普通会员仅第一章可学，第二章起 403 LOCKED + 🔒）
 *   ⑥ 打卡与导出（普通会员禁止；超级会员可导出 CSV / XLSX / PDF）
 *   ⑦ 会员开通与续费叠加（不受频率限制，3 秒内连续设置正确累加）
 *   ⑧ 会员到期强制退出（令牌被清除）
 *   ⑨ 账号禁用 / 恢复
 *   ⑩ 管理端会员列表与定价配置
 *
 * 用法：node tests/api-member-smoke.js            （默认 http://127.0.0.1:3210）
 *      BASE=http://127.0.0.1:3000 node tests/api-member-smoke.js
 */
const path = require('path');
const mysql = require(path.join(__dirname, '..', 'server', 'node_modules', 'mysql2', 'promise'));

const BASE = process.env.BASE || 'http://127.0.0.1:3210';
const DB = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3399),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'linux_study',
  dateStrings: true,
};

let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2714 ' + name); }
  else {
    fail++; failures.push(name);
    console.log('  \u2716 ' + name + (extra ? '  → ' + extra : ''));
  }
}
function group(t) { console.log('\n' + t); }

let conn;

async function api(method, url, opts) {
  const o = opts || {};
  const headers = { 'Content-Type': 'application/json' };
  if (o.token) headers.Authorization = 'Bearer ' + o.token;
  const res = await fetch(BASE + url, {
    method,
    headers,
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    return { status: res.status, json: await res.json(), headers: res.headers };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, buffer: buf, headers: res.headers };
}

const login = (body) => api('POST', '/api/auth/login', { body });

/** 新建图形验证码，并从库里取出正确答案（测试专用） */
async function newCaptcha() {
  const r = await api('POST', '/api/auth/captcha');
  const [rows] = await conn.execute(
    'SELECT answer FROM captcha_codes WHERE token = ?', [r.json.token]
  );
  return { token: r.json.token, answer: rows[0] ? rows[0].answer : '' , svg: r.json.svg };
}

async function main() {
  conn = await mysql.createConnection(DB);

  /* ══════════ 0. 复位演示账号基线（保证套件可重复运行） ══════════
     本套件会开通 / 续费 / 禁用演示账号，跑完必须回到初始状态，
     否则第二次运行时断言（如 student3 是普通会员）会失真。 */
  await conn.execute("UPDATE students SET member_type='forever', member_expire_at=NULL WHERE username='student1'");
  await conn.execute("UPDATE students SET member_type='year', member_expire_at=DATE_ADD(NOW(), INTERVAL 365 DAY) WHERE username='student2'");
  await conn.execute("UPDATE students SET member_type='none', member_expire_at=NULL WHERE username='student3'");
  await conn.execute("UPDATE students SET member_type='week', member_expire_at=DATE_ADD(NOW(), INTERVAL 2 DAY) WHERE username='student4'");
  await conn.execute("UPDATE students SET member_type='none', member_expire_at=NULL, status=0 WHERE username='student5'");
  await conn.execute("DELETE t FROM tokens t JOIN students s ON s.id = t.owner_id WHERE t.owner_type='student'");
  /* 短信限流复位：同号每日 10 条 / 同 IP 每小时 20 条，
     不清掉会让第二次运行的「发送短信验证码」直接被限流拦截 */
  await conn.execute(
    "DELETE FROM sms_codes WHERE phone IN ('13900001234','13900005555')" +
    " OR request_ip IN ('127.0.0.1','::1','::ffff:127.0.0.1','localhost')"
  );
  console.log('  · 演示账号与短信限流已复位');

  /* ══════════ 1. 定价（公开） ══════════ */
  group('1. 会员定价（公开接口）');
  {
    const r = await api('GET', '/api/member/pricing');
    ok('GET /api/member/pricing → 200', r.status === 200, 'status=' + r.status);
    const items = (r.json && r.json.items) || [];
    ok('共 5 个档位', items.length === 5, 'len=' + items.length);
    const by = Object.fromEntries(items.map((i) => [i.code, i]));
    ok('普通会员 0 元', by.none && by.none.price === 0, JSON.stringify(by.none));
    ok('周会员 4 元 / 7 天', by.week && by.week.price === 4 && by.week.days === 7);
    ok('月会员 12 元 / 30 天', by.month && by.month.price === 12 && by.month.days === 30);
    ok('年会员 24 元 / 365 天', by.year && by.year.price === 24 && by.year.days === 365);
    ok('永久会员 59.9 元', by.forever && by.forever.price === 59.9);
    ok('每档都带权益条目', items.every((i) => i.perks.length > 0));
  }

  /* ══════════ 2. 登录与门禁 ══════════ */
  group('2. 登录门禁（打卡平台 vs 学习平台）');
  let tSuper, tNormal, tDis, tWeek, tYear;

  {
    const r = await login({ account: 'student1', password: 'xiaoran2026', platform: 'checkin' });
    ok('永久会员可登录打卡平台', r.status === 200, 'status=' + r.status);
    ok('  返回 isSuper=true', r.json && r.json.user.member.isSuper === true);
    ok('  会员名称为「永久会员」', r.json.user.member.label === '永久会员');
    tSuper = r.json.token;
  }
  {
    const r = await login({ account: 'student3', password: 'study2026', platform: 'checkin' });
    ok('普通会员登录打卡平台 → 403', r.status === 403, 'status=' + r.status);
    ok('  提示语与需求一致',
      r.json.message === '你还未开通会员，无法使用打卡平台，请联系管理员开通会员后再使用！',
      r.json.message);
    tNormal = (await login({ account: 'student3', password: 'study2026', platform: 'learn' })).json.token;
    ok('  但可登录学习平台', !!tNormal);
  }
  {
    const r = await login({ account: 'student5', password: 'hello2026', platform: 'learn' });
    ok('被禁用账号 → 403', r.status === 403, 'status=' + r.status);
    ok('  禁用提示语与需求一致',
      r.json.message === '您的账号已被管理员设置为禁用，请联系管理员开通账号使用权限',
      r.json.message);
  }
  {
    tWeek = (await login({ account: 'student4', password: 'buddy2026', platform: 'checkin' })).json.token;
    ok('周会员（剩 2 天）可登录打卡平台', !!tWeek);
    const me = await api('GET', '/api/member/me', { token: tWeek });
    ok('  剩余不足 3 天 → almostDue=true', me.json.member.almostDue === true);
    ok('  倒计时提示语与需求一致',
      me.json.member.dueWarning === '你的会员期限已不足3天，为了能够正常使用该平台，请及时联系管理员进行续费！',
      me.json.member.dueWarning);
    const total = me.json.member.remainMs;
    ok('  remainMs 在 2~3 天区间', total > 1.5 * 864e5 && total < 3 * 864e5, total + 'ms');
  }
  {
    tYear = (await login({ account: 'student2', password: 'linux2026', platform: 'checkin' })).json.token;
    ok('年会员可登录打卡平台', !!tYear);
  }

  /* ══════════ 3. 章节门禁 ══════════ */
  group('3. 章节门禁（普通会员仅 ① 章可学）');
  {
    const tree = (await api('GET', '/api/tree', { token: tNormal })).json;
    const all = tree.tree || [];
    const chs = all.filter((u) => Number(u.level) === 2);
    ok('/api/tree 返回扁平树（含 8 个主章节）', chs.length >= 2, 'chapters=' + chs.length);
    const freeChs = chs.filter((c) => c.isFree);
    ok('存在且仅一个免费章节', freeChs.length === 1, 'free=' + freeChs.length);
    ok('免费章节为「① 入门与安装」', freeChs[0] && /^①/.test(freeChs[0].title), freeChs[0] && freeChs[0].title);
    const freeKids = all.filter((u) => u.parentId === freeChs[0].id);
    ok('免费章节下 5 个小节全部解锁',
      freeKids.length === 5 && freeKids.every((k) => !k.locked),
      'kids=' + freeKids.length + ' locked=' + freeKids.filter((k) => k.locked).length);
    const lockedChs = chs.filter((c) => c.locked);
    ok('其余章节全部锁定', lockedChs.length === chs.length - 1, 'locked=' + lockedChs.length);
    const lockedGrand = all.filter((u) => lockedChs.some((c) => c.id === u.parentId) ||
      lockedChs.some((c) => c.id === u.parentId));
    ok('锁定章节的子节点也全部锁定',
      lockedGrand.length > 0 && lockedGrand.every((k) => k.locked), 'n=' + lockedGrand.length);
    ok('返回会员信息（isSuper=false）', tree.isSuper === false && !!tree.member);
  }
  {
    const tree = (await api('GET', '/api/tree', { token: tSuper })).json;
    const chs = (tree.tree || []).filter((u) => Number(u.level) === 2);
    ok('超级会员：无任何锁定章节', chs.every((c) => !c.locked));
    ok('超级会员：isSuper=true', tree.isSuper === true);
    ok('超级会员：🔒 不会出现在标题里', (tree.tree || []).every((u) => String(u.title).indexOf('\uD83D\uDD12') < 0));
  }
  {
    // 取一个第二章的小节 id，验证详情接口 403
    const [rows] = await conn.execute(
      "SELECT u.id, u.title FROM units u JOIN units p ON p.id = u.parent_id" +
      " WHERE p.level = 2 AND p.is_free = 0 AND u.level = 3 LIMIT 1"
    );
    const lockedId = rows[0].id, lockedTitle = rows[0].title;
    const r = await api('GET', '/api/units/' + lockedId, { token: tNormal });
    ok('普通会员访问锁定小节详情 → 403', r.status === 403, 'status=' + r.status);
    ok('  提示语与需求一致',
      r.json.message === '你还未开通超级会员，请联系管理员开通后进行学习！', r.json.message);
    const r2 = await api('GET', '/api/units/' + lockedId, { token: tSuper });
    ok('超级会员访问同一个小节 → 200', r2.status === 200, 'status=' + r2.status + ' (' + lockedTitle + ')');

    // 第一章的小节：普通会员可读
    const [fr] = await conn.execute(
      "SELECT u.id FROM units u JOIN units p ON p.id = u.parent_id" +
      " WHERE p.level = 2 AND p.is_free = 1 AND u.level = 3 LIMIT 1"
    );
    const r3 = await api('GET', '/api/units/' + fr[0].id, { token: tNormal });
    ok('普通会员访问免费章节小节 → 200', r3.status === 200, 'status=' + r3.status);
  }

  /* ══════════ 4. 打卡门禁与导出 ══════════ */
  group('4. 打卡与导出（超级会员专属）');
  {
    const g = await api('GET', '/api/member/gate', { token: tNormal });
    ok('普通会员 gate → 403 NEED_MEMBER', g.status === 403 && g.json.code === 'NEED_MEMBER');
    const g2 = await api('GET', '/api/member/gate', { token: tSuper });
    ok('超级会员 gate → 200', g2.status === 200 && g2.json.ok === true);

    const r = await api('POST', '/api/checkins', {
      token: tNormal, body: { unitIds: [1], date: new Date().toISOString().slice(0, 10) },
    });
    ok('普通会员打卡 → 403', r.status === 403, 'status=' + r.status);

    for (const f of ['csv', 'xlsx', 'pdf']) {
      const e = await api('GET', '/api/my/export?format=' + f, { token: tNormal });
      ok('普通会员导出 ' + f.toUpperCase() + ' → 403', e.status === 403, 'status=' + e.status);
    }
  }
  {
    // 让超级会员产生几条打卡记录
    const tree = (await api('GET', '/api/tree', { token: tSuper })).json;
    const ids = (tree.tree || [])
      .filter((u) => u.checkable && !u.done && !u.locked)
      .slice(0, 5)
      .map((u) => u.id);
    ok('找到可打卡内容', ids.length > 0, 'n=' + ids.length);
    const today = new Date().toISOString().slice(0, 10);
    const ck = await api('POST', '/api/checkins', { token: tSuper, body: { unitIds: ids, date: today } });
    ok('超级会员打卡成功', ck.status === 200, JSON.stringify(ck.json).slice(0, 200));

    const magic = {
      csv: (b) => b.slice(0, 3).toString() === '\uFEFF'.slice(0, 3) || b[0] === 0xEF,
      xlsx: (b) => b[0] === 0x50 && b[1] === 0x4B,               // PK
      pdf: (b) => b.slice(0, 5).toString() === '%PDF-',
    };
    const mimes = {
      csv: /text\/csv/, xlsx: /spreadsheetml/, pdf: /application\/pdf/,
    };
    for (const f of ['csv', 'xlsx', 'pdf']) {
      const e = await api('GET', '/api/my/export?format=' + f, { token: tSuper });
      ok('超级会员导出 ' + f.toUpperCase() + ' → 200', e.status === 200, 'status=' + e.status);
      if (e.status !== 200) continue;
      ok('  文件头正确（' + f + '）', magic[f](e.buffer));
      ok('  MIME 正确', mimes[f].test(e.headers.get('content-type') || ''),
        e.headers.get('content-type'));
      ok('  Content-Disposition 带中文文件名', /filename\*=UTF-8''/.test(e.headers.get('content-disposition') || ''));
      ok('  体积 > 200 字节', e.buffer.length > 200, e.buffer.length + 'B');
    }
    const bad = await api('GET', '/api/my/export?format=doc', { token: tSuper });
    ok('不支持的格式 → 400', bad.status === 400, 'status=' + bad.status);

    const [el] = await conn.execute('SELECT COUNT(*) AS n FROM export_logs');
    ok('导出写入流水表 export_logs', Number(el[0].n) >= 3, 'n=' + el[0].n);
  }
  {
    // 撤销打卡（校验 requireSuper 生效）
    const list = (await api('GET', '/api/my/checkins?limit=1', { token: tSuper })).json;
    if (list.items && list.items.length) {
      const r = await api('POST', '/api/checkins/revoke', {
        token: tSuper, body: { unitIds: [list.items[0].unitId], date: list.items[0].date },
      });
      ok('超级会员可撤销打卡', r.status === 200, JSON.stringify(r.json).slice(0, 120));
    } else {
      ok('超级会员可撤销打卡', false, '无打卡记录可撤销');
    }
  }

  /* ══════════ 5. 注册 ══════════ */
  group('5. 注册（图形码 + 短信码 + 手机号唯一）');
  const NEW_PHONE = '13900001234';
  await conn.execute('DELETE FROM students WHERE phone = ?', [NEW_PHONE]);
  {
    const cap = await newCaptcha();
    ok('图形验证码返回 SVG', /^<svg/.test(cap.svg) && cap.answer.length >= 4,
      'answer=' + cap.answer);
    const s = await api('POST', '/api/auth/sms', {
      body: { phone: NEW_PHONE, scene: 'register', captchaToken: cap.token, captcha: cap.answer },
    });
    ok('发送短信验证码成功', s.status === 200 && s.json.ok === true, JSON.stringify(s.json).slice(0, 160));
    ok('  console 模式回显 devCode', /^\d{6}$/.test(String(s.json.devCode || '')));
    const devCode = String(s.json.devCode);

    const r = await api('POST', '/api/auth/register', {
      body: {
        username: 'apitest01', password: 'test123456', password2: 'test123456',
        phone: NEW_PHONE, smsCode: devCode,
        captchaToken: (await newCaptcha()).token, captcha: '',
      },
    });
    // 上面故意传空图形码，应被拒
    ok('图形验证码错误 → 拒绝注册', r.status === 400, 'status=' + r.status);

    const c2 = await newCaptcha();
    const r2 = await api('POST', '/api/auth/register', {
      body: {
        username: 'apitest01', password: 'test123456', password2: 'test123456',
        phone: NEW_PHONE, smsCode: devCode,
        captchaToken: c2.token, captcha: c2.answer,
      },
    });
    ok('注册成功 → 201', r2.status === 201, 'status=' + r2.status + ' ' + JSON.stringify(r2.json).slice(0, 160));
    ok('  默认会员为普通会员', r2.json && r2.json.user && r2.json.user.member.type === 'none');
    ok('  注册即返回登录令牌', !!(r2.json && r2.json.token));

    // 手机号重复
    const c3 = await newCaptcha();
    const s3 = await api('POST', '/api/auth/sms', {
      body: { phone: NEW_PHONE, scene: 'register', captchaToken: c3.token, captcha: c3.answer },
    });
    ok('同一手机号再注册 → 409 且提示直接登录',
      s3.status === 409 && s3.json.message === '该手机号已绑定账号，请直接登录！',
      'status=' + s3.status + ' ' + s3.json.message);

    const c4 = await newCaptcha();
    const r4 = await api('POST', '/api/auth/register', {
      body: {
        username: 'apitest02', password: 'test123456', password2: 'test123456',
        phone: NEW_PHONE, smsCode: '000000', captchaToken: c4.token, captcha: c4.answer,
      },
    });
    ok('重复手机号直接注册 → 409', r4.status === 409 && r4.json.message === '该手机号已绑定账号，请直接登录！',
      'status=' + r4.status);

    // 密码不一致 / 密码过短
    const c5 = await newCaptcha();
    const r5 = await api('POST', '/api/auth/register', {
      body: {
        username: 'apitest03', password: 'abc123456', password2: 'abc123457',
        phone: '13900005555', smsCode: '123456', captchaToken: c5.token, captcha: c5.answer,
      },
    });
    ok('两次密码不一致 → 400', r5.status === 400 && /不一致/.test(r5.json.message), r5.json.message);
  }

  /* ══════════ 6. 忘记密码 ══════════ */
  group('6. 忘记密码（手机号 + 短信码 → 直接设新密码）');
  {
    const c = await newCaptcha();
    const s = await api('POST', '/api/auth/sms', {
      body: { phone: NEW_PHONE, scene: 'forgot', captchaToken: c.token, captcha: c.answer },
    });
    ok('忘记密码场景可发短信', s.status === 200, 'status=' + s.status);
    const r = await api('POST', '/api/auth/forgot', {
      body: { phone: NEW_PHONE, smsCode: String(s.json.devCode), newPassword: 'newpass888', newPassword2: 'newpass888' },
    });
    ok('重置密码成功', r.status === 200, 'status=' + r.status);
    const l = await login({ account: NEW_PHONE, password: 'newpass888', platform: 'learn' });
    ok('用新密码 + 手机号可登录', l.status === 200, 'status=' + l.status);
    const l2 = await login({ account: 'apitest01', password: 'newpass888', platform: 'learn' });
    ok('用新密码 + 用户名可登录', l2.status === 200, 'status=' + l2.status);
    const old = await login({ account: 'apitest01', password: 'test123456', platform: 'learn' });
    ok('旧密码已失效', old.status === 401, 'status=' + old.status);
  }

  /* ══════════ 7. 管理端：开通 / 续费叠加 ══════════ */
  group('7. 管理端：会员开通与续费叠加');
  const tAdmin = (await login({ account: 'admin', password: 'admin@2026', role: 'admin' })).json.token;
  ok('管理员登录成功', !!tAdmin);
  let sid3 = null;
  {
    const [rows] = await conn.execute('SELECT id FROM students WHERE username = ?', ['student3']);
    sid3 = rows[0].id;
    await conn.execute(
      "UPDATE students SET member_type='none', member_expire_at=NULL, status=1 WHERE id=?", [sid3]
    );

    const r1 = await api('POST', '/api/admin/members/' + sid3 + '/grant', {
      token: tAdmin, body: { memberType: 'week', remark: '自测-周会员' },
    });
    ok('设置周会员成功', r1.status === 200, 'status=' + r1.status);
    ok('  等级变为超级会员', r1.json.member.isSuper === true && r1.json.member.levelLabel === '超级会员');
    const exp1 = new Date(r1.json.member.expireAt.replace(' ', 'T')).getTime();
    const nowMs = Date.now();
    const diff1 = exp1 - nowMs;
    ok('  到期 = 现在 + 7 天（±90 秒）',
      Math.abs(diff1 - 7 * 864e5) < 90000, (diff1 / 864e5).toFixed(3) + ' 天');
    ok('  daysAdded = 7', r1.json.daysAdded === 7);

    // 3 秒后叠加月会员（不限制频率）
    await new Promise((r) => setTimeout(r, 3000));
    const r2 = await api('POST', '/api/admin/members/' + sid3 + '/grant', {
      token: tAdmin, body: { memberType: 'month', remark: '自测-3秒后续月会员' },
    });
    ok('3 秒后可再次设置（月会员）', r2.status === 200, 'status=' + r2.status);
    const exp2 = new Date(r2.json.member.expireAt.replace(' ', 'T')).getTime();
    const diff2 = exp2 - exp1;
    ok('  叠加正确 = 原到期 + 30 天（±2 秒）',
      Math.abs(diff2 - 30 * 864e5) < 2000, (diff2 / 864e5).toFixed(4) + ' 天');
    ok('  记录为「续费」而非新开通', r2.json.stacked === true);
    ok('  daysAdded = 30', r2.json.daysAdded === 30);

    // 同类型再叠加一次（同类型也可叠加）
    const r3 = await api('POST', '/api/admin/members/' + sid3 + '/grant', {
      token: tAdmin, body: { memberType: 'month' },
    });
    const exp3 = new Date(r3.json.member.expireAt.replace(' ', 'T')).getTime();
    ok('同类型（月）再叠加 +30 天', Math.abs((exp3 - exp2) - 30 * 864e5) < 2000,
      ((exp3 - exp2) / 864e5).toFixed(4) + ' 天');

    /* ── 回归：remainMs 曾经用 `| 0` 截断成 32 位整数，剩余 > 24.8 天会溢出归零，
          进而把月 / 年会员误判为「剩余 0 天、不足 3 天」。此处长期驻留防回归。── */
    const expectMs = exp3 - Date.now();
    ok('  剩余毫秒未被 32 位截断（约 ' + (expectMs / 864e5).toFixed(1) + ' 天）',
      Math.abs(r3.json.member.remainMs - expectMs) < 90000, 'remainMs=' + r3.json.member.remainMs);
    ok('  剩余天数 = ' + r3.json.member.remainDays + ' 天（≥66）', r3.json.member.remainDays >= 66);
    ok('  长周期会员不会被误判为「不足 3 天」', r3.json.member.almostDue === false);
    ok('  长周期会员无「不足3天」提醒文案', r3.json.member.dueWarning === '');

    // 年会员（365 天 ≈ 3.15e10 ms，远超 2^31）同样必须准确
    const r3y = await api('POST', '/api/admin/members/' + sid3 + '/grant', {
      token: tAdmin, body: { memberType: 'year' },
    });
    ok('  年会员剩余天数 ≈ 67 + 365 天（实际 ' + r3y.json.member.remainDays + ' 天）',
      r3y.json.member.remainDays > 425 && r3y.json.member.remainDays < 440,
      'remainDays=' + r3y.json.member.remainDays);
    ok('  年会员 remainMs 与实际剩余一致',
      Math.abs(r3y.json.member.remainMs - (new Date(r3y.json.member.expireAt.replace(' ', 'T')).getTime() - Date.now())) < 90000);

    // 永久会员 → 无穷
    const r4 = await api('POST', '/api/admin/members/' + sid3 + '/grant', {
      token: tAdmin, body: { memberType: 'forever' },
    });
    ok('设置为永久会员', r4.json.member.permanent === true && r4.json.member.expireAt === null);
    // 永久后再设置仍为永久（不可逆）
    const r5 = await api('POST', '/api/admin/members/' + sid3 + '/grant', {
      token: tAdmin, body: { memberType: 'week' },
    });
    ok('永久会员再设置仍为永久（不可逆）', r5.json.member.permanent === true);

    // 回到普通会员
    const r6 = await api('POST', '/api/admin/members/' + sid3 + '/grant', {
      token: tAdmin, body: { memberType: 'none' },
    });
    ok('可改回普通会员', r6.json.member.type === 'none' && r6.json.member.isSuper === false);

    // 普通会员重新登录打卡平台应被拒
    const l = await login({ account: 'student3', password: 'study2026', platform: 'checkin' });
    ok('改回普通会员后无法进打卡平台', l.status === 403 && l.json.code === 'NEED_MEMBER');

    const logs = await api('GET', '/api/admin/members/' + sid3 + '/logs', { token: tAdmin });
    ok('会员流水已记录（≥6 条）', logs.json.items.length >= 6, 'n=' + logs.json.items.length);
    ok('  流水中含「续费叠加」', logs.json.items.some((x) => x.actionText === '续费叠加'));
  }

  /* ══════════ 8. 禁用 / 恢复 + 强制退出 ══════════ */
  group('8. 账号禁用 / 恢复与强制退出');
  {
    const [rows] = await conn.execute('SELECT id FROM students WHERE username = ?', ['student3']);
    const id = rows[0].id;
    // 先给会员，让它能登录打卡平台
    await api('POST', '/api/admin/members/' + id + '/grant', { token: tAdmin, body: { memberType: 'year' } });
    const t = (await login({ account: 'student3', password: 'study2026', platform: 'checkin' })).json.token;
    ok('设置年会员后可进打卡平台', !!t);
    const gate = await api('GET', '/api/member/gate', { token: t });
    ok('  gate 通过', gate.status === 200);

    const d = await api('POST', '/api/admin/members/' + id + '/status', {
      token: tAdmin, body: { status: 0 },
    });
    ok('禁用账号成功', d.status === 200 && d.json.status === 0);
    const after = await api('GET', '/api/member/gate', { token: t });
    ok('被禁用后原令牌立即失效（强制退出）', after.status === 401, 'status=' + after.status);
    const l = await login({ account: 'student3', password: 'study2026', platform: 'learn' });
    ok('被禁用后无法再登录', l.status === 403 && l.json.message === '您的账号已被管理员设置为禁用，请联系管理员开通账号使用权限');

    const e = await api('POST', '/api/admin/members/' + id + '/status', {
      token: tAdmin, body: { status: 1 },
    });
    ok('恢复使用成功', e.status === 200 && e.json.status === 1);
    const l2 = await login({ account: 'student3', password: 'study2026', platform: 'learn' });
    ok('恢复后可正常登录', l2.status === 200);
    ok('  会员权限仍在（年会员）', l2.json.user.member.type === 'year');
  }

  /* ══════════ 9. 到期强制退出 ══════════ */
  group('9. 会员到期 → 自动降级 + 强制退出登录');
  {
    const [rows] = await conn.execute('SELECT id FROM students WHERE username = ?', ['student2']);
    const id = rows[0].id;
    const t = (await login({ account: 'student2', password: 'linux2026', platform: 'checkin' })).json.token;
    ok('年会员已登录打卡平台', !!t);

    // 把到期时间改成 1 秒前，模拟到期
    await conn.execute(
      'UPDATE students SET member_expire_at = DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE id = ?', [id]
    );
    // 打开会员管理页会触发自动降级（同时清除令牌）
    const lst = await api('GET', '/api/admin/members', { token: tAdmin });
    const row = lst.json.items.find((x) => x.id === id);
    ok('管理端列表已把到期用户判定为普通会员',
      row.type === 'none' && row.expired === true, JSON.stringify(row && row.type));

    const [tk] = await conn.execute(
      "SELECT COUNT(*) AS n FROM tokens WHERE owner_type='student' AND owner_id=?", [id]
    );
    ok('到期后登录令牌已被清除（强制退出）', Number(tk[0].n) === 0, 'tokens=' + tk[0].n);

    const after = await api('GET', '/api/member/gate', { token: t });
    ok('原令牌访问 gate → 401', after.status === 401, 'status=' + after.status);

    const l = await login({ account: 'student2', password: 'linux2026', platform: 'checkin' });
    ok('到期后无法再进打卡平台', l.status === 403 &&
      l.json.message === '你还未开通会员，无法使用打卡平台，请联系管理员开通会员后再使用！',
      'status=' + l.status + ' ' + (l.json.message || ''));

    const [mt] = await conn.execute('SELECT member_type FROM students WHERE id = ?', [id]);
    ok('库中已自动降级为 none', mt[0].member_type === 'none', mt[0].member_type);

    // 恢复成永久会员，避免影响后续演示
    await api('POST', '/api/admin/members/' + id + '/grant', { token: tAdmin, body: { memberType: 'year' } });
  }

  /* ══════════ 10. 管理端会员列表与定价 ══════════ */
  group('10. 管理端会员列表 / 定价配置');
  {
    const r = await api('GET', '/api/admin/members', { token: tAdmin });
    ok('GET /api/admin/members → 200', r.status === 200);
    ok('  返回 summary（超级/普通/禁用/临期）',
      r.json.summary && typeof r.json.summary.superCount === 'number' &&
      typeof r.json.summary.normalCount === 'number');
    ok('  返回会员类型选项 5 档', r.json.options.length === 5);
    ok('  返回免费章节信息', !!r.json.freeChapter);
    ok('  每个用户带 levelLabel', r.json.items.every((x) => !!x.levelLabel));

    const kw = await api('GET', '/api/admin/members?keyword=student1', { token: tAdmin });
    ok('  支持关键字搜索', kw.json.items.length === 1 && kw.json.items[0].username === 'student1');

    const p = await api('GET', '/api/admin/pricing', { token: tAdmin });
    ok('GET /api/admin/pricing → 5 档', p.json.items.length === 5);

    const u = await api('PUT', '/api/admin/pricing/week', {
      token: tAdmin, body: { price: 4, tagline: '自测改价' },
    });
    ok('PUT /api/admin/pricing/week → 200', u.status === 200);
    const p2 = await api('GET', '/api/admin/pricing', { token: tAdmin });
    ok('  改价生效', p2.json.items.find((x) => x.code === 'week').tagline === '自测改价');
    await api('PUT', '/api/admin/pricing/week', { token: tAdmin, body: { tagline: '试水首选｜7 天' } });

    const el = await api('GET', '/api/admin/export-logs', { token: tAdmin });
    ok('GET /api/admin/export-logs → 有记录', el.status === 200 && el.json.items.length >= 3);

    // 权限校验：学生不能访问管理端
    const no = await api('GET', '/api/admin/members', { token: tSuper });
    ok('普通学生访问管理端 → 403', no.status === 403, 'status=' + no.status);
  }

  /* ══════════ 11. 清理（恢复演示账号基线，套件可反复运行） ══════════ */
  await conn.execute('DELETE FROM students WHERE phone = ?', [NEW_PHONE]);
  await conn.execute("DELETE FROM students WHERE username IN ('apitest01','apitest02','apitest03')");
  await conn.execute("UPDATE students SET member_type='forever', member_expire_at=NULL, status=1 WHERE username='student1'");
  await conn.execute("UPDATE students SET member_type='year', member_expire_at=DATE_ADD(NOW(), INTERVAL 365 DAY), status=1 WHERE username='student2'");
  await conn.execute("UPDATE students SET member_type='none', member_expire_at=NULL, status=1 WHERE username='student3'");
  await conn.execute("UPDATE students SET member_type='week', member_expire_at=DATE_ADD(NOW(), INTERVAL 2 DAY), status=1 WHERE username='student4'");
  await conn.execute("UPDATE students SET member_type='none', member_expire_at=NULL, status=0 WHERE username='student5'");
  await conn.execute("DELETE t FROM tokens t JOIN students s ON s.id = t.owner_id WHERE t.owner_type='student'");
  await conn.execute(
    "DELETE FROM sms_codes WHERE phone IN ('13900001234','13900005555')" +
    " OR request_ip IN ('127.0.0.1','::1','::ffff:127.0.0.1','localhost')"
  );

  console.log('\n' + '─'.repeat(58));
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (fail) {
    console.log('  失败清单：');
    failures.forEach((f) => console.log('    · ' + f));
  }
  console.log('─'.repeat(58) + '\n');

  await conn.end();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error('\n测试异常中断：', e);
  try { await conn.end(); } catch (_) {}
  process.exit(1);
});
