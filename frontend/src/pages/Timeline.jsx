import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchTimeline, imgUrl } from "../lib/moments.js";
import { todayStr } from "../lib/vault.js";
import MomentComposer from "../components/MomentComposer.jsx";

const KIND = {
  moment: { label: "说说", cls: "bg-[rgba(47,107,90,.12)] text-[var(--color-jade-deep)] border border-[rgba(47,107,90,.3)]" },
  photo: { label: "照片", cls: "bg-[rgba(96,125,104,.14)] text-[var(--color-paper-dim)] border border-[rgba(96,125,104,.3)]" },
  diary: { label: "日志", cls: "bg-[rgba(192,72,63,.1)] text-[var(--color-seal)] border border-[rgba(192,72,63,.3)]" },
  doc: { label: "文档", cls: "bg-[rgba(70,98,91,.1)] text-[var(--color-para-area)] border border-[rgba(70,98,91,.28)]" },
};

function shiftMonth(m, d) {
  const [y, mo] = m.split("-").map(Number);
  const t = y * 12 + (mo - 1) + d;
  return Math.floor(t / 12) + "-" + String((t % 12) + 1).padStart(2, "0");
}

const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");

export default function Timeline() {
  const nav = useNavigate();
  const [month, setMonth] = useState(() => todayStr().slice(0, 7));
  const [items, setItems] = useState(null);
  const [err, setErr] = useState("");
  const [zoom, setZoom] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let on = true;
    setItems(null);
    setErr("");
    fetchTimeline(month)
      .then((it) => { if (on) setItems(it); })
      .catch((e) => { if (on) { setErr(e.message); setItems([]); } });
    return () => { on = false; };
  }, [month, reload]);

  const groups = useMemo(() => {
    const g = [];
    for (const it of items || []) {
      const last = g[g.length - 1];
      if (last && last.date === it.date) last.items.push(it);
      else g.push({ date: it.date, items: [it] });
    }
    return g;
  }, [items]);

  return (
    <div className="max-w-[860px] mx-auto px-7 py-6">
      <div className="flex items-center gap-3 mb-5">
        <h1 className="font-display text-[22px] font-bold text-[var(--color-paper)]">时间轴</h1>
        <span className="text-[13px] text-[var(--color-paper-faint)]">说说 · 照片 · 日志 · 文档</span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setMonth((m) => shiftMonth(m, -1))} className="btn-ghost px-3 py-[6px] text-[15px]">‹</button>
          <span className="text-[15px] font-medium text-[var(--color-paper-dim)] w-[86px] text-center">{month}</span>
          <button onClick={() => setMonth((m) => shiftMonth(m, 1))} className="btn-ghost px-3 py-[6px] text-[15px]">›</button>
          {month !== todayStr().slice(0, 7) && (
            <button onClick={() => setMonth(todayStr().slice(0, 7))} className="text-[13px] text-[var(--color-jade-deep)] hover:underline">回到本月</button>
          )}
        </div>
      </div>

      <div className="panel p-4 mb-6">
        <div className="text-[13.5px] font-medium text-[var(--color-paper-dim)] mb-2">发一条说说</div>
        <MomentComposer onDone={() => setReload((r) => r + 1)} />
      </div>

      {err && <div className="text-[13.5px] text-[var(--color-seal)] mb-4">{err}</div>}
      {items === null && <div className="text-[14px] text-[var(--color-paper-faint)] py-10 text-center">加载中…</div>}
      {items !== null && groups.length === 0 && (
        <div className="text-[14px] text-[var(--color-paper-faint)] py-10 text-center">这个月还没有记录，发条说说或写篇日志吧。</div>
      )}

      {groups.map((g) => (
        <div key={g.date} className="mb-7">
          <div className="flex items-center gap-3 mb-3">
            <span className="font-display text-[16px] font-bold text-[var(--color-jade-deep)]">{g.date}</span>
            <span className="flex-1 h-px bg-[rgba(96,125,104,.18)]" />
          </div>
          <div className="space-y-3">
            {g.items.map((it, i) => {
              const k = KIND[it.kind] || KIND.moment;
              return (
                <div key={i} className="panel p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={"text-[11.5px] px-2 py-[1px] rounded-full " + k.cls}>{k.label}</span>
                    {it.time && it.time !== "00:00" && <span className="text-[12px] text-[var(--color-paper-faint)]">{it.time}</span>}
                    {it.kind === "doc" && it.folder && <span className="text-[12px] text-[var(--color-paper-faint)]">{it.folder}</span>}
                  </div>
                  {it.kind === "diary" ? (
                    <div className="flex items-start gap-3">
                      <p className="flex-1 text-[14.5px] text-[var(--color-paper-dim)] leading-relaxed">{it.excerpt || "（空日志）"}</p>
                      <button onClick={() => nav("/diary/" + it.date)} className="btn-ghost px-3 py-[5px] text-[13px] shrink-0">打开日志</button>
                    </div>
                  ) : it.kind === "doc" ? (
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-[15px] font-medium text-[var(--color-paper)] truncate">{it.title}</div>
                        {it.summary && <p className="text-[13px] text-[var(--color-paper-faint)] mt-1 line-clamp-2">{it.summary}</p>}
                      </div>
                      <button onClick={() => nav("/edit/" + encPath(it.path))} className="btn-ghost px-3 py-[5px] text-[13px] shrink-0">打开</button>
                    </div>
                  ) : (
                    <div>
                      {it.moment.text && <p className="text-[15px] text-[var(--color-paper)] leading-relaxed whitespace-pre-wrap">{it.moment.text}</p>}
                      {it.moment.photos.length > 0 && (
                        <div className={"grid gap-2 mt-2 " + (it.moment.photos.length === 1 ? "grid-cols-1 max-w-[320px]" : "grid-cols-3")}>
                          {it.moment.photos.map((p) => (
                            <img key={p} src={imgUrl(p)} alt="说说配图" loading="lazy"
                              onClick={() => setZoom(imgUrl(p))}
                              className="w-full aspect-square object-cover rounded-lg border border-[rgba(96,125,104,.2)] cursor-zoom-in" />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {zoom && (
        <div className="fixed inset-0 z-[130] bg-black/75 flex items-center justify-center p-8" onClick={() => setZoom(null)}>
          <img src={zoom} alt="大图" className="max-w-full max-h-full rounded-lg" />
        </div>
      )}
    </div>
  );
}