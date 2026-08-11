const BASE = "http://127.0.0.1:27123";
const KEY_STORAGE = "brain.obsidianKey";

function keyStore() {
  return typeof sessionStorage === "undefined" ? null : sessionStorage;
}

export function getKey() { return keyStore()?.getItem(KEY_STORAGE) || ""; }
export function setKey(k) {
  keyStore()?.setItem(KEY_STORAGE, k.trim());
  if (typeof window !== "undefined") window.dispatchEvent(new Event("brain-obsidian-key-changed"));
}
export function clearKey() {
  keyStore()?.removeItem(KEY_STORAGE);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("brain-obsidian-key-changed"));
}
export function hasKey() { return !!getKey(); }

function headers(extra) {
  return Object.assign({ Authorization: "Bearer " + getKey() }, extra || {});
}
function encPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

export async function portalFetch(url, options = {}) {
  const r = await fetch(url, { ...options, credentials: "same-origin" });
  if (r.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new Event("brain-portal-session-expired"));
  }
  return r;
}

export async function verifyPortalSession() {
  const r = await fetch("/portal/session", { cache: "no-store", credentials: "same-origin" });
  return r.ok;
}

export async function openPortalSession(token) {
  const r = await fetch("/portal/session", {
    cache: "no-store",
    credentials: "same-origin",
    headers: { "X-Brain-Portal-Token": token.trim() },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || "访问口令无效");
  return j;
}

// 返回 { reachable, authed }：根端点公开，仅能证明可达；鉴权须验数据端点。
export async function ping() {
  try {
    const r1 = await fetch(BASE + "/", { headers: headers() });
    if (r1.status !== 200) return { reachable: false, authed: false };
    const r2 = await fetch(BASE + "/vault/", { headers: headers() });
    return { reachable: true, authed: r2.status === 200 };
  } catch {
    return { reachable: false, authed: false };
  }
}

// 单层目录列表（插件原生行为：仅返回直接子项，目录带 / 后缀）
export async function vaultList() {
  const r = await fetch(BASE + "/vault/", { headers: headers() });
  if (!r.ok) throw new Error("列表失败 " + r.status);
  const j = await r.json();
  return j.files || [];
}

// 五区并行递归遍历，仅收 .md，跳过二进制重灾区；返回相对路径数组
export async function vaultListMd(onProgress) {
  const zones = ["01-收件箱", "02-项目", "03-资源", "04-领域", "05-日记"];
  const skip = new Set([".obsidian", ".trash", ".git", "电子图书馆"]);
  const files = [];
  const queue = zones.slice();
  let inFlight = 0, done = 0;
  const limit = 12;
  await new Promise((resolve, reject) => {
    function pump() {
      while (queue.length && inFlight < limit) {
        const dir = queue.shift();
        inFlight++;
        fetch(BASE + "/vault/" + encPath(dir) + "/", { headers: headers() })
          .then((r) => (r.ok ? r.json() : { files: [] }))
          .then((j) => {
            for (const e of j.files || []) {
              if (e.endsWith("/")) {
                const seg = e.slice(0, -1);
                if (!skip.has(seg)) queue.push(dir + "/" + seg);
              } else if (e.toLowerCase().endsWith(".md")) {
                files.push(dir + "/" + e);
              }
            }
          })
          .catch(() => {})
          .finally(() => {
            inFlight--;
            done++;
            if (onProgress) onProgress(done);
            if (!queue.length && inFlight === 0) resolve();
            else pump();
          });
      }
      if (!queue.length && inFlight === 0) resolve();
    }
    pump();
  });
  return files;
}

export async function readNote(path) {
  const r = await fetch(BASE + "/vault/" + encPath(path), { headers: headers() });
  if (r.status === 404) return { exists: false, content: "", etag: null };
  if (!r.ok) throw new Error("读取失败 " + r.status);
  const etag = r.headers.get("etag");
  let content;
  const ct = r.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    const j = await r.json();
    content = j.content != null ? j.content : JSON.stringify(j);
  } else {
    content = await r.text();
  }
  return { exists: true, content, etag };
}

export async function writeNote(path, content, etag) {
  const h = headers({ "Content-Type": "text/markdown" });
  if (etag) h["If-Match"] = etag;
  const r = await fetch(BASE + "/vault/" + encPath(path), { method: "PUT", headers: h, body: content });
  return { ok: r.ok || r.status === 204, status: r.status };
}

const normNL = (s) => (s || "").replace(/\r\n/g, "\n");

async function withPathLock(path, job) {
  const locks = typeof navigator === "undefined" ? null : navigator.locks;
  // 多个门户标签页可序列化同一路径的“读-比对-写/删”临界区；不支持 Web Locks 时保持原有兼容路径。
  if (locks?.request) return locks.request("brain-vault:" + path, { mode: "exclusive" }, job);
  return job();
}

// 客户端冲突保护：插件 PUT 不实现 If-Match（仅 PATCH 引擎支持 ifMatch），
// 故写入前先读最新内容，与编辑基线比对；外部有改动则返回 409 由页面处理。
export async function safeWrite(path, content, baseContent) {
  return withPathLock(path, async () => {
    const fresh = await readNote(path);
    if (
      baseContent != null &&
      fresh.exists &&
      normNL(fresh.content) !== normNL(baseContent) &&
      normNL(fresh.content) !== normNL(content)
    ) {
      return { ok: false, status: 409, fresh };
    }
    const r = await writeNote(path, content, null);
    if (r.ok) {
      const after = await readNote(path);
      return { ok: true, status: r.status, fresh: after };
    }
    return r;
  });
}

// 删除同样需要并发保护：先确认读取基线仍是最新，再调用插件默认的“移入废纸篓”。
export async function safeDeleteNote(path, baseContent) {
  return withPathLock(path, async () => {
    const fresh = await readNote(path);
    if (!fresh.exists) return { ok: true, status: 404, fresh };
    if (baseContent != null && normNL(fresh.content) !== normNL(baseContent)) {
      return { ok: false, status: 409, fresh };
    }
    const r = await fetch(BASE + "/vault/" + encPath(path), { method: "DELETE", headers: headers() });
    return { ok: r.ok || r.status === 204, status: r.status, fresh };
  });
}

export async function searchSimple(q) {
  const r = await fetch(BASE + "/search/simple/?query=" + encodeURIComponent(q) + "&contextLength=180",
    { method: "POST", headers: headers() });
  if (!r.ok) throw new Error("搜索失败 " + r.status);
  return await r.json();
}

export async function fetchJson(url) {
  const r = await portalFetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("读取缓存失败 " + r.status);
  return await r.json();
}

export async function rebuildPortalIndex() {
  const r = await portalFetch("/rebuild", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || "索引刷新失败 " + r.status);
  return j;
}
