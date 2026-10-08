/* ══════════════════════════════════════════════════════════════════
   views/admin.js · 管理端
   ──────────────────────────────────────────────────────────────────
   视图：数据面板 / 学生名单 / 目录内容 / 督促管理 / 题库管理 / 打卡流水 / 我的资料
   管理员权限：学生名单 CRUD、四级目录 CRUD、督促投递、出题、查看全部进度与流水
   ══════════════════════════════════════════════════════════════════ */
(function (w, d) {
  'use strict';

  var U = w.U;
  var UI = w.UI;
  var API = w.API;
  var STORE = w.STORE;

  var A = {};

  /* ───────── 视图内状态 ───────── */
  var S = {
    expanded: {},
    noAutoExpand: false,
    studentQuery: '',
    logStudentId: '',
    logAction: '',
    qUnitId: '',
    urgeFilter: '',
    /* 提醒学生：当前选中的重要性（1普通 2重要 3紧急） */
    noticePriority: 1,
    /* 会员管理筛选 */
    memberQuery: '',
    memberType: '',
    memberStatus: '',
  };

  var LV_ICO = { 1: '📚', 2: '📂', 3: '📄', 4: '📝' };
  var CTYPES = [
    { v: 'text', t: '正文' }, { v: 'code', t: '代码' }, { v: 'table', t: '表格' },
    { v: 'list', t: '清单' }, { v: 'note', t: '提示' }, { v: 'cmd', t: '命令' },
  ];

  /* ═══════════════════ 公共：加载全部节点 ═══════════════════ */

  function loadUnits(force) {
    if (!force && STORE.adminUnitsFresh()) return Promise.resolve(STORE.state.adminUnits);
    return API.admin.units().then(function (r) {
      STORE.state.adminUnits = r.items || [];
      STORE.state.adminUnitsAt = Date.now();
      return STORE.state.adminUnits;
    });
  }

  function idxOf(list) {
    var byId = {}, byParent = {};
    (list || []).forEach(function (n) {
      byId[n.id] = n;
      var p = n.parentId == null ? 0 : n.parentId;
      if (!byParent[p]) byParent[p] = [];
      byParent[p].push(n);
    });
    return { byId: byId, byParent: byParent };
  }

  function statCard(ico, label, val, unit, foot, cls) {
    return '<div class="stat-card ' + (cls || '') + '">' +
      '<div class="s-top"><span class="s-ico">' + ico + '</span><span>' + U.esc(label) + '</span></div>' +
      '<div class="s-num">' + U.esc(val) + (unit ? '<small>' + U.esc(unit) + '</small>' : '') + '</div>' +
      '<div class="s-foot">' + U.esc(foot) + '</div>' +
    '</div>';
  }

  function infoCell(k, v, cls) {
    return '<div class="info-cell"><div class="ic-k">' + U.esc(k) + '</div>' +
      '<div class="ic-v ' + (cls || '') + '">' + U.esc(v) + '</div></div>';
  }

  function barLine(done, total) {
    var p = U.pct(done, total);
    return '<div class="bar-line">' +
      '<div class="bar ' + U.pctClass(p) + '"><i style="width:' + p + '%"></i></div>' +
      '<span class="bar-pct">' + U.pctText(p) + '</span>' +
    '</div>';
  }

  function emptyBox(ico, title, sub, cta) {
    return '<div class="panel"><div class="panel-body">' + U.empty(ico, title, sub, cta) + '</div></div>';
  }

  /* ═══════════════════ 视图：数据面板 ═══════════════════ */

  A.dashboard = {
    title: '数据面板',
    icon: '📊',
    nav: true,
    group: '概览',
    render: function (host) {
      host.innerHTML = U.loading('正在汇总学习数据…');

      Promise.all([API.admin.overview(), API.admin.activity(40)]).then(function (res) {
        var ov = res[0] || {};
        var st = ov.stats || {};
        var students = ov.students || [];
        var trend = ov.trend || [];
        var byRoot = ov.byRoot || [];
        var acts = (res[1] && res[1].items) || [];

        var html = '';

        html += '<div class="page-head">' +
          '<div><h2>📊 学习数据面板</h2>' +
            '<div class="ph-sub">数据实时同步 · 学生在学生端打卡后此处立即更新</div></div>' +
          '<div class="ph-actions">' +
            '<button class="btn" data-act="refresh" type="button">🔄 刷新</button>' +
            '<button class="btn btn-primary" data-act="urge" type="button">📣 发督促</button>' +
          '</div>' +
        '</div>';

        // 关键指标
        html += '<div class="stats-grid">' +
          statCard('👥', '学生总数', U.num(st.totalStudents), '人', '当前在册', '') +
          statCard('📚', '可打卡知识点', U.num(st.totalUnits), '个', '四级目录体系', '') +
          statCard('✅', '累计打卡', U.num(st.totalCheckins), '次', '今日 ' + U.num(st.todayCheckins) + ' 次', 'ok') +
          statCard('↩️', '撤销打卡', U.num(st.revokes), '次', '学生主动撤销', st.revokes ? 'warn' : '') +
          statCard('📣', '未读督促', U.num(st.pendingUrges), '条', '学生尚未查看', st.pendingUrges ? 'danger' : '') +
        '</div>';

        // 趋势 + 主目录完成度
        html += '<div class="grid-2-1">';

        html += '<div class="panel">' +
          '<div class="panel-head"><h3>📈 近 14 天打卡趋势</h3>' +
            '<div class="ph-tools"><span class="chip xsmall">按打卡条数</span></div>' +
          '</div>' +
          '<div class="panel-body">' + trendChart(trend) + '</div>' +
        '</div>';

        html += '<div class="panel">' +
          '<div class="panel-head"><h3>📚 主目录完成度</h3></div>' +
          '<div class="panel-body">' +
            (byRoot.length
              ? '<div style="display:flex;flex-direction:column;gap:14px">' + byRoot.map(function (r) {
                  return '<div>' +
                    '<div class="between mb8"><span class="bold">' + U.esc(r.title) + '</span>' +
                      '<span class="dim xsmall num">' + U.num(r.done) + ' / ' + U.num(r.total) + '</span></div>' +
                    barLine(r.done, r.total) +
                  '</div>';
                }).join('') + '</div>'
              : U.empty('📭', '暂无目录数据', '先去「目录内容」创建学习目录')) +
          '</div>' +
        '</div>';

        html += '</div>';

        // 学生进度排行
        html += '<div class="panel">' +
          '<div class="panel-head"><h3>🏆 学生学习进度排行</h3>' +
            '<div class="ph-tools">' +
              '<button class="btn btn-sm" data-go="students" type="button">管理名单</button>' +
              '<button class="btn btn-sm" data-go="logs" type="button">打卡流水</button>' +
            '</div>' +
          '</div>' +
          '<div class="panel-body flush tbl-scroll">' + studentTable(students) + '</div>' +
        '</div>';

        // 实时动态
        html += '<div class="panel">' +
          '<div class="panel-head"><h3>⚡ 实时动态</h3>' +
            '<div class="ph-tools"><span class="chip xsmall">最近 ' + acts.length + ' 条</span></div>' +
          '</div>' +
          '<div class="panel-body">' +
            (acts.length
              ? '<div class="timeline">' + acts.map(function (a) {
                  var f = U.feed(a.action);
                  return '<div class="tl-item ' + f.cls + '">' +
                    '<div class="tl-top">' +
                      '<b>' + f.ico + ' ' + U.esc(a.actorName || '系统') + '</b>' +
                      '<span class="dim">' + U.esc(f.label) + '</span>' +
                      (a.target ? '<span class="dim2">' + U.esc(U.trunc(a.target, 42)) + '</span>' : '') +
                      '<span class="tl-time">' + U.esc(U.relTime(a.at)) + '</span>' +
                    '</div>' +
                    (a.detail ? '<div class="tl-sub">' + U.esc(a.detail) + '</div>' : '') +
                  '</div>';
                }).join('') + '</div>'
              : U.empty('💤', '暂无动态', '学生登录、打卡、撤销都会在这里实时出现')) +
          '</div>' +
        '</div>';

        host.innerHTML = html;

        // refresh 按钮由 #app 事件委托统一处理
      }).catch(function (e) {
        host.innerHTML = U.errorBox(e.message,
          '<button class="btn btn-primary" data-act="retry" type="button">重新加载</button>');
        var r = host.querySelector('[data-act="retry"]');
        if (r) r.addEventListener('click', function () { A.dashboard.render(host); });
      });
    },
  };

  function trendChart(trend) {
    if (!trend.length) {
      return U.empty('📉', '近 14 天暂无打卡数据', '学生开始打卡后这里会显示每日趋势');
    }
    var max = trend.reduce(function (m, t) { return Math.max(m, t.count); }, 1);
    var totalCount = trend.reduce(function (s, t) { return s + t.count; }, 0);
    var activeDays = trend.filter(function (t) { return t.count > 0; }).length;

    var bars = trend.map(function (t) {
      var h = Math.max(3, Math.round((t.count / max) * 100));
      var short = t.date ? t.date.slice(5) : '';
      return '<div class="cb" title="' + U.escAttr(t.date + '：' + t.count + ' 次打卡，' + t.students + ' 人参与') + '">' +
        '<span class="cb-v">' + (t.count || '') + '</span>' +
        '<i style="height:' + h + '%"></i>' +
        '<span class="cb-d">' + U.esc(short) + '</span>' +
      '</div>';
    }).join('');

    return '<div class="chart-bars">' + bars + '</div>' +
      '<div class="chart-legend">' +
        '<span><i style="background:var(--accent)"></i>每日打卡条数</span>' +
        '<span>14 天合计 <b class="num">' + totalCount + '</b> 次</span>' +
        '<span>有打卡的天数 <b class="num">' + activeDays + '</b> / ' + trend.length + ' 天</span>' +
        '<span>单日最高 <b class="num">' + max + '</b> 次</span>' +
      '</div>';
  }

  function studentTable(students) {
    if (!students.length) {
      return U.empty('👥', '还没有学生', '点击「新增学生」创建第一个学习账号',
        '<button class="btn btn-primary" data-act="student-new" type="button">新增学生</button>');
    }
    return '<table class="tbl"><thead><tr>' +
      '<th style="width:46px">#</th><th>学生</th><th>账号</th><th>班级</th><th>联系电话</th>' +
      '<th style="min-width:158px">学习进度</th><th>最近打卡</th><th>未读</th><th style="width:196px">操作</th>' +
    '</tr></thead><tbody>' +
      students.map(function (s, i) {
        var medal = ['🥇', '🥈', '🥉'][i] || (i + 1);
        return '<tr>' +
          '<td class="nowrap">' + medal + '</td>' +
          '<td><div class="flex gap8">' +
            '<span class="pavatar ' + U.avatarClass(s.id) + '" style="width:32px;height:32px;font-size:14px">' +
              U.esc(U.initial(s.name, s.username)) + '</span>' +
            '<div><div class="bold">' + U.esc(s.name || '—') + '</div>' +
              '<div class="dim xsmall">' + U.esc(s.sno || '') + '</div></div>' +
          '</div></td>' +
          '<td class="mono xsmall">' + U.esc(s.username) + '</td>' +
          '<td class="xsmall">' + U.esc(s.className || '—') + '</td>' +
          '<td class="mono xsmall">' + U.esc(s.phone || '—') + '</td>' +
          '<td><div class="bar-line">' +
            '<div class="bar slim ' + U.pctClass(s.percent) + '"><i style="width:' + s.percent + '%"></i></div>' +
            '<span class="bar-pct" style="min-width:62px;font-size:13px">' + U.num(s.done) + ' · ' + U.pctText(s.percent) + '</span>' +
          '</div></td>' +
          '<td class="xsmall nowrap">' + U.esc(s.lastCheckinAt ? U.relTime(s.lastCheckinAt) : '从未打卡') + '</td>' +
          '<td>' + (s.unreadUrges ? '<span class="badge">' + s.unreadUrges + '</span>' : '<span class="dim">—</span>') + '</td>' +
          '<td class="nowrap">' +
            '<button class="btn btn-sm" data-student-detail="' + s.id + '" type="button">详情</button> ' +
            '<button class="btn btn-sm btn-primary" data-student-urge="' + s.id + '" type="button">督促</button>' +
          '</td>' +
        '</tr>';
      }).join('') +
    '</tbody></table>';
  }

  /* ═══════════════════ 视图：学生名单 ═══════════════════ */

  A.students = {
    title: '学生名单',
    icon: '👥',
    nav: true,
    group: '概览',
    render: function (host) {
      host.innerHTML = U.loading('正在加载学生名单…');

      API.admin.students().then(function (r) {
        var items = r.items || [];
        var total = r.total || 0;

        var html = '';
        html += '<div class="page-head">' +
          '<div><h2>👥 学生名单</h2>' +
            '<div class="ph-sub">共 ' + items.length + ' 名学生 · 姓名 / 学号 / 班级 / 联系电话均可维护</div></div>' +
          '<div class="ph-actions">' +
            '<button class="btn" data-act="refresh" type="button">🔄 刷新</button>' +
            '<button class="btn btn-primary" data-act="new" type="button">➕ 新增学生</button>' +
          '</div>' +
        '</div>';

        // 汇总
        var enabled = items.filter(function (s) { return s.status === 1; }).length;
        var avg = items.length
          ? Math.round(items.reduce(function (a, s) { return a + (s.percent || 0); }, 0) / items.length)
          : 0;
        var noCheckin = items.filter(function (s) { return !s.done; }).length;

        html += '<div class="stats-grid">' +
          statCard('👥', '学生总数', items.length, '人', '启用 ' + enabled + ' 人', '') +
          statCard('📈', '平均进度', avg, '%', '基于 ' + total + ' 个知识点', 'accent') +
          statCard('🌱', '零打卡学生', noCheckin, '人', noCheckin ? '建议单独督促' : '全员已开始', noCheckin ? 'warn' : 'ok') +
          statCard('📚', '知识点总数', U.num(total), '个', '可打卡单元', '') +
        '</div>';

        // 搜索 + 列表
        html += '<div class="filters">' +
          '<span class="fl-label">搜索</span>' +
          '<input class="input" id="stuSearch" type="search" placeholder="姓名 / 学号 / 账号 / 班级 / 电话" ' +
            'value="' + U.escAttr(S.studentQuery) + '" style="min-width:250px">' +
          '<span class="spacer"></span>' +
          '<span class="dim small">显示 <b class="num" id="stuShown">' + items.length + '</b> / ' + items.length + '</span>' +
        '</div>';

        html += '<div class="panel"><div class="panel-body flush" id="stuList">' +
          (items.length ? '<div class="list">' + items.map(function (s) {
            return '<div class="list-row" data-row="' + s.id + '" data-search="' +
              U.escAttr([s.name, s.sno, s.username, s.className, s.phone].join(' ')) + '">' +
              '<span class="pavatar ' + U.avatarClass(s.id) + '">' + U.esc(U.initial(s.name, s.username)) + '</span>' +
              '<div class="l-main">' +
                '<div class="l-title">' + U.esc(s.name || '—') +
                  (s.status ? '' : '<span class="chip d4 xsmall">已停用</span>') +
                  (s.unreadUrges ? '' : '') +
                '</div>' +
                '<div class="l-sub">学号 ' + U.esc(s.sno || '—') + ' · ' + U.esc(s.className || '未分班') +
                  ' · 📞 ' + U.esc(s.phone || '—') + ' · 🔑 <span class="mono">' + U.esc(s.username) + '</span></div>' +
              '</div>' +
              '<div class="l-bar">' + barLine(s.done, total) + '</div>' +
              '<div class="l-right">' +
                '<span class="chip xsmall">' + U.num(s.done) + ' 项 · ' + U.pctText(s.percent) + '</span>' +
                '<span class="dim xsmall nowrap">' + U.esc(s.lastLoginAt ? '登录 ' + U.relTime(s.lastLoginAt) : '从未登录') + '</span>' +
                '<button class="btn btn-sm" data-detail="' + s.id + '" type="button">详情</button>' +
                '<button class="btn btn-sm btn-primary" data-urge="' + s.id + '" type="button">督促</button>' +
                '<button class="btn btn-sm" data-stu-edit="' + s.id + '" type="button">编辑</button>' +
              '</div>' +
            '</div>';
          }).join('') + '</div>'
          : U.empty('👥', '还没有学生', '点击「新增学生」创建第一个学习账号',
              '<button class="btn btn-primary" data-act="new" type="button">新增学生</button>')) +
        '</div></div>';

        host.innerHTML = html;

        // 搜索
        var inp = host.querySelector('#stuSearch');
        var shown = host.querySelector('#stuShown');
        var doSearch = U.debounce(function () {
          var q = (inp.value || '').trim().toLowerCase();
          S.studentQuery = inp.value;
          var n = 0;
          U.qsa('[data-row]', host).forEach(function (row) {
            var hay = (row.dataset.search || '').toLowerCase();
            var ok = !q || hay.indexOf(q) >= 0;
            row.hidden = !ok;
            if (ok) n++;
          });
          if (shown) shown.textContent = n;
        }, 180);
        if (inp) inp.addEventListener('input', doSearch);

        // refresh 按钮由 #app 事件委托统一处理
      }).catch(function (e) {
        host.innerHTML = U.errorBox(e.message,
          '<button class="btn btn-primary" data-act="retry" type="button">重新加载</button>');
        var r = host.querySelector('[data-act="retry"]');
        if (r) r.addEventListener('click', function () { A.students.render(host); });
      });
    },
  };

  /* ───────── 学生编辑弹层 ───────── */

  function openStudentEditor(student, onDone) {
    var s = student || { username: '', name: '', sno: '', className: '', phone: '', email: '', remark: '', status: 1 };
    var isNew = !student;

    var html =
      '<div class="sect-title"><span class="st-n">1</span>必填信息</div>' +
      '<div class="form-grid">' +
        '<div class="field"><label class="field-label">姓名 *</label>' +
          '<input class="input" id="fName" type="text" value="' + U.escAttr(s.name) + '" placeholder="如：张三"></div>' +
        '<div class="field"><label class="field-label">学号</label>' +
          '<input class="input" id="fSno" type="text" value="' + U.escAttr(s.sno) + '" placeholder="如：2026001"></div>' +
        '<div class="field"><label class="field-label">班级</label>' +
          '<input class="input" id="fClass" type="text" value="' + U.escAttr(s.className) + '" placeholder="如：计算机应用 1 班"></div>' +
        '<div class="field"><label class="field-label">联系电话</label>' +
          '<input class="input" id="fPhone" type="tel" value="' + U.escAttr(s.phone) + '" placeholder="如：13800000000"></div>' +
      '</div>' +
      '<div class="divider"></div>' +
      '<div class="sect-title"><span class="st-n">2</span>登录账号</div>' +
      '<div class="form-grid">' +
        '<div class="field"><label class="field-label">账号 *</label>' +
          '<input class="input" id="fUser" type="text" value="' + U.escAttr(s.username) + '" ' +
            (isNew ? 'placeholder="如：student6"' : 'readonly style="opacity:.7"') + '>' +
          (isNew ? '<div class="field-hint">3-64 位字母、数字或 _ . @ -</div>' : '<div class="field-hint">账号创建后不可修改</div>') +
        '</div>' +
        '<div class="field"><label class="field-label">密码 ' + (isNew ? '*' : '（留空则不修改）') + '</label>' +
          '<input class="input" id="fPwd" type="text" placeholder="' + (isNew ? '至少 6 位' : '留空表示保持原密码') + '"></div>' +
      '</div>' +
      '<div class="divider"></div>' +
      '<div class="sect-title"><span class="st-n">3</span>其他</div>' +
      '<div class="form-grid">' +
        '<div class="field"><label class="field-label">邮箱</label>' +
          '<input class="input" id="fEmail" type="email" value="' + U.escAttr(s.email || '') + '"></div>' +
        '<div class="field"><label class="field-label">账号状态</label>' +
          '<label class="pick-opt' + (s.status ? ' on' : '') + '" id="fStatusWrap" style="cursor:pointer">' +
            '<input type="checkbox" id="fStatus"' + (s.status ? ' checked' : '') + '> 允许登录</label></div>' +
        '<div class="field full"><label class="field-label">备注</label>' +
          '<textarea class="textarea" id="fRemark" placeholder="如：基础较弱，需要多督促">' + U.esc(s.remark || '') + '</textarea></div>' +
      '</div>';

    var m = UI.modal({
      title: isNew ? '新增学生' : '编辑学生 · ' + (s.name || s.username),
      size: 'lg',
      body: html,
      foot: '<button class="btn" data-act="no" type="button">取消</button>' +
            '<button class="btn btn-primary" data-act="yes" type="button">' + (isNew ? '创建账号' : '保存修改') + '</button>',
      onMount: function (inst) {
        var wrap = inst.query('#fStatusWrap');
        var ck = inst.query('#fStatus');
        ck.addEventListener('change', function () { wrap.classList.toggle('on', ck.checked); });

        inst.foot.querySelector('[data-act="no"]').addEventListener('click', function () { inst.close(); });
        inst.foot.querySelector('[data-act="yes"]').addEventListener('click', function () {
          var btn = this;
          var body = {
            name: inst.query('#fName').value.trim(),
            sno: inst.query('#fSno').value.trim(),
            className: inst.query('#fClass').value.trim(),
            phone: inst.query('#fPhone').value.trim(),
            email: inst.query('#fEmail').value.trim(),
            remark: inst.query('#fRemark').value.trim(),
            status: inst.query('#fStatus').checked ? 1 : 0,
          };
          var pwd = inst.query('#fPwd').value;
          var uname = inst.query('#fUser').value.trim();

          if (!body.name) return UI.err('请填写姓名');
          if (isNew) {
            if (!uname) return UI.err('请填写登录账号');
            body.username = uname;
            if (!pwd || pwd.length < 6) return UI.err('密码至少 6 位');
            body.password = pwd;
          } else if (pwd) {
            if (pwd.length < 6) return UI.err('密码至少 6 位');
            body.password = pwd;
          }

          var rs = UI.btnBusy(btn, '保存中…');
          var req = isNew ? API.admin.studentCreate(body) : API.admin.studentUpdate(s.id, body);
          req.then(function () {
            UI.toast(isNew ? '学生账号已创建' : '学生资料已更新', 'ok', isNew ? '创建成功' : '保存成功');
            inst.close();
            if (onDone) onDone();
          }).catch(function (e) { UI.errToast(e); }).then(rs);
        });
      },
    });
  }

  /* ───────── 学生详情弹层 ───────── */

  function openStudentDetail(id) {
    var m = UI.modal({
      title: '学生详情',
      size: 'lg',
      body: U.loading('正在加载学习档案…'),
      foot: '<button class="btn" data-act="close" type="button">关闭</button>' +
            '<button class="btn btn-primary" data-act="urge" type="button">📣 督促该学生</button>',
      onMount: function (inst) {
        inst.foot.querySelector('[data-act="close"]').addEventListener('click', function () { inst.close(); });
      },
    });

    API.admin.studentDetail(id).then(function (r) {
      var s = r.student || {};
      var cks = r.checkins || [];
      var logs = r.logs || [];
      var quiz = r.quiz || {};
      var urges = r.urges || [];
      var done = cks.length;

      m.title('👤 ' + (s.name || s.username));

      var html = '';

      html += '<div class="flex gap16 wrap mb16" style="align-items:center">' +
        '<span class="pavatar ' + U.avatarClass(s.id) + '" style="width:58px;height:58px;font-size:23px">' +
          U.esc(U.initial(s.name, s.username)) + '</span>' +
        '<div class="grow" style="min-width:180px">' +
          '<div class="bold" style="font-size:19px">' + U.esc(s.name || '—') +
            (s.status ? '' : ' <span class="chip d4 xsmall">已停用</span>') + '</div>' +
          '<div class="dim small">' + U.esc(s.username) + '</div>' +
        '</div>' +
        '<div class="ph-actions">' +
          '<button class="btn btn-sm" data-act="edit" type="button">✏️ 编辑资料</button>' +
          '<button class="btn btn-sm" data-act="pwd" type="button">🔑 重置密码</button>' +
        '</div>' +
      '</div>';

      html += '<div class="info-grid mb16">' +
        infoCell('学号', s.sno || '—') +
        infoCell('班级', s.className || '—') +
        infoCell('联系电话', s.phone || '—') +
        infoCell('邮箱', s.email || '—') +
        infoCell('已打卡', done + ' 项', 'num') +
        infoCell('答题情况', (quiz.answered || 0) + ' 题 / 对 ' + (quiz.correct || 0), 'num') +
        infoCell('最近登录', s.lastLoginAt ? U.relTime(s.lastLoginAt) : '从未登录') +
        infoCell('创建时间', s.createdAt ? U.fmtDT(s.createdAt, true) : '—') +
      '</div>';

      // 撤销提示
      var revokes = logs.filter(function (l) { return l.action === 'revoke'; });
      if (revokes.length) {
        html += '<div class="note warn"><span class="n-ico">↩️</span><span>' +
          '该学生有 <b>' + revokes.length + '</b> 次撤销打卡记录，最近一次：' +
          U.esc(U.trunc(revokes[0].title || '', 40)) + '（' + U.esc(U.fmtDT(revokes[0].at)) + '）' +
        '</span></div>';
      }

      // 标签页内容用折叠面板呈现，避免弹层过长
      html += '<div class="divider"></div>';

      html += '<h3 class="sect-title"><span class="st-n">' + cks.length + '</span>打卡明细</h3>';
      html += cks.length
        ? '<div class="tbl-wrap" style="max-height:264px;overflow-y:auto"><table class="tbl"><thead><tr>' +
            '<th>学习内容</th><th>章节路径</th><th style="width:118px">打卡日期</th>' +
          '</tr></thead><tbody>' +
          cks.map(function (c) {
            return '<tr><td class="bold">' + U.esc(c.title) + '</td>' +
              '<td class="xsmall dim2">' + U.esc(c.path) + '</td>' +
              '<td class="num nowrap">' + U.esc(c.date) + '</td></tr>';
          }).join('') + '</tbody></table></div>'
        : '<div class="dim small">该学生还没有任何打卡记录。</div>';

      html += '<div class="divider"></div>';
      html += '<h3 class="sect-title"><span class="st-n">' + logs.length + '</span>操作流水（含撤销）</h3>';
      html += logs.length
        ? '<div class="timeline">' + logs.map(function (l) {
            var a = U.act(l.action);
            return '<div class="tl-item ' + a.cls + '">' +
              '<div class="tl-top"><b>' + a.ico + ' ' + U.esc(a.label) + '</b>' +
                '<span class="dim2">' + U.esc(U.trunc(l.title || '', 38)) + '</span>' +
                '<span class="tl-time">' + U.esc(U.fmtDT(l.at)) + '</span></div>' +
              (l.action === 'revoke'
                ? '<div class="tl-sub">撤销了 ' + U.esc(l.prevDate || '') + ' 的打卡</div>'
                : (l.newDate ? '<div class="tl-sub">打卡日期 ' + U.esc(l.newDate) + '</div>' : '')) +
            '</div>';
          }).join('') + '</div>'
        : '<div class="dim small">暂无操作流水。</div>';

      if (urges.length) {
        html += '<div class="divider"></div>';
        html += '<h3 class="sect-title"><span class="st-n">' + urges.length + '</span>收到过的督促</h3>';
        html += '<div style="display:flex;flex-direction:column;gap:9px">' + urges.map(function (u2) {
          return '<div class="flex gap8 wrap between" style="padding:9px 12px;background:var(--surface-2);' +
            'border:2px solid var(--stroke-soft);border-radius:12px">' +
            '<span>' + U.esc(U.trunc(u2.title, 44)) + '</span>' +
            '<span class="flex gap8">' +
              '<span class="chip ' + (u2.read ? 'd1' : 'd3') + ' xsmall">' + (u2.read ? '已读' : '未读') + '</span>' +
              '<span class="chip ' + (u2.done ? 'd1' : '') + ' xsmall">' + (u2.done ? '已完成' : '待完成') + '</span>' +
              (u2.deadline ? '<span class="dim xsmall">截止 ' + U.esc(U.fmtDT(u2.deadline)) + '</span>' : '') +
            '</span>' +
          '</div>';
        }).join('') + '</div>';
      }

      m.setBody(html);

      m.foot.querySelector('[data-act="urge"]').addEventListener('click', function () {
        m.close();
        openUrgeDialog([s.id]);
      });
      m.body.querySelector('[data-act="edit"]').addEventListener('click', function () {
        m.close();
        openStudentEditor(s, function () { openStudentDetail(id); });
      });
      m.body.querySelector('[data-act="pwd"]').addEventListener('click', function () {
        UI.prompt({
          title: '重置密码',
          label: '为 ' + (s.name || s.username) + ' 设置新密码',
          placeholder: '至少 6 位',
          hint: '重置后学生需用新密码登录。',
          okText: '重置密码',
        }).then(function (pwd) {
          if (pwd == null) return;
          if (pwd.length < 6) return UI.err('密码至少 6 位');
          API.admin.studentUpdate(id, { password: pwd }).then(function () {
            UI.toast('已重置 ' + (s.name || s.username) + ' 的密码', 'ok', '重置成功');
          }).catch(UI.errToast);
        });
      });
    }).catch(function (e) {
      m.setBody(U.errorBox(e.message));
    });
  }

  /* ───────── 章节点选择器 ───────── */

  function openUnitPicker(currentId) {
    return new Promise(function (resolve) {
      loadUnits().then(function (list) {
        var idx = idxOf(list);
        var exp = {};
        (list || []).forEach(function (n) { if (n.level <= 2) exp[n.id] = true; });

        var m = UI.modal({
          title: '选择督促章节',
          size: 'lg',
          body:
            '<div class="filters" style="margin-bottom:12px">' +
              '<span class="fl-label">搜索</span>' +
              '<input class="input" id="pkSearch" type="search" placeholder="输入目录或内容名称" style="flex:1;min-width:200px">' +
              '<span class="spacer"></span>' +
              '<label class="checkline"><input type="checkbox" id="pkCheckable"> 只看可打卡</label>' +
            '</div>' +
            '<div id="pkResult" hidden></div>' +
            '<div class="picker" id="pkTree">' + renderPickerNodes(idx.byParent[0] || [], idx, exp, 1) + '</div>' +
            '<div class="note info" style="margin-top:12px"><span class="n-ico">💡</span><span>' +
              '四级目录任选一层都可以：选「学习内容」最具体，选「主目录」范围最大。' +
            '</span></div>',
          foot: '<button class="btn" data-act="clear" type="button">不指定章节</button>' +
                '<button class="btn" data-act="close" type="button">取消</button>',
          onMount: function (inst) {
            inst._sel = currentId || null;

            function pickNode(id, title, path) {
              resolve({ id: id, title: title, path: path });
              inst.close();
            }

            // 树：展开 / 选择
            inst.body.addEventListener('click', function (e) {
              var t = e.target;
              var tg = t.closest && t.closest('[data-pk-toggle]');
              if (tg) {
                var nid = Number(tg.dataset.pkToggle);
                var body = inst.body.querySelector('[data-pk-body="' + nid + '"]');
                var open = !exp[nid];
                exp[nid] = open;
                if (body) {
                  if (open && !body.dataset.rendered) {
                    body.innerHTML = renderPickerNodes(idx.byParent[nid] || [], idx, exp, 2);
                    body.dataset.rendered = '1';
                  }
                  body.hidden = !open;
                }
                return;
              }
              var row = t.closest && t.closest('[data-pk-pick]');
              if (row) {
                pickNode(Number(row.dataset.pkPick), row.dataset.pkTitle, row.dataset.pkPath);
              }
            });

            // 搜索
            var si = inst.query('#pkSearch');
            var ro = inst.query('#pkResult');
            var tree = inst.query('#pkTree');
            var onlyCk = inst.query('#pkCheckable');

            function buildPath(n) {
              var parts = [n.title], cur = n, guard = 0;
              while (cur && cur.parentId != null && guard < 6) {
                var p = idx.byId[cur.parentId];
                if (!p) break;
                parts.unshift(p.title); cur = p; guard++;
              }
              return parts.join(' / ');
            }

            var runSearch = U.debounce(function () {
              var q = (si.value || '').trim().toLowerCase();
              var ck = onlyCk.checked;
              if (!q && !ck) {
                ro.hidden = true; tree.hidden = false; return;
              }
              var hits = list.filter(function (n) {
                if (ck && !n.checkable) return false;
                if (!q) return true;
                return String(n.title || '').toLowerCase().indexOf(q) >= 0;
              }).slice(0, 120);

              ro.hidden = false; tree.hidden = true;
              ro.innerHTML = hits.length
                ? '<div class="picker"><div class="dim xsmall mb8">共 ' + hits.length + ' 条匹配（最多显示 120 条）</div>' +
                  hits.map(function (n) {
                    var p = buildPath(n);
                    return '<div class="picker-row" data-pk-pick="' + n.id + '" data-pk-title="' + U.escAttr(n.title) +
                      '" data-pk-path="' + U.escAttr(p) + '">' +
                      '<span class="p-ico">' + LV_ICO[n.level] + '</span>' +
                      '<span class="p-title">' + U.esc(p) + '</span>' +
                      '<span class="chip xsmall">' + U.levelName(n.level) + '</span>' +
                    '</div>';
                  }).join('') + '</div>'
                : '<div class="picker"><div class="dim tc" style="padding:22px">没有匹配的章节</div></div>';
            }, 220);

            si.addEventListener('input', runSearch);
            onlyCk.addEventListener('change', runSearch);

            inst.foot.querySelector('[data-act="clear"]').addEventListener('click', function () {
              resolve({ id: null, title: '', path: '' });
              inst.close();
            });
            inst.foot.querySelector('[data-act="close"]').addEventListener('click', function () {
              resolve(null);
              inst.close();
            });
          },
          onClose: function () { resolve(null); },
        });
      }).catch(function (e) {
        UI.errToast(e);
        resolve(null);
      });
    });
  }

  function renderPickerNodes(nodes, idx, exp, depth) {
    if (!nodes.length) return '';
    return nodes.map(function (n) {
      var kids = idx.byParent[n.id] || [];
      var open = !!exp[n.id];
      var lv = Math.min(4, n.level);
      var path = pickPath(n, idx);
      var inner = '';
      if (kids.length) {
        inner = '<div data-pk-body="' + n.id + '"' + (open ? '' : ' hidden') + '>' +
          (open ? renderPickerNodes(kids, idx, exp, depth + 1) : '') + '</div>';
      }
      return '<div class="picker-node lv' + lv + '">' +
        '<div class="picker-row" data-pk-pick="' + n.id + '" data-pk-title="' + U.escAttr(n.title) +
          '" data-pk-path="' + U.escAttr(path) + '">' +
          (kids.length
            ? '<button class="t-toggle" data-pk-toggle="' + n.id + '" type="button" tabindex="-1" ' +
              'style="width:24px;height:24px;flex-basis:24px;font-size:11px">' + (open ? '▾' : '▸') + '</button>'
            : '<span style="width:24px;flex:0 0 24px"></span>') +
          '<span class="p-ico">' + LV_ICO[lv] + '</span>' +
          '<span class="p-title">' + U.esc(n.title) + '</span>' +
          '<span class="chip xsmall">' + U.levelName(lv) + '</span>' +
          (n.checkable ? '<span class="chip d2 xsmall">可打卡</span>' : '') +
        '</div>' +
        inner +
      '</div>';
    }).join('');
  }

  function pickPath(n, idx) {
    var parts = [n.title], cur = n, g = 0;
    while (cur && cur.parentId != null && g < 6) {
      var p = idx.byId[cur.parentId];
      if (!p) break;
      parts.unshift(p.title); cur = p; g++;
    }
    return parts.join(' / ');
  }

  /* ───────── 督促发送弹层 ───────── */

  function openUrgeDialog(preselect) {
    var sel = {};
    (preselect || []).forEach(function (id) { sel[id] = true; });

    loadUnits().then(function (units) {
      var idx = idxOf(units);
      var unitMap = idx.byId;

      API.admin.students().then(function (sr) {
        var students = sr.items || [];
        students.filter(function (s) { return s.status !== 1; })
          .forEach(function (s) { delete sel[s.id]; });

        var m = UI.modal({
          title: '📣 发送督促',
          size: 'lg',
          body:
            '<div class="sect-title"><span class="st-n">1</span>选择学生（已选 <b id="ugCount" class="num">' +
              Object.keys(sel).length + '</b> 人）</div>' +
            '<div class="filters" style="margin-bottom:10px">' +
              '<input class="input" id="ugSearch" type="search" placeholder="搜索姓名 / 学号 / 班级" style="flex:1;min-width:200px">' +
              '<button class="btn btn-sm" data-act="all" type="button">全选</button>' +
              '<button class="btn btn-sm" data-act="none" type="button">全不选</button>' +
            '</div>' +
            '<div class="picker-list" id="ugStudents">' +
              students.map(function (s) {
                var dis = s.status !== 1;
                return '<label class="pk-item' + (sel[s.id] ? ' on' : '') + '" data-sid="' + s.id + '" ' +
                  'data-search="' + U.escAttr([s.name, s.sno, s.className].join(' ').toLowerCase()) + '" ' +
                  (dis ? 'style="opacity:.5"' : '') + '>' +
                  '<input type="checkbox" class="ck" data-ug-pick="' + s.id + '"' + (sel[s.id] ? ' checked' : '') +
                    (dis ? ' disabled' : '') + '>' +
                  '<div class="pk-main"><div class="pk-name">' + U.esc(s.name || s.username) +
                    (dis ? ' <span class="chip d4 xsmall">已停用</span>' : '') + '</div>' +
                    '<div class="pk-sub">' + U.esc(s.sno || '') + ' · ' + U.esc(s.className || '') +
                      ' · 进度 ' + U.pctText(s.percent) + '</div></div>' +
                '</label>';
              }).join('') +
            '</div>' +

            '<div class="divider"></div>' +
            '<div class="sect-title"><span class="st-n">2</span>指定章节（可选）</div>' +
            '<div class="flex gap8 wrap" style="align-items:center">' +
              '<button class="btn" data-act="pick-unit" type="button">📖 选择章节</button>' +
              '<div class="grow" id="ugUnitBox" style="min-width:220px">' +
                '<span class="dim small">未指定章节（可发送纯文字督促）</span>' +
              '</div>' +
            '</div>' +

            '<div class="divider"></div>' +
            '<div class="sect-title"><span class="st-n">3</span>督促内容</div>' +
            '<div class="field"><label class="field-label">标题</label>' +
              '<input class="input" id="ugTitle" type="text" placeholder="如：请学习《文件权限管理》">' +
              '<div class="field-hint">留空时自动使用「请学习：所选章节」</div></div>' +
            '<div class="field"><label class="field-label">自定义内容（管理员想说的话）</label>' +
              '<textarea class="textarea" id="ugMsg" placeholder="例如：这一章是本周重点，请在周五前完成打卡，有疑问随时问我。"></textarea></div>' +
            '<div class="form-grid">' +
              '<div class="field"><label class="field-label">截止时间（可选）</label>' +
                '<input class="input" id="ugDeadline" type="datetime-local">' +
                '<div class="field-hint">留空表示不设截止时间</div></div>' +
              '<div class="field"><label class="field-label">优先级</label>' +
                '<div class="pick" id="ugPrio">' +
                  '<label class="pick-opt on" data-p="1"><input type="radio" name="ugp" value="1" checked> 普通</label>' +
                  '<label class="pick-opt" data-p="2"><input type="radio" name="ugp" value="2"> 重要</label>' +
                  '<label class="pick-opt" data-p="3"><input type="radio" name="ugp" value="3"> 紧急</label>' +
                '</div></div>' +
            '</div>' +
            '<div class="note info"><span class="n-ico">📬</span><span>' +
              '发送后，消息会立即出现在对应学生学习端的「老师督促」里（带未读红点），' +
              '同时学生可以在那里点「我已完成」，你在这边能看到已读与完成状态。' +
            '</span></div>',
          foot: '<button class="btn" data-act="no" type="button">取消</button>' +
                '<button class="btn btn-primary" data-act="yes" type="button">📣 立即发送</button>',
          onMount: function (inst) {
            var chosenUnit = { id: null, title: '', path: '' };

            function refreshCount() {
              var n = Object.keys(sel).length;
              inst.query('#ugCount').textContent = n;
            }

            // 学生多选
            inst.body.addEventListener('change', function (e) {
              var t = e.target;
              if (t && t.matches && t.matches('[data-ug-pick]')) {
                var id = Number(t.dataset.ugPick);
                var row = t.closest('.pk-item');
                if (t.checked) { sel[id] = true; if (row) row.classList.add('on'); }
                else { delete sel[id]; if (row) row.classList.remove('on'); }
                refreshCount();
              }
            });

            // 搜索
            var si = inst.query('#ugSearch');
            si.addEventListener('input', U.debounce(function () {
              var q = si.value.trim().toLowerCase();
              U.qsa('.pk-item', inst.body).forEach(function (n) {
                n.hidden = !!q && (n.dataset.search || '').indexOf(q) < 0;
              });
            }, 180));

            // 全选 / 全不选
            inst.body.querySelector('[data-act="all"]').addEventListener('click', function () {
              U.qsa('.pk-item', inst.body).forEach(function (n) {
                if (n.hidden) return;
                var ck = n.querySelector('[data-ug-pick]');
                if (ck.disabled) return;
                ck.checked = true; sel[Number(n.dataset.sid)] = true; n.classList.add('on');
              });
              refreshCount();
            });
            inst.body.querySelector('[data-act="none"]').addEventListener('click', function () {
              U.qsa('.pk-item', inst.body).forEach(function (n) {
                var ck = n.querySelector('[data-ug-pick]');
                if (ck.disabled) return;
                ck.checked = false; delete sel[Number(n.dataset.sid)]; n.classList.remove('on');
              });
              refreshCount();
            });

            // 章节选择
            inst.body.querySelector('[data-act="pick-unit"]').addEventListener('click', function () {
              openUnitPicker(chosenUnit.id).then(function (r) {
                if (!r) return;
                chosenUnit = r;
                var box = inst.query('#ugUnitBox');
                if (r.id) {
                  box.innerHTML = '<span class="chip d2">📖 ' + U.esc(r.path || r.title) + '</span>' +
                    ' <button class="btn btn-sm btn-ghost" data-act="unit-clear" type="button">清除</button>';
                  var tEl = inst.query('#ugTitle');
                  if (!tEl.value.trim()) tEl.value = '请学习：' + r.title;
                } else {
                  box.innerHTML = '<span class="dim small">未指定章节（可发送纯文字督促）</span>';
                }
              });
            });

            inst.body.addEventListener('click', function (e) {
              var c = e.target.closest && e.target.closest('[data-act="unit-clear"]');
              if (c) {
                chosenUnit = { id: null, title: '', path: '' };
                inst.query('#ugUnitBox').innerHTML = '<span class="dim small">未指定章节（可发送纯文字督促）</span>';
              }
            });

            // 优先级
            U.qsa('.pick-opt', inst.body.querySelector('#ugPrio')).forEach(function (lab) {
              lab.addEventListener('click', function () {
                U.qsa('.pick-opt', inst.body.querySelector('#ugPrio')).forEach(function (x) { x.classList.remove('on'); });
                lab.classList.add('on');
              });
            });

            // 发送
            inst.foot.querySelector('[data-act="no"]').addEventListener('click', function () { inst.close(); });
            inst.foot.querySelector('[data-act="yes"]').addEventListener('click', function () {
              var btn = this;
              var ids = Object.keys(sel).map(Number);
              if (!ids.length) return UI.err('请至少选择一名学生');

              var title = inst.query('#ugTitle').value.trim();
              var message = inst.query('#ugMsg').value.trim();
              var deadline = inst.query('#ugDeadline').value;
              var prio = 1;
              var pr = inst.body.querySelector('#ugPrio .pick-opt.on');
              if (pr) prio = Number(pr.dataset.p) || 1;

              if (!title && !chosenUnit.id && !message) {
                return UI.err('请填写督促内容，或选择一个章节');
              }

              var rs = UI.btnBusy(btn, '发送中…');
              API.admin.urgeCreate({
                studentIds: ids,
                unitId: chosenUnit.id || null,
                title: title,
                message: message,
                deadline: deadline || null,
                priority: prio,
              }).then(function (r) {
                UI.toast('已发送给 ' + r.targets + ' 名学生', 'ok', '督促已送达');
                inst.close();
                if (STORE.state.view === 'urges' || STORE.state.view === 'dashboard') A.refresh(true);
              }).catch(function (e) { UI.errToast(e); }).then(rs);
            });
          },
        });
      }).catch(function (e) { UI.errToast(e); });
    }).catch(function (e) { UI.errToast(e); });
  }

  /* ═══════════════════ 视图：目录内容 ═══════════════════ */

  A.units = {
    title: '目录内容',
    icon: '📚',
    nav: true,
    group: '内容',
    render: function (host) {
      host.innerHTML = U.loading('正在加载四级目录…');

      loadUnits(true).then(function (list) {
        var idx = idxOf(list);
        var byLevel = { 1: 0, 2: 0, 3: 0, 4: 0 };
        var checkable = 0;
        list.forEach(function (n) {
          byLevel[n.level] = (byLevel[n.level] || 0) + 1;
          if (n.checkable) checkable++;
        });

        var html = '';
        html += '<div class="page-head">' +
          '<div><h2>📚 目录与内容管理</h2>' +
            '<div class="ph-sub">管理员可自由增删改：主目录 → 次目录 → 学习目录 → 学习内容</div></div>' +
          '<div class="ph-actions">' +
            '<button class="btn" data-act="expand-all" type="button">展开全部</button>' +
            '<button class="btn" data-act="collapse-all" type="button">收起全部</button>' +
            '<button class="btn btn-primary" data-act="new-root" type="button">➕ 新增主目录</button>' +
          '</div>' +
        '</div>';

        html += '<div class="stats-grid">' +
          statCard('📚', '主目录', byLevel[1], '个', '最上层分类', '') +
          statCard('📂', '次目录', byLevel[2], '个', '第二层分类', '') +
          statCard('📄', '学习目录', byLevel[3], '个', '可打卡单元', 'ok') +
          statCard('📝', '学习内容', U.num(byLevel[4]), '个', '正文 / 代码 / 表格', '') +
          statCard('✓', '可打卡', U.num(checkable), '个', '学生可见的打卡点', 'accent') +
        '</div>';

        html += '<div class="note info"><span class="n-ico">💡</span><span>' +
          '点击目录行可展开；<b>学习目录</b>层级默认可打卡（学生端会出现勾选框），' +
          '<b>学习内容</b>是最底层，不能再添加子级。删除目录会级联删除其下全部内容，请谨慎操作。' +
        '</span></div>';

        if (!list.length) {
          host.innerHTML = html + emptyBox('📚', '还没有任何目录', '先创建一个主目录，再逐层添加次目录与学习内容',
            '<button class="btn btn-primary" data-act="new-root" type="button">创建主目录</button>');
          return;
        }

        html += '<div class="tree" id="admTree">' + (idx.byParent[0] || []).map(function (n) {
          return renderAdminNode(n, idx, 1);
        }).join('') + '</div>';

        host.innerHTML = html;

        // 默认展开第一层
        if (!Object.keys(S.expanded).length && !S.noAutoExpand) {
          (idx.byParent[0] || []).forEach(function (r1) { S.expanded[r1.id] = true; });
          A.units.render(host);
          return;
        }
        // 注意：所有按钮统一由 admin.js 的 #app 事件委托处理，
        // 视图内不再单独 addEventListener，否则同一个按钮会触发两次
        // （曾导致「新增目录」弹层被打开两遍）。
      }).catch(function (e) {
        host.innerHTML = U.errorBox(e.message,
          '<button class="btn btn-primary" data-act="retry" type="button">重新加载</button>');
        var r = host.querySelector('[data-act="retry"]');
        if (r) r.addEventListener('click', function () { A.units.render(host); });
      });
    },
  };

  function renderAdminNode(n, idx, depth) {
    var kids = idx.byParent[n.id] || [];
    var open = !!S.expanded[n.id];
    var canAdd = n.level < 4;
    var addLabel = ['', '新增次目录', '新增学习目录', '新增学习内容', ''][n.level] || '';

    var head =
      '<div class="tree-head">' +
        '<button class="t-toggle" data-toggle="' + n.id + '" type="button" tabindex="-1" ' +
          (kids.length ? '' : 'style="visibility:hidden"') + '>' + (open ? '▾' : '▸') + '</button>' +
        '<span class="t-ico">' + LV_ICO[n.level] + '</span>' +
        '<div class="t-main">' +
          '<div class="t-title">' + U.esc(n.title) +
            '<span class="chip xsmall">' + U.levelName(n.level) + '</span>' +
            (n.checkable ? '<span class="chip d2 xsmall">可打卡</span>' : '') +
            (n.status ? '' : '<span class="chip d4 xsmall">已隐藏</span>') +
            (n.contentType && n.contentType !== 'text' ? '<span class="chip xsmall">' + U.ctName(n.contentType) + '</span>' : '') +
          '</div>' +
          (n.summary ? '<div class="t-sum">' + U.esc(n.summary) + '</div>' : '') +
          '<div class="t-sum dim xsmall">排序 ' + n.sortOrder + ' · 子项 ' + n.childCount +
            (n.sortOrder !== undefined ? '' : '') + '</div>' +
        '</div>' +
        '<div class="t-right">' +
          (canAdd ? '<button class="btn btn-sm btn-primary" data-unit-add="' + n.id + '" type="button">➕ ' + addLabel + '</button>' : '') +
          '<button class="btn btn-sm" data-unit-edit="' + n.id + '" type="button">编辑</button>' +
          '<button class="btn btn-sm btn-danger" data-unit-del="' + n.id + '" type="button">删除</button>' +
        '</div>' +
      '</div>';

    var body = '';
    if (kids.length) {
      body = '<div class="tree-body" data-body="' + n.id + '"' + (open ? '' : ' hidden') + '>' +
        (open ? kids.map(function (c) { return renderAdminNode(c, idx, depth + 1); }).join('') : '') +
      '</div>';
    }

    return '<div class="tree-node lv' + n.level + '" data-node="' + n.id + '">' + head + body + '</div>';
  }

  /* ───────── 目录编辑弹层 ───────── */

  function openUnitEditor(parentNode, existNode, host) {
    var isEdit = !!existNode;
    var n = existNode || {
      title: '', summary: '', contentType: 'text', body: '', lang: 'bash',
      example: '', difficulty: parentNode ? Math.min(4, (parentNode.level || 1) + 1) : 1,
      sortOrder: 10, checkable: parentNode ? parentNode.level === 2 : false, status: 1,
    };
    var level = isEdit ? n.level : (parentNode ? parentNode.level + 1 : 1);
    var levelName = U.levelName(level);

    var body =
      (parentNode
        ? '<div class="note info"><span class="n-ico">📂</span><span>将添加到：<b>' +
            U.esc(parentNode.title) + '</b> 之下，层级为 <b>' + levelName + '</b>（第 ' + level + ' 级）</span></div>'
        : (isEdit
            ? '<div class="note info"><span class="n-ico">✏️</span><span>正在编辑 <b>' + levelName +
              '</b>：' + U.esc(n.title) + '</span></div>'
            : '<div class="note info"><span class="n-ico">📚</span><span>将创建一个新的 <b>主目录</b>（第 1 级）</span></div>')) +

      '<div class="divider"></div>' +
      '<div class="sect-title"><span class="st-n">1</span>基本信息</div>' +
      '<div class="field"><label class="field-label">标题 *</label>' +
        '<input class="input" id="uTitle" type="text" value="' + U.escAttr(n.title) +
        '" placeholder="' + (level === 4 ? '如：cat 命令的 10 个实用实例' : '如：文件与权限管理') + '"></div>' +
      '<div class="field"><label class="field-label">简介</label>' +
        '<textarea class="textarea" id="uSummary" style="min-height:64px" placeholder="一句话说明这一章讲什么">' +
          U.esc(n.summary) + '</textarea></div>' +
      '<div class="form-grid">' +
        '<div class="field"><label class="field-label">排序值</label>' +
          '<input class="input" id="uSort" type="number" value="' + n.sortOrder + '" step="10">' +
          '<div class="field-hint">数值越小越靠前</div></div>' +
        '<div class="field"><label class="field-label">难度</label>' +
          '<div class="diff-pick" id="uDiff">' +
            [1, 2, 3, 4].map(function (i) {
              return '<button type="button" data-d="' + i + '" class="' + (n.difficulty === i ? 'on' : '') + '" ' +
                'title="' + U.diff(i).label + '">' + (i <= 2 ? '◆' : '◆') + '</button>';
            }).join('') +
          '</div></div>' +
      '</div>' +
      '<div class="form-grid">' +
        '<div class="field"><label class="field-label">学生可打卡</label>' +
          '<label class="pick-opt' + (n.checkable ? ' on' : '') + '" id="uCkWrap" style="cursor:pointer">' +
            '<input type="checkbox" id="uCheck"' + (n.checkable ? ' checked' : '') + '> 出现在学生端打卡列表</label>' +
          '<div class="field-hint">建议「学习目录」层级开启，「学习内容」不需要打卡</div></div>' +
        '<div class="field"><label class="field-label">状态</label>' +
          '<label class="pick-opt' + (n.status ? ' on' : '') + '" id="uStWrap" style="cursor:pointer">' +
            '<input type="checkbox" id="uStatus"' + (n.status ? ' checked' : '') + '> 对学习端可见</label></div>' +
      '</div>';

    // 内容区（仅学习内容/命令层有意义，但所有层级都允许填写）
    body += '<div class="divider"></div>' +
      '<div class="sect-title"><span class="st-n">2</span>内容（可选）</div>' +
      '<div class="form-grid">' +
        '<div class="field"><label class="field-label">内容类型</label>' +
          '<select class="select" id="uCtype">' +
            CTYPES.map(function (c) {
              return '<option value="' + c.v + '"' + (n.contentType === c.v ? ' selected' : '') + '>' + c.t + '</option>';
            }).join('') +
          '</select></div>' +
        '<div class="field"><label class="field-label">代码语言（代码类型用）</label>' +
          '<input class="input" id="uLang" type="text" value="' + U.escAttr(n.lang || 'bash') + '" placeholder="bash"></div>' +
      '</div>' +
      '<div class="field"><label class="field-label">正文内容</label>' +
        '<textarea class="textarea" id="uBody" style="min-height:158px;font-family:var(--font-mono);font-size:14.5px" ' +
          'placeholder="正文：直接写文字；&#10;代码：粘贴命令；&#10;表格：粘贴 JSON 数组，如 [[&quot;参数&quot;,&quot;说明&quot;],[&quot;-l&quot;,&quot;长格式&quot;]]；&#10;清单：每行一条">' +
          U.esc(n.body || '') + '</textarea>' +
        '<div class="field-hint">支持的换行、制表符会被原样保存</div></div>' +
      (level === 3 || n.contentType === 'cmd'
        ? '<div class="field"><label class="field-label">示例命令（命令卡展示）</label>' +
            '<input class="input" id="uExample" type="text" value="' + U.escAttr(n.example || '') +
            '" placeholder="如：ls -al /home"></div>'
        : '<input type="hidden" id="uExample" value="' + U.escAttr(n.example || '') + '">');

    var m = UI.modal({
      title: isEdit ? '编辑 · ' + n.title : ('新增' + levelName),
      size: 'lg',
      body: body,
      foot: '<button class="btn" data-act="no" type="button">取消</button>' +
            '<button class="btn btn-primary" data-act="yes" type="button">' + (isEdit ? '保存修改' : '创建') + '</button>',
      onMount: function (inst) {
        var diff = n.difficulty;
        U.qsa('#uDiff button', inst.node).forEach(function (b) {
          b.addEventListener('click', function () {
            diff = Number(b.dataset.d);
            U.qsa('#uDiff button', inst.node).forEach(function (x) { x.classList.toggle('on', x === b); });
          });
        });

        var ckWrap = inst.query('#uCkWrap');
        var ck = inst.query('#uCheck');
        ck.addEventListener('change', function () { ckWrap.classList.toggle('on', ck.checked); });

        var stWrap = inst.query('#uStWrap');
        var stEl = inst.query('#uStatus');
        stEl.addEventListener('change', function () { stWrap.classList.toggle('on', stEl.checked); });

        inst.foot.querySelector('[data-act="no"]').addEventListener('click', function () { inst.close(); });
        inst.foot.querySelector('[data-act="yes"]').addEventListener('click', function () {
          var btn = this;
          var payload = {
            title: inst.query('#uTitle').value.trim(),
            summary: inst.query('#uSummary').value.trim(),
            contentType: inst.query('#uCtype').value,
            lang: inst.query('#uLang').value.trim() || 'bash',
            body: inst.query('#uBody').value,
            example: (inst.query('#uExample') || {}).value || '',
            difficulty: diff,
            sortOrder: Number(inst.query('#uSort').value) || 10,
            checkable: inst.query('#uCheck').checked,
            status: inst.query('#uStatus').checked ? 1 : 0,
          };
          if (!payload.title) return UI.err('请填写标题');

          var rs = UI.btnBusy(btn, '保存中…');
          var req = isEdit
            ? API.admin.unitUpdate(n.id, payload)
            : API.admin.unitCreate(Object.assign({ parentId: parentNode ? parentNode.id : null }, payload));

          req.then(function (r) {
            UI.toast(isEdit ? '已保存修改' : ('已创建' + levelName + '：' + payload.title), 'ok',
              isEdit ? '保存成功' : '创建成功');
            // 展开父级，让新增项可见
            if (parentNode) S.expanded[parentNode.id] = true;
            STORE.invalidate('units');
            STORE.invalidate('tree');
            inst.close();
            A.units.render(host || d.getElementById('view'));
          }).catch(function (e) { UI.errToast(e); }).then(rs);
        });
      },
    });

    return m;
  }

  /* ═══════════════════ 视图：督促管理 ═══════════════════ */

  A.urges = {
    title: '督促管理',
    icon: '📣',
    nav: true,
    group: '互动',
    render: function (host) {
      host.innerHTML = U.loading('正在加载督促记录…');

      API.admin.urges().then(function (r) {
        var items = r.items || [];

        var html = '';
        html += '<div class="page-head">' +
          '<div><h2>📣 督促管理</h2>' +
            '<div class="ph-sub">共 ' + items.length + ' 条督促 · 可跟踪每位学生的已读与完成情况</div></div>' +
          '<div class="ph-actions">' +
            '<button class="btn btn-primary" data-act="new" type="button">➕ 新建督促</button>' +
          '</div>' +
        '</div>';

        var totalTargets = items.reduce(function (a, x) { return a + x.targets; }, 0);
        var totalRead = items.reduce(function (a, x) { return a + x.readCount; }, 0);
        var totalDone = items.reduce(function (a, x) { return a + x.doneCount; }, 0);

        html += '<div class="stats-grid">' +
          statCard('📣', '督促总数', items.length, '条', '累计覆盖 ' + totalTargets + ' 人次', '') +
          statCard('📬', '已送达', totalTargets, '人次', '含未读', '') +
          statCard('👀', '已读', totalRead, '人次', '阅读率 ' + (totalTargets ? Math.round(totalRead / totalTargets * 100) : 0) + '%', 'accent') +
          statCard('🏁', '已完成', totalDone, '人次', '完成率 ' + (totalTargets ? Math.round(totalDone / totalTargets * 100) : 0) + '%', 'ok') +
        '</div>';

        if (!items.length) {
          host.innerHTML = html + emptyBox('📭', '还没有发过督促', '选择学生与章节，发一条督促提醒他们学习',
            '<button class="btn btn-primary" data-act="new" type="button">新建督促</button>');
          return;
        }

        html += '<div style="display:flex;flex-direction:column;gap:14px">';
        items.forEach(function (u2) {
          var pr = { 1: '普通', 2: '重要', 3: '紧急' }[u2.priority] || '普通';
          var prCls = { 1: '', 2: 'd3', 3: 'd4' }[u2.priority] || '';
          var ddl = u2.deadline ? U.deadlineText(u2.deadline) : null;
          var readPct = u2.targets ? Math.round(u2.readCount / u2.targets * 100) : 0;
          var donePct = u2.targets ? Math.round(u2.doneCount / u2.targets * 100) : 0;

          html += '<div class="panel">' +
            '<div class="panel-head">' +
              '<h3>📣 ' + U.esc(u2.title) + '</h3>' +
              (prCls ? '<span class="chip ' + prCls + ' xsmall">' + pr + '</span>' : '') +
              '<span class="chip xsmall">' + u2.targets + ' 人</span>' +
              '<div class="ph-tools">' +
                '<button class="btn btn-sm" data-targets="' + u2.id + '" type="button">送达明细</button>' +
                '<button class="btn btn-sm btn-danger" data-urge-del="' + u2.id + '" type="button">删除</button>' +
              '</div>' +
            '</div>' +
            '<div class="panel-body">' +
              (u2.unitPath ? '<div class="mb8"><span class="chip d2">📖 ' + U.esc(u2.unitPath) + '</span></div>' : '') +
              (u2.message ? '<div class="mb12" style="font-size:15px;line-height:1.8;white-space:pre-wrap">' +
                U.esc(u2.message) + '</div>' : '') +
              '<div class="grid3">' +
                '<div><div class="field-label">已读进度</div>' + barLine(u2.readCount, u2.targets) +
                  '<div class="field-hint">' + u2.readCount + ' / ' + u2.targets + ' 人（' + readPct + '%）</div></div>' +
                '<div><div class="field-label">完成进度</div>' + barLine(u2.doneCount, u2.targets) +
                  '<div class="field-hint">' + u2.doneCount + ' / ' + u2.targets + ' 人（' + donePct + '%）</div></div>' +
                '<div><div class="field-label">时间信息</div>' +
                  '<div class="small dim2">发送：' + U.esc(U.fmtDT(u2.createdAt, true)) + '</div>' +
                  (ddl ? '<div class="small" style="color:' + (ddl.overdue ? 'var(--danger)' : 'var(--warn)') + '">' +
                    '截止：' + U.esc(U.fmtDT(u2.deadline)) + ' · ' + U.esc(ddl.text) + '</div>'
                    : '<div class="small dim">未设置截止时间</div>') +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>';
        });
        html += '</div>';

        host.innerHTML = html;

        // 「新建督促」按钮由 #app 事件委托统一处理
      }).catch(function (e) {
        host.innerHTML = U.errorBox(e.message,
          '<button class="btn btn-primary" data-act="retry" type="button">重新加载</button>');
        var r = host.querySelector('[data-act="retry"]');
        if (r) r.addEventListener('click', function () { A.urges.render(host); });
      });
    },
  };

  function openUrgeTargets(id, title) {
    var m = UI.modal({
      title: '送达明细 · ' + (title || ''),
      size: 'lg',
      body: U.loading('正在加载…'),
      foot: '<button class="btn" data-act="close" type="button">关闭</button>',
      onMount: function (inst) {
        inst.foot.querySelector('[data-act="close"]').addEventListener('click', function () { inst.close(); });
      },
    });

    API.admin.urgeTargets(id).then(function (r) {
      var items = r.items || [];
      m.setBody(
        '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
          '<th>学生</th><th>学号</th><th>班级</th><th style="width:110px">已读</th>' +
          '<th style="width:110px">完成</th><th style="width:158px">操作</th>' +
        '</tr></thead><tbody>' +
        items.map(function (t) {
          return '<tr>' +
            '<td class="bold">' + U.esc(t.name) + '</td>' +
            '<td class="mono xsmall">' + U.esc(t.sno || '—') + '</td>' +
            '<td class="xsmall">' + U.esc(t.className || '—') + '</td>' +
            '<td>' + (t.read
              ? '<span class="chip d1 xsmall">已读</span><div class="dim xsmall">' + U.esc(U.relTime(t.readAt)) + '</div>'
              : '<span class="chip d3 xsmall">未读</span>') + '</td>' +
            '<td>' + (t.done
              ? '<span class="chip d1 xsmall">已完成</span><div class="dim xsmall">' + U.esc(U.relTime(t.doneAt)) + '</div>'
              : '<span class="chip xsmall">待完成</span>') + '</td>' +
            '<td class="nowrap">' +
              '<button class="btn btn-sm" data-student-detail="' + t.studentId + '" type="button">学习档案</button>' +
            '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table></div>' +
        '<div class="note info mt16"><span class="n-ico">💡</span><span>' +
          '「已读」表示学生在学生端打开过这条消息，「完成」表示学生点了「我已完成」。' +
        '</span></div>'
      );
    }).catch(function (e) {
      m.setBody(U.errorBox(e.message));
    });
  }

  /* ═══════════════════ 视图：题库管理 ═══════════════════ */

  /* ═══════════════════ 视图：提醒学生 ═══════════════════ */

  var NOTICE_PRI = [
    { v: 1, t: '普通', ico: '📝', cls: 'np1', desc: '一般性告知' },
    { v: 2, t: '重要', ico: '❗', cls: 'np2', desc: '请尽快处理' },
    { v: 3, t: '紧急', ico: '🚨', cls: 'np3', desc: '立即查看' },
  ];

  function noticePriChip(priority) {
    var p = NOTICE_PRI.filter(function (x) { return x.v === Number(priority); })[0] || NOTICE_PRI[0];
    return '<span class="chip xsmall notice-chip ' + p.cls + '">' + p.ico + ' ' + p.t + '</span>';
  }

  function noticeSendPanel() {
    var btns = NOTICE_PRI.map(function (p) {
      return '<button type="button" class="npri-btn ' + p.cls + (S.noticePriority === p.v ? ' on' : '') +
        '" data-notice-pri="' + p.v + '">' +
        '<span class="np-ico">' + p.ico + '</span>' +
        '<span class="np-txt"><b>' + p.t + '</b><i>' + p.desc + '</i></span>' +
        '</button>';
    }).join('');
    return '<div class="panel notice-send-panel">' +
      '<div class="panel-head"><h3>✍️ 写一条新提醒</h3>' +
        '<span class="chip xsmall">群发全体学生</span></div>' +
      '<div class="panel-body">' +
        '<div class="field">' +
          '<div class="field-label">提醒内容 <span class="req">*</span></div>' +
          '<span class="notice-inp-wrap"><textarea id="noticeContent" class="notice-input" rows="4" ' +
            'maxlength="1000" ' +
            'placeholder="例如：第 3 章已更新 20 条命令，请同学们本周内完成打卡…"></textarea></span>' +
          '<div class="field-hint"><span id="noticeCount">0</span> / 1000 字　·　' +
            '学生端右上角展示，点叉号才关闭</div>' +
        '</div>' +
        '<div class="field">' +
          '<div class="field-label">重要性</div>' +
          '<div class="notice-pri" id="noticePri">' + btns + '</div>' +
        '</div>' +
        '<div class="notice-send-row">' +
          '<button class="btn btn-primary" id="btnSendNotice" type="button">🔔 提醒学生</button>' +
          '<span class="small dim">发送后，未关闭该提醒的学生每次登录都会继续看到</span>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  A.notices = {
    title: '提醒学生',
    icon: '🔔',
    nav: true,
    group: '互动',
    render: function (host) {
      host.innerHTML = U.loading('正在加载提醒记录…');

      API.admin.notices().then(function (r) {
        var items = r.items || [];

        var totalPending = items.reduce(function (a, x) { return a + (x.pendingCount || 0); }, 0);
        var urgent = items.filter(function (x) { return x.priority === 3 && !x.revoked; }).length;

        var html = '';
        html += '<div class="page-head">' +
          '<div><h2>🔔 提醒学生</h2>' +
            '<div class="ph-sub">更新内容后发一条提醒 · 学生端右上角即时展示</div></div>' +
        '</div>';

        html += '<div class="stats-grid">' +
          statCard('🔔', '提醒总数', items.length, '条', '累计发送记录', '') +
          statCard('🚨', '紧急提醒', urgent, '条', '优先级最高的提醒', 'accent') +
          statCard('👀', '待关闭', totalPending, '人次', '学生尚未点叉号关闭', 'ok') +
          statCard('🙆', '已关闭', items.reduce(function (a, x) { return a + (x.dismissedCount || 0); }, 0),
            '人次', '学生已手动关闭', '') +
        '</div>';

        html += noticeSendPanel();

        if (!items.length) {
          html += emptyBox('📭', '还没有发过提醒',
            '在上面填写内容与重要性，点「提醒学生」即可群发', '');
          host.innerHTML = html;
          bindNoticeForm(host);
          return;
        }

        html += '<div class="notice-list-head"><h3>📜 历史提醒</h3>' +
          '<span class="small dim">共 ' + items.length + ' 条</span></div>';

        html += '<div class="notice-list">';
        items.forEach(function (n) {
          html += '<div class="panel notice-item' + (n.revoked ? ' is-revoked' : '') + '" data-notice-row="' + n.id + '">' +
            '<div class="panel-head">' +
              '<h3>🔔 提醒 #' + n.id + '</h3>' +
              noticePriChip(n.priority) +
              (n.revoked ? '<span class="chip xsmall">已撤回</span>'
                : '<span class="chip xsmall d1">生效中</span>') +
              '<div class="ph-tools">' +
                '<button class="btn btn-sm btn-danger" data-notice-del="' + n.id + '" type="button">撤回</button>' +
              '</div>' +
            '</div>' +
            '<div class="panel-body">' +
              '<div class="notice-content">' + U.esc(n.content) + '</div>' +
              '<div class="grid3">' +
                '<div><div class="field-label">送达情况</div>' +
                  barLine(n.dismissedCount, n.targetCount) +
                  '<div class="field-hint">已关闭 ' + n.dismissedCount + ' / ' + n.targetCount + ' 人</div></div>' +
                '<div><div class="field-label">待关闭</div>' +
                  '<div class="notice-big-num">' + n.pendingCount + ' <small>人</small></div>' +
                  '<div class="field-hint">下次登录仍会看到</div></div>' +
                '<div><div class="field-label">发送信息</div>' +
                  '<div class="small dim2">' + U.esc(n.adminName) + '</div>' +
                  '<div class="small dim">' + U.esc(U.fmtDT(n.createdAt, true)) + '</div></div>' +
              '</div>' +
            '</div>' +
          '</div>';
        });
        html += '</div>';

        host.innerHTML = html;
        bindNoticeForm(host);
      }).catch(function (e) {
        var msg = String((e && e.message) || e);
        var missing = /doesn't exist|does not exist|不存在/i.test(msg);
        host.innerHTML = U.errorBox(
          missing ? '后端数据库还没有「提醒」相关的表' : msg,
          (missing
            ? '<div class="small dim" style="margin-bottom:12px;line-height:1.9">' +
                '技术原因：' + U.esc(msg) + '<br>' +
                '处理办法：在后端数据库执行一次 <b>db/migrate_v3_notice.sql</b>（幂等脚本），' +
                '或直接把后端升级到最新版本后重启 —— 新版本启动时会自动补齐这两张表。' +
              '</div>'
            : '') +
          '<button class="btn btn-primary" data-act="retry" type="button">重新加载</button>');
        var r = host.querySelector('[data-act="retry"]');
        if (r) r.addEventListener('click', function () { A.notices.render(host); });
      });
    },
  };

  /** 绑定「写提醒」表单：字数统计 / 重要性切换 / 发送 */
  function bindNoticeForm(host) {
    var ta = host.querySelector('#noticeContent');
    var cnt = host.querySelector('#noticeCount');
    var priBox = host.querySelector('#noticePri');
    var sendBtn = host.querySelector('#btnSendNotice');
    if (!ta || !sendBtn) return;

    ta.addEventListener('input', function () {
      if (cnt) cnt.textContent = String(ta.value.length);
    });

    if (priBox) {
      priBox.addEventListener('click', function (ev) {
        var b = ev.target.closest ? ev.target.closest('[data-notice-pri]') : null;
        if (!b) return;
        S.noticePriority = Number(b.dataset.noticePri);
        Array.prototype.forEach.call(priBox.querySelectorAll('.npri-btn'), function (x) {
          x.classList.toggle('on', Number(x.dataset.noticePri) === S.noticePriority);
        });
      });
    }

    sendBtn.addEventListener('click', function () {
      var content = (ta.value || '').trim();
      if (!content) {
        UI.toast('请先填写提醒内容', 'warn', '内容为空');
        ta.focus();
        return;
      }
      if (sendBtn.disabled) return;
      sendBtn.disabled = true;
      var old = sendBtn.textContent;
      sendBtn.textContent = '发送中…';
      API.admin.noticeCreate({ content: content, priority: S.noticePriority })
        .then(function (res) {
          UI.toast('提醒已发送给 ' + (res.targets || 0) + ' 名学生', 'ok', '发送成功');
          ta.value = '';
          if (cnt) cnt.textContent = '0';
          A.notices.render(host);
        })
        .catch(function (e) { UI.errToast(e); })
        .then(function () {
          sendBtn.disabled = false;
          sendBtn.textContent = old;
        });
    });
  }

  A.questions = {
    title: '题库管理',
    icon: '✏️',
    nav: true,
    group: '互动',
    render: function (host) {
      host.innerHTML = U.loading('正在加载题库…');

      Promise.all([API.admin.questions(), loadUnits()]).then(function (res) {
        var items = (res[0] && res[0].items) || [];
        var units = res[1] || [];
        var idx = idxOf(units);
        var unitMap = {};
        units.forEach(function (u) { unitMap[u.id] = u; });

        var withStats = items.filter(function (q) { return q.answerCount > 0; });
        var totalAns = items.reduce(function (a, q) { return a + q.answerCount; }, 0);
        var totalCorrect = items.reduce(function (a, q) { return a + (q.correctCount || 0); }, 0);

        var html = '';
        html += '<div class="page-head">' +
          '<div><h2>✏️ 题库管理</h2>' +
            '<div class="ph-sub">按学习内容出题 · 学生答完自动批改</div></div>' +
          '<div class="ph-actions">' +
            '<button class="btn" data-act="batch" type="button">📚 批量导入</button>' +
            '<button class="btn btn-primary" data-act="new" type="button">➕ 新增题目</button>' +
          '</div>' +
        '</div>';

        html += '<div class="stats-grid">' +
          statCard('📝', '题目总数', items.length, '题', '覆盖 ' + new Set(items.map(function (q) { return q.unitId; }).filter(Boolean)).size + ' 个章节', '') +
          statCard('✅', '累计作答', U.num(totalAns), '次', '学生提交总数', '') +
          statCard('🎯', '总体正确率', totalAns ? Math.round(totalCorrect / totalAns * 100) : 0, '%', '对 ' + totalCorrect + ' 次', 'ok') +
          statCard('⚠️', '薄弱题目', items.filter(function (q) { return q.answerCount > 0 && q.correctRate < 50; }).length, '题', '正确率低于 50%', 'warn') +
        '</div>';

        // 筛选
        html += '<div class="filters">' +
          '<span class="fl-label">章节</span>' +
          '<select class="select" id="qUnit" style="min-width:220px">' +
            '<option value="">全部章节</option>' +
            units.filter(function (u) { return u.checkable || u.level <= 3; }).slice(0, 800).map(function (u) {
              return '<option value="' + u.id + '"' + (String(S.qUnitId) === String(u.id) ? ' selected' : '') + '>' +
                U.esc(pickPath(u, idx)) + '</option>';
            }).join('') +
          '</select>' +
          '<span class="spacer"></span>' +
          '<span class="dim small">显示 <b class="num" id="qShown">' + items.length + '</b> / ' + items.length + '</span>' +
        '</div>';

        if (!items.length) {
          host.innerHTML = html + emptyBox('📝', '题库还是空的', '点击「新增题目」为某个学习内容出题，学生端就会看到',
            '<button class="btn btn-primary" data-act="new" type="button">新增题目</button>');
          return;
        }

        html += '<div class="panel"><div class="panel-body flush" id="qList"><div class="list">' +
          items.map(function (q) {
            var u = unitMap[q.unitId];
            return '<div class="list-row" data-qrow="' + q.id + '" data-unit="' + (q.unitId || '') + '">' +
              '<div class="l-main">' +
                '<div class="l-title">' + U.esc(U.trunc(q.stem, 76)) + '</div>' +
                '<div class="l-sub">' +
                  '<span class="chip xsmall">' + U.qType(q.type) + '</span> ' +
                  '<span class="chip xsmall">' + (q.difficulty ? U.diff(q.difficulty).label : '入门') + '</span> ' +
                  (u ? '<span class="chip xsmall dim">📖 ' + U.esc(pickPath(u, idx)) + '</span>' : '<span class="chip xsmall dim">未归属章节</span>') +
                  ' <span class="dim">标准答案：<b>' + U.esc(U.trunc(q.answer, 24)) + '</b></span>' +
                '</div>' +
              '</div>' +
              '<div class="l-right">' +
                (q.answerCount
                  ? '<span class="chip ' + (q.correctRate >= 70 ? 'd1' : q.correctRate >= 40 ? 'd2' : 'd4') + ' xsmall">' +
                    '正确率 ' + q.correctRate + '%（' + q.correctCount + '/' + q.answerCount + '）</span>'
                  : '<span class="chip xsmall dim">暂无作答</span>') +
                '<button class="btn btn-sm" data-qedit="' + q.id + '" type="button">编辑</button>' +
                '<button class="btn btn-sm btn-danger" data-qdel="' + q.id + '" type="button">删除</button>' +
              '</div>' +
            '</div>';
          }).join('') +
        '</div></div></div>';

        host.innerHTML = html;

        // 章节筛选
        var sel = host.querySelector('#qUnit');
        var shown = host.querySelector('#qShown');
        if (sel) {
          sel.addEventListener('change', function () {
            S.qUnitId = sel.value;
            var n = 0;
            U.qsa('[data-qrow]', host).forEach(function (row) {
              var ok = !sel.value || row.dataset.unit === sel.value;
              row.hidden = !ok;
              if (ok) n++;
            });
            if (shown) shown.textContent = n;
          });
        }

        // 「新增题目」「批量导入」由 #app 事件委托统一处理
      }).catch(function (e) {
        host.innerHTML = U.errorBox(e.message,
          '<button class="btn btn-primary" data-act="retry" type="button">重新加载</button>');
        var r = host.querySelector('[data-act="retry"]');
        if (r) r.addEventListener('click', function () { A.questions.render(host); });
      });
    },
  };

  /* ───────── 出题弹层 ───────── */

  var QTYPES = [
    { v: 'single', t: '单选题' }, { v: 'multiple', t: '多选题' },
    { v: 'judge', t: '判断题' }, { v: 'fill', t: '填空题' }, { v: 'short', t: '简答题' },
  ];

  function openQuestionEditor(q, presetUnitId, host) {
    var isEdit = !!q;
    var n = q || {
      unitId: presetUnitId || null, type: 'single', stem: '', options: null,
      answer: '', analysis: '', difficulty: 2, score: 5, status: 1,
    };

    loadUnits().then(function (units) {
      var idx = idxOf(units);
      var opts = Array.isArray(n.options) ? n.options.map(function (o) {
        return (o && typeof o === 'object') ? { k: o.k || '', t: o.t || '' } : { k: '', t: String(o) };
      }) : [];
      if (n.type === 'single' && !opts.length) {
        opts = [{ k: 'A', t: '' }, { k: 'B', t: '' }, { k: 'C', t: '' }, { k: 'D', t: '' }];
      }

      var html =
        '<div class="form-grid">' +
          '<div class="field full"><label class="field-label">所属章节</label>' +
            '<select class="select" id="qUnitId">' +
              '<option value="">不指定（通用题）</option>' +
              units.filter(function (u) { return u.level >= 2; }).slice(0, 900).map(function (u) {
                return '<option value="' + u.id + '"' + (String(n.unitId) === String(u.id) ? ' selected' : '') + '>' +
                  U.esc(pickPath(u, idx)) + '</option>';
              }).join('') +
            '</select>' +
            '<div class="field-hint">学生只能看到所属章节的题目会被筛出来</div></div>' +
          '<div class="field"><label class="field-label">题型</label>' +
            '<select class="select" id="qType">' +
              QTYPES.map(function (t) {
                return '<option value="' + t.v + '"' + (n.type === t.v ? ' selected' : '') + '>' + t.t + '</option>';
              }).join('') +
            '</select></div>' +
          '<div class="field"><label class="field-label">难度 / 分值</label>' +
            '<div class="flex gap8">' +
              '<div class="diff-pick" id="qDiff">' +
                [1, 2, 3, 4].map(function (i) {
                  return '<button type="button" data-d="' + i + '" class="' + (n.difficulty === i ? 'on' : '') + '">◆</button>';
                }).join('') +
              '</div>' +
              '<input class="input" id="qScore" type="number" min="1" max="100" value="' + n.score + '" style="width:88px">' +
            '</div></div>' +
        '</div>' +
        '<div class="field"><label class="field-label">题干 *</label>' +
          '<textarea class="textarea" id="qStem" placeholder="如：下列哪个命令可以递归删除目录？">' + U.esc(n.stem) + '</textarea></div>' +
        '<div id="qOptsBox"></div>' +
        '<div class="field"><label class="field-label">标准答案 *</label>' +
          '<input class="input" id="qAnswer" type="text" value="' + U.escAttr(n.answer) + '">' +
          '<div class="field-hint" id="qAnswerHint"></div></div>' +
        '<div class="field"><label class="field-label">解析（可选）</label>' +
          '<textarea class="textarea" id="qAnalysis" style="min-height:74px" placeholder="答完后展示给学生">' +
            U.esc(n.analysis || '') + '</textarea></div>' +
        '<label class="checkline"><input type="checkbox" id="qStatus"' + (n.status ? ' checked' : '') + '> 启用该题目</label>';

      var m = UI.modal({
        title: isEdit ? '编辑题目 #' + n.id : '新增题目',
        size: 'lg',
        body: html,
        foot: '<button class="btn" data-act="no" type="button">取消</button>' +
              '<button class="btn btn-primary" data-act="yes" type="button">' + (isEdit ? '保存修改' : '创建题目') + '</button>',
        onMount: function (inst) {
          var diff = n.difficulty;

          function renderOpts() {
            var type = inst.query('#qType').value;
            var box = inst.query('#qOptsBox');
            var hint = inst.query('#qAnswerHint');

            if (type === 'single' || type === 'multiple') {
              if (!opts.length) opts = [{ k: 'A', t: '' }, { k: 'B', t: '' }, { k: 'C', t: '' }, { k: 'D', t: '' }];
              opts.forEach(function (o, i) { if (!o.k) o.k = String.fromCharCode(65 + i); });
              box.innerHTML = '<div class="field"><label class="field-label">选项</label>' +
                '<div id="optRows" style="display:flex;flex-direction:column;gap:8px">' +
                opts.map(function (o, i) {
                  return '<div class="flex gap8">' +
                    '<input class="input" style="width:62px;flex:0 0 62px;text-align:center" data-ok="' + i + '" ' +
                      'value="' + U.escAttr(o.k) + '">' +
                    '<input class="input" data-ot="' + i + '" value="' + U.escAttr(o.t) + '" placeholder="选项内容">' +
                    '<button class="icon-btn" data-odel="' + i + '" type="button" style="flex:0 0 40px" ' +
                      'title="删除该选项">✕</button>' +
                  '</div>';
                }).join('') +
                '</div><button class="btn btn-sm mt12" data-oadd="1" type="button">➕ 添加选项</button></div>';
              hint.innerHTML = type === 'multiple'
                ? '多选答案请连写字母，如 <b>ACD</b>'
                : '单选答案填一个字母，如 <b>B</b>';
            } else if (type === 'judge') {
              box.innerHTML = '<div class="note info"><span class="n-ico">⚖️</span><span>' +
                '判断题的标准答案填 <b>1</b>（正确）或 <b>0</b>（错误）。学生端会显示「正确 / 错误」两个选项。' +
              '</span></div>';
              hint.innerHTML = '填 <b>1</b> 表示正确，<b>0</b> 表示错误';
            } else if (type === 'fill') {
              box.innerHTML = '<div class="note info"><span class="n-ico">✍️</span><span>' +
                '填空题会忽略空格与大小写差异。多个可接受答案用 <b>|</b> 分隔，例如 <code class="inline">chmod|权限</code>。' +
              '</span></div>';
              hint.innerHTML = '多个答案用 | 分隔，命中任意一个即算对';
            } else {
              box.innerHTML = '<div class="note info"><span class="n-ico">📝</span><span>' +
                '简答题同样按关键字比对，建议把标准答案写成最简关键词。' +
              '</span></div>';
              hint.innerHTML = '学生的回答若包含该关键词即算正确';
            }
          }

          renderOpts();

          inst.query('#qType').addEventListener('change', function () {
            var box = inst.query('#qOptsBox');
            // 采集当前选项
            var rows = U.qsa('[data-ot]', box);
            if (rows.length) {
              rows.forEach(function (r, i) {
                opts[i] = { k: (inst.query('[data-ok="' + i + '"]') || {}).value || '', t: r.value };
              });
            }
            if (this.value === 'judge') {
              inst.query('#qAnswer').value = '1';
            }
            renderOpts();
          });

          // 选项增删
          inst.body.addEventListener('click', function (e) {
            var t = e.target;
            var add = t.closest && t.closest('[data-oadd]');
            if (add) {
              var rows2 = U.qsa('[data-ot]', inst.query('#qOptsBox'));
              var next = opts.slice(0, rows2.length);
              next.push({ k: String.fromCharCode(65 + next.length), t: '' });
              opts = next;
              renderOpts();
              return;
            }
            var del = t.closest && t.closest('[data-odel]');
            if (del) {
              var i2 = Number(del.dataset.odel);
              var rows3 = U.qsa('[data-ot]', inst.query('#qOptsBox'));
              rows3.forEach(function (r, k) {
                opts[k] = { k: (inst.query('[data-ok="' + k + '"]') || {}).value || '', t: r.value };
              });
              opts.splice(0, rows3.length);
              opts = opts.filter(function (_, k) { return k !== i2; });
              opts.forEach(function (o, k) { o.k = String.fromCharCode(65 + k); });
              renderOpts();
            }
          });

          U.qsa('#qDiff button', inst.node).forEach(function (b) {
            b.addEventListener('click', function () {
              diff = Number(b.dataset.d);
              U.qsa('#qDiff button', inst.node).forEach(function (x) { x.classList.toggle('on', x === b); });
            });
          });

          inst.foot.querySelector('[data-act="no"]').addEventListener('click', function () { inst.close(); });
          inst.foot.querySelector('[data-act="yes"]').addEventListener('click', function () {
            var btn = this;
            var type = inst.query('#qType').value;
            var optionList = null;

            if (type === 'single' || type === 'multiple') {
              var rows4 = U.qsa('[data-ot]', inst.query('#qOptsBox'));
              optionList = rows4.map(function (r, i) {
                return {
                  k: (inst.query('[data-ok="' + i + '"]') || {}).value || String.fromCharCode(65 + i),
                  t: r.value,
                };
              }).filter(function (o) { return o.t.trim(); });
              if (optionList.length < 2) return UI.err('至少需要 2 个有内容的选项');
            }

            var payload = {
              unitId: inst.query('#qUnitId').value || null,
              type: type,
              stem: inst.query('#qStem').value.trim(),
              options: optionList,
              answer: inst.query('#qAnswer').value.trim(),
              analysis: inst.query('#qAnalysis').value.trim(),
              difficulty: diff,
              score: Number(inst.query('#qScore').value) || 5,
              status: inst.query('#qStatus').checked ? 1 : 0,
            };
            if (!payload.stem) return UI.err('请填写题干');
            if (!payload.answer) return UI.err('请填写标准答案');

            var rs = UI.btnBusy(btn, '保存中…');
            var req = isEdit ? API.admin.questionUpdate(n.id, payload) : API.admin.questionCreate(payload);
            req.then(function () {
              UI.toast(isEdit ? '题目已更新' : '题目已创建，学生端立即可见', 'ok',
                isEdit ? '保存成功' : '创建成功');
              inst.close();
              A.questions.render(host || d.getElementById('view'));
            }).catch(function (e) { UI.errToast(e); }).then(rs);
          });
        },
      });
    }).catch(UI.errToast);
  }

  /* ───────── 批量导入 ───────── */

  function openBatchImport(host) {
    loadUnits().then(function (units) {
      var idx = idxOf(units);
      var sample = [
        { unitId: null, type: 'single', stem: '下列哪个命令可以递归删除目录？', options: [{ k: 'A', t: 'rm -r' }, { k: 'B', t: 'rmdir' }], answer: 'A', analysis: 'rm -r 递归删除', difficulty: 2, score: 5 },
        { unitId: null, type: 'judge', stem: 'chmod 777 表示所有用户可读写执行。', answer: '1', analysis: '7 = rwx', difficulty: 1, score: 3 },
      ];

      var m = UI.modal({
        title: '📚 批量导入题目',
        size: 'lg',
        body:
          '<div class="field"><label class="field-label">统一归属章节（可选）</label>' +
            '<select class="select" id="bUnit"><option value="">不指定</option>' +
              units.filter(function (u) { return u.level >= 2; }).slice(0, 900).map(function (u) {
                return '<option value="' + u.id + '">' + U.esc(pickPath(u, idx)) + '</option>';
              }).join('') +
            '</select></div>' +
          '<div class="field"><label class="field-label">题目 JSON 数组</label>' +
            '<textarea class="textarea" id="bJson" style="min-height:250px;font-family:var(--font-mono);font-size:13.5px">' +
              U.esc(JSON.stringify(sample, null, 2)) + '</textarea>' +
            '<div class="field-hint">' +
              '字段：<b>stem</b> 题干（必填）、<b>type</b> single/multiple/judge/fill/short、' +
              '<b>options</b> 选项数组 [{k,t}]、<b>answer</b> 标准答案、<b>analysis</b> 解析、' +
              '<b>difficulty</b> 1-4、<b>score</b> 分值。' +
            '</div></div>' +
          '<div class="note info"><span class="n-ico">💡</span><span>' +
            '可以先在 Excel 里整理好题目，再用工具转成 JSON；也可以从上方的示例改起。' +
          '</span></div>',
        foot: '<button class="btn" data-act="no" type="button">取消</button>' +
              '<button class="btn btn-primary" data-act="yes" type="button">导入</button>',
        onMount: function (inst) {
          inst.foot.querySelector('[data-act="no"]').addEventListener('click', function () { inst.close(); });
          inst.foot.querySelector('[data-act="yes"]').addEventListener('click', function () {
            var btn = this;
            var raw = inst.query('#bJson').value.trim();
            var items;
            try { items = JSON.parse(raw); } catch (e) { return UI.err('JSON 格式有误：' + e.message); }
            if (!Array.isArray(items) || !items.length) return UI.err('请提供题目数组');
            items.forEach(function (it) {
              if (it.unitId == null) it.unitId = inst.query('#bUnit').value || null;
            });

            var rs = UI.btnBusy(btn, '导入中…');
            API.admin.questionBatch(items).then(function (r) {
              UI.toast('成功导入 ' + r.count + ' 道题目', 'ok', '导入完成');
              inst.close();
              A.questions.render(host || d.getElementById('view'));
            }).catch(function (e) { UI.errToast(e); }).then(rs);
          });
        },
      });
    }).catch(UI.errToast);
  }

  /* ═══════════════════ 视图：打卡流水 ═══════════════════ */

  A.logs = {
    title: '打卡流水',
    icon: '📋',
    nav: true,
    group: '概览',
    render: function (host) {
      host.innerHTML = U.loading('正在加载打卡流水…');

      Promise.all([
        API.admin.logs({ limit: 300, studentId: S.logStudentId || undefined, action: S.logAction || undefined }),
        API.admin.students(),
      ]).then(function (res) {
        var items = (res[0] && res[0].items) || [];
        var students = (res[1] && res[1].items) || [];
        var revokes = items.filter(function (l) { return l.action === 'revoke'; });

        var html = '';
        html += '<div class="page-head">' +
          '<div><h2>📋 打卡流水</h2>' +
            '<div class="ph-sub">全部打卡 / 撤销记录，按时间倒序 · 学生撤销打卡会在这里明确标注</div></div>' +
          '<div class="ph-actions">' +
            '<button class="btn" data-act="refresh" type="button">🔄 刷新</button>' +
          '</div>' +
        '</div>';

        html += '<div class="stats-grid">' +
          statCard('📋', '流水条数', items.length, '条', '当前筛选结果', '') +
          statCard('✅', '打卡记录', items.filter(function (l) { return l.action === 'checkin'; }).length, '条', '学生完成打卡', 'ok') +
          statCard('↩️', '撤销记录', revokes.length, '条', revokes.length ? '需要关注' : '暂无撤销', revokes.length ? 'warn' : '') +
          statCard('👥', '涉及学生', new Set(items.map(function (l) { return l.studentId; })).size, '人', '当前结果覆盖', '') +
        '</div>';

        html += '<div class="filters">' +
          '<span class="fl-label">学生</span>' +
          '<select class="select" id="lgStudent"><option value="">全部学生</option>' +
            students.map(function (s) {
              return '<option value="' + s.id + '"' + (String(S.logStudentId) === String(s.id) ? ' selected' : '') + '>' +
                U.esc(s.name || s.username) + '（' + U.esc(s.sno || s.username) + '）</option>';
            }).join('') +
          '</select>' +
          '<span class="fl-label">动作</span>' +
          '<select class="select" id="lgAction">' +
            '<option value="">全部动作</option>' +
            '<option value="checkin"' + (S.logAction === 'checkin' ? ' selected' : '') + '>打卡</option>' +
            '<option value="revoke"' + (S.logAction === 'revoke' ? ' selected' : '') + '>撤销打卡</option>' +
          '</select>' +
          '<span class="spacer"></span>' +
          '<button class="btn btn-sm" data-act="clear" type="button">清空筛选</button>' +
        '</div>';

        if (!items.length) {
          host.innerHTML = html + emptyBox('📭', '没有符合条件的流水', '换个筛选条件试试，或让同学们开始打卡');
          bindLogFilters(host);
          return;
        }

        html += '<div class="panel"><div class="panel-body flush tbl-scroll">' +
          '<table class="tbl"><thead><tr>' +
            '<th style="width:152px">时间</th><th>学生</th><th style="width:110px">动作</th>' +
            '<th>学习内容</th><th>章节路径</th><th style="width:110px">打卡日期</th>' +
          '</tr></thead><tbody>' +
          items.map(function (l) {
            var a = U.act(l.action);
            return '<tr' + (l.action === 'revoke' ? ' style="background:var(--danger-soft)"' : '') + '>' +
              '<td class="num xsmall nowrap">' + U.esc(U.fmtDT(l.at, true)) + '</td>' +
              '<td class="nowrap"><span class="bold">' + U.esc(l.studentName) + '</span>' +
                '<div class="dim xsmall">' + U.esc(l.sno || '') + '</div></td>' +
              '<td class="nowrap"><span class="chip ' + (a.cls === 'ok' ? 'd1' : a.cls === 'danger' ? 'd4' : 'xsmall') + ' xsmall">' +
                a.ico + ' ' + U.esc(a.label) + '</span></td>' +
              '<td class="bold">' + U.esc(l.unitTitle || '—') + '</td>' +
              '<td class="xsmall dim2">' + U.esc(l.unitPath || '—') + '</td>' +
              '<td class="num nowrap xsmall">' + U.esc(l.action === 'revoke' ? (l.prevDate || '—') : (l.newDate || '—')) + '</td>' +
            '</tr>';
          }).join('') +
          '</tbody></table></div></div>';

        html += '<div class="note warn"><span class="n-ico">↩️</span><span>' +
          '「已撤销打卡」表示学生在学生端主动撤销了打卡，进度会同步回退。' +
          '如果某位学生频繁撤销，建议在「学生名单」里单独督促。' +
        '</span></div>';

        host.innerHTML = html;
        bindLogFilters(host);

        // refresh 按钮由 #app 事件委托统一处理
      }).catch(function (e) {
        host.innerHTML = U.errorBox(e.message,
          '<button class="btn btn-primary" data-act="retry" type="button">重新加载</button>');
        var r = host.querySelector('[data-act="retry"]');
        if (r) r.addEventListener('click', function () { A.logs.render(host); });
      });
    },
  };

  function bindLogFilters(host) {
    var s1 = host.querySelector('#lgStudent');
    var s2 = host.querySelector('#lgAction');
    if (s1) s1.addEventListener('change', function () { S.logStudentId = s1.value; A.logs.render(host); });
    if (s2) s2.addEventListener('change', function () { S.logAction = s2.value; A.logs.render(host); });
    var c = host.querySelector('[data-act="clear"]');
    if (c) c.addEventListener('click', function () {
      S.logStudentId = ''; S.logAction = ''; A.logs.render(host);
    });
  }

  /* ═══════════════════ 会员：公共辅助 ═══════════════════ */

  var MTYPE_META = {
    none:    { label: '普通会员', ico: '🙍', cls: 'mt-none' },
    week:    { label: '周会员',   ico: '🌱', cls: 'mt-week' },
    month:   { label: '月会员',   ico: '🌿', cls: 'mt-month' },
    year:    { label: '年会员',   ico: '🌳', cls: 'mt-year' },
    forever: { label: '永久会员', ico: '👑', cls: 'mt-forever' },
  };
  var MDAY = { week: 7, month: 30, year: 365 };
  var FALLBACK_PRICE = { none: 0, week: 4, month: 12, year: 24, forever: 59.9 };

  /** 取会员态对象（兼容 /admin/members 的扁平结构与 /admin/students 的 member 子对象） */
  function memberOf(row) {
    if (!row) return null;
    return row.member || row;
  }

  /** 服务端时间字符串 → 'YYYY-MM-DD HH:mm:ss'（含秒，会员到期必须精确到秒） */
  function fmtSec(v) {
    var t = U.toDate(v);
    if (!t) return '—';
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return t.getFullYear() + '-' + p2(t.getMonth() + 1) + '-' + p2(t.getDate()) + ' ' +
      p2(t.getHours()) + ':' + p2(t.getMinutes()) + ':' + p2(t.getSeconds());
  }

  /** 毫秒 → 「x天x时x分x秒」 */
  function remainCn(ms) {
    if (ms == null || !isFinite(ms)) return '永久';
    var s = Math.max(0, Math.floor(ms / 1000));
    var dd = Math.floor(s / 86400); s -= dd * 86400;
    var hh = Math.floor(s / 3600);  s -= hh * 3600;
    var mm = Math.floor(s / 60);    s -= mm * 60;
    return dd + '天' + hh + '时' + mm + '分' + s + '秒';
  }

  /** 会员等级徽标组合 */
  function memberChip(m) {
    if (!m) return '';
    var meta = MTYPE_META[m.type] || MTYPE_META.none;
    var out = '<span class="mchip ' + meta.cls + '">' + meta.ico + ' ' + U.esc(meta.label) + '</span>';
    if (m.permanent) out += '<span class="mchip mt-perm">∞ 永久</span>';
    if (m.expired) out += '<span class="mchip mt-exp">已过期</span>';
    else if (m.almostDue) out += '<span class="mchip mt-due">不足 3 天</span>';
    return out;
  }

  /** 到期单元格 */
  function memberExpireCell(m) {
    if (!m) return '<span class="dim">—</span>';
    if (m.permanent) return '<span class="mt-forever-t">永久有效</span>';
    if (!m.isSuper) return '<span class="dim">—</span>';
    return '<div class="num nowrap">' + U.esc(fmtSec(m.expireAt)) + '</div>' +
      '<div class="xsmall ' + (m.almostDue ? 'mt-due-t' : 'dim') + '">剩 ' + remainCn(m.remainMs) + '</div>';
  }

  /* ═══════════════════ 视图：会员管理 ═══════════════════ */

  A.members = {
    title: '会员管理',
    icon: '👑',
    nav: true,
    group: '会员',
    render: function (host) {
      host.innerHTML = U.loading('正在加载会员数据…');

      var params = {};
      if (S.memberQuery) params.keyword = S.memberQuery;
      if (S.memberType) params.memberType = S.memberType;
      if (S.memberStatus !== '') params.status = S.memberStatus;

      Promise.all([API.admin.members(params), API.admin.exportLogs(60)]).then(function (res) {
        var r = res[0] || {};
        var items = r.items || [];
        var sum = r.summary || {};
        var opts = r.options || [];
        var exps = (res[1] && res[1].items) || [];

        var html = '';

        html += '<div class="page-head">' +
          '<div><h2>👑 会员管理</h2>' +
            '<div class="ph-sub">开通 / 续费 / 到期降级 / 禁用与恢复 · 剩余时长按秒实时计算' +
              (r.freeChapter ? ' · 免费章节：' + U.esc(r.freeChapter.title) : '') + '</div></div>' +
          '<div class="ph-actions">' +
            '<button class="btn" data-act="refresh" type="button">🔄 刷新</button>' +
            '<button class="btn btn-primary" data-mem-pick type="button">💎 快速开通</button>' +
          '</div>' +
        '</div>';

        html += '<div class="stats-grid">' +
          statCard('👥', '账号总数', U.num(sum.total), '人', '当前筛选结果', '') +
          statCard('👑', '超级会员', U.num(sum.superCount), '人', '可学全章节 · 可打卡 · 可导出', 'accent') +
          statCard('🙍', '普通会员', U.num(sum.normalCount), '人', '仅第一章免费内容', '') +
          statCard('⏳', '临期不足 3 天', U.num(sum.almostDueCount), '人',
            sum.almostDueCount ? '建议提醒续费' : '暂无临期', sum.almostDueCount ? 'warn' : 'ok') +
          statCard('🚫', '已禁用', U.num(sum.disabledCount), '人',
            sum.disabledCount ? '被禁止使用平台' : '全部可正常使用', sum.disabledCount ? 'danger' : '') +
        '</div>';

        /* 筛选条 */
        html += '<div class="filters">' +
          '<span class="fl-label">搜索</span>' +
          '<input class="input" id="memSearch" type="search" placeholder="账号 / 姓名 / 手机号 / 学号" ' +
            'value="' + U.escAttr(S.memberQuery) + '" style="min-width:230px">' +
          '<span class="fl-label">会员</span>' +
          '<select class="select" id="memType">' +
            '<option value="">全部等级</option>' +
            opts.map(function (o) {
              return '<option value="' + o.code + '"' + (S.memberType === o.code ? ' selected' : '') + '>' +
                U.esc(o.label) + '</option>';
            }).join('') +
          '</select>' +
          '<span class="fl-label">使用状态</span>' +
          '<select class="select" id="memStatus">' +
            '<option value="">全部状态</option>' +
            '<option value="1"' + (S.memberStatus === '1' ? ' selected' : '') + '>允许使用</option>' +
            '<option value="0"' + (S.memberStatus === '0' ? ' selected' : '') + '>已禁用</option>' +
          '</select>' +
          '<span class="spacer"></span>' +
          '<span class="dim small">共 <b class="num">' + items.length + '</b> 条</span>' +
          '<button class="btn btn-sm" data-act="clear" type="button">清空筛选</button>' +
        '</div>';

        /* 会员表格 */
        if (!items.length) {
          html += emptyBox('👑', '没有符合条件的账号',
            '换个筛选条件试试；如果还没有学生账号，请先到「学生名单」创建',
            '<button class="btn btn-primary" data-act="clear" type="button">清空筛选</button>');
        } else {
          html += '<div class="panel"><div class="panel-body flush tbl-scroll">' +
            '<table class="tbl" id="memTable"><thead><tr>' +
              '<th>账号</th>' +
              '<th style="width:124px">手机号</th>' +
              '<th style="width:190px">会员等级</th>' +
              '<th style="width:190px">到期时间 / 剩余</th>' +
              '<th style="width:112px">使用状态</th>' +
              '<th style="width:268px">操作</th>' +
            '</tr></thead><tbody>' +
            items.map(function (m) {
              return '<tr' + (m.disabled ? ' class="row-off"' : '') + '>' +
                '<td class="nowrap">' +
                  '<div class="u-cell">' +
                    '<span class="pavatar ' + U.avatarClass(m.id) + '">' +
                      U.esc(U.initial(m.name, m.username)) + '</span>' +
                    '<div class="u-cell-main">' +
                      '<div class="bold">' + U.esc(m.name || m.username) +
                        (m.isSuper ? '<span class="super-star" title="超级会员">★</span>' : '') + '</div>' +
                      '<div class="dim xsmall">@' + U.esc(m.username) +
                        (m.sno ? ' · ' + U.esc(m.sno) : '') +
                        (m.className ? ' · ' + U.esc(m.className) : '') + '</div>' +
                    '</div>' +
                  '</div>' +
                '</td>' +
                '<td class="num xsmall nowrap">' + U.esc(m.phone || '—') + '</td>' +
                '<td>' + memberChip(m) + '</td>' +
                '<td>' + memberExpireCell(m) + '</td>' +
                '<td>' + (m.disabled
                  ? '<span class="mchip mt-dis">🚫 已禁用</span>'
                  : '<span class="mchip mt-on">✅ 允许使用</span>') + '</td>' +
                '<td class="nowrap">' +
                  '<button class="btn btn-sm btn-primary" data-mem-grant="' + m.id + '" type="button">' +
                    (m.isSuper ? '续费 / 改档' : '开通会员') + '</button> ' +
                  '<button class="btn btn-sm' + (m.disabled ? '' : ' btn-danger') + '" data-mem-toggle="' + m.id +
                    '" data-to="' + (m.disabled ? 1 : 0) + '" type="button">' +
                    (m.disabled ? '恢复使用' : '禁止使用') + '</button> ' +
                  '<button class="btn btn-sm" data-mem-logs="' + m.id + '" type="button">变更流水</button>' +
                '</td>' +
              '</tr>';
            }).join('') +
            '</tbody></table></div></div>';
        }

        /* 规则说明 */
        html += '<div class="note info"><span class="n-ico">💡</span><span>' +
          '<b>会员规则：</b>周会员 = 自设置时刻起 7 天整、月会员 = 30 天整、年会员 = 365 天整、永久会员 = 无到期时间。' +
          '续费按「新的到期时刻 = max(当前时刻, 原到期时刻) + 本次时长」叠加，' +
          '可在任意时刻（含 3 秒内）连续设置同类型或不同类型，不做频率限制。' +
          '会员到期后自动降级为普通会员，并立即强制退出打卡平台登录。' +
          '</span></div>';

        /* 导出流水 */
        html += '<div class="sect-bar">' +
          '<h3>📤 打卡记录导出流水</h3>' +
          '<span class="dim small">最近 ' + exps.length + ' 条 · 超级会员导出 CSV / Excel / PDF 时自动留痕</span>' +
        '</div>';

        html += exps.length
          ? '<div class="panel"><div class="panel-body flush tbl-scroll">' +
              '<table class="tbl"><thead><tr>' +
                '<th style="width:152px">时间</th><th>学生</th><th style="width:84px">格式</th>' +
                '<th style="width:92px">记录数</th><th>日期范围</th><th style="width:132px">来源 IP</th>' +
              '</tr></thead><tbody>' +
              exps.map(function (x) {
                return '<tr>' +
                  '<td class="num xsmall nowrap">' + U.esc(fmtSec(x.createdAt)) + '</td>' +
                  '<td class="nowrap"><span class="bold">' + U.esc(x.name || x.username) + '</span>' +
                    '<div class="dim xsmall">@' + U.esc(x.username) + '</div></td>' +
                  '<td><span class="chip xsmall">' + U.esc(String(x.format || '').toUpperCase()) + '</span></td>' +
                  '<td class="num">' + U.num(x.rows) + '</td>' +
                  '<td class="xsmall dim2">' + U.esc((x.dateFrom || '不限') + ' ~ ' + (x.dateTo || '不限')) + '</td>' +
                  '<td class="num xsmall">' + U.esc(x.ip || '—') + '</td>' +
                '</tr>';
              }).join('') +
              '</tbody></table></div></div>'
          : emptyBox('📤', '还没有导出记录', '超级会员在打卡平台导出 CSV / Excel / PDF 时会在这里留下记录');

        host.innerHTML = html;
        bindMemberFilters(host);

        // 顶部的 🔄 刷新 由 #app 全局委托处理
      }).catch(function (e) {
        host.innerHTML = U.errorBox(e.message,
          '<button class="btn btn-primary" data-act="retry" type="button">重新加载</button>');
        var rt = host.querySelector('[data-act="retry"]');
        if (rt) rt.addEventListener('click', function () { A.members.render(host); });
      });
    },
  };

  function bindMemberFilters(host) {
    var q = host.querySelector('#memSearch');
    var t = host.querySelector('#memType');
    var s = host.querySelector('#memStatus');

    if (q) {
      var fire = U.debounce(function () {
        S.memberQuery = (q.value || '').trim();
        A.members.render(host);
      }, 320);
      q.addEventListener('input', fire);
    }
    if (t) t.addEventListener('change', function () { S.memberType = t.value; A.members.render(host); });
    if (s) s.addEventListener('change', function () { S.memberStatus = s.value; A.members.render(host); });

    U.qsa('[data-act="clear"]', host).forEach(function (c) {
      c.addEventListener('click', function () {
        S.memberQuery = ''; S.memberType = ''; S.memberStatus = '';
        A.members.render(host);
      });
    });
  }

  /* ───────── 开通 / 续费 弹层 ───────── */

  /** 快速开通：先选账号再走标准开通流程 */
  function openMemberPicker() {
    API.admin.students().then(function (r) {
      var list = r.items || [];
      if (!list.length) { UI.warn('还没有学生账号，请先到「学生名单」创建'); return; }

      UI.modal({
        title: '快速开通会员',
        size: 'sm',
        body:
          '<div class="field"><label class="field-label">选择账号</label>' +
            '<select class="select" id="pickStu">' +
              list.map(function (x) {
                var m = memberOf(x);
                var tag = m && m.isSuper ? '（' + (m.permanent ? '永久会员' : MTYPE_META[m.type].label) + '）' : '（普通会员）';
                return '<option value="' + x.id + '">' +
                  U.esc(x.name || x.username) + ' · @' + U.esc(x.username) + tag + '</option>';
              }).join('') +
            '</select></div>' +
          '<div class="note info"><span class="n-ico">💡</span><span>' +
            '选好账号后进入开通面板，可实时预览叠加后的到期时间。</span></div>',
        foot: '<button class="btn" data-act="no" type="button">取消</button>' +
              '<button class="btn btn-primary" data-act="yes" type="button">下一步</button>',
        onMount: function (inst) {
          inst.foot.querySelector('[data-act="no"]').addEventListener('click', function () { inst.close(); });
          inst.foot.querySelector('[data-act="yes"]').addEventListener('click', function () {
            var id = Number(inst.query('#pickStu').value);
            var row = list.filter(function (x) { return x.id === id; })[0];
            inst.close();
            openMemberGrant(row, function () {
              if (STORE.state.view === 'members') A.members.render(d.getElementById('view'));
            });
          });
        },
      });
    }).catch(UI.errToast);
  }

  function openMemberGrant(row, onDone) {
    var cur = memberOf(row) || {};
    API.admin.pricing().then(function (pr) {
      var priceOf = {};
      (pr.items || []).forEach(function (p) { priceOf[p.code] = p.price; });
      renderGrantDialog(row, cur, priceOf, onDone);
    }).catch(function () { renderGrantDialog(row, cur, FALLBACK_PRICE, onDone); });
  }

  function renderGrantDialog(row, cur, priceOf, onDone) {
    function price(code) {
      var v = priceOf[code];
      return v == null ? FALLBACK_PRICE[code] : v;
    }

    var curType = cur.rawType || cur.type || 'none';
    var curExpMs = cur.expireAt && cur.isSuper && !cur.permanent ? U.toDate(cur.expireAt).getTime() : 0;
    var isPerm = curType === 'forever';

    var CARDS = [
      { code: 'none',    label: '普通会员', days: 0,   ico: '🙍', sub: '仅第一章免费内容', danger: true },
      { code: 'week',    label: '周会员',   days: 7,   ico: '🌱', sub: '7 天整' },
      { code: 'month',   label: '月会员',   days: 30,  ico: '🌿', sub: '30 天整' },
      { code: 'year',    label: '年会员',   days: 365, ico: '🌳', sub: '365 天整' },
      { code: 'forever', label: '永久会员', days: 0,   ico: '👑', sub: '无到期时间' },
    ];

    /** 依据后端同一套规则做本地预览 */
    function previewFor(code) {
      if (code === 'none') {
        return '<span class="pv-warn">立即变更为普通会员' +
          (cur.isSuper ? '，并强制退出打卡平台登录' : '') + '</span>';
      }
      if (code === 'forever' || isPerm) {
        return '<span class="pv-perm">👑 永久有效（无到期时间，之后继续充值时仍保持永久）</span>';
      }
      var now = Date.now();
      var base = Math.max(now, curExpMs || 0);
      var end = base + (MDAY[code] || 0) * 86400000;
      var stacked = curExpMs > now;
      return '<b class="pv-time">' + U.esc(fmtSec(new Date(end))) + '</b> 到期' +
        (stacked
          ? '<span class="pv-tag">在原到期时间上叠加 ' + MDAY[code] + ' 天</span>'
          : '<span class="pv-tag">自当前时刻起 ' + MDAY[code] + ' 天整</span>');
    }

    var body = '';
    body += '<div class="grant-cur">' +
      '<div class="gc-av pavatar ' + U.avatarClass(cur.id || 0) + '">' +
        U.esc(U.initial(cur.name, cur.username)) + '</div>' +
      '<div class="gc-main">' +
        '<div class="gc-name">' + U.esc(cur.name || cur.username || '—') +
          '<span class="dim small"> @' + U.esc(cur.username || '') + '</span></div>' +
        '<div class="gc-sub">📞 ' + U.esc(cur.phone || '—') +
          (cur.disabled ? ' · <span class="mt-dis-t">🚫 账号已禁用</span>' : '') + '</div>' +
      '</div>' +
      '<div class="gc-right">' + memberChip(cur) + '</div>' +
    '</div>';

    body += '<div class="grant-cur2">' +
      '<div class="info-cell"><div class="ic-k">当前到期时间</div><div class="ic-v">' +
        (cur.permanent ? '永久有效' : (cur.isSuper ? U.esc(fmtSec(cur.expireAt)) : '—')) + '</div></div>' +
      '<div class="info-cell"><div class="ic-k">当前剩余</div><div class="ic-v ' +
        (cur.almostDue ? 'mt-due-t' : '') + '">' +
        (cur.permanent ? '永久' : (cur.isSuper ? remainCn(cur.remainMs) : '—')) + '</div></div>' +
    '</div>';

    body += '<div class="sect-title"><span class="st-n">1</span>选择要设置的会员类型</div>';
    body += '<div class="type-picker" id="typePicker">' +
      CARDS.map(function (c) {
        var on = (c.code === 'none' && !cur.isSuper && !isPerm) ? true : false;
        return '<label class="tp-opt' + (c.danger ? ' tp-danger' : '') + (on ? ' on' : '') + '" data-tp="' + c.code + '">' +
          '<input type="radio" name="mtp" value="' + c.code + '"' + (on ? ' checked' : '') + '>' +
          '<span class="tp-ico">' + c.ico + '</span>' +
          '<span class="tp-body">' +
            '<span class="tp-name">' + U.esc(c.label) + '</span>' +
            '<span class="tp-sub">' + U.esc(c.sub) + '</span>' +
          '</span>' +
          '<span class="tp-price">' + (price(c.code) > 0 ? '¥' + price(c.code) : '免费') + '</span>' +
        '</label>';
      }).join('') +
    '</div>';

    body += '<div class="sect-title"><span class="st-n">2</span>设置后预计</div>';
    body += '<div class="pv-box" id="pvBox">' + previewFor('none') + '</div>';

    if (isPerm) {
      body += '<div class="note warn"><span class="n-ico">👑</span><span>' +
        '该账号已是永久会员 —— 永久会员不可逆，之后再设置任何会员类型都会保持永久有效。</span></div>';
    }

    body += '<div class="sect-title"><span class="st-n">3</span>备注（可选）</div>' +
      '<div class="field"><input class="input" id="grantRemark" type="text" ' +
        'placeholder="如：9 月续费 / 线下支付 / 活动赠送"></div>';

    body += '<div class="note info"><span class="n-ico">💡</span><span>' +
      '叠加规则：新的到期时刻 = max(当前时刻, 原到期时刻) + 本次时长。' +
      '例如剩余 2 天 2 小时 45 分 1 秒时充周会员，将变为 9 天 2 小时 45 分 1 秒。</span></div>';

    var m = UI.modal({
      title: '开通 / 续费 · ' + (cur.name || cur.username || ''),
      size: 'lg',
      closeOnBg: false,
      body: body,
      foot: '<button class="btn" data-act="no" type="button">取消</button>' +
            '<button class="btn btn-primary" data-act="yes" type="button">确认设置</button>',
      onMount: function (inst) {
        var picker = inst.query('#typePicker');
        var pvBox = inst.query('#pvBox');
        var picked = 'none';

        function select(code) {
          picked = code;
          U.qsa('.tp-opt', picker).forEach(function (el) {
            var on = el.dataset.tp === code;
            el.classList.toggle('on', on);
            var r = el.querySelector('input');
            if (r) r.checked = on;
          });
          pvBox.innerHTML = previewFor(code);
          pvBox.classList.toggle('pv-danger', code === 'none');
        }

        picker.addEventListener('click', function (e) {
          var opt = e.target.closest && e.target.closest('[data-tp]');
          if (!opt) return;
          e.preventDefault();
          select(opt.dataset.tp);
        });
        picker.addEventListener('change', function (e) {
          if (e.target.name === 'mtp') select(e.target.value);
        });

        inst.foot.querySelector('[data-act="no"]').addEventListener('click', function () { inst.close(); });

        inst.foot.querySelector('[data-act="yes"]').addEventListener('click', function () {
          var btn = this;
          var remark = (inst.query('#grantRemark').value || '').trim();
          var rs = UI.btnBusy(btn, '设置中…');
          API.admin.memberGrant(cur.id, picked, remark).then(function (res) {
            var after = res.member || res.after || {};
            var txt;
            if (!after.isSuper) {
              txt = '已变更为普通会员：仅可学习第一章，无法登录打卡平台';
            } else if (after.permanent) {
              txt = '已设置为永久会员（无到期时间）';
            } else {
              txt = '到期时间：' + fmtSec(after.expireAt);
              if (res.stacked) txt = '叠加续费 +' + (res.daysAdded || 0) + ' 天 · ' + txt;
            }
            UI.toast(txt, 'ok', '设置成功', 5200);
            m.close();
            if (typeof onDone === 'function') onDone(res);
          }).catch(function (e) { UI.errToast(e); }).then(rs);
        });
      },
    });
  }

  /* ───────── 会员变更流水弹层 ───────── */

  function openMemberLogs(id) {
    API.admin.memberLogs(id).then(function (r) {
      var items = r.items || [];
      var body = items.length
        ? '<div class="mflow">' + items.map(function (x) {
            var cls = x.action === 'disable' ? 'is-bad'
              : x.action === 'enable' ? 'is-ok'
              : x.action === 'expire' ? 'is-warn'
              : x.action === 'renew' ? 'is-accent' : '';
            return '<div class="mf-item ' + cls + '">' +
              '<div class="mf-dot"></div>' +
              '<div class="mf-body">' +
                '<div class="mf-head">' +
                  '<span class="mf-act">' + U.esc(x.actionText) + '</span>' +
                  '<span class="mf-time">' + U.esc(fmtSec(x.createdAt)) + '</span>' +
                '</div>' +
                '<div class="mf-line">' +
                  '<span class="mf-from">' + U.esc(x.typeFrom) + '</span>' +
                  '<span class="mf-arrow">→</span>' +
                  '<span class="mf-to">' + U.esc(x.typeTo) + '</span>' +
                  (x.daysAdded ? '<span class="chip xsmall">+' + x.daysAdded + ' 天</span>' : '') +
                '</div>' +
                (x.expireTo ? '<div class="mf-exp">到期：' + U.esc(x.expireTo) + '</div>' : '') +
                (x.remark ? '<div class="mf-remark">📝 ' + U.esc(x.remark) + '</div>' : '') +
                '<div class="mf-op">操作人：' + U.esc(x.operator) + '</div>' +
              '</div>' +
            '</div>';
          }).join('') + '</div>'
        : U.empty('🕘', '暂无变更记录', '开通、续费、到期降级、禁用与恢复都会记录在这里');

      UI.modal({
        title: '会员变更流水',
        size: 'lg',
        body: body,
        foot: '<button class="btn btn-primary" data-act="ok" type="button">知道了</button>',
        onMount: function (inst) {
          inst.foot.querySelector('[data-act="ok"]').addEventListener('click', function () { inst.close(); });
        },
      });
    }).catch(UI.errToast);
  }

  /* ═══════════════════ 视图：定价配置 ═══════════════════ */

  A.pricing = {
    title: '定价配置',
    icon: '💎',
    nav: true,
    group: '会员',
    render: function (host) {
      host.innerHTML = U.loading('正在加载定价档位…');

      API.admin.pricing().then(function (r) {
        var items = r.items || [];

        var html = '';
        html += '<div class="page-head">' +
          '<div><h2>💎 定价配置</h2>' +
            '<div class="ph-sub">价格与权益文案会实时同步到学习平台和打卡平台的「定价」页面</div></div>' +
          '<div class="ph-actions">' +
            '<button class="btn" data-act="refresh" type="button">🔄 刷新</button>' +
          '</div>' +
        '</div>';

        html += '<div class="price-admin-grid">' +
          items.map(function (p) {
            var durText = p.code === 'forever' ? '永久有效'
              : p.code === 'none' ? '不限期（免费）'
              : p.days + ' 天整';
            return '<div class="pcard' + (p.hot ? ' hot' : '') + (p.enabled ? '' : ' off') + '">' +
              '<div class="pcard-head">' +
                '<span class="pcard-code">' + U.esc(p.code) + '</span>' +
                (p.hot ? '<span class="pcard-tag hot-tag">推荐</span>' : '') +
                (p.enabled ? '<span class="pcard-tag on-tag">上架中</span>'
                           : '<span class="pcard-tag off-tag">已下架</span>') +
              '</div>' +
              '<div class="field"><label class="field-label">档位名称</label>' +
                '<input class="input" data-f="label" type="text" value="' + U.escAttr(p.label) + '"></div>' +
              '<div class="field"><label class="field-label">价格（元）</label>' +
                '<input class="input" data-f="price" type="number" step="0.01" min="0" value="' + p.price + '"></div>' +
              '<div class="field"><label class="field-label">时长</label>' +
                '<input class="input" type="text" value="' + U.esc(durText) + '" readonly style="opacity:.65"></div>' +
              '<div class="field"><label class="field-label">一句话卖点</label>' +
                '<input class="input" data-f="tagline" type="text" value="' + U.escAttr(p.tagline || '') + '"></div>' +
              '<div class="field"><label class="field-label">权益说明（每行一条）</label>' +
                '<textarea class="textarea" data-f="perks" rows="5">' +
                  U.esc((p.perks || []).join('\n')) + '</textarea></div>' +
              '<div class="pcard-toggles">' +
                '<label class="chk"><input type="checkbox" data-f="hot"' + (p.hot ? ' checked' : '') + '> 标记推荐</label>' +
                '<label class="chk"><input type="checkbox" data-f="enabled"' + (p.enabled ? ' checked' : '') + '> 上架展示</label>' +
                '<label class="chk chk-num">排序' +
                  '<input class="input input-mini" type="number" data-f="sortOrder" min="0" value="' + p.sortOrder + '"></label>' +
              '</div>' +
              '<button class="btn btn-primary pcard-save" data-price-save="' + p.code + '" type="button">保存该档位</button>' +
            '</div>';
          }).join('') +
        '</div>';

        html += '<div class="note warn"><span class="n-ico">⚠️</span><span>' +
          '改价只影响前端展示，不会改变已开通用户的到期时间。' +
          '「普通会员」档位建议保持 0 元；若要停止销售某档位，取消勾选「上架展示」即可。' +
          '</span></div>';

        host.innerHTML = html;
      }).catch(function (e) {
        host.innerHTML = U.errorBox(e.message,
          '<button class="btn btn-primary" data-act="retry" type="button">重新加载</button>');
        var rt = host.querySelector('[data-act="retry"]');
        if (rt) rt.addEventListener('click', function () { A.pricing.render(host); });
      });
    },
  };

  /* ═══════════════════ 视图：我的资料 ═══════════════════ */

  A.profile = {
    title: '我的资料',
    icon: '🙍',
    nav: true,
    group: '设置',
    render: function (host) {
      var u = STORE.user || {};
      var html = '';

      html += '<div class="page-head">' +
        '<div><h2>🙍 管理员资料</h2><div class="ph-sub">当前登录身份：管理员（教师）</div></div>' +
        '<div class="ph-actions"><button class="btn" data-act="pwd" type="button">🔑 修改密码</button></div>' +
      '</div>';

      html += '<div class="grid2">' +
        '<div class="panel">' +
          '<div class="panel-head"><h3>👤 账号信息</h3></div>' +
          '<div class="panel-body">' +
            '<div class="flex gap16 mb16">' +
              '<div class="avatar" style="width:62px;height:62px;font-size:25px;background:var(--ok-solid)">' +
                U.esc(U.initial(u.name, u.username)) + '</div>' +
              '<div><div class="bold" style="font-size:20px">' + U.esc(u.name || '—') + '</div>' +
                '<div class="dim">' + U.esc(u.username || '') + '</div></div>' +
            '</div>' +
            '<div class="info-grid">' +
              infoCell('身份', '管理员' + (u.adminRole === 'super' ? '（超级）' : '')) +
              infoCell('账号', u.username || '—') +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="panel">' +
          '<div class="panel-head"><h3>⚙️ 偏好与操作</h3></div>' +
          '<div class="panel-body">' +
            '<div style="display:flex;flex-direction:column;gap:12px">' +
              '<div class="between"><span>界面主题</span>' +
                '<button class="btn btn-sm" data-act="theme" type="button">🌗 ' +
                  (STORE.isDark ? '深蓝科技 → 切换为浅色' : '浅色纸张 → 切换为深蓝') + '</button></div>' +
              '<div class="between"><span>后端服务地址</span>' +
                '<button class="btn btn-sm" data-act="api" type="button">' +
                  U.esc(w.APP_CONFIG.API_BASE || '同源') + ' · 修改</button></div>' +
              '<div class="hr" style="margin:6px 0"></div>' +
              '<button class="btn btn-danger" data-act="logout" type="button" style="align-self:flex-start">🚪 退出登录</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

      html += '<div class="panel">' +
        '<div class="panel-head"><h3>🧭 管理端功能速览</h3></div>' +
        '<div class="panel-body">' +
          '<div class="grid3">' +
            feature('📊', '数据面板', '实时查看每人进度、14 天趋势、主目录完成度与动态', 'dashboard') +
            feature('👥', '学生名单', '维护姓名/学号/班级/电话，重置密码，停用账号', 'students') +
            feature('📚', '目录内容', '自由添加主目录、次目录、学习目录、学习内容', 'units') +
            feature('📣', '督促管理', '选章节 + 选人 + 设截止时间，消息直达学生账号', 'urges') +
            feature('✏️', '题库管理', '按学习内容出题、批量导入、查看每题正确率', 'questions') +
            feature('📋', '打卡流水', '含撤销打卡的完整痕迹，支持按学生与动作筛选', 'logs') +
          '</div>' +
        '</div>' +
      '</div>';

      host.innerHTML = html;
    },
  };

  function feature(ico, title, desc, go) {
    return '<div class="info-cell" style="cursor:pointer" data-go="' + go + '">' +
      '<div style="font-size:24px">' + ico + '</div>' +
      '<div class="ic-v" style="font-size:15px">' + U.esc(title) + '</div>' +
      '<div class="xsmall dim" style="margin-top:5px;line-height:1.62;font-weight:400">' + U.esc(desc) + '</div>' +
    '</div>';
  }

  /* ═══════════════════ 事件绑定 ═══════════════════ */

  function bindEvents() {
    var app = d.getElementById('app');
    if (!app || app.dataset.abound) return;
    app.dataset.abound = '1';

    /* ── 主委托：后台所有操作 ── */
    app.addEventListener('click', function (e) {
      // 学生端与管理端共用 #app 作为事件根，用角色守卫隔离
      if (!STORE.user || STORE.user.role !== 'admin') return;

      var t = e.target;
      var c = function (sel) { return t.closest && t.closest(sel); };

      /* ───── 目录树 ───── */

      // 展开 / 收起
      var tg = c('[data-toggle]');
      if (tg) {
        var id = Number(tg.dataset.toggle);
        var nodeEl = app.querySelector('[data-node="' + id + '"]');
        var bodyEl = app.querySelector('[data-body="' + id + '"]');
        if (nodeEl && bodyEl) {
          var open = !S.expanded[id];
          S.expanded[id] = open;
          tg.textContent = open ? '▾' : '▸';
          if (open && !bodyEl.dataset.rendered) {
            var list = STORE.state.adminUnits || [];
            var idx = idxOf(list);
            bodyEl.innerHTML = (idx.byParent[id] || []).map(function (k) { return renderAdminNode(k, idx, 2); }).join('');
            bodyEl.dataset.rendered = '1';
          }
          bodyEl.hidden = !open;
        }
        return;
      }

      if (c('[data-act="expand-all"]')) {
        S.noAutoExpand = true;
        (STORE.state.adminUnits || []).forEach(function (n) { if (n.level <= 3) S.expanded[n.id] = true; });
        A.units.render(d.getElementById('view'));
        return;
      }
      if (c('[data-act="collapse-all"]')) {
        S.expanded = {}; S.noAutoExpand = true;
        A.units.render(d.getElementById('view'));
        return;
      }

      // 新增子级
      var add = c('[data-unit-add]');
      if (add) {
        var pnode = findUnit(Number(add.dataset.unitAdd));
        if (pnode) openUnitEditor(pnode, null, d.getElementById('view'));
        return;
      }

      // 编辑节点
      var ed = c('[data-unit-edit]');
      if (ed) {
        var enode = findUnit(Number(ed.dataset.unitEdit));
        if (enode) openUnitEditor(null, enode, d.getElementById('view'));
        return;
      }

      // 删除节点
      var dl = c('[data-unit-del]');
      if (dl) {
        var did = Number(dl.dataset.unitDel);
        var dnode = findUnit(did);
        var dlist = STORE.state.adminUnits || [];
        var descendants = dnode ? U.descendants(dlist, did).length - 1 : 0;

        UI.confirm({
          title: '删除目录',
          message: '确定删除「' + (dnode ? dnode.title : '该目录') + '」吗？',
          detail: '该节点下有 ' + descendants + ' 个子项（直接子级 ' +
            (dnode ? dnode.childCount : 0) + ' 个），相关的学生打卡记录会被一并清除，此操作不可恢复。',
          okText: '确认删除',
          danger: true,
        }).then(function (ok) {
          if (!ok) return;
          var rs = UI.btnBusy(dl, '删除中…');
          API.admin.unitDelete(did).then(function (r) {
            UI.toast('已删除 ' + r.removed + ' 个节点', 'warn', '删除完成');
            STORE.invalidate('units');
            STORE.invalidate('tree');
            A.units.render(d.getElementById('view'));
          }).catch(function (err) { UI.errToast(err); }).then(rs);
        });
        return;
      }

      /* ───── 学生名单 ───── */

      var sd = c('[data-detail]') || c('[data-student-detail]');
      if (sd) {
        openStudentDetail(Number(sd.dataset.detail || sd.dataset.studentDetail));
        return;
      }
      var su = c('[data-urge]') || c('[data-student-urge]');
      if (su) {
        openUrgeDialog([Number(su.dataset.urge || su.dataset.studentUrge)]);
        return;
      }
      var se = c('[data-stu-edit]');
      if (se) {
        var stId = Number(se.dataset.stuEdit);
        API.admin.students().then(function (r) {
          var s = (r.items || []).filter(function (x) { return x.id === stId; })[0];
          if (s) openStudentEditor(s, function () { A.students.render(d.getElementById('view')); });
        }).catch(UI.errToast);
        return;
      }
      if (c('[data-act="student-new"]')) {
        openStudentEditor(null, function () { A.students.render(d.getElementById('view')); });
        return;
      }

      /* ───── 督促 ───── */

      var ut = c('[data-targets]');
      if (ut) {
        var uName = '';
        var panel = ut.closest('.panel');
        if (panel) {
          var h = panel.querySelector('.panel-head h3');
          if (h) uName = h.textContent.replace(/^📣\s*/, '');
        }
        openUrgeTargets(Number(ut.dataset.targets), uName);
        return;
      }
      var udel = c('[data-urge-del]');
      if (udel) {
        var uid2 = Number(udel.dataset.urgeDel);
        UI.confirm({
          title: '删除督促',
          message: '确定删除这条督促吗？',
          detail: '删除后学生端的这条消息会一并消失，已读与完成记录也会被清除。',
          okText: '确认删除',
          danger: true,
        }).then(function (ok) {
          if (!ok) return;
          API.admin.urgeDelete(uid2).then(function () {
            UI.toast('督促已删除', 'warn', '删除完成');
            A.urges.render(d.getElementById('view'));
          }).catch(UI.errToast);
        });
        return;
      }
      if (c('[data-act="urge"]') || c('[data-act="new-urge"]') || c('[data-act="new"]')) {
        var nbEl = c('[data-act="new"]');
        // 「新增」在不同视图含义不同
        if (nbEl && STORE.state.view === 'questions') {
          openQuestionEditor(null, null, d.getElementById('view'));
        } else if (nbEl && STORE.state.view === 'students') {
          openStudentEditor(null, function () { A.students.render(d.getElementById('view')); });
        } else {
          openUrgeDialog();
        }
        return;
      }
      if (c('[data-act="batch"]')) { openBatchImport(d.getElementById('view')); return; }
      if (c('[data-act="new-root"]')) { openUnitEditor(null, null, d.getElementById('view')); return; }

      /* ───── 提醒学生 ───── */

      var nDel = c('[data-notice-del]');
      if (nDel) {
        var nid = Number(nDel.dataset.noticeDel);
        var nRow = nDel.closest('[data-notice-row]');
        var nTxt = '';
        if (nRow) {
          var nc = nRow.querySelector('.notice-content');
          if (nc) nTxt = U.trunc(nc.textContent, 60);
        }
        UI.confirm({
          title: '撤回提醒',
          message: '确定撤回这条提醒吗？',
          detail: (nTxt ? '内容：' + nTxt + '。' : '') +
            '撤回后学生端立即不再显示，已关闭记录也会一并清除。',
          okText: '确认撤回',
          danger: true,
        }).then(function (ok) {
          if (!ok) return;
          API.admin.noticeDelete(nid).then(function () {
            UI.toast('提醒已撤回', 'warn', '撤回完成');
            A.notices.render(d.getElementById('view'));
          }).catch(UI.errToast);
        });
        return;
      }

      /* ───── 题库 ───── */

      var qe = c('[data-qedit]');
      if (qe) {
        var qid = Number(qe.dataset.qedit);
        API.admin.questions().then(function (r) {
          var q = (r.items || []).filter(function (x) { return x.id === qid; })[0];
          if (q) openQuestionEditor(q, null, d.getElementById('view'));
        }).catch(UI.errToast);
        return;
      }
      var qd = c('[data-qdel]');
      if (qd) {
        var qid2 = Number(qd.dataset.qdel);
        var row = qd.closest('[data-qrow]');
        UI.confirm({
          title: '删除题目',
          message: '确定删除这道题吗？',
          detail: '题干：' + (row ? U.trunc(row.querySelector('.l-title').textContent, 60) : '') +
            '。学生的作答记录也会一并删除。',
          okText: '确认删除',
          danger: true,
        }).then(function (ok) {
          if (!ok) return;
          API.admin.questionDelete(qid2).then(function () {
            UI.toast('题目已删除', 'warn', '删除完成');
            A.questions.render(d.getElementById('view'));
          }).catch(UI.errToast);
        });
        return;
      }

      /* ───── 会员管理 ───── */

      // 快速开通（先选账号）
      if (c('[data-mem-pick]')) { openMemberPicker(); return; }

      // 开通 / 续费 / 改档
      var mg = c('[data-mem-grant]');
      if (mg) {
        var grantId = Number(mg.dataset.memGrant);
        API.admin.members({}).then(function (r) {
          var row = (r.items || []).filter(function (x) { return x.id === grantId; })[0];
          if (!row) { UI.err('未找到该账号，请刷新后重试'); return; }
          openMemberGrant(row, function () {
            if (STORE.state.view === 'members') A.members.render(d.getElementById('view'));
          });
        }).catch(UI.errToast);
        return;
      }

      // 禁用 / 恢复使用
      var mtg = c('[data-mem-toggle]');
      if (mtg) {
        var tgId = Number(mtg.dataset.memToggle);
        var toStatus = Number(mtg.dataset.to) ? 1 : 0;
        var actName = toStatus ? '恢复使用' : '禁止使用';
        UI.confirm({
          title: actName + '账号',
          message: '确定要' + actName + '该账号吗？',
          detail: toStatus
            ? '恢复后该账号可继续学习全章节、打卡、导出记录与登录打卡平台。'
            : '禁用后该账号将无法使用学习平台的任何功能（学习、打卡、个人信息），' +
              '并会立即从打卡平台强制退出登录；解除禁用后即可恢复。',
          okText: '确认' + actName,
          cancelText: '再想想',
          danger: !toStatus,
        }).then(function (ok) {
          if (!ok) return;
          var rs = UI.btnBusy(mtg, '处理中…');
          API.admin.memberStatus(tgId, toStatus).then(function () {
            UI.toast('已' + actName, toStatus ? 'ok' : 'warn', '操作成功');
            if (STORE.state.view === 'members') A.members.render(d.getElementById('view'));
          }).catch(UI.errToast).then(rs);
        });
        return;
      }

      // 会员变更流水
      var mlg = c('[data-mem-logs]');
      if (mlg) { openMemberLogs(Number(mlg.dataset.memLogs)); return; }

      // 定价档位保存
      var psv = c('[data-price-save]');
      if (psv) {
        var card = psv.closest('.pcard');
        if (!card) return;
        var code = psv.dataset.priceSave;
        var patch = {
          label: (card.querySelector('[data-f="label"]').value || '').trim(),
          price: Number(card.querySelector('[data-f="price"]').value),
          tagline: (card.querySelector('[data-f="tagline"]').value || '').trim(),
          perks: (card.querySelector('[data-f="perks"]').value || '')
            .split('\n').map(function (x) { return x.trim(); }).filter(Boolean),
          hot: card.querySelector('[data-f="hot"]').checked,
          enabled: card.querySelector('[data-f="enabled"]').checked,
          sortOrder: Number(card.querySelector('[data-f="sortOrder"]').value) || 0,
        };
        if (!patch.label) { UI.err('请填写档位名称'); return; }
        if (!isFinite(patch.price) || patch.price < 0) { UI.err('价格必须是不小于 0 的数字'); return; }
        var rs2 = UI.btnBusy(psv, '保存中…');
        API.admin.pricingUpdate(code, patch).then(function () {
          UI.toast('「' + patch.label + '」已保存并同步到前端定价页', 'ok', '保存成功');
          if (STORE.state.view === 'pricing') A.pricing.render(d.getElementById('view'));
        }).catch(UI.errToast).then(rs2);
        return;
      }

      /* ───── 通用动作 ───── */

      if (c('[data-act="pwd"]')) { openPasswordDialog(); return; }
      if (c('[data-act="theme"]')) { STORE.toggleTheme(); A.profile.render(d.getElementById('view')); return; }
      if (c('[data-act="api"]')) { w.LoginView.openApiSetting(); return; }
      if (c('[data-act="logout"]')) { w.App.logout(); return; }
      if (c('[data-act="refresh"]')) {
        STORE.invalidate('units');
        A.refresh(true);
        return;
      }
      if (c('[data-act="retry"]')) { A.refresh(true); return; }
    });
  }

  /** 从缓存的节点列表里按 id 取节点 */
  function findUnit(id) {
    var list = STORE.state.adminUnits || [];
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) return list[i]; }
    return null;
  }

  function openPasswordDialog() {
    UI.modal({
      title: '修改密码',
      size: 'sm',
      body:
        '<div class="field"><label class="field-label">原密码</label>' +
          '<input class="input" id="pwdOld" type="password" autocomplete="current-password"></div>' +
        '<div class="field"><label class="field-label">新密码</label>' +
          '<input class="input" id="pwdNew" type="password" autocomplete="new-password" placeholder="至少 6 位"></div>' +
        '<div class="field"><label class="field-label">确认新密码</label>' +
          '<input class="input" id="pwdNew2" type="password" autocomplete="new-password"></div>' +
        '<div class="note warn"><span class="n-ico">⚠️</span><span>修改成功后当前登录会被注销，需要用新密码重新登录。</span></div>',
      foot: '<button class="btn" data-act="no" type="button">取消</button>' +
            '<button class="btn btn-primary" data-act="yes" type="button">确认修改</button>',
      onMount: function (m) {
        m.foot.querySelector('[data-act="no"]').addEventListener('click', function () { m.close(); });
        m.foot.querySelector('[data-act="yes"]').addEventListener('click', function () {
          var o = m.query('#pwdOld').value, n1 = m.query('#pwdNew').value, n2 = m.query('#pwdNew2').value;
          if (!o) return UI.err('请输入原密码');
          if (n1.length < 6) return UI.err('新密码至少 6 位');
          if (n1 !== n2) return UI.err('两次输入的新密码不一致');
          var rs = UI.btnBusy(this, '提交中…');
          API.auth.password(o, n1).then(function () {
            m.close();
            UI.toast('密码已修改，请重新登录', 'ok', '修改成功');
            setTimeout(function () { w.App.logout(); }, 900);
          }).catch(function (e) { UI.errToast(e); }).then(rs);
        });
      },
    });
  }

  /* ───────── 刷新 ───────── */
  A.refresh = function (force) {
    var host = d.getElementById('view');
    var def = A[STORE.state.view];
    if (!host || !def || typeof def.render !== 'function') return;
    if (force) { STORE.invalidate('units'); STORE.invalidate('tree'); }
    def.render(host);
  };

  A.bindEvents = bindEvents;
  A.state = S;
  A.KEYS = ['dashboard', 'students', 'members', 'pricing', 'units',
    'notices', 'urges', 'questions', 'logs', 'profile'];
  A.openUrgeDialog = openUrgeDialog;
  A.openStudentDetail = openStudentDetail;
  A.openUnitEditor = openUnitEditor;
  A.openQuestionEditor = openQuestionEditor;
  A.openMemberGrant = openMemberGrant;
  A.openMemberLogs = openMemberLogs;

  w.AdminView = A;
})(window, document);
