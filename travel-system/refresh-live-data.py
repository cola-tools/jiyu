# -*- coding: utf-8 -*-
"""
攻略小家 · 实时数据刷新脚本
用途：把官方发布的旅游统计数据写入 assets/live-data.json，供网站数据面板读取。

用法：
    python refresh-live-data.py                 # 交互式手动录入（推荐，数据最可靠）
    python refresh-live-data.py --from-json x.json   # 从已整理好的 JSON 合并写入

部署自动化建议（三选一）：
1) GitHub Actions：每月定时运行本脚本 → 提交 assets/live-data.json → Pages 自动生效
2) 腾讯云函数 SCF / 阿里云 FC：定时触发器运行，写入 COS/OSS 上的 live-data.json
3) 服务器 cron：0 3 * * * python refresh-live-data.py

数据源（均为公开官方口径）：
- 文化和旅游部 · 国内居民出游数据：https://zwgk.mct.gov.cn/zfxxgkml/tjxx/
- 文化和旅游部 · 文化和旅游发展统计公报：https://www.mct.gov.cn/whzx/ggtz/
- 新疆维吾尔自治区文化和旅游厅：https://wlt.xinjiang.gov.cn/
- 国家统计局 分省年度数据：https://data.stats.gov.cn/easyquery.htm?cn=E0101

注意：官方未发布“旅游净利润”指标，请勿填入，面板统一用“游客花费/旅游收入”口径。
"""
import json
import os
import sys
import argparse

HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.join(HERE, "assets", "live-data.json")

FIELDS = [
    ("trips", "国内居民出游人次（亿）", float),
    ("tripsGrowth", "同比增速（%）", float),
    ("spend", "国内出游花费（万亿元）", float),
    ("spendGrowth", "同比增速（%）", float),
    ("inbound", "入境游客（万人次）", float),
    ("inboundGrowth", "同比增速（%）", float),
    ("aScenic", "全国A级景区数量（个）", float),
    ("aScenicTrips", "A级景区接待游客（亿人次）", float),
    ("aScenicSpend", "A级景区旅游收入（亿元）", float),
    ("hotelAvgPrice", "星级饭店平均房价（元/间夜）", float),
    ("museums", "备案博物馆纪念馆（家）", float),
    ("heritage", "世界遗产总数（项）", float),
]

XJ_FIELDS = [
    ("visitors", "新疆接待游客（亿人次）", float),
    ("spend", "新疆游客花费（亿元）", float),
    ("growthV", "人次同比（%）", float),
    ("growthS", "花费同比（%）", float),
    ("jobs", "带动就业（万人次）", float),
]


def load_current():
    if os.path.exists(TARGET):
        with open(TARGET, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def ask(prompt, cast, current):
    tip = f"（当前：{current}）" if current is not None else ""
    raw = input(f"{prompt}{tip} 直接回车保持不变 > ").strip()
    if not raw:
        return current
    try:
        return cast(raw)
    except ValueError:
        print("  输入格式有误，已保持原值")
        return current


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-json", help="从已整理的 JSON 合并写入")
    ap.add_argument("--updated", help="数据更新日期，如 2026-09-29")
    args = ap.parse_args()

    data = load_current()

    if args.from_json:
        with open(args.from_json, "r", encoding="utf-8") as f:
            incoming = json.load(f)
        data.update(incoming)
        print(f"已从 {args.from_json} 合并数据")
    else:
        print("=== 全国数据（官方公报口径）===")
        for key, label, cast in FIELDS:
            data[key] = ask(label, cast, data.get(key))
        print("\n=== 新疆数据 ===")
        xj = data.get("xj", {})
        for key, label, cast in XJ_FIELDS:
            xj[key] = ask(label, cast, xj.get(key))
        data["xj"] = xj

    data["updated"] = args.updated or input("数据更新日期（如 2026-09-29）> ").strip() or data.get("updated", "")
    data["source"] = data.get(
        "source",
        "文化和旅游部《2025年国内居民出游数据情况》(2026-01-26)、《2025年文化和旅游发展统计公报》(2026-06-02)",
    )

    os.makedirs(os.path.dirname(TARGET), exist_ok=True)
    with open(TARGET, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"\n✅ 已写入 {TARGET}（更新日：{data['updated']}）。刷新网页即可看到新数据。")


if __name__ == "__main__":
    sys.exit(main())
