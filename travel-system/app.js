/* ============================================================
   攻略小家 · 应用逻辑层 v2
   流程：地区 → 城市/县城 → 景区（多选） → 选季节 → 生成路线+预算+穿搭+备选
   ============================================================ */
"use strict";

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const $set = (s, t) => { const e = document.querySelector(s); if (e) e.textContent = t; return e; };
const fmt = (n) => "¥" + (Math.round(n * 10) / 10).toLocaleString("zh-CN");

const state = {
  region: "新疆·喀什地区",
  city: "kuqa",
  spots: new Set(),
  node: "rail",
  dur: DURATIONS[2],
  people: 2,
  pref: "auto",
  hotelLevel: "econ",
  season: "summer",
};

/* ---------- 地区分组 ---------- */
function regionsOf() {
  const m = {};
  Object.keys(CITIES).forEach((k) => {
    const p = (PARENT[k] && PARENT[k].p) || "其他";
    (m[p] = m[p] || []).push(k);
  });
  return m;
}

document.addEventListener("DOMContentLoaded", () => {
  try {
    renderRegions();
    renderCityChips();
    renderCityInfo();
    renderNodes();
    renderDurations();
    renderSpots();
    renderPref();
    renderSeason();
    bindPlanner();
    bindStats();
    initMap();
    loadLiveData();
    $set("#qdate", QUERY_DATE); $set("#qdate3", QUERY_DATE);
    $set("#yearNow", String(new Date().getFullYear()));
  } catch (e) { console.error("初始化异常：", e); }
});

/* ---------- ① 地区 ---------- */
function renderRegions() {
  const wrap = $("#regionChips");
  const reg = regionsOf();
  const keys = Object.keys(reg).sort((a, b) => (a.startsWith("新疆") ? -1 : 1) - (b.startsWith("新疆") ? -1 : 1) || a.localeCompare(b, "zh"));
  wrap.innerHTML = "";
  keys.forEach((k) => {
    const b = document.createElement("button");
    b.className = "chip" + (k === state.region ? " on" : "");
    b.innerHTML = `${k} <span class="chip-n">${reg[k].length}</span>`;
    b.onclick = () => {
      state.region = k;
      const first = reg[k][0];
      if (!reg[k].includes(state.city)) { state.city = first; state.spots.clear(); }
      renderRegions(); renderCityChips(); renderCityInfo(); renderNodes(); renderSpots();
    };
    wrap.appendChild(b);
  });
  $set("#totalCity", String(Object.keys(CITIES).length));
  $set("#totalSpot", String(Object.values(CITIES).reduce((a, c) => a + c.spots.length, 0)));
}

/* ---------- ② 城市/县城 ---------- */
function renderCityChips() {
  const wrap = $("#cityChips");
  const reg = regionsOf();
  const ids = reg[state.region] || Object.keys(CITIES);
  const kw = ($("#citySearch") ? $("#citySearch").value : "").trim().toLowerCase();
  wrap.innerHTML = "";
  ids.forEach((id) => {
    const c = CITIES[id];
    if (kw && !(c.name.includes(kw) || c.full.includes(kw))) return;
    const b = document.createElement("button");
    b.className = "chip" + (id === state.city ? " on" : "");
    const lv = (PARENT[id] && PARENT[id].l) || "";
    b.innerHTML = `<span class="chip-tag">${lv}</span>${c.name}`;
    b.onclick = () => {
      state.city = id; state.spots.clear(); state.node = "rail";
      renderCityChips(); renderCityInfo(); renderNodes(); renderSpots(); renderSeason();
      document.getElementById("planner").scrollIntoView({ behavior: "smooth" });
    };
    wrap.appendChild(b);
  });
  if (!wrap.children.length) wrap.innerHTML = '<span style="color:var(--dim);font-size:13px">无匹配，请清空搜索或切换地区</span>';
  $set("#cityCountNow", String(ids.length));
}

