import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "../components/Toast.jsx";
import { portalFetch } from "../lib/api.js";

const PAGE_SIZE = 100;
const EXT_LABEL = { ".pdf": "PDF", ".epub": "EPUB", ".djvu": "DJVU", ".mobi": "MOBI", ".azw3": "AZW3" };
const EXT_STYLE = {
  ".pdf": "bg-[rgba(192,72,63,.12)] text-[var(--color-seal)] border-[rgba(192,72,63,.32)]",
  ".epub": "bg-[rgba(47,107,90,.12)] text-[var(--color-jade-deep)] border-[rgba(47,107,90,.32)]",
  ".djvu": "bg-[rgba(181,132,34,.14)] text-[#8a6d1f] border-[rgba(181,132,34,.36)]",
};
const NO_PREVIEW = { ".epub": "EPUB", ".djvu": "DJVU", ".mobi": "MOBI", ".azw3": "AZW3" };

function fmtSize(n) {
  if (n >= 1073741824) return (n / 1073741824).toFixed(1) + " GB";
  if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
  return Math.max(1, Math.round(n / 1024)) + " KB";
}

function safeDecode(s) { try { return decodeURIComponent(s); } catch { return s; } }

async function getJson(url) {
  const r = await portalFetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("请求失败 " + r.status);
  return r.json();
}

async function postJson(url, obj) {
  const r = await portalFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  });
  let j = {};
  try { j = await r.json(); } catch { /* 忽略非 JSON 响应 */ }
  if (!r.ok) throw new Error(j.error || ("请求失败 " + r.status));
  return j;
}

export default function Library() {
  const params = useParams();
  const raw = params["*"] || "";
  if (raw) return <BookDetail path={safeDecode(raw)} />;
  return <BookList />;
}

function ExtBadge({ ext }) {
  return (
    <span className={"text-[12px] px-1.5 py-[1px] rounded border shrink-0 " + (EXT_STYLE[ext] || "bg-[rgba(96,125,104,.12)] text-[var(--color-paper-dim)] border-[rgba(96,125,104,.3)]")}>
      {EXT_LABEL[ext] || ext.replace(".", "").toUpperCase()}
    </span>
  );
}

