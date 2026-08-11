import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { vaultListMd, readNote, fetchJson } from "../lib/api.js";
import { buildTree } from "../lib/vault.js";
import { FOLDER_COLORS } from "../lib/graph.js";
import Markdown from "../components/Markdown.jsx";
import { toast } from "../components/Toast.jsx";

let filesCache = null;

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

function TreeNode({ node, depth, expanded, toggle, sel, pick, filter }) {
  const dirs = Object.values(node.dirs).sort((a, b) => a.name.localeCompare(b.name, "zh"));
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name, "zh"));
  return (
    <div>
      {dirs.map((d) => {
        const open = expanded.has(d.path);
        return (
          <div key={d.path}>
            <button onClick={() => toggle(d.path)}
              className="w-full flex items-center gap-1.5 px-2 py-[5px] rounded-md hover:bg-[rgba(96,125,104,.08)] text-left"
              style={{ paddingLeft: 8 + depth * 14 }}>
              <span className={"text-[10px] text-[var(--color-paper-faint)] transition-transform " + (open ? "rotate-90" : "")}>▶</span>
              {depth === 0 && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: FOLDER_COLORS[d.name] || "#6d7a86" }} />}
              <span className="text-[15px] text-[var(--color-paper-dim)] truncate">{d.name}</span>
            </button>
            {open && <TreeNode node={d} depth={depth + 1} expanded={expanded} toggle={toggle} sel={sel} pick={pick} filter={filter} />}
          </div>
        );
      })}
      {files.map((f) => {
        if (filter && !f.name.toLowerCase().includes(filter)) return null;
        const active = sel === f.path;
        return (
          <button key={f.path} onClick={() => pick(f.path)}
            className={"w-full flex items-center gap-1.5 px-2 py-[4.5px] rounded-md text-left " +
              (active ? "bg-[rgba(217,164,65,.14)] text-[#8a6d1f]" : "hover:bg-[rgba(96,125,104,.08)] text-[var(--color-paper-dim)]")}
            style={{ paddingLeft: 8 + depth * 14 + 14 }}>
            <span className="text-[11px] opacity-60">◇</span>
            <span className="text-[15px] truncate">{f.name.replace(/\.md$/, "")}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function Browse() {
  const params = useParams();
  const nav = useNavigate();
  const raw = params["*"] || "";
  const sel = raw ? safeDecode(raw) : "";
  const [files, setFiles] = useState(filesCache);
  const [source, setSource] = useState(filesCache ? "cache" : "none");
  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [expanded, setExpanded] = useState(() => new Set(["01-收件箱", "02-项目", "03-资源", "04-领域", "05-日记"]));
  const [filter, setFilter] = useState("");
  const [note, setNote] = useState(null);
  const [loading, setLoading] = useState(false);

  // 即时树：来自每小时索引缓存；实时刷新按钮走并行遍历
  useEffect(() => {
    if (filesCache) return;
    fetchJson("cache/graph.json")
      .then((g) => {
        const list = (g.nodes || []).map((n) => n.id);
        filesCache = list;
        setFiles(list);
        setSource("index");
      })
      .catch(() => setSource("error"));
  }, []);

  async function liveRefresh() {
    setRefreshing(true);
    setProgress(0);
    try {
      const list = await vaultListMd((n) => setProgress(n));
      filesCache = list;
      setFiles(list);
      setSource("live");
      toast("实时刷新完成：" + list.length + " 篇", "ok");
    } catch (e) {
      toast("实时刷新失败：" + e.message, "err");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (!sel || !sel.endsWith(".md")) { setNote(null); return; }
    let on = true;
    setLoading(true);
    readNote(sel).then((r) => { if (on) { setNote(r); setLoading(false); } })
      .catch((e) => { if (on) { setNote(null); setLoading(false); toast("读取失败：" + e.message, "err"); } });
    return () => { on = false; };
  }, [sel]);

  const tree = useMemo(() => (files ? buildTree(files) : null), [files]);

  function toggle(path) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }
  function pick(path) {
    nav("/browse/" + path.split("/").map(encodeURIComponent).join("/"));
    setExpanded((prev) => {
      const next = new Set(prev);
      const parts = path.split("/");
      for (let i = 1; i < parts.length; i++) next.add(parts.slice(0, i).join("/"));
      return next;
    });
  }

  const sourceLabel = { index: "索引树（每小时更新）", live: "实时遍历", cache: "本轮缓存", error: "索引不可用", none: "加载中…" }[source];

  return (
    <div className="px-7 py-6 h-full flex gap-4 min-h-0">
      <div className="w-[290px] shrink-0 panel flex flex-col min-h-0 anim-fade-up">
        <div className="p-3 border-b border-[rgba(96,125,104,.12)] space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-[17.5px] font-bold">文件库</h2>
            <span className="text-[13.5px] text-[var(--color-paper-faint)]">{files ? files.length + " 篇" : "…"}</span>
            <button onClick={liveRefresh} disabled={refreshing}
              className="ml-auto btn-ghost px-2 py-[3px] text-[13.5px] disabled:opacity-50">
              {refreshing ? "遍历中 " + progress : "实时刷新"}
            </button>
          </div>
          <div className="text-[13px] text-[var(--color-paper-faint)]">{sourceLabel} · 新建笔记可先经「编辑」页打开</div>
          <input value={filter} onChange={(e) => setFilter(e.target.value.toLowerCase())}
            placeholder="过滤文件名…" className="ink-input w-full px-2.5 py-[6px] text-[14.5px]" />
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {source === "error" && <div className="text-[14.5px] text-[var(--color-seal)] px-2 py-3">索引缓存不可用，点「实时刷新」直接遍历</div>}
          {tree && <TreeNode node={tree} depth={0} expanded={expanded} toggle={toggle} sel={sel} pick={pick} filter={filter} />}
        </div>
      </div>

      <div className="flex-1 panel min-h-0 flex flex-col anim-fade-up">
        {!sel && (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-2">
            <div className="font-display text-[20px] text-[var(--color-paper-dim)]">从左侧选择一篇笔记</div>
            <div className="text-[15px] text-[var(--color-paper-faint)]">支持 Markdown 渲染与双链跳转</div>
          </div>
        )}
        {sel && (
          <>
            <div className="flex items-center gap-3 px-5 py-3 border-b border-[rgba(96,125,104,.12)]">
              <div className="text-[15px] text-[var(--color-paper-dim)] truncate font-mono">{sel}</div>
              <div className="ml-auto flex gap-2 shrink-0">
                <button onClick={() => { navigator.clipboard.writeText(sel); toast("路径已复制", "ok"); }}
                  className="btn-ghost px-3 py-[5px] text-[14.5px]">复制路径</button>
                <button onClick={() => nav("/edit/" + sel.split("/").map(encodeURIComponent).join("/"))}
                  className="btn-ink px-3.5 py-[5px] text-[14.5px]">编辑</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-7 py-5">
              {loading && <div className="text-[15px] text-[var(--color-paper-faint)]">加载中…</div>}
              {!loading && note && note.exists && <Markdown text={note.content} />}
              {!loading && note && !note.exists && (
                <div className="text-center py-10">
                  <div className="text-[var(--color-paper-faint)] text-[15.5px] mb-3">文件不存在（可能尚未创建或已被移动）</div>
                  <button onClick={() => nav("/edit/" + sel.split("/").map(encodeURIComponent).join("/"))}
                    className="btn-ink px-4 py-2 text-[15.5px]">以此路径新建</button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}