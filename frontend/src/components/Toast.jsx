import { useEffect, useState } from "react";

let pushFn = null;

export function toast(msg, type) {
  if (pushFn) pushFn({ msg, type: type || "info", id: Date.now() + Math.random() });
}

const BORDER = {
  ok: "border-l-[3px] border-l-[var(--color-para-area)]",
  err: "border-l-[3px] border-l-[var(--color-seal)]",
  info: "border-l-[3px] border-l-[var(--color-para-project)]",
};

export default function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    pushFn = (t) => {
      setItems((prev) => [...prev.slice(-3), t]);
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), 3800);
    };
    return () => { pushFn = null; };
  }, []);
  return (
    <div className="fixed bottom-6 right-6 z-[120] flex flex-col items-end gap-2">
      {items.map((t) => (
        <div key={t.id} className={"anim-toast panel px-4 py-2.5 text-sm max-w-sm shadow-xl " + (BORDER[t.type] || BORDER.info)}>
          <span className="text-[var(--color-paper)]">{t.msg}</span>
        </div>
      ))}
    </div>
  );
}