function CategoryManager({ initial, onSaved, onClose }) {
  const [rows, setRows] = useState(() => initial.map((c) => ({ orig: c, name: c })));
  const [add, setAdd] = useState("");
  const [busy, setBusy] = useState(false);

  function addCat() {
    const n = add.trim();
    if (!n) return;
    if (rows.some((r) => r.name.trim() === n)) { toast("已有同名分类", "err"); return; }
    setRows((rs) => [...rs, { orig: null, name: n }]);
    setAdd("");
  }

  async function save() {
    setBusy(true);
    try {
      const categories = [];
      const rename = {};
      rows.forEach((r) => {
        const n = r.name.trim();
        if (n && !categories.includes(n)) {
          categories.push(n);
          if (r.orig && r.orig !== n) rename[r.orig] = n;
        }
      });
      await postJson("/lib/categories", { categories, rename });
      toast("分类已保存", "ok");
      onSaved();
    } catch (e) { toast("保存失败：" + e.message, "err"); }
    finally { setBusy(false); }
  }

  return (
    <div className="panel p-4 mb-3 anim-fade-up">
      <div className="flex items-center gap-2.5 mb-2.5 flex-wrap">
        <div className="text-[15px] font-medium">管理我的分类</div>
        <div className="text-[12.5px] text-[var(--color-paper-faint)]">重命名会自动迁移已归类图书；删除分类后相关图书回到目录分类</div>
      </div>
      {rows.length === 0 && <div className="text-[13.5px] text-[var(--color-paper-faint)] mb-2">还没有自定义分类，先在下方添加一个。</div>}
      <div className="space-y-1.5 mb-2.5">
        {rows.map((r, i) => (
          <div key={r.orig || ("new" + i)} className="flex items-center gap-2">
            <input value={r.name}
              onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              className="ink-input w-[280px] px-2.5 py-[6px] text-[14px]" />
            {r.orig && r.orig !== r.name.trim() && (
              <span className="text-[12px] text-[var(--color-para-project)]">将重命名「{r.orig}」</span>
            )}
            <button onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
              className="btn-ghost px-2 py-[4px] text-[13px] text-[var(--color-seal)]">删除</button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 mb-3">
        <input value={add} onChange={(e) => setAdd(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addCat(); }}
          placeholder="新分类名，如：汉宋史" className="ink-input w-[280px] px-2.5 py-[6px] text-[14px]" />
        <button onClick={addCat} className="btn-ghost px-3 py-[6px] text-[14px]">＋ 添加</button>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={busy} className="btn-ink px-4 py-[7px] text-[14.5px] disabled:opacity-50">{busy ? "保存中…" : "保存并应用"}</button>
        <button onClick={onClose} className="btn-ghost px-3 py-[7px] text-[14px]">收起</button>
      </div>
    </div>
  );
}

function RowCatSelect({ b, userCats, onAssign }) {
  const opts = [...userCats];
  if (b.category && !opts.includes(b.category)) opts.push(b.category);
  return (
    <select value={opts.includes(b.category) ? b.category : ""}
      onChange={(e) => onAssign(b, e.target.value)}
      onClick={(e) => e.stopPropagation()}
      className="ink-input px-2 py-[4px] text-[13px] max-w-[170px]">
      {opts.map((c) => <option key={c} value={c}>{c}</option>)}
      <option value="">（目录）{b.folderCategory || "未分类"}</option>
    </select>
  );
}

const COVER_PALETTES = [
  ["#37695c", "#2b5449"], ["#5b7f74", "#47665d"], ["#7d5a44", "#654738"],
  ["#8a6d1f", "#6e5617"], ["#4a6e8a", "#3a586f"], ["#93453c", "#7a372f"],
  ["#5d6b46", "#495537"], ["#6b5a74", "#55475d"], ["#2f6b5a", "#24564a"],
];
const GRID_STEP = 240;

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

function Cover({ b, noted }) {
  const h = hashStr(b.path);
  const pal = COVER_PALETTES[h % COVER_PALETTES.length];
  return (
    <div className="cover relative w-full aspect-[3/4] rounded-[5px] overflow-hidden"
      style={{ background: "linear-gradient(150deg," + pal[0] + " 0%," + pal[1] + " 100%)" }}>
      <div className="absolute inset-[6px] border border-[rgba(247,244,234,.30)] rounded-[3px] pointer-events-none" />
      <div className="absolute top-[12px] bottom-[12px] right-[10px] flex justify-center pointer-events-none">
        <span className="cover-vt font-display text-[14px] text-[rgba(250,247,238,.95)]">{b.name}</span>
      </div>
      <div className="absolute left-[12px] bottom-[10px] text-[10.5px] tracking-[.18em] text-[rgba(247,244,234,.66)] pointer-events-none">松涧藏书</div>
      {noted && <span className="note-dot" title="有笔记" />}
      <span className="absolute top-[8px] left-[8px] text-[10px] px-1.5 py-[1px] rounded bg-[rgba(0,0,0,.30)] text-[rgba(247,244,234,.92)] pointer-events-none">
        {(b.ext || "").replace(".", "").toUpperCase()}
      </span>
    </div>
  );
}

function BookCard({ b, noted, onOpen }) {
  return (
    <div className="group cursor-pointer" onClick={onOpen} title={b.name}>
      <div className="cover-lift rounded-[5px]"><Cover b={b} noted={noted} /></div>
      <div className="mt-1.5 text-[13.5px] leading-snug text-[var(--color-paper)] line-clamp-2 group-hover:text-[var(--color-jade-deep)] transition-colors">{b.name}</div>
      <div className="mt-[2px] text-[12px] text-[var(--color-paper-faint)] truncate">{b.category}{b.group ? " · " + b.group : ""} · {fmtSize(b.size)}</div>
    </div>
  );
}

function RailBtn({ active, onClick, count, children }) {
  return (
    <button onClick={onClick}
      className={"w-full flex items-center justify-between gap-2 px-2.5 py-[7px] rounded-md text-[13.5px] text-left transition-colors " +
        (active ? "bg-[rgba(47,107,90,.12)] text-[var(--color-jade-deep)] font-medium" : "text-[var(--color-paper-dim)] hover:bg-[rgba(96,125,104,.08)]")}>
      <span className="truncate">{children}</span>
      <span className="text-[12px] text-[var(--color-paper-faint)] shrink-0">{count}</span>
    </button>
  );
}

const SORTERS = {
  name: (a, b) => a.name.localeCompare(b.name, "zh"),
  category: (a, b) => (a.category || "").localeCompare(b.category || "", "zh"),
  size: (a, b) => (a.size || 0) - (b.size || 0),
  mtime: (a, b) => (a.mtime || 0) - (b.mtime || 0),
};

function Th({ k, sortKey, sortDir, onSort, className, children }) {
  return (
    <th className={"px-3 py-2.5 font-medium cursor-pointer select-none hover:text-[var(--color-jade-deep)] " + (className || "")}
      onClick={() => onSort(k)}>
      {children}{sortKey === k ? (sortDir === 1 ? " ↑" : " ↓") : ""}
    </th>
  );
}

function BookTable({ books, notes, userCats, onAssign, onAssignMany, onOpen }) {
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState(1);
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState(() => new Set());
  const [bulkCat, setBulkCat] = useState("");

  const sorted = useMemo(() => {
    const arr = [...books].sort(SORTERS[sortKey] || SORTERS.name);
    if (sortDir === -1) arr.reverse();
    return arr;
  }, [books, sortKey, sortDir]);

  useEffect(() => { setPage(0); setSel(new Set()); }, [books]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const cur = Math.min(page, pages - 1);
  const slice = sorted.slice(cur * PAGE_SIZE, cur * PAGE_SIZE + PAGE_SIZE);
  const allSel = slice.length > 0 && slice.every((b) => sel.has(b.path));

  function onSort(k) {
    if (sortKey === k) setSortDir((d) => -d);
    else { setSortKey(k); setSortDir(1); }
  }
  function toggle(b) {
    setSel((s) => { const n = new Set(s); if (n.has(b.path)) n.delete(b.path); else n.add(b.path); return n; });
  }
  function toggleAll() {
    setSel((s) => {
      const n = new Set(s);
      if (allSel) slice.forEach((b) => n.delete(b.path));
      else slice.forEach((b) => n.add(b.path));
      return n;
    });
  }
  async function applyBulk() {
    const paths = [...sel];
    if (!paths.length) return;
    await onAssignMany(paths, bulkCat);
    setSel(new Set());
  }

  return (
    <>
      {sel.size > 0 && (
        <div className="panel p-3 mb-3 flex items-center gap-3 flex-wrap anim-fade-up">
          <span className="text-[14px] text-[var(--color-paper-dim)]">已选 {sel.size} 册</span>
          <select value={bulkCat} onChange={(e) => setBulkCat(e.target.value)}
            className="ink-input px-2.5 py-[6px] text-[13.5px] max-w-[220px]">
            <option value="">选择目标分类…</option>
            {userCats.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={applyBulk} disabled={!bulkCat}
            className="btn-ink px-3.5 py-[6px] text-[13.5px] disabled:opacity-40">批量归入</button>
          <button onClick={() => setSel(new Set())} className="btn-ghost px-3 py-[6px] text-[13.5px]">清除选择</button>
          <span className="text-[12.5px] text-[var(--color-paper-faint)]">目标分类需先在「管理分类」中创建</span>
        </div>
      )}
      <div className="panel overflow-hidden anim-fade-up">
        <table className="w-full text-[15px]">
          <thead>
            <tr className="text-left text-[13px] text-[var(--color-paper-faint)] border-b border-[rgba(96,125,104,.16)]">
              <th className="px-3 py-2.5 w-[36px]">
                <input type="checkbox" checked={allSel} onChange={toggleAll} title="全选本页" />
              </th>
              <Th k="name" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="pl-1">书名</Th>
              <Th k="category" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="w-[190px]">分类（可直接改）</Th>
              <th className="px-3 py-2.5 font-medium w-[130px]">小组</th>
              <th className="px-3 py-2.5 font-medium w-[70px]">格式</th>
              <Th k="size" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="w-[90px]">大小</Th>
              <Th k="mtime" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="w-[110px]">更新</Th>
              <th className="px-3 py-2.5 font-medium w-[170px]">笔记 / 标签</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((b) => {
              const note = notes[b.path];
              return (
                <tr key={b.path} onClick={() => onOpen(b)}
                  className="border-b border-[rgba(96,125,104,.09)] hover:bg-[rgba(47,107,90,.06)] cursor-pointer transition-colors">
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={sel.has(b.path)} onChange={() => toggle(b)} />
                  </td>
                  <td className="px-3 py-2.5 text-[var(--color-paper)]">{b.name}</td>
                  <td className="px-3 py-2.5 text-[13.5px]">
                    <RowCatSelect b={b} userCats={userCats} onAssign={onAssign} />
                  </td>
                  <td className="px-3 py-2.5 text-[13px] text-[var(--color-paper-faint)] truncate">{b.group || "—"}</td>
                  <td className="px-3 py-2.5"><ExtBadge ext={b.ext} /></td>
                  <td className="px-3 py-2.5 text-[13.5px] text-[var(--color-paper-faint)]">{fmtSize(b.size)}</td>
                  <td className="px-3 py-2.5 text-[13px] text-[var(--color-paper-faint)]">
                    {b.mtime ? (() => { const d = new Date(b.mtime * 1000); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })() : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-[13px]">
                    {note ? (
                      <span className="text-[var(--color-jade-deep)]">
                        ✓ 有笔记{(note.tags || []).length ? "·" : ""} {(note.tags || []).slice(0, 3).map((t) => "#" + t).join(" ")}
                      </span>
                    ) : <span className="text-[var(--color-paper-faint)]">—</span>}
                  </td>
                </tr>
              );
            })}
            {!slice.length && (
              <tr><td colSpan="8" className="px-4 py-8 text-center text-[var(--color-paper-faint)] text-[14.5px]">没有符合条件的书</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center gap-2.5 mt-4">
          <button onClick={() => setPage(Math.max(0, cur - 1))} disabled={cur === 0}
            className="btn-ghost px-3.5 py-[7px] text-[14px] disabled:opacity-40">上一页</button>
          <button onClick={() => setPage(Math.min(pages - 1, cur + 1))} disabled={cur >= pages - 1}
            className="btn-ghost px-3.5 py-[7px] text-[14px] disabled:opacity-40">下一页</button>
          <span className="text-[13.5px] text-[var(--color-paper-faint)]">第 {cur + 1}/{pages} 页 · 每页 {PAGE_SIZE} 册 · 共 {sorted.length} 册</span>
        </div>
      )}
    </>
  );
}

function BookList() {
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [grp, setGrp] = useState("");
  const [tag, setTag] = useState("");
  const [pdfOnly, setPdfOnly] = useState(false);
  const [showCatMgr, setShowCatMgr] = useState(false);
  const [view, setView] = useState("grid");
  const [limit, setLimit] = useState(GRID_STEP);

  const load = useCallback(async (refresh) => {
    setBusy(true); setErr("");
    try {
      setData(await getJson("/lib/index" + (refresh ? "?refresh=1" : "")));
      setLimit(GRID_STEP);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { load(false); }, [load]);

  const notes = (data && data.notes) || {};
  const userCats = (data && data.userCategories) || [];
  const catGroups = useMemo(() => {
    const observed = [...new Set(((data && data.books) || []).map((b) => b.category))].sort();
    return { user: userCats, other: observed.filter((c) => !userCats.includes(c)) };
  }, [data, userCats]);
  const tagList = useMemo(() => {
    const m = {};
    Object.values(notes).forEach((n) => (n.tags || []).forEach((t) => { m[t] = (m[t] || 0) + 1; }));
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 40);
  }, [notes]);
  const catStats = useMemo(() => {
    const m = {};
    for (const b of (data && data.books) || []) m[b.category] = (m[b.category] || 0) + 1;
    return m;
  }, [data]);

  const filtered = useMemo(() => {
    let arr = (data && data.books) || [];
    if (cat) arr = arr.filter((b) => b.category === cat);
    if (grp) arr = arr.filter((b) => (b.group || "未分组") === grp);
    if (pdfOnly) arr = arr.filter((b) => b.ext === ".pdf");
    if (tag) arr = arr.filter((b) => ((notes[b.path] && notes[b.path].tags) || []).includes(tag));
    const k = q.trim().toLowerCase();
    if (k) arr = arr.filter((b) => b.name.toLowerCase().includes(k));
    return arr;
  }, [data, cat, grp, pdfOnly, tag, q, notes]);

  const grpList = useMemo(() => {
    if (!cat) return [];
    const m = {};
    for (const b of (data && data.books) || []) {
      if (b.category !== cat) continue;
      const g = b.group || "未分组";
      m[g] = (m[g] || 0) + 1;
    }
    return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0], "zh"));
  }, [data, cat]);

  useEffect(() => { setLimit(GRID_STEP); }, [q, cat, grp, tag, pdfOnly, view]);

  const notedCount = Object.keys(notes).length;
  const openBook = (b) => nav("/library/" + b.path.split("/").map(encodeURIComponent).join("/"));

  async function assignCat(b, catVal) {
    const prev = b.category;
    setData((d) => ({ ...d, books: d.books.map((x) => (x.path === b.path ? { ...x, category: catVal || x.folderCategory } : x)) }));
    try {
      await postJson("/lib/assign", { path: b.path, category: catVal || "" });
    } catch (e) {
      setData((d) => ({ ...d, books: d.books.map((x) => (x.path === b.path ? { ...x, category: prev } : x)) }));
      toast("分类失败：" + e.message, "err");
    }
  }

  async function assignMany(paths, catVal) {
    try {
      for (const p of paths) await postJson("/lib/assign", { path: p, category: catVal || "" });
      toast("已更新 " + paths.length + " 册分类", "ok");
      load(false);
    } catch (e) { toast("批量分类失败：" + e.message, "err"); }
  }

  const visible = filtered.slice(0, limit);

  return (
    <div className="px-7 py-6 max-w-[1560px] mx-auto">
      <div className="flex items-end gap-4 mb-4 anim-fade-up">
        <h1 className="font-display text-[31px] font-black tracking-wide">图书馆</h1>
        <div className="text-[14px] text-[var(--color-paper-faint)] mb-1">
          {data ? data.count + " 册藏书 · " + (data.noteTotal != null ? data.noteTotal : notedCount) + " 篇笔记" + (((data.orphanNotes || []).length) ? "（" + (data.orphanNotes || []).length + " 篇未关联藏书）" : "") : "正在加载书目…"}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-lg border border-[rgba(96,125,104,.32)] overflow-hidden text-[14px]">
            <button onClick={() => setView("grid")}
              className={"px-3.5 py-[7px] " + (view === "grid" ? "bg-[var(--color-jade)] text-[#f4faf7]" : "text-[var(--color-paper-dim)] hover:bg-[rgba(47,107,90,.08)]")}>封面</button>
            <button onClick={() => setView("table")}
              className={"px-3.5 py-[7px] " + (view === "table" ? "bg-[var(--color-jade)] text-[#f4faf7]" : "text-[var(--color-paper-dim)] hover:bg-[rgba(47,107,90,.08)]")}>表格</button>
          </div>
          <button onClick={() => load(true)} disabled={busy}
            className="btn-ghost px-3 py-[7px] text-[14px] disabled:opacity-50">
            {busy ? "扫描中…" : "刷新书目"}
          </button>
        </div>
      </div>

      {err && <div className="panel p-5 mb-4 text-[var(--color-seal)] text-[14.5px]">加载失败：{err}（需先启动门户服务）</div>}

      <div className="flex gap-5 items-start">
        <aside className="w-[196px] shrink-0 sticky top-[70px]">
          <div className="panel p-2.5 max-h-[calc(100vh-110px)] overflow-y-auto">
            <RailBtn active={!cat} count={data ? data.count : ""} onClick={() => { setCat(""); setGrp(""); }}>全部馆藏</RailBtn>
            {catGroups.user.length > 0 && (
              <div className="px-2.5 pt-2.5 pb-1 text-[11.5px] tracking-[.12em] text-[var(--color-paper-faint)]">我的分类</div>
            )}
            {catGroups.user.map((c) => (
              <RailBtn key={c} active={cat === c} count={catStats[c] || 0} onClick={() => { setCat(c); setGrp(""); }}>{c}</RailBtn>
            ))}
            <div className="px-2.5 pt-2.5 pb-1 text-[11.5px] tracking-[.12em] text-[var(--color-paper-faint)]">馆藏分类</div>
            {catGroups.other.map((c) => (
              <RailBtn key={c} active={cat === c} count={catStats[c] || 0} onClick={() => { setCat(c); setGrp(""); }}>{c}</RailBtn>
            ))}
          </div>
        </aside>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-3 anim-fade-up flex-wrap">
            <input value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="搜书名…"
              className="ink-input w-[300px] px-3 py-2 text-[15px]" />
            <label className="flex items-center gap-1.5 text-[14px] text-[var(--color-paper-dim)] cursor-pointer">
              <input type="checkbox" checked={pdfOnly} onChange={(e) => setPdfOnly(e.target.checked)} />
              仅看 PDF
            </label>
            <button onClick={() => setShowCatMgr((v) => !v)} className="btn-ghost px-3 py-[7px] text-[14px]">
              {showCatMgr ? "收起分类管理" : "管理分类"}
            </button>
            {(cat || grp || tag || q || pdfOnly) && (
              <button onClick={() => { setCat(""); setGrp(""); setTag(""); setQ(""); setPdfOnly(false); }}
                className="btn-ghost px-3 py-[7px] text-[14px] text-[var(--color-seal)]">清除筛选</button>
            )}
            <div className="ml-auto text-[13.5px] text-[var(--color-paper-faint)]">筛出 {filtered.length} 册</div>
          </div>

          {showCatMgr && (
            <CategoryManager initial={userCats}
              onSaved={() => { setShowCatMgr(false); load(false); }}
              onClose={() => setShowCatMgr(false)} />
          )}

          {tagList.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3 anim-fade-up">
              {tagList.map(([t, n]) => (
                <button key={t} onClick={() => setTag(tag === t ? "" : t)}
                  className={"text-[12.5px] px-2.5 py-[4px] rounded-full border transition-colors " +
                    (tag === t
                      ? "bg-[var(--color-jade)] text-[#f4faf7] border-[var(--color-jade)]"
                      : "bg-[rgba(47,107,90,.07)] text-[var(--color-jade-deep)] border-[rgba(47,107,90,.28)] hover:bg-[rgba(47,107,90,.14)]")}>
                  #{t} <span className="opacity-70">{n}</span>
                </button>
              ))}
            </div>
          )}

          {cat && grpList.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4 anim-fade-up">
              {grpList.map(([g, n]) => (
                <button key={g} onClick={() => setGrp(grp === g ? "" : g)}
                  className={"text-[13px] px-3 py-[5px] rounded-lg border transition-colors " +
                    (grp === g
                      ? "bg-[var(--color-jade)] text-[#f4faf7] border-[var(--color-jade)]"
                      : "bg-white/50 text-[var(--color-paper-dim)] border-[rgba(96,125,104,.28)] hover:bg-[rgba(47,107,90,.08)]")}>
                  {g} <span className="opacity-70">{n}</span>
                </button>
              ))}
            </div>
          )}

          {view === "grid" && (
            <>
              <div className="grid gap-x-4 gap-y-5" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(148px,1fr))" }}>
                {visible.map((b) => (
                  <BookCard key={b.path} b={b} noted={!!notes[b.path]} onOpen={() => openBook(b)} />
                ))}
              </div>
              {filtered.length > limit && (
                <div className="flex justify-center mt-6">
                  <button onClick={() => setLimit((l) => l + GRID_STEP)}
                    className="btn-ghost px-5 py-[8px] text-[14px]">
                    加载更多（还有 {filtered.length - limit} 册）
                  </button>
                </div>
              )}
              {!filtered.length && !busy && (
                <div className="panel p-8 text-center text-[var(--color-paper-faint)] text-[15px]">没有符合条件的书</div>
              )}
            </>
          )}

          {view === "table" && (
            <BookTable books={filtered} notes={notes} userCats={userCats}
              onAssign={assignCat} onAssignMany={assignMany} onOpen={openBook} />
          )}
        </div>
      </div>
    </div>
  );
}


