/* ══════════════════════════════════════════════════════════════════
   views/learn.js · 学习内容视图（课程学习 / 命令大全 / 实用技巧）
   ──────────────────────────────────────────────────────────────────
   融合说明：
     原独立「Linux 学习平台」是一个自带静态 JSON 内容的深色单页应用，
     打卡记录通过 bridge.js 回写后端。融合后不再保留独立站点，
     内容与进度统一由后端 units 表提供（三级索引 + 正文按需拉取），
     因此本文件只负责「渲染 + 交互」，不持有任何内容副本。

   数据来源：
     GET /api/tree?maxLevel=3   → 主目录 / 次目录 / 学习目录 三级索引
     GET /api/units/:id         → 某个学习目录的正文块（进入时才拉）
   权限：节点自带 locked / isFree；被锁节点点击弹「会员定价」。
   ══════════════════════════════════════════════════════════════════ */
(function (w, d) {
  'use strict';

  var U = w.U;
  var UI = w.UI;
  var API = w.API;
  var STORE = w.STORE;

  var LV = {};

  /* ═══════════════════ 视图内状态 ═══════════════════ */

  var S = {
    idx: null,
    idxAt: 0,
    loading: null,
    tut: null,          // 当前打开的教程节点 id（null = 显示课程列表）
    cmdQ: '',           // 命令搜索词
    cmdCat: '',         // 命令分类（'' = 全部）
    cmdPage: 1,
    tipQ: '',
  };

  var PAGE = 60;                 // 命令表格每页条数
  var IDX_TTL = 60000;           // 索引缓存有效期
  var KINDS = ['course', 'cmds', 'tips'];
  var KIND_CN = { course: '课程学习', cmds: '命令大全', tips: '实用技巧' };

  /* ═══════════════════ 工具 ═══════════════════ */

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function isSuper() {
    var MG = w.MemberGate;
    return !!(MG && (typeof MG.isSuper === 'function' ? MG.isSuper() : (MG.member && MG.member.isSuper)));
  }

  function lockToast() {
    var MG = w.MemberGate;
    UI.toast(MG && MG.MSG ? MG.MSG.LOCKED
      : '你还未开通超级会员，请联系管理员开通后进行学习！',
      'warn', '🔒 内容已锁定', 3600);
    if (MG && MG.openPricing) MG.openPricing();
  }

  /** 被锁节点：提示 + 弹定价，返回 true 表示已拦截 */
  function guardLocked(node) {
    if (!node || !node.locked) return false;
    lockToast();
    return true;
  }

  function chip(text, cls) {
    return '<span class="chip' + (cls ? ' ' + cls : '') + '">' + text + '</span>';
  }

  function doneChip(node) {
    if (!node || !node.checkable) return '';
    return node.done ? chip('✓ 已打卡', 'd1') : chip('○ 未打卡');
  }

  function lockChip(node) {
    return node && node.locked ? chip('🔒 未解锁', 'd4') : '';
  }

  function barHtml(done, total, cls) {
    var p = U.pct(done, total);
    return '<div class="bar-line">' +
      '<div class="bar ' + (cls || U.pctClass(p)) + '"><i style="width:' + p + '%"></i></div>' +
      '<span class="bar-pct">' + U.pctText(p) + '</span>' +
    '</div>';
  }

  function statCard(ico, label, val, unit, foot, cls) {
    return '<div class="stat-card ' + (cls || '') + '">' +
      '<div class="s-top"><span class="s-ico">' + ico + '</span><span>' + U.esc(label) + '</span></div>' +
      '<div class="s-num">' + U.esc(val) + (unit ? '<small>' + U.esc(unit) + '</small>' : '') + '</div>' +
      '<div class="s-foot">' + U.esc(foot) + '</div>' +
    '</div>';
  }

  function retryBox(host, err, retry) {
    host.innerHTML = U.errorBox(err && err.message,
      '<button class="btn btn-primary" data-act="retry" type="button">重新加载</button>');
    var rb = host.querySelector('[data-act="retry"]');
    if (rb) rb.addEventListener('click', retry);
  }

  function isLockError(e) {
    return !!(e && (e.code === 'LOCKED' || e.needMember || e.status === 403));
  }

  /* ═══════════════════ 索引：拉取 + 归类 ═══════════════════ */

  function loadIndex(force) {
    if (!force && S.idx && Date.now() - S.idxAt < IDX_TTL) return Promise.resolve(S.idx);
    if (S.loading) return S.loading;

    S.loading = API.student.tree({ maxLevel: 3 }).then(function (r) {
      S.idx = buildIndex((r && r.tree) || []);
      S.idxAt = Date.now();
      S.loading = null;
      return S.idx;
    }).catch(function (e) {
      S.loading = null;
      throw e;
    });
    return S.loading;
  }

  /**
   * 把扁平的三级索引整理成 { mains, groups, units, byId, byParent }，
   * 并给每个节点标注 kind（course / cmds / tips）。
   *
   * 归类策略：先看主目录标题里的关键词，识别不出来的按顺序补齐；
   * 这样即使管理员改了主目录名字，也不会整体错位。
   */
  function buildIndex(flat) {
    var byId = {}, byParent = {};

    flat.forEach(function (n) {
      byId[n.id] = n;
      var p = n.parentId == null ? 0 : n.parentId;
      if (!byParent[p]) byParent[p] = [];
      byParent[p].push(n);
    });

    var mains = flat.filter(function (n) { return n.level === 1; });
    var used = {};

    mains.forEach(function (m) {
      var t = String(m.title || '');
      var k = null;
      if (/命令|速查|command/i.test(t)) k = 'cmds';
      else if (/技巧|tips?/i.test(t)) k = 'tips';
      else if (/教程|课程|系统学习|入门|学习/i.test(t)) k = 'course';
      if (k && used[k]) k = null;          // 同一类主目录只认第一个
      if (k) { m.kind = k; used[k] = m; }
    });

    mains.forEach(function (m) {
      if (m.kind) return;
      for (var i = 0; i < KINDS.length; i++) {
        if (!used[KINDS[i]]) { m.kind = KINDS[i]; used[KINDS[i]] = m; return; }
      }
      m.kind = 'course';
    });

    // 逐级上溯继承 kind（树最多 4 级，不需要递归 CTE）
    function kindOf(id) {
      var n = byId[id], guard = 0;
      while (n && n.level > 1 && guard++ < 8) n = byId[n.parentId];
      return n && n.kind ? n.kind : null;
    }
    flat.forEach(function (n) { n.kind = kindOf(n.id); });

    return {
      flat: flat,
      byId: byId,
      byParent: byParent,
      mains: mains,
      groups: flat.filter(function (n) { return n.level === 2; }),
      units: flat.filter(function (n) { return n.level === 3; }),
    };
  }

  function mainOf(idx, kind) {
    for (var i = 0; i < idx.mains.length; i++) {
      if (idx.mains[i].kind === kind) return idx.mains[i];
    }
    return null;
  }

  function groupsOf(idx, kind) {
    var m = mainOf(idx, kind);
    if (!m) return [];
    return (idx.byParent[m.id] || []).filter(function (n) { return n.level === 2; });
  }

  function unitsOf(idx, kind) {
    return idx.units.filter(function (n) { return n.kind === kind; });
  }

  function groupNameOf(idx, node) {
    var g = idx && node ? idx.byId[node.parentId] : null;
    return g ? g.title : '';
  }

  /* ═══════════════════ 正文：把 4 级块拼回连贯文章 ═══════════════════
     后端把教程拆成了细粒度块（章节标题 / 正文 / 代码 / 表格 / 要点 / 提示），
     这里按顺序重新拼成「读起来像一篇文章」的样子，而不是一串独立面板。 */

  function artHtml(children) {
    var out = '';
    var i = 0, n = children.length;

    while (i < n) {
      var c = children[i];
      var title = String(c.title || '');

      if (title.indexOf('【章节】') === 0) {
        out += '<h3 class="blk-h"><span class="bh-bar"></span>' +
          U.esc(title.slice(4)) + '</h3>';
        i++;
        continue;
      }

      var ct = c.contentType;
      if (ct === 'code') { out += U.renderCode(c.body, c.lang || 'bash'); i++; continue; }
      if (ct === 'table') { out += U.renderBody('table', c.body, { title: title }); i++; continue; }
      if (ct === 'list') { out += U.renderBody('list', c.body); i++; continue; }
      if (ct === 'note') { out += U.renderBody('note', c.body); i++; continue; }
      if (ct === 'cmd') { out += U.renderCmdCard({ example: c.example, summary: c.summary }); i++; continue; }

      // 连续正文合并渲染，避免一段一个盒子
      var buf = [], before = i;
      while (i < n) {
        var k = children[i];
        if (k.contentType !== 'text') break;
        if (String(k.title || '').indexOf('【章节】') === 0) break;
        if (k.body) buf.push(String(k.body));
        i++;
      }
      if (buf.length) {
        out += '<div class="content-body">' + buf.map(function (p) {
          return '<p>' + U.esc(p).replace(/\n/g, '<br>') + '</p>';
        }).join('') + '</div>';
      } else if (i === before) {
        i++;   // 兜底：跳过无法识别的块，避免死循环
      }
    }

    return out || U.empty('📭', '本讲暂无正文', '请联系管理员在后台「目录内容」中补充');
  }

  /* ═══════════════════ 视图：课程学习 ═══════════════════ */

  LV.course = {
    title: '课程学习',
    icon: '📖',
    nav: true,
    render: function (host) {
      if (S.tut) { renderTut(host, S.tut); return; }

      host.innerHTML = U.loading('正在加载课程目录…');
      loadIndex().then(function (idx) {
        var tuts = unitsOf(idx, 'course');
        var groups = groupsOf(idx, 'course');
        var done = tuts.filter(function (t) { return t.done; }).length;
        var locked = tuts.filter(function (t) { return t.locked; }).length;

        var html = '';

        html += '<div class="page-head">' +
          '<div>' +
            '<h2>📖 课程学习</h2>' +
            '<div class="ph-sub">共 <b class="num">' + tuts.length + '</b> 讲 · 已学完 ' +
              '<b class="num">' + done + '</b> 讲 · 点开任意一讲即可阅读，读完直接打卡</div>' +
          '</div>' +
          '<div class="ph-actions">' +
            '<button class="btn" data-go="cmds" type="button">⌨️ 命令大全</button>' +
            '<button class="btn" data-go="tips" type="button">💡 实用技巧</button>' +
          '</div>' +
        '</div>';

        html += '<div class="stats-grid">' +
          statCard('📚', '课程总进度', U.pctText(U.pct(done, tuts.length)), '',
            '共 ' + tuts.length + ' 讲，已学完 ' + done + ' 讲', 'accent') +
          statCard('✅', '已学完', U.num(done), '讲',
            '剩余 ' + Math.max(0, tuts.length - done) + ' 讲', 'ok') +
          statCard('🗂️', '课程分组', U.num(groups.length), '组',
            '按学习阶段循序推进', '') +
          (locked ? statCard('🔒', '未解锁', U.num(locked), '讲',
            '开通超级会员后可学习', 'warn') : '') +
        '</div>';

        if (!tuts.length) {
          html += '<div class="panel"><div class="panel-body">' +
            U.empty('📭', '暂无课程内容', '请联系管理员在后台「目录内容」中补充') +
          '</div></div>';
          host.innerHTML = html;
          return;
        }

        html += '<div class="lv-groups">';
        groups.forEach(function (g) {
          var arr = (idx.byParent[g.id] || []).filter(function (n) { return n.level === 3; });
          if (!arr.length) return;
          var gd = arr.filter(function (t) { return t.done; }).length;

          html += '<section class="panel">' +
            '<div class="panel-head">' +
              '<h3>' + U.esc(g.title) + '</h3>' +
              chip('<b class="num">' + arr.length + '</b> 讲', 'd2') +
              (arr.length && gd === arr.length ? chip('✓ 已全部学完', 'd1') : '') +
              (g.locked ? chip('🔒 未解锁', 'd4') : '') +
              '<div class="ph-tools">' +
                '<span class="dim xsmall num">' + gd + ' / ' + arr.length + '</span>' +
              '</div>' +
            '</div>' +
            '<div class="panel-body tight">' +
              '<div class="lv-gbar">' + barHtml(gd, arr.length) + '</div>' +
              '<div class="list">' +
                arr.map(function (t, i) {
                  /* 注意：不能用 data-done —— student.js 的督促视图用 [data-done]
                     表示「完成督促」，共用 #app 事件根会互相误触发，故用 data-lv-done */
                  return '<div class="list-row lv-tut"' +
                      (t.done ? ' data-lv-done="1"' : '') + '>' +
                    '<span class="lv-no num">' + pad(i + 1) + '</span>' +
                    '<div class="l-main">' +
                      '<div class="l-title">' + U.esc(t.title) +
                        (t.difficulty ? U.diffChip(t.difficulty) : '') +
                        doneChip(t) + lockChip(t) +
                      '</div>' +
                      (t.summary ? '<div class="l-sub">' + U.esc(t.summary) + '</div>' : '') +
                    '</div>' +
                    '<div class="l-right">' +
                      '<button class="btn btn-sm' + (t.done || t.locked ? '' : ' btn-primary') + '" ' +
                        'data-lv-tut="' + t.id + '" type="button">' +
                        (t.locked ? '🔒 未解锁' : (t.done ? '复习' : '开始学习')) +
                      '</button>' +
                    '</div>' +
                  '</div>';
                }).join('') +
              '</div>' +
            '</div>' +
          '</section>';
        });
        html += '</div>';

        host.innerHTML = html;
      }).catch(function (e) {
        retryBox(host, e, function () { LV.course.render(host); });
      });
    },
  };

  /* ── 教程阅读器 ── */

  function renderTut(host, id) {
    host.innerHTML = U.loading('正在加载本讲内容…');

    API.student.unit(id).then(function (r) {
      var u = r.unit || {};
      var kids = r.children || [];
      var ck = r.checkin || {};
      var idx = S.idx;

      // 同组其他讲 → 上一讲 / 下一讲
      var sibs = idx ? (idx.byParent[u.parentId] || []).filter(function (n) {
        return n.level === 3;
      }) : [];
      var pos = -1;
      for (var i = 0; i < sibs.length; i++) { if (sibs[i].id === u.id) { pos = i; break; } }
      var prev = pos > 0 ? sibs[pos - 1] : null;
      var next = pos >= 0 && pos < sibs.length - 1 ? sibs[pos + 1] : null;

      var heads = kids.filter(function (k) {
        return String(k.title || '').indexOf('【章节】') === 0;
      });
      var mins = Math.max(3, Math.round(kids.length * 0.7));
      var gname = groupNameOf(idx, u);

      var html = '';

      // 面包屑
      html += '<div class="crumbs lv-crumbs">' +
        '<button type="button" data-lv-tutback>📖 课程学习</button>' +
        '<span class="sep">›</span>' +
        '<span>' + U.esc(gname || '教程') + '</span>' +
        '<span class="sep">›</span>' +
        '<span>' + U.esc(u.title || '') + '</span>' +
      '</div>';

      // 页头
      html += '<div class="page-head">' +
        '<div>' +
          '<h2>' + U.esc(u.title || '') + '</h2>' +
          (u.summary ? '<div class="ph-sub">' + U.esc(u.summary) + '</div>' : '') +
          '<div class="chips-row mt12">' +
            (u.difficulty ? U.diffChip(u.difficulty) : '') +
            chip('📄 内容块 <b class="num">' + kids.length + '</b>') +
            chip('🕒 约 <b class="num">' + mins + '</b> 分钟') +
            (ck.done ? chip('✅ ' + U.esc(ck.date || '') + ' 已打卡', 'd1') : chip('○ 未打卡')) +
          '</div>' +
        '</div>' +
        '<div class="ph-actions">' +
          '<button class="btn" data-lv-tutback type="button">← 返回目录</button>' +
          (next ? '<button class="btn" data-lv-tut="' + next.id + '" type="button">下一讲 →</button>' : '') +
        '</div>' +
      '</div>';

      // 本讲目录
      if (heads.length > 1) {
        html += '<div class="panel lv-toc">' +
          '<div class="panel-head"><h3>📑 本讲目录</h3>' +
            chip('<b class="num">' + heads.length + '</b> 节') +
          '</div>' +
          '<div class="panel-body tight">' +
            '<div class="chips-row">' +
              heads.map(function (h, i) {
                return '<span class="lv-toc-item">' +
                  '<b class="num">' + pad(i + 1) + '</b>' +
                  U.esc(String(h.title || '').slice(4)) + '</span>';
              }).join('') +
            '</div>' +
          '</div>' +
        '</div>';
      }

      // 正文
      html += '<article class="panel lv-art"><div class="panel-body art">' +
        artHtml(kids) + '</div></article>';

      // 底栏：打卡 + 上下讲
      html += '<div class="panel lv-foot">' +
        '<div class="flex wrap gap16" style="align-items:center">' +
          '<div class="grow" style="min-width:220px">' +
            '<div class="bold">学完了吗？</div>' +
            '<div class="dim small mt8">把本讲标记为「已完成」，老师的管理后台会立刻看到你的进度。</div>' +
          '</div>' +
          '<div class="flex gap12 wrap">' +
            (prev ? '<button class="btn" data-lv-tut="' + prev.id + '" type="button">← 上一讲</button>' : '') +
            (ck.done
              ? '<button class="btn btn-danger" data-lv-rv="' + u.id + '" type="button">↩️ 撤销本讲打卡</button>'
              : '<button class="btn btn-primary" data-lv-ck="' + u.id + '" type="button">✓ 完成本讲打卡</button>') +
            (next ? '<button class="btn" data-lv-tut="' + next.id + '" type="button">下一讲 →</button>' : '') +
          '</div>' +
        '</div>' +
      '</div>';

      host.innerHTML = html;
      try { w.scrollTo({ top: 0, behavior: 'auto' }); } catch (e) { w.scrollTo(0, 0); }
    }).catch(function (e) {
      if (isLockError(e)) {
        host.innerHTML = lockPage('本讲需要超级会员才能阅读', 'course');
        return;
      }
      retryBox(host, e, function () { renderTut(host, id); });
    });
  }

  /** 被锁章节的整页提示 */
  function lockPage(text, goKey) {
    return '<div class="crumbs lv-crumbs">' +
        '<button type="button" data-go="' + (goKey || 'course') + '">' +
          '📖 ' + U.esc(KIND_CN[goKey] || '返回') + '</button>' +
        '<span class="sep">›</span><span>未解锁</span>' +
      '</div>' +
      '<div class="panel"><div class="panel-body">' +
        U.empty('🔒', text,
          '开通超级会员后可学习全部章节、进行学习打卡、使用练习题与导出功能',
          '<button class="btn btn-primary" data-lv-pricing type="button">💎 查看会员定价</button>' +
          '<button class="btn" data-go="' + (goKey || 'course') + '" type="button" ' +
            'style="margin-left:9px">返回</button>') +
      '</div></div>';
  }

  /* ═══════════════════ 视图：命令大全 ═══════════════════ */

  LV.cmds = {
    title: '命令大全',
    icon: '⌨️',
    nav: true,
    render: function (host) {
      host.innerHTML = U.loading('正在加载命令库…');
      loadIndex().then(function (idx) {
        var all = unitsOf(idx, 'cmds');
        var catNodes = groupsOf(idx, 'cmds');

        // 分类被删除时兜底回「全部」
        if (S.cmdCat && !catNodes.some(function (c) { return c.title === S.cmdCat; })) S.cmdCat = '';

        var done = all.filter(function (c) { return c.done; }).length;

        var html = '<div class="page-head">' +
          '<div>' +
            '<h2>⌨️ 命令大全</h2>' +
            '<div class="ph-sub">共 <b class="num">' + all.length + '</b> 条命令，覆盖 ' +
              catNodes.length + ' 个分类 · 已掌握 <b class="num">' + done + '</b> 条 · ' +
              '点命令名看完整用法，点举例即可复制</div>' +
          '</div>' +
          '<div class="ph-actions">' +
            '<button class="btn" data-go="course" type="button">📖 课程学习</button>' +
            '<button class="btn" data-go="tips" type="button">💡 实用技巧</button>' +
          '</div>' +
        '</div>';

        html += '<div class="stats-grid">' +
          statCard('📦', '命令总数', U.num(all.length), '条', '按 ' + catNodes.length + ' 个分类整理', 'accent') +
          statCard('✅', '已掌握', U.num(done), '条',
            all.length ? '掌握率 ' + U.pctText(U.pct(done, all.length)) : '暂无数据', 'ok') +
        '</div>';

        if (!all.length) {
          html += '<div class="panel"><div class="panel-body">' +
            U.empty('📭', '暂无命令数据', '请联系管理员在后台「目录内容」中补充') +
          '</div></div>';
          host.innerHTML = html;
          return;
        }

        // 分类标签
        html += '<div class="lv-cats">' +
          '<button class="lv-cat' + (S.cmdCat ? '' : ' on') + '" type="button" ' +
            'data-lv-cat=""><span class="lc-t">🗂️ 全部</span>' +
            '<b class="num">' + all.length + '</b></button>' +
          catNodes.map(function (c) {
            var arr = (idx.byParent[c.id] || []).filter(function (n) { return n.level === 3; });
            var d = arr.filter(function (x) { return x.done; }).length;
            if (!arr.length) return '';
            return '<button class="lv-cat' + (S.cmdCat === c.title ? ' on' : '') + '" ' +
              'type="button" data-lv-cat="' + U.escAttr(c.title) + '">' +
              '<span class="lc-t">' + U.esc(c.title) + '</span>' +
              '<b class="num">' + arr.length + '</b>' +
              (d ? '<i class="lc-d">✓' + d + '</i>' : '') +
              (c.locked ? '<i class="lc-l">🔒</i>' : '') +
            '</button>';
          }).join('') +
        '</div>';

        // 搜索
        html += '<div class="filters lv-filters">' +
          '<span class="fl-label">搜索</span>' +
          '<input class="input lv-search" type="search" data-lv-q ' +
            'placeholder="命令名 / 说明 / 举例，例如 chmod、压缩、权限" ' +
            'value="' + U.escAttr(S.cmdQ) + '" autocomplete="off">' +
          '<button class="btn btn-sm" data-lv-qclear type="button">清空</button>' +
          '<span class="spacer"></span>' +
          '<span class="dim small" data-lv-count></span>' +
        '</div>';

        html += '<div class="panel"><div class="panel-body flush"><div data-lv-cmdbody></div></div></div>';

        host.innerHTML = html;

        var box = host.querySelector('[data-lv-cmdbody]');
        var cnt = host.querySelector('[data-lv-count]');
        paintCmds(box, cnt, idx, all);

        U.qsa('[data-lv-cat]', host).forEach(function (b) {
          b.addEventListener('click', function () {
            S.cmdCat = b.dataset.lvCat || '';
            S.cmdPage = 1;
            U.qsa('[data-lv-cat]', host).forEach(function (x) { x.classList.toggle('on', x === b); });
            paintCmds(box, cnt, idx, all);
          });
        });

        // 输入即筛：只重绘表格，避免输入框失焦
        var inp = host.querySelector('[data-lv-q]');
        if (inp) {
          inp.addEventListener('input', U.debounce(function () {
            S.cmdQ = inp.value.trim();
            S.cmdPage = 1;
            paintCmds(box, cnt, idx, all);
          }, 180));
        }
        var clr = host.querySelector('[data-lv-qclear]');
        if (clr) clr.addEventListener('click', function () {
          if (inp) inp.value = '';
          S.cmdQ = ''; S.cmdPage = 1;
          paintCmds(box, cnt, idx, all);
          if (inp) inp.focus();
        });
      }).catch(function (e) {
        retryBox(host, e, function () { LV.cmds.render(host); });
      });
    },
  };

  /** 按分类 + 关键词筛选 */
  function filterCmds(all, idx) {
    var catId = null;
    if (S.cmdCat) {
      for (var i = 0; i < idx.groups.length; i++) {
        var g = idx.groups[i];
        if (g.kind === 'cmds' && g.title === S.cmdCat) { catId = g.id; break; }
      }
    }
    var q = S.cmdQ.toLowerCase();
    return all.filter(function (c) {
      if (catId != null && c.parentId !== catId) return false;
      if (!q) return true;
      return String(c.title || '').toLowerCase().indexOf(q) >= 0 ||
             String(c.summary || '').toLowerCase().indexOf(q) >= 0 ||
             String(c.example || '').toLowerCase().indexOf(q) >= 0;
    });
  }

  /** 只重绘表格 + 分页 + 命中数 */
  function paintCmds(box, cnt, idx, all) {
    if (!box) return;
    var list = filterCmds(all, idx);
    var pages = Math.max(1, Math.ceil(list.length / PAGE));
    if (S.cmdPage > pages) S.cmdPage = pages;
    if (S.cmdPage < 1) S.cmdPage = 1;

    if (cnt) {
      cnt.innerHTML = '命中 <b class="num">' + list.length + '</b> 条' +
        (S.cmdCat ? ' · 分类「' + U.esc(S.cmdCat) + '」' : '');
    }

    if (!list.length) {
      box.innerHTML = U.empty('🔍', '没有匹配的命令', '换个关键词，或切回「全部」分类');
      return;
    }

    var rows = list.slice((S.cmdPage - 1) * PAGE, S.cmdPage * PAGE);

    box.innerHTML =
      '<div class="tbl-wrap"><table class="tbl lv-cmdtbl">' +
        '<thead><tr>' +
          '<th style="width:158px">命令</th>' +
          '<th style="width:26%">说明</th>' +
          '<th>举例（点击复制）</th>' +
          '<th style="width:118px">掌握</th>' +
        '</tr></thead><tbody>' +
        rows.map(function (c) {
          return '<tr' + (c.done ? ' class="row-done"' : '') + '>' +
            '<td>' +
              '<button class="lv-cmdname mono" type="button" data-lv-cmd="' + c.id + '">' +
                U.esc(c.title) + '</button>' +
              (c.difficulty ? '<div class="mt8">' + U.diffChip(c.difficulty) + '</div>' : '') +
            '</td>' +
            '<td>' + U.esc(c.summary || '—') + '</td>' +
            '<td>' + (c.example
              ? '<button class="lv-ex mono" type="button" data-lv-cp="' + U.escAttr(c.example) + '" ' +
                  'title="点击复制">' + U.esc(c.example) + '</button>'
              : '<span class="dim">—</span>') + '</td>' +
            '<td class="nowrap">' +
              (c.checkable
                ? (c.done ? chip('✓ 已掌握', 'd1')
                          : '<button class="btn btn-sm" data-lv-ck="' + c.id + '" type="button">记住打卡</button>')
                : '<span class="dim">—</span>') +
            '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table></div>' +
      pagerHtml(list.length, S.cmdPage, pages, 'cmd');

    U.qsa('[data-lv-page]', box).forEach(function (b) {
      b.addEventListener('click', function () {
        var p = Number(b.dataset.lvPage) || 1;
        if (p === S.cmdPage) return;
        S.cmdPage = p;
        paintCmds(box, cnt, idx, all);
        U.scrollTo(box, 140);
      });
    });
  }

  /** 分页器 */
  function pagerHtml(total, page, pages, scope) {
    if (pages <= 1) return '<div class="lv-pager"><span class="pg-info">共 ' + total + ' 条</span></div>';

    var s = Math.max(1, page - 2), e = Math.min(pages, s + 4);
    s = Math.max(1, e - 4);

    function btn(p, label, disable, on) {
      return '<button type="button" class="pg-btn' + (on ? ' on' : '') + '"' +
        (disable ? ' disabled' : '') + ' data-lv-page="' + p + '">' + label + '</button>';
    }

    var html = '<div class="lv-pager" data-lv-pager="' + U.escAttr(scope) + '">';
    html += btn(1, '«', page <= 1);
    html += btn(Math.max(1, page - 1), '‹', page <= 1);
    for (var i = s; i <= e; i++) html += btn(i, String(i), false, i === page);
    html += btn(Math.min(pages, page + 1), '›', page >= pages);
    html += btn(pages, '»', page >= pages);
    html += '<span class="pg-info">第 ' + page + ' / ' + pages + ' 页 · 共 ' + total + ' 条</span>';
    html += '</div>';
    return html;
  }

  /* ── 详情弹层（命令与技巧共用） ── */

  function openDetail(nodeId) {
    var mod = UI.modal({
      title: '加载中…',
      size: 'lg',
      body: U.loading('正在加载详情…'),
      foot: '<button class="btn" data-act="close" type="button">关闭</button>',
      onMount: function (m) {
        m.foot.querySelector('[data-act="close"]').addEventListener('click', function () { m.close(); });
      },
    });

    API.student.unit(nodeId).then(function (r) {
      var u = r.unit || {};
      var kids = r.children || [];
      var ck = r.checkin || {};

      /* 分类：简介(text) / 语法(code，标题含“语法”) / 参数(table) / 实例(其余 code) / 其他 */
      var intro = null, syntax = null, params = [], examples = [], extras = [];
      kids.forEach(function (k) {
        var t = String(k.title || '');
        if (k.contentType === 'code' && t.indexOf('语法') >= 0 && !syntax) { syntax = k; return; }
        if (k.contentType === 'code') { examples.push(k); return; }
        if (k.contentType === 'table') { params.push(k); return; }
        if (k.contentType === 'text' && !intro) { intro = k; return; }
        extras.push(k);
      });

      var html = '';

      html += '<div class="chips-row mb16">' +
        chip('📁 ' + U.esc(groupNameOf(S.idx, u) || '命令')) +
        (u.difficulty ? U.diffChip(u.difficulty) : '') +
        chip('📄 <b class="num">' + kids.length + '</b> 个说明块') +
        (ck.done ? chip('✅ 已掌握 · ' + U.esc(ck.date || ''), 'd1') : chip('○ 未掌握')) +
      '</div>';

      if (u.summary) {
        html += '<div class="content-body mb16" style="font-size:16.5px"><p>' +
          U.esc(u.summary) + '</p></div>';
      }

      if (intro && intro.body) {
        html += '<div class="card-sect"><div class="cs-h">📘 ' + U.esc(intro.title || '简介') + '</div>' +
          '<div class="content-body">' + String(intro.body).split(/\n{2,}/).map(function (p) {
            return '<p>' + U.esc(p).replace(/\n/g, '<br>') + '</p>';
          }).join('') + '</div></div>';
      }

      if (syntax && syntax.body) {
        html += '<div class="card-sect"><div class="cs-h">🧩 语法</div>' +
          U.renderCode(syntax.body, 'bash') + '</div>';
      }

      if (params.length) {
        html += '<div class="card-sect"><div class="cs-h">🔧 参数与选项</div>';
        params.forEach(function (p) { html += U.renderBody('table', p.body, { title: p.title }); });
        html += '</div>';
      }

      if (examples.length) {
        html += '<div class="card-sect"><div class="cs-h">💡 使用实例（' + examples.length + '）</div>';
        examples.forEach(function (ex) {
          if (ex.title && !/^实例/.test(ex.title)) {
            html += '<div class="ex-h">' + U.esc(ex.title) + '</div>';
          }
          html += U.renderCode(ex.body, 'bash');
        });
        html += '</div>';
      } else if (u.example) {
        html += '<div class="card-sect"><div class="cs-h">💡 参考用法</div>' +
          U.renderCode(u.example, 'bash') + '</div>';
      }

      extras.forEach(function (k) {
        var b = k.body;
        if (!b) return;
        html += '<div class="card-sect"><div class="cs-h">📄 ' + U.esc(k.title || '补充') + '</div>' +
          (k.contentType === 'code'
            ? U.renderCode(b, 'bash')
            : k.contentType === 'list' || k.contentType === 'note' || k.contentType === 'table'
              ? U.renderBody(k.contentType, b, { title: k.title })
              : '<div class="content-body"><p>' + U.esc(b).replace(/\n/g, '<br>') + '</p></div>') +
        '</div>';
      });

      // 打卡
      html += '<div class="card-sect mb0"><div class="cs-h">✅ 打卡</div>' +
        '<div class="flex wrap gap16" style="align-items:center">' +
          '<div class="grow dim small" style="min-width:200px">' +
            '标记为「已掌握」，老师的管理后台会同步看到你的进度。</div>' +
          (ck.done
            ? '<button class="btn btn-danger" data-lv-rv="' + u.id + '" type="button">↩️ 撤销打卡</button>'
            : '<button class="btn btn-primary" data-lv-ck="' + u.id + '" type="button">✓ 我已掌握</button>') +
        '</div>' +
      '</div>';

      mod.title(u.title || '详情');
      mod.setBody(html);

      /* 代码块复制由 UI.bindGlobalHandlers 在 document 级统一处理
         （.code-top .c-copy → 按钮变「已复制 ✓」），这里不再重复绑定。 */

      // 弹层内的打卡 / 撤销
      mod.node.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var act = t.closest('[data-lv-ck],[data-lv-rv]');
        if (!act) return;
        var id = Number(act.dataset.lvCk || act.dataset.lvRv);
        var node = S.idx ? S.idx.byId[id] : null;
        if (guardLocked(node)) return;
        mod.close();                       // 先关弹层，再打卡（撤销会弹确认框）
        doCheckin(id, !!act.dataset.lvRv, null);
      });
    }).catch(function (e) {
      if (isLockError(e)) {
        mod.setBody(U.empty('🔒', '该内容需要超级会员',
          '开通超级会员后可查看完整用法、参数表与全部实例',
          '<button class="btn btn-primary" data-lv-pricing type="button">💎 查看会员定价</button>'));
        return;
      }
      mod.setBody(U.errorBox(e.message,
        '<button class="btn btn-primary" data-act="retry" type="button">重新加载</button>'));
      var rb = mod.body.querySelector('[data-act="retry"]');
      if (rb) rb.addEventListener('click', function () { mod.close(); openDetail(nodeId); });
    });
  }

  /* ═══════════════════ 视图：实用技巧 ═══════════════════ */

  LV.tips = {
    title: '实用技巧',
    icon: '💡',
    nav: true,
    render: function (host) {
      host.innerHTML = U.loading('正在加载实用技巧…');
      loadIndex().then(function (idx) {
        var all = unitsOf(idx, 'tips');
        var done = all.filter(function (t) { return t.done; }).length;

        var html = '<div class="page-head">' +
          '<div>' +
            '<h2>💡 实用技巧</h2>' +
            '<div class="ph-sub">共 <b class="num">' + all.length + '</b> 条高频技巧 · 已掌握 ' +
              '<b class="num">' + done + '</b> 条 · 每条都附带可直接复制的命令</div>' +
          '</div>' +
          '<div class="ph-actions">' +
            '<button class="btn" data-go="course" type="button">📖 课程学习</button>' +
            '<button class="btn" data-go="cmds" type="button">⌨️ 命令大全</button>' +
          '</div>' +
        '</div>';

        html += '<div class="stats-grid">' +
          statCard('💡', '技巧总数', U.num(all.length), '条', '日常运维高频场景', 'accent') +
          statCard('✅', '已掌握', U.num(done), '条',
            all.length ? '掌握率 ' + U.pctText(U.pct(done, all.length)) : '暂无数据', 'ok') +
        '</div>';

        if (!all.length) {
          html += '<div class="panel"><div class="panel-body">' +
            U.empty('📭', '暂无技巧数据', '请联系管理员在后台「目录内容」中补充') +
          '</div></div>';
          host.innerHTML = html;
          return;
        }

        html += '<div class="filters lv-filters">' +
          '<span class="fl-label">搜索</span>' +
          '<input class="input lv-search" type="search" data-lv-tq ' +
            'placeholder="技巧名称 / 说明" value="' + U.escAttr(S.tipQ) + '" autocomplete="off">' +
          '<button class="btn btn-sm" data-lv-tqclear type="button">清空</button>' +
          '<span class="spacer"></span>' +
          '<span class="dim small" data-lv-tcount></span>' +
        '</div>' +
        '<div class="lv-tips" data-lv-tips></div>';

        host.innerHTML = html;

        var box = host.querySelector('[data-lv-tips]');
        var cnt = host.querySelector('[data-lv-tcount]');
        paintTips(box, cnt, all);

        var inp = host.querySelector('[data-lv-tq]');
        if (inp) {
          inp.addEventListener('input', U.debounce(function () {
            S.tipQ = inp.value.trim();
            paintTips(box, cnt, all);
          }, 180));
        }
        var clr = host.querySelector('[data-lv-tqclear]');
        if (clr) clr.addEventListener('click', function () {
          if (inp) inp.value = '';
          S.tipQ = '';
          paintTips(box, cnt, all);
          if (inp) inp.focus();
        });
      }).catch(function (e) {
        retryBox(host, e, function () { LV.tips.render(host); });
      });
    },
  };

  function paintTips(box, cnt, all) {
    if (!box) return;
    var q = S.tipQ.toLowerCase();
    var list = q ? all.filter(function (t) {
      return String(t.title || '').toLowerCase().indexOf(q) >= 0 ||
             String(t.summary || '').toLowerCase().indexOf(q) >= 0;
    }) : all;

    if (cnt) cnt.innerHTML = '命中 <b class="num">' + list.length + '</b> 条';

    if (!list.length) {
      box.innerHTML = U.empty('🔍', '没有匹配的技巧', '换个关键词试试');
      return;
    }

    box.innerHTML = list.map(function (t, i) {
      return '<div class="lv-tip' + (t.done ? ' done' : '') + '">' +
        '<div class="lt-top">' +
          '<span class="lt-no num">' + pad(i + 1) + '</span>' +
          '<span class="lt-t">' + U.esc(t.title) + '</span>' +
          (t.done ? chip('✓ 已掌握', 'd1') : lockChip(t)) +
        '</div>' +
        (t.summary ? '<div class="lt-d">' + U.esc(t.summary) + '</div>' : '') +
        (t.example
          ? '<div class="lt-code">' +
              '<code class="mono">' + U.esc(t.example) + '</code>' +
              '<button class="btn btn-sm" data-lv-cp="' + U.escAttr(t.example) + '" type="button">复制</button>' +
            '</div>'
          : '') +
        '<div class="lt-foot">' +
          '<button class="btn btn-sm" data-lv-cmd="' + t.id + '" type="button">查看详情</button>' +
          (t.checkable
            ? (t.done
                ? '<button class="btn btn-sm btn-danger" data-lv-rv="' + t.id + '" type="button">撤销打卡</button>'
                : '<button class="btn btn-sm btn-primary" data-lv-ck="' + t.id + '" type="button">✓ 记住这条</button>')
            : '') +
        '</div>' +
      '</div>';
    }).join('');
  }

  /* ═══════════════════ 打卡 / 撤销 ═══════════════════ */

  /**
   * @param {number} id       单元 id
   * @param {boolean} revoke  true = 撤销
   * @param {Element} btn     触发按钮（用于 busy 态）
   */
  function doCheckin(id, revoke, btn) {
    var SV = w.StudentView;
    if (!SV) return;

    if (revoke) { SV.doRevoke([id], btn); return; }

    if (!isSuper()) { lockToast(); return; }

    var rs = btn ? UI.btnBusy(btn, '打卡中…') : function () {};
    API.student.checkin([id], U.today()).then(function (r) {
      UI.toast('已打卡（日期 ' + r.date + '）', 'ok', '打卡成功');
      STORE.invalidate('tree');
      S.idxAt = 0;                       // 索引里的 done 已过期
      STORE.emit('checkinbar');
      refreshAfterCheckin();
    }).catch(function (e) {
      if (e && (e.code === 'NEED_MEMBER' || e.code === 'LOCKED')) lockToast();
      else UI.errToast(e);
    }).then(rs);
  }

  /** 打卡成功后：重拉索引（进度数字）再重绘当前视图 */
  function refreshAfterCheckin() {
    var SV = w.StudentView;
    if (!SV) return;
    var done = function () { SV.refresh(false); };
    loadIndex(true).then(done).catch(done);
  }

  /* ═══════════════════ 事件委托 ═══════════════════
     挂在 document 而不是 #app：详情弹层由 UI.modal 挂到 body，
     #app 上的委托收不到弹层里的点击。 */

  function bindEvents() {
    if (d.body.dataset.lvBound) return;
    d.body.dataset.lvBound = '1';

    // 点击侧栏「课程学习」时回到课程列表（而不是停留在上次读的那一讲）
    d.addEventListener('click', function (e) {
      var nav = e.target && e.target.closest && e.target.closest('[data-nav="course"]');
      if (nav) S.tut = null;
    });

    d.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      // 仅学生端生效；弹层内的点击始终放行
      var inModal = !!t.closest('.ui-modal, #modal');
      if (!inModal && (!STORE.user || STORE.user.role !== 'student')) return;
      if (inModal) return;               // 弹层内部由 openDetail 自己接管

      var host = d.getElementById('view');
      if (!host) return;

      // 会员定价
      if (t.closest('[data-lv-pricing]')) {
        if (w.MemberGate && w.MemberGate.openPricing) w.MemberGate.openPricing();
        return;
      }

      // 复制
      var cp = t.closest('[data-lv-cp]');
      if (cp) {
        e.stopPropagation();
        U.copy(cp.dataset.lvCp || '').then(function () {
          UI.toast('已复制到剪贴板', 'info', null, 1500);
        });
        return;
      }

      // 返回课程目录
      if (t.closest('[data-lv-tutback]')) {
        S.tut = null;
        LV.course.render(host);
        return;
      }

      // 打开某一讲
      var tu = t.closest('[data-lv-tut]');
      if (tu) {
        var tid = Number(tu.dataset.lvTut);
        if (guardLocked(S.idx ? S.idx.byId[tid] : null)) return;
        S.tut = tid;
        if (STORE.state.view !== 'course') w.App.go('course');
        else LV.course.render(host);
        return;
      }

      // 打开详情（命令 / 技巧）
      var cm = t.closest('[data-lv-cmd]');
      if (cm) {
        var cid = Number(cm.dataset.lvCmd);
        if (guardLocked(S.idx ? S.idx.byId[cid] : null)) return;
        openDetail(cid);
        return;
      }

      // 打卡 / 撤销
      var ck = t.closest('[data-lv-ck]');
      if (ck) {
        e.stopPropagation();
        var ids = Number(ck.dataset.lvCk);
        if (guardLocked(S.idx ? S.idx.byId[ids] : null)) return;
        doCheckin(ids, false, ck);
        return;
      }
      var rv = t.closest('[data-lv-rv]');
      if (rv) {
        e.stopPropagation();
        var idr = Number(rv.dataset.lvRv);
        if (guardLocked(S.idx ? S.idx.byId[idr] : null)) return;
        doCheckin(idr, true, rv);
        return;
      }
    });
  }

  /* ═══════════════════ 注册到学生端 ═══════════════════ */

  function register() {
    var SV = w.StudentView;
    if (!SV) return false;
    SV.course = LV.course;
    SV.cmds = LV.cmds;
    SV.tips = LV.tips;
    ['course', 'cmds', 'tips'].forEach(function (k) {
      if (SV.KEYS && SV.KEYS.indexOf(k) < 0) SV.KEYS.push(k);
    });
    return true;
  }

  /* 导出 */
  LV.state = S;
  LV.loadIndex = loadIndex;
  LV.filterCmds = filterCmds;
  LV.paintCmds = paintCmds;
  LV.artHtml = artHtml;
  LV.buildIndex = buildIndex;
  LV.isSuper = isSuper;
  LV.register = register;
  LV.bindEvents = bindEvents;
  LV.KIND_CN = KIND_CN;

  w.LearnView = LV;

  if (!register()) {
    console.warn('[learn] StudentView 尚未加载，将在 DOMContentLoaded 时重试注册');
    d.addEventListener('DOMContentLoaded', register);
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', bindEvents);
  else bindEvents();
})(window, document);
