# ecommerce-product-scraper

按关键词采集电商商品数据(京东/淘宝/拼多多)并输出 Excel 的 agent skill。真浏览器自动化 — 指纹真实、登录态复用,不是裸 HTTP 爬虫。

> 实测:京东 30 条 + 详情 20 全字段落库(含滑块自动求解);淘宝 47 条零验证一次过。采集器已在生产环境验证,反爬处理逻辑均来自真实对抗。

## 平台支持

| 平台 | 路线 | 可靠性 |
|---|---|---|
| 京东 | 真浏览器,滑块自动求解 | ✅ 高 |
| 淘宝 | 真浏览器(登录态) | ✅ 高,通常零验证 |
| 拼多多 | H5(需人工过滑块) | ⚠️ 低,限流频繁 |
| 抖音 | ❌ web 无商城入口 | 需精选联盟 API(不含) |

## 快速开始

### 1. 依赖

- [Ego Lite](https://www.citrolabs.com) + `ego-browser` CLI(真浏览器托管运行时)
- Node.js ≥ 18、Python ≥ 3.10(`pip install openpyxl`)
- 京东 / 淘宝 / 拼多多账号各扫码登录一次(登录态长期复用)

> 供 AI agent 使用时:把本仓库放入 agent 的 skills 目录,agent 按 `SKILL.md` 自动执行全流程(含引导用户扫码、验证兜底、限流报告)。

### 2. 配置

编辑 `scripts/config.json`:

```json
{
  "keyword": "五常大米",
  "platforms": ["jd", "taobao", "pdd"],
  "maxBatchesPerPlatform": 8,
  "scrollPauseMs": 4000,
  "dataDir": "C:/Users/<你>/ecom-scraper-data"
}
```

### 3. 采集 + 出表

```bash
# 采集(在 ego-browser nodejs 运行时内)
ego-browser nodejs -e "await import('file:///<本仓库绝对路径>/scripts/run-collect.mjs')"

# 合并出 Excel
python scripts/clean-merge.py --dir <dataDir> --keyword 五常大米
```

输出:`<dataDir>/五常大米-采集结果.xlsx`,按平台分 Sheet(京东红/淘宝橙/拼多多红头),字段统一:SKU · 标题 · 价格 · 销量/评论量 · 店铺 · 发货地 · 链接 · 主图。

## 工作原理

- **京东滑块求解器**:DOM 定位滑块把手 → 页内 canvas 像素扫描找缺口坐标 → 分段变速 + 随机停顿的人手轨迹拖动。失败一次即转人工,不重试(重试会加深风控画像)。
- **限流恢复**:检测"访问频繁/系统繁忙" → 等待 45s → reload;连续失败即停,换时段再来。
- **断点续跑**:每平台数据落 JSON,重跑自动合并去重,支持跨天多轮采集。
- **字段兜底**:京东新版搜索页为 CSS modules 结构,商品字段从 `chat.jd.com` 链接 query 中 decode,稳定性高于 DOM 解析。

## 风控纪律(内置,不可关闭)

慢节奏 + 随机抖动;验证人工兜底;限流不硬磨;采集数据仅用于线索初筛,正式取证另走公证。

## License

MIT
