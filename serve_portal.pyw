# -*- coding: utf-8 -*-
"""松涧听澜门户服务：静态站点 + 图书馆 API。
仅绑定 127.0.0.1；无窗口（pythonw）；无请求日志（pythonw 下 stderr 为 None，日志会崩溃）。
图书馆 API（直读 Vault 磁盘，Obsidian 未运行时也可用）：
  GET  /lib/index[?refresh=1]   书目索引（含笔记元数据）
  GET  /lib/meta                分类与标签汇总（轻量）
  GET  /lib/file?path=<rel>     流式取书（支持 Range，供 PDF 预览）
  GET  /lib/notes?book=<rel>    读某书的读书笔记
  PUT  /lib/notes?book=<rel>    写读书笔记（正文为 UTF-8 Markdown，含 frontmatter）
  POST /lib/categories          保存自定义分类列表（支持 rename 迁移）
  POST /lib/assign              为某书指定/清除自定义分类
  GET  /screen                  全屏截图（PNG，供框选 OCR）
  POST /screen/crop             裁剪上次截图的选区（PNG）
  GET  /moments[?date=]           说说列表（Vault 05-日记/说说）
  POST /moments                   发说说（<=50字 + <=4张照片 base64）
  GET  /timeline?month=YYYY-MM    照片/说说/日志/文档 统一时间轴
  GET  /moment/img?path=          说说配图（限定 images 子树）
"""
import base64
import hashlib
import hmac
import http.server
import io
import json
import mimetypes
import os
import re
import threading
import time
import urllib.parse
import shutil
import tempfile
import urllib.request
import uuid
import secrets
from http import cookies as http_cookies

ROOT = os.path.dirname(os.path.abspath(__file__))
WWW = os.path.join(ROOT, "www")
PORT_ENV = "BRAIN_WEB_PORTAL_PORT"

def _env_port():
    raw = os.environ.get(PORT_ENV, "").strip()
    if not raw:
        return 8765
    try:
        port = int(raw)
    except ValueError:
        raise SystemExit(f"{PORT_ENV} 必须是 1024-65535 之间的整数")
    if not 1024 <= port <= 65535:
        raise SystemExit(f"{PORT_ENV} 必须是 1024-65535 之间的整数")
    return port

PORT = _env_port()
VAULT_ENV = "BRAIN_WEB_VAULT"
VAULT = os.path.abspath(os.environ.get(VAULT_ENV, "").strip()) if os.environ.get(VAULT_ENV, "").strip() else ""
NOTES_DIR = os.path.join(VAULT, "03-资源", "读书笔记")
BOOK_EXTS = {".pdf", ".epub", ".djvu", ".mobi", ".azw3"}
MEDIA_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
SCAN_ROOTS = [
    os.path.join("03-资源", "电子图书馆"),
]
SKIP_DIRS = {".obsidian", ".trash", ".git", "node_modules", "attachments", "_重复待删"}
CACHE_FILE = os.path.join(ROOT, "state", "books_cache.json")
LIB_META_FILE = os.path.join(ROOT, "state", "library_meta.json")
SCREEN_SHOT = {"img": None, "ts": 0.0}
META_LOCK = threading.Lock()
WEATHER_CACHE = {}
DAILY_TAGS_FILE = os.path.join(ROOT, "state", "daily_tags.json")
BUILD_SCRIPT = os.path.join(ROOT, "scripts", "build_index.py")
LIB_ROOT = os.path.join("03-资源", "电子图书馆")
REBUILD_LOCK = threading.Lock()
WEATHER_FAIL_TTL = 60
WEATHER_CACHE_MAX = 128
NOTE_MAX_BYTES = 5 * 1024 * 1024
JSON_MAX_BYTES = 1 * 1024 * 1024
ERROR_LOG = os.path.join(ROOT, "state", "portal_error.log")
MOMENTS_DIR = os.path.join(VAULT, "05-日记", "说说")
MOMENTS_IMG_DIR = os.path.join(MOMENTS_DIR, "images")
MOMENT_MAX_BYTES = 8 * 1024 * 1024
MOMENT_TEXT_MAX = 50
MOMENT_PHOTO_MAX = 4
MOMENT_PHOTO_BYTES = 1536 * 1024
GRAPH_FILE = os.path.join(ROOT, "www", "cache", "graph.json")
STATS_FILE = os.path.join(ROOT, "www", "cache", "stats.json")
MOMENT_IMG_RE = re.compile(r"^images/[A-Za-z0-9_\-]+\.(jpg|jpeg|png|gif|webp)\Z", re.I)
PORTAL_TOKEN_ENV = "BRAIN_WEB_PORTAL_TOKEN"
PORTAL_ACCESS_TOKEN = os.environ.get(PORTAL_TOKEN_ENV, "").strip()
PORTAL_AUTH_ENV = "BRAIN_WEB_PORTAL_AUTH"
PORTAL_AUTH_ENABLED = os.environ.get(PORTAL_AUTH_ENV, "").strip().lower() in {"1", "true", "yes", "on"}
PORTAL_SESSION_ID = secrets.token_urlsafe(32)
PORTAL_COOKIE_NAME = "brain_portal_session"
PORTAL_SESSION_TTL = 8 * 60 * 60
AUTH_WINDOW_SECONDS = 5 * 60
AUTH_MAX_FAILURES = 5
AUTH_LOCK_SECONDS = 5 * 60
AUTH_GUARD = {"failures": [], "locked_until": 0.0}
AUTH_GUARD_LOCK = threading.Lock()
ALLOWED_ORIGINS = {f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}"}

PROTECTED_GET_PATHS = {
    "/weather", "/lib/index", "/lib/meta", "/lib/file", "/lib/notes",
    "/screen", "/daily_tags", "/moments", "/timeline", "/moment/img",
    "/search/names",
}


def note_version(content):
    return hashlib.sha256(content.encode("utf-8")).hexdigest()

def _img_magic_ok(raw):
    if raw[:3] == b"\xff\xd8\xff":
        return True
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return True
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return True
    return raw[:4] == b"GIF8"

def _parse_moment_file(full, fn):
    try:
        with open(full, encoding="utf-8", errors="replace") as f:
            content = f.read(200000)
    except OSError:
        return None
    content = content.lstrip("\ufeff")
    fm, body = "", content
    m = re.match(r"^---\n(.*?)\n---\n?", content, re.S)
    if m:
        fm, body = m.group(1), content[m.end():]
    meta = {}
    photos, in_photos = [], False
    for line in fm.split("\n"):
        ls = line.strip()
        m2 = re.match(r"^(date|time|type):\s*(.+)$", ls)
        if m2:
            meta[m2.group(1)] = m2.group(2).strip().strip('"')
            in_photos = False
            continue
        m4 = re.match(r"^photos:\s*\[(.*)\]\s*$", ls)
        if m4:
            photos.extend(x.strip().strip('"') for x in m4.group(1).split(",") if x.strip())
            in_photos = False
            continue
        if ls == "photos:":
            in_photos = True
            continue
        if in_photos:
            if ls == "":
                continue
            m3 = re.match(r"^-\s*(.+)$", ls)
            if m3:
                photos.append(m3.group(1).strip().strip('"'))
            else:
                in_photos = False
    st = os.stat(full)
    return {
        "id": fn[:-3],
        "date": meta.get("date") or time.strftime("%Y-%m-%d", time.localtime(st.st_mtime)),
        "time": meta.get("time") or time.strftime("%H:%M", time.localtime(st.st_mtime)),
        "ts": int(st.st_mtime),
        "text": body.strip(),
        "photos": [p for p in photos if MOMENT_IMG_RE.match(p)],
    }

