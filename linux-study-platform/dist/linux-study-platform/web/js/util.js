/* ══════════════════════════════════════════════════════════════════
   util.js · 通用工具
   转义 / 日期 / 数字 / DOM / 内容渲染 / 文案映射
   无依赖，需在 api.js、ui.js 之前加载
   ══════════════════════════════════════════════════════════════════ */
(function (w, d) {
  'use strict';

  var U = {};

  /* ───────── 1. 转义 & 文本 ───────── */

  var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  /** HTML 转义：所有来自数据库的文本都必须经过它 */
  U.esc = function (v) {
    if (v == null) return '';
    return String(v).replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; });
  };

  /** 属性值转义（比 esc 更严格，去掉控制字符） */
  U.escAttr = function (v) {
    return U.esc(v).replace(/[\u0000-\u001f\u007f]/g, '');
  };

  /** 截断 */
  U.trunc = function (v, n, suffix) {
    var s = v == null ? '' : String(v);
    var lim = n || 80;
    return s.length > lim ? s.slice(0, lim) + (suffix === undefined ? '…' : suffix) : s;
  };

  /* ───────── 2. 日期时间 ───────── */

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  /** 今天 YYYY-MM-DD */
  U.today = function () {
    var t = new Date();
    return t.getFullYear() + '-' + pad2(t.getMonth() + 1) + '-' + pad2(t.getDate());
  };

  /** 把 'YYYY-MM-DD HH:mm:ss' / Date / 时间戳 统一转成 Date（Safari 不接受带空格的格式） */
  U.toDate = function (v) {
    if (v instanceof Date) return v;
    if (v == null || v === '') return null;
    if (typeof v === 'number') return new Date(v);
    var s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00');
    var d2 = new Date(s.replace(' ', 'T'));
    if (!isNaN(d2.getTime())) return d2;
    var d3 = new Date(s);
    return isNaN(d3.getTime()) ? null : d3;
  };

  /** 'YYYY-MM-DD HH:mm:ss' → 'MM-DD HH:mm' */
  U.fmtDT = function (v, withYear) {
    var t = U.toDate(v);
    if (!t) return '—';
    var s = (withYear ? t.getFullYear() + '-' : '') +
      pad2(t.getMonth() + 1) + '-' + pad2(t.getDate()) +
      ' ' + pad2(t.getHours()) + ':' + pad2(t.getMinutes());
    return s;
  };

  /** 'YYYY-MM-DD' → 'M月D日' */
  U.fmtDateCN = function (v) {
    var t = U.toDate(v);
    if (!t) return '—';
    return (t.getMonth() + 1) + '月' + t.getDate() + '日';
  };

  /** 相对时间：刚刚 / N分钟前 / N小时前 / 昨天 HH:mm / MM-DD HH:mm */
  U.relTime = function (v) {
    var t = U.toDate(v);
    if (!t) return '—';
    var diff = Date.now() - t.getTime();
    if (diff < 0) diff = 0;
    var sec = Math.floor(diff / 1000);
    if (sec < 45) return '刚刚';
    var min = Math.floor(sec / 60);
    if (min < 60) return min + ' 分钟前';
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + ' 小时前';
    var day = Math.floor(hr / 24);
    if (day === 1) return '昨天 ' + pad2(t.getHours()) + ':' + pad2(t.getMinutes());
    if (day < 7) return day + ' 天前';
    return U.fmtDT(t);
  };

  /** 距截止时间的提示 */
  U.deadlineText = function (v) {
    var t = U.toDate(v);
    if (!t) return null;
    var diff = t.getTime() - Date.now();
    var abs = Math.abs(diff);
    var day = Math.floor(abs / 86400000);
    var hr = Math.floor((abs % 86400000) / 3600000);
    var txt;
    if (day > 0) txt = day + ' 天' + (hr > 0 ? hr + ' 小时' : '');
    else if (hr > 0) txt = hr + ' 小时';
    else txt = Math.max(1, Math.floor(abs / 60000)) + ' 分钟';
    return { overdue: diff < 0, text: diff < 0 ? '已逾期 ' + txt : '剩余 ' + txt, at: U.fmtDT(t) };
  };

  /* ───────── 3. 数字 ───────── */

  /** 数字千分位 */
  U.num = function (n) {
    var v = Number(n) || 0;
    return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };

  /** 百分比显示：<10% 保留一位小数（与后端 percent() 口径一致） */
  U.pct = function (done, total) {
    var dn = Number(done) || 0, tt = Number(total) || 0;
    if (!tt || dn <= 0) return 0;
    var p = (dn / tt) * 100;
    if (p < 10) return Math.round(p * 10) / 10;
    return Math.round(p);
  };

  U.pctText = function (p) {
    var v = Number(p) || 0;
    return (Math.round(v * 10) / 10) + '%';
  };

  /** 进度色阶：低=红 中=黄 高=绿 */
  U.pctClass = function (p) {
    var v = Number(p) || 0;
    if (v >= 80) return 'ok';
    if (v >= 40) return '';
    if (v >= 15) return 'warn';
    return 'danger';
  };

  U.clamp = function (v, min, max) {
    var n = Number(v);
    if (isNaN(n)) n = min;
    return Math.max(min, Math.min(max, n));
  };

  /* ───────── 4. 函数 ───────── */

  U.debounce = function (fn, wait) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      if (t) clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(self, args); }, wait || 200);
    };
  };

  U.throttle = function (fn, wait) {
    var last = 0, timer = null, lastArgs = null;
    return function () {
      var now = Date.now(), self = this;
      lastArgs = arguments;
      if (now - last >= (wait || 200)) {
        last = now;
        fn.apply(self, lastArgs);
      } else if (!timer) {
        timer = setTimeout(function () {
          timer = null; last = Date.now();
          fn.apply(self, lastArgs);
        }, (wait || 200) - (now - last));
      }
    };
  };

  /** 简易唯一 id */
  var uidSeq = 0;
  U.uid = function (prefix) {
    uidSeq += 1;
    return (prefix || 'id') + '-' + uidSeq + '-' + Math.random().toString(36).slice(2, 7);
  };

  /* ───────── 5. DOM ───────── */

  U.qs = function (sel, root) { return (root || d).querySelector(sel); };
  U.qsa = function (sel, root) {
    return Array.prototype.slice.call((root || d).querySelectorAll(sel));
  };

  /**
   * 极简 DOM 构造器
   *   el('div', {class:'card', html:'<b>x</b>'}, [child1, child2])
   */
  U.el = function (tag, attrs, children) {
    var node = d.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class' || k === 'className') node.className = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'style' && typeof v === 'object') {
          Object.keys(v).forEach(function (sk) { node.style[sk] = v[sk]; });
        } else if (k.indexOf('on') === 0 && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === 'dataset' && typeof v === 'object') {
          Object.keys(v).forEach(function (dk) { node.dataset[dk] = v[dk]; });
        } else node.setAttribute(k, v === true ? '' : v);
      });
    }
    U.append(node, children);
    return node;
  };

  /** 追加子节点（接受字符串 / 节点 / 数组，字符串按 HTML 处理） */
  U.append = function (parent, children) {
    if (children == null) return parent;
    if (Array.isArray(children)) {
      children.forEach(function (c) { U.append(parent, c); });
      return parent;
    }
    if (children instanceof Node) parent.appendChild(children);
    else parent.insertAdjacentHTML('beforeend', String(children));
    return parent;
  };

  /** 设置内容（HTML 字符串） */
  U.setHtml = function (target, html) {
    var node = typeof target === 'string' ? U.qs(target) : target;
    if (node) node.innerHTML = html;
    return node;
  };

  /** 事件委托 */
  U.on = function (root, evt, sel, handler) {
    var node = typeof root === 'string' ? U.qs(root) : root;
    if (!node) return function () {};
    function fn(e) {
      var t = e.target;
      while (t && t !== node) {
        if (t.matches && t.matches(sel)) { handler.call(t, e, t); return; }
        t = t.parentNode;
      }
    }
    node.addEventListener(evt, fn);
    return function () { node.removeEventListener(evt, fn); };
  };

  /** 全屏 loading 包裹：防止重复点击 */
  U.busy = function (btn, on, textBusy) {
    if (!btn) return function () {};
    var old = btn.innerHTML;
    var wasDisabled = btn.disabled;
    if (on !== false) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="width:15px;height:15px;border-width:2.5px"></span> ' + (textBusy || '处理中…');
    }
    return function () {
      btn.disabled = wasDisabled;
      btn.innerHTML = old;
    };
  };

  /** 复制到剪贴板（带降级） */
  U.copy = function (text) {
    var s = String(text == null ? '' : text);
    if (navigator.clipboard && w.isSecureContext) {
      return navigator.clipboard.writeText(s).then(function () { return true; }, function () { return legacy(); });
    }
    return Promise.resolve(legacy());
    function legacy() {
      try {
        var ta = d.createElement('textarea');
        ta.value = s;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
        d.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, s.length);
        var ok = d.execCommand('copy');
        d.body.removeChild(ta);
        return ok;
      } catch (e) { return false; }
    }
  };

  /** 平滑滚动到元素 */
  U.scrollTo = function (target, offset) {
    var node = typeof target === 'string' ? U.qs(target) : target;
    if (!node) return;
    var top = node.getBoundingClientRect().top + w.pageYOffset - (offset == null ? 78 : offset);
    try { w.scrollTo({ top: top, behavior: 'smooth' }); }
    catch (e) { w.scrollTo(0, top); }
  };

  /* ───────── 6. 文案映射 ───────── */

  var DIFF = {
    1: { label: '入门', cls: 'd1' },
    2: { label: '进阶', cls: 'd2' },
    3: { label: '熟练', cls: 'd3' },
    4: { label: '挑战', cls: 'd4' },
  };
  U.diff = function (n) { return DIFF[Number(n)] || DIFF[1]; };
  /** 难度徽标 HTML */
  U.diffChip = function (n) {
    var x = U.diff(n);
    return '<span class="chip ' + x.cls + '">◆ ' + x.label + '</span>';
  };

  var LV_NAME = { 1: '主目录', 2: '次目录', 3: '学习目录', 4: '学习内容' };
  U.levelName = function (n) { return LV_NAME[Number(n)] || '节点'; };
  var LV_ICO = { 1: '📚', 2: '📂', 3: '📄', 4: '📝' };
  U.levelIcon = function (n) { return LV_ICO[Number(n)] || '📄'; };

  var CT_ICO = {
    text: '📄', code: '💻', table: '📊', list: '📋', note: '💡', cmd: '⌨️',
  };
  U.ctIcon = function (t) { return CT_ICO[t] || '📄'; };
  var CT_NAME = {
    text: '正文', code: '代码', table: '表格', list: '清单', note: '提示', cmd: '命令',
  };
  U.ctName = function (t) { return CT_NAME[t] || '正文'; };

  var QT = {
    single: '单选题', multiple: '多选题', judge: '判断题', fill: '填空题', short: '简答题',
  };
  U.qType = function (t) { return QT[t] || '单选题'; };

  /** 打卡流水动作文案 —— 后台看到的就是这套措辞 */
  var ACT = {
    checkin: { label: '完成打卡', ico: '✅', cls: 'ok' },
    revoke: { label: '已撤销打卡', ico: '↩️', cls: 'danger' },
    update: { label: '修改打卡', ico: '✏️', cls: 'warn' },
  };
  U.act = function (a) { return ACT[a] || { label: '操作', ico: '•', cls: 'info' }; };

  /** 后台实时动态动作文案 */
  var FEED = {
    login: { label: '登录', ico: '🔑', cls: 'info' },
    checkin: { label: '打卡', ico: '✅', cls: 'ok' },
    revoke: { label: '撤销打卡', ico: '↩️', cls: 'danger' },
    urge: { label: '发出督促', ico: '📣', cls: 'warn' },
    urge_done: { label: '完成督促', ico: '🏁', cls: 'ok' },
    urge_delete: { label: '删除督促', ico: '🗑️', cls: 'info' },
    student_add: { label: '新增学生', ico: '➕', cls: 'ok' },
    student_update: { label: '修改学生', ico: '✏️', cls: 'warn' },
    student_delete: { label: '删除学生', ico: '🗑️', cls: 'danger' },
    unit_add: { label: '新增内容', ico: '📥', cls: 'ok' },
    unit_update: { label: '修改内容', ico: '✏️', cls: 'warn' },
    unit_delete: { label: '删除内容', ico: '🗑️', cls: 'danger' },
    unit_reorder: { label: '调整顺序', ico: '↕️', cls: 'info' },
    question_add: { label: '新增题目', ico: '❓', cls: 'ok' },
    question_batch: { label: '批量导入', ico: '📚', cls: 'ok' },
    question_update: { label: '修改题目', ico: '✏️', cls: 'warn' },
    question_delete: { label: '删除题目', ico: '🗑️', cls: 'danger' },
  };
  U.feed = function (a) { return FEED[a] || { label: a || '操作', ico: '•', cls: 'info' }; };

  /** 头像配色（按 id 取模，保证同一学生颜色稳定） */
  U.avatarClass = function (id) {
    var n = (Number(id) || 0) % 4;
    return ['', 'g2', 'g3', 'g4'][n];
  };
  /** 取姓名首字做头像 */
  U.initial = function (name, fallback) {
    var s = String(name == null ? '' : name).trim();
    if (s) return s.slice(0, 1);
    var f = String(fallback || '').trim();
    return f ? f.slice(0, 1).toUpperCase() : '学';
  };

  /* ───────── 7. 内容渲染 ───────── */

  function safeJson(s) {
    if (s == null || s === '') return null;
    if (typeof s === 'object') return s;
    try { return JSON.parse(s); } catch (e) { return null; }
  }
  U.safeJson = safeJson;

  /**
   * 表格渲染
   * rows: [[...],[...]]  首行可能是表头
   * opts: { noHeader: true 强制首行当数据（用于「参数与选项」） }
   */
  U.renderTable = function (rows, opts) {
    var o = opts || {};
    if (!Array.isArray(rows) || !rows.length) return '';
    var maxCols = rows.reduce(function (m, r) { return Math.max(m, Array.isArray(r) ? r.length : 1); }, 1);

    var hasHeader;
    if (o.noHeader) hasHeader = false;
    else if (o.header) hasHeader = true;
    else {
      var first = Array.isArray(rows[0]) ? rows[0] : [rows[0]];
      // 首行每个单元格都很短 → 判定为表头（实测可正确区分「对照表」与「参数表」）
      hasHeader = first.length > 0 && first.every(function (c) {
        return String(c == null ? '' : c).trim().length <= 10;
      });
    }

    var html = '<div class="tbl-wrap"><table class="tbl">';
    var bodyRows = rows;
    if (hasHeader) {
      html += '<thead><tr>';
      (rows[0] || []).forEach(function (c) { html += '<th>' + U.esc(c) + '</th>'; });
      for (var i = (rows[0] || []).length; i < maxCols; i++) html += '<th></th>';
      html += '</tr></thead>';
      bodyRows = rows.slice(1);
    } else {
      // 无表头时补一行通用表头，保证视觉一致
      if (maxCols === 2) {
        html += '<thead><tr><th>参数 / 项</th><th>说明</th></tr></thead>';
      }
    }
    html += '<tbody>';
    bodyRows.forEach(function (r) {
      var cells = Array.isArray(r) ? r : [r];
      html += '<tr>';
      cells.forEach(function (c, ci) {
        var cls = (!hasHeader && maxCols === 2 && ci === 0) ? ' class="mono nowrap"' : '';
        html += '<td' + cls + '>' + U.esc(c) + '</td>';
      });
      for (var k = cells.length; k < maxCols; k++) html += '<td></td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    return html;
  };

  /** 代码块渲染（含简易命令着色与复制按钮） */
  U.renderCode = function (code, lang) {
    var raw = String(code == null ? '' : code);
    var lg = String(lang || 'bash');
    var safe = U.esc(raw);
    // 简易着色：注释 / 首个词（命令）/ 选项参数
    safe = safe
      .replace(/(^|\n)(\s*#[^\n]*)/g, function (_m, a, b) { return a + '<span class="tok-cmt">' + b + '</span>'; })
      .replace(/(^|\n)(\s*)([$>]?\s*)([a-zA-Z_][\w./-]*)/g, function (_m, a, b, c, cmd) {
        return a + b + c + '<span class="tok-cmd">' + cmd + '</span>';
      })
      .replace(/(\s)(--?[a-zA-Z][\w-]*)/g, function (_m, a, opt) { return a + '<span class="tok-arg">' + opt + '</span>'; });

    return '<div class="code" data-code="' + U.escAttr(raw) + '">' +
      '<div class="code-top">' +
        '<span class="c-dots"><i></i><i></i><i></i></span>' +
        '<span class="c-lang">' + U.esc(lg) + '</span>' +
        '<button class="c-copy" type="button" data-copy="1">复制</button>' +
      '</div>' +
      '<pre><code>' + safe + '</code></pre>' +
    '</div>';
  };

  /** 命令节点卡（学习目录为 cmd 类型时的摘要） */
  U.renderCmdCard = function (unit) {
    if (!unit || !unit.example) return '';
    return '<div class="cmd"><span class="cmd-k">$ ' + U.esc(unit.example) + '</span>' +
      '<span class="cmd-v">' + U.esc(unit.summary || '') + '</span></div>';
  };

  /**
   * 按 content_type 渲染 body
   * @param {string} type  text / code / table / list / note / cmd
   * @param {string} body
   * @param {object} opts  { lang, title }
   */
  U.renderBody = function (type, body, opts) {
    var o = opts || {};
    var t = String(type || 'text');
    var raw = body == null ? '' : String(body);

    if (t === 'code') return U.renderCode(raw, o.lang);

    if (t === 'table') {
      var rows = safeJson(raw);
      if (!Array.isArray(rows)) return '<div class="content-body"><p>' + U.esc(raw) + '</p></div>';
      // 「参数与选项」类节点首行是数据，不做表头
      var noHeader = /参数|选项|选项与参数/.test(String(o.title || '')) && rows.every(function (r) {
        return Array.isArray(r) && r.length === 2;
      });
      return U.renderTable(rows, { noHeader: noHeader });
    }

    if (t === 'list') {
      var arr = safeJson(raw);
      if (!Array.isArray(arr)) arr = raw.split('\n').filter(function (x) { return x.trim(); });
      if (!arr.length) return '';
      return '<div class="content-body"><ul>' + arr.map(function (x) {
        return '<li>' + U.esc(typeof x === 'object' ? JSON.stringify(x) : x) + '</li>';
      }).join('') + '</ul></div>';
    }

    if (t === 'note') {
      var ic = /注意|警告|小心|禁止/.test(raw) ? '⚠️' : '💡';
      var cls = ic === '⚠️' ? 'warn' : 'tip';
      return '<div class="note ' + cls + '"><span class="n-ico">' + ic + '</span>' +
        '<span>' + U.esc(raw).replace(/\n/g, '<br>') + '</span></div>';
    }

    if (t === 'cmd') {
      return U.renderCmdCard(Object.assign({ summary: raw }, o));
    }

    // text：按空行/换行切段
    if (!raw.trim()) return '';
    var paras = raw.split(/\n{2,}/).map(function (p) {
      return '<p>' + U.esc(p).replace(/\n/g, '<br>') + '</p>';
    }).join('');
    return '<div class="content-body">' + paras + '</div>';
  };

  /** 把纯文本中的命令/路径做轻度高亮（用于正文） */
  U.hl = function (text) {
    return U.esc(text)
      .replace(/`([^`]+)`/g, '<code class="inline">$1</code>');
  };

  /* ───────── 8. 树工具 ───────── */

  /** 扁平数组 → 含 children 的树 */
  U.toTree = function (list, idKey, parentKey) {
    var ik = idKey || 'id', pk = parentKey || 'parentId';
    var map = {}, roots = [];
    list.forEach(function (x) { map[x[ik]] = Object.assign({}, x, { children: [] }); });
    list.forEach(function (x) {
      var node = map[x[ik]];
      var pid = x[pk];
      if (pid != null && map[pid]) map[pid].children.push(node);
      else roots.push(node);
    });
    return roots;
  };

  /** 取某节点的所有子孙 id（含自身） */
  U.descendants = function (list, rootId, idKey, parentKey) {
    var ik = idKey || 'id', pk = parentKey || 'parentId';
    var out = [rootId], frontier = [rootId];
    while (frontier.length) {
      var next = [];
      list.forEach(function (x) {
        if (frontier.indexOf(x[pk]) >= 0 && out.indexOf(x[ik]) < 0) {
          out.push(x[ik]); next.push(x[ik]);
        }
      });
      frontier = next;
    }
    return out;
  };

  /** 路径淡化显示：只保留最后 2 段 */
  U.shortPath = function (p) {
    var s = String(p || '');
    if (!s) return '';
    var parts = s.split(' / ');
    if (parts.length <= 2) return s;
    return '… / ' + parts.slice(-2).join(' / ');
  };

  /** 环形进度 SVG */
  U.ring = function (percent, size, label) {
    var sz = size || 118, sw = Math.max(7, Math.round(sz / 14));
    var r = (sz - sw) / 2;
    var c = 2 * Math.PI * r;
    var p = U.clamp(percent, 0, 100);
    var off = c * (1 - p / 100);
    var col = U.pctClass(p) === 'ok' ? 'var(--ok)'
      : U.pctClass(p) === 'warn' ? 'var(--warn)'
      : U.pctClass(p) === 'danger' ? 'var(--danger)' : 'var(--accent)';
    return '<div class="ring" style="width:' + sz + 'px;height:' + sz + 'px">' +
      '<svg width="' + sz + '" height="' + sz + '">' +
        '<circle class="ring-track" cx="' + sz / 2 + '" cy="' + sz / 2 + '" r="' + r + '" stroke-width="' + sw + '"></circle>' +
        '<circle class="ring-val" cx="' + sz / 2 + '" cy="' + sz / 2 + '" r="' + r + '" stroke-width="' + sw + '"' +
          ' stroke="' + col + '" stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + off.toFixed(2) + '"></circle>' +
      '</svg>' +
      '<div class="ring-txt"><b>' + U.pctText(p) + '</b><i>' + U.esc(label || '完成度') + '</i></div>' +
    '</div>';
  };

  /** 空态 */
  U.empty = function (ico, title, sub, cta) {
    return '<div class="empty">' +
      '<span class="e-ico">' + ico + '</span>' +
      '<div class="e-title">' + U.esc(title) + '</div>' +
      (sub ? '<div class="e-sub">' + U.esc(sub) + '</div>' : '') +
      (cta ? '<div class="empty-cta">' + cta + '</div>' : '') +
    '</div>';
  };

  /** 加载态 */
  U.loading = function (text) {
    return '<div class="loading"><span class="spinner"></span><span>' + U.esc(text || '加载中…') + '</span></div>';
  };

  /** 错误态 */
  U.errorBox = function (msg, retryHtml) {
    return '<div class="empty">' +
      '<span class="e-ico">⚠️</span>' +
      '<div class="e-title">加载失败</div>' +
      '<div class="e-sub">' + U.esc(msg || '请检查网络或后端服务是否正常运行') + '</div>' +
      (retryHtml ? '<div class="empty-cta">' + retryHtml + '</div>' : '') +
    '</div>';
  };

  /* ───────── 9. 暴露 ───────── */
  w.U = U;
})(window, document);
