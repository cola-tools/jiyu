/* ══════════════════════════════════════════════════════════════════
   member.js · 打卡平台会员门禁
   ──────────────────────────────────────────────────────────────────
   需求对应：
   ① 普通会员无法登录打卡平台
        → 登录接口 platform='checkin'，403 NEED_MEMBER 直接给出提示
   ② 会员到期后，无论在不在登录状态都强制退出打卡平台
        → 轮询 /member/me，一旦失去超级会员身份立刻弹出不可取消的
          「会员到期提醒」，只能点「退出登录」
   ③ 剩余不足 3 天 → 提示文案 + 右下角常驻动态倒计时（x天x时x分x秒）
   ④ 账号被管理员禁用 → 任何操作都提示「您的账号已被管理员设置为禁用…」
   ⑤ 定价 / 我的会员 / 打卡记录导出入口（超级会员）
   ══════════════════════════════════════════════════════════════════ */
(function (w, d) {
  'use strict';

  var U = w.U;
  var UI = w.UI;
  var API = w.API;
  var STORE = w.STORE;

  var MSG = {
    NEED_MEMBER: '你还未开通会员，无法使用打卡平台，请联系管理员开通会员后再使用！',
    DISABLED: '您的账号已被管理员设置为禁用，请联系管理员开通账号使用权限',
    DUE_WARN: '你的会员期限已不足3天，为了能够正常使用该平台，请及时联系管理员进行续费！',
    LOCKED: '你还未开通超级会员，请联系管理员开通后进行学习！',
  };
  var LEVEL_CN = { none: '普通会员', week: '周会员', month: '月会员', year: '年会员', forever: '永久会员' };
  var PERK_FREE = ['第一章学习权限', '不可打卡', '不可学习全部章节', '无法登录打卡平台'];
  var PERK_SUPER = ['可学习全章节内容', '可进行学习打卡', '专业团队出题练习', '可导出学习打卡记录'];

  var G = {
    member: null,
    me: null,
    pollTimer: null,
    cdTimer: null,
    expireShown: false,
    disabledShown: false,
    dueWarned: false,
  };

  /* ───────── 工具 ───────── */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function splitMs(ms) {
    var t = Math.max(0, Math.floor(ms / 1000));
    return {
      d: Math.floor(t / 86400), h: Math.floor((t % 86400) / 3600),
      m: Math.floor((t % 3600) / 60), s: t % 60,
    };
  }
  function cdText(ms) {
    var p = splitMs(ms);
    return p.d + '天' + p.h + '时' + p.m + '分' + p.s + '秒';
  }
  function fmtCn(s) {
    if (!s) return '——';
    var m = String(s).replace('T', ' ').match(/^(\d{4})-(\d{2})-(\d{2})[ ]?(\d{2}):(\d{2}):(\d{2})/);
    if (!m) return String(s);
    return m[1] + '年' + m[2] + '月' + m[3] + '日 ' + m[4] + '时' + m[5] + '分' + m[6] + '秒';
  }
  function layer() {
    var el = d.getElementById('memberLayer');
    if (!el) {
      el = d.createElement('div');
      el.id = 'memberLayer';
      d.body.appendChild(el);
    }
    return el;
  }

  /* ══════════════ 1. 徽标 ══════════════ */
  function paintBadge() {
    var m = G.member || { type: 'none', isSuper: false };
    var b = d.getElementById('userMember');
    if (b) {
      b.textContent = m.isSuper ? (LEVEL_CN[m.type] || '超级会员') : '普通会员';
      b.className = 'member-badge' + (m.isSuper ? ' super' : '');
      b.title = m.isSuper
        ? (m.permanent ? '永久有效' : '到期：' + fmtCn(m.expireAt)) +
          (m.almostDue ? '　（剩余不足 3 天，请及时续费）' : '')
        : '普通会员：仅可学习「① 入门与安装」，无法使用打卡平台';
    }
    var line = d.getElementById('userMemberLine');
    if (line) {
      line.innerHTML = m.isSuper
        ? '会员：<span class="gold">' + U.esc(LEVEL_CN[m.type] || '超级会员') + '</span>' +
          (m.permanent ? '　永久有效' : '<br>到期：<b>' + U.esc(fmtCn(m.expireAt)) + '</b>') +
          (m.almostDue ? '<br><span class="gold">⚠️ 剩余不足 3 天，请尽快续费</span>' : '')
        : '会员：<b>普通会员</b><br>开通后可使用打卡平台';
    }
  }

  /* ══════════════ 2. 不可取消的全屏拦截 ══════════════ */
  function showBlock(opt) {
    var html =
      '<div class="mem-block show" id="memBlock">' +
        '<div class="mem-block-box' + (opt.kind === 'disabled' ? ' bad' : '') + '">' +
          '<div class="mem-block-ic">' + (opt.kind === 'disabled' ? '🚫' : '⏰') + '</div>' +
          (opt.kind === 'disabled'
            ? '<h2>账号已被禁用</h2>' +
              '<p>' + U.esc(MSG.DISABLED) + '</p>' +
              '<div class="tip2">禁用期间学习、打卡、个人信息等任何功能都不可使用。</div>'
            : '<h2>会员到期提醒</h2>' +
              '<p>你的会员于 <b>' + U.esc(fmtCn(opt.expireAt)) + '</b> 到期，' +
              '现将强制退出该平台，若想要继续使用，请尽快续费使用</p>' +
              '<div class="tip2">续费方式：联系管理员在后台为你开通 / 续费超级会员。<br>' +
              '退出后如需再次使用打卡平台，需先成为超级会员。</div>') +
          '<button class="mem-block-btn' + (opt.kind === 'disabled' ? ' plain' : '') +
            '" type="button" id="memBlockOut">退出登录</button>' +
        '</div>' +
      '</div>';

    /* 先清掉可能存在的旧弹层，保证同一时刻只有一个 */
    var old = d.getElementById('memBlock');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    layer().insertAdjacentHTML('beforeend', html);

    /* 吞掉所有交互：除「退出登录」按钮，任何地方都点不动 */
    var mask = d.getElementById('memBlock');
    ['click', 'mousedown', 'mouseup', 'touchstart', 'contextmenu'].forEach(function (evt) {
      mask.addEventListener(evt, function (e) {
        if (e.target && e.target.id === 'memBlockOut') return;
        e.preventDefault();
        e.stopPropagation();
      }, true);
    });
    d.body.style.overflow = 'hidden';
    d.getElementById('memBlockOut').addEventListener('click', function () {
      doLogout();
    });
    stopCountdown();
  }

  function hideBlock() {
    var el = d.getElementById('memBlock');
    if (el && el.parentNode) el.parentNode.removeChild(el);
    d.body.style.overflow = '';
  }

  /* ══════════════ 3. 倒计时 ══════════════ */
  function ensureCd() {
    if (d.getElementById('memCd')) return;
    layer().insertAdjacentHTML('beforeend',
      '<div class="mem-cd" id="memCd">' +
        '<div class="lb"><span class="dt"></span><span>会员即将到期</span></div>' +
        '<div class="tm" id="memCdTime">—</div>' +
        '<button class="go" type="button" data-mem="pricing">联系管理员续费</button>' +
      '</div>');
  }
  function paintCd() {
    var el = d.getElementById('memCdTime');
    if (!el || !G.member) return;
    if (G.member.permanent) { stopCountdown(); return; }
    var left = new Date(String(G.member.expireAt).replace(' ', 'T')).getTime() - Date.now();
    if (isNaN(left)) { stopCountdown(); return; }
    if (left <= 0) { el.textContent = '已到期'; onExpired(); return; }
    var p = splitMs(left);
    el.innerHTML = p.d + '<span>天</span>' + p.h + '<span>时</span>' +
      p.m + '<span>分</span>' + p.s + '<span>秒</span>';
  }
  function startCountdown() {
    if (!G.member || G.member.permanent) return;
    ensureCd();
    var cd = d.getElementById('memCd');
    if (cd) cd.classList.add('show');
    paintCd();
    if (G.cdTimer) return;
    G.cdTimer = setInterval(paintCd, 1000);
  }
  function stopCountdown() {
    var cd = d.getElementById('memCd');
    if (cd) cd.classList.remove('show');
    if (G.cdTimer) { clearInterval(G.cdTimer); G.cdTimer = null; }
  }

  /* ══════════════ 4. 到期 / 禁用判定 ══════════════ */
  function onExpired() {
    if (G.expireShown) return;
    G.expireShown = true;
    var at = (G.member && G.member.expireAt) || (G.me && G.me.member && G.me.member.expireAt) || '';
    showBlock({ kind: 'expired', expireAt: at });
  }
  function onDisabled() {
    if (G.disabledShown) return;
    G.disabledShown = true;
    showBlock({ kind: 'disabled' });
  }

  function applyMember(member, account) {
    var prev = G.member;
    G.member = member || { type: 'none', isSuper: false, label: '普通会员' };
    paintBadge();

    if (account && account.disabled) { onDisabled(); return; }
    /* 曾经是超级会员 → 现在不是了 = 到期（或被管理员改回普通会员） */
    if (prev && prev.isSuper && !G.member.isSuper) { onExpired(); return; }

    if (G.member.isSuper && !G.member.permanent && G.member.almostDue) {
      startCountdown();
      if (!G.dueWarned) {
        G.dueWarned = true;
        UI.toast(MSG.DUE_WARN, 'warn', '会员期限提醒', 8000);
      }
    } else {
      stopCountdown();
    }
  }

  /* ══════════════ 5. 门禁检查 ══════════════ */
  /** 登录成功后调用：普通会员/已过期 → 弹提示并登出；超级会员 → 放行 */
  function check() {
    G.checked = true;
    return API.member.gate().then(function (r) {
      G.member = (r && r.member) || null;
      G.expireShown = false;
      G.disabledShown = false;
      G.dueWarned = false;
      paintBadge();
      if (G.member) {
        if (G.member.isSuper && !G.member.permanent && G.member.almostDue) {
          startCountdown();
          setTimeout(function () { UI.toast(MSG.DUE_WARN, 'warn', '会员期限提醒', 8000); }, 900);
          G.dueWarned = true;
        }
      }
      startPolling();
      return { ok: true, member: G.member };
    }).catch(function (e) {
      var code = e && e.code;
      var payload = (e && e.payload) || {};
      if (code === 'ACCOUNT_DISABLED') {
        G.disabledShown = true;
        showBlock({ kind: 'disabled' });
        return { ok: false, code: code };
      }
      if (code === 'NEED_MEMBER') {
        G.expireShown = true;
        showBlock({
          kind: 'expired',
          expireAt: (payload.member && payload.member.expireAt) || '',
          needOpen: true,
        });
        return { ok: false, code: code };
      }
      throw e;
    });
  }

  function startPolling() {
    if (G.pollTimer) return;
    G.pollTimer = setInterval(function () {
      if (d.hidden) return;
      if (!API.getToken()) return;
      if (!STORE.user || STORE.user.role === 'admin') return;
      API.member.me().then(function (r) {
        applyMember(r.member, r.account);
      }).catch(function (e) {
        if (e && e.status === 401) {
          /* 令牌已被服务端清除（到期强制退出 / 被禁用） */
          if (STORE.user) {
            showBlock({ kind: 'expired', expireAt: (G.member && G.member.expireAt) || '' });
          }
        } else if (e && e.code === 'ACCOUNT_DISABLED') {
          onDisabled();
        }
      });
    }, 30000);
  }

  function stopPolling() {
    if (G.pollTimer) { clearInterval(G.pollTimer); G.pollTimer = null; }
    G.member = null; G.me = null;
    G.checked = false;
    G.expireShown = false; G.disabledShown = false; G.dueWarned = false;
    stopCountdown();
    hideBlock();
  }

  /** 幂等门禁检查：同一页面生命周期内只真正请求一次（供会话恢复路径调用） */
  function ensure() {
    if (G.checked) { paintBadge(); return Promise.resolve({ ok: true, cached: true }); }
    return check().catch(function () { return { ok: true }; });
  }

  /* ══════════════ 6. 退出登录 ══════════════ */
  function doLogout() {
    stopPolling();
    UI.closeModal && UI.closeModal();
    API.auth.logout().catch(function () { /* 忽略 */ });
    STORE.clearSession();
    try { w.dispatchEvent(new CustomEvent('lsp:logout')); } catch (e) { /* 忽略 */ }
  }

  /* ══════════════ 7. 浮层：定价 / 我的会员 ══════════════ */
  function closeOv() {
    var ov = d.getElementById('memOv');
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    if (!d.getElementById('memBlock')) d.body.style.overflow = '';
  }

  function openOv(html, narrow, onMount) {
    closeOv();
    layer().insertAdjacentHTML('beforeend',
      '<div class="mem-ov show" id="memOv">' +
        '<div class="mem-box' + (narrow ? ' narrow' : '') + '">' + html + '</div>' +
      '</div>');
    var ov = d.getElementById('memOv');
    ov.addEventListener('click', function (e) {
      if (e.target === ov) closeOv();
      var c = e.target.closest && e.target.closest('[data-mem="close"]');
      if (c) closeOv();
    });
    d.body.style.overflow = 'hidden';
    if (onMount) onMount(ov);
  }

  function openPricing() {
    openOv(
      '<div class="mem-head">' +
        '<div class="ic">💎</div>' +
        '<div><h2>会员定价</h2><p>超级会员可学习全部章节、参与学习打卡、导出打卡记录</p></div>' +
        '<button class="mem-close" type="button" data-mem="close">✕</button>' +
      '</div>' +
      '<div id="memPriceBox" style="color:var(--ink-3);font-size:13px;padding:18px 2px">正在加载定价…</div>' +
      '<div class="mem-note"><b>开通与续费方式</b>：会员由管理员在后台统一设置，请联系管理员开通或续费。<br>' +
      '续费自动叠加：当前会员未到期时，新到期时间 = <b>原到期时间 + 本次时长</b>' +
      '（示例：剩余 2 天 2 小时 45 分 1 秒时充周会员 → 变为 9 天 2 小时 45 分 1 秒）。<br>' +
      '会员到期后<b>自动降级为普通会员</b>，并会从打卡平台强制退出。</div>',
      false,
      function () {
        var btn = d.querySelector('#memOv [data-mem="close"]');
        if (btn) btn.addEventListener('click', function () { closeOv(); });
        API.member.pricing().then(function (r) {
          var items = (r && r.items) || [];
          var myType = (G.member && G.member.type) || 'none';
          var h = '<div class="mem-grid">';
          items.forEach(function (p) {
            var free = p.isFree;
            var cur = p.code === myType;
            h += '<div class="mem-card' + (p.hot ? ' hot' : '') + (cur ? ' cur' : '') + '">' +
              (cur ? '<div class="mem-tag now">当前身份</div>'
                   : (p.hot ? '<div class="mem-tag">最受欢迎</div>' : '')) +
              '<div class="mem-name">' + U.esc(p.label) + '</div>' +
              '<div class="mem-tl">' + U.esc(p.tagline || '') + '</div>' +
              '<div class="mem-price"><span class="c">¥</span><span class="v">' + U.esc(p.priceText) +
                '</span><span class="d">' + (p.days > 0 ? ' / ' + p.days + ' 天' : ' / 永久') + '</span></div>' +
              '<ul class="mem-perks">' +
                (free ? PERK_FREE : PERK_SUPER).map(function (x) {
                  return '<li' + (free ? ' class="no"' : '') + '><span class="k">' +
                    (free ? '•' : '✓') + '</span><span>' + U.esc(x) + '</span></li>';
                }).join('') +
              '</ul>' +
              '<button class="mem-btn' + (free ? ' ghost' : '') + '" type="button" data-mem="' +
                (free ? 'close' : 'contact') + '">' + (free ? '免费使用中' : '联系管理员开通') + '</button>' +
            '</div>';
          });
          h += '</div>';
          var box = d.getElementById('memPriceBox');
          if (box) { box.innerHTML = h; box.style.padding = ''; box.style.color = ''; }
        }).catch(function (e) {
          var box = d.getElementById('memPriceBox');
          if (box) box.textContent = '定价加载失败：' + (e && e.message ? e.message : '未知错误');
        });
      }
    );
  }

  function openMine() {
    var m = G.member || { type: 'none', isSuper: false };
    var u = (STORE.user) || {};
    var superMode = !!m.isSuper;
    openOv(
      '<div class="mem-head">' +
        '<div class="ic">👤</div>' +
        '<div><h2>我的会员</h2><p>账号与会员状态总览</p></div>' +
        '<button class="mem-close" type="button" data-mem="close">✕</button>' +
      '</div>' +
      '<div class="mem-kv">' +
        '<div class="it"><div class="l">登录账号</div><div class="v2">' + U.esc(u.username || '—') + '</div></div>' +
        '<div class="it"><div class="l">姓名</div><div class="v2">' + U.esc(u.name || '—') + '</div></div>' +
        '<div class="it"><div class="l">会员等级</div><div class="v2' + (superMode ? ' gold' : '') + '">' +
          U.esc(superMode ? (LEVEL_CN[m.type] || '超级会员') : '普通会员') + '</div></div>' +
        '<div class="it"><div class="l">到期时间</div><div class="v2">' +
          (m.permanent ? '永久有效' : (superMode ? U.esc(fmtCn(m.expireAt)) : '——')) + '</div></div>' +
        '<div class="it"><div class="l">剩余时长</div><div class="v2" id="memMineRemain">' +
          (m.permanent ? '无限期' : (superMode ? U.esc(cdText(m.remainMs || 0)) : '——')) + '</div></div>' +
        '<div class="it"><div class="l">可学习范围</div><div class="v2" style="font-size:13.5px">' +
          (superMode ? '全部章节' : '「① 入门与安装」5 小节') + '</div></div>' +
      '</div>' +
      (superMode && !m.permanent
        ? '<div class="mem-note">会员到期后将自动降级为普通会员，并会从打卡平台强制退出。</div>'
        : '<div class="mem-note">当前为<b>普通会员</b>：仅可学习「① 入门与安装」下的 5 个小节，' +
          '无法使用打卡平台，请联系管理员开通超级会员。</div>') +
      '<div style="display:flex;align-items:center;gap:10px;margin:22px 0 0">' +
        '<h2 style="margin:0;font-size:15.5px;color:var(--ink)">会员变更记录</h2>' +
        '<button class="mem-btn" type="button" data-mem="pricing" style="width:auto;margin:0;padding:7px 16px;font-size:12.8px">💎 去开通</button>' +
      '</div>' +
      '<div class="mem-logs" id="memMineLogs"><div style="padding:16px;font-size:12.8px;color:var(--ink-3)">加载中…</div></div>',
      true,
      function () {
        var b = d.querySelector('#memOv [data-mem="close"]');
        if (b) b.addEventListener('click', function () { closeOv(); });
        API.member.logs().then(function (r) {
          var items = (r && r.items) || [];
          var box = d.getElementById('memMineLogs');
          if (!box) return;
          if (!items.length) {
            box.innerHTML = '<div style="padding:16px;font-size:12.8px;color:var(--ink-3)">暂无会员变更记录</div>';
            return;
          }
          var h = '<table><thead><tr><th>时间</th><th>操作</th><th>变更</th><th>到期时间</th><th>操作人</th></tr></thead><tbody>';
          items.forEach(function (x) {
            h += '<tr><td>' + U.esc(x.createdAt) + '</td>' +
              '<td><b style="color:var(--ink)">' + U.esc(x.actionText) + '</b></td>' +
              '<td>' + U.esc(x.typeFrom) + ' → <b>' + U.esc(x.typeTo) + '</b>' +
                (x.daysAdded ? ' <span style="color:var(--ok)">+' + x.daysAdded + '天</span>' : '') + '</td>' +
              '<td>' + U.esc(x.expireTo || '永久') + '</td>' +
              '<td>' + U.esc(x.operator) + '</td></tr>';
          });
          box.innerHTML = h + '</tbody></table>';
        }).catch(function (e) {
          var box = d.getElementById('memMineLogs');
          if (box) box.textContent = '加载失败：' + (e && e.message ? e.message : '');
        });
      }
    );
  }

  /* ══════════════ 8. 全局事件 ══════════════ */
  function bind() {
    d.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var act = t.closest('[data-mem]');
      if (!act) return;
      var a = act.getAttribute('data-mem');
      if (a === 'pricing') { e.preventDefault(); openPricing(); return; }
      if (a === 'mine') { e.preventDefault(); openMine(); return; }
      if (a === 'close') { e.preventDefault(); closeOv(); return; }
      if (a === 'contact') {
        e.preventDefault();
        UI.modal({
          title: '联系管理员开通会员',
          size: 'sm',
          body: '<div style="font-size:14px;line-height:1.95">' +
            '请把你的<b>用户名</b>或<b>绑定手机号</b>告知管理员，由管理员在后台为你开通 / 续费超级会员。<br><br>' +
            '当前账号：<b>' + U.esc((STORE.user && (STORE.user.username || '')) || '—') + '</b>' +
            ((G.member && G.member.isSuper)
              ? '<br>当前会员：<b>' + U.esc(LEVEL_CN[G.member.type] || '') + '</b>' +
                (G.member.permanent ? '（永久有效）' : '<br>到期时间：<b>' + U.esc(fmtCn(G.member.expireAt)) + '</b>')
              : '') +
            '</div>',
          foot: '<button class="btn btn-primary" data-act="ok" type="button">知道了</button>',
          onMount: function (m) {
            m.foot.querySelector('[data-act="ok"]').addEventListener('click', function () { m.close(); });
          },
        });
      }
    });

    d.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (d.getElementById('memBlock')) { e.stopPropagation(); e.preventDefault(); return; }
      if (d.getElementById('memOv')) { e.stopPropagation(); closeOv(); }
    }, true);
  }

  /* ══════════════ 9. 导出入口（供「我的打卡」页使用） ══════════════ */
  function exportRecords(format, params) {
    if (!G.member || !G.member.isSuper) {
      UI.modal({
        title: '需要超级会员',
        size: 'sm',
        body: '<div style="font-size:15px;line-height:1.95">' + U.esc(MSG.LOCKED) + '</div>' +
          '<div class="note warn" style="margin-top:12px"><span class="n-ico">💎</span>' +
          '<span>超级会员可导出 <b>CSV / Excel / PDF</b> 三种格式的打卡记录。</span></div>',
        foot: '<button class="btn btn-primary" data-act="price" type="button">查看会员定价</button>',
        onMount: function (m) {
          m.foot.querySelector('[data-act="price"]').addEventListener('click', function () {
            m.close(); openPricing();
          });
        },
      });
      return;
    }
    var label = { csv: 'CSV', xlsx: 'Excel', pdf: 'PDF' }[format] || String(format).toUpperCase();
    UI.toast('正在生成 ' + label + '…', 'info', '导出打卡记录', 2200);
    API.student.export(format, params).then(function (r) {
      var url = URL.createObjectURL(r.blob);
      var a = d.createElement('a');
      a.href = url; a.download = r.name;
      d.body.appendChild(a); a.click();
      setTimeout(function () { d.body.removeChild(a); URL.revokeObjectURL(url); }, 900);
      UI.toast('已开始下载：' + r.name, 'ok', label + ' 导出成功', 3400);
    }).catch(function (e) {
      var msg = (e && e.message) || '导出失败';
      if (e && e.code === 'NO_DATA') UI.toast(msg, 'warn', '没有可导出的记录', 3600);
      else if (e && e.code === 'NEED_MEMBER') UI.toast(MSG.LOCKED, 'err', '需要超级会员', 4200);
      else UI.toast(msg, 'err', '导出失败');
    });
  }

  /* ══════════════ 暴露 ══════════════ */
  var MemberGate = {
    MSG: MSG,
    LEVEL_CN: LEVEL_CN,
    check: check,
    ensure: ensure,
    bind: bind,
    startPolling: startPolling,
    stopPolling: stopPolling,
    logout: doLogout,
    openPricing: openPricing,
    openMine: openMine,
    exportRecords: exportRecords,
    get member() { return G.member; },
    isSuper: function () { return !!(G.member && G.member.isSuper); },
  };

  w.MemberGate = MemberGate;
})(window, document);