def scan_moments():
    out = []
    if not os.path.isdir(MOMENTS_DIR):
        return out
    for fn in os.listdir(MOMENTS_DIR):
        if fn.endswith(".md"):
            mo = _parse_moment_file(os.path.join(MOMENTS_DIR, fn), fn)
            if mo:
                out.append(mo)
    out.sort(key=lambda x: (x["date"], x["time"], x["ts"]), reverse=True)
    return out

_GRAPH_CACHE = {"mtime": 0.0, "nodes": []}

def load_graph_nodes():
    try:
        mt = os.path.getmtime(GRAPH_FILE)
    except OSError:
        return _GRAPH_CACHE["nodes"]
    if _GRAPH_CACHE["mtime"] != mt:
        try:
            with open(GRAPH_FILE, encoding="utf-8") as f:
                g = json.load(f)
            _GRAPH_CACHE["mtime"] = mt
            _GRAPH_CACHE["nodes"] = g.get("nodes") or []
        except (OSError, ValueError):
            pass
    return _GRAPH_CACHE["nodes"]

def diary_excerpt(rel):
    full = os.path.join(VAULT, rel.replace("/", os.sep))
    try:
        with open(full, encoding="utf-8", errors="replace") as f:
            content = f.read(4000)
    except OSError:
        return ""
    body = re.sub(r"^---\n.*?\n---\n?", "", content, count=1, flags=re.S)
    for line in body.split("\n"):
        t = re.sub(r"[#>*`\-\[\]()!|]", " ", line).strip()
        if t:
            return t[:100]
    return ""

def build_timeline(month):
    items = []
    for mo in scan_moments():
        if mo["date"].startswith(month + "-"):
            kind = "photo" if (mo["photos"] and not mo["text"]) else "moment"
            items.append({"kind": kind, "date": mo["date"], "time": mo["time"],
                          "ts": mo["ts"], "moment": mo})
    try:
        with open(STATS_FILE, encoding="utf-8") as f:
            days = (json.load(f)).get("diary_days") or []
    except (OSError, ValueError):
        days = []
    for d in days:
        if d.startswith(month + "-"):
            rel = "05-日记/" + d + ".md"
            items.append({"kind": "diary", "date": d, "time": "00:00", "ts": 0,
                          "path": rel, "excerpt": diary_excerpt(rel)})
    for n in load_graph_nodes():
        nid = n.get("id") or ""
        if not nid.endswith(".md") or (n.get("folder") or "") == "05-日记" or "/说说/" in nid:
            continue
        ds = time.strftime("%Y-%m-%d", time.localtime(n.get("mtime") or 0))
        if ds.startswith(month + "-"):
            items.append({"kind": "doc", "date": ds,
                          "time": time.strftime("%H:%M", time.localtime(n.get("mtime") or 0)),
                          "ts": n.get("mtime") or 0, "title": n.get("title"),
                          "path": nid, "folder": n.get("folder"), "summary": n.get("summary")})
    items.sort(key=lambda x: (x["date"], x["time"], x["ts"]), reverse=True)
    kept, docs = [], 0
    for it in items:
        if it["kind"] == "doc":
            docs += 1
            if docs > 300:
                continue
        kept.append(it)
    return kept


# 常用城市静态坐标兜底：Open-Meteo 地理编码对部分中文城市名（如厦门）无结果
CITY_COORDS = {
    "北京": (39.9042, 116.4074), "上海": (31.2304, 121.4737), "天津": (39.0842, 117.2010),
    "重庆": (29.5630, 106.5516), "广州": (23.1291, 113.2644), "深圳": (22.5431, 114.0579),
    "厦门": (24.4798, 118.0895), "福州": (26.0745, 119.2965), "泉州": (24.8741, 118.6757),
    "杭州": (30.2741, 120.1551), "南京": (32.0603, 118.7969), "苏州": (31.2989, 120.5853),
    "无锡": (31.4912, 120.3119), "宁波": (29.8683, 121.5440), "温州": (27.9938, 120.6994),
    "成都": (30.5728, 104.0668), "武汉": (30.5928, 114.3055), "长沙": (28.2282, 112.9388),
    "西安": (34.3416, 108.9398), "郑州": (34.7466, 113.6254), "合肥": (31.8206, 117.2272),
    "济南": (36.6512, 117.1201), "青岛": (36.0671, 120.3826), "大连": (38.9140, 121.6147),
    "沈阳": (41.8057, 123.4315), "长春": (43.8171, 125.3235), "哈尔滨": (45.8038, 126.5350),
    "石家庄": (38.0428, 114.5149), "太原": (37.8706, 112.5489), "呼和浩特": (40.8414, 111.7519),
    "南昌": (28.6829, 115.8579), "贵阳": (26.6470, 106.6302), "昆明": (24.8801, 102.8329),
    "南宁": (22.8170, 108.3665), "海口": (20.0440, 110.1999), "三亚": (18.2528, 109.5120),
    "兰州": (36.0611, 103.8343), "西宁": (36.6171, 101.7782), "银川": (38.4872, 106.2309),
    "乌鲁木齐": (43.8256, 87.6168), "拉萨": (29.6500, 91.1000), "珠海": (22.2710, 113.5767),
}
WEATHER_TTL = 1200
WMO = {
    0: ("晴", "☀️"), 1: ("基本晴", "🌤️"), 2: ("多云", "⛅"), 3: ("阴", "☁️"),
    45: ("雾", "🌫️"), 48: ("雾凇", "🌫️"),
    51: ("毛毛雨", "🌦️"), 53: ("毛毛雨", "🌦️"), 55: ("毛毛雨", "🌧️"),
    56: ("冻毛毛雨", "🌧️"), 57: ("冻毛毛雨", "🌧️"),
    61: ("小雨", "🌧️"), 63: ("中雨", "🌧️"), 65: ("大雨", "🌧️"),
    66: ("冻雨", "🌧️"), 67: ("冻雨", "🌧️"),
    71: ("小雪", "🌨️"), 73: ("中雪", "🌨️"), 75: ("大雪", "❄️"), 77: ("米雪", "❄️"),
    80: ("阵雨", "🌦️"), 81: ("阵雨", "🌧️"), 82: ("强阵雨", "⛈️"),
    85: ("阵雪", "🌨️"), 86: ("阵雪", "❄️"),
    95: ("雷雨", "⛈️"), 96: ("雷雨伴冰雹", "⛈️"), 99: ("雷雨伴冰雹", "⛈️"),
}
UA = {"User-Agent": "Mozilla/5.0 (SongjianTinglan local portal)"}
CACHE_TTL = 24 * 3600
CHUNK = 1 << 20