/* ---------- ③ 城市信息卡（价格卡 + 热度 + 季节） ---------- */
function renderCityInfo() {
  const c = CITIES[state.city], pa = PARENT[state.city] || {};
  $set("#ciName", c.name);
  $set("#ciFull", `${c.full} · 隶属：${pa.p || "—"} · ${pa.l || ""}`);
  $set("#ciTag", c.tag);
  $set("#ciTaxi", c.taxi.note);
  $set("#ciBus", c.busNote);
  $set("#ciMeals", `早饭 ${c.meals.b} ｜ 午饭 ${c.meals.l} ｜ 晚饭 ${c.meals.d}（当地作息口径）`);
  $set("#ciHotel", `经济型约 ${c.hotel[0]} 元/晚 · 舒适型约 ${c.hotel[1]} 元/晚（${QUERY_DATE} 口径参考）`);
  const h = HEAT[state.city] || 3;
  $set("#ciHeat", "🔥".repeat(h) + "☆".repeat(5 - h) + `  客流热度 ${h}/5`);
}

function renderSeason() {
  $$("#seasonSel .node-btn").forEach((b) => b.classList.toggle("on", b.dataset.v === state.season));
  const c = CITIES[state.city];
  const isXJ = c.cat === "xj";
  const band = isXJ ? "xj" : "cn";
  const list = (OUTFIT_SPECIAL[state.city] && OUTFIT_SPECIAL[state.city][state.season])
    || OUTFIT[band][state.season];
  const alt = list[list.length - 1] || "";
  $("#outfitBox").innerHTML = `
    <div class="day-head"><span class="day-no">👕</span><span class="day-title">${SEASON[state.season].name} · ${c.name}穿搭方案</span></div>
    <ul class="outfit-list">${list.map((x, i) => `<li${i === list.length - 1 ? ' class="alt"' : ""}>${x}</li>`).join("")}</ul>
    <div class="plan-sub">备选逻辑：${alt.replace("备选：", "")}</div>`;
  // 季节适配提示
  const good = c.spots.filter((s) => (s[10] || "").includes(seasonMonths(state.season)));
  $set("#seasonTip", good.length
    ? `本季最推荐（${good.length}个）：${good.map((s) => s[1]).join("、")}`
    : `本季该地部分景区体验一般，建议优先室内/低海拔项目，或调整出行月份。`);
}
function seasonMonths(sk) { return { spring: "月", summer: "月", autumn: "月", winter: "月" }[sk]; }

/* ---------- 出发地 / 时长 / 偏好 ---------- */
function renderNodes() {
  const c = CITIES[state.city], wrap = $("#nodeSel");
  wrap.innerHTML = "";
  Object.entries(c.nodes).forEach(([k, n]) => {
    const b = document.createElement("button");
    b.className = "node-btn" + (k === state.node ? " on" : "");
    b.innerHTML = `${k === "rail" ? "🚄" : k === "air" ? "✈️" : "🏥"} ${n}`;
    b.onclick = () => { state.node = k; renderNodes(); };
    wrap.appendChild(b);
  });
}
function renderDurations() {
  const wrap = $("#durSel");
  wrap.innerHTML = "";
  DURATIONS.forEach((d) => {
    const b = document.createElement("button");
    b.className = "dur-btn" + (d === state.dur ? " on" : "");
    b.innerHTML = `<b>${d.d}天</b><i>${d.n}晚</i>`;
    b.title = d.label;
    b.onclick = () => { state.dur = d; renderDurations(); };
    wrap.appendChild(b);
  });
}
function renderPref() { $$("#prefSel .node-btn").forEach((b) => b.classList.toggle("on", b.dataset.v === state.pref)); }

