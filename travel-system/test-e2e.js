/* 端到端冒烟测试：加载页面 → 校验渲染 → 模拟点击 → 生成攻略 → 截图 */
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

  await page.goto("http://127.0.0.1:8642/index.html", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1500);

  const r1 = await page.evaluate(() => ({
    cities: document.querySelectorAll("#cityChips .chip").length,
    spots: document.querySelectorAll(".spot-card").length,
    durBtns: document.querySelectorAll(".dur-btn").length,
    nodeBtns: document.querySelectorAll("#nodeSel .node-btn").length,
    mapCanvas: !!document.querySelector("#chinaMap canvas"),
    chartCanvas: document.querySelectorAll(".chart-box canvas").length,
    statNum: document.getElementById("stVisitors").textContent.trim(),
    ciName: document.getElementById("ciName").textContent,
  }));
  console.log("初始渲染:", JSON.stringify(r1));

  // 1. 搜索过滤
  await page.fill("#citySearch", "库车");
  await page.waitForTimeout(300);
  const r2 = await page.evaluate(() => document.querySelectorAll("#cityChips .chip").length);
  console.log("搜索'库车'命中城市数:", r2);
  await page.fill("#citySearch", "");

  // 2. 切换城市 → 喀什
  await page.click("#cityChips .chip:nth-child(1)"); // 第一个（按对象顺序是乌鲁木齐）
  await page.waitForTimeout(300);
  const cityNames = await page.evaluate(() => Array.from(document.querySelectorAll("#cityChips .chip")).map(b => b.textContent.trim()));
  const kashgarChip = cityNames.findIndex(n => n.includes("喀什"));
  await page.click(`#cityChips .chip:nth-child(${kashgarChip + 1})`);
  await page.waitForTimeout(300);
  console.log("切换到喀什后景点数:", await page.evaluate(() => document.querySelectorAll(".spot-card").length));

  // 3. 全选景点 + 选时长 + 生成攻略
  await page.click("#allSpots");
  await page.click(".dur-btn:nth-child(3)"); // 三天两晚
  await page.click("#genBtn");
  await page.waitForTimeout(600);
  const r3 = await page.evaluate(() => ({
    planVisible: !document.getElementById("planOut").classList.contains("hidden"),
    dayCards: document.querySelectorAll(".day-card").length,
    tlRows: document.querySelectorAll(".tl-row").length,
    budgetRows: document.querySelectorAll(".btable tr").length,
    budgetTotal: (document.querySelector(".btable .btotal td:last-child") || {}).textContent || "",
  }));
  console.log("攻略生成:", JSON.stringify(r3));

  // 4. 地图点击联动（点击地图区域中的光点较难，改为验证地图存在 + 城市切换正常）
  // 5. 出发地切换 + 人数修改
  await page.click("#nodeSel .node-btn:nth-child(1)");
  await page.fill("#peopleSel", "4");
  await page.click("#genBtn");
  await page.waitForTimeout(400);
  console.log("改4人后预算合计:", await page.evaluate(() => document.querySelector(".btable .btotal td:last-child").textContent));

  // 6. 地图渲染截图 + 整页截图
  await page.evaluate(() => document.getElementById("mapSec").scrollIntoView());
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "test-map.png", clip: { x: 0, y: await page.evaluate(() => document.getElementById("chinaMap").getBoundingClientRect().top + window.scrollY), width: 1440, height: 560 } });
  await page.evaluate(() => document.getElementById("planOut").scrollIntoView());
  await page.screenshot({ path: "test-plan.png", fullPage: false });

  console.log("控制台错误(除favicon):", errors.filter(e => !e.includes("favicon")).length ? errors : "无");
  await browser.close();
})().catch((e) => { console.error("测试失败:", e.message); process.exit(1); });
