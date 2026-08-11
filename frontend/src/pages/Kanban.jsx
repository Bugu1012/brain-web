import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext, PointerSensor, useSensor, useSensors, useDroppable, closestCorners,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { readNote, safeWrite } from "../lib/api.js";
import { parseKanban, serializeKanban, moveCard, dueDate } from "../lib/kanban.js";
import { todayStr } from "../lib/vault.js";
import { toast } from "../components/Toast.jsx";

const BOARD_PATH = "02-项目/待办看板.md";

const COL_COLORS = {
  "收件箱": "#7d9484",
  "今日": "#b58422",
  "本周": "#4a7dc0",
  "进行中": "#3d9158",
  "已完成": "#6d7a86",
};

function Card({ id, card, colName, onToggle, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const due = dueDate(card.text);
  const overdue = due && !card.done && due < todayStr();
  const cleanText = card.text.replace(/📅\s*\d{4}-\d{2}-\d{2}/, "").trim();
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={"group relative rounded-lg border px-3 py-2.5 mb-2 text-[15px] leading-relaxed select-none " +
        (isDragging ? "opacity-60 shadow-xl border-[rgba(217,164,65,.6)] bg-[#cfe0d2]" : "border-[rgba(96,125,104,.16)] bg-[rgba(255,255,255,.5)] hover:border-[rgba(96,125,104,.35)]")}
    >
      <div className="flex items-start gap-2">
        <button
          onClick={() => onToggle(colName, id)}
          className={"mt-[2px] w-[15px] h-[15px] shrink-0 rounded-[4px] border transition-colors " +
            (card.done ? "bg-[var(--color-para-area)] border-[var(--color-para-area)]" : "border-[rgba(96,125,104,.45)] hover:border-[var(--color-para-area)]")}
        >
          {card.done && <svg viewBox="0 0 12 12" className="w-full h-full text-[#edf4ee]" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2.5 6.5l2.5 2.5 4.5-5.5"/></svg>}
        </button>
        <div {...attributes} {...listeners} className={"flex-1 cursor-grab active:cursor-grabbing " + (card.done ? "line-through text-[var(--color-paper-faint)]" : "text-[var(--color-paper)]")}>
          {cleanText}
          {due && (
            <span className={"ml-1.5 text-[13px] px-1.5 py-[1px] rounded " + (overdue ? "text-[#a63d34] bg-[rgba(192,72,63,.18)]" : "text-[var(--color-paper-faint)] bg-[rgba(96,125,104,.12)]")}>
              📅 {due}
            </span>
          )}
        </div>
        <button onClick={() => { if (window.confirm("删除这张待办卡片？删除后不可恢复。")) onDelete(colName, id); }}
          className="opacity-0 group-hover:opacity-100 text-[var(--color-paper-faint)] hover:text-[var(--color-seal)] transition-opacity text-[15.5px] leading-none px-0.5">×</button>
      </div>
    </div>
  );
}

function Column({ section, onAdd, onToggle, onDelete }) {
  const { setNodeRef, isOver } = useDroppable({ id: "col::" + section.name });
  const color = COL_COLORS[section.name] || "#7d9484";
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const cardIds = section.cards.map((_, i) => "card::" + section.name + "::" + i);

  function submit() {
    const t = text.trim();
    if (!t) return;
    onAdd(section.name, t + (due ? " 📅 " + due : ""));
    setText(""); setDue("");
  }

  return (
    <div className={"w-[272px] shrink-0 flex flex-col rounded-xl border transition-colors " +
      (isOver ? "border-[rgba(217,164,65,.55)] bg-[rgba(217,164,65,.05)]" : "border-[rgba(96,125,104,.12)] bg-[rgba(247,251,247,.55)]")}>
      <div className="flex items-center gap-2 px-3.5 pt-3 pb-2">
        <span className="w-[9px] h-[9px] rounded-[3px]" style={{ background: color }} />
        <span className="font-display text-[16.5px] font-bold">{section.name}</span>
        <span className="text-[13.5px] text-[var(--color-paper-faint)] px-1.5 rounded-full bg-[rgba(96,125,104,.1)]">{section.cards.length}</span>
      </div>
      <div ref={setNodeRef} className="flex-1 overflow-y-auto px-2.5 pb-1 min-h-[60px]">
        <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
          {section.cards.map((c, i) => (
            <Card key={cardIds[i]} id={cardIds[i]} card={c} colName={section.name} onToggle={onToggle} onDelete={onDelete} />
          ))}
        </SortableContext>
      </div>
      <div className="px-2.5 pb-2.5 pt-1 space-y-1.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="＋ 新卡片，回车添加"
          className="ink-input w-full px-2.5 py-[6px] text-[14.5px]"
        />
        <div className="flex gap-1.5">
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)}
            className="ink-input flex-1 px-2 py-[4px] text-[13.5px] text-[var(--color-paper-dim)]" />
          <button onClick={submit} className="btn-ghost px-2.5 text-[14.5px]">添加</button>
        </div>
      </div>
    </div>
  );
}