function ScreenPicker({ shot, onCancel, onPick }) {
  const imgRef = useRef(null);
  const [rect, setRect] = useState(null);
  const dragRef = useRef(null);

  function pos(e) {
    const r = imgRef.current.getBoundingClientRect();
    return {
      x: Math.min(Math.max(e.clientX - r.left, 0), r.width),
      y: Math.min(Math.max(e.clientY - r.top, 0), r.height),
    };
  }
  function onDown(e) {
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
    const p = pos(e);
    dragRef.current = p;
    setRect({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  }
  function onMove(e) {
    if (!dragRef.current) return;
    const p = pos(e);
    setRect({ x0: dragRef.current.x, y0: dragRef.current.y, x1: p.x, y1: p.y });
  }
  function onUp() { dragRef.current = null; }

  const valid = rect && Math.abs(rect.x1 - rect.x0) > 5 && Math.abs(rect.y1 - rect.y0) > 5;

  function confirm() {
    const el = imgRef.current;
    if (!el || !valid) return;
    const scale = shot.w / el.clientWidth;
    onPick({
      x: Math.round(Math.min(rect.x0, rect.x1) * scale),
      y: Math.round(Math.min(rect.y0, rect.y1) * scale),
      w: Math.round(Math.abs(rect.x1 - rect.x0) * scale),
      h: Math.round(Math.abs(rect.y1 - rect.y0) * scale),
    });
  }

  return (
    <div className="fixed inset-0 z-[100] bg-[rgba(12,16,14,.9)] flex flex-col items-center justify-center gap-3 select-none p-4">
      <div className="text-[14.5px] text-[#f7f4ea]">在截图上按住拖动，框选要识别的区域，然后点「识别选中区域」</div>
      <div className="relative touch-none" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        <img ref={imgRef} src={shot.url} draggable={false} alt="屏幕截图"
          className="block max-w-[94vw] max-h-[80vh] cursor-crosshair" />
        {rect && valid && (
          <div className="absolute border-2 border-[var(--color-seal)] bg-[rgba(192,72,63,.14)] pointer-events-none"
            style={{
              left: Math.min(rect.x0, rect.x1) + "px",
              top: Math.min(rect.y0, rect.y1) + "px",
              width: Math.abs(rect.x1 - rect.x0) + "px",
              height: Math.abs(rect.y1 - rect.y0) + "px",
            }} />
        )}
      </div>
      <div className="flex items-center gap-2.5">
        <button onClick={confirm} disabled={!valid} className="btn-ink px-4 py-[8px] text-[14.5px] disabled:opacity-40">识别选中区域</button>
        <button onClick={onCancel} className="btn-ghost px-3.5 py-[8px] text-[14px]">取消</button>
        <span className="text-[12.5px] text-[rgba(247,244,234,.55)]">截图分辨率 {shot.w}×{shot.h}</span>
      </div>
    </div>
  );
}

function BookDetail({ path }) {
  const nav = useNavigate();
  const fileName = path.split("/").pop() || path;
  const dot = fileName.lastIndexOf(".");
  const ext = dot > 0 ? fileName.slice(dot).toLowerCase() : "";
  const bookName = dot > 0 ? fileName.slice(0, dot) : fileName;
  const isPdf = ext === ".pdf";
  const fileUrl = "/lib/file?path=" + encodeURIComponent(path);

  const [text, setText] = useState("");
  const [tags, setTags] = useState("");
  const [category, setCategory] = useState("");
  const [notePath, setNotePath] = useState("");
  const [exists, setExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ocrPct, setOcrPct] = useState(0);
  const [cats, setCats] = useState([]);
  const [shot, setShot] = useState(null);
  const [countdown, setCountdown] = useState(0);
  const shotUrlRef = useRef(null);
  const baseRef = useRef(null);
  const loadSeqRef = useRef(0);
  const ocrSeqRef = useRef(0);

  useEffect(() => () => {
    ocrSeqRef.current++;
    if (shotUrlRef.current) URL.revokeObjectURL(shotUrlRef.current);
  }, []);

  const loadNote = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setDirty(false);
    baseRef.current = null;
    setText(""); setTags(""); setCategory(""); setNotePath(""); setExists(false);
    try {
      const m = await getJson("/lib/meta");
      if (seq !== loadSeqRef.current) return;
      const userCats = m.categories || [];
      setCats([...userCats, ...((m.folderCategories || []).filter((c) => !userCats.includes(c)))]);
      const n = await getJson("/lib/notes?book=" + encodeURIComponent(path));
      if (seq !== loadSeqRef.current) return;
      setNotePath(n.notePath); setExists(n.exists); baseRef.current = n.exists ? n.version : null;
      let cat = n.category || "";
      if (n.exists) {
        setText(n.content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, ""));
        const fm = n.content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (fm) {
          const tm = fm[1].match(/tags:\s*\[(.*)\]/);
          if (tm) setTags(tm[1]);
          const cm = fm[1].match(/category:\s*(.*)/);
          if (cm && cm[1].trim()) cat = cm[1].trim().replace(/^"|"$/g, "");
        }
      }
      setCategory(cat);
    } catch (e) {
      if (seq === loadSeqRef.current) toast("加载失败：" + e.message, "err");
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    loadNote();
    return () => { loadSeqRef.current++; };
  }, [loadNote]);

  async function save() {
    if (loading) return;
    setSaving(true);
    try {
      const cleanScalar = (v) => String(v || "").replace(/[\r\n]/g, " ").trim();
      const tagArr = tags.split(/[,，]/).map(cleanScalar).filter(Boolean);
      const _d = new Date();
      const today = _d.getFullYear() + "-" + String(_d.getMonth() + 1).padStart(2, "0") + "-" + String(_d.getDate()).padStart(2,"0");
      const fm = "---\nsource: " + JSON.stringify(cleanScalar(path)) + "\ncategory: " + JSON.stringify(cleanScalar(category)) + "\ntags: [" + tagArr.map((tag) => JSON.stringify(tag)).join(", ") + "]\nupdated: " + today + "\n---\n\n";
      const r = await portalFetch("/lib/notes?book=" + encodeURIComponent(path), {
        method: "PUT",
        headers: exists
          ? { "Content-Type": "text/markdown; charset=utf-8", "If-Match": baseRef.current || "" }
          : { "Content-Type": "text/markdown; charset=utf-8", "If-None-Match": "*" },
        body: fm + text,
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 409) {
        toast("检测到笔记已在其他位置更新，已重载；请确认后再保存", "err");
        await loadNote();
        return;
      }
      if (!j.ok) throw new Error(j.error || String(r.status));
      baseRef.current = j.version || null;
      setNotePath(j.notePath); setExists(true); setDirty(false);
      if (category.trim()) postJson("/lib/assign", { path, category: category.trim() }).catch(() => toast("笔记已存，但分类同步失败", "err"));
      toast("笔记已保存：" + j.notePath, "ok");
    } catch (e) { toast("保存失败：" + e.message, "err"); }
    finally { setSaving(false); }
  }

  async function doOcr(file, token = ++ocrSeqRef.current) {
    if (!file) return;
    const active = () => token === ocrSeqRef.current;
    setOcrPct(1);
    try {
      const { ocrImage } = await import("../lib/ocr.js");
      if (!active()) return;
      const t = await ocrImage(file, (p) => { if (active()) setOcrPct(Math.max(2, Math.round(p * 100))); });
      if (!active()) return;
      const block = "\n> **截图识别（OCR）**\n" + t.split("\n").map((l) => "> " + l).join("\n") + "\n";
      setText((old) => (old && !old.endsWith("\n") ? old + "\n" : old) + block);
      setDirty(true);
      toast("识别完成", "ok");
    } catch (e) {
      if (active()) toast("OCR 失败：" + e.message, "err");
    } finally { if (active()) setOcrPct(0); }
  }

  async function startScreenOcr() {
    if (countdown > 0) return;
    const token = ++ocrSeqRef.current;
    const active = () => token === ocrSeqRef.current;
    for (let i = 3; i > 0; i--) {
      if (!active()) return;
      setCountdown(i);
      await new Promise((res) => setTimeout(res, 1000));
    }
    if (!active()) return;
    setCountdown(0);
    setOcrPct(1);
    try {
      const r = await portalFetch("/screen", { cache: "no-store" });
      if (!r.ok) {
        let msg = "截屏失败 " + r.status;
        try { msg = (await r.json()).error || msg; } catch { /* 忽略 */ }
        throw new Error(msg);
      }
      const blob = await r.blob();
      if (!active()) return;
      const url = URL.createObjectURL(blob);
      const im = new Image();
      await new Promise((res, rej) => { im.onload = res; im.onerror = () => rej(new Error("截图加载失败")); im.src = url; });
      if (!active()) { URL.revokeObjectURL(url); return; }
      shotUrlRef.current = url;
      setShot({ url, w: im.naturalWidth, h: im.naturalHeight, token });
    } catch (e) {
      if (active()) toast(e.message || "截屏失败；若是首次使用屏幕 OCR，请先安装 Pillow 可选依赖", "err");
    } finally { if (active()) setOcrPct(0); }
  }

  async function onPickRect(rect) {
    const token = shot?.token;
    const active = () => token && token === ocrSeqRef.current;
    if (!active()) return;
    if (shot) { URL.revokeObjectURL(shot.url); shotUrlRef.current = null; }
    setShot(null);
    setOcrPct(1);
    try {
      const r = await portalFetch("/screen/crop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rect),
      });
      if (!r.ok) {
        let msg = "裁剪失败 " + r.status;
        try { msg = (await r.json()).error || msg; } catch { /* 忽略 */ }
        throw new Error(msg);
      }
      const blob = await r.blob();
      if (!active()) return;
      await doOcr(new File([blob], "screen-ocr.png", { type: "image/png" }), token);
    } catch (e) {
      if (active()) {
        toast("OCR 失败：" + e.message, "err");
        setOcrPct(0);
      }
    }
  }

  function cancelShot() {
    ocrSeqRef.current++;
    if (shot?.url) URL.revokeObjectURL(shot.url);
    shotUrlRef.current = null;
    setShot(null);
    setCountdown(0);
    setOcrPct(0);
  }

  function onPaste(e) {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.type && it.type.startsWith("image/")) {
        e.preventDefault();
        doOcr(it.getAsFile());
        return;
      }
    }
  }

  return (
    <div className="h-full flex flex-col px-7 py-5 max-w-[1600px] mx-auto w-full">
      <div className="flex items-center gap-3 mb-4 shrink-0 anim-fade-up">
        <button onClick={() => nav("/library")} className="btn-ghost px-3 py-[7px] text-[14px]">← 返回书库</button>
        <h1 className="font-display text-[20px] font-bold truncate">{bookName}</h1>
        <ExtBadge ext={ext} />
        <a href={fileUrl} target="_blank" rel="noreferrer" className="btn-ghost px-3 py-[7px] text-[13.5px] ml-auto shrink-0">新窗口打开原文件</a>
      </div>

      <div className="flex-1 min-h-0 flex gap-5">
        <div className="flex-1 min-w-0 panel overflow-hidden anim-fade-up">
          {isPdf ? (
            <iframe src={fileUrl} title={bookName} className="w-full h-full border-0 bg-white" />
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-[var(--color-paper-dim)]">
              <div className="font-display text-[19px]">{NO_PREVIEW[ext] || ext} 格式暂不支持在线预览</div>
              <div className="text-[14px] text-[var(--color-paper-faint)]">可点右上角“新窗口打开原文件”交给系统软件打开；右侧仍可写笔记</div>
            </div>
          )}
        </div>

        <div className="w-[400px] shrink-0 flex flex-col gap-3 anim-fade-up min-h-0">
          <div className="panel p-4 space-y-2.5 shrink-0">
            <div className="flex gap-2.5">
              <div className="flex-1">
                <label className="text-[12.5px] text-[var(--color-paper-faint)]">分类</label>
                <input list="lib-cats" value={category} disabled={loading} onChange={(e) => { setCategory(e.target.value); setDirty(true); }}
                  placeholder="如：历史" className="ink-input w-full px-2.5 py-[7px] text-[14px]" />
                <datalist id="lib-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
              </div>
            </div>
            <div>
              <label className="text-[12.5px] text-[var(--color-paper-faint)]">标签（逗号分隔）</label>
              <input value={tags} disabled={loading} onChange={(e) => { setTags(e.target.value); setDirty(true); }}
                placeholder="如：汉宋史, 制度史" className="ink-input w-full px-2.5 py-[7px] text-[14px]" />
            </div>
          </div>

          <div className="panel p-4 flex-1 min-h-0 flex flex-col" onPaste={onPaste}>
            <div className="flex items-center gap-2 mb-2">
              <label className="text-[13.5px] font-medium text-[var(--color-paper)]">读书笔记</label>
              {exists && notePath && <span className="text-[12px] text-[var(--color-paper-faint)] truncate">{notePath}</span>}
              {loading && <span className="text-[12px] text-[var(--color-paper-faint)]">加载中…</span>}
              {!loading && dirty && <span className="text-[12px] text-[var(--color-para-project)]">未保存</span>}
            </div>
            <textarea value={text} disabled={loading} onChange={(e) => { setText(e.target.value); setDirty(true); }}
              placeholder="写点什么…支持 Markdown。可点“屏幕框选 OCR”截取屏幕区域识别，或直接 Ctrl+V 粘贴截图。"
              className="ink-input flex-1 min-h-0 w-full px-3 py-2.5 text-[14.5px] leading-relaxed resize-none font-body" />
            <div className="flex items-center gap-2 mt-2.5">
              <button onClick={save} disabled={saving || loading} className="btn-ink px-4 py-[8px] text-[14.5px] disabled:opacity-50">
                {loading ? "加载中…" : saving ? "保存中…" : "保存笔记"}
              </button>
              <button onClick={startScreenOcr} disabled={loading || ocrPct > 0 || !!shot || countdown > 0}
                className="btn-ghost px-3 py-[8px] text-[14px] disabled:opacity-50">
                屏幕框选 OCR
              </button>
              {ocrPct > 0 && (
                <span className="text-[13px] text-[var(--color-jade-deep)]">
                  {ocrPct === 1 ? "准备中…" : "识别中 " + ocrPct + "%"}
                </span>
              )}
            </div>
            <div className="text-[12px] text-[var(--color-paper-faint)] mt-1.5">提示：笔记存为 Vault 内 Markdown，Obsidian 与搜索均可见。</div>
          </div>
        </div>
      </div>

      {countdown > 0 && (
        <div className="fixed inset-0 z-[100] bg-[rgba(12,16,14,.92)] flex flex-col items-center justify-center gap-2">
          <div className="font-display text-[46px] text-[#f7f4ea]">{countdown}</div>
          <div className="text-[15px] text-[rgba(247,244,234,.8)]">秒后截图，请切换到要识别的窗口</div>
        </div>
      )}
      {shot && (
        <ScreenPicker shot={shot}
          onCancel={cancelShot}
          onPick={onPickRect} />
      )}
    </div>
  );
}