/* ---------- ④ 景区多选（含机位/穿搭/季节） ---------- */
function renderSpots() {
  const c = CITIES[state.city], wrap = $("#spotList");
  wrap.innerHTML = "";
  c.spots.forEach((s) => {
    const [id, name, price, hours, dur, zone, best, photo, desc, note, season, outfit] = s;
    const card = document.createElement("div");
    card.className = "spot-card" + (state.spots.has(id) ? " on" : "");
    card.innerHTML = `
      <div class="spot-top">
        <label class="spot-check"><input type="checkbox" ${state.spots.has(id) ? "checked" : ""}></label>
        <div class="spot-main">
          <div class="spot-name">${name}</div>
          <div class="spot-desc">${desc}</div>
          <div class="spot-meta">
            <span>🎫 ${price === 0 ? "免费" : fmt(price)}</span><span>🕐 ${hours}</span>
            <span>⏱ ${dur}h</span><span>📍${zone}</span>
          </div>
          <div class="spot-meta sub">
            <span>🌅 ${best}</span><span>📷 ${photo}</span>
          </div>
          <div class="spot-meta sub">
            <span>🍂 最佳季节：${season || "全年"}</span><span>👕 ${outfit || "按季节搭配"}</span>
          </div>
          ${note ? `<div class="spot-note">⚠️ ${note}</div>` : ""}
        </div>
      </div>`;
    card.onclick = () => { state.spots.has(id) ? state.spots.delete(id) : state.spots.add(id); renderSpots(); };
    wrap.appendChild(card);
  });
  $set("#spotCount", `已选 ${state.spots.size} / ${c.spots.length} 个景区`);
}

/* ---------- 公路里程与交通估价 ---------- */
function roadDist(c, fromKey, spotId) {
  const d = c.dist[fromKey];
  return d && d[spotId] != null ? d[spotId] : null;
}
function segDist(c, from, spotId) {
  const t = roadDist(c, from, spotId);
  if (t != null) return t;
  const zOf = (id) => { const s = c.spots.find((x) => x[0] === id); return s ? s[5] : null; };
  const dCur = c.dist.cen[spotId] != null ? c.dist.cen[spotId] : 8;
  const dPrev = c.dist.cen[from];
  if (dPrev == null) return dCur;
  if (zOf(from) === zOf(spotId)) return Math.max(3, Math.round(Math.abs(dCur - dPrev) * 10) / 10);
  return Math.round((dCur + dPrev) * 0.6 * 10) / 10;
}
function transportCost(c, km, people, pref) {
  const t = c.taxi;
  const taxi = Math.max(t.s, t.s + Math.max(0, km - t.sk) * t.p);
  const mins = km <= 30 ? Math.round(km * 2.2 + 4) : Math.round(km * 1.25 + 25);
  const busOK = c.busFare > 0 && km <= 25;
  let mode = pref === "taxi" ? "taxi" : pref === "bus" ? (busOK ? "bus" : "taxi")
    : (km <= 2 ? "walk" : (busOK && km <= 6 ? "bus" : "taxi"));
  if (mode === "walk") return { mode: "步行", cost: 0, costPer: 0, mins: Math.round(km * 13), note: `${km}km 步行最划算` };
  if (mode === "bus") return { mode: "公交/班车", cost: c.busFare * people, costPer: c.busFare, mins: Math.round(km * 3.2 + 10), note: `${km}km · 公交${c.busFare}元/人` };
  return { mode: "出租车/网约车", cost: taxi, costPer: Math.round(taxi / people * 10) / 10, mins, note: `${km}km · 打车${fmt(taxi)}（${people}人均摊${fmt(taxi / people)}）` };
}

