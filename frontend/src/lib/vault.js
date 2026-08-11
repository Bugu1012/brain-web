export function buildTree(files) {
  const root = { name: "", path: "", dirs: {}, files: [] };
  for (const f of files) {
    const parts = f.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!node.dirs[p]) node.dirs[p] = { name: p, path: parts.slice(0, i + 1).join("/"), dirs: {}, files: [] };
      node = node.dirs[p];
    }
    node.files.push({ name: parts[parts.length - 1], path: f });
  }
  return root;
}

const CN_DIGITS = "〇一二三四五六七八九";
export function cnDate(d) {
  const y = String(d.getFullYear()).split("").map((c) => CN_DIGITS[+c]).join("");
  const weekdays = "日一二三四五六";
  return y + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日 · 周" + weekdays[d.getDay()];
}
export function todayStr() {
  return isoDate(new Date());
}
export function isoDate(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
export function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const d = new Date(value + "T12:00:00");
  return !Number.isNaN(d.getTime()) && isoDate(d) === value;
}
export function recentDateRange(count, end = new Date()) {
  const days = Math.max(1, Math.floor(Number(count) || 1));
  const cursor = new Date(end);
  cursor.setHours(12, 0, 0, 0);
  cursor.setDate(cursor.getDate() - days + 1);
  return Array.from({ length: days }, () => {
    const out = isoDate(cursor);
    cursor.setDate(cursor.getDate() + 1);
    return out;
  });
}
export function relTime(iso) {
  if (!iso) return "从未";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 90) return "刚刚";
  if (diff < 3600) return Math.floor(diff / 60) + " 分钟前";
  if (diff < 86400) return Math.floor(diff / 3600) + " 小时前";
  return Math.floor(diff / 86400) + " 天前";
}
export function preprocessWikilinks(md) {
  return md.replace(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g, (all, name) => {
    return "[" + name.trim() + "](#/wiki/" + encodeURIComponent(name.trim()) + ")";
  });
}

export function appendToSection(content, section, line) {
  const re = new RegExp("(\\n|^)##\\s+" + section + "\\s*\\n");
  const m = re.exec(content);
  if (m) {
    const idx = m.index + m[0].length;
    return content.slice(0, idx) + line + "\n" + content.slice(idx);
  }
  return content.trimEnd() + "\n\n## " + section + "\n\n" + line + "\n";
}

export function fillTemplate(tpl, dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const weekdays = "日一二三四五六";
  return tpl
    .replace(/\{\{date:YYYY-MM-DD\}\}/g, dateStr)
    .replace(/\{\{date\}\}/g, dateStr)
    .replace(/\{\{title\}\}/g, "周" + weekdays[d.getDay()]);
}
