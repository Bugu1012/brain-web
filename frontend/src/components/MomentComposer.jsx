import { useRef, useState } from "react";
import { postMoment } from "../lib/moments.js";
import { toast } from "./Toast.jsx";

export default function MomentComposer({ onDone }) {
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  function addFiles(list) {
    const files = Array.from(list || []);
    if (photos.length + files.length > 4) { toast("照片最多 4 张", "err"); return; }
    for (const f of files) {
      if (!/^image\/(jpeg|png|webp|gif)$/.test(f.type)) { toast("仅支持 jpg/png/webp/gif", "err"); continue; }
      if (f.size > 1.5 * 1024 * 1024) { toast("单张照片上限 1.5MB", "err"); continue; }
      const r = new FileReader();
      r.onload = () => setPhotos((p) => (p.length < 4 ? [...p, r.result] : p));
      r.readAsDataURL(f);
    }
  }

  async function submit() {
    const t = text.trim();
    if (!t && !photos.length) { toast("说点什么，或加张照片", "err"); return; }
    if (t.length > 50) { toast("说说上限 50 字", "err"); return; }
    setBusy(true);
    try {
      await postMoment(t, photos);
      window.dispatchEvent(new Event("moments-changed"));
      toast("已发布到时间轴");
      setText("");
      setPhotos([]);
      if (onDone) onDone();
    } catch (e) {
      toast(e.message || "发布失败", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <textarea
        value={text}
        maxLength={50}
        rows={3}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        placeholder="此刻的想法（50 字以内）……"
        className="w-full resize-none rounded-lg border border-[rgba(96,125,104,.25)] bg-[rgba(255,255,255,.75)] px-3 py-2 text-[14.5px] text-[var(--color-paper)] placeholder:text-[var(--color-paper-faint)] focus:outline-none focus:border-[rgba(47,107,90,.55)]"
      />
      <div className="flex items-center justify-between mt-1">
        <span className={"text-[12px] " + (text.length >= 50 ? "text-[var(--color-seal)]" : "text-[var(--color-paper-faint)]")}>{text.length}/50</span>
        <button onClick={() => fileRef.current && fileRef.current.click()}
          className="text-[12.5px] text-[var(--color-jade-deep)] hover:underline">＋ 添加照片（≤4 张）</button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden
          onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      </div>
      {photos.length > 0 && (
        <div className="flex gap-2 mt-2 flex-wrap">
          {photos.map((p, i) => (
            <div key={i} className="relative">
              <img src={p} alt={"照片" + (i + 1)} className="w-14 h-14 object-cover rounded-md border border-[rgba(96,125,104,.25)]" />
              <button onClick={() => setPhotos((arr) => arr.filter((_, k) => k !== i))}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[var(--color-seal)] text-white text-[11px] leading-none flex items-center justify-center">×</button>
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end mt-3">
        <button onClick={submit} disabled={busy}
          className="btn-ink px-4 py-[7px] text-[14px] font-medium disabled:opacity-50">
          {busy ? "发布中…" : "发布"}
        </button>
      </div>
    </div>
  );
}