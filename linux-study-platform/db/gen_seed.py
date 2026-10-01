# -*- coding: utf-8 -*-
"""从 linux-study 的抓取数据生成 MySQL 种子 SQL。

产出：
  seed_accounts.sql  —— 管理员 1 个 + 学生 5 个（scrypt 口令）
  seed_content.sql   —— 学习目录树（主目录 / 次目录 / 学习目录 / 学习内容）

用法：
  python gen_seed.py
"""
import hashlib
import json
import os
import re
import secrets

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "_src")
OUT_ACC = os.path.join(HERE, "seed_accounts.sql")
OUT_CON = os.path.join(HERE, "seed_content.sql")

# site_data.json 由抓取结果导出（教程 blocks / 命令 intro+syntax+params+examples / 技巧）
_d = json.load(open(os.path.join(SRC, "site_data.json"), encoding="utf-8"))
data = {
    "tutorials": [{"key": t["key"], "name": t["name"], "desc": t["desc"]} for t in _d["tutorials"]],
    "tips": [{"key": p["key"], "name": p["name"], "desc": p["desc"]} for p in _d["tips"]],
    "commands": [{"cat": c["cat"], "name": c["name"], "desc": c["desc"]} for c in _d["commands"]],
}
parsed = {
    "tutorials": {t["key"]: t["blocks"] for t in _d["tutorials"]},
    "commands": {c["name"]: {"intro": c.get("intro", ""), "syntax": c.get("syntax", ""),
                             "params": c.get("params", []), "examples": c.get("examples", []),
                             "example": c.get("example", "")}
                 for c in _d["commands"]},
}
GROUP_ORDER = _d["groups"]
CAT_ORDER = _d["cats"]
groups = [{"g": g, "items": []} for g in GROUP_ORDER]
GROUP_OF = {t["key"]: t["group"] for t in _d["tutorials"]}

# ── 账号 ───────────────────────────────────────────────────────────────────
ADMIN = [("admin", "admin@2026", "管理员（教师）", "super")]
STUDENTS = [
    # username, password,     name,       sno,       class,        phone
    ("student1", "xiaoran2026", "学生一", "2026001", "计算机应用 1 班", "13800000001"),
    ("student2", "linux2026",   "学生二", "2026002", "计算机应用 1 班", "13800000002"),
    ("student3", "study2026",   "学生三", "2026003", "计算机应用 1 班", "13800000003"),
    ("student4", "buddy2026",   "学生四", "2026004", "计算机应用 2 班", "13800000004"),
    ("student5", "hello2026",   "学生五", "2026005", "计算机应用 2 班", "13800000005"),
]

SCRYPT_N, SCRYPT_R, SCRYPT_P, DKLEN = 16384, 8, 1, 64


def hash_pwd(pwd):
    """与 Node 端 crypto.scryptSync 完全一致的参数，保证前后端可互相校验。"""
    salt = secrets.token_hex(16)
    dk = hashlib.scrypt(pwd.encode("utf-8"), salt=salt.encode("utf-8"),
                        n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=DKLEN,
                        maxmem=128 * 1024 * 1024)
    return "$".join(["scrypt", str(SCRYPT_N), str(SCRYPT_R), str(SCRYPT_P), salt, dk.hex()])


def q(s):
    """SQL 字符串转义（含反斜杠、单引号、换行、控制字符）。"""
    if s is None:
        return "NULL"
    s = str(s)
    s = s.replace("\\", "\\\\").replace("'", "\\'")
    s = s.replace("\r\n", "\\n").replace("\n", "\\n").replace("\r", "\\n")
    s = s.replace("\t", "\\t").replace("\x00", "")
    s = re.sub(r"[\x01-\x08\x0b\x0c\x0e-\x1f]", "", s)
    return "'" + s + "'"


# ═══════════════════════ seed_accounts.sql ═══════════════════════
acc = ["-- Linux 学习打卡平台 · 账号初始化",
       "-- 由 gen_seed.py 自动生成，请勿手工修改",
       "",
       "SET NAMES utf8mb4;",
       "USE linux_study;",
       ""]

acc.append("-- ── 管理员 ──")
for u, p, n, role in ADMIN:
    acc.append(
        "INSERT INTO `admins` (`username`,`password_hash`,`name`,`role`) VALUES "
        "({u}, {h}, {n}, {r})\n"
        "  ON DUPLICATE KEY UPDATE `password_hash`=VALUES(`password_hash`),"
        "`name`=VALUES(`name`),`role`=VALUES(`role`);".format(
            u=q(u), h=q(hash_pwd(p)), n=q(n), r=q(role)))

acc.append("")
acc.append("-- ── 学生名单（姓名 / 学号 / 班级 / 联系电话 均可在后台修改）──")
for u, p, n, sno, cls, phone in STUDENTS:
    acc.append(
        "INSERT INTO `students` (`username`,`password_hash`,`name`,`sno`,`class_name`,`phone`) VALUES "
        "({u}, {h}, {n}, {s}, {c}, {ph})\n"
        "  ON DUPLICATE KEY UPDATE `password_hash`=VALUES(`password_hash`),"
        "`name`=VALUES(`name`),`sno`=VALUES(`sno`),"
        "`class_name`=VALUES(`class_name`),`phone`=VALUES(`phone`);".format(
            u=q(u), h=q(hash_pwd(p)), n=q(n), s=q(sno), c=q(cls), ph=q(phone)))

acc.append("")
acc.append("-- ── 明文口令速查（首次登录后请在后台或数据库中修改）──")
acc.append("--   admin    / admin@2026")
for u, p, n, sno, cls, phone in STUDENTS:
    acc.append("--   %-9s/ %s" % (u, p))
acc.append("")

open(OUT_ACC, "w", encoding="utf-8").write("\n".join(acc))


# ═══════════════════════ seed_content.sql ═══════════════════════
rows = []          # (parent_key, level, title, summary, ctype, body, lang, example, diff, sort, checkable)
KEYS = {}          # key -> (placeholder_index) 用 SET @vN := LAST_INSERT_ID() 串联


class Builder:
    def __init__(self):
        self.lines = []
        self.seq = 0

    def newvar(self):
        self.seq += 1
        return "@u%d" % self.seq

    def add(self, parent_var, level, title, summary="", ctype="text", body=None,
            lang="bash", example="", diff=1, sort=0, checkable=0):
        var = self.newvar()
        self.lines.append(
            "INSERT INTO `units` (`parent_id`,`level`,`title`,`summary`,`content_type`,`body`,"
            "`lang`,`example`,`difficulty`,`sort_order`,`is_checkable`) VALUES "
            "({p}, {lv}, {t}, {s}, {ct}, {b}, {lg}, {ex}, {df}, {so}, {ck});".format(
                p=parent_var if parent_var else "NULL", lv=level, t=q(title),
                s=q(summary or ""), ct=q(ctype),
                b=q(body) if body is not None else "NULL",
                lg=q(lang), ex=q(example or ""), df=diff, so=sort, ck=checkable))
        self.lines.append("SET %s := LAST_INSERT_ID();" % var)
        return var


b = Builder()
b.lines.append("-- Linux 学习打卡平台 · 学习目录树初始化")
b.lines.append("-- 由 gen_seed.py 自动从两站抓取数据生成，共四级：主目录 / 次目录 / 学习目录 / 学习内容")
b.lines.append("")
b.lines.append("SET NAMES utf8mb4;")
b.lines.append("USE linux_study;")
b.lines.append("SET @root := NULL;")
b.lines.append("")

TUT_DIFF = {
    "① 入门与安装": 1, "② 系统与运维基础": 2, "③ 文件与权限": 2, "④ 用户与磁盘": 3,
    "⑤ 编辑器与软件包": 2, "⑥ Shell 编程（12 讲完整版）": 3, "⑦ 服务与实战部署": 4,
    "⑧ 检验学习成果": 2,
}
CAT_DIFF = {
    "文件管理": 1, "文档编辑": 2, "文件传输": 2, "磁盘管理": 3, "磁盘维护": 4,
    "网络通讯": 3, "系统管理": 3, "系统设置": 3, "备份压缩": 2, "设备管理": 4,
    "其他命令（高频实用）": 3,
}

# ── 主目录 1：Linux 系统学习 ─────────────────────────────────────────────
lv1_tut = b.add(None, 1, "Linux 系统学习", "系统化教程：从零基础到服务部署，含 Shell 编程完整讲解", "text", None, "bash", "", 1, 10, 0)
by_group = {}
for t in data["tutorials"]:
    by_group.setdefault(GROUP_OF.get(t["key"], "其他"), []).append(t)

for gi, g in enumerate(groups):
    gname = g["g"]
    arr = by_group.get(gname, [])
    if not arr:
        continue
    lv2 = b.add(lv1_tut, 2, gname, "本组共 %d 讲" % len(arr), "text", None, "bash", "",
                TUT_DIFF.get(gname, 2), (gi + 1) * 10, 0)
    for ti, t in enumerate(arr):
        blocks = parsed["tutorials"].get(t["key"], [])
        lv3 = b.add(lv2, 3, t["name"], t.get("desc", ""), "text", None, "bash", "",
                    TUT_DIFF.get(gname, 2), (ti + 1) * 10, 1)
        for bi, blk in enumerate(blocks):
            tp = blk["t"]
            if tp == "h":
                ctype, body = "text", None
                b.add(lv3, 4, "【章节】" + blk["x"], "", "text", None, "bash", "",
                      0, bi * 10, 0)
                continue
            if tp == "code":
                b.add(lv3, 4, "代码示例", "", "code", blk["x"], "bash", "", 0, bi * 10, 0)
            elif tp == "table":
                b.add(lv3, 4, "对照表", "", "table", json.dumps(blk["x"], ensure_ascii=False),
                      "bash", "", 0, bi * 10, 0)
            elif tp == "li":
                b.add(lv3, 4, "要点", "", "list", blk["x"], "bash", "", 0, bi * 10, 0)
            elif tp == "note":
                b.add(lv3, 4, "提示", "", "note", blk["x"], "bash", "", 0, bi * 10, 0)
            else:
                b.add(lv3, 4, "正文", "", "text", blk["x"], "bash", "", 0, bi * 10, 0)

