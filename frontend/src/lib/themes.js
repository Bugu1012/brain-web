export const DEFAULT_THEME_ID = "songjian";

export const THEMES = [
  {
    id: "songjian",
    label: "松涧",
    desc: "水墨纸感",
    swatches: ["#ecf3f0", "#2f6b5a", "#c0483f"],
  },
  {
    id: "anime",
    label: "二次元",
    desc: "粉蓝赛璐璐",
    swatches: ["#fff5fb", "#ff6fae", "#6c63ff"],
  },
  {
    id: "cyber",
    label: "夜读",
    desc: "赛博深色",
    swatches: ["#090b14", "#36e2ff", "#ff4fd8"],
  },
  {
    id: "study",
    label: "书房",
    desc: "暖纸藏书",
    swatches: ["#f6efe2", "#7a5132", "#b75342"],
  },
  {
    id: "focus",
    label: "专注",
    desc: "极简低扰",
    swatches: ["#f5f7f8", "#2d6cdf", "#2f7d61"],
  },
];

const THEME_KEY = "brain.portal.theme";
const THEME_IDS = new Set(THEMES.map((theme) => theme.id));

export function normalizeThemeId(id) {
  return THEME_IDS.has(id) ? id : DEFAULT_THEME_ID;
}

export function getSavedThemeId() {
  try {
    return normalizeThemeId(localStorage.getItem(THEME_KEY));
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export function applyTheme(id) {
  const next = normalizeThemeId(id);
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = next;
  }
  return next;
}

export function saveTheme(id) {
  const next = applyTheme(id);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {}
  return next;
}

export function initTheme() {
  return applyTheme(getSavedThemeId());
}
