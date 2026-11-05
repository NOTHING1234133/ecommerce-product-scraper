// 采集通用库:风控检测、京东滑块求解、京东/淘宝列表解析
// 运行时:Ego Lite + ego-browser CLI(https://www.citrolabs.com)
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const SEARCH_URL = {
  jd: (kw) => `https://search.jd.com/Search?keyword=${encodeURIComponent(kw)}&enc=utf-8`,
  taobao: (kw) => `https://s.taobao.com/search?q=${encodeURIComponent(kw)}`,
  pdd: (kw) => `https://mobile.yangkeduo.com/search_result.html?search_key=${encodeURIComponent(kw)}`
};

// 页面状态检测:验证页 / 限流页 / 正常列表
export async function pageKind(page, platform = "jd") {
  const url = await page.url().catch(() => "");
  if (url.includes("cfe.m.jd.com") || url.includes("risk_handler") || url.includes("psnl_verification")) return "captcha";
  const s = await page.evaluate(() => {
    const t = document.body?.innerText || "";
    return {
      rateLimited: t.includes("访问频繁") || t.includes("系统繁忙") || t.includes("请稍后再试"),
      hasList: document.querySelectorAll("[data-sku], [class*='doubleCardWrapperAdapt']").length > 0
    };
  }).catch(() => ({ rateLimited: false, hasList: false }));
  if (s.rateLimited) return "ratelimit";
  if (s.hasList) return "list";
  return "unknown";
}

// 京东滑块拼图自动求解:DOM 定位把手 → canvas 像素扫描找缺口 → 人手轨迹拖动
// 失败一次即返回 false(调用方应通知用户手动过,不要重试)
export async function solveJdSlider(page) {
  const geo = await page.evaluate(() => {
    const move = document.querySelector(".move-img, [class*='move-img']");
    const rect = (el) => { const r = el?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; };
    const pieces = [...document.querySelectorAll("img")].map(rect).filter((r) => r && r.w > 40 && r.h > 100 && r.x > 0);
    return { handle: rect(move), pieces };
  });
  const handle = geo.handle || { x: 815, y: 550, w: 48, h: 48 };
  const gapX = await page.evaluate(() => {
    const img = [...document.querySelectorAll("img")].find((e) => e.getBoundingClientRect().width > 250);
    if (!img) return null;
    const r = img.getBoundingClientRect();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth || Math.round(r.width);
    c.height = img.naturalHeight || Math.round(r.height);
    const ctx = c.getContext("2d");
    try { ctx.drawImage(img, 0, 0, c.width, c.height); } catch { return null; }
    try {
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const lum = (x, y) => { const i = (y * c.width + x) * 4; return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; };
      const y0 = Math.round(c.height * 0.3), y1 = Math.round(c.height * 0.7);
      const col = [];
      for (let x = 0; x < c.width; x++) {
        let s = 0, n = 0;
        for (let y = y0; y < y1; y += 2) { s += lum(x, y); n++; }
        col.push(s / n);
      }
      let best = null;
      const w = 60;
      for (let x = Math.round(c.width * 0.3); x + w + 40 < c.width; x++) {
        const inside = col.slice(x, x + w).reduce((a, b) => a + b, 0) / w;
        const la = col.slice(Math.max(0, x - 40), x), ra = col.slice(x + w, x + w + 40);
        const dark = ((la.reduce((a, b) => a + b, 0) / Math.max(1, la.length)) + (ra.reduce((a, b) => a + b, 0) / Math.max(1, ra.length))) / 2 - inside;
        if (dark > 18 && (!best || dark > best.dark)) best = { x: x + w / 2, dark };
      }
      return best ? r.x + best.x * (r.width / c.width) : null;
    } catch { return null; }
  });
  if (!gapX) return false;
  const piece = geo.pieces.find((p) => p.w < 120 && p.w > 40) || { x: handle.x, w: 68 };
  const dist = Math.round(gapX - (piece.x + piece.w / 2));
  if (dist < 40 || dist > 260) return false;
  await humanDrag(page, handle.x + handle.w / 2, handle.y + handle.h / 2, dist);
  await sleep(2500);
  return (await pageKind(page)) !== "captcha";
}

// 人手轨迹拖动:分段加速→减速→微超调→回拉,带随机抖动与随机停顿
export async function humanDrag(page, sx, sy, dist) {
  await page.mouse.move(sx, sy, { label: "grab slider" });
  await sleep(300 + Math.floor(Math.random() * 300));
  await page.mouse.down();
  const plan = [];
  for (let i = 1; i <= 16; i++) plan.push(Math.round((dist * 0.65 * i) / 16));
  for (let i = 1; i <= 10; i++) plan.push(Math.round(dist * 0.65 + (dist * 0.35 * i) / 10));
  plan.push(dist + 5, dist);
  for (const t of plan) {
    await page.mouse.move(sx + t, sy + (Math.random() * 3 - 1.5), { label: "drag slider" });
    await sleep(10 + Math.floor(Math.random() * 40));
  }
  await sleep(300);
  await page.mouse.up();
}

// 京东列表解析:新版 CSS modules 结构,字段从 chat.jd.com 链接 query decode
export async function parseJdList(page) {
  return page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("[data-sku]")) {
      const sku = el.getAttribute("data-sku") || "";
      const nameEl = el.querySelector("[class*='_wrapper_'][title]") || el.querySelector("[title]");
      const price = (el.querySelector("[class*='_price_']")?.innerText || "").trim().replace(/\s+/g, "");
      const imgEl = el.querySelector("img[data-src], img[src*='360buyimg']");
      const chatLink = el.querySelector("a[href*='chat.jd.com']")?.href || "";
      let wname = "", seller = "", commentNum = "", stock = "";
      try {
        const q = new URL(chatLink).searchParams;
        const dec = (v) => { try { return decodeURIComponent(decodeURIComponent(v || "")); } catch { return decodeURIComponent(v || ""); } };
        wname = dec(q.get("wname")); seller = dec(q.get("seller"));
        commentNum = dec(q.get("commentNum")); stock = dec(q.get("stock"));
      } catch {}
      const m = (commentNum || "").match(/([\d.]+)\s*万\+/);
      out.push({
        sku, title: (wname || nameEl?.getAttribute("title") || "").trim(), price,
        commentNum, commentNumVal: m ? Math.round(parseFloat(m[1]) * 10000) : (parseInt(commentNum) || 0),
        seller, stock,
        img: imgEl ? (imgEl.getAttribute("data-src") || imgEl.getAttribute("src") || "") : "",
        url: `https://item.jd.com/${sku}.html`
      });
    }
    return out.filter((x) => x.title);
  });
}

// 淘宝列表解析:doubleCard 卡片 + 本地清洗(价格拆行/销量杂质)
export async function parseTaobaoList(page) {
  const raw = await page.evaluate(() => {
    const out = [];
    for (const c of document.querySelectorAll("[class*='doubleCardWrapperAdapt']")) {
      const txt = (sel) => (c.querySelector(sel)?.innerText || "").trim();
      const img = c.querySelector("img");
      const itemId = c.querySelector("a[href*='item.taobao.com'], a[href*='detail.tmall.com']")?.href?.match(/id=(\d+)/)?.[1] || "";
      out.push({
        id: itemId,
        title: txt("[class*='title']"),
        priceRaw: txt("[class*='priceInt'], [class*='price']"),
        salesRaw: txt("[class*='realSales']").replace(/已售|人付款|人收货/g, "").trim(),
        shopRaw: txt("[class*='shopName']"),
        loc: txt("[class*='proCity']"),
        img: img ? (img.getAttribute("data-src") || img.getAttribute("src") || "") : "",
        url: itemId ? `https://item.taobao.com/item.htm?id=${itemId}` : (c.getAttribute("href") || "").slice(0, 120)
      });
    }
    return out.filter((x) => x.title && x.priceRaw);
  });
  // 本地清洗,不重访页面
  const SHOP_PAT = /(旗舰店|专卖店|专营店|自营|超市|农场|直营|严选|代购|折扣|小店|企业店)/;
  for (const r of raw) {
    const pm = reDigit(r.priceRaw);
    r.price = pm || "";
    const sm = (r.salesRaw || "").replace(/\s/g, "").match(/([\d.]+万?\+?)/);
    r.sales = sm ? sm[1] + "人付款" : "";
    const parts = (r.shopRaw || "").split(/[\n|]/).map((s) => s.trim()).filter(Boolean);
    r.shop = [...parts].reverse().find((p) => SHOP_PAT.test(p)) || parts[parts.length - 1] || "";
    delete r.priceRaw; delete r.salesRaw; delete r.shopRaw;
  }
  return raw;
}

