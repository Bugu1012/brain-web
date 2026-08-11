import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MemoryGraph } from "@supermemory/memory-graph";
import { fetchJson, portalFetch } from "../lib/api.js";
import { toGraphData, FOLDER_COLORS } from "../lib/graph.js";
import { invalidateGraphCache } from "../components/Markdown.jsx";

const INK_COLORS = {
  bg: "transparent",
  docFill: "#d6e4d8",
  docStroke: "#a3bda8",
  docInnerFill: "#dfeadf",
  memFill: "#dfeadf",
  memFillHover: "#cfe0d2",
  memStrokeDefault: "#4a7dc0",
  accent: "#b58422",
  textPrimary: "#203628",
  textSecondary: "#4a624f",
  textMuted: "#6d8672",
  edgeDerives: "#b58422",
  edgeUpdates: "#bd587e",
  edgeExtends: "#6e8a74",
  glowColor: "#b58422",
  iconColor: "#7d9484",
  popoverBg: "#dfeadf",
  popoverBorder: "#a3bda8",
  popoverTextPrimary: "#203628",
  popoverTextSecondary: "#4a624f",
  popoverTextMuted: "#6d8672",
  controlBg: "#dfeadf",
  controlBorder: "#a3bda8",
};

export default function Graph() {
  const nav = useNavigate();
  const [cache, setCache] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [maxDocs, setMaxDocs] = useState(300);
  const [rebuilding, setRebuilding] = useState(false);

  function loadCache() {
    fetchJson("cache/graph.json").then((c) => {
      setCache(c);
      setError(null);
      setSelected((prev) => prev || Object.keys(FOLDER_COLORS));
    }).catch((e) => setError(e.message));
  }

  useEffect(() => { loadCache(); }, []);

  async function rebuild() {
    setRebuilding(true);
    try {
      const r = await portalFetch("/rebuild", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await r.json();
      if (j.ok) { invalidateGraphCache(); loadCache(); }
      else setError(j.error || "重建失败");
    } catch (e) { setError(e.message); }
    finally { setRebuilding(false); }
  }

  const folderCounts = useMemo(() => {
    const counts = {};
    for (const n of (cache && cache.nodes) || []) counts[n.folder] = (counts[n.folder] || 0) + 1;
    return counts;
  }, [cache]);

  const graph = useMemo(() => {
    if (!cache || !selected) return null;
    return toGraphData(cache, { folders: selected, maxDocs });
  }, [cache, selected, maxDocs]);

  function toggleFolder(f) {
    setSelected((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));
  }

  return (
    <div className="px-7 py-6 h-full flex gap-4 min-h-0">
      <div className="w-[250px] shrink-0 panel p-4 flex flex-col anim-fade-up">
        <h2 className="font-display text-[17.5px] font-bold mb-1">知识图谱</h2>
        <div className="text-[14px] text-[var(--color-paper-faint)] mb-2">
          {graph ? "显示 " + graph.shown + " / 共 " + graph.total + " 篇" : "加载中…"}
        </div>
        <button onClick={rebuild} disabled={rebuilding}
          className="btn-ghost px-3 py-[6px] text-[13.5px] mb-4 disabled:opacity-50 w-full">
          {rebuilding ? "重建中（约半分钟）…" : "更新图谱（重建索引）"}
        </button>

        <div className="text-[13.5px] text-[var(--color-paper-faint)] tracking-wider mb-2">文件夹过滤</div>
        <div className="space-y-1">
          {Object.keys(FOLDER_COLORS).map((f) => (
            <label key={f} className="flex items-center gap-2.5 px-2 py-[6px] rounded-md hover:bg-[rgba(96,125,104,.07)] cursor-pointer select-none">
              <input type="checkbox" checked={selected ? selected.includes(f) : false} onChange={() => toggleFolder(f)}
                className="accent-[var(--color-para-project)]" />
              <span className="w-2 h-2 rounded-full" style={{ background: FOLDER_COLORS[f] }} />
              <span className="text-[15px] text-[var(--color-paper-dim)] flex-1">{f}</span>
              <span className="text-[13.5px] text-[var(--color-paper-faint)]">{folderCounts[f] || 0}</span>
            </label>
          ))}
        </div>

        <div className="mt-5">
          <div className="flex justify-between text-[13.5px] text-[var(--color-paper-faint)] mb-1.5">
            <span>节点上限</span><span>{maxDocs} 篇</span>
          </div>
          <input type="range" min="100" max="800" step="50" value={maxDocs}
            onChange={(e) => setMaxDocs(parseInt(e.target.value, 10))}
            className="w-full accent-[var(--color-para-project)]" />
        </div>

        <div className="mt-auto pt-4 text-[13.5px] text-[var(--color-paper-faint)] leading-relaxed border-t border-[rgba(96,125,104,.1)]">
          连线表示双链引用。滚轮缩放，拖拽平移，点击节点查看详情，「Open」跳转原文。
        </div>
      </div>

      <div className="flex-1 panel overflow-hidden anim-fade-up relative">
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
            <div className="text-[var(--color-seal)] text-[16px]">图谱缓存加载失败：{error}</div>
            <div className="text-[14.5px] text-[var(--color-paper-faint)]">请先运行 scripts\build_index.py 生成缓存</div>
          </div>
        )}
        {graph && (
          <MemoryGraph
            documents={graph.documents}
            colors={INK_COLORS}
            maxNodes={1200}
            totalCount={graph.shown}
            variant="console"
            onOpenDocument={(docId) => nav("/browse/" + String(docId).split("/").map(encodeURIComponent).join("/"))}
          >
            <div className="text-[var(--color-paper-faint)] text-[15.5px]">没有可显示的节点</div>
          </MemoryGraph>
        )}
      </div>
    </div>
  );
}