# ── 主目录 2：命令大全 ───────────────────────────────────────────────────
lv1_cmd = b.add(None, 1, "命令大全", "两站互补去重后的完整 Linux 命令速查，附语法、参数表与可复制实例",
                "text", None, "bash", "", 2, 20, 0)
cat_tuts = {}
for c in data["commands"]:
    cat_tuts.setdefault(c["cat"], []).append(c)

for ci, cat in enumerate(CAT_ORDER):
    arr = cat_tuts.get(cat, [])
    if not arr:
        continue
    lv2 = b.add(lv1_cmd, 2, cat, "共 %d 条命令" % len(arr), "text", None, "bash", "",
                CAT_DIFF.get(cat, 3), (ci + 1) * 10, 0)
    for ii, c in enumerate(arr):
        name = c["name"]
        info = parsed["commands"].get(name, {})
        lv3 = b.add(lv2, 3, name, c.get("desc", ""), "cmd", None, "bash",
                    info.get("example", ""), CAT_DIFF.get(cat, 3), (ii + 1) * 10, 1)
        if info.get("intro"):
            b.add(lv3, 4, "简介", "", "text", info["intro"], "bash", "", 0, 10, 0)
        if info.get("syntax"):
            b.add(lv3, 4, "语法", "", "code", info["syntax"], "bash", "", 0, 20, 0)
        if info.get("params"):
            b.add(lv3, 4, "参数与选项（%d）" % len(info["params"]), "",
                  "table", json.dumps(info["params"], ensure_ascii=False), "bash", "", 0, 30, 0)
        for ei, ex in enumerate((info.get("examples") or [])[:6]):
            b.add(lv3, 4, ex.get("desc") or ("实例 %d" % (ei + 1)), "",
                  "code", ex.get("code", ""), "bash", "", 0, (ei + 1) * 10 + 100, 0)

# ── 主目录 3：实用技巧 ───────────────────────────────────────────────────
TIP_EX = {
    "p01": "date", "p02": "stty -a", "p03": "passwd", "p04": "logout",
    "p05": "tail -n 20 /var/log/syslog", "p06": "lpstat -p", "p07": "chmod u+x run.sh",
    "p08": "rm -fr old_dir", "p09": "cp -R src/ backup/", "p10": "fg %1",
    "p11": "kill -9 12345", "p12": "ps -o pid,ppid,comm",
}
lv1_tip = b.add(None, 1, "实用技巧", "高频实用技巧速查，配合每日打卡使用", "text", None, "bash", "", 1, 30, 0)
lv2_tip = b.add(lv1_tip, 2, "常用技巧", "共 %d 条" % len(data["tips"]), "text", None, "bash", "", 1, 10, 0)
for pi, p in enumerate(data["tips"]):
    lv3 = b.add(lv2_tip, 3, p["name"], p.get("desc", ""), "cmd", None, "bash",
                TIP_EX.get(p["key"], ""), 1, (pi + 1) * 10, 1)
    b.add(lv3, 4, "说明", "", "text", p.get("desc", ""), "bash", "", 0, 10, 0)
    if TIP_EX.get(p["key"]):
        b.add(lv3, 4, "示例", "", "code", TIP_EX[p["key"]], "bash", "", 0, 20, 0)

b.lines.append("")
b.lines.append("-- 完成")
b.lines.append("")

open(OUT_CON, "w", encoding="utf-8").write("\n".join(b.lines))

n_l1 = 3
n_l2 = sum(1 for L in b.lines if L.startswith("INSERT INTO `units`"))
print("seed_accounts.sql  -> 管理员 %d 个，学生 %d 个" % (len(ADMIN), len(STUDENTS)))
print("seed_content.sql   -> 目录树 INSERT 语句 %d 条" % n_l2)
print("                     主目录 3 / 次目录 %d / 学习目录 %d / 学习内容 %d" % (
    len([g for g in groups if by_group.get(g["g"], [])]) + len([c for c in CAT_ORDER if cat_tuts.get(c)])
    + 1,
    len(data["tutorials"]) + len(data["commands"]) + len(data["tips"]),
    sum(len(v) for v in parsed["tutorials"].values())
    + sum(1 + (1 if i.get("intro") else 0) + (1 if i.get("syntax") else 0)
          + (1 if i.get("params") else 0) + len((i.get("examples") or [])[:6])
          for i in parsed["commands"].values())
    + len(data["tips"]) * 2))
print("输出：")
print("  ", OUT_ACC, "%.1f KB" % (os.path.getsize(OUT_ACC) / 1024))
print("  ", OUT_CON, "%.1f MB" % (os.path.getsize(OUT_CON) / 1024 / 1024))