def derive_category(rel):
    parts = rel.split("/")
    if parts[0] == "03-资源" and len(parts) > 2 and parts[1] == "电子图书馆":
        return parts[2]
    if len(parts) == 1:
        return "未分类"
    return parts[1] if parts[0] == "03-资源" else parts[0]


def derive_group(rel):
    parts = rel.split("/")
    if parts[0] == "03-资源" and len(parts) > 3 and parts[1] == "电子图书馆":
        return parts[3]
    return ""


def scan_books():
    books = []
    for root_rel in SCAN_ROOTS:
        root_abs = os.path.join(VAULT, root_rel)
        if not os.path.isdir(root_abs):
            continue
        for dirpath, dirnames, filenames in os.walk(root_abs):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for fn in filenames:
                ext = os.path.splitext(fn)[1].lower()
                if ext not in BOOK_EXTS:
                    continue
                full = os.path.join(dirpath, fn)
                try:
                    st = os.stat(full)
                except OSError:
                    continue
                rel = os.path.relpath(full, VAULT).replace(os.sep, "/")
                books.append({"path": rel, "name": os.path.splitext(fn)[0],
                              "ext": ext, "size": st.st_size, "mtime": int(st.st_mtime),
                              "category": derive_category(rel), "group": derive_group(rel)})
    for fn in os.listdir(VAULT):
        full = os.path.join(VAULT, fn)
        ext = os.path.splitext(fn)[1].lower()
        if os.path.isfile(full) and ext in BOOK_EXTS:
            st = os.stat(full)
            books.append({"path": fn, "name": os.path.splitext(fn)[0],
                          "ext": ext, "size": st.st_size, "mtime": int(st.st_mtime),
                          "category": "未分类"})
    books.sort(key=lambda b: b["name"])
    return books


def same_named_books(book_rel, books=None):
    """返回与给定书籍同文件名的馆藏路径；同名时绝不猜测旧关联。"""
    base = os.path.basename(book_rel)
    if not base:
        return []
    source = books if books is not None else scan_books()
    return [(b["path"] if isinstance(b, dict) else b) for b in source
            if os.path.basename(b["path"] if isinstance(b, dict) else b) == base]


def has_unique_book_filename(book_rel, books=None):
    return len(same_named_books(book_rel, books)) == 1


def parse_note_meta(text):
    meta = {"tags": [], "category": "", "rating": "", "source": "", "updated": ""}
    m = re.match(r"\ufeff?---\s*\n(.*?)\n---", text, re.S)
    if not m:
        return meta
    for line in m.group(1).splitlines():
        line = line.strip()
        tm = re.match(r"tags:\s*\[(.*)\]", line)
        if tm:
            meta["tags"] = [t.strip().strip("\'\"") for t in tm.group(1).split(",") if t.strip()]
            continue
        mm = re.match(r"(source|category|rating|updated|created):\s*(.*)$", line)
        if mm:
            meta[mm.group(1)] = mm.group(2).strip().strip("\'\"")
    return meta


def scan_notes(books=None):
    """笔记索引：frontmatter source 精确关联；无 source 的旧笔记按书名规范化匹配。
    Obsidian 同步冲突副本（文件名含「冲突」）一律不参与。"""
    notes = {}
    claimed = set()
    orphans = []
    if not os.path.isdir(NOTES_DIR):
        return notes, orphans
    files = sorted(fn for fn in os.listdir(NOTES_DIR)
                   if fn.endswith(".md") and "冲突" not in fn)
    metas = {}
    for fn in files:
        try:
            with open(os.path.join(NOTES_DIR, fn), encoding="utf-8") as f:
                metas[fn] = parse_note_meta(f.read())
        except OSError:
            continue
    for fn, meta in metas.items():
        if meta.get("source"):
            notes[meta["source"]] = {"notePath": "03-资源/读书笔记/" + fn,
                                     "tags": meta["tags"], "category": meta.get("category", ""),
                                     "rating": meta.get("rating", ""), "updated": meta.get("updated", "")}
            claimed.add(fn)
    if books:
        book_tokens = []
        for b in books:
            rel = b["path"] if isinstance(b, dict) else b
            ts = title_tokens(rel)
            if ts:
                book_tokens.append((rel, ts))
        for fn, meta in metas.items():
            if fn in claimed:
                continue
            nt = title_tokens(fn)
            matches = [(rel, bt) for rel, bt in book_tokens
                       if rel not in notes and tokens_match(nt, bt)]
            # 旧笔记没有 source 时，只在唯一命中时自动关联，避免同名/近似书名错绑。
            if len(matches) == 1:
                rel, _ = matches[0]
                notes[rel] = {"notePath": "03-资源/读书笔记/" + fn,
                              "tags": meta["tags"], "category": meta.get("category", ""),
                              "rating": meta.get("rating", ""), "updated": meta.get("updated", "")}
                claimed.add(fn)
    for fn in files:
        if fn in metas and fn not in claimed:
            orphans.append("03-资源/读书笔记/" + fn)
    return notes, orphans


def load_lib_meta():
    try:
        with open(LIB_META_FILE, encoding="utf-8") as f:
            m = json.load(f)
    except (OSError, ValueError):
        return {"categories": [], "assign": {}}
    cats = []
    for c in m.get("categories") or []:
        if isinstance(c, str) and c.strip() and c.strip() not in cats:
            cats.append(c.strip())
    assign = {}
    for k, v in (m.get("assign") or {}).items():
        if isinstance(k, str) and isinstance(v, str) and v.strip():
            assign[k] = v.strip()
    return {"categories": cats, "assign": assign}


def save_lib_meta(meta):
    try:
        os.makedirs(os.path.dirname(LIB_META_FILE), exist_ok=True)
        if os.path.exists(LIB_META_FILE):
            try:
                shutil.copy2(LIB_META_FILE, LIB_META_FILE + ".bak")
            except OSError:
                pass
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(LIB_META_FILE), suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
                json.dump(meta, f, ensure_ascii=False, indent=1)
            os.replace(tmp, LIB_META_FILE)
        except OSError:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            return False
        return True
    except OSError:
        return False


def apply_custom_categories(books, notes, meta):
    assign = meta.get("assign") or {}
    paths = {b["path"] for b in books}
    orphan_assign, orphan_note = {}, {}
    for p, c in assign.items():
        if p not in paths:
            matches = same_named_books(p, books)
            if len(matches) == 1:
                orphan_assign.setdefault(matches[0], c)
    for src, n in notes.items():
        if n.get("category") and src not in paths:
            matches = same_named_books(src, books)
            if len(matches) == 1:
                orphan_note.setdefault(matches[0], n["category"])
    for b in books:
        b["folderCategory"] = b["category"]
        c = (assign.get(b["path"]) or orphan_assign.get(b["path"])
             or (notes.get(b["path"]) or {}).get("category")
             or orphan_note.get(b["path"]) or "")
        if c:
            b["category"] = c


