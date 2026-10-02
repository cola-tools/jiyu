'use strict';
/**
 * 后端接口冒烟测试（不依赖任何测试框架，直接 node test/smoke.js 运行）
 *
 *   BASE=http://127.0.0.1:3210 node test/smoke.js
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3210';

let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('✅ ' + name + (extra ? '  → ' + extra : '')); }
  else { fail++; failures.push(name); console.log('❌ ' + name + (extra ? '  → ' + extra : '')); }
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
  return { status: res.status, data };
}

(async function main() {
  console.log('\n════════ 后端接口冒烟测试 ════════\n' + BASE + '\n');

  /* ── 0. 健康检查 ── */
  let r = await api('GET', '/api/health');
  ok('健康检查', r.status === 200 && r.data.ok === true, JSON.stringify(r.data));

  /* ── 1. 登录 ── */
  r = await api('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin@2026', role: 'admin' } });
  ok('管理员登录', r.status === 200 && !!r.data.token, r.data.user && r.data.user.name);
  const adminToken = r.data.token;

  const stuTokens = {};
  const stuAccounts = [
    ['student1', 'xiaoran2026'], ['student2', 'linux2026'], ['student3', 'study2026'],
    ['student4', 'buddy2026'], ['student5', 'hello2026'],
  ];
  for (const [u, p] of stuAccounts) {
    r = await api('POST', '/api/auth/login', { body: { username: u, password: p, role: 'student' } });
    if (r.status === 200) stuTokens[u] = r.data.token;
  }
  ok('5 个学生账号均可登录', Object.keys(stuTokens).length === 5, Object.keys(stuTokens).join(', '));

  r = await api('POST', '/api/auth/login', { body: { username: 'admin', password: 'wrong-password', role: 'admin' } });
  ok('错误密码被拒绝', r.status === 401, 'HTTP ' + r.status);

  /* ── 2. 权限隔离 ── */
  r = await api('GET', '/api/admin/overview', { token: stuTokens.student1 });
  ok('学生访问管理端被拒绝', r.status === 403, 'HTTP ' + r.status);
  r = await api('GET', '/api/tree', {});
  ok('未登录访问被拒绝', r.status === 401, 'HTTP ' + r.status);

  /* ── 3. 学生端：目录树 ── */
  const T1 = stuTokens.student1;
  r = await api('GET', '/api/tree', { token: T1 });
  const tree = r.data.tree || [];
  const L1 = tree.filter((x) => x.level === 1);
  const L3 = tree.filter((x) => x.level === 3);
  ok('学习目录树返回', tree.length > 3000, `共 ${tree.length} 个节点`);
  ok('主目录 3 个', L1.length === 3, L1.map((x) => x.title).join(' / '));
  ok('可打卡学习目录 484 个', L3.filter((x) => x.checkable).length === 484, `${L3.filter((x) => x.checkable).length}`);

  /* 找一个可打卡单元 */
  const target = L3.find((x) => x.checkable && x.title === 'Linux 简介') || L3.find((x) => x.checkable);
  ok('定位到可打卡单元', !!target, target && `#${target.id} ${target.title}`);

  r = await api('GET', `/api/units/${target.id}`, { token: T1 });
  ok('单元详情返回正文', r.status === 200 && Array.isArray(r.data.children) && r.data.children.length > 0,
    `${r.data.children.length} 个子内容，路径 ${r.data.unit.path}`);
  const contentChild = r.data.children.find((c) => c.body);
  ok('学习内容含正文', !!contentChild, contentChild && `[${contentChild.contentType}] ${String(contentChild.body).slice(0, 40)}`);

  /* ── 4. 打卡 → 后台可见 ── */
  const today = new Date().toISOString().slice(0, 10);
  r = await api('POST', '/api/checkins', { token: T1, body: { unitIds: [target.id], date: today } });
  ok('学生打卡成功', r.status === 200 && r.data.count === 1, JSON.stringify(r.data));

  r = await api('GET', '/api/my/stats', { token: T1 });
  ok('学生进度统计更新', r.data.done === 1 && r.data.percent > 0, `完成 ${r.data.done} 项，${r.data.percent}%`);

  r = await api('GET', '/api/my/checkins', { token: T1 });
  ok('学生打卡记录可查', r.data.items.length === 1 && r.data.items[0].title === target.title,
    r.data.items[0] && r.data.items[0].date);

  r = await api('GET', '/api/admin/activity?limit=10', { token: adminToken });
  const act = (r.data.items || []).find((x) => x.action === 'checkin');
  ok('后台实时动态显示打卡', !!act, act && `${act.actorName} 打卡 ${act.target}`);

  r = await api('GET', '/api/admin/overview', { token: adminToken });
  ok('后台面板统计打卡数', r.data.stats.totalCheckins >= 1, `总打卡 ${r.data.stats.totalCheckins}，今日 ${r.data.stats.todayCheckins}`);
  const stu1 = (r.data.students || []).find((s) => s.username === 'student1');
  ok('后台学生排行含进度', stu1 && stu1.done === 1, stu1 && `${stu1.name} ${stu1.percent}%`);
  ok('后台趋势数据存在', Array.isArray(r.data.trend), `${r.data.trend.length} 天`);
  ok('后台按主目录统计', (r.data.byRoot || []).length === 3, (r.data.byRoot || []).map((x) => `${x.title}:${x.done}/${x.total}`).join(' '));

  /* ── 5. 撤销打卡 → 后台显示"已撤销" ── */
  r = await api('POST', '/api/checkins/revoke', { token: T1, body: { unitIds: [target.id] } });
  ok('学生撤销打卡成功', r.status === 200 && r.data.count === 1, JSON.stringify(r.data));

  r = await api('GET', '/api/my/stats', { token: T1 });
  ok('撤销后进度回落', r.data.done === 0, `完成 ${r.data.done} 项`);

  r = await api('GET', '/api/admin/activity?limit=20', { token: adminToken });
  const rv = (r.data.items || []).find((x) => x.action === 'revoke');
  ok('后台动态显示"已撤销打卡"', !!rv, rv && `${rv.actorName} 撤销 ${rv.target}`);

  r = await api('GET', '/api/admin/logs?action=revoke', { token: adminToken });
  ok('后台打卡流水可筛"撤销"', (r.data.items || []).length >= 1,
    (r.data.items[0] && `${r.data.items[0].studentName} 撤销《${r.data.items[0].unitTitle}》`) || '');

  /* ── 6. 管理员新增目录与内容 ── */
  r = await api('POST', '/api/admin/units', {
    token: adminToken, body: { title: '测试主目录', summary: '冒烟测试创建', difficulty: 1 },
  });
  ok('新增主目录', r.status === 200 && r.data.level === 1, 'id=' + r.data.id);
  const newL1 = r.data.id;

  r = await api('POST', '/api/admin/units', {
    token: adminToken, body: { parentId: newL1, title: '测试次目录' },
  });
  ok('新增次目录', r.status === 200 && r.data.level === 2, 'id=' + r.data.id);
  const newL2 = r.data.id;

  r = await api('POST', '/api/admin/units', {
    token: adminToken, body: { parentId: newL2, title: '测试学习目录', checkable: true },
  });
  ok('新增学习目录（可打卡）', r.status === 200 && r.data.level === 3, 'id=' + r.data.id);
  const newL3 = r.data.id;

  r = await api('POST', '/api/admin/units', {
    token: adminToken,
    body: { parentId: newL3, title: '测试学习内容', contentType: 'code', body: 'echo hello', lang: 'bash' },
  });
  ok('新增学习内容（代码块）', r.status === 200 && r.data.level === 4, 'id=' + r.data.id);
  const newL4 = r.data.id;

  r = await api('GET', '/api/tree', { token: T1 });
  ok('学生端立即可见新增内容',
    (r.data.tree || []).some((x) => x.id === newL3 && x.checkable),
    (r.data.tree || []).find((x) => x.id === newL3)?.title);

  r = await api('PUT', `/api/admin/units/${newL4}`, {
    token: adminToken, body: { body: 'echo "hello linux"', summary: '已修改' },
  });
  ok('修改学习内容', r.status === 200);

  r = await api('POST', '/api/checkins', { token: T1, body: { unitIds: [newL3], date: today } });
  ok('学生可对新增学习目录打卡', r.status === 200, JSON.stringify(r.data));

  /* ── 7. 督促 ── */
  const dl = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  r = await api('POST', '/api/admin/urges', {
    token: adminToken,
    body: {
      studentIds: [1, 2, 3],
      unitId: newL3,
      title: '请尽快完成本章',
      message: '这一章是重点，务必在截止时间前学完并打卡，有问题随时问我。',
      deadline: dl,
      priority: 3,
    },
  });
  ok('管理员发送督促', r.status === 200 && r.data.targets === 3, `投递 ${r.data.targets} 人，urgeId=${r.data.urgeId}`);
  const urgeId = r.data.urgeId;

  r = await api('GET', '/api/my/messages', { token: T1 });
  const msg = (r.data.items || [])[0];
  ok('学生收到督促消息', !!msg, msg && `《${msg.title}》截止 ${msg.deadline} 优先级 ${msg.priority}`);
  ok('督促含管理员留言', msg && msg.message.includes('重点'));
  ok('督促关联章节路径', msg && msg.unitPath && msg.unitPath.includes('测试学习目录'), msg && msg.unitPath);

  r = await api('GET', '/api/my/stats', { token: T1 });
  ok('未读督促计数', r.data.unreadUrges >= 1, `${r.data.unreadUrges} 条未读`);

  r = await api('POST', `/api/my/messages/${msg.targetId}/read`, { token: T1 });
  ok('学生标记督促已读', r.status === 200);

  r = await api('POST', `/api/my/messages/${msg.targetId}/done`, { token: T1 });
  ok('学生标记督促已完成', r.status === 200);

  r = await api('GET', `/api/admin/urges/${urgeId}/targets`, { token: adminToken });
  const t1 = (r.data.items || []).find((x) => x.studentId === 1);
  ok('后台可跟踪督促已读/完成', t1 && t1.read && t1.done, `已读 ${t1?.readAt}，完成 ${t1?.doneAt}`);

  r = await api('GET', '/api/admin/urges', { token: adminToken });
  ok('督促列表统计正确', (r.data.items || []).some((x) => x.id === urgeId && x.readCount >= 1),
    (r.data.items[0] && `目标 ${r.data.items[0].targets}，已读 ${r.data.items[0].readCount}，完成 ${r.data.items[0].doneCount}`) || '');

  /* ── 8. 题库 / 出题 ── */
  r = await api('POST', '/api/admin/questions', {
    token: adminToken,
    body: {
      unitId: newL3, type: 'single', stem: '以下哪个命令用于查看当前工作目录？',
      options: ['ls', 'pwd', 'cd', 'cat'], answer: 'B', analysis: 'pwd = print working directory', difficulty: 1, score: 5,
    },
  });
  ok('管理员新增单选题', r.status === 200, 'id=' + r.data.id);
  const qSingle = r.data.id;

  r = await api('POST', '/api/admin/questions', {
    token: adminToken,
    body: { unitId: newL3, type: 'judge', stem: 'rm -rf / 是安全的命令。', answer: '0', analysis: '极度危险', difficulty: 1 },
  });
  const qJudge = r.data.id;
  ok('管理员新增判断题', r.status === 200, 'id=' + qJudge);

  r = await api('POST', '/api/admin/questions/batch', {
    token: adminToken,
    body: {
      unitId: newL3,
      items: [
        { type: 'multiple', stem: '以下属于 Linux 发行版的有？', options: ['Ubuntu', 'CentOS', 'Windows', 'Debian'], answer: 'ABD', difficulty: 2 },
        { type: 'fill', stem: '查看文件内容的命令是 ______。', answer: 'cat|less|more', difficulty: 1 },
      ],
    },
  });
  ok('批量导入题目', r.status === 200 && r.data.count === 2, `导入 ${r.data.count} 题`);

  r = await api('GET', '/api/my/exercises?unitId=' + newL3, { token: T1 });
  ok('学生端可获取本单元练习', (r.data.items || []).length === 4, `${(r.data.items || []).length} 题`);
  ok('学生端不下发正确答案',
    (r.data.items || []).every((x) => x.answer === undefined), '正确答案未泄露');

  r = await api('POST', '/api/my/exercises/submit', { token: T1, body: { questionId: qSingle, answer: 'B' } });
  ok('答对单选题判定正确', r.data.correct === true, `解析：${r.data.analysis}`);
  r = await api('POST', '/api/my/exercises/submit', { token: stuTokens.student2, body: { questionId: qSingle, answer: 'A' } });
  ok('答错判定为错', r.data.correct === false);
  r = await api('POST', '/api/my/exercises/submit', { token: T1, body: { questionId: qJudge, answer: '错' } });
  ok('判断题中文答案识别', r.data.correct === true);

  r = await api('GET', '/api/admin/questions/stats', { token: adminToken });
  ok('后台题目正确率统计', (r.data.items || []).length === 4, JSON.stringify((r.data.items || [])[0]));

  /* ── 9. 学生名单 CRUD ── */
  r = await api('POST', '/api/admin/students', {
    token: adminToken,
    body: { username: 'student6', password: 'test123456', name: '测试同学', sno: '2026006', className: '计算机应用 2 班', phone: '13900000006' },
  });
  ok('新增学生（含姓名/学号/班级/电话）', r.status === 200, 'id=' + r.data.id);
  const newStu = r.data.id;

  r = await api('GET', '/api/admin/students', { token: adminToken });
  ok('学生列表含 6 人', (r.data.items || []).length === 6,
    (r.data.items || []).map((s) => `${s.name}(${s.sno})`).join(' '));

  r = await api('POST', '/api/auth/login', { body: { username: 'student6', password: 'test123456', role: 'student' } });
  ok('新学生可登录', r.status === 200 && r.data.user.name === '测试同学',
    r.data.user && `${r.data.user.name} / ${r.data.user.className} / ${r.data.user.phone}`);
  const T6 = r.data.token;

  r = await api('PUT', `/api/admin/students/${newStu}`, {
    token: adminToken,
    body: { name: '测试同学（改）', sno: '2026666', className: '计算机应用 3 班', phone: '13911112222' },
  });
  ok('修改学生资料', r.status === 200);
  r = await api('GET', '/api/auth/me', { token: T6 });
  ok('学生端资料同步更新', r.data.user.name === '测试同学（改）' && r.data.user.sno === '2026666',
    `${r.data.user.name} / ${r.data.user.sno} / ${r.data.user.className} / ${r.data.user.phone}`);

  r = await api('PUT', `/api/admin/students/${newStu}`, { token: adminToken, body: { password: 'newpass888' } });
  ok('管理员重置学生密码', r.status === 200);
  r = await api('POST', '/api/auth/login', { body: { username: 'student6', password: 'newpass888', role: 'student' } });
  ok('新密码可登录', r.status === 200);
  r = await api('POST', '/api/auth/login', { body: { username: 'student6', password: 'test123456', role: 'student' } });
  ok('旧密码失效', r.status === 401);

  /* ── 10. 学生详情档案 ── */
  r = await api('GET', '/api/admin/students/1/detail', { token: adminToken });
  ok('管理员查看学生档案', r.status === 200 && Array.isArray(r.data.checkins),
    `打卡 ${r.data.checkins.length} 条，流水 ${r.data.logs.length} 条，答题 ${r.data.quiz.answered} 题`);
  ok('档案含撤销记录', r.data.logs.some((l) => l.action === 'revoke'), '已包含 revoke 流水');

  /* ── 11. 越权访问他人数据 ── */
  r = await api('POST', '/api/checkins/revoke', { token: stuTokens.student3, body: { unitIds: [newL3] } });
  ok('学生无法撤销他人打卡（自己本就没有记录）', r.status === 400, 'HTTP ' + r.status);

  /* ── 12. 清理测试数据 ── */
  r = await api('DELETE', `/api/admin/units/${newL1}`, { token: adminToken });
  ok('级联删除测试目录', r.status === 200 && r.data.removed === 4, `移除 ${r.data.removed} 个节点`);
  r = await api('DELETE', `/api/admin/students/${newStu}`, { token: adminToken });
  ok('删除测试学生', r.status === 200);
  r = await api('DELETE', `/api/admin/urges/${urgeId}`, { token: adminToken });
  ok('删除测试督促', r.status === 200);

  r = await api('GET', '/api/tree', { token: T1 });
  ok('删除后学生端不再可见', !(r.data.tree || []).some((x) => x.id === newL1 || x.id === newL3));

  /* ── 汇总 ── */
  console.log('\n════════════════════════════════');
  console.log(`合计 ${pass + fail} 项，通过 ${pass}，失败 ${fail}`);
  if (fail) console.log('失败项：\n  - ' + failures.join('\n  - '));
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('\n测试崩溃：', e);
  process.exit(2);
});
