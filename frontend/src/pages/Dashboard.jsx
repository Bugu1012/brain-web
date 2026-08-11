import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchJson, ping, portalFetch, readNote } from "../lib/api.js";
import { parseKanban } from "../lib/kanban.js";
import { relTime, recentDateRange } from "../lib/vault.js";
import { FOLDER_COLORS } from "../lib/graph.js";
import { toast } from "../components/Toast.jsx";
import { invalidateGraphCache } from "../components/Markdown.jsx";

function usePoll(fn, ms) {
  useEffect(() => {
    fn();
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  }, []);
}

function DayHeatmap({ days, onOpen }) {
  const set = new Set(days || []);
  return (
    <div className="grid grid-cols-7 gap-[5px] min-w-[350px]">
      {recentDateRange(35).map((iso) => {
        const has = set.has(iso);
        return (
          <button
            key={iso}
            type="button"
            onClick={() => onOpen(iso)}
            title={iso + (has ? " · 有日志 · 点击查看" : " · 无记录 · 点击开始")}
            className={"h-9 rounded-md border text-[12px] font-medium transition-colors " +
              (has
                ? "border-[rgba(189,88,126,.42)] bg-[var(--color-diary)] text-white shadow-[0_0_7px_rgba(189,88,126,.35)] hover:brightness-105"
                : "border-[rgba(96,125,104,.15)] bg-[rgba(96,125,104,.12)] text-[var(--color-paper-faint)] hover:bg-[rgba(96,125,104,.25)]")}
          >
            {iso.slice(8)}
          </button>
        );
      })}
    </div>
  );
}

function WeekHeatmap({ days, onOpen }) {
  const set = new Set(days || []);
  const today = new Date();
  const cells = [];
  const start = new Date(today);
  start.setDate(start.getDate() - 181);
  while (start.getDay() !== 1) start.setDate(start.getDate() - 1);
  const d = new Date(start);
  while (d <= today) {
    const iso = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    cells.push({ iso, has: set.has(iso), future: d > today });
    d.setDate(d.getDate() + 1);
  }
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return (
    <div className="flex gap-[4px]">
      {weeks.map((w, wi) => (
        <div key={wi} className="flex-1 min-w-[11px] flex flex-col gap-[4px]">
          {w.map((c) => (
            <div
              key={c.iso}
              title={c.future ? c.iso : c.iso + (c.has ? " · 有日志 · 点击查看" : " · 点击补写日志")}
              onClick={!c.future && onOpen ? () => onOpen(c.iso) : undefined}
              className={"w-full aspect-square rounded-[4px] " +
                (c.future ? "bg-transparent" : c.has
                  ? "bg-[var(--color-diary)] shadow-[0_0_6px_rgba(189,88,126,.5)] cursor-pointer hover:ring-2 hover:ring-[rgba(189,88,126,.55)] transition-shadow"
                  : "bg-[rgba(96,125,104,.18)] cursor-pointer hover:bg-[rgba(96,125,104,.35)] transition-colors")}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const nav = useNavigate();
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [genAt, setGenAt] = useState(null);
  const [todoOpen, setTodoOpen] = useState(null);
  const [alive, setAlive] = useState(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [heatMode, setHeatMode] = useState("day");

  usePoll(async () => {
    try { setStats(await fetchJson("cache/stats.json")); } catch { /* 缓存未生成 */ }
    try {
      const g = await fetchJson("cache/graph.json");
      setGenAt(g.generated);
      setRecent([...(g.nodes || [])].sort((a, b) => (b.mtime || 0) - (a.mtime || 0)).slice(0, 9));
    } catch { /* 忽略 */ }
  }, 60000);

  usePoll(async () => {
    setAlive((await ping()).authed);
    try {
      const r = await readNote("02-项目/待办看板.md");
      if (r.exists) {
        const b = parseKanban(r.content);
        setTodoOpen(b.sections.reduce((n, s) => n + s.cards.filter((c) => !c.done).length, 0));
      }
    } catch { /* 忽略 */ }
  }, 25000);

  const maxFolder = stats ? Math.max(1, ...Object.values(stats.per_folder || {})) : 1;

  const last7 = (() => {
    const days = stats ? stats.diary_days || [] : [];
    const cut = new Date();
    cut.setDate(cut.getDate() - 6);
    const iso = cut.getFullYear() + "-" + String(cut.getMonth() + 1).padStart(2, "0") + "-" + String(cut.getDate()).padStart(2, "0");
    return days.filter((d) => d >= iso).length;
  })();

  return (
    <div className="px-7 py-6 max-w-[1380px] mx-auto">
      <div className="flex items-end gap-4 mb-5 anim-fade-up">
        <h1 className="font-display text-[31px] font-black tracking-wide">总览</h1>
        <div className="text-[15px] text-[var(--color-paper-faint)] mb-1">
          索引更新：{genAt ? relTime(genAt) : "尚未构建"}
        </div>
        <button disabled={rebuilding} onClick={async () => {
          setRebuilding(true);
          try {
            const r = await portalFetch("/rebuild", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
            const j = await r.json().catch(() => ({}));
            if (j.ok) {
              invalidateGraphCache();
              try {
                const g = await fetchJson("cache/graph.json");
                setGenAt(g.generated);
                setRecent([...(g.nodes || [])].sort((a, b) => (b.mtime || 0) - (a.mtime || 0)).slice(0, 9));
              } catch { /* 忽略 */ }
              try { setStats(await fetchJson("cache/stats.json")); } catch { /* 忽略 */ }
              toast("索引已更新", "ok");
            } else {
              toast("索引更新失败：" + (j.error || r.status), "err");
            }
          } catch (e) { toast("索引更新失败：" + e.message, "err"); }
          finally { setRebuilding(false); }
        }} className="btn-ghost px-3 py-[6px] text-[13.5px] mb-0.5 disabled:opacity-50">
          {rebuilding ? "重建中（约半分钟）…" : "更新索引"}
        </button>
        {alive === false && (
          <button onClick={() => nav("/settings")}
            className="mb-0.5 ml-auto text-[14.5px] px-3 py-1.5 rounded-lg border border-[rgba(192,72,63,.5)] text-[#a63d34] hover:bg-[rgba(192,72,63,.12)]">
            Obsidian 未连接 · 去设置
          </button>
        )}
      </div>

      {!stats && (
        <div className="panel p-8 text-center text-[var(--color-paper-dim)] anim-fade-up">
          <div className="font-display text-[20px] mb-2">索引缓存尚未生成</div>
          <div className="text-[15.5px] text-[var(--color-paper-faint)]">
            运行 <code className="text-[#8a6d1f]">python scripts/build_index.py</code> 后刷新本页
          </div>
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-12 gap-4 stagger">
          <section className="col-span-12 lg:col-span-8 panel p-5">
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <h2 className="font-display text-[19px] font-bold">日志热力</h2>
              <span className="text-[14px] px-2 py-[3px] rounded-full bg-[rgba(189,88,126,.14)] text-[var(--color-diary)] border border-[rgba(189,88,126,.3)]">
                连续 {stats.diary_streak || 0} 天
              </span>
              <div className="ml-auto flex rounded-lg overflow-hidden border border-[rgba(96,125,104,.25)]" aria-label="日志热力视图">
                {[["day", "按日"], ["week", "按周"]].map(([mode, label]) => (
                  <button key={mode} type="button" onClick={() => setHeatMode(mode)} aria-pressed={heatMode === mode}
                    className={"px-3 py-[5px] text-[13.5px] " + (heatMode === mode ? "bg-[rgba(217,164,65,.18)] text-[#8a6d1f]" : "text-[var(--color-paper-dim)] hover:text-[var(--color-paper)]")}>
                    {label}
                  </button>
                ))}
              </div>
              <span className="text-[14px] text-[var(--color-paper-faint)]">{heatMode === "day" ? "近 35 日" : "近 26 周"}</span>
            </div>
            <div className="flex items-stretch gap-5 max-[900px]:flex-col">
              <div className="flex-1 min-w-0 overflow-x-auto pb-1">{heatMode === "day"
                ? <DayHeatmap days={stats.diary_days} onOpen={(iso) => nav("/diary/" + iso)} />
                : <WeekHeatmap days={stats.diary_days} onOpen={(iso) => nav("/diary/" + iso)} />}
              </div>
              <div className="w-[164px] shrink-0 border-l border-[rgba(70,98,91,.14)] pl-5 flex flex-col justify-center gap-2.5">
                <div className="flex items-center gap-2 text-[13.5px] text-[var(--color-paper-dim)]"><span className="w-3 h-3 rounded-[3px] bg-[var(--color-diary)] shrink-0" /> 有日志</div>
                <div className="flex items-center gap-2 text-[13.5px] text-[var(--color-paper-faint)]"><span className="w-3 h-3 rounded-[3px] bg-[rgba(96,125,104,.18)] shrink-0" /> 无记录</div>
                <div className="h-px bg-[rgba(70,98,91,.12)] my-1.5" />
                <div>
                  <div className="text-[13px] text-[var(--color-paper-faint)]">累计日志</div>
                  <div className="font-display text-[22px] font-black leading-tight">{(stats.diary_days || []).length}<span className="text-[13px] font-normal text-[var(--color-paper-faint)]"> 篇</span></div>
                </div>
                <div>
                  <div className="text-[13px] text-[var(--color-paper-faint)]">近 7 天</div>
                  <div className="font-display text-[22px] font-black leading-tight text-[var(--color-jade)]">{last7}<span className="text-[13px] font-normal text-[var(--color-paper-faint)]"> 篇</span></div>
                </div>
              </div>
            </div>
          </section>

          <section className="col-span-12 lg:col-span-4 panel p-5 flex flex-col">
            <div className="text-[14.5px] text-[var(--color-paper-faint)] tracking-wider">本周新增</div>
            <div className="font-display text-[48px] font-black leading-none mt-1 text-[var(--color-para-project)]">{stats.week_new || 0}</div>
            <div className="mt-1 text-[14.5px] text-[var(--color-paper-dim)]">总笔记 {stats.total_notes || 0} 篇</div>
            <div className="mt-4 space-y-[7px]">
              {Object.entries(stats.per_folder || {}).map(([folder, n]) => (
                <div key={folder} className="flex items-center gap-2 text-[14px]">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: FOLDER_COLORS[folder] || "#6d7a86" }} />
                  <span className="w-[76px] text-[var(--color-paper-dim)] shrink-0">{folder}</span>
                  <div className="flex-1 h-[5px] rounded-full bg-[rgba(96,125,104,.12)] overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: (n / maxFolder * 100) + "%", background: FOLDER_COLORS[folder] || "#6d7a86" }} />
                  </div>
                  <span className="w-9 text-right text-[var(--color-paper-faint)]">{n}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="col-span-7 panel p-5">
            <div className="flex items-center mb-3">
              <h2 className="font-display text-[19px] font-bold">最近笔记</h2>
              <button onClick={() => nav("/browse")} className="ml-auto text-[14.5px] text-[var(--color-para-resource)] hover:underline">浏览全部 →</button>
            </div>
            <div className="space-y-[2px]">
              {recent.map((n) => (
                <button key={n.id} onClick={() => nav("/browse/" + n.id.split("/").map(encodeURIComponent).join("/"))}
                  className="w-full flex items-center gap-3 px-2.5 py-[7px] rounded-lg hover:bg-[rgba(96,125,104,.08)] text-left group">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: FOLDER_COLORS[n.folder] || "#6d7a86" }} />
                  <span className="text-[16px] text-[var(--color-paper)] truncate group-hover:text-[#1d4f44]">{n.title}</span>
                  <span className="text-[13.5px] text-[var(--color-paper-faint)] truncate hidden xl:inline">{n.id}</span>
                  <span className="ml-auto text-[13.5px] text-[var(--color-paper-faint)] shrink-0">{relTime(new Date(n.mtime * 1000).toISOString())}</span>
                </button>
              ))}
              {!recent.length && <div className="text-[15px] text-[var(--color-paper-faint)] px-2 py-3">暂无数据</div>}
            </div>
          </section>

          <section className="col-span-5 panel p-5">
            <h2 className="font-display text-[19px] font-bold mb-3">标签</h2>
            <div className="flex flex-wrap gap-2">
              {(stats.top_tags || []).slice(0, 22).map(([tag, n]) => (
                <button key={tag} onClick={() => nav("/search?q=" + encodeURIComponent(tag) + "&mode=tag")}
                  className="text-[14.5px] px-2.5 py-[5px] rounded-full border border-[rgba(96,125,104,.22)] text-[var(--color-paper-dim)] hover:border-[rgba(217,164,65,.5)] hover:text-[#8a6d1f] transition-colors">
                  #{tag} <span className="opacity-60">{n}</span>
                </button>
              ))}
              {!(stats.top_tags || []).length && <div className="text-[15px] text-[var(--color-paper-faint)]">暂无标签</div>}
            </div>
          </section>

          <section className="col-span-4 panel p-5 panel-hover cursor-pointer" onClick={() => nav("/kanban")}>
            <div className="text-[14.5px] text-[var(--color-paper-faint)] tracking-wider">未完成待办</div>
            <div className="font-display text-[44px] font-black leading-none mt-1 text-[var(--color-para-area)]">
              {todoOpen == null ? "—" : todoOpen}
            </div>
            <div className="mt-2 text-[14.5px] text-[var(--color-paper-dim)]">待办 · 点击前往</div>
          </section>

          <section className="col-span-5 panel p-5 panel-hover cursor-pointer" onClick={() => nav("/settings")}>
            <h2 className="font-display text-[19px] font-bold mb-2.5">安装支持</h2>
            <div className="space-y-[7px] text-[15px]">
              <div className="flex gap-2">
                <span className="text-[var(--color-paper-faint)] w-[86px] shrink-0">Obsidian</span>
                <span className="text-[var(--color-paper-dim)]">安装 Local REST API，粘贴 API Key</span>
              </div>
              <div className="flex gap-2">
                <span className="text-[var(--color-paper-faint)] w-[86px] shrink-0">OCR</span>
                <span className="text-[var(--color-paper-dim)]">屏幕框选需 Pillow；粘贴图片可直接识别</span>
              </div>
              <div className="text-[13.5px] text-[var(--color-para-resource)]">点击进入设置页查看步骤</div>
            </div>
          </section>

          <section className="col-span-3 panel p-5">
            <h2 className="font-display text-[19px] font-bold mb-2.5">连接</h2>
            <div className="flex items-center gap-2 text-[15.5px]">
              <span className={"w-2 h-2 rounded-full " + (alive ? "bg-[var(--color-para-area)] pulse-dot" : "bg-[var(--color-seal)]")} />
              <span className="text-[var(--color-paper-dim)]">{alive ? "Obsidian 正常" : alive === false ? "未连接" : "检测中"}</span>
            </div>
            <div className="mt-2 text-[14px] text-[var(--color-paper-faint)] leading-relaxed">127.0.0.1:27123<br />读写经本地接口</div>
          </section>
        </div>
      )}
    </div>
  );
}