export default function Kanban() {
  const [board, setBoard] = useState(null);
  const [status, setStatus] = useState("loading");
  const [savedAt, setSavedAt] = useState(null);
  const timer = useRef(null);
  const baseRef = useRef(null);
  const boardRef = useRef(null);
  const writingRef = useRef(Promise.resolve());

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const r = await readNote(BOARD_PATH);
      if (!r.exists) { toast("待办文件不存在：" + BOARD_PATH, "err"); setStatus("error"); return; }
      setBoard(parseKanban(r.content));
      baseRef.current = r.content;
      setStatus("saved");
    } catch (e) {
      toast("加载待办失败：" + e.message, "err");
      setStatus("error");
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { boardRef.current = board; }, [board]);

  const persist = useCallback(async (b) => {
    setStatus("saving");
    const text = serializeKanban(b);
    try {
      const r = await safeWrite(BOARD_PATH, text, baseRef.current);
      if (r.status === 409) {
        toast("检测到外部修改（Obsidian 或其他进程），已重载", "err");
        load();
        return;
      }
      if (!r.ok) { toast("保存失败：" + r.status, "err"); setStatus("error"); return; }
      baseRef.current = r.fresh ? r.fresh.content : text;
      setStatus("saved");
      setSavedAt(new Date());
    } catch (e) {
      toast("保存失败：" + e.message, "err");
      setStatus("error");
    }
  }, [load]);

  const enqueuePersist = useCallback((b) => {
    writingRef.current = writingRef.current.catch(() => {}).then(() => persist(b));
    return writingRef.current;
  }, [persist]);

  useEffect(() => {
    function flushPending() {
      if (!timer.current) return;
      clearTimeout(timer.current);
      timer.current = null;
      if (boardRef.current) enqueuePersist(boardRef.current);
    }
    window.addEventListener("beforeunload", flushPending);
    return () => {
      window.removeEventListener("beforeunload", flushPending);
      flushPending();
    };
  }, [enqueuePersist]);

  function mutate(fn) {
    setBoard((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      fn(next);
      clearTimeout(timer.current);
      setStatus("dirty");
      timer.current = setTimeout(() => { timer.current = null; enqueuePersist(next); }, 500);
      return next;
    });
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function onDragEnd(e) {
    const { active, over } = e;
    if (!over || !board) return;
    const [, fromCol, fromIdx] = active.id.split("::");
    let toCol, toIdx;
    if (over.id.startsWith("col::")) {
      toCol = over.id.slice(5);
      const dst = board.sections.find((s) => s.name === toCol);
      toIdx = dst ? dst.cards.length : 0;
    } else {
      [, toCol, toIdx] = over.id.split("::");
      toIdx = parseInt(toIdx, 10);
    }
    if (fromCol === toCol && parseInt(fromIdx, 10) === toIdx) return;
    mutate((b) => moveCard(b, fromCol, parseInt(fromIdx, 10), toCol, toIdx));
  }

  function onAdd(col, text) {
    mutate((b) => {
      const s = b.sections.find((x) => x.name === col);
      if (s) s.cards.push({ done: false, text });
    });
  }
  function onToggle(col, id) {
    const idx = parseInt(id.split("::")[2], 10);
    mutate((b) => {
      const s = b.sections.find((x) => x.name === col);
      if (s && s.cards[idx]) s.cards[idx].done = !s.cards[idx].done;
    });
  }
  function onDelete(col, id) {
    const idx = parseInt(id.split("::")[2], 10);
    mutate((b) => {
      const s = b.sections.find((x) => x.name === col);
      if (s) s.cards.splice(idx, 1);
    });
  }

  const statusUi = {
    loading: ["检测中…", "text-[var(--color-paper-faint)]"],
    saved: ["已保存" + (savedAt ? " " + savedAt.toLocaleTimeString("zh-CN", { hour12: false }) : ""), "text-[var(--color-para-area)]"],
    saving: ["保存中…", "text-[var(--color-para-project)]"],
    dirty: ["未保存", "text-[var(--color-para-project)]"],
    error: ["连接异常", "text-[var(--color-seal)]"],
  }[status] || ["", ""];

  return (
    <div className="px-7 py-6 h-full flex flex-col">
      <div className="flex items-center gap-4 mb-4 anim-fade-up">
        <h1 className="font-display text-[31px] font-black tracking-wide">待办</h1>
        <span className={"text-[14.5px] " + statusUi[1]}>● {statusUi[0]}</span>
        <div className="ml-auto flex gap-2">
          <button onClick={() => {
            clearTimeout(timer.current);
            timer.current = null;
            if (board) enqueuePersist(board);
          }} className="btn-ink px-3.5 py-[7px] text-[15px]">立即保存</button>
          <button onClick={load} className="btn-ghost px-3.5 py-[7px] text-[15px]">重载</button>
        </div>
      </div>

      {!board && status === "loading" && <div className="text-[var(--color-paper-faint)] text-[15.5px]">加载中…</div>}
      {!board && status === "error" && (
        <div className="panel p-8 text-center">
          <div className="text-[var(--color-paper-dim)] mb-2">无法读取待办，请确认 Obsidian 已启动且 Local REST API 可用</div>
          <button onClick={load} className="btn-ink px-4 py-2 text-[15.5px]">重试</button>
        </div>
      )}

      {board && (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
          <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden pb-2 anim-fade-up">
            <div className="flex gap-3.5 h-full">
              {board.sections.map((s) => (
                <Column key={s.name} section={s} onAdd={onAdd} onToggle={onToggle} onDelete={onDelete} />
              ))}
            </div>
          </div>
        </DndContext>
      )}
    </div>
  );
}