function reDigit(s) {
  const m = (s || "").replace(/\s+/g, "").match(/(\d+(?:\.\d{1,2})?)/);
  return m ? m[1] : "";
}

// 确保到达搜索结果页;京东滑块自动求解一次,失败交人工
export async function ensureSearchPage(page, platform, keyword, { maxRetries = 5 } = {}) {
  for (let i = 0; i < maxRetries; i++) {
    const kind = await pageKind(page, platform);
    if (kind === "list") return true;
    if (kind === "captcha") {
      console.log(`[${platform}] captcha, trying auto solver...`);
      const ok = platform === "jd" ? await solveJdSlider(page) : false;
      if (!ok) { console.log(`[${platform}] NEED_MANUAL_VERIFY: 请用户在浏览器中手动完成验证`); return false; }
    } else if (kind === "ratelimit") {
      console.log(`[${platform}] rate limited, waiting 45s...`);
      await sleep(45000);
    }
    if ((await pageKind(page, platform)) !== "list") {
      await page.goto(SEARCH_URL[platform](keyword), { timeout: 30000 }).catch(() => {});
      await page.waitForLoadState("load", { timeout: 20000 }).catch(() => {});
      await sleep(3000 + Math.floor(Math.random() * 3000));
    }
  }
  return (await pageKind(page, platform)) === "list";
}

// 滚动翻页采集(带去重、限流/验证检测、连续两批无新商品即止)
export async function collectBatches(page, platform, { maxBatches = 8, seen = new Map(), pauseMs = 4000, parser } = {}) {
  let stagnant = 0;
  for (let b = 1; b <= maxBatches; b++) {
    const kind = await pageKind(page, platform);
    if (kind === "captcha") {
      const ok = platform === "jd" ? await solveJdSlider(page) : false;
      if (!ok) { console.log(`[${platform}] captcha, NEED_MANUAL_VERIFY`); break; }
      continue;
    }
    if (kind === "ratelimit") {
      console.log(`[${platform}] rate limited, waiting 45s...`);
      await sleep(45000);
      await page.reload({ timeout: 30000 }).catch(() => {});
      await sleep(3000);
      continue;
    }
    if (kind !== "list") {
      await page.goto(SEARCH_URL[platform](globalThis.__kw__ || ""), { timeout: 30000 }).catch(() => {});
      await sleep(4000);
      continue;
    }
    const rows = await parser(page);
    let fresh = 0;
    for (const r of rows) {
      const key = r.sku || r.id || r.title.slice(0, 40);
      if (!seen.has(key)) { r.batch = b; seen.set(key, r); fresh++; }
    }
    console.log(`[${platform}] batch ${b}: parsed ${rows.length}, new ${fresh}, total ${seen.size}`);
    if (fresh === 0) { stagnant++; if (stagnant >= 2) break; } else stagnant = 0;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(pauseMs + Math.floor(Math.random() * 2000));
  }
  return seen;
}
