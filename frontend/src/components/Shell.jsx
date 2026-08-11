import { useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { ping, hasKey, portalFetch } from "../lib/api.js";
import { cnDate, todayStr } from "../lib/vault.js";
import Toaster, { toast } from "./Toast.jsx";
import MomentComposer from "./MomentComposer.jsx";
import { fetchMoments } from "../lib/moments.js";
import { lunarInfo } from "../lib/calendar.js";
import { getCity, setCity, fetchWeather } from "../lib/weather.js";
import { THEMES, getSavedThemeId, saveTheme } from "../lib/themes.js";

function Icon({ d }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" className="w-[21px] h-[21px] shrink-0">
      {d}
    </svg>
  );
}

const NAV = [
  { to: "/", label: "总览", end: true, icon: <Icon d={<><rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="4.5" rx="1.5"/><rect x="13.5" y="10.5" width="7.5" height="10.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/></>} />, hint: "数据总览" },
  { to: "/diary", label: "日志", icon: <Icon d={<><path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V4z"/><path d="M18 8h-9M9 4v14"/><path d="M9 12h6"/></>} />, hint: "每日记录" },
  { to: "/timeline", label: "时间轴", icon: <Icon d={<><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></>} />, hint: "说说·照片·日志·文档" },
  { to: "/kanban", label: "待办", icon: <Icon d={<><rect x="3" y="4" width="5.4" height="16" rx="1.3"/><rect x="9.3" y="4" width="5.4" height="11" rx="1.3"/><rect x="15.6" y="4" width="5.4" height="7" rx="1.3"/></>} />, hint: "待办面板" },
  { to: "/browse", label: "浏览", icon: <Icon d={<><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></>} />, hint: "库内文件" },
  { to: "/search", label: "搜索", icon: <Icon d={<><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></>} />, hint: "全文检索" },
  { to: "/graph", label: "图谱", icon: <Icon d={<><circle cx="6" cy="6" r="2.4"/><circle cx="18" cy="8" r="2.4"/><circle cx="10" cy="18" r="2.4"/><path d="M8.2 7.2l7.4.4M7 8.2l2.2 7.6M16.6 10l-4.8 6.2"/></>} />, hint: "知识网络" },
  { to: "/library", label: "图书馆", icon: <Icon d={<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></>} />, hint: "藏书与笔记" },
  { to: "/manual", label: "手册", icon: <Icon d={<><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></>} />, hint: "操作手册" },
  { to: "/settings", label: "设置", icon: <Icon d={<><circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7"/></>} />, hint: "连接配置" },
];

const TONE_DEF = { bg: 30, tr: 34 };
function loadTone() {
  try {
    const t = JSON.parse(localStorage.getItem("ink_tone") || "null");
    if (t && Number.isFinite(t.bg) && Number.isFinite(t.tr)) {
      return { bg: Math.min(60, Math.max(0, t.bg)), tr: Math.min(60, Math.max(0, t.tr)) };
    }
  } catch {}
  return { ...TONE_DEF };
}

export default function Shell({ children }) {
  const nav = useNavigate();
  const [conn, setConn] = useState("checking");

  useEffect(() => {
    let on = true;
    async function check() {
      if (!hasKey()) { if (on) setConn("nokey"); return; }
      const p = await ping();
      if (!on) return;
      setConn(p.authed ? "ok" : p.reachable ? "badkey" : "off");
    }
    check();
    const t = setInterval(check, 20000);
    window.addEventListener("brain-obsidian-key-changed", check);
    return () => { on = false; clearInterval(t); window.removeEventListener("brain-obsidian-key-changed", check); };
  }, []);

  const lun = useMemo(() => lunarInfo(new Date()), []);
  const [wx, setWx] = useState(null);
  const [dayTags, setDayTags] = useState([]);
  const [todayMoment, setTodayMoment] = useState(null);
  const [momentOpen, setMomentOpen] = useState(false);
  const todayIso = todayStr();
  const [tone, setTone] = useState(loadTone);
  const [toneOpen, setToneOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [themeId, setThemeId] = useState(getSavedThemeId);
  useEffect(() => {
    const r = document.documentElement;
    r.style.setProperty("--bg-opacity", (tone.bg / 100).toFixed(2));
    r.style.setProperty("--panel-alpha", (1 - tone.tr / 100).toFixed(2));
    try { localStorage.setItem("ink_tone", JSON.stringify(tone)); } catch {}
  }, [tone]);
  useEffect(() => {
    saveTheme(themeId);
  }, [themeId]);

  useEffect(() => {
    portalFetch("/daily_tags").then((r) => r.json())
      .then((d) => setDayTags(d[todayIso] || [])).catch(() => {});
  }, [todayIso]);

  function refreshTodayMoment() {
    fetchMoments(todayIso).then((j) => setTodayMoment((j.moments || [])[0] || null)).catch(() => {});
  }
  useEffect(() => {
    refreshTodayMoment();
    window.addEventListener("moments-changed", refreshTodayMoment);
    return () => window.removeEventListener("moments-changed", refreshTodayMoment);
  }, [todayIso]);

  function editDayTags() {
    const v = window.prompt("今日标签（逗号分隔，留空清除）", dayTags.join(", "));
    if (v === null) return;
    const tags = v.split(/[,，]/).map((t) => t.trim()).filter(Boolean).slice(0, 12);
    portalFetch("/daily_tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: todayIso, tags }),
    }).then((r) => r.json()).then((j) => {
      if (j.ok) setDayTags(tags);
      else toast(j.error || "今日标签保存失败", "err");
    }).catch(() => toast("今日标签保存失败：门户未启动？", "err"));
  }

  async function loadWeather(city) {
    try { setWx({ ok: true, ...(await fetchWeather(city)) }); }
    catch (e) { setWx({ ok: false, msg: e.message }); }
  }

  useEffect(() => {
    loadWeather(getCity());
    const t = setInterval(() => loadWeather(getCity()), 30 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  function changeCity() {
    const c = window.prompt("输入城市名（如：杭州）", getCity());
    if (c && c.trim()) { setCity(c); loadWeather(c.trim()); }
  }

  const connUi = {
    ok: { dot: "bg-[var(--color-para-area)]", text: "已连接 Obsidian", cls: "text-[var(--color-para-area)]" },
    off: { dot: "bg-[var(--color-seal)]", text: "Obsidian 未响应", cls: "text-[var(--color-seal)]" },
    badkey: { dot: "bg-[var(--color-para-project)]", text: "密钥无效", cls: "text-[var(--color-para-project)]" },
    nokey: { dot: "bg-[var(--color-para-project)]", text: "未配置密钥", cls: "text-[var(--color-para-project)]" },
    checking: { dot: "bg-[var(--color-ink-400)]", text: "检测中…", cls: "text-[var(--color-paper-dim)]" },
  }[conn];

  return (
    <div className="h-full flex relative">
      <div className="bg-ambient" />
      <div className="fixed bottom-3 right-3 z-20 flex flex-col items-end gap-2">
        {themeOpen && (
          <div className="panel p-3.5 w-[264px] anim-fade-up">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[13.5px] font-medium text-[var(--color-paper-dim)]">主题</span>
              <button onClick={() => setThemeId("songjian")} className="text-[12px] text-[var(--color-jade-deep)] hover:underline">默认</button>
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              {THEMES.map((theme) => (
                <button key={theme.id} onClick={() => setThemeId(theme.id)}
                  className={"theme-chip " + (themeId === theme.id ? "theme-chip-active" : "")}>
                  <span className="theme-swatch" aria-hidden="true">
                    {theme.swatches.map((c) => <span key={c} style={{ background: c }} />)}
                  </span>
                  <span className="font-medium text-[14px]">{theme.label}</span>
                  <span className="ml-auto text-[12.5px] text-[var(--color-paper-faint)]">{theme.desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {toneOpen && (
          <div className="panel p-3.5 w-[232px] anim-fade-up">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[13.5px] font-medium text-[var(--color-paper-dim)]">画面浓淡</span>
              <button onClick={() => setTone({ ...TONE_DEF })} className="text-[12px] text-[var(--color-jade-deep)] hover:underline">恢复默认</button>
            </div>
            <label className="block text-[12.5px] text-[var(--color-paper-faint)] mb-1">背景浓度 {tone.bg}%</label>
            <input type="range" min="0" max="60" step="2" value={tone.bg}
              onChange={(e) => setTone((t) => ({ ...t, bg: +e.target.value }))} className="w-full tone-range" />
            <label className="block text-[12.5px] text-[var(--color-paper-faint)] mt-2.5 mb-1">面板透明 {tone.tr}%</label>
            <input type="range" min="0" max="60" step="2" value={tone.tr}
              onChange={(e) => setTone((t) => ({ ...t, tr: +e.target.value }))} className="w-full tone-range" />
          </div>
        )}
        <div className="flex items-center gap-2">
          <button onClick={() => setThemeOpen((v) => !v)} title="切换门户主题"
            className="float-control text-[12px] px-2.5 py-1">主题</button>
          <button onClick={() => setToneOpen((v) => !v)} title="调节背景浓度与面板透明度"
            className="float-control text-[12px] px-2.5 py-1">浓淡</button>
        </div>
      </div>

      <aside className="portal-sidebar relative z-10 w-[252px] shrink-0 flex flex-col">
        <div className="px-5 pt-6 pb-5 flex items-center gap-3">
          <div className="seal w-10 h-[56px] rounded-[10px] flex flex-col items-center justify-center gap-[3px] font-display text-[17px] font-black text-[#f5efe2] select-none leading-none"><span>凝</span><span>之</span></div>
          <div>
            <div className="font-display text-[22px] font-bold tracking-[.06em] text-[var(--color-paper)] leading-tight">松涧听澜</div>
            <div className="text-[13.5px] text-[var(--color-paper-faint)] tracking-[.04em] whitespace-nowrap">第二大脑 · 本地门户</div>
          </div>
        </div>

        <nav className="flex-1 px-3 space-y-[6px] overflow-y-auto">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                "nav-item group flex min-w-0 items-center gap-3.5 px-4 py-[12px] rounded-lg text-[17px] text-[var(--color-paper-dim)] " +
                (isActive ? "nav-active" : "")
              }
            >
              {item.icon}
              <span className="font-medium shrink-0 whitespace-nowrap">{item.label}</span>
              <span className="ml-auto min-w-0 truncate whitespace-nowrap text-[13.5px] text-[var(--color-paper-faint)] opacity-0 transition-opacity group-hover:opacity-100">{item.hint}</span>
            </NavLink>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-[rgba(96,125,104,.1)]">
          <button onClick={() => nav("/settings")} className="w-full flex items-center gap-2.5 text-left group">
            <span className={"w-2 h-2 rounded-full pulse-dot " + connUi.dot} />
            <span className={"text-[14.5px] " + connUi.cls}>{connUi.text}</span>
          </button>
        </div>
      </aside>

      <div className="relative z-10 flex-1 flex flex-col min-w-0">
        <header className="portal-topbar h-[58px] shrink-0 flex items-center gap-4 px-7">
          <div className="flex items-center gap-3 min-w-0">
            <div className="font-display text-[17.5px] text-[var(--color-paper-dim)] tracking-wide shrink-0">{cnDate(new Date())}</div>
            <div className="text-[13.5px] text-[var(--color-paper-faint)] shrink-0">{lun.lunar}</div>
            {lun.festival && <span className="soft-seal-chip text-[13px] px-2 py-[2px] rounded-full shrink-0">{lun.festival}</span>}
            {lun.jieqi && <span className="soft-jade-chip text-[13px] px-2 py-[2px] rounded-full shrink-0">{lun.jieqi}</span>}
          </div>
          <div className="ml-auto flex items-center gap-2.5">
            <button onClick={editDayTags} title="点击编辑今日标签"
              className="btn-ghost px-3 py-[7px] text-[14px] flex items-center gap-1.5 max-w-[300px]">
              {dayTags.length
                ? dayTags.map((t) => (
                    <span key={t} className="soft-jade-chip px-1.5 py-[1px] rounded-full truncate">#{t}</span>
                  ))
                : <span className="text-[var(--color-paper-faint)]">＋ 今日标签</span>}
            </button>
            {todayMoment && (
              <button onClick={() => nav("/timeline")} title="今日说说 · 点击查看时间轴"
                className="btn-ghost px-3 py-[7px] text-[14px] flex items-center gap-1.5 max-w-[220px]">
                <Icon d={<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.6 0-3.1-.4-4.4-1.2L3 20l1.2-5.1A8.5 8.5 0 1 1 21 11.5z"/>} />
                <span className="truncate">{todayMoment.text || todayMoment.photos.length + " 张照片"}</span>
              </button>
            )}
            <button onClick={() => setMomentOpen((v) => !v)} title="发一条说说（50 字以内，可带照片）"
              className="btn-ghost px-3 py-[7px] text-[14px]">说</button>
            <button onClick={wx && wx.ok === false ? () => loadWeather(getCity()) : changeCity} title="点击更换城市；失败时点击重试" className="btn-ghost px-3 py-[7px] text-[14px] flex items-center gap-1.5">
              {!wx ? <span className="text-[var(--color-paper-faint)]">天气加载中…</span> : wx.ok ? (<><span>{wx.icon}</span><span>{wx.temp}° {wx.text}</span><span className="text-[var(--color-paper-faint)]">{wx.city}</span></>) : <span className="text-[var(--color-seal)]" title={wx.msg}>{(wx.msg || "天气不可用").slice(0, 18)} · 点击重试</span>}
            </button>
            <button onClick={() => nav("/search")} className="btn-ghost px-3 py-[7px] text-[15px] flex items-center gap-2">
              <Icon d={<><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></>} />
              检索
            </button>
            <button onClick={() => nav("/diary/" + todayStr())} className="btn-ink px-3.5 py-[7px] text-[15px] font-medium flex items-center gap-2">
              <Icon d={<><path d="M12 5v14M5 12h14"/></>} />
              写日志
            </button>
          </div>
        </header>
        {momentOpen && (
          <div className="fixed right-7 top-[64px] z-40 panel p-4 w-[380px] anim-fade-up">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[13.5px] font-medium text-[var(--color-paper-dim)]">今日状态 · 说说</span>
              <button onClick={() => setMomentOpen(false)} className="text-[12px] text-[var(--color-paper-faint)] hover:underline">关闭</button>
            </div>
            <MomentComposer onDone={() => { setMomentOpen(false); refreshTodayMoment(); }} />
          </div>
        )}
        <main className="flex-1 overflow-y-auto min-h-0">{children}</main>
      </div>

      <Toaster />
    </div>
  );
}
