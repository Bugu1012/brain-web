# -*- coding: utf-8 -*-
"""扫描 Vault 五个 PARA 分区，构建门户缓存：
www/cache/graph.json（节点+双链边）、stats.json（统计）。
"""
import os, re, json, time, datetime, tempfile
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VAULT_ENV = "BRAIN_WEB_VAULT"
VAULT = os.path.abspath(os.environ.get(VAULT_ENV, "").strip()) if os.environ.get(VAULT_ENV, "").strip() else ""
WWW_CACHE = os.path.join(ROOT, "www", "cache")
STATE_DIR = os.path.join(ROOT, "state")
LOG = os.path.join(STATE_DIR, "build_index.log")

ZONES = ["01-收件箱", "02-项目", "03-资源", "04-领域", "05-日记"]
SKIP_DIRS = {".obsidian", ".trash", ".git", "node_modules", "06-工作文档"}
MAX_READ = 200 * 1024  # 每文件最多读取前 200KB，巨型附件笔记不全文解析

FM_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.S)
WIKI_RE = re.compile(r"\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]")
TAG_RE = re.compile(r"(?:^|[\s，。；：])#([\w\u4e00-\u9fff][\w\u4e00-\u9fff/-]*)")
H1_RE = re.compile(r"^#\s+(.+?)\s*$", re.M)
DATE_NAME_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})\.md$")


def log(msg):
    line = "%s %s" % (datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), msg)
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def extract_tags(fm, body):
    tags = set()
    m = re.search(r"^tags:\s*\[(.*?)\]", fm, re.M)
    if m:
        for t in m.group(1).split(","):
            t = t.strip().strip("'\"").lstrip("#").strip()
            if t:
                tags.add(t)
    else:
        m = re.search(r"^tags:\s*(.+)$", fm, re.M)
        if m:
            for t in m.group(1).split(","):
                t = t.strip().strip("'\"").lstrip("#").strip()
                if t:
                    tags.add(t)
    for t in TAG_RE.findall(body):
        tags.add(t)
    return [t for t in sorted(tags) if t.lower() != "tag"]


def make_summary(body):
    text = re.sub(r"^#+\s+.*$", "", body, flags=re.M)
    text = re.sub(r"\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]", r"\1", text)
    text = re.sub(r"[#>*`|\-\[\]()!]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:120]


def main():
    if not VAULT or not os.path.isdir(VAULT):
        raise SystemExit(f"请通过 {VAULT_ENV} 设置一个存在的 Obsidian Vault 路径")
    t0 = time.time()
    nodes = []
    name_map = {}
    diary_days = set()
    tag_counter = Counter()

    for zone in ZONES:
        zone_root = os.path.join(VAULT, zone)
        if not os.path.isdir(zone_root):
            continue
        for dp, dns, fns in os.walk(zone_root):
            dns[:] = [d for d in dns if d not in SKIP_DIRS]
            for fn in fns:
                if not fn.lower().endswith(".md"):
                    continue
                full = os.path.join(dp, fn)
                rel = os.path.relpath(full, VAULT).replace(os.sep, "/")
                try:
                    st = os.stat(full)
                    with open(full, "r", encoding="utf-8", errors="replace") as f:
                        content = f.read(MAX_READ)
                except Exception as e:
                    log("跳过 %s: %s" % (rel, e))
                    continue

                fm = ""
                body = content
                m = FM_RE.match(content)
                if m:
                    fm = m.group(1)
                    body = content[m.end():]

                stem = fn[:-3]
                h1 = H1_RE.search(body)
                title = (h1.group(1).strip() if h1 else stem) or stem
                tags = extract_tags(fm, body)
                tag_counter.update(tags)

                nodes.append({
                    "id": rel,
                    "title": title,
                    "folder": zone,
                    "ctime": int(st.st_ctime),
                    "mtime": int(st.st_mtime),
                    "summary": make_summary(body),
                    "tags": tags,
                    "_links": WIKI_RE.findall(body),
                })
                if stem not in name_map:
                    name_map[stem] = rel
                if zone == "05-日记":
                    dm = DATE_NAME_RE.match(fn)
                    if dm:
                        diary_days.add(dm.group(1))

    edges = []
    seen = set()
    for n in nodes:
        for target in n.pop("_links"):
            target = target.strip()
            tpath = name_map.get(target)
            if tpath and tpath != n["id"]:
                key = (n["id"], tpath)
                if key not in seen:
                    seen.add(key)
                    edges.append({"s": n["id"], "t": tpath})

    now = datetime.datetime.now()
    week_ago = (now - datetime.timedelta(days=7)).timestamp()
    per_folder = Counter(n["folder"] for n in nodes)

    streak = 0
    d = now.date()
    day_set = diary_days
    if datetime.date.isoformat(d) not in day_set:
        d -= datetime.timedelta(days=1)
    while datetime.date.isoformat(d) in day_set:
        streak += 1
        d -= datetime.timedelta(days=1)

    graph = {"generated": now.isoformat(timespec="seconds"), "nodes": nodes, "edges": edges}
    stats = {
        "generated": now.isoformat(timespec="seconds"),
        "total_notes": len(nodes),
        "per_folder": {z: per_folder.get(z, 0) for z in ZONES},
        "week_new": sum(1 for n in nodes if n["mtime"] >= week_ago),
        "diary_streak": streak,
        "diary_days": sorted(diary_days)[-400:],
        "top_tags": tag_counter.most_common(30),
    }

    os.makedirs(WWW_CACHE, exist_ok=True)

    def atomic_json(name, obj, indent=None):
        # 先写临时文件再原子替换，避免前端读到写了一半的 JSON
        fd, tmp = tempfile.mkstemp(dir=WWW_CACHE, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(obj, f, ensure_ascii=False, indent=indent)
            os.replace(tmp, os.path.join(WWW_CACHE, name))
        except Exception:
            try:
                os.remove(tmp)
            except OSError:
                pass
            raise

    atomic_json("graph.json", graph)
    atomic_json("stats.json", stats, indent=1)

    log("完成: %d 节点 %d 边 %d 标签 日记日 %d 耗时 %.1fs"
        % (len(nodes), len(edges), len(tag_counter), len(diary_days), time.time() - t0))


if __name__ == "__main__":
    main()
