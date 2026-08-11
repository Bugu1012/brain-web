import { portalFetch } from "./api.js";

export async function postMoment(text, photos) {
  const r = await portalFetch("/moments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, photos }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "发布失败 " + r.status);
  return j;
}

export async function fetchMoments(date) {
  const r = await portalFetch("/moments" + (date ? "?date=" + date : ""), { cache: "no-store" });
  if (!r.ok) throw new Error("读取说说失败 " + r.status);
  return await r.json();
}

export async function fetchTimeline(month) {
  const r = await portalFetch("/timeline?month=" + month, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "读取时间轴失败 " + r.status);
  return j.items || [];
}

export function imgUrl(p) {
  return "/moment/img?path=" + encodeURIComponent(p);
}