def resolve_book_file(rel):
    """旧路径失效时仅在文件名唯一时找回，避免同名书被误打开。"""
    matches = same_named_books(rel)
    if len(matches) == 1:
        full = safe_vault_path(matches[0])
        if full and os.path.isfile(full):
            return full
    return None


def build_index(force=False):
    cache = None
    if not force and os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, encoding="utf-8") as f:
                cache = json.load(f)
        except (OSError, ValueError):
            cache = None
    if cache and time.time() - cache.get("ts", 0) < CACHE_TTL and cache.get("books"):
        books = cache["books"]
    else:
        books = scan_books()
        try:
            os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
            with open(CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump({"ts": time.time(), "books": books}, f, ensure_ascii=False)
        except OSError:
            pass
    notes, orphan_notes = scan_notes(books)
    lib_meta = load_lib_meta()
    apply_custom_categories(books, notes, lib_meta)
    return {"generated": time.strftime("%Y-%m-%d %H:%M:%S"), "count": len(books),
            "books": books, "notes": notes, "userCategories": lib_meta["categories"],
            "noteTotal": len(notes) + len(orphan_notes), "orphanNotes": orphan_notes}


WWO_ZH = {
    113: ("晴", "☀️"), 116: ("局部多云", "⛅"), 119: ("多云", "⛅"), 122: ("阴", "☁️"),
    143: ("薄雾", "🌫️"), 149: ("霾", "🌫️"), 176: ("零星小雨", "🌦️"), 179: ("零星阵雪", "🌨️"),
    182: ("零星雨夹雪", "🌨️"), 185: ("零星冻雨", "🌧️"), 200: ("局部雷雨", "⛈️"),
    227: ("风吹雪", "🌨️"), 230: ("暴风雪", "❄️"), 248: ("雾", "🌫️"), 260: ("冻雾", "🌫️"),
    263: ("零星毛毛雨", "🌦️"), 266: ("毛毛雨", "🌦️"), 281: ("冻雨", "🌧️"), 284: ("强冻雨", "🌧️"),
    293: ("零星小雨", "🌦️"), 296: ("小雨", "🌧️"), 299: ("间有中雨", "🌧️"), 302: ("中雨", "🌧️"),
    305: ("间有大雨", "🌧️"), 308: ("大雨", "🌧️"), 311: ("轻冻雨", "🌧️"), 314: ("强冻雨", "🌧️"),
    317: ("轻雨夹雪", "🌨️"), 320: ("强雨夹雪", "🌨️"), 323: ("零星小雪", "🌨️"), 326: ("小雪", "🌨️"),
    329: ("零星中雪", "🌨️"), 332: ("中雪", "🌨️"), 335: ("零星大雪", "❄️"), 338: ("大雪", "❄️"),
    350: ("冰粒", "❄️"), 353: ("小阵雨", "🌦️"), 356: ("中到大阵雨", "🌧️"), 359: ("暴雨", "🌧️"),
    362: ("小阵雨夹雪", "🌨️"), 365: ("强阵雨夹雪", "🌨️"), 368: ("小阵雪", "🌨️"), 371: ("强阵雪", "❄️"),
    386: ("雷阵雨", "⛈️"), 389: ("强雷雨", "⛈️"), 392: ("雷阵雪", "⛈️"), 395: ("强雷阵雪", "⛈️"),
}


def _weather_from_desc(desc):
    d = (desc or "").lower()
    if "thunder" in d:
        return ("雷雨", "⛈️")
    if "torrential" in d or "heavy rain" in d:
        return ("大雨", "🌧️")
    if "moderate rain" in d:
        return ("中雨", "🌧️")
    if "drizzle" in d or "light rain" in d or "rain" in d:
        return ("小雨", "🌧️")
    if "heavy snow" in d or "blizzard" in d:
        return ("大雪", "❄️")
    if "snow" in d or "sleet" in d or "ice" in d:
        return ("雪", "🌨️")
    if "fog" in d or "mist" in d or "haze" in d or "smoke" in d:
        return ("雾霾", "🌫️")
    if "overcast" in d:
        return ("阴", "☁️")
    if "cloud" in d:
        return ("多云", "⛅")
    if "sun" in d or "clear" in d:
        return ("晴", "☀️")
    return ("未知", "🌡️")


def _weather_wttr(city):
    url = "https://wttr.in/" + urllib.parse.quote(city) + "?format=j1"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=8) as r:
            wj = json.load(r)
        cur = (wj.get("current_condition") or [{}])[0]
        if "temp_C" not in cur:
            return {"ok": False, "msg": "wttr.in 未返回有效数据"}
        code = int(cur.get("weather_code", -1))
        desc = ((cur.get("weatherDesc") or [{}])[0].get("value") or "")
        text, icon = WWO_ZH.get(code) or _weather_from_desc(desc)
        return {"ok": True, "city": city,
                "temp": int(round(float(cur.get("temp_C", 0)))), "text": text, "icon": icon}
    except Exception:
        return {"ok": False, "msg": "天气服务暂不可用"}


def _weather_openmeteo(city):
    try:
        loc = None
        zh_hit = False
        for params in ("&count=1&language=zh", "&count=1"):
            geo_url = ("https://geocoding-api.open-meteo.com/v1/search?name="
                       + urllib.parse.quote(city) + params)
            try:
                with urllib.request.urlopen(urllib.request.Request(geo_url, headers=UA), timeout=8) as r:
                    gj = json.load(r)
            except Exception:
                continue
            results = gj.get("results") or []
            if results:
                loc = results[0]
                zh_hit = params.endswith("zh")
                break
        if not loc:
            sc = CITY_COORDS.get(city)
            if not sc and city.endswith("市"):
                sc = CITY_COORDS.get(city[:-1])
            if not sc:
                return {"ok": False, "msg": "找不到城市：" + city}
            loc = {"latitude": sc[0], "longitude": sc[1], "name": city}
        furl = ("https://api.open-meteo.com/v1/forecast?latitude=%s&longitude=%s"
                "&current=temperature_2m,weather_code&timezone=auto") % (loc["latitude"], loc["longitude"])
        with urllib.request.urlopen(urllib.request.Request(furl, headers=UA), timeout=8) as r:
            wj = json.load(r)
        cur = wj.get("current") or {}
        code = cur.get("weather_code", -1)
        text, icon = WMO.get(code, ("未知", "🌡️"))
        return {"ok": True, "city": loc.get("name", city) if zh_hit else city,
                "temp": int(round(cur.get("temperature_2m", 0))), "text": text, "icon": icon}
    except Exception:
        return {"ok": False, "msg": "天气服务暂不可用"}


