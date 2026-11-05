#!/usr/bin/env python3
"""清洗合并各平台 JSON → 单个 xlsx(按平台分 Sheet)。
用法: python clean-merge.py --dir <数据目录> --keyword <关键词> [--out <输出.xlsx>]
"""
import argparse, json, sys
from pathlib import Path

try:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    from openpyxl.utils import get_column_letter
except ImportError:
    sys.exit("需要 openpyxl: pip install openpyxl")

PLATFORM_META = {
    "jd":     {"sheet": "京东",   "color": "E1251B",
               "cols": [("sku", "SKU", 16), ("title", "商品标题", 55), ("price", "价格", 10),
                        ("commentNum", "评论量", 10), ("seller", "店铺", 26), ("stock", "库存", 8),
                        ("url", "商品链接", 32), ("img", "主图URL", 40)]},
    "taobao": {"sheet": "淘宝",   "color": "FF5000",
               "cols": [("id", "商品ID", 16), ("title", "商品标题", 55), ("price", "价格", 10),
                        ("sales", "销量", 14), ("shop", "店铺", 24), ("loc", "发货地", 12),
                        ("url", "商品链接", 36), ("img", "主图URL", 40)]},
    "pdd":    {"sheet": "拼多多", "color": "D22822",
               "cols": [("title", "商品标题", 55), ("price", "价格", 10), ("sold", "已拼", 14),
                        ("url", "商品链接", 36), ("img", "主图URL", 40)]},
}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True, help="数据目录(平台 JSON 所在)")
    ap.add_argument("--keyword", required=True)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    data_dir = Path(args.dir)
    out_path = Path(args.out) if args.out else data_dir / f"{args.keyword}-采集结果.xlsx"

    wb = Workbook()
    wb.remove(wb.active)
    total = 0
    for plat, meta in PLATFORM_META.items():
        f = data_dir / f"{plat}-{args.keyword}.json"
        if not f.exists():
            print(f"[skip] {plat}: {f.name} 不存在")
            continue
        rows = json.loads(f.read_text(encoding="utf-8"))
        if not rows:
            print(f"[skip] {plat}: 0 rows")
            continue
        ws = wb.create_sheet(f"{meta['sheet']}-{args.keyword}"[:31])
        ws.append([c[1] for c in meta["cols"]])
        for i in range(1, len(meta["cols"]) + 1):
            c = ws.cell(1, i)
            c.fill = PatternFill("solid", fgColor=meta["color"])
            c.font = Font(bold=True, color="FFFFFF")
            ws.column_dimensions[get_column_letter(i)].width = meta["cols"][i - 1][2]
        for r in rows:
            ws.append([r.get(c[0], "") for c in meta["cols"]])
        ws.freeze_panes = "A2"
        total += len(rows)
        print(f"[ok] {plat}: {len(rows)} rows")

    if total == 0:
        sys.exit("没有任何平台数据,请先运行采集")
    wb.save(out_path)
    print(f"\nSAVED: {out_path} (total {total} rows)")

if __name__ == "__main__":
    main()
