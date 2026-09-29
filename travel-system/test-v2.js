/* v2 回归测试：层级联动 / 县城切换 / 季节穿搭 / 面板 / 生成攻略 */
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

  await page.goto("http://127.0.0.1:8642/index.html", { waitUntil: "networkidle", timeout: 40000 });
  await page.waitForTimeout(2000);

  const r1 = await page.evaluate(() => ({
    totalCity: document.getElementById("totalCity").textContent,
    totalSpot: document.getElementById("totalSpot").textContent,
    regions: document.querySelectorAll("#regionChips .chip").length,
    citiesInRegion: document.querySelectorAll("#cityChips .chip").length,
    spots: document.querySelectorAll(".spot-card").length,
    mapCanvas: !!document.querySelector("#chinaMap canvas"),
    charts: document.querySelectorAll(".chart-box canvas").length,
    natTrips: document.getElementById("natTrips").textContent.trim(),
    natSpend: document.getElementById("natSpend").textContent.trim(),
    outfit: document.getElementById("outfitBox").innerText.slice(0, 40),
    heat: document.getElementById("ciHeat").textContent.trim(),
  }));
  console.log("初始:", JSON.stringify(r1));

  // 切换到昌吉回族自治州 → 阜康市（天山天池）
  const regions = await page.evaluate(() => Array.from(document.querySelectorAll("#regionChips .chip")).map(e => e.textContent.trim()));
  const cjIdx = regions.findIndex(t => t.includes("昌吉"));
  await page.click(`#regionChips .chip:nth-child(${cjIdx + 1})`);
  await page.waitForTimeout(300);
  const cities = await page.evaluate(() => Array.from(document.querySelectorAll("#cityChips .chip")).map(e => e.textContent.trim()));
  console.log("昌吉州下属:", cities.join(" / "));
  const fkIdx = cities.findIndex(t => t.includes("阜康"));
  await page.click(`#cityChips .chip:nth-child(${fkIdx + 1})`);
  await page.waitForTimeout(300);
  console.log("阜康景点:", await page.evaluate(() => document.querySelectorAll(".spot-card").length));

  // 季节切换：秋季
  await page.click('#seasonSel .node-btn[data-v="autumn"]');
  await page.waitForTimeout(300);
  console.log("秋季穿搭:", (await page.evaluate(() => document.getElementById("outfitBox").innerText)).slice(0, 60).replace(/\n/g, " "));

  // 生成攻略
  await page.click("#allSpots");
  await page.click(".dur-btn:nth-child(3)");
  await page.click("#genBtn");
  await page.waitForTimeout(600);
  const r3 = await page.evaluate(() => ({
    dayCards: document.querySelectorAll(".day-card").length,
    tlRows: document.querySelectorAll(".tl-row").length,
    total: (document.querySelector(".btable .btotal td:last-child") || {}).textContent || "",
    alt: document.querySelectorAll(".budget-card.alt li").length,
    hasPhoto: document.getElementById("planOut").innerText.includes("📷"),
    hasOutfit: document.getElementById("planOut").innerText.includes("👕"),
  }));
  console.log("攻略:", JSON.stringify(r3));

  // 测试一个月档位
  await page.click(".dur-btn:nth-child(9)");
  await page.click("#genBtn");
  await page.waitForTimeout(600);
  console.log("30天档天数卡:", await page.evaluate(() => document.querySelectorAll(".day-card").length));

  await page.screenshot({ path: "test-v2.png", fullPage: false });
  console.log("错误:", errors.filter(e => !e.includes("favicon")).length ? errors : "无");
  await browser.close();
})().catch(e => { console.error("测试失败:", e.message); process.exit(1); });
