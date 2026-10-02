/* ══════════════════════════════════════════════════════════════════
   views/student.js · 学生端
   ──────────────────────────────────────────────────────────────────
   视图：我的学习 / 学习目录 / 我的打卡 / 老师督促 / 练习题 / 我的资料
   学生权限：只读目录 + 打卡 / 撤销打卡 / 答题，无任何增删目录权限
   ══════════════════════════════════════════════════════════════════ */
(function (w, d) {
  'use strict';

  var U = w.U;
  var UI = w.UI;
  var API = w.API;
  var STORE = w.STORE;

  var V = {};

  /* ───────── 视图内状态 ───────── */
  var S = {
    expanded: {},        // unitId -> true
    treeLoading: false,
    detailId: null,
    recordFilter: 'all',
  };

  /* ═══════════════════ 工具 ═══════════════════ */

  function indexTree(flat) {
    var byId = {}, byParent = {};
    (flat || []).forEach(function (n) {
      byId[n.id] = n;
      var p = n.parentId == null ? 0 : n.parentId;
      if (!byParent[p]) byParent[p] = [];
      byParent[p].push(n);
    });
    Object.keys(byParent).forEach(function (k) {
      byParent[k].sort(function (a, b) {
        return (a.level - b.level) || (a.id - b.id);
      });
    });
    return { byId: byId, byParent: byParent };
  }

  function loadTree(force) {
    if (!force && STORE.treeFresh()) return Promise.resolve(STORE.state.tree);
    if (S.treeLoading) return S.treePromise;
    S.treeLoading = true;
    S.treePromise = API.student.tree().then(function (r) {
      STORE.state.tree = r;
      STORE.state.treeAt = Date.now();
      S.treeLoading = false;
      return r;
    }).catch(function (e) {
      S.treeLoading = false;
      throw e;
    });
    return S.treePromise;
  }

  /** 进度条 HTML */
  function barHtml(done, total, cls) {
    var p = U.pct(done, total);
    return '<div class="bar-line">' +
      '<div class="bar ' + (cls || U.pctClass(p)) + '"><i style="width:' + p + '%"></i></div>' +
      '<span class="bar-pct">' + U.pctText(p) + '</span>' +
    '</div>';
  }

  /** 单元详情弹层：展示该节点下全部学习内容，并可在此打卡 */
  function openUnit(unit, ctx) {
    var c = ctx || {};
    var loading = UI.modal({
      title: unit ? unit.title : '加载中',
      size: 'lg',
      body: U.loading('正在加载学习内容…'),
      foot: '<button class="btn" data-act="close" type="button">关闭</button>',
      onMount: function (m) {
        m.foot.querySelector('[data-act="close"]').addEventListener('click', function () { m.close(); });
      },
    });

    API.student.unit(unit.id).then(function (r) {
      var u = r.unit, kids = r.children || [];
      var ck = r.checkin || {};

      // 头部信息
      var head =
        '<div class="flex gap8 wrap mb12">' +
          '<span class="chip">' + U.levelIcon(u.level) + ' ' + U.esc(U.levelName(u.level)) + '</span>' +
          (u.difficulty ? U.diffChip(u.difficulty) : '') +
          (u.checkable
            ? (ck.done
                ? '<span class="chip d1">✓ 已打卡' + (ck.date ? ' · ' + U.esc(ck.date) : '') + '</span>'
                : '<span class="chip d3">○ 未打卡</span>')
            : '') +
        '</div>' +
        (u.summary ? '<div class="dim2 mb12" style="font-size:15px;line-height:1.8">' + U.esc(u.summary) + '</div>' : '') +
        '<div class="crumbs" style="margin-bottom:14px"><span>📍</span><span>' + U.esc(u.path || '') + '</span></div>';

      // 自身正文（目录节点通常为空）
      var selfBody = u.body ? U.renderBody(u.contentType, u.body, { lang: u.lang, title: u.title }) : '';
      if (u.contentType === 'cmd' && u.example) selfBody = U.renderCmdCard(u) + selfBody;

      // 子内容
      var kidsHtml = '';
      if (kids.length) {
        kidsHtml = '<div class="divider"></div>' +
          '<h3 class="sect-title"><span class="st-n">' + kids.length + '</span>本章共 ' + kids.length + ' 个学习内容</h3>' +
          '<div style="display:flex;flex-direction:column;gap:16px">' +
          kids.map(function (k, i) {
            var body = U.renderBody(k.contentType, k.body, { lang: k.lang, title: k.title });
            var isIco = k.contentType === 'code' ? '' : U.ctIcon(k.contentType) + ' ';
            return '<div class="panel">' +
              '<div class="panel-head">' +
                '<h3 style="font-size:16px">' +
                  '<span class="dim xsmall num">' + (i + 1) + '</span>' +
                  U.esc(k.title || U.ctName(k.contentType)) +
                '</h3>' +
                '<span class="chip xsmall">' + U.ctName(k.contentType) + '</span>' +
              '</div>' +
              '<div class="panel-body">' +
                (k.summary ? '<div class="dim mb12" style="font-size:14.5px">' + U.esc(k.summary) + '</div>' : '') +
                (body || '<div class="dim">（暂无内容）</div>') +
              '</div>' +
            '</div>';
          }).join('') +
          '</div>';
      } else if (!selfBody) {
        kidsHtml = U.empty('📭', '该节点暂无学习内容', '请联系管理员在后台补充内容');
      }

      // 底部操作
      var foot =
        '<button class="btn" data-act="close" type="button">关闭</button>';
      if (u.checkable) {
        foot = (ck.done
          ? '<button class="btn btn-danger" data-act="revoke" type="button">↩️ 撤销这次打卡</button>'
          : '<button class="btn btn-primary" data-act="checkin" type="button">✓ 完成打卡</button>') + foot;
      }

      loading.title(u.title);
      loading.setBody(head + selfBody + kidsHtml);
      loading.setFoot(foot);

      var bin = loading.foot.querySelector('[data-act="checkin"]');
      var rvn = loading.foot.querySelector('[data-act="revoke"]');

      if (bin) {
        bin.addEventListener('click', function () {
          var rs = UI.btnBusy(bin, '打卡中…');
          API.student.checkin([u.id], U.today()).then(function () {
            UI.toast('已打卡：' + u.title, 'ok', '打卡成功');
            STORE.invalidate('tree');
            loading.close();
            V.refresh();
          }).catch(function (e) {
            UI.errToast(e);
          }).then(rs);
        });
      }

      if (rvn) {
        rvn.addEventListener('click', function () {
          UI.confirm({
            title: '撤销打卡',
            message: '确定撤销《' + u.title + '》的打卡吗？',
            detail: '撤销后老师的管理后台会收到「已撤销打卡」记录，进度也会同步回退。',
            okText: '确定撤销',
            danger: true,
          }).then(function (ok) {
            if (!ok) return;
            var rs = UI.btnBusy(rvn, '撤销中…');
            API.student.revoke([u.id]).then(function () {
              UI.toast('已撤销：' + u.title, 'warn', '撤销成功');
              STORE.invalidate('tree');
              loading.close();
              V.refresh();
            }).catch(function (e) {
              UI.errToast(e);
            }).then(rs);
          });
        });
      }
    }).catch(function (e) {
      loading.setBody(U.errorBox(e.message,
        '<button class="btn btn-primary" data-act="retry" type="button">重新加载</button>'));
      var rb = loading.body.querySelector('[data-act="retry"]');
      if (rb) rb.addEventListener('click', function () { loading.close(); openUnit(unit, ctx); });
    });
  }

  /* ═══════════════════ 视图：我的学习（数据面板） ═══════════════════ */

  V.dashboard = {
    title: '我的学习',
    icon: '📊',
    nav: true,
    render: function (host) {
      host.innerHTML = U.loading('正在统计学习进度…');

      Promise.all([API.student.myStats(), API.student.messages()]).then(function (res) {
        var st = res[0] || {};
        var msgs = (res[1] && res[1].items) || [];
        var unread = msgs.filter(function (m) { return !m.read; });
        var todo = msgs.filter(function (m) { return !m.done; });

        var name = STORE.user ? (STORE.user.name || STORE.user.username) : '同学';

        var html = '';

        // 欢迎语
        html +=
          '<div class="page-head">' +
            '<div>' +
              '<h2>👋 ' + U.esc(name) + '，今天也要加油</h2>' +
              '<div class="ph-sub">' + U.esc(U.fmtDateCN(U.today())) + ' · ' +
                (st.today > 0 ? '今日已打卡 <b>' + st.today + '</b> 项，很棒！' : '今天还没有打卡，先从一个小目标开始吧') +
              '</div>' +
            '</div>' +
            '<div class="ph-actions">' +
              '<button class="btn btn-primary" data-go="catalog" type="button">📚 去学习打卡</button>' +
            '</div>' +
          '</div>';

        // 统计卡
        html += '<div class="stats-grid">' +
          statCard('📈', '总体完成度', U.pctText(st.percent), '%', '共 ' + (st.total || 0) + ' 个知识点', 'accent') +
          statCard('✅', '已打卡', U.num(st.done), '项', '剩余 ' + Math.max(0, (st.total || 0) - (st.done || 0)) + ' 项', 'ok') +
          statCard('🔥', '连续打卡', U.num(st.streak), '天', '累计学习 ' + (st.activeDays || 0) + ' 天', (st.streak > 0 ? 'warn' : '')) +
          statCard('📣', '待办督促', U.num(todo.length), '条', unread.length ? unread.length + ' 条未读' : '暂无未读', (unread.length ? 'danger' : '')) +
        '</div>';

        // 进度环 + 动态
        html += '<div class="grid-2-1">';

        // 左：完成度 + 快捷
        html += '<div class="panel">' +
          '<div class="panel-head"><h3>🎯 学习进度</h3>' +
            '<div class="ph-tools"><button class="btn btn-sm" data-go="records" type="button">查看全部打卡</button></div>' +
          '</div>' +
          '<div class="panel-body">' +
            '<div class="flex gap16 wrap" style="align-items:center">' +
              U.ring(st.percent, 132, '总体完成度') +
              '<div class="grow" style="min-width:210px">' +
                '<div class="mb12"><div class="field-label">已完成知识点</div>' +
                  '<div class="bar-line"><div class="bar ok"><i style="width:' + U.pct(st.done, st.total) + '%"></i></div>' +
                  '<span class="bar-pct">' + U.num(st.done) + '/' + U.num(st.total) + '</span></div></div>' +
                '<div class="info-grid">' +
                  infoCell('今日打卡', st.today + ' 项') +
                  infoCell('连续天数', st.streak + ' 天') +
                  infoCell('学习天数', st.activeDays + ' 天') +
                  infoCell('未读督促', unread.length + ' 条') +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';

        // 右：待办督促
        html += '<div class="panel">' +
          '<div class="panel-head"><h3>📣 老师督促</h3>' +
            (todo.length ? '<div class="ph-tools"><span class="badge">' + todo.length + '</span></div>' : '') +
          '</div>' +
          '<div class="panel-body tight">' +
            (todo.length
              ? '<div style="display:flex;flex-direction:column;gap:10px" class="scroll-y" >' +
                  todo.slice(0, 4).map(function (m) { return msgCardSmall(m); }).join('') +
                '</div>' +
                (todo.length > 4 ? '<div class="tc mt12"><button class="btn btn-sm" data-go="messages" type="button">查看全部 ' + todo.length + ' 条</button></div>' : '')
              : U.empty('🎉', '暂无待办督促', '老师还没有给你发督促消息')) +
          '</div>' +
        '</div>';

        html += '</div>';

        // 最近动态
        var recent = st.recent || [];
        html += '<div class="panel">' +
          '<div class="panel-head"><h3>🕒 最近动态</h3>' +
            '<div class="ph-tools"><button class="btn btn-sm" data-go="records" type="button">全部记录</button></div>' +
          '</div>' +
          '<div class="panel-body">' +
            (recent.length
              ? '<div class="timeline">' + recent.map(function (r) {
                  var a = U.act(r.action);
                  return '<div class="tl-item ' + a.cls + '">' +
                    '<div class="tl-top"><b>' + a.ico + ' ' + U.esc(a.label) + '</b>' +
                      '<span class="dim">' + U.esc(U.trunc(r.title, 46)) + '</span>' +
                      '<span class="tl-time">' + U.esc(U.relTime(r.at)) + '</span>' +
                    '</div>' +
                    (r.date ? '<div class="tl-sub">打卡日期 ' + U.esc(r.date) + '</div>' : '') +
                  '</div>';
                }).join('') + '</div>'
              : U.empty('🌱', '还没有学习记录', '去「学习目录」完成第一个打卡吧',
                  '<button class="btn btn-primary" data-go="catalog" type="button">开始学习</button>')) +
          '</div>' +
        '</div>';

        // 练习题入口
        html += '<div class="panel">' +
          '<div class="panel-head"><h3>✏️ 巩固练习</h3></div>' +
          '<div class="panel-body">' +
            '<div class="flex gap16 wrap" style="align-items:center">' +
              '<div style="font-size:40px">🧠</div>' +
              '<div class="grow" style="min-width:200px">' +
                '<div class="bold" style="font-size:16px">做几道题检验学习效果</div>' +
                '<div class="dim small mt8">题目由老师在后台按学习内容出题，答完立即批改并给出解析。</div>' +
              '</div>' +
              '<button class="btn btn-primary" data-go="exercises" type="button">去做题</button>' +
            '</div>' +
          '</div>' +
        '</div>';

        host.innerHTML = html;
      }).catch(function (e) {
        host.innerHTML = U.errorBox(e.message,
          '<button class="btn btn-primary" data-act="retry" type="button">重新加载</button>');
        var rb = host.querySelector('[data-act="retry"]');
        if (rb) rb.addEventListener('click', function () { V.dashboard.render(host); });
      });
    },
  };

  function statCard(ico, label, val, unit, foot, cls) {
    return '<div class="stat-card ' + (cls || '') + '">' +
      '<div class="s-top"><span class="s-ico">' + ico + '</span><span>' + U.esc(label) + '</span></div>' +
      '<div class="s-num">' + U.esc(val) + (unit ? '<small>' + U.esc(unit) + '</small>' : '') + '</div>' +
      '<div class="s-foot">' + U.esc(foot) + '</div>' +
    '</div>';
  }

  function infoCell(k, v) {
    return '<div class="info-cell"><div class="ic-k">' + U.esc(k) + '</div>' +
      '<div class="ic-v num">' + U.esc(v) + '</div></div>';
  }

  function msgCardSmall(m) {
    var ddl = m.deadline ? U.deadlineText(m.deadline) : null;
    return '<div class="msg' + (m.read ? '' : ' unread') + (ddl && ddl.overdue ? ' overdue' : '') + '" ' +
      'data-msg="' + m.targetId + '" style="padding:11px 13px;cursor:pointer">' +
      '<span class="m-ico">' + (ddl && ddl.overdue ? '⏰' : '📣') + '</span>' +
      '<div class="m-main">' +
        '<div class="m-title" style="font-size:15px">' + U.esc(U.trunc(m.title, 34)) + '</div>' +
        (m.unitPath ? '<div class="m-meta"><span>📖 ' + U.esc(U.shortPath(m.unitPath)) + '</span></div>' : '') +
        (ddl ? '<div class="m-meta"><span style="color:' + (ddl.overdue ? 'var(--danger)' : 'var(--warn)') + '">' +
          U.esc(ddl.text) + '</span></div>' : '') +
      '</div>' +
    '</div>';
  }

  /* ═══════════════════ 视图：学习目录 ═══════════════════ */

  V.catalog = {
    title: '学习目录',
    icon: '📚',
    nav: true,
    render: function (host) {
      host.innerHTML = U.loading('正在加载学习目录…');

      loadTree().then(function (r) {
        var idx = indexTree(r.tree || []);
        var totals = r.totals || { total: 0, done: 0 };

        var html = '';

        html += '<div class="page-head">' +
          '<div>' +
            '<h2>📚 学习目录</h2>' +
            '<div class="ph-sub">勾选「学习目录」即可打卡 · 点标题查看本章全部内容</div>' +
          '</div>' +
          '<div class="ph-actions">' +
            '<button class="btn" data-act="expand-all" type="button">展开全部</button>' +
            '<button class="btn" data-act="collapse-all" type="button">收起全部</button>' +
          '</div>' +
        '</div>';

        // 总进度条
        html += '<div class="panel">' +
          '<div class="panel-body" style="padding:15px 18px">' +
            '<div class="flex gap16 wrap" style="align-items:center">' +
              '<div style="min-width:150px"><div class="field-label">我的总进度</div>' +
                '<div class="s-num num" style="font-size:25px">' + U.num(totals.done) + ' <small style="font-size:14px;color:var(--ink-3)">/ ' + U.num(totals.total) + '</small></div>' +
              '</div>' +
              '<div class="grow" style="min-width:180px">' +
                '<div class="bar-line">' +
                  '<div class="bar ' + U.pctClass(U.pct(totals.done, totals.total)) + '"><i style="width:' + U.pct(totals.done, totals.total) + '%"></i></div>' +
                  '<span class="bar-pct">' + U.pctText(U.pct(totals.done, totals.total)) + '</span>' +
                '</div>' +
                '<div class="field-hint">共 ' + U.num(totals.total) + ' 个可打卡的知识点</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';

        // 树
        html += '<div class="tree" id="treeRoot">';
        (idx.byParent[0] || []).forEach(function (n) {
          html += renderNode(n, idx, 1);
        });
        html += '</div>';

        host.innerHTML = html;

        // 首次进入自动展开第一个主目录（用户点过「收起全部」后不再自动展开）
        var roots = idx.byParent[0] || [];
        if (roots.length && !Object.keys(S.expanded).length && !S.noAutoExpand) {
          S.expanded[roots[0].id] = true;
          var body = host.querySelector('[data-body="' + roots[0].id + '"]');
          var node = host.querySelector('[data-node="' + roots[0].id + '"]');
          if (node) node.querySelector('.t-toggle').textContent = '▾';
          // 重新渲染该节点的子级
          if (body) {
            body.hidden = false;
            body.innerHTML = (idx.byParent[roots[0].id] || [])
              .map(function (c) { return renderNode(c, idx, 2); }).join('');
          }
        }

        STORE.emit('checkinbar', { view: 'catalog' });
      }).catch(function (e) {
        host.innerHTML = U.errorBox(e.message,
          '<button class="btn btn-primary" data-act="retry" type="button">重新加载</button>');
        var rb = host.querySelector('[data-act="retry"]');
        if (rb) rb.addEventListener('click', function () { V.catalog.render(host); });
      });
    },
  };

  var LV_ICO = { 1: '📚', 2: '📂', 3: '📄', 4: '📝' };

  function renderNode(n, idx, depth) {
    var kids = idx.byParent[n.id] || [];
    var isOpen = !!S.expanded[n.id];
    var checkable = n.checkable;
    var done = n.done;
    var picked = STORE.picked.has(n.id);

    // 第 3 层（学习目录）：带勾选框 + 点击查看内容
    if (n.level === 3) {
      return '<div class="unit-row' + (done ? ' done' : '') + (picked ? ' picked' : '') + '" data-unit="' + n.id + '">' +
        '<span class="u-ck">' +
          '<input type="checkbox" class="ck" data-pick="' + n.id + '"' + (picked ? ' checked' : '') +
            (checkable ? '' : ' disabled') + ' aria-label="选择">' +
        '</span>' +
        '<div class="u-main">' +
          '<div class="u-title">' +
            '<span>' + (done ? '✅' : '📄') + '</span>' +
            '<a href="javascript:void(0)" data-open="' + n.id + '" style="color:inherit;text-decoration:none">' + U.esc(n.title) + '</a>' +
            (done ? '<span class="chip d1 xsmall">已打卡</span>' : '') +
            (n.difficulty ? U.diffChip(n.difficulty) : '') +
          '</div>' +
          (n.summary ? '<div class="u-sub">' + U.esc(U.trunc(n.summary, 92)) + '</div>' : '') +
          (n.total ? '<div class="u-sub dim">含 ' + n.total + ' 个学习内容 · 已完成 ' + n.completed + '</div>' : '') +
        '</div>' +
        '<div class="u-acts">' +
          (kids.length ? '<button class="btn btn-sm" data-open="' + n.id + '" type="button">查看内容 (' + kids.length + ')</button>' : '') +
          (done
            ? '<button class="btn btn-sm btn-danger" data-revoke="' + n.id + '" type="button">撤销</button>'
            : '<button class="btn btn-sm btn-primary" data-checkin="' + n.id + '" type="button">打卡</button>') +
        '</div>' +
      '</div>';
    }

    // 第 4 层：只在父级展开时出现
    if (n.level === 4) {
      return '<div class="unit-row" data-unit="' + n.id + '">' +
        '<span class="u-ck" style="font-size:15px">' + U.ctIcon(n.contentType) + '</span>' +
        '<div class="u-main">' +
          '<div class="u-title"><a href="javascript:void(0)" data-open="' + n.id + '" style="color:inherit;text-decoration:none">' +
            U.esc(n.title || U.ctName(n.contentType)) + '</a></div>' +
          (n.summary ? '<div class="u-sub">' + U.esc(U.trunc(n.summary, 90)) + '</div>' : '') +
        '</div>' +
        '<div class="u-acts"><span class="chip xsmall">' + U.ctName(n.contentType) + '</span></div>' +
      '</div>';
    }

    // 第 1、2 层：可展开的目录
    var inner = '';
    if (isOpen) {
      inner = kids.map(function (c) { return renderNode(c, idx, depth + 1); }).join('');
      if (!kids.length) inner = '<div class="dim small tc" style="padding:10px">（暂无子目录）</div>';
    }

    return '<div class="tree-node lv' + n.level + '" data-node="' + n.id + '">' +
      '<div class="tree-head" data-toggle="' + n.id + '">' +
        '<button class="t-toggle" type="button" aria-label="展开收起" tabindex="-1">' + (isOpen ? '▾' : '▸') + '</button>' +
        '<span class="t-ico">' + LV_ICO[n.level] + '</span>' +
        '<div class="t-main">' +
          '<div class="t-title">' +
            U.esc(n.title) +
            '<span class="chip xsmall">' + U.levelName(n.level) + '</span>' +
          '</div>' +
          (n.summary ? '<div class="t-sum">' + U.esc(n.summary) + '</div>' : '') +
        '</div>' +
        '<div class="t-right">' +
          '<div class="t-stat">' +
            '<div class="ts-n">' + U.num(n.completed) + ' / ' + U.num(n.total) + '</div>' +
            '<div class="ts-l">已完成</div>' +
          '</div>' +
          '<div style="width:104px">' + barHtml(n.completed, n.total) + '</div>' +
          '<button class="btn btn-sm" data-open="' + n.id + '" type="button">查看</button>' +
        '</div>' +
      '</div>' +
      '<div class="tree-body" data-body="' + n.id + '"' + (isOpen ? '' : ' hidden') + '>' + inner + '</div>' +
    '</div>';
  }

  /* ═══════════════════ 视图：我的打卡 ═══════════════════ */

  /** 会员状态 + 三格式导出条（超级会员专属） */
  function exportBar() {
    var MG = w.MemberGate;
    var m = (MG && MG.member) || { type: 'none', isSuper: false };
    var superMode = !!m.isSuper;
    if (!superMode) {
      return '<div class="mem-strip">' +
        '<span class="bi">🔒</span>' +
        '<span>普通会员无法导出打卡记录。<b>超级会员</b>可导出 CSV / Excel / PDF 三种格式。</span>' +
        '<span class="sp"></span>' +
        '<button type="button" data-mem="pricing">💎 查看会员定价</button>' +
      '</div>';
    }
    return '<div class="mem-strip" style="border-color:var(--accent)">' +
      '<span class="bi">📤</span>' +
      '<span>导出打卡记录：' +
        '<b>' + U.esc(MG.LEVEL_CN[m.type] || '超级会员') + '</b>' +
        (m.permanent ? '（永久有效）' : '　到期 <b>' + U.esc(m.expireAt || '') + '</b>') +
      '</span>' +
      '<span class="sp"></span>' +
      '<label class="dim xsmall" style="display:flex;align-items:center;gap:6px">' +
        '起 <input class="input" type="date" id="expFrom" style="width:auto;padding:5px 8px">' +
        '止 <input class="input" type="date" id="expTo" style="width:auto;padding:5px 8px">' +
      '</label>' +
      '<button type="button" data-export="csv">📄 导出 CSV</button>' +
      '<button type="button" data-export="xlsx">📊 导出 Excel</button>' +
      '<button type="button" data-export="pdf">📕 导出 PDF</button>' +
    '</div>';
  }

  V.records = {
    title: '我的打卡',
    icon: '✅',
    nav: true,
    exportBar: exportBar,
    render: function (host) {
      host.innerHTML = U.loading('正在加载打卡记录…');

      API.student.myCheckins(800).then(function (r) {
        var items = r.items || [];
        var groups = {};
        items.forEach(function (it) {
          var k = it.date || '未知日期';
          if (!groups[k]) groups[k] = [];
          groups[k].push(it);
        });
        var dates = Object.keys(groups).sort().reverse();

        var html = '';
        html += '<div class="page-head">' +
          '<div><h2>✅ 我的打卡记录</h2>' +
            '<div class="ph-sub">共 ' + items.length + ' 条记录，覆盖 ' + dates.length + ' 天 · 可随时撤销</div></div>' +
          '<div class="ph-actions">' +
            '<button class="btn" data-go="catalog" type="button">📚 去补打卡</button>' +
          '</div>' +
        '</div>';

        html += exportBar();

        if (!items.length) {
          host.innerHTML = html + '<div class="panel"><div class="panel-body">' +
            U.empty('📭', '还没有打卡记录', '前往「学习目录」，勾选知识点并提交打卡',
              '<button class="btn btn-primary" data-go="catalog" type="button">开始学习</button>') +
            '</div></div>';
          return;
        }

        // 日期筛选
        html += '<div class="filters">' +
          '<span class="fl-label">日期</span>' +
          '<select class="select" data-filter="date"><option value="">全部日期</option>' +
            dates.map(function (dt) {
              return '<option value="' + U.escAttr(dt) + '">' + U.esc(dt) + '（' + groups[dt].length + ' 项）</option>';
            }).join('') +
          '</select>' +
          '<span class="spacer"></span>' +
          '<span class="dim small">共 <b class="num">' + items.length + '</b> 条</span>' +
        '</div>';

        html += '<div id="recList">';
        dates.forEach(function (dt) {
          var arr = groups[dt];
          html += '<div class="panel mb16" data-day="' + U.escAttr(dt) + '">' +
            '<div class="panel-head">' +
              '<h3>📅 ' + U.esc(dt) + '</h3>' +
              '<span class="chip">' + arr.length + ' 项</span>' +
              '<div class="ph-tools">' +
                '<button class="btn btn-sm btn-danger" data-revoke-day="' + U.escAttr(dt) + '" type="button">撤销当天全部</button>' +
              '</div>' +
            '</div>' +
            '<div class="panel-body flush"><div class="list">' +
            arr.map(function (it) {
              return '<div class="list-row" data-rec="' + it.unitId + '">' +
                '<span style="font-size:19px">✅</span>' +
                '<div class="l-main">' +
                  '<div class="l-title">' + U.esc(it.title) + '</div>' +
                  '<div class="l-sub">' + U.esc(it.path) + '</div>' +
                '</div>' +
                '<div class="l-right">' +
                  (it.difficulty ? U.diffChip(it.difficulty) : '') +
                  '<span class="dim xsmall nowrap">' + U.esc(U.relTime(it.at)) + '</span>' +
                  '<button class="btn btn-sm" data-open="' + it.unitId + '" type="button">查看</button>' +
                  '<button class="btn btn-sm btn-danger" data-revoke="' + it.unitId + '" type="button">撤销</button>' +
                '</div>' +
              '</div>';
            }).join('') +
            '</div></div>' +
          '</div>';
        });
        html += '</div>';

        host.innerHTML = html;

        // 日期筛选
        var sel = host.querySelector('[data-filter="date"]');
        if (sel) {
          sel.addEventListener('change', function () {
            var v = sel.value;
            U.qsa('[data-day]', host).forEach(function (n) {
              n.hidden = !!v && n.dataset.day !== v;
            });
          });
        }
      }).catch(function (e) {
        host.innerHTML = U.errorBox(e.message,
          '<button class="btn btn-primary" data-act="retry" type="button">重新加载</button>');
        var rb = host.querySelector('[data-act="retry"]');
        if (rb) rb.addEventListener('click', function () { V.records.render(host); });
      });
    },
  };

  /* ═══════════════════ 视图：老师督促 ═══════════════════ */

  V.messages = {
    title: '老师督促',
    icon: '📣',
    nav: true,
    render: function (host) {
      host.innerHTML = U.loading('正在加载督促消息…');

      API.student.messages().then(function (r) {
        var items = r.items || [];
        var unread = items.filter(function (m) { return !m.read; });
        var todo = items.filter(function (m) { return !m.done; });

        var html = '';
        html += '<div class="page-head">' +
          '<div><h2>📣 老师督促</h2>' +
            '<div class="ph-sub">共 ' + items.length + ' 条 · ' + unread.length + ' 条未读 · ' + todo.length + ' 条待完成</div></div>' +
          '<div class="ph-actions">' +
            (unread.length ? '<button class="btn" data-act="read-all" type="button">全部标为已读</button>' : '') +
          '</div>' +
        '</div>';

        if (!items.length) {
          host.innerHTML = html + '<div class="panel"><div class="panel-body">' +
            U.empty('🎉', '暂无督促消息', '老师还没有给你发督促消息，自觉学习最棒！') +
            '</div></div>';
          return;
        }

        html += '<div class="stats-grid">' +
          statCard('📬', '总消息', items.length, '条', '来自管理员的督促', '') +
          statCard('🔔', '未读', unread.length, '条', unread.length ? '请及时查看' : '全部已读', unread.length ? 'danger' : 'ok') +
          statCard('⏳', '待完成', todo.length, '条', '完成后可标记', todo.length ? 'warn' : 'ok') +
          statCard('🏁', '已完成', items.length - todo.length, '条', '继续保持', 'ok') +
        '</div>';

        html += '<div style="display:flex;flex-direction:column;gap:14px">' +
          items.map(function (m) { return msgCardFull(m); }).join('') +
        '</div>';

        host.innerHTML = html;

        // 全部已读
        var ra = host.querySelector('[data-act="read-all"]');
        if (ra) {
          ra.addEventListener('click', function () {
            var rs = UI.btnBusy(ra, '处理中…');
            Promise.all(unread.map(function (m) { return API.student.readMessage(m.targetId); }))
              .then(function () {
                UI.toast('已将 ' + unread.length + ' 条标记为已读', 'ok');
                STORE.emit('unread-changed');
                V.refresh();
              }).catch(function (e) { UI.errToast(e); }).then(rs);
          });
        }
      }).catch(function (e) {
        host.innerHTML = U.errorBox(e.message,
          '<button class="btn btn-primary" data-act="retry" type="button">重新加载</button>');
        var rb = host.querySelector('[data-act="retry"]');
        if (rb) rb.addEventListener('click', function () { V.messages.render(host); });
      });
    },
  };

  function msgCardFull(m) {
    var ddl = m.deadline ? U.deadlineText(m.deadline) : null;
    var pr = { 1: '普通', 2: '重要', 3: '紧急' }[m.priority] || '普通';
    var prCls = { 1: '', 2: 'd3', 3: 'd4' }[m.priority] || '';

    return '<div class="msg' + (m.read ? '' : ' unread') + (m.done ? ' done' : '') +
      (ddl && ddl.overdue ? ' overdue' : '') + '" data-msg="' + m.targetId + '">' +
      '<span class="m-ico">' + (m.done ? '🏁' : (ddl && ddl.overdue ? '⏰' : '📣')) + '</span>' +
      '<div class="m-main">' +
        '<div class="m-title">' +
          U.esc(m.title) +
          (prCls ? '<span class="chip ' + prCls + ' xsmall">' + pr + '</span>' : '') +
          (m.done ? '<span class="chip d1 xsmall">已完成</span>' : (m.read ? '' : '<span class="chip d2 xsmall">未读</span>')) +
        '</div>' +
        (m.unitPath ? '<div class="m-meta"><span>📖 指定章节：' + U.esc(m.unitPath) + '</span></div>' : '') +
        (m.message ? '<div class="m-body">' + U.esc(m.message) + '</div>' : '') +
        '<div class="m-meta">' +
          '<span>👤 ' + U.esc(m.adminName || '管理员') + '</span>' +
          '<span>🕒 发送于 ' + U.esc(U.fmtDT(m.createdAt)) + '</span>' +
          (ddl ? '<span style="color:' + (ddl.overdue ? 'var(--danger)' : 'var(--warn)') + '">⏳ ' +
            U.esc(ddl.text) + '（' + U.esc(ddl.at) + '）</span>' : '') +
        '</div>' +
        '<div class="m-acts">' +
          (m.unitId ? '<button class="btn btn-sm btn-primary" data-goto-unit="' + m.unitId + '" type="button">📖 去学习该章节</button>' : '') +
          (m.read ? '' : '<button class="btn btn-sm" data-read="' + m.targetId + '" type="button">标记已读</button>') +
          (m.done ? '' : '<button class="btn btn-sm btn-ok" data-done="' + m.targetId + '" type="button">✓ 我已完成</button>') +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* ═══════════════════ 视图：练习题 ═══════════════════ */

  V.exercises = {
    title: '练习题',
    icon: '✏️',
    nav: true,
    render: function (host) {
      host.innerHTML = U.loading('正在加载题库…');

      Promise.all([API.student.exercises(), loadTree().catch(function () { return { tree: [] }; })])
        .then(function (res) {
          var items = (res[0] && res[0].items) || [];
          var units = (res[1] && res[1].tree) || [];
          var unitMap = {};
          units.forEach(function (u) { unitMap[u.id] = u; });

          var answered = items.filter(function (q) { return q.answered; });
          var correct = answered.filter(function (q) { return q.correct; }).length;

          var html = '';
          html += '<div class="page-head">' +
            '<div><h2>✏️ 练习与自测</h2>' +
              '<div class="ph-sub">共 ' + items.length + ' 道题 · 已作答 ' + answered.length + ' 道</div></div>' +
            '<div class="ph-actions">' +
              '<select class="select" data-filter="unit" style="min-width:200px">' +
                '<option value="">全部题目</option>' +
                units.filter(function (u) { return u.checkable || u.level === 3; })
                  .slice(0, 600)
                  .map(function (u) {
                    return '<option value="' + u.id + '">' + U.esc(U.shortPath(u.title)) + '</option>';
                  }).join('') +
              '</select>' +
            '</div>' +
          '</div>';

          if (!items.length) {
            host.innerHTML = html + '<div class="panel"><div class="panel-body">' +
              U.empty('📝', '题库还没有题目', '老师还没有出题，先去把目录里的内容学完吧',
                '<button class="btn btn-primary" data-go="catalog" type="button">去学习</button>') +
              '</div></div>';
            return;
          }

          html += '<div class="stats-grid">' +
            statCard('📝', '题目总数', items.length, '题', '由老师按章节出题', '') +
            statCard('✅', '已作答', answered.length, '题', '剩余 ' + (items.length - answered.length) + ' 题', '') +
            statCard('🎯', '答对', correct, '题', '正确率 ' + (answered.length ? Math.round(correct / answered.length * 100) : 0) + '%', 'ok') +
            statCard('❌', '答错', answered.length - correct, '题', '可重新作答', 'danger') +
          '</div>';

          html += '<div style="display:flex;flex-direction:column;gap:16px" id="quizList">' +
            items.map(function (q, i) { return quizCard(q, i, unitMap); }).join('') +
          '</div>';

          host.innerHTML = html;

          // 章节筛选
          var sel = host.querySelector('[data-filter="unit"]');
          if (sel) {
            sel.addEventListener('change', function () {
              var v = sel.value;
              U.qsa('[data-quiz]', host).forEach(function (n) {
                n.hidden = !!v && n.dataset.unit !== v;
              });
            });
          }
        }).catch(function (e) {
          host.innerHTML = U.errorBox(e.message,
            '<button class="btn btn-primary" data-act="retry" type="button">重新加载</button>');
          var rb = host.querySelector('[data-act="retry"]');
          if (rb) rb.addEventListener('click', function () { V.exercises.render(host); });
        });
    },
  };

  function quizCard(q, i, unitMap) {
    var u = unitMap[q.unitId];
    var opts = Array.isArray(q.options) ? q.options : [];
    var html = '<div class="quiz" data-quiz="' + q.id + '" data-unit="' + (q.unitId || '') + '">' +
      '<div class="q-head">' +
        '<span class="q-no">第 ' + (i + 1) + ' 题</span>' +
        '<span class="chip xsmall">' + U.qType(q.type) + '</span>' +
        (q.difficulty ? U.diffChip(q.difficulty) : '') +
        '<span class="chip xsmall">' + (q.score || 5) + ' 分</span>' +
        (q.answered ? '<span class="chip ' + (q.correct ? 'd1' : 'd4') + ' xsmall">' +
          (q.correct ? '✓ 已答对' : '✗ 已答错') + '</span>' : '') +
        (u ? '<span class="chip xsmall dim">📖 ' + U.esc(U.trunc(u.title, 22)) + '</span>' : '') +
      '</div>' +
      '<div class="q-stem">' + U.esc(q.stem) + '</div>';

    if (q.type === 'single' || q.type === 'multiple' || q.type === 'judge') {
      var list = opts.length ? opts : (q.type === 'judge' ? [{ k: '1', t: '正确' }, { k: '0', t: '错误' }] : []);
      html += '<div class="q-opts" data-opts="' + q.type + '">' +
        list.map(function (o, oi) {
          var key = o && o.k != null ? o.k : String.fromCharCode(65 + oi);
          var txt = o && o.t != null ? o.t : String(o);
          return '<label class="q-opt" data-key="' + U.escAttr(key) + '">' +
            '<span class="k">' + U.esc(key) + '</span>' +
            '<span>' + U.esc(txt) + '</span>' +
          '</label>';
        }).join('') +
      '</div>';
    } else {
      html += '<div class="q-fill">' +
        '<input class="input" data-input="1" type="text" placeholder="' +
          (q.type === 'fill' ? '请输入答案' : '请输入你的作答要点') + '">' +
      '</div>';
    }

    html += '<div class="q-acts">' +
      '<button class="btn btn-primary btn-sm" data-submit="' + q.id + '" type="button">提交答案</button>' +
      '<button class="btn btn-sm" data-reset="' + q.id + '" type="button">重做</button>' +
      '</div>' +
      '<div class="q-res" data-res hidden></div>' +
    '</div>';
    return html;
  }

  /* ═══════════════════ 视图：我的资料 ═══════════════════ */

  V.profile = {
    title: '我的资料',
    icon: '🙍',
    nav: true,
    render: function (host) {
      var u = STORE.user || {};
      var html = '';
      html += '<div class="page-head">' +
        '<div><h2>🙍 我的资料</h2><div class="ph-sub">账号信息由管理员维护，如需修改请联系老师</div></div>' +
        '<div class="ph-actions"><button class="btn" data-act="pwd" type="button">🔑 修改密码</button></div>' +
      '</div>';

      html += '<div class="grid2">' +
        '<div class="panel">' +
          '<div class="panel-head"><h3>👤 基本信息</h3></div>' +
          '<div class="panel-body">' +
            '<div class="flex gap16 mb16">' +
              '<div class="avatar" style="width:62px;height:62px;font-size:25px">' +
                U.esc(U.initial(u.name, u.username)) + '</div>' +
              '<div>' +
                '<div class="bold" style="font-size:20px">' + U.esc(u.name || '—') + '</div>' +
                '<div class="dim">' + U.esc(u.username || '') + '</div>' +
              '</div>' +
            '</div>' +
            '<div class="info-grid">' +
              infoCell('学号', u.sno || '—') +
              infoCell('班级', u.className || '—') +
              infoCell('联系电话', u.phone || '—') +
              infoCell('上次登录', u.lastLoginAt ? U.fmtDT(u.lastLoginAt, true) : '首次登录') +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="panel">' +
          '<div class="panel-head"><h3>⚙️ 账号与偏好</h3></div>' +
          '<div class="panel-body">' +
            '<div style="display:flex;flex-direction:column;gap:12px">' +
              '<div class="between"><span>界面主题</span>' +
                '<button class="btn btn-sm" data-act="theme" type="button">🌗 ' +
                  (STORE.isDark ? '深蓝科技 → 切换为浅色' : '浅色纸张 → 切换为深蓝') + '</button></div>' +
              '<div class="between"><span>登录账号</span><span class="mono dim2">' + U.esc(u.username || '') + '</span></div>' +
              '<div class="between"><span>身份</span><span class="chip d2">学生</span></div>' +
              '<div class="hr" style="margin:6px 0"></div>' +
              '<button class="btn btn-danger" data-act="logout" type="button" style="align-self:flex-start">🚪 退出登录</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

      html += '<div class="panel">' +
        '<div class="panel-head"><h3>💡 学习小贴士</h3></div>' +
        '<div class="panel-body">' +
          '<div class="note tip"><span class="n-ico">🌱</span><span>' +
            '每天打卡 3~5 个知识点，比一次性学 50 个更有效。进度会实时同步到老师的后台，' +
            '老师可以看到你的每一点进步。' +
          '</span></div>' +
          '<div class="note info mt12"><span class="n-ico">↩️</span><span>' +
            '误打卡不用慌：在「我的打卡」或「学习目录」里点「撤销」即可，老师那边会看到「已撤销打卡」记录。' +
          '</span></div>' +
        '</div>' +
      '</div>';

      host.innerHTML = html;
    },
  };

  /* ═══════════════════ 交互绑定（事件委托） ═══════════════════ */

  function bindEvents() {
    var app = d.getElementById('app');
    if (!app || app.dataset.bound) return;
    app.dataset.bound = '1';

    /* ── 内容区点击 ── */
    app.addEventListener('click', function (e) {
      // 学生端与管理端共用 #app 作为事件根，用角色守卫隔离，
      // 避免同一属性名（如 data-toggle）在两个视图中互相干扰。
      if (STORE.user && STORE.user.role !== 'student') return;
      if (!STORE.user) return;

      var t = e.target;
      var closest = function (sel) { return t.closest && t.closest(sel); };

      // 打卡记录导出（超级会员专属：服务端生成 CSV / XLSX / PDF）
      var expBtn = closest('[data-export]');
      if (expBtn) {
        var MG = w.MemberGate;
        if (MG) {
          var fromEl = d.getElementById('expFrom');
          var toEl = d.getElementById('expTo');
          MG.exportRecords(expBtn.dataset.export, {
            from: fromEl && fromEl.value,
            to: toEl && toEl.value,
          });
        }
        return;
      }

      // 侧栏导航在 app.js 中处理；这里只处理视图内按钮
      // 顺序很重要：「查看内容」按钮位于 .tree-head 内部，必须先于 data-toggle 判定，
      // 否则点击按钮会被折叠逻辑吞掉。

      // 查看内容
      var openBtn = closest('[data-open]');
      if (openBtn) {
        var uid = Number(openBtn.dataset.open);
        var flat2 = (STORE.state.tree && STORE.state.tree.tree) || [];
        var found = null;
        for (var i = 0; i < flat2.length; i++) { if (flat2[i].id === uid) { found = flat2[i]; break; } }
        if (found) openUnit(found);
        else {
          // 不在当前用户的树里（例如督促指向的章节已被删）→ 用详情接口兜底
          openUnit({ id: uid, title: '学习内容', level: 3 });
        }
        return;
      }

      // 展开 / 收起
      var toggle = closest('[data-toggle]');
      if (toggle) {
        var id = Number(toggle.dataset.toggle);
        var nodeEl = app.querySelector('[data-node="' + id + '"]');
        var bodyEl = app.querySelector('[data-body="' + id + '"]');
        if (nodeEl && bodyEl) {
          var open = !S.expanded[id];
          S.expanded[id] = open;
          nodeEl.querySelector('.t-toggle').textContent = open ? '▾' : '▸';
          if (open) {
            if (!bodyEl.dataset.rendered) {
              var flat = (STORE.state.tree && STORE.state.tree.tree) || [];
              var idx = indexTree(flat);
              bodyEl.innerHTML = (idx.byParent[id] || []).map(function (c) {
                return renderNode(c, idx, (nodeEl.className.indexOf('lv1') >= 0 ? 2 : 3));
              }).join('') || '<div class="dim small tc" style="padding:10px">（暂无子目录）</div>';
              bodyEl.dataset.rendered = '1';
            }
            bodyEl.hidden = false;
          } else {
            bodyEl.hidden = true;
          }
        }
        return;
      }

      // 展开/收起全部
      if (closest('[data-act="expand-all"]')) {
        expandAll(app, true);
        return;
      }
      if (closest('[data-act="collapse-all"]')) {
        expandAll(app, false);
        return;
      }

      // 快捷打卡
      var ckBtn = closest('[data-checkin]');
      if (ckBtn) { e.stopPropagation(); doCheckin([Number(ckBtn.dataset.checkin)], ckBtn); return; }

      // 撤销打卡（单条）
      var rvBtn = closest('[data-revoke]');
      if (rvBtn) { e.stopPropagation(); doRevoke([Number(rvBtn.dataset.revoke)], rvBtn); return; }

      // 撤销当天全部
      var rvDay = closest('[data-revoke-day]');
      if (rvDay) {
        var day = rvDay.dataset.revokeDay;
        var ids = U.qsa('[data-day="' + day.replace(/"/g, '\\"') + '"] [data-rec]').map(function (n) {
          return Number(n.dataset.rec);
        });
        if (!ids.length) return;
        doRevoke(ids, rvDay, '撤销 ' + day + ' 的 ' + ids.length + ' 条打卡；');
        return;
      }

      // 跳转视图统一由 app.js 的全局委托处理（[data-go]）

      // 跳转到指定章节
      var gu = closest('[data-goto-unit]');
      if (gu) {
        var gid = Number(gu.dataset.gotoUnit);
        w.App.go('catalog');
        setTimeout(function () {
          var flat3 = (STORE.state.tree && STORE.state.tree.tree) || [];
          var target = null;
          for (var j = 0; j < flat3.length; j++) { if (flat3[j].id === gid) { target = flat3[j]; break; } }
          // 展开其所有祖先
          var cur = target;
          while (cur && cur.parentId != null) {
            S.expanded[cur.parentId] = true;
            var p = null;
            for (var k = 0; k < flat3.length; k++) { if (flat3[k].id === cur.parentId) { p = flat3[k]; break; } }
            cur = p;
          }
          V.catalog.render(d.getElementById('view'));
          setTimeout(function () {
            var el = d.querySelector('[data-unit="' + gid + '"]');
            if (el) { U.scrollTo(el); el.style.outline = '3px dashed var(--accent)'; setTimeout(function () { el.style.outline = ''; }, 1800); }
          }, 260);
        }, 120);
        return;
      }

      // 督促：标记已读 / 完成
      var rd = closest('[data-read]');
      if (rd) {
        var tid = Number(rd.dataset.read);
        API.student.readMessage(tid).then(function () {
          STORE.emit('unread-changed');
          V.refresh();
        }).catch(UI.errToast);
        return;
      }
      var dn = closest('[data-done]');
      if (dn) {
        var tid2 = Number(dn.dataset.done);
        var rs2 = UI.btnBusy(dn, '提交中…');
        API.student.doneMessage(tid2).then(function () {
          UI.toast('已标记为完成，老师那边能看到完成状态', 'ok', '完成督促');
          STORE.emit('unread-changed');
          V.refresh();
        }).catch(function (err) { UI.errToast(err); }).then(rs2);
        return;
      }

      // 小卡片点开督促详情
      var msgEl = closest('[data-msg]');
      if (msgEl && msgEl.classList.contains('msg')) {
        w.App.go('messages');
        return;
      }

      // 修改密码
      if (closest('[data-act="pwd"]')) { openPasswordDialog(); return; }

      // 主题
      if (closest('[data-act="theme"]')) { STORE.toggleTheme(); V.profile.render(d.getElementById('view')); return; }

      // 退出
      if (closest('[data-act="logout"]')) { w.App.logout(); return; }

      // 提交答案
      var sub = closest('[data-submit]');
      if (sub) { e.stopPropagation(); submitAnswer(sub); return; }

      // 重做
      var rst = closest('[data-reset]');
      if (rst) { e.stopPropagation(); resetQuiz(rst); return; }

      // 选项点选
      var opt = closest('.q-opt');
      if (opt) {
        var wrap = opt.closest('[data-opts]');
        if (wrap) {
          var isMulti = wrap.dataset.opts === 'multiple';
          var picked = opt.classList.contains('on');
          if (isMulti) opt.classList.toggle('on', !picked);
          else {
            U.qsa('.q-opt', wrap).forEach(function (n) { n.classList.remove('on'); });
            opt.classList.add('on');
          }
        }
        return;
      }

      // 重试
      var retry = closest('[data-act="retry"]');
      if (retry && retry.dataset.go === undefined) {
        V.refresh(true);
        return;
      }
    });

    /* ── 勾选框（打卡选择） ── */
    app.addEventListener('change', function (e) {
      var t = e.target;
      if (t && t.matches && t.matches('[data-pick]')) {
        var id = Number(t.dataset.pick);
        if (t.checked) STORE.picked.add(id); else STORE.picked.remove(id);
        var row = t.closest('.unit-row');
        if (row) row.classList.toggle('picked', t.checked);
      }
    });
  }

  function expandAll(app, open) {
    var host = d.getElementById('view');
    if (!host) return;
    if (!open) {
      S.expanded = {};
      S.noAutoExpand = true;
      STORE.emit('checkinbar', { view: 'catalog' });
      V.catalog.render(host);
      return;
    }
    S.noAutoExpand = true;
    var flat = (STORE.state.tree && STORE.state.tree.tree) || [];
    flat.forEach(function (n) { if (n.level <= 2) S.expanded[n.id] = true; });
    V.catalog.render(host);
    UI.toast('已展开全部主目录与次目录', 'info', null, 1800);
  }

  /* ───────── 打卡 / 撤销 ───────── */

  function doCheckin(ids, btn) {
    if (!ids.length) return;
    var rs = btn ? UI.btnBusy(btn, '打卡中…') : function () {};
    var date = S.barDate || U.today();
    API.student.checkin(ids, date).then(function (r) {
      UI.toast('已打卡 ' + r.count + ' 项（日期 ' + r.date + '）', 'ok', '打卡成功');
      STORE.picked.clear();
      STORE.invalidate('tree');
      STORE.emit('checkinbar');
      V.refresh(true);
    }).catch(function (e) { UI.errToast(e); }).then(rs);
  }

  function doRevoke(ids, btn, extra) {
    if (!ids.length) return;
    UI.confirm({
      title: '撤销打卡',
      message: (extra || '') + '确定撤销这 ' + ids.length + ' 项打卡吗？',
      detail: '撤销后进度会同步回退，老师的管理后台会记录一条「已撤销打卡」。',
      okText: '确定撤销',
      danger: true,
    }).then(function (ok) {
      if (!ok) return;
      var rs = btn ? UI.btnBusy(btn, '撤销中…') : function () {};
      API.student.revoke(ids).then(function (r) {
        UI.toast('已撤销 ' + r.count + ' 项打卡', 'warn', '撤销成功');
        STORE.picked.clear();
        STORE.invalidate('tree');
        STORE.emit('checkinbar');
        V.refresh(true);
      }).catch(function (e) { UI.errToast(e); }).then(rs);
    });
  }

  V.doCheckin = doCheckin;
  V.doRevoke = doRevoke;
  V.openUnit = openUnit;
  V.indexTree = indexTree;

  /* ───────── 修改密码 ───────── */
  function openPasswordDialog() {
    UI.modal({
      title: '修改密码',
      size: 'sm',
      body:
        '<div class="field"><label class="field-label">原密码</label>' +
          '<input class="input" id="pwdOld" type="password" autocomplete="current-password" placeholder="请输入当前密码"></div>' +
        '<div class="field"><label class="field-label">新密码</label>' +
          '<input class="input" id="pwdNew" type="password" autocomplete="new-password" placeholder="至少 6 位">' +
          '<div class="field-hint">建议使用字母 + 数字组合，避免与其他网站相同。</div></div>' +
        '<div class="field"><label class="field-label">确认新密码</label>' +
          '<input class="input" id="pwdNew2" type="password" autocomplete="new-password" placeholder="再次输入新密码"></div>' +
        '<div class="note warn"><span class="n-ico">⚠️</span><span>修改成功后当前登录会被注销，需要用新密码重新登录。</span></div>',
      foot: '<button class="btn" data-act="no" type="button">取消</button>' +
            '<button class="btn btn-primary" data-act="yes" type="button">确认修改</button>',
      onMount: function (m) {
        m.foot.querySelector('[data-act="no"]').addEventListener('click', function () { m.close(); });
        m.foot.querySelector('[data-act="yes"]').addEventListener('click', function () {
          var o = m.query('#pwdOld').value;
          var n1 = m.query('#pwdNew').value;
          var n2 = m.query('#pwdNew2').value;
          if (!o) return UI.err('请输入原密码');
          if (n1.length < 6) return UI.err('新密码至少 6 位');
          if (n1 !== n2) return UI.err('两次输入的新密码不一致');

          var btn = this;
          var rs = UI.btnBusy(btn, '提交中…');
          API.auth.password(o, n1).then(function () {
            m.close();
            UI.toast('密码已修改，请使用新密码重新登录', 'ok', '修改成功');
            setTimeout(function () { w.App.logout(); }, 900);
          }).catch(function (e) { UI.errToast(e); }).then(rs);
        });
      },
    });
  }

  /* ───────── 答题 ───────── */

  function submitAnswer(btn) {
    var qid = Number(btn.dataset.submit);
    var card = btn.closest('[data-quiz]');
    if (!card) return;

    var optsWrap = card.querySelector('[data-opts]');
    var answer = '';
    if (optsWrap) {
      var ons = U.qsa('.q-opt.on', optsWrap).map(function (n) { return n.dataset.key; });
      if (!ons.length) return UI.err('请先选择一个答案');
      answer = optsWrap.dataset.opts === 'multiple' ? ons.join('') : ons[0];
    } else {
      var inp = card.querySelector('[data-input]');
      answer = (inp && inp.value || '').trim();
      if (!answer) return UI.err('请先填写答案');
    }

    var rs = UI.btnBusy(btn, '判题中…');
    API.student.submitAnswer(qid, answer).then(function (r) {
      var res = card.querySelector('[data-res]');
      // 选项着色
      if (optsWrap) {
        var correctAns = String(r.answer || '').toUpperCase();
        U.qsa('.q-opt', optsWrap).forEach(function (n) {
          var k = String(n.dataset.key).toUpperCase();
          n.classList.remove('right', 'wrong');
          if (correctAns.indexOf(k) >= 0) n.classList.add('right');
          else if (n.classList.contains('on')) n.classList.add('wrong');
        });
      }
      res.hidden = false;
      res.className = 'q-res ' + (r.correct ? 'ok' : 'no');
      res.innerHTML = (r.correct ? '✅ 回答正确！' : '❌ 回答错误') +
        '<div style="margin-top:6px">正确答案：<b>' + U.esc(r.answer) + '</b></div>' +
        (r.analysis ? '<div style="margin-top:6px">📖 解析：' + U.esc(r.analysis) + '</div>' : '');

      UI.toast(r.correct ? '回答正确，继续保持！' : '答案已提交，看看解析吧',
        r.correct ? 'ok' : 'warn', r.correct ? '答对了' : '答错了');
    }).catch(function (e) { UI.errToast(e); }).then(rs);
  }

  function resetQuiz(btn) {
    var card = btn.closest('[data-quiz]');
    if (!card) return;
    U.qsa('.q-opt', card).forEach(function (n) { n.classList.remove('on', 'right', 'wrong'); });
    var inp = card.querySelector('[data-input]');
    if (inp) inp.value = '';
    var res = card.querySelector('[data-res]');
    if (res) { res.hidden = true; res.innerHTML = ''; }
  }

  /* ───────── 刷新当前视图 ───────── */
  V.refresh = function (force) {
    var host = d.getElementById('view');
    var name = STORE.state.view;
    var def = V[name];
    if (!host || !def || typeof def.render !== 'function') return;
    if (force) STORE.invalidate('tree');
    def.render(host);
  };

  /* ───────── 导出 ───────── */
  V.bindEvents = bindEvents;
  V.state = S;
  V.KEYS = ['dashboard', 'catalog', 'records', 'messages', 'exercises', 'profile'];

  w.StudentView = V;
})(window, document);