/* ---------- 行程生成 ---------- */
function planTrip() {
  const c = CITIES[state.city];
  const sel = c.spots.filter((s) => state.spots.has(s[0]));
  const days = state.dur.d, nights = state.dur.n, people = state.people;
  if (!sel.length) { alert("请先勾选至少 1 个景区～"); return; }

  /* 分区聚类：先远后近 */
  const zones = [];
  sel.forEach((s) => {
    let g = zones.find((x) => x.zone === s[5]);
    if (!g) { g = { zone: s[5], spots: [] }; zones.push(g); }
    g.spots.push(s);
  });
  zones.forEach((g) => {
    g.maxD = Math.max(...g.spots.map((s) => roadDist(c, state.node, s[0]) ?? (c.dist.cen[s[0]] ?? 8)));
    g.spots.sort((a, b) => (roadDist(c, state.node, b[0]) ?? 0) - (roadDist(c, state.node, a[0]) ?? 0));
  });
  zones.sort((a, b) => b.maxD - a.maxD);

  const dayPlan = Array.from({ length: days }, () => ({ spots: [], fillers: [] }));
  zones.forEach((g) => {
    let t = dayPlan[0];
    dayPlan.forEach((d) => { if (d.spots.length < t.spots.length) t = d; });
    t.spots.push(...g.spots);
  });
  const pool = [...(c.fillers || [])];
  dayPlan.forEach((d) => {
    if (!d.spots.length) d.fillers.push(pool.shift() || "自由活动 · 城市漫游与补给休整");
  });

  const isXJ = c.cat === "xj";
  const bT = isXJ ? 540 : 480, lT = isXJ ? 810 : 720, dT = isXJ ? 1170 : 1110;
  const toHHMM = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;

  let totalTicket = 0, totalTransport = 0;
  const html = [];
  const season = SEASON[state.season].name;

  dayPlan.forEach((d, di) => {
    let t = bT;
    const rows = [row("🍚", "早餐", `${c.meals.b} · 酒店周边/本地早市（人均约${c.meals.bp}元）`)];
    t = bT + 60;
    let prevKey = di === 0 ? state.node : "cen";

    d.spots.forEach((s, i) => {
      const km = segDist(c, prevKey, s[0]);
      const tr = transportCost(c, km, people, state.pref);
      totalTransport += tr.cost;
      rows.push(row(trIcon(tr.mode), `前往【${s[1]}】`, `${tr.mode} · ${tr.note} · 约${tr.mins}分钟`));
      t += tr.mins;
      if (t >= lT - 20 && t < lT + 90) { rows.push(row("🍜", "午餐", `${c.meals.l} · 本地招牌（人均约${c.meals.lp}元）`)); t = lT + 90; }
      rows.push(row("📸", `游玩：${s[1]}`,
        `${s[3]} · 建议${s[4]}h · 门票${s[2] === 0 ? "免费" : fmt(s[2])}/人 · 最佳${s[6]} · 📷 ${s[7]}${s[10] ? " · 🍂" + s[10] : ""}${s[11] ? " · 👕" + s[11] : ""}${s[9] ? " · ⚠️" + s[9] : ""}`));
      totalTicket += s[2]; t += s[4] * 60;
      prevKey = s[0];
    });
    if (d.fillers.length) d.fillers.forEach((f) => { rows.push(row("🚶", f, "自由安排 · 无固定花费（体验项目自理）")); t += 150; });
    if (t < lT) { rows.push(row("🍜", "午餐", `${c.meals.l} · 本地招牌（人均约${c.meals.lp}元）`)); t = lT + 90; }
    if (t < dT - 60) rows.push(row("☕", "茶歇/回酒店小憩", `${toHHMM(t)}–${toHHMM(dT - 60)} · 蓄力`));
    rows.push(row("🍲", "晚餐", `${c.meals.d} · 夜市/本地菜（人均约${c.meals.dp}元）`));
    t = dT + 120;
    const backKm = c.dist.cen[prevKey] != null ? c.dist.cen[prevKey] : (roadDist(c, state.node, prevKey) ?? 8);
    const tr2 = transportCost(c, backKm, people, state.pref);
    totalTransport += tr2.cost;
    rows.push(row(trIcon(tr2.mode), "返回住宿", `${tr2.mode} · ${tr2.note} · 约${tr2.mins}分钟`));
    if (nights > di) rows.push(row("🏨", "入住/休息", di === 0 ? `抵达${c.name}，办理入住` : `连住（${state.hotelLevel === "econ" ? "经济" : "舒适"}型 ${c.hotel[state.hotelLevel === "econ" ? 0 : 1]}元/晚口径）`));

    html.push(`<div class="day-card">
      <div class="day-head"><span class="day-no">D${di + 1}</span>
        <span class="day-title">${di === 0 ? "抵达 " + c.name : c.name + "·" + (d.spots[0] ? d.spots[0][5] : "漫游日")}</span>
        <span class="day-n">${d.spots.length}个景区${d.fillers.length ? "+自由活动" : ""} · ${season}</span></div>
      <div class="timeline">${rows.join("")}</div></div>`);
  });

  /* 预算 */
  const mealsPerDay = c.meals.bp + c.meals.lp + c.meals.dp;
  const hotel = c.hotel[state.hotelLevel === "econ" ? 0 : 1];
  const rooms = Math.ceil(people / 2);
  const totalMeals = mealsPerDay * days * people;
  const totalHotel = hotel * nights * rooms;
  const total = totalTicket + totalTransport + totalMeals + totalHotel;

  /* 季节与备选 */
  const altPlan = buildAlt(c, sel);

  $("#planOut").innerHTML = `
    <div class="plan-head">
      <div class="plan-title">✍️ ${c.name} · ${state.dur.d}天${state.dur.n}晚 · ${people}人 · 从「${c.nodes[state.node]}」出发 · ${season}</div>
      <div class="plan-sub">价格核验 ${QUERY_DATE} · 门票以景区官方最新公告为准 · 公路里程为实际行车口径预估</div>
    </div>
    ${html.join("")}
    <div class="budget-card">
      <div class="day-head"><span class="day-no">💰</span><span class="day-title">预算总表</span></div>
      <table class="btable">
        <tr><th>项目</th><th>明细</th><th>金额</th></tr>
        <tr><td>门票</td><td>${sel.length}个景区 × ${people}人（学生/老人凭证多可半价）</td><td>${fmt(totalTicket)}</td></tr>
        <tr><td>市内交通</td><td>打车按车计 + 公交按人计</td><td>${fmt(totalTransport)}</td></tr>
        <tr><td>餐饮</td><td>早${c.meals.bp}+午${c.meals.lp}+晚${c.meals.dp}=${mealsPerDay}/人/天 × ${days}天 × ${people}人</td><td>${fmt(totalMeals)}</td></tr>
        <tr><td>住宿</td><td>${hotel}元/晚 × ${nights}晚 × ${rooms}间（2人1间）</td><td>${fmt(totalHotel)}</td></tr>
        <tr class="btotal"><td>合计</td><td>${state.hotelLevel === "econ" ? "经济版" : "舒适版"}</td><td>${fmt(total)}（人均 ${fmt(total / people)}）</td></tr>
      </table>
      <div class="plan-sub">💡 省钱：2人以上打车按车均摊更划算；学生证多数半价；大交通（火车/机票/城际包车）未含，请以12306/航司实时价为准。</div>
    </div>
    <div class="budget-card alt">
      <div class="day-head"><span class="day-no">🌦️</span><span class="day-title">${season}备选方案（极端天气/临时闭园）</span></div>
      <ul class="outfit-list">${altPlan}</ul>
    </div>`;
  $("#planOut").classList.remove("hidden");
  $("#planOut").scrollIntoView({ behavior: "smooth" });
}

