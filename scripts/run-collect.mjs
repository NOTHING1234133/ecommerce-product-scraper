// 采集入口:读 config.json → 按 config.platforms 顺序逐平台采集 → 每平台落一个 json
// 用法: ego-browser nodejs -e "await import('file:///<绝对路径>/run-collect.mjs')"
// 关键词与平台列表在 config.json 中配置(脚本不继承环境变量)
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SEARCH_URL, ensureSearchPage, collectBatches, parseJdList, parseTaobaoList, pageKind } from "./lib-ego.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CFG = JSON.parse(await readFile(`${HERE}/config.json`, "utf-8"));
const DIR = CFG.dataDir;
await mkdir(DIR, { recursive: true });
globalThis.__kw__ = CFG.keyword;

const loadJSON = async (f, dflt) => { try { return JSON.parse(await readFile(f, "utf-8")); } catch { return dflt; } };
const PARSERS = { jd: parseJdList, taobao: parseTaobaoList };
const SPACE = `eps-${CFG.keyword.slice(0, 12)}-${Date.now() % 10000}`;

const results = {};
for (const platform of CFG.platforms || ["jd", "taobao"]) {
  const parser = PARSERS[platform];
  if (!parser) { console.log(`[${platform}] no parser, skip`); continue; }
  const task = await taskSpace(`${SPACE}-${platform}`);
  const page = task.page("p1");
  console.log(`\n=== ${platform.toUpperCase()} : ${CFG.keyword} ===`);
  await page.goto(SEARCH_URL[platform](CFG.keyword), { timeout: 30000 }).catch((e) => console.log(`[${platform}] nav err:`, e.message.slice(0, 60)));
  await page.waitForLoadState("load", { timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 5000));

  const ok = await ensureSearchPage(page, platform, CFG.keyword, { maxRetries: 5 });
  if (!ok) {
    console.log(`[${platform}] FAILED: 未到达搜索结果页(验证/限流),跳过该平台`);
    results[platform] = { error: "need_manual_verify_or_ratelimited" };
    continue;
  }
  const saved = await loadJSON(`${DIR}/${platform}-${CFG.keyword}.json`, []);
  const seen = new Map(saved.map((r) => [r.sku || r.id || r.title, r]));
  await collectBatches(page, platform, {
    maxBatches: CFG.maxBatchesPerPlatform || 8,
    seen, parser,
    pauseMs: CFG.scrollPauseMs || 4000
  });
  const rows = [...seen.values()];
  await writeFile(`${DIR}/${platform}-${CFG.keyword}.json`, JSON.stringify(rows, null, 1), "utf-8");
  results[platform] = { count: rows.length };
  console.log(`[${platform}] SAVED ${rows.length} rows -> ${platform}-${CFG.keyword}.json`);
}

console.log("\nCOLLECT_RESULT:", JSON.stringify(results, null, 1));
console.log("下一步: python clean-merge.py --dir", DIR, "--keyword", CFG.keyword);
