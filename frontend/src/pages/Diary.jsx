import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchJson, readNote, rebuildPortalIndex, safeDeleteNote, safeWrite } from "../lib/api.js";
import { appendToSection, fillTemplate, isValidIsoDate, todayStr } from "../lib/vault.js";
import Markdown from "../components/Markdown.jsx";
import { toast } from "../components/Toast.jsx";

const TEMPLATE_PATH = "_templates/每日日记模板.md";
const FALLBACK_TPL = "---\ntags: [diary]\n---\n\n# {{date:YYYY-MM-DD}} {{title}}\n\n## 今日目标\n\n- [ ] \n\n## 工作事项\n\n- \n\n## 知识捕获\n\n- \n\n## 情绪\n\n> \n\n## 今日总结\n\n> \n";

function Calendar({ month, selected, diaryDays, onPick, onMonth }) {
  const diarySet = new Set(diaryDays || []);
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const today = todayStr();
  return (
    <div>
      <div className="flex items-center mb-3">
        <button onClick={() => onMonth(-1)} className="btn-ghost w-7 h-7 text-[15.5px]">‹</button>
        <div className="flex-1 text-center font-display text-[17.5px] font-bold">
          {month.getFullYear()} 年 {month.getMonth() + 1} 月
        </div>
        <button onClick={() => onMonth(1)} className="btn-ghost w-7 h-7 text-[15.5px]">›</button>
      </div>
      <div className="grid grid-cols-7 gap-[3px] text-center text-[13px] text-[var(--color-paper-faint)] mb-1">
        {["一", "二", "三", "四", "五", "六", "日"].map((w) => <div key={w}>{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-[3px]">
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const iso = month.getFullYear() + "-" + String(month.getMonth() + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
          const isSel = iso === selected;
          const isToday = iso === today;
          const has = diarySet.has(iso);
          return (
            <button key={i} onClick={() => onPick(iso)}
              className={"relative h-8 rounded-md text-[14.5px] transition-colors " +
                (isSel ? "bg-[rgba(217,164,65,.2)] text-[#8a6d1f] border border-[rgba(217,164,65,.5)]"
                  : "border border-transparent hover:bg-[rgba(96,125,104,.1)] " + (isToday ? "text-[var(--color-seal)] font-bold" : "text-[var(--color-paper-dim)]"))}>
              {d}
              {has && <span className="absolute bottom-[3px] left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[var(--color-diary)]" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Diary() {
  const params = useParams();
  const nav = useNavigate();
  const date = (() => {
    const d = params.date;
    if (!d) return todayStr();
    if (!isValidIsoDate(d)) return todayStr();
    return d;
  })();
  const path = "05-日记/" + date + ".md";

  const [content, setContent] = useState("");
  const baseRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [exists, setExists] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState("read");
  const [diaryDays, setDiaryDays] = useState([]);
  const [month, setMonth] = useState(() => new Date(date + "T00:00:00"));
  const [quick, setQuick] = useState({ goal: "", work: "", capture: "", mood: "", summary: "" });
  const [drafting, setDrafting] = useState(false);
  const indexRefreshingRef = useRef(false);

  const refreshIndexInBackground = useCallback(async () => {
    if (indexRefreshingRef.current) return;
    indexRefreshingRef.current = true;
    try {
      await rebuildPortalIndex();
    } catch (e) {
      toast("日志已更新；门户索引将在下一次自动刷新后同步：" + e.message, "info");
    } finally {
      indexRefreshingRef.current = false;
    }
  }, []);

  useEffect(() => {
    fetchJson("cache/stats.json").then((s) => setDiaryDays(s.diary_days || [])).catch(() => {});
  }, []);

  useEffect(() => {
    let on = true;
    setLoading(true);
    readNote(path).then((r) => {
      if (!on) return;
      setExists(r.exists);
      setContent(r.content);
      baseRef.current = r.exists ? r.content : null;
      setDirty(false);
      setDrafting(false);
      setView(r.exists ? "read" : "edit");
      setLoading(false);
    }).catch(() => { if (on) { setLoading(false); toast("读取日志失败：请检查 Obsidian 连接", "err"); } });
    return () => { on = false; };
  }, [path]);

  useEffect(() => {
    setMonth(new Date(date + "T00:00:00"));
  }, [date]);

  const save = useCallback(async (text) => {
    if (loading) return false;
    const body = text != null ? text : content;
    if (!body.trim()) { toast("空白日志不会保存；写下第一句后再保存", "info"); return false; }
    setSaving(true);
    try {
      const r = await safeWrite(path, body, baseRef.current);
      if (r.status === 409) {
        toast("文件已被外部修改，已重载最新版本", "err");
        setContent(r.fresh.content); baseRef.current = r.fresh.content; setExists(r.fresh.exists); setDirty(false);
        return false;
      }
      if (!r.ok) { toast("保存失败：" + r.status, "err"); return false; }
      baseRef.current = r.fresh ? r.fresh.content : body;
      setDirty(false); setExists(true);
      setDiaryDays((prev) => (prev.includes(date) ? prev : [...prev, date]));
      void refreshIndexInBackground();
      return true;
    } catch (e) {
      toast("保存失败：" + e.message, "err");
      return false;
    } finally {
      setSaving(false);
    }
  }, [content, path, date, loading, refreshIndexInBackground]);

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [save]);

  async function createFromTemplate() {
    let tpl = FALLBACK_TPL;
    try {
      const r = await readNote(TEMPLATE_PATH);
      if (r.exists && r.content.trim()) tpl = r.content;
    } catch { /* 用内置模板 */ }
    const body = fillTemplate(tpl, date);
    setContent(body);
    setDrafting(true);
    setDirty(true);
    setView("edit");
    const ok = await save(body);
    if (ok) toast("已按模板创建日志", "ok");
  }

  function createBlank() {
    setContent("");
    baseRef.current = null;
    setExists(false);
    setDrafting(true);
    setDirty(false);
    setView("edit");
  }

  async function remove() {
    if (!exists || loading) return;
    if (!window.confirm("将「" + date + "」日志移入 Obsidian 废纸篓？可按 Obsidian 的已删除文件设置恢复。")) return;
    setSaving(true);
    try {
      const r = await safeDeleteNote(path, baseRef.current);
      if (r.status === 409) {
        setContent(r.fresh.content); baseRef.current = r.fresh.content; setExists(true); setDirty(false);
        toast("日志已被外部修改，已重载；请确认内容后再删除", "err");
        return;
      }
      if (!r.ok) { toast("删除失败：" + r.status, "err"); return; }
      setContent(""); baseRef.current = null; setExists(false); setDrafting(false); setDirty(false); setView("edit");
      setDiaryDays((prev) => prev.filter((d) => d !== date));
      void refreshIndexInBackground();
      toast(r.status === 404 ? "日志已不存在" : "日志已移入 Obsidian 废纸篓", "ok");
    } catch (e) {
      toast("删除失败：" + e.message, "err");
    } finally {
      setSaving(false);
    }
  }

  async function quickAppend() {
    let base = content;
    if (!exists || !base.trim()) {
      let tpl = FALLBACK_TPL;
      try {
        const r = await readNote(TEMPLATE_PATH);
        if (r.exists && r.content.trim()) tpl = r.content;
      } catch { /* 忽略 */ }
      base = fillTemplate(tpl, date);
    }
    const now = new Date();
    const hm = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    let next = base;
    if (quick.goal.trim()) next = appendToSection(next, "今日目标", "- [ ] " + quick.goal.trim());
    if (quick.work.trim()) next = appendToSection(next, "工作事项", "- （" + hm + "）" + quick.work.trim());
    if (quick.capture.trim()) next = appendToSection(next, "知识捕获", "- （" + hm + "）" + quick.capture.trim());
    if (quick.mood.trim()) next = appendToSection(next, "情绪", "> " + quick.mood.trim());
    if (quick.summary.trim()) next = appendToSection(next, "今日总结", "> " + quick.summary.trim());
    if (next === base) { toast("请先填写至少一项", "info"); return; }
    setContent(next);
    const ok = await save(next);
    if (ok) {
      toast("已追加到 " + date + " 日志", "ok");
      setQuick({ goal: "", work: "", capture: "", mood: "", summary: "" });
    }
  }

  const qFields = [
    ["goal", "今日目标", "要完成什么？"],
    ["work", "工作事项", "做了什么？"],
    ["capture", "知识捕获", "读到 / 想到什么？"],
    ["mood", "情绪", "一至十分及一句原因"],
    ["summary", "一句话总结", "今天最值得记住的事"],
  ];

  return (
    <div className="px-7 py-6 max-w-[1380px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
      <div className="lg:col-span-3 space-y-4 anim-fade-up">
        <div className="panel p-4">
          <Calendar
            month={month}
            selected={date}
            diaryDays={diaryDays}
            onPick={(iso) => { setMonth(new Date(iso + "T00:00:00")); nav("/diary/" + iso); }}
            onMonth={(delta) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1))}
          />
        </div>

        <div className="panel p-4">
          <h3 className="font-display text-[17.5px] font-bold mb-3">结构化快录</h3>
          <div className="space-y-2.5">
            {qFields.map(([key, label, ph]) => (
              <div key={key}>
                <label className="text-[13.5px] text-[var(--color-paper-faint)] tracking-wider">{label}</label>
                <input
                  value={quick[key]}
                  onChange={(e) => setQuick((q) => ({ ...q, [key]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") quickAppend(); }}
                  disabled={loading || saving}
                  placeholder={ph}
                  className="ink-input w-full mt-1 px-2.5 py-[7px] text-[15px]"
                />
              </div>
            ))}
            <button onClick={quickAppend} disabled={loading || saving} className="btn-ink w-full py-2 text-[15.5px] font-medium mt-1 disabled:opacity-50">
              追加到日志
            </button>
          </div>
        </div>
      </div>

      <div className="lg:col-span-9 panel anim-fade-up flex flex-col" style={{ minHeight: "calc(100vh - 110px)" }}>
        <div className="flex flex-wrap items-center gap-3 px-5 py-3.5 border-b border-[rgba(96,125,104,.12)]">
          <h2 className="font-display text-[20px] font-bold">{date}</h2>
          <span className={"text-[13.5px] px-2 py-[2px] rounded-full " + (exists ? "text-[var(--color-para-area)] bg-[rgba(61,145,88,.12)]" : "text-[var(--color-paper-faint)] bg-[rgba(96,125,104,.1)]")}>
            {exists ? "已有日志" : drafting ? "空白草稿" : "尚未创建"}
          </span>
          {dirty && <span className="text-[13.5px] text-[var(--color-para-project)]">● 未保存</span>}
          {loading && <span className="text-[13.5px] text-[var(--color-paper-faint)]">加载中…</span>}
          <div className="ml-auto flex items-center gap-2">
            <div className="flex rounded-lg overflow-hidden border border-[rgba(96,125,104,.25)]">
              {[["read", "阅读"], ["edit", "编辑"], ["split", "对照"]].map(([v, label]) => (
                <button key={v} onClick={() => setView(v)} disabled={loading}
                  className={"px-3 py-[5px] text-[14.5px] " + (view === v ? "bg-[rgba(217,164,65,.18)] text-[#8a6d1f]" : "text-[var(--color-paper-dim)] hover:text-[var(--color-paper)]")}>
                  {label}
                </button>
              ))}
            </div>
            {view !== "read" && <button onClick={() => save()} disabled={loading || saving}
              className="btn-ink px-4 py-[6px] text-[15px] font-medium disabled:opacity-50">
              {saving ? "保存中…" : "保存 (Ctrl+S)"}
            </button>}
            {exists && <button onClick={remove} disabled={loading || saving}
              className="btn-ghost px-3 py-[6px] text-[14px] disabled:opacity-50 hover:!text-[var(--color-seal)] hover:!border-[rgba(192,72,63,.5)]">移入废纸篓</button>}
          </div>
        </div>

        {loading && <div className="flex-1 flex items-center justify-center py-16 text-[15px] text-[var(--color-paper-faint)]">正在读取这一天的日志…</div>}

        {!loading && !exists && !content && !drafting && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center py-16">
            <div className="font-display text-[20px] text-[var(--color-paper-dim)]">这一天还没有日志</div>
            <div className="flex gap-2">
              <button onClick={createFromTemplate} className="btn-ink px-5 py-2.5 text-[16px]">按模板开始</button>
              <button onClick={createBlank} className="btn-ghost px-5 py-2.5 text-[16px]">空白开始</button>
            </div>
            <div className="text-[13.5px] text-[var(--color-paper-faint)]">模板适合复盘；空白开始不会生成文件，写下第一句后保存即可。</div>
          </div>
        )}

        {!loading && (exists || content || drafting) && (
          <div className="flex-1 flex min-h-0">
            {view !== "read" && (
              <textarea
                value={content}
                onChange={(e) => { setContent(e.target.value); setDirty(true); }}
                spellCheck={false}
                className={"ink-input rounded-none border-0 resize-none px-5 py-4 text-[16px] leading-[1.9] font-mono " + (view === "split" ? "w-1/2 border-r border-r-[rgba(96,125,104,.12)]" : "w-full")}
              />
            )}
            {view !== "edit" && (
              <div className={"overflow-y-auto px-6 py-4 " + (view === "split" ? "w-1/2" : "w-full")}>
                <Markdown text={content} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