function buildAlt(c, sel) {
  const out = [];
  const indoor = sel.filter((s) => /博物馆|故城|王府|寺|城|馆|村/.test(s[1]) && s[2] === 0);
  out.push(`<li><b>雨天/沙尘：</b>${indoor.length ? "改走 " + indoor.map((s) => s[1]).join("、") : "改室内场馆或老城街区（茶馆、巴扎、博物馆）"}</li>`);
  out.push(`<li><b>高温/酷暑：</b>改为早出（09:00前）与晚归（19:00后），午间安排茶馆/室内参观</li>`);
  out.push(`<li><b>临时闭园：</b>${(c.fillers || ["城市漫游"]).slice(0, 2).join(" / ")}</li>`);
  out.push(`<li><b>季节替代：</b>${(c.spots.filter((s) => !sel.includes(s)) || []).slice(0, 3).map((s) => s[1]).join("、") || "可调整出行月份，看本季最佳景区"}</li>`);
  return out.join("");
}

function trIcon(m) { return m.includes("步行") ? "🚶" : (m.includes("公交") || m.includes("班车")) ? "🚌" : "🚕"; }
function row(icon, title, sub) {
  return `<div class="tl-row"><div class="tl-icon">${icon}</div><div class="tl-body"><div class="tl-title">${title}</div><div class="tl-sub">${sub}</div></div></div>`;
}

