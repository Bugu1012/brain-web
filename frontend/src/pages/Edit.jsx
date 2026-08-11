import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { readNote, rebuildPortalIndex, safeDeleteNote, safeWrite } from "../lib/api.js";
import Markdown from "../components/Markdown.jsx";
import { toast } from "../components/Toast.jsx";

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

function hasMobileFlag(content) {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---/);
  return !!(m && /(^|\n)mobile:\s*true/.test(m[1]));
}

function setMobileFlag(content, on) {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (m) {
    let fm = m[1];
    if (on) {
      if (!/(^|\n)mobile:\s*true/.test(fm)) fm = fm.replace(/\s*$/, "") + "\nmobile: true";
    } else {
      fm = fm.replace(/(^|\n)mobile:\s*(true|false)\s*(?=\n|$)/g, "");
    }
    return content.replace(/^---\s*\n[\s\S]*?\n---/, "---\n" + fm + "\n---");
  }
  if (!on) return content;
  return "---\nmobile: true\n---\n\n" + content;
}

export default function Edit() {
  const params = useParams();
  const nav = useNavigate();
  const raw = params["*"] || "";
  const path = raw ? safeDecode(raw) : "";

  const [content, setContent] = useState("");
  const baseRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [exists, setExists] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState("read");
  const [newPath, setNewPath] = useState("01-收件箱/");
  const indexRefreshingRef = useRef(false);

  const refreshIndexInBackground = useCallback(async () => {
    if (indexRefreshingRef.current) return;
    indexRefreshingRef.current = true;
    try {
      await rebuildPortalIndex();
    } catch (e) {
      toast("笔记已更新；门户索引将在下一次自动刷新后同步：" + e.message, "info");
    } finally {
      indexRefreshingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!path) { setLoading(false); return; }
    let on = true;
    setLoading(true);
    readNote(path).then((r) => {
      if (!on) return;
      setExists(r.exists);
      setContent(r.content);
      baseRef.current = r.exists ? r.content : null;
      setDirty(false);
      setView(r.exists ? "read" : "edit");
      setLoading(false);
    }).catch((e) => { if (on) { setLoading(false); toast("读取失败：" + e.message, "err"); } });
    return () => { on = false; };
  }, [path]);

  const save = useCallback(async () => {
    if (!path || loading) return;
    setSaving(true);
    try {
      const r = await safeWrite(path, content, baseRef.current);
      if (r.status === 409) {
        toast("文件已被外部修改，已重载最新版本", "err");
        setContent(r.fresh.content); baseRef.current = r.fresh.content; setExists(r.fresh.exists); setDirty(false);
        return;
      }
      if (!r.ok) { toast("保存失败：" + r.status, "err"); return; }
      baseRef.current = r.fresh ? r.fresh.content : content;
      setDirty(false); setExists(true);
      void refreshIndexInBackground();
      toast("已保存", "ok");
    } catch (e) {
      toast("保存失败：" + e.message, "err");
    } finally {
      setSaving(false);
    }
  }, [path, content, loading, refreshIndexInBackground]);

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [save]);

  async function remove() {
    if (!window.confirm("将「" + path + "」移入 Obsidian 废纸篓？可按 Obsidian 的已删除文件设置恢复。")) return;
    try {
      const r = await safeDeleteNote(path, baseRef.current);
      if (r.status === 409) {
        setContent(r.fresh.content); baseRef.current = r.fresh.content; setExists(true); setDirty(false);
        toast("文件已被外部修改，已重载；请确认后再删除", "err");
      } else if (r.ok) { void refreshIndexInBackground(); toast(r.status === 404 ? "文件已不存在" : "已移入 Obsidian 废纸篓", "ok"); nav("/browse"); }
      else toast("删除失败：" + r.status, "err");
    } catch (e) {
      toast("删除失败：" + e.message, "err");
    }
  }

  if (!path) {
    return (
      <div className="px-7 py-6 max-w-[640px] mx-auto anim-fade-up">
        <h1 className="font-display text-[31px] font-black tracking-wide mb-4">新建 / 打开笔记</h1>
        <div className="panel p-5 space-y-3">
          <label className="text-[14.5px] text-[var(--color-paper-faint)]">文件路径（相对 Vault 根目录，以 .md 结尾）</label>
          <input value={newPath} onChange={(e) => setNewPath(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && newPath.trim().endsWith(".md")) nav("/edit/" + newPath.trim().split("/").map(encodeURIComponent).join("/")); }}
            className="ink-input w-full px-3 py-2.5 text-[15.5px] font-mono" />
          <div className="flex gap-2">
            <button
              onClick={() => newPath.trim().endsWith(".md") && nav("/edit/" + newPath.trim().split("/").map(encodeURIComponent).join("/"))}
              className="btn-ink px-4 py-2 text-[15.5px]">打开编辑</button>
            <span className="text-[14px] text-[var(--color-paper-faint)] self-center">文件不存在时将自动创建</span>
          </div>
        </div>
      </div>
    );
  }

  const mobile = hasMobileFlag(content);

  return (
    <div className="px-7 py-6 h-full flex flex-col min-h-0">
      <div className="flex items-center gap-3 mb-3.5 anim-fade-up flex-wrap">
        <h1 className="font-display text-[22px] font-bold font-mono">{path}</h1>
        <span className={"text-[13.5px] px-2 py-[2px] rounded-full " + (exists ? "text-[var(--color-para-area)] bg-[rgba(61,145,88,.12)]" : "text-[var(--color-para-project)] bg-[rgba(217,164,65,.12)]")}>
          {exists ? "已存在" : "将新建"}
        </span>
        {dirty && <span className="text-[13.5px] text-[var(--color-para-project)]">● 未保存</span>}
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-2 text-[14.5px] text-[var(--color-paper-dim)] cursor-pointer select-none mr-1">
            <input type="checkbox" checked={mobile}
              onChange={(e) => { setContent((c) => setMobileFlag(c, e.target.checked)); setDirty(true); }}
              className="accent-[var(--color-para-area)]" />
            手机可见
            <span className="text-[13px] text-[var(--color-paper-faint)]">(mobile: true，晚间推送导出)</span>
          </label>
          <div className="flex rounded-lg overflow-hidden border border-[rgba(96,125,104,.25)]">
            {[["read", "阅读"], ["edit", "编辑"], ["split", "对照"]].map(([v, label]) => (
              <button key={v} onClick={() => setView(v)}
                className={"px-3 py-[5px] text-[14.5px] " + (view === v ? "bg-[rgba(217,164,65,.18)] text-[#8a6d1f]" : "text-[var(--color-paper-dim)] hover:text-[var(--color-paper)]")}>
                {label}
              </button>
            ))}
          </div>
          {view !== "read" && <button onClick={save} disabled={saving || loading} className="btn-ink px-4 py-[6px] text-[15px] font-medium disabled:opacity-50">
            {saving ? "保存中…" : "保存"}
          </button>}
          {exists && <button onClick={remove} disabled={loading || saving} className="btn-ghost px-3 py-[6px] text-[15px] disabled:opacity-50 hover:!text-[var(--color-seal)] hover:!border-[rgba(192,72,63,.5)]">移入废纸篓</button>}
        </div>
      </div>

      <div className="flex-1 panel min-h-0 flex anim-fade-up">
        {loading && <div className="flex-1 flex items-center justify-center text-[15px] text-[var(--color-paper-faint)]">正在读取笔记…</div>}
        {!loading && view !== "read" && (
          <textarea
            value={content}
            onChange={(e) => { setContent(e.target.value); setDirty(true); }}
            spellCheck={false}
            placeholder="在此书写 Markdown…"
            className={"ink-input rounded-none border-0 resize-none px-5 py-4 text-[16px] leading-[1.9] font-mono " + (view === "split" ? "w-1/2 border-r border-r-[rgba(96,125,104,.12)]" : "w-full")}
          />
        )}
        {!loading && view !== "edit" && (
          <div className={"overflow-y-auto px-6 py-4 " + (view === "split" ? "w-1/2" : "w-full")}>
            <Markdown text={content} />
          </div>
        )}
      </div>
    </div>
  );
}
