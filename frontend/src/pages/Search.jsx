import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { portalFetch, searchSimple } from "../lib/api.js";
import { FOLDER_COLORS } from "../lib/graph.js";

function Hi({ text, q }) {
  if (!q || !text) return <>{text}</>;
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = String(text).split(new RegExp("(" + esc + ")", "ig"));
  return (
    <>
      {parts.map((p, i) =>
        p.toLowerCase() === q.toLowerCase() ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>
      )}
    </>
  );
}

const MODES = [
  ["all", "全部"],
  ["content", "搜正文"],
  ["name", "搜文件名"],
  ["tag", "搜标签"],
];

export default function Search() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get("q") || "");
  const [mode, setMode] = useState(sp.get("mode") || "all");
  const [contentRes, setContentRes] = useState(null);
  const [contentErr, setContentErr] = useState(null);
  const [nameRes, setNameRes] = useState(null);
  const [nameErr, setNameErr] = useState(null);
  const [tagRes, setTagRes] = useState(null);
  const [tagErr, setTagErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(null);
  const [ran, setRan] = useState(false);
  const inputRef = useRef(null);
  const runSeqRef = useRef(0);

  async function run(query, m) {
    const term = (query != null ? query : q).trim();
    const cur = m || mode;
    if (!term) return;
    const seq = ++runSeqRef.current;
    const active = () => seq === runSeqRef.current;
    setLoading(true);
    setRan(true);
    setContentErr(null); setNameErr(null); setTagErr(null);
    const t0 = performance.now();
    const wantContent = cur === "all" || cur === "content";
    const wantName = cur === "all" || cur === "name";
    const wantTag = cur === "all" || cur === "tag";
    const jobs = [];
    if (wantContent) {
      setContentRes(null);
      jobs.push(
        searchSimple(term)
          .then((r) => { if (active()) setContentRes(Array.isArray(r) ? r : []); })
          .catch((e) => { if (active()) { setContentRes(null); setContentErr(e.message); } })
      );
    } else setContentRes(null);
    if (wantName) {
      setNameRes(null);
      jobs.push(
        portalFetch("/search/names?q=" + encodeURIComponent(term))
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error("接口失败 " + r.status))))
          .then((j) => { if (active()) setNameRes(j); })
          .catch((e) => { if (active()) { setNameRes(null); setNameErr(e.message); } })
      );
    } else setNameRes(null);
    if (wantTag) {
      setTagRes(null);
      const kw = term.replace(/^#/, "").toLowerCase();
      if (!kw) { setTagRes([]); }
      else jobs.push(
        portalFetch("cache/graph.json")
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error("索引读取失败 " + r.status))))
          .then((g) => {
            const hits = (g.nodes || []).filter((n) =>
              (n.tags || []).some((t) => String(t).toLowerCase().includes(kw)));
            if (active()) setTagRes(hits.slice(0, 100).map((n) => ({
              id: n.id, title: n.title, folder: n.folder,
              tags: (n.tags || []).filter((t) => String(t).toLowerCase().includes(kw)),
            })));
          })
          .catch((e) => { if (active()) { setTagRes(null); setTagErr(e.message); } })
      );
    } else setTagRes(null);
    await Promise.all(jobs);
    if (active()) {
      setElapsed(Math.round(performance.now() - t0));
      setLoading(false);
    }
  }

  useEffect(() => () => { runSeqRef.current++; }, []);

  useEffect(() => {
    const fromUrl = sp.get("q");
    if (fromUrl) {
      setQ(fromUrl);
      const m = sp.get("mode") || "all";
      setMode(m);
      run(fromUrl, m);
    } else inputRef.current && inputRef.current.focus();
  }, [sp]);

  const totalMatches = contentRes ? contentRes.reduce((n, r) => n + (r.matches ? r.matches.length : 0), 0) : 0;
  const nameNotes = (nameRes && nameRes.notes) || [];
  const nameBooks = (nameRes && nameRes.books) || [];

  return (
    <div className="px-7 py-6 max-w-[1000px] mx-auto">
      <div className="anim-fade-up">
        <h1 className="font-display text-[31px] font-black tracking-wide mb-4">检索</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const p = {};
            if (q.trim()) p.q = q.trim();
            if (mode !== "all") p.mode = mode;
            setSp(p);
            if (!q.trim()) run();
          }}
          className="flex gap-2.5"
        >
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="输入关键词，如：反馈机制 / #读书笔记 / 宋史"
            className="ink-input flex-1 px-4 py-3 text-[16.5px]"
          />
          <button type="submit" className="btn-ink px-6 text-[16.5px] font-medium">搜索</button>
        </form>
        <div className="mt-2.5 flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-[rgba(96,125,104,.32)] overflow-hidden text-[14px]">
            {MODES.map(([m, label]) => (
              <button key={m} type="button"
                onClick={() => { setMode(m); if (q.trim()) { const p = { q: q.trim() }; if (m !== "all") p.mode = m; setSp(p); } }}
                className={"px-3.5 py-[6px] " + (mode === m ? "bg-[var(--color-jade)] text-[#f4faf7]" : "text-[var(--color-paper-dim)] hover:bg-[rgba(47,107,90,.08)]")}>
                {label}
              </button>
            ))}
          </div>
          <span className="text-[13.5px] text-[var(--color-paper-faint)]">
            搜正文：经 Obsidian 实时全文检索；搜文件名：匹配笔记标题与馆藏书名；搜标签：匹配笔记标签，均无需 Obsidian 时可用后两者
          </span>
        </div>
      </div>

      <div className="mt-6 space-y-5">
        {loading && <div className="text-[15.5px] text-[var(--color-paper-dim)]">检索中…</div>}

        {!loading && ran && elapsed != null && (
          <div className="text-[14px] text-[var(--color-paper-faint)] anim-fade-up">{elapsed} 毫秒</div>
        )}

        {(mode === "all" || mode === "tag") && tagErr && (
          <div className="panel p-4 text-[14.5px] text-[var(--color-seal)]">标签检索失败：{tagErr}</div>
        )}
        {!loading && tagRes && tagRes.length > 0 && (
          <section className="anim-fade-up">
            <h2 className="font-display text-[18px] font-bold mb-2">标签匹配（{tagRes.length} 篇笔记）</h2>
            <div className="space-y-1.5">
              {tagRes.map((n) => (
                <button key={n.id} onClick={() => nav("/browse/" + n.id.split("/").map(encodeURIComponent).join("/"))}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg panel panel-hover text-left">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: FOLDER_COLORS[n.folder] || "#6d7a86" }} />
                  <span className="text-[15.5px] text-[var(--color-paper)] truncate">{n.title}</span>
                  <span className="flex items-center gap-1 flex-wrap">
                    {n.tags.slice(0, 4).map((t) => (
                      <span key={t} className="text-[12px] px-1.5 py-[1px] rounded-full bg-[rgba(217,164,65,.15)] text-[#8a6d1f] border border-[rgba(217,164,65,.35)]">
                        #<Hi text={t} q={q.trim().replace(/^#/, "")} />
                      </span>
                    ))}
                  </span>
                  <span className="ml-auto text-[13px] text-[var(--color-paper-faint)] font-mono truncate max-w-[36%]">{n.id}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        {!loading && ran && tagRes && tagRes.length === 0 && (mode === "all" || mode === "tag") && (
          <div className="text-[14.5px] text-[var(--color-paper-faint)]">没有标签匹配</div>
        )}

        {!loading && nameRes && (nameNotes.length > 0 || nameBooks.length > 0) && (
          <section className="anim-fade-up">
            <h2 className="font-display text-[18px] font-bold mb-2">文件名匹配（{nameNotes.length + nameBooks.length}）</h2>
            {nameNotes.length > 0 && (
              <div className="space-y-1.5 mb-3">
                {nameNotes.map((n) => (
                  <button key={n.id} onClick={() => nav("/browse/" + n.id.split("/").map(encodeURIComponent).join("/"))}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg panel panel-hover text-left">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: FOLDER_COLORS[n.folder] || "#6d7a86" }} />
                    <span className="text-[15.5px] text-[var(--color-paper)] truncate"><Hi text={n.title} q={q.trim()} /></span>
                    <span className="ml-auto text-[13px] text-[var(--color-paper-faint)] font-mono truncate max-w-[40%]">{n.id}</span>
                  </button>
                ))}
              </div>
            )}
            {nameBooks.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[13.5px] text-[var(--color-paper-faint)]">馆藏图书</div>
                {nameBooks.map((b) => (
                  <button key={b.path} onClick={() => nav("/library/" + b.path.split("/").map(encodeURIComponent).join("/"))}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg panel panel-hover text-left">
                    <span className="text-[12px] px-1.5 py-[1px] rounded border bg-[rgba(192,72,63,.12)] text-[var(--color-seal)] border-[rgba(192,72,63,.32)] shrink-0">{b.ext.replace(".", "").toUpperCase()}</span>
                    <span className="text-[15.5px] text-[var(--color-paper)] truncate"><Hi text={b.name} q={q.trim()} /></span>
                    <span className="ml-auto text-[13px] text-[var(--color-paper-faint)] shrink-0">{b.category}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
        {!loading && nameErr && (
          <div className="panel p-4 text-[14.5px] text-[var(--color-seal)]">文件名检索失败：{nameErr}</div>
        )}
        {!loading && ran && nameRes && !nameNotes.length && !nameBooks.length && (mode === "all" || mode === "name") && (
          <div className="text-[14.5px] text-[var(--color-paper-faint)]">没有文件名匹配</div>
        )}

        {(mode === "all" || mode === "content") && (
          <section>
            {contentErr && (
              <div className="panel p-6 text-center">
                <div className="text-[var(--color-seal)] text-[16px] mb-1">正文检索失败：{contentErr}</div>
                <div className="text-[14.5px] text-[var(--color-paper-faint)]">请确认 Obsidian 已启动、密钥已配置（设置页）；也可切到「搜文件名」</div>
              </div>
            )}
            {!loading && contentRes && (
              <>
                <div className="text-[14.5px] text-[var(--color-paper-faint)] mb-2 anim-fade-up">
                  正文匹配：{contentRes.length} 个文件 · {totalMatches} 处
                </div>
                {contentRes.length === 0 && (
                  <div className="panel p-8 text-center text-[var(--color-paper-dim)] text-[15.5px]">没有匹配的正文内容</div>
                )}
                <div className="space-y-3">
                  {contentRes.slice(0, 60).map((r) => {
                    const folder = (r.filename || "").split("/")[0];
                    return (
                      <div key={r.filename} className="panel p-4 panel-hover anim-fade-up">
                        <button
                          onClick={() => nav("/browse/" + (r.filename || "").split("/").map(encodeURIComponent).join("/"))}
                          className="flex items-center gap-2 w-full text-left group"
                        >
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: FOLDER_COLORS[folder] || "#6d7a86" }} />
                          <span className="text-[16.5px] font-medium text-[var(--color-paper)] group-hover:text-[#1d4f44] truncate">
                            {(r.filename || "").split("/").pop().replace(/\.md$/, "")}
                          </span>
                          <span className="text-[13.5px] text-[var(--color-paper-faint)] font-mono truncate">{r.filename}</span>
                          <span className="ml-auto text-[13.5px] text-[var(--color-para-project)] shrink-0">{(r.matches || []).length} 处</span>
                        </button>
                        <div className="mt-2 space-y-1.5">
                          {(r.matches || []).slice(0, 3).map((m, i) => (
                            <div key={i} className="text-[15px] leading-relaxed text-[var(--color-paper-dim)] pl-4 border-l-2 border-[rgba(96,125,104,.18)]">
                              <Hi text={m.context} q={q.trim()} />
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