/* ---------- 交互 ---------- */
function bindPlanner() {
  $("#genBtn").onclick = planTrip;
  $("#copyBtn").onclick = () => {
    const txt = $("#planOut").innerText;
    navigator.clipboard.writeText(txt).then(() => alert("攻略文本已复制，可发给同行者～"));
  };
  $("#printBtn").onclick = () => window.print();
  $$("#prefSel .node-btn").forEach((b) => b.onclick = () => { state.pref = b.dataset.v; renderPref(); });
  $$("#hotelSel .node-btn").forEach((b) => b.onclick = () => {
    state.hotelLevel = b.dataset.v;
    $$("#hotelSel .node-btn").forEach((x) => x.classList.toggle("on", x === b));
  });
  $$("#seasonSel .node-btn").forEach((b) => b.onclick = () => { state.season = b.dataset.v; renderSeason(); });
  $("#peopleSel").onchange = (e) => { state.people = Math.max(1, +e.target.value || 1); };
  $("#allSpots").onclick = () => { CITIES[state.city].spots.forEach((s) => state.spots.add(s[0])); renderSpots(); };
  $("#clearSpots").onclick = () => { state.spots.clear(); renderSpots(); };
  if ($("#citySearch")) $("#citySearch").oninput = renderCityChips;
}

/* ---------- 数据大屏 ---------- */
function animateNum(el, target, d, suffix, dur = 1800) {
  const t0 = performance.now();
  (function tick(now) {
    const p = Math.min(1, ((now || performance.now()) - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = (target * e).toFixed(d) + suffix;
    if (p < 1) requestAnimationFrame(tick);
  })(performance.now());
}
function bindStats() {
  animateNum($("#stVisitors"), XJ_STATS.visitors, 2, " 亿人次");
  animateNum($("#stSpend"), XJ_STATS.spend, 0, " 亿元");
  animateNum($("#stGV"), XJ_STATS.growthV, 2, " %");
  animateNum($("#stGS"), XJ_STATS.growthS, 1, " %");
  animateNum($("#stJobs"), XJ_STATS.jobs, 0, " 万人+");
  window.__drawCharts = () => {
    if (!window.echarts) return;
    const base = { textStyle: { color: "#e8e4d8", fontFamily: "inherit" }, grid: { top: 44, left: 48, right: 22, bottom: 32 }, tooltip: { backgroundColor: "rgba(10,16,28,.92)", borderColor: "#ffd166", textStyle: { color: "#ffd166" } } };
    const c1 = echarts.init($("#chartVisitors"));
    c1.setOption({ ...base, title: { text: "新疆历年接待游客（亿人次）", left: 8, top: 4, textStyle: { color: "#ffd166", fontSize: 14 } }, xAxis: { type: "category", data: XJ_STATS.trendYears, axisLine: { lineStyle: { color: "#5a6b8c" } } }, yAxis: { type: "value", splitLine: { lineStyle: { color: "rgba(120,140,180,.15)" } } }, series: [{ type: "bar", data: XJ_STATS.visitorsTrend, barWidth: "46%", itemStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "#ffd166" }, { offset: 1, color: "#c98a2b" }] }, borderRadius: [6, 6, 0, 0] }, label: { show: true, position: "top", color: "#ffd166" } }] });
    const c2 = echarts.init($("#chartSpend"));
    c2.setOption({ ...base, title: { text: "新疆游客花费（亿元）", left: 8, top: 4, textStyle: { color: "#06d6a0", fontSize: 14 } }, xAxis: { type: "category", data: XJ_STATS.spendYears, axisLine: { lineStyle: { color: "#5a6b8c" } } }, yAxis: { type: "value", splitLine: { lineStyle: { color: "rgba(120,140,180,.15)" } } }, series: [{ type: "line", data: XJ_STATS.spendTrend, smooth: true, symbolSize: 9, lineStyle: { color: "#06d6a0", width: 3 }, itemStyle: { color: "#06d6a0" }, areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "rgba(6,214,160,.4)" }, { offset: 1, color: "rgba(6,214,160,0)" }] } }, label: { show: true, position: "top", color: "#06d6a0" } }] });
    window.addEventListener("resize", () => { c1.resize(); c2.resize(); window.__mapChart && window.__mapChart.resize(); });
  };
  loadEcharts();
}
function loadEcharts() {
  if (window.echarts) { window.__drawCharts(); initMapRender(); return; }
  const s = document.createElement("script");
  s.src = "assets/echarts.min.js";
  s.onload = () => { window.__drawCharts(); initMapRender(); };
  s.onerror = () => { $set("#chartVisitors", "图表组件加载失败（请确认 assets/echarts.min.js 存在）"); };
  document.head.appendChild(s);
}

/* ---------- 全国实时数据面板 ---------- */
function loadLiveData() {
  const n = NAT_STATS;
  const paint = (d) => {
    animateNum($("#natTrips"), d.trips, 2, " 亿人次");
    animateNum($("#natSpend"), d.spend, 2, " 万亿元");
    animateNum($("#natInbound"), d.inbound, 0, " 万人次");
    animateNum($("#natScenic"), d.aScenic, 0, " 个");
    $set("#natTripsG", "同比 +" + d.tripsGrowth + "%");
    $set("#natSpendG", "同比 +" + d.spendGrowth + "%");
    $set("#natInboundG", "同比 +" + d.inboundGrowth + "%");
    $set("#natScenicG", `A级景区接待 ${d.aScenicTrips}亿人次 · 收入 ${d.aScenicSpend}亿元`);
    $set("#natExtra", `星级饭店均价 ${d.hotelAvgPrice}元/间夜 · 备案博物馆 ${d.museums}家 · 世界遗产 ${d.heritage}项`);
    $set("#natSource", (d.source || NAT_STATS.source) + (d.updated ? ` ｜ 更新：${d.updated}` : ""));
  };
  fetch("assets/live-data.json?t=" + Date.now())
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((d) => paint(d))
    .catch(() => paint(NAT_STATS));
  $set("#liveNote", LIVE_SOURCES.note);
  $("#srcList").innerHTML = LIVE_SOURCES.items.map((i) =>
    `<li><b>${i.name}</b> · ${i.freq}更新 · ${i.field}</li>`).join("");
}

/* ---------- 动态中国地图（本地国标边界） ---------- */
let mapChart = null;
function initMap() { }
function initMapRender() {
  if (!window.echarts || !window.CHINA_GEO) { setTimeout(() => { if (window.echarts && window.CHINA_GEO) initMapRender(); }, 400); return; }
  try {
    echarts.registerMap("china", window.CHINA_GEO);
    mapChart = echarts.init($("#chinaMap"));
    window.__mapChart = mapChart;
    const pts = Object.entries(CITIES).map(([id, c]) => ({ name: c.name, value: [c.lng, c.lat, HEAT[id] || 3], id }));
    const coordOf = (n) => { const e = Object.values(CITIES).find((c) => c.name === n); return e ? [e.lng, e.lat] : null; };
    const links = [];
    [["乌鲁木齐", "喀什"], ["乌鲁木齐", "伊宁"], ["乌鲁木齐", "阿勒泰"], ["乌鲁木齐", "库车"],
    ["喀什", "塔什库尔干县"], ["喀什", "莎车县"], ["喀什", "和田"], ["库车", "阿克苏"], ["库车", "库尔勒"],
    ["乌鲁木齐", "昌吉市"], ["昌吉市", "阜康市"], ["伊宁", "特克斯县"], ["伊宁", "昭苏县"], ["伊宁", "霍城县"],
    ["阿勒泰", "布尔津县"], ["阿勒泰", "富蕴县"], ["库尔勒", "和静县"], ["吐鲁番", "鄯善县"], ["哈密市伊州区", "巴里坤哈萨克自治县"],
    ["乌鲁木齐", "北京"], ["乌鲁木齐", "西安"], ["北京", "天津"], ["北京", "平遥县"], ["西安", "敦煌"],
    ["西安", "洛阳"], ["洛阳", "登封市"], ["成都", "稻城县"], ["成都", "九寨沟县"], ["成都", "重庆"],
    ["重庆", "张家界"], ["张家界", "凤凰县"], ["长沙", "井冈山市"], ["长沙", "婺源县"], ["杭州", "黟县"],
    ["杭州", "南京"], ["南京", "武汉"], ["武汉", "青岛"], ["青岛", "哈尔滨"], ["兰州", "西宁"],
    ["兰州", "银川"], ["西宁", "香格里拉市"], ["昆明", "大理"], ["大理", "丽江"], ["桂林", "阳朔县"],
    ["贵阳", "西双版纳"], ["广州", "三亚"], ["厦门", "杭州"]].forEach(([a, b]) => {
      const ca = coordOf(a), cb = coordOf(b);
      if (ca && cb) links.push({ coords: [ca, cb] });
    });
    mapChart.setOption({
      backgroundColor: "transparent",
      tooltip: {
        backgroundColor: "rgba(10,16,28,.92)", borderColor: "#ffd166", textStyle: { color: "#ffd166" },
        formatter: (p) => { const c = Object.values(CITIES).find((x) => x.name === p.name); return c ? `<b>${c.full}</b><br/>${c.tag}<br/>热度 ${HEAT[Object.keys(CITIES).find((k) => CITIES[k] === c)] || 3}/5` : p.name; },
      },
      geo: {
        map: "china", roam: true, zoom: 1.15,
        itemStyle: { areaColor: "rgba(24,38,66,.85)", borderColor: "#4f7ea8", borderWidth: 1 },
        emphasis: { itemStyle: { areaColor: "rgba(255,209,102,.28)" }, label: { color: "#ffd166" } },
      },
      series: [
        { type: "effectScatter", coordinateSystem: "geo", data: pts, symbolSize: (v) => 6 + (v[2] || 3), rippleEffect: { brushType: "stroke", scale: 3 }, itemStyle: { color: "#ffd166", shadowBlur: 12, shadowColor: "#ffd166" }, label: { show: false }, zlevel: 2 },
        { type: "lines", coordinateSystem: "geo", data: links, zlevel: 1, lineStyle: { color: "#4f9fd8", width: 1.1, opacity: 0.4, curveness: 0.25 }, effect: { show: true, period: 5, trailLength: 0.25, symbol: "arrow", symbolSize: 5, color: "#06d6a0" } },
      ],
    });
    mapChart.on("click", (p) => {
      const hit = Object.entries(CITIES).find(([, c]) => c.name === p.name);
      if (hit) {
        state.region = (PARENT[hit[0]] && PARENT[hit[0]].p) || state.region;
        state.city = hit[0]; state.spots.clear(); state.node = "rail";
        renderRegions(); renderCityChips(); renderCityInfo(); renderNodes(); renderSpots(); renderSeason();
        document.getElementById("planner").scrollIntoView({ behavior: "smooth" });
      }
    });
  } catch (e) { $("#chinaMap").innerHTML = '<p class="offline-tip">地图初始化异常：' + e.message + "</p>"; }
}
