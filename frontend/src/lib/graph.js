export function toGraphData(cache, opts) {
  opts = opts || {};
  const folderFilter = opts.folders && opts.folders.length ? new Set(opts.folders) : null;
  let nodes = cache.nodes || [];
  if (folderFilter) nodes = nodes.filter((n) => folderFilter.has(n.folder));
  const maxDocs = opts.maxDocs || 400;
  const sorted = [...nodes].sort((a, b) => (b.mtime || 0) - (a.mtime || 0)).slice(0, maxDocs);
  const ids = new Set(sorted.map((n) => n.id));
  const iso = (t) => new Date((t || 0) * 1000).toISOString();
  const documents = sorted.map((n) => {
    const rel = {};
    for (const e of cache.edges || []) {
      if (e.s === n.id && ids.has(e.t)) rel["m:" + e.t] = "derives";
    }
    return {
      id: n.id,
      title: n.title,
      summary: n.summary || n.title,
      documentType: n.folder,
      createdAt: iso(n.ctime),
      updatedAt: iso(n.mtime),
      memories: [{
        id: "m:" + n.id, memory: n.title, content: n.summary || n.title,
        createdAt: iso(n.ctime), updatedAt: iso(n.mtime), spaceId: "vault",
        isStatic: false, isLatest: true, isForgotten: false,
        forgetAfter: null, forgetReason: null, version: 1,
        parentMemoryId: null, rootMemoryId: null, memoryRelations: rel,
      }],
    };
  });
  return { documents, total: nodes.length, shown: sorted.length };
}

export const FOLDER_COLORS = {
  "01-收件箱": "#8399af",
  "02-项目": "#d9a441",
  "03-资源": "#5f8fd4",
  "04-领域": "#63ae72",
  "05-日记": "#c9708e",
  "06-工作文档": "#77828e",
};