def get_weather(city):
    now = time.time()
    hit = WEATHER_CACHE.get(city)
    if hit:
        ttl = WEATHER_TTL if hit[1].get("ok") else WEATHER_FAIL_TTL
        if now - hit[0] < ttl:
            return hit[1]
    out = _weather_wttr(city)
    if not out.get("ok"):
        out = _weather_openmeteo(city)
    if len(WEATHER_CACHE) >= WEATHER_CACHE_MAX:
        oldest = min(WEATHER_CACHE, key=lambda k: WEATHER_CACHE[k][0])
        WEATHER_CACHE.pop(oldest, None)
    WEATHER_CACHE[city] = (now, out)
    return out


def sanitize_base(name):
    base = re.sub(r"[\\/:*?\"<>|]", "_", name).strip().strip(".")
    return base or hashlib.sha1(name.encode("utf-8")).hexdigest()[:8]


def title_tokens(name):
    base = os.path.splitext(os.path.basename(name))[0]
    base = re.sub(r"_冲突.*$", "", base)
    base = re.sub(r"_\d+$", "", base)
    return frozenset(re.findall(r"[\u4e00-\u9fff]+|[A-Za-z0-9]+", base))


def _cjk_len(ts):
    return sum(len(t) for t in ts if re.fullmatch(r"[\u4e00-\u9fff]+", t))


def tokens_match(a, b):
    if not a or not b:
        return False
    if a == b:
        return _cjk_len(a) >= 4
    small, big = (a, b) if len(a) <= len(b) else (b, a)
    return small < big and _cjk_len(small) >= 4


def note_path_for(book_rel, for_write=False):
    """笔记定位：精确 source 优先；同名或模糊匹配只允许唯一馆藏。"""
    base = sanitize_base(os.path.splitext(os.path.basename(book_rel))[0])
    cand = os.path.join(NOTES_DIR, base + ".md")
    unique_name = has_unique_book_filename(book_rel)
    if os.path.exists(cand):
        try:
            with open(cand, encoding="utf-8") as f:
                meta = parse_note_meta(f.read())
            if meta.get("source") == book_rel or (not meta.get("source") and unique_name):
                return cand
        except OSError:
            pass
    if os.path.isdir(NOTES_DIR):
        # 完整 source 是稳定主键，应优先于文件名、标题等启发式规则。
        for fn in sorted(os.listdir(NOTES_DIR)):
            if not fn.endswith(".md") or "冲突" in fn:
                continue
            full = os.path.join(NOTES_DIR, fn)
            try:
                with open(full, encoding="utf-8") as f:
                    m2 = parse_note_meta(f.read())
            except OSError:
                continue
            if m2.get("source") == book_rel:
                return full
    if unique_name and os.path.isdir(NOTES_DIR):
        target = os.path.basename(book_rel)
        for fn in sorted(os.listdir(NOTES_DIR)):
            if not fn.endswith(".md") or "冲突" in fn:
                continue
            full = os.path.join(NOTES_DIR, fn)
            try:
                with open(full, encoding="utf-8") as f:
                    m2 = parse_note_meta(f.read())
            except OSError:
                continue
            src = m2.get("source") or ""
            if src and os.path.basename(src) == target:
                return full
    bt = title_tokens(book_rel)
    if unique_name and bt and os.path.isdir(NOTES_DIR):
        for fn in sorted(os.listdir(NOTES_DIR)):
            if not fn.endswith(".md") or "冲突" in fn:
                continue
            full = os.path.join(NOTES_DIR, fn)
            try:
                with open(full, encoding="utf-8") as f:
                    m3 = parse_note_meta(f.read())
            except OSError:
                continue
            src = m3.get("source") or ""
            if src and os.path.basename(src) != target:
                continue
            nt = title_tokens(fn)
            if for_write:
                ok = bool(nt) and bool(bt) and _cjk_len(bt) >= 4 and (nt == bt or bt < nt)
            else:
                ok = tokens_match(bt, nt)
            if ok:
                return full
    if os.path.exists(cand):
        return os.path.join(NOTES_DIR, base + "-" + hashlib.sha1(book_rel.encode("utf-8")).hexdigest()[:6] + ".md")
    return cand


def safe_vault_path(rel):
    rel = rel.replace("\\", "/")
    full = os.path.realpath(os.path.join(VAULT, rel))
    vault_real = os.path.realpath(VAULT)
    if not (full == vault_real or full.startswith(vault_real + os.sep)):
        return None
    return full


def load_daily_tags():
    try:
        with open(DAILY_TAGS_FILE, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def search_names(q):
    k = q.lower()
    notes = []
    try:
        with open(os.path.join(WWW, "cache", "graph.json"), encoding="utf-8") as f:
            g = json.load(f)
        for n in g.get("nodes", []):
            if k in n.get("title", "").lower() or k in n.get("id", "").lower():
                notes.append({"id": n.get("id"), "title": n.get("title"),
                              "folder": n.get("folder"), "mtime": n.get("mtime")})
            if len(notes) >= 100:
                break
    except (OSError, ValueError):
        pass
    books = []
    try:
        idx = build_index()
        for b in idx["books"]:
            if k in b["name"].lower():
                books.append({"name": b["name"], "path": b["path"],
                              "category": b["category"], "ext": b["ext"]})
            if len(books) >= 100:
                break
    except Exception:
        pass
    return {"notes": notes, "books": books}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WWW, **kwargs)

    def log_message(self, fmt, *args):
        pass

    def send_head(self):
        self._static_file = True
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path in {"/manual", "/manual/"}:
            self.path = urllib.parse.urlunsplit(("", "", "/manual.html", parsed.query, parsed.fragment))
        return super().send_head()

    def end_headers(self):
        self.send_header("Content-Security-Policy",
                         "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'; "
                         "form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                         "img-src 'self' blob: data:; font-src 'self' data:; frame-src 'self'; "
                         "connect-src 'self' http://127.0.0.1:27123")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        if getattr(self, "_static_file", False):
            path = urllib.parse.urlparse(self.path).path
            if path == "/" or path.endswith(".html"):
                self.send_header("Cache-Control", "no-cache")
            elif path.startswith("/cache/"):
                self.send_header("Cache-Control", "no-store")
            elif path.startswith("/assets/") or path.startswith("/tessdata/"):
                self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        self._static_file = False
        super().end_headers()

    def _json(self, code, obj, extra_headers=None):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra_headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _has_portal_session(self):
        if not PORTAL_AUTH_ENABLED:
            return True
        try:
            jar = http_cookies.SimpleCookie()
            jar.load(self.headers.get("Cookie", ""))
            morsel = jar.get(PORTAL_COOKIE_NAME)
            value = morsel.value if morsel else ""
            return bool(value) and hmac.compare_digest(value, PORTAL_SESSION_ID)
        except Exception:
            return False

    def _require_portal_session(self):
        if not PORTAL_AUTH_ENABLED:
            return True
        if self._has_portal_session():
            return True
        self._json(401, {"error": "门户会话未授权或已过期"})
        return False

    def _open_portal_session(self):
        if not PORTAL_AUTH_ENABLED:
            self._json(200, {"ok": True, "auth": "disabled"})
            return
        supplied = self.headers.get("X-Brain-Portal-Token", "")
        now = time.time()
        with AUTH_GUARD_LOCK:
            failures = [t for t in AUTH_GUARD["failures"] if now - t < AUTH_WINDOW_SECONDS]
            AUTH_GUARD["failures"] = failures
            if now < AUTH_GUARD["locked_until"]:
                self._json(429, {"error": "访问口令尝试过多，请 5 分钟后再试"})
                return
            if not supplied or not hmac.compare_digest(supplied, PORTAL_ACCESS_TOKEN):
                failures.append(now)
                AUTH_GUARD["failures"] = failures
                if len(failures) >= AUTH_MAX_FAILURES:
                    AUTH_GUARD["locked_until"] = now + AUTH_LOCK_SECONDS
                self._json(401, {"error": "访问口令无效"})
                return
            AUTH_GUARD["failures"] = []
            AUTH_GUARD["locked_until"] = 0.0
        cookie = (f"{PORTAL_COOKIE_NAME}={PORTAL_SESSION_ID}; Path=/; HttpOnly; "
                  f"SameSite=Strict; Max-Age={PORTAL_SESSION_TTL}")
        self._json(200, {"ok": True, "expiresIn": PORTAL_SESSION_TTL}, {"Set-Cookie": cookie})

    def do_GET(self):
        self._guard(self._do_GET)

    def do_PUT(self):
        self._guard(self._do_PUT)

    def do_POST(self):
        self._guard(self._do_POST)

    def _guard(self, fn):
        try:
            fn()
        except Exception as e:
            try:
                os.makedirs(os.path.join(ROOT, "state"), exist_ok=True)
                with open(ERROR_LOG, "a", encoding="utf-8") as f:
                    f.write(time.strftime("%Y-%m-%d %H:%M:%S") + " " + getattr(self, "path", "?") + " " + repr(e) + "\n")
            except OSError:
                pass
            try:
                self._json(500, {"error": "服务器内部错误，请查看本机日志"})
            except Exception:
                pass

    def version_string(self):
        return "SongjianTinglan"

    def _do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
        if parsed.path == "/portal/session":
            if self._has_portal_session():
                self._json(200, {"ok": True, "expiresIn": PORTAL_SESSION_TTL})
            else:
                self._open_portal_session()
            return
        if parsed.path in PROTECTED_GET_PATHS or parsed.path.startswith("/cache/"):
            if not self._require_portal_session():
                return
        if parsed.path == "/weather":
            city = (qs.get("city") or ["厦门"])[0].strip() or "厦门"
            self._json(200, get_weather(city))
            return
        if parsed.path == "/lib/index":
            try:
                self._json(200, build_index(force="refresh" in qs))
            except Exception:
                self._json(500, {"error": "读取书库索引失败"})
            return
        if parsed.path == "/lib/meta":
            try:
                idx = build_index()
                cats = load_lib_meta()["categories"]
                folder_cats = sorted({derive_category(b["path"]) for b in idx["books"]})
                tagcount = {}
                for n in idx["notes"].values():
                    for t in n.get("tags", []):
                        tagcount[t] = tagcount.get(t, 0) + 1
                self._json(200, {"categories": cats, "folderCategories": folder_cats,
                                 "tags": sorted(tagcount.items(), key=lambda kv: -kv[1])})
            except Exception:
                self._json(500, {"error": "读取书库元数据失败"})
            return
        if parsed.path == "/lib/file":
            rel = (qs.get("path") or [""])[0]
            full = safe_vault_path(rel) if rel else None
            ext = os.path.splitext(rel)[1].lower() if rel else ""
            if rel and (not full or not os.path.isfile(full)):
                full = resolve_book_file(rel)
            if not full or ext not in (BOOK_EXTS | MEDIA_EXTS) or not os.path.isfile(full):
                self._json(404, {"error": "文件不存在或类型不允许"})
                return
            lib_real = os.path.realpath(os.path.join(VAULT, LIB_ROOT))
            if not os.path.realpath(full).startswith(lib_real + os.sep):
                self._json(404, {"error": "文件不存在或类型不允许"})
                return
            self._stream(full)
            return
        if parsed.path == "/lib/notes":
            rel = (qs.get("book") or [""])[0]
            if not rel:
                self._json(400, {"error": "缺少 book 参数"})
                return
            np = note_path_for(rel)
            if os.path.exists(np):
                try:
                    with open(np, encoding="utf-8") as f:
                        content = f.read()
                except OSError:
                    self._json(500, {"error": "读取笔记失败"})
                    return
                eff_cat = (load_lib_meta()["assign"].get(rel)
                           or parse_note_meta(content).get("category")
                           or derive_category(rel))
                self._json(200, {"exists": True, "content": content, "category": eff_cat,
                                 "notePath": os.path.relpath(np, VAULT).replace(os.sep, "/"),
                                 "version": note_version(content)})
            else:
                eff_cat = load_lib_meta()["assign"].get(rel) or derive_category(rel)
                self._json(200, {"exists": False, "content": "", "category": eff_cat,
                                 "notePath": os.path.relpath(np, VAULT).replace(os.sep, "/"),
                                 "version": None})
            return
        if parsed.path == "/screen":
            try:
                from PIL import ImageGrab
            except ImportError:
                self._json(500, {"error": "屏幕框选 OCR 需要安装 Pillow：在候选版目录运行 .venv\\Scripts\\python.exe -m pip install -r requirements.txt，或在 .env 设置 BRAIN_WEB_INSTALL_OPTIONAL_DEPS=1 后重新运行启动门户.bat"})
                return
            try:
                img = ImageGrab.grab(all_screens=True)
                SCREEN_SHOT["img"], SCREEN_SHOT["ts"] = img, time.time()
                buf = io.BytesIO()
                img.save(buf, "PNG")
                data = buf.getvalue()
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                self._json(500, {"error": "截屏失败：" + str(e)})
            return
        if parsed.path == "/daily_tags":
            self._json(200, load_daily_tags())
            return
        if parsed.path == "/moments":
            date = (qs.get("date") or [""])[0]
            mos = scan_moments()
            if date:
                if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
                    self._json(400, {"error": "date 格式应为 YYYY-MM-DD"})
                    return
                mos = [m for m in mos if m["date"] == date]
            self._json(200, {"moments": mos})
            return
        if parsed.path == "/timeline":
            month = (qs.get("month") or [""])[0]
            if not re.match(r"^\d{4}-\d{2}$", month):
                self._json(400, {"error": "month 格式应为 YYYY-MM"})
                return
            self._json(200, {"items": build_timeline(month)})
            return
        if parsed.path == "/moment/img":
            rel = (qs.get("path") or [""])[0]
            if not MOMENT_IMG_RE.match(rel):
                self._json(404, {"error": "图片不存在"})
                return
            full = os.path.join(MOMENTS_IMG_DIR, os.path.basename(rel))
            img_real = os.path.realpath(MOMENTS_IMG_DIR)
            if not os.path.realpath(full).startswith(img_real + os.sep) or not os.path.isfile(full):
                self._json(404, {"error": "图片不存在"})
                return
            self._stream(full)
            return
        if parsed.path == "/search/names":
            q = (qs.get("q") or [""])[0].strip()
            if not q:
                self._json(400, {"error": "缺少 q 参数"})
                return
            self._json(200, search_names(q))
            return
        super().do_GET()

    def _stream(self, full):
        size = os.path.getsize(full)
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        rng = self.headers.get("Range")
        start, end = 0, size - 1
        if rng:
            m = re.match(r"bytes=(\d*)-(\d*)", rng)
            if m:
                if m.group(1):
                    start = int(m.group(1))
                    if m.group(2):
                        end = min(int(m.group(2)), size - 1)
                elif m.group(2):
                    start = max(0, size - int(m.group(2)))
                    end = size - 1
        if start > end or start >= size:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return
        length = end - start + 1
        self.send_response(206 if rng else 200)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        if rng:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(length))
        self.end_headers()
        try:
            with open(full, "rb") as f:
                f.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = f.read(min(CHUNK, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _post_moment(self, body):
        text = body.get("text")
        if text is None:
            text = ""
        if not isinstance(text, str):
            self._json(400, {"error": "说说内容无效"})
            return
        text = text.strip()
        photos = body.get("photos") or []
        if not text and not photos:
            self._json(400, {"error": "说点什么，或加张照片"})
            return
        if len(text) > MOMENT_TEXT_MAX:
            self._json(400, {"error": "说说上限 50 字"})
            return
        if not isinstance(photos, list) or len(photos) > MOMENT_PHOTO_MAX:
            self._json(400, {"error": "照片最多 4 张"})
            return
        decoded = []
        for p in photos:
            if not isinstance(p, str):
                self._json(400, {"error": "照片数据无效"})
                return
            m = re.match(r"^data:image/(jpeg|png|webp|gif);base64,(.+)$", p.strip(), re.S)
            if not m:
                self._json(400, {"error": "仅支持 jpg/png/webp/gif"})
                return
            try:
                raw = base64.b64decode(m.group(2), validate=True)
            except Exception:
                self._json(400, {"error": "照片解码失败"})
                return
            if len(raw) > MOMENT_PHOTO_BYTES:
                self._json(413, {"error": "单张照片上限 1.5MB"})
                return
            if not _img_magic_ok(raw):
                self._json(400, {"error": "照片内容格式不符"})
                return
            decoded.append((m.group(1), raw))
        now = time.localtime()
        stamp = time.strftime("%Y%m%d-%H%M%S", now)
        os.makedirs(MOMENTS_IMG_DIR, exist_ok=True)
        saved = []
        try:
            for i, (fmt, raw) in enumerate(decoded):
                ext = {"jpeg": ".jpg", "png": ".png", "webp": ".webp", "gif": ".gif"}[fmt]
                name = "%s_%d%s%s" % (stamp, i, uuid.uuid4().hex[:8], ext)
                with open(os.path.join(MOMENTS_IMG_DIR, name), "wb") as f:
                    f.write(raw)
                saved.append("images/" + name)
            lines = ["---", "type: moment", "date: " + time.strftime("%Y-%m-%d", now),
                     'time: "' + time.strftime("%H:%M", now) + '"']
            if saved:
                lines.append("photos:")
                lines += ["  - " + s for s in saved]
            lines.append("---")
            content = "\n".join(lines) + "\n" + (text + "\n" if text else "")
            os.makedirs(MOMENTS_DIR, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=MOMENTS_DIR, suffix=".tmp")
            try:
                with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
                    f.write(content)
                os.replace(tmp, os.path.join(MOMENTS_DIR, "说说-%s-%s.md" % (stamp, uuid.uuid4().hex[:8])))
            except OSError:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
                raise
        except Exception:
            for s in saved:
                try:
                    os.unlink(os.path.join(MOMENTS_DIR, s.replace("/", os.sep)))
                except OSError:
                    pass
            raise
        self._json(200, {"ok": True, "date": time.strftime("%Y-%m-%d", now)})

    def _do_PUT(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        if not self._require_portal_session():
            return
        origin = self.headers.get("Origin")
        if origin not in ALLOWED_ORIGINS:
            self._json(403, {"error": "拒绝跨站请求"})
            return
        if parsed.path == "/lib/notes":
            ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            if ctype != "text/markdown":
                self._json(415, {"error": "仅接受 text/markdown 请求"})
                return
            rel = (qs.get("book") or [""])[0]
            if not rel or safe_vault_path(rel) is None:
                self._json(400, {"error": "非法 book 参数"})
                return
            cl = self.headers.get("Content-Length")
            if cl is None:
                self._json(411, {"error": "缺少 Content-Length"})
                return
            try:
                length = int(cl)
            except ValueError:
                self._json(400, {"error": "Content-Length 无效"})
                return
            if length <= 0:
                self._json(400, {"error": "正文为空，拒绝覆盖已有笔记"})
                return
            if length > NOTE_MAX_BYTES:
                self._json(413, {"error": "正文过大（上限 5MB）"})
                return
            try:
                body = self.rfile.read(length).decode("utf-8")
            except (ValueError, UnicodeDecodeError):
                self._json(400, {"error": "正文必须是 UTF-8 文本"})
                return
            np = note_path_for(rel, for_write=True)
            current = None
            try:
                if os.path.exists(np):
                    with open(np, encoding="utf-8") as f:
                        current = f.read()
            except OSError:
                self._json(500, {"error": "读取现有笔记失败"})
                return
            expected = self.headers.get("If-Match")
            creating = self.headers.get("If-None-Match") == "*"
            if current is None:
                if not creating:
                    self._json(428, {"error": "新建笔记需要 If-None-Match: *"})
                    return
            elif not expected or not hmac.compare_digest(expected, note_version(current)):
                self._json(409, {"error": "笔记已被其他位置修改，请重新加载后处理冲突"})
                return
            try:
                os.makedirs(NOTES_DIR, exist_ok=True)
                fd, tmp = tempfile.mkstemp(dir=NOTES_DIR, suffix=".tmp")
                try:
                    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
                        f.write(body)
                    os.replace(tmp, np)
                except OSError:
                    try:
                        os.unlink(tmp)
                    except OSError:
                        pass
                    raise
            except OSError:
                self._json(500, {"error": "保存笔记失败"})
                return
            self._json(200, {"ok": True,
                             "notePath": os.path.relpath(np, VAULT).replace(os.sep, "/"),
                             "version": note_version(body)})
            return
        self._json(405, {"error": "method not allowed"})

    def _do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if not self._require_portal_session():
            return
        if parsed.path not in ("/lib/categories", "/lib/assign", "/screen/crop", "/daily_tags", "/rebuild", "/moments"):
            self._json(405, {"error": "method not allowed"})
            return
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if ctype != "application/json":
            self._json(415, {"error": "仅接受 application/json 请求"})
            return
        origin = self.headers.get("Origin")
        if origin not in ALLOWED_ORIGINS:
            self._json(403, {"error": "拒绝跨站请求"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            length = 0
        limit = MOMENT_MAX_BYTES if parsed.path == "/moments" else JSON_MAX_BYTES
        if length <= 0 or length > limit:
            self._json(413, {"error": "请求体缺失或过大"})
            return
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            if not isinstance(body, dict):
                self._json(400, {"error": "请求体必须是 JSON 对象"})
                return
        except (ValueError, UnicodeDecodeError):
            self._json(400, {"error": "请求体必须是有效 JSON"})
            return
        if parsed.path == "/moments":
            self._post_moment(body)
            return
        if parsed.path == "/lib/categories":
            cats = body.get("categories")
            if not isinstance(cats, list):
                self._json(400, {"error": "categories 必须是数组"})
                return
            with META_LOCK:
                meta = load_lib_meta()
                for old, new in (body.get("rename") or {}).items():
                    if isinstance(old, str) and isinstance(new, str) and new.strip():
                        for k, v in list(meta["assign"].items()):
                            if v == old:
                                meta["assign"][k] = new.strip()
                clean, seen = [], set()
                for c in cats:
                    if isinstance(c, str) and c.strip() and c.strip() not in seen:
                        seen.add(c.strip())
                        clean.append(c.strip())
                removed = [c for c in meta["categories"] if c not in seen]
                for k, v in list(meta["assign"].items()):
                    if v in removed:
                        meta["assign"].pop(k, None)
                meta["categories"] = clean
                ok = save_lib_meta(meta)
            if ok:
                self._json(200, {"ok": True, "categories": clean})
            else:
                self._json(500, {"error": "保存分类失败"})
            return
        if parsed.path == "/lib/assign":
            path = (body.get("path") or "").strip()
            cat = (body.get("category") or "").strip()
            if not path:
                self._json(400, {"error": "缺少 path"})
                return
            if cat == "未分类":
                self._json(400, {"error": "「未分类」不能作为自定义分类"})
                return
            with META_LOCK:
                meta = load_lib_meta()
                if cat:
                    meta["assign"][path] = cat
                    if cat not in meta["categories"]:
                        meta["categories"].append(cat)
                else:
                    meta["assign"].pop(path, None)
                ok = save_lib_meta(meta)
            if ok:
                self._json(200, {"ok": True})
            else:
                self._json(500, {"error": "保存分类失败"})
            return
        if parsed.path == "/daily_tags":
            date = (body.get("date") or "").strip()
            tags = body.get("tags")
            if not re.match(r"^\d{4}-\d{2}-\d{2}$", date) or not isinstance(tags, list):
                self._json(400, {"error": "date 需为 YYYY-MM-DD，tags 需为数组"})
                return
            try:
                time.strptime(date, "%Y-%m-%d")
            except ValueError:
                self._json(400, {"error": "date 需为真实存在的日期"})
                return
            clean = []
            for t in tags:
                if isinstance(t, str) and t.strip() and t.strip() not in clean:
                    clean.append(t.strip())
            try:
                with META_LOCK:
                    data = load_daily_tags()
                    if clean:
                        data[date] = clean[:12]
                    else:
                        data.pop(date, None)
                    os.makedirs(os.path.dirname(DAILY_TAGS_FILE), exist_ok=True)
                    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(DAILY_TAGS_FILE), suffix=".tmp")
                    try:
                        with os.fdopen(fd, "w", encoding="utf-8") as f:
                            json.dump(data, f, ensure_ascii=False)
                        os.replace(tmp, DAILY_TAGS_FILE)
                    except OSError:
                        try:
                            os.unlink(tmp)
                        except OSError:
                            pass
                        raise
                self._json(200, {"ok": True, "tags": data})
            except OSError:
                self._json(500, {"error": "保存失败"})
            return
        if parsed.path == "/rebuild":
            import subprocess, sys
            if not REBUILD_LOCK.acquire(blocking=False):
                self._json(429, {"error": "已有重建任务在进行，请稍候"})
                return
            t0 = time.time()
            try:
                r = subprocess.run([sys.executable, BUILD_SCRIPT], cwd=ROOT,
                                   capture_output=True, text=True,
                                   encoding="utf-8", errors="replace", timeout=600)
                tail = ""
                try:
                    with open(os.path.join(ROOT, "state", "build_index.log"), encoding="utf-8") as f:
                        tail = f.readlines()[-1].strip()
                except OSError:
                    pass
                if r.returncode == 0:
                    self._json(200, {"ok": True, "seconds": round(time.time() - t0, 1),
                                     "returncode": r.returncode, "last_log": tail})
                else:
                    self._json(500, {"error": "重建索引失败，请查看本机日志", "returncode": r.returncode})
            except subprocess.TimeoutExpired:
                self._json(500, {"error": "重建超时（>600s）"})
            except Exception:
                self._json(500, {"error": "重建索引失败，请查看本机日志"})
            finally:
                REBUILD_LOCK.release()
            return
        if parsed.path == "/screen/crop":
            if not SCREEN_SHOT["img"] or time.time() - SCREEN_SHOT["ts"] > 120:
                self._json(400, {"error": "截图已过期，请重新点击截屏"})
                return
            try:
                x, y = int(body.get("x", 0)), int(body.get("y", 0))
                w, h = int(body.get("w", 0)), int(body.get("h", 0))
            except (TypeError, ValueError):
                self._json(400, {"error": "选区参数无效"})
                return
            img = SCREEN_SHOT["img"]
            box = (max(0, x), max(0, y), min(img.width, x + w), min(img.height, y + h))
            if w <= 0 or h <= 0 or box[2] <= box[0] or box[3] <= box[1]:
                self._json(400, {"error": "选区无效或超出屏幕"})
                return
            try:
                buf = io.BytesIO()
                img.crop(box).save(buf, "PNG")
                data = buf.getvalue()
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except Exception:
                self._json(500, {"error": "裁剪失败"})
            return


def _enable_dpi_awareness():
    try:
        import ctypes
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2)
        except Exception:
            ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass


if __name__ == "__main__":
    if not VAULT or not os.path.isdir(VAULT):
        raise SystemExit(f"请通过 {VAULT_ENV} 设置一个存在的 Obsidian Vault 路径")
    if PORTAL_AUTH_ENABLED and len(PORTAL_ACCESS_TOKEN) < 16:
        raise SystemExit("请通过 BRAIN_WEB_PORTAL_TOKEN 设置至少 16 位的门户访问口令")
    _enable_dpi_awareness()
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    server.serve_forever()
