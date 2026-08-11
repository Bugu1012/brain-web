# -*- coding: utf-8 -*-
"""Obsidian Local REST API 冒烟：创建/搜索/修改笔记 + 看板读写（自动还原）。"""
import argparse, os, sys, requests

BASE = os.environ.get("BRAIN_WEB_OBSIDIAN_API_URL", "http://127.0.0.1:27123").rstrip("/")
TEST_NOTE = "01-收件箱/阶段二验证笔记.md"
KANBAN = "02-项目/待办看板.md"
CARD = "示例卡片（验证用，可删除）"

def get_key(args):
    if args.key:
        return args.key.strip()
    if args.key_file and os.path.isfile(args.key_file):
        return open(args.key_file, encoding="utf-8").read().strip()
    env_key = os.environ.get("BRAIN_WEB_OBSIDIAN_API_KEY", "").strip()
    if env_key:
        return env_key
    sys.exit("缺少密钥：请使用 --key、--key-file 或 BRAIN_WEB_OBSIDIAN_API_KEY；不要将密钥放入仓库。")

def report(name, cond, extra=""):
    print(("通过 " if cond else "失败 ") + name + ((" | " + extra) if extra else ""))
    return cond

def fetch_text(sess, path):
    g = sess.get(BASE + "/vault/" + path, timeout=20)
    try:
        j = g.json()
        if isinstance(j, dict) and "content" in j:
            return g.status_code, j["content"]
    except Exception:
        pass
    return g.status_code, g.text

def move_card(text, card, src_col, dst_col):
    lines = text.split("\n")
    section, card_idx = None, None
    for i, ln in enumerate(lines):
        if ln.startswith("## "):
            section = ln[3:].strip()
        elif section == src_col and card in ln and ln.strip().startswith("- ["):
            card_idx = i
            break
    if card_idx is None:
        return None
    line = lines.pop(card_idx)
    out, done = [], False
    for ln in lines:
        out.append(ln)
        if not done and ln.startswith("## ") and ln[3:].strip() == dst_col:
            out.append("")
            out.append(line)
            done = True
    return "\n".join(out) if done else None

def main():
    parser = argparse.ArgumentParser(description="Obsidian Local REST API 冒烟验证")
    parser.add_argument("--key", help="本次进程使用的 API 密钥")
    parser.add_argument("--key-file", help="仓库外 API 密钥文件")
    args = parser.parse_args()
    sess = requests.session()
    sess.headers.update({"Authorization": "Bearer " + get_key(args)})
    r = sess.get(BASE + "/", timeout=10)
    if not report("连通与认证", r.status_code == 200, "status=%s" % r.status_code):
        sys.exit(1)
    body = "---\ntags: [验证]\n---\n# 阶段二验证\n\n第一条内容。\n"
    r = sess.put(BASE + "/vault/" + TEST_NOTE, headers={"Content-Type": "text/markdown"}, data=body.encode("utf-8"), timeout=20)
    report("创建笔记", r.status_code in (200, 201, 204), "status=%s" % r.status_code)
    r = sess.post(BASE + "/search/simple/", params={"query": "阶段二验证", "contextLength": 200}, timeout=30)
    report("全文搜索", r.status_code == 200 and "阶段二验证笔记" in r.text, "status=%s" % r.status_code)
    body2 = body + "\n第二条追加内容。\n"
    r = sess.put(BASE + "/vault/" + TEST_NOTE, headers={"Content-Type": "text/markdown"}, data=body2.encode("utf-8"), timeout=20)
    st, text = fetch_text(sess, TEST_NOTE)
    report("修改笔记", r.status_code in (200, 204) and "第二条追加内容" in text, "status=%s" % r.status_code)
    st, ktext = fetch_text(sess, KANBAN)
    cond1 = st == 200 and "kanban-plugin" in ktext
    moved = move_card(ktext, CARD, "收件箱", "今日") if cond1 else None
    cond2 = False
    if moved:
        rp = sess.put(BASE + "/vault/" + KANBAN, headers={"Content-Type": "text/markdown"}, data=moved.encode("utf-8"), timeout=20)
        st2, ktext2 = fetch_text(sess, KANBAN)
        cond2 = rp.status_code in (200, 204) and move_card(ktext2, CARD, "今日", "收件箱") is not None
        sess.put(BASE + "/vault/" + KANBAN, headers={"Content-Type": "text/markdown"}, data=ktext.encode("utf-8"), timeout=20)
    report("看板读写与还原", cond1 and cond2, "读取status=%s" % st)
    r = sess.delete(BASE + "/vault/" + TEST_NOTE, timeout=20)
    report("清理验证笔记", r.status_code in (200, 204, 205), "status=%s" % r.status_code)

if __name__ == "__main__":
    main()
