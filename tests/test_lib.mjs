// L1 单元测试：前端纯函数。运行：node test_lib.mjs
import assert from "node:assert/strict";
import { parseKanban, serializeKanban, moveCard, dueDate } from "../frontend/src/lib/kanban.js";
import { appendToSection, fillTemplate, buildTree, preprocessWikilinks, todayStr, cnDate, relTime, recentDateRange, isValidIsoDate } from "../frontend/src/lib/vault.js";
import { toGraphData } from "../frontend/src/lib/graph.js";
import { safeDeleteNote } from "../frontend/src/lib/api.js";

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  通过 " + name); }
  catch (e) { fail++; console.log("  失败 " + name + " :: " + e.message); }
}

const BOARD = "---\nkanban-plugin: basic\n---\n\n## 收件箱\n\n- [ ] 甲\n- [x] 乙\n\n## 今日\n\n- [ ] 丙 📅 2026-08-01\n\n## 已完成\n\n";

console.log("L1 单元测试");

t("U01 parseKanban 解析", () => {
  const b = parseKanban(BOARD);
  assert.equal(b.frontmatter, "---\nkanban-plugin: basic\n---");
  assert.deepEqual(b.sections.map((s) => s.name), ["收件箱", "今日", "已完成"]);
  assert.equal(b.sections[0].cards.length, 2);
  assert.equal(b.sections[0].cards[1].done, true);
  assert.equal(b.sections[1].cards[0].done, false);
});

t("U02 serialize 语义往返", () => {
  const once = parseKanban(BOARD);
  const twice = parseKanban(serializeKanban(once));
  assert.deepEqual(
    twice.sections.map((s) => ({ name: s.name, cards: s.cards })),
    once.sections.map((s) => ({ name: s.name, cards: s.cards }))
  );
});

t("U03 moveCard 跨列", () => {
  const b = structuredClone(parseKanban(BOARD));
  moveCard(b, "收件箱", 0, "今日", 0);
  assert.equal(b.sections[0].cards.length, 1);
  assert.equal(b.sections[1].cards.length, 2);
  assert.equal(b.sections[1].cards[0].text, "甲");
});

t("U04 moveCard 同列下移等价 arrayMove", () => {
  const b = parseKanban("---\nkanban-plugin: basic\n---\n\n## 列\n\n- [ ] a\n- [ ] b\n- [ ] c\n- [ ] d\n");
  moveCard(b, "列", 0, "列", 2);
  assert.deepEqual(b.sections[0].cards.map((c) => c.text), ["b", "c", "a", "d"]);
});

t("U04b moveCard 同列上移", () => {
  const b = parseKanban("---\nkanban-plugin: basic\n---\n\n## 列\n\n- [ ] a\n- [ ] b\n- [ ] c\n- [ ] d\n");
  moveCard(b, "列", 2, "列", 0);
  assert.deepEqual(b.sections[0].cards.map((c) => c.text), ["c", "a", "b", "d"]);
});

t("U05 dueDate", () => {
  assert.equal(dueDate("丙 📅 2026-08-01"), "2026-08-01");
  assert.equal(dueDate("无日期"), null);
});

t("U05b 看板嵌套说明保真", () => {
  const src = "## 列\n\n- [ ] 甲\n  - 子任务\n  - 说明文字\n\n- [ ] 乙\n";
  const out = serializeKanban(parseKanban(src));
  assert.match(out, /- \[ \] 甲\n  - 子任务\n  - 说明文字\n\n- \[ \] 乙/, "嵌套说明必须仍依附于原卡片");
  assert.equal(parseKanban(out).sections[0].cards[0].body.join("\n"), "  - 子任务\n  - 说明文字\n", "往返后嵌套内容不应丢失");
});

t("U05c 看板自由文本随卡片迁移", () => {
  const src = "## 待办\n\n- [ ] 甲\n\n这是甲的补充说明。\n\n- [ ] 乙\n\n## 完成\n\n";
  const b = parseKanban(src);
  moveCard(b, "待办", 0, "完成", 0);
  const out = serializeKanban(b);
  const again = parseKanban(out);
  assert.match(out, /## 完成\n+\- \[ \] 甲\n+这是甲的补充说明。/, "无缩进自由文本必须和所属卡片一起移动");
  assert.match(again.sections[1].cards[0].body.join("\n"), /这是甲的补充说明。/, "往返后自由文本不应错位或丢失");
});

t("U06 appendToSection 已有节", () => {
  const out = appendToSection("# t\n\n## 今日目标\n\n- [ ] 旧\n", "今日目标", "- [ ] 新");
  assert.match(out, /## 今日目标\n\n- \[ \] 新\n- \[ \] 旧/);
});

t("U07 appendToSection 缺失节", () => {
  const out = appendToSection("# t\n\n## 其他\n", "今日总结", "> 一句话");
  assert.match(out, /## 今日总结\n\n> 一句话\n$/);
});

t("U08 fillTemplate 替换", () => {
  const out = fillTemplate("# {{date:YYYY-MM-DD}} {{title}}\n{{date}}", "2026-07-31");
  assert.equal(out.includes("{{"), false);
  assert.match(out, /# 2026-07-31 周五/);
});

t("U09 buildTree", () => {
  const tree = buildTree(["01-收件箱/a.md", "01-收件箱/子/b.md", "根.md"]);
  assert.equal(tree.files.length, 1);
  assert.equal(tree.dirs["01-收件箱"].files.length, 1);
  assert.equal(tree.dirs["01-收件箱"].dirs["子"].files[0].path, "01-收件箱/子/b.md");
});

t("U10 preprocessWikilinks", () => {
  const out = preprocessWikilinks("见[[笔记甲]]与[[笔记乙#节|别名]]。");
  assert.match(out, /\[笔记甲\]\(#\/wiki\/[^)]+\)/);
  assert.match(out, /\[笔记乙\]\(#\/wiki\/[^)]+\)/);
  assert.equal(out.includes("[["), false);
});

t("U11 toGraphData 过滤与上限", () => {
  const cache = {
    nodes: [
      { id: "01-收件箱/a.md", title: "a", folder: "01-收件箱", ctime: 1, mtime: 10, summary: "sa" },
      { id: "02-项目/b.md", title: "b", folder: "02-项目", ctime: 2, mtime: 20, summary: "sb" },
      { id: "02-项目/c.md", title: "c", folder: "02-项目", ctime: 3, mtime: 30, summary: "sc" },
    ],
    edges: [{ s: "02-项目/b.md", t: "01-收件箱/a.md" }, { s: "02-项目/c.md", t: "02-项目/b.md" }],
  };
  const g = toGraphData(cache, { folders: ["02-项目"], maxDocs: 10 });
  assert.equal(g.documents.length, 2);
  const bDoc = g.documents.find((d) => d.id === "02-项目/b.md");
  assert.equal(bDoc.memories[0].memoryRelations["m:01-收件箱/a.md"], undefined, "指向集合外的边应剔除");
  const cDoc = g.documents.find((d) => d.id === "02-项目/c.md");
  assert.equal(cDoc.memories[0].memoryRelations["m:02-项目/b.md"], "derives");
  const g2 = toGraphData(cache, { maxDocs: 2 });
  assert.equal(g2.documents.length, 2);
  assert.deepEqual(g2.documents.map((d) => d.id).sort(), ["02-项目/b.md", "02-项目/c.md"], "应按 mtime 取最新");
});

t("U12 日期工具", () => {
  assert.match(todayStr(), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(cnDate(new Date("2026-07-31T12:00:00")), /二〇二六年7月31日 · 周五/);
  assert.equal(relTime(new Date(Date.now() - 120000).toISOString()), "2 分钟前");
  assert.equal(relTime(null), "从未");
});

t("U13 连续日期范围", () => {
  assert.deepEqual(
    recentDateRange(3, new Date("2026-08-09T12:00:00")),
    ["2026-08-07", "2026-08-08", "2026-08-09"]
  );
  assert.deepEqual(recentDateRange(0, new Date("2026-08-09T12:00:00")), ["2026-08-09"]);
});

t("U14 ISO 日期校验", () => {
  assert.equal(isValidIsoDate("2026-02-28"), true);
  assert.equal(isValidIsoDate("2026-02-29"), false);
  assert.equal(isValidIsoDate("2026-13-01"), false);
});

async function at(name, fn) {
  try { await fn(); pass++; console.log("  通过 " + name); }
  catch (e) { fail++; console.log("  失败 " + name + " :: " + e.message); }
}

function response(status, body = "") {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (key) => key.toLowerCase() === "content-type" ? "text/markdown" : null },
    text: async () => body,
  };
}

await at("U15 删除先检查并拒绝外部改动", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => "", setItem: () => {} };
  globalThis.fetch = async (url, options = {}) => { calls.push({ url, options }); return response(200, "外部版本"); };
  try {
    const r = await safeDeleteNote("05-日记/2026-08-09.md", "本地旧版本");
    assert.equal(r.status, 409);
    assert.equal(calls.length, 1, "检测到冲突时不得继续发送 DELETE");
  } finally { globalThis.fetch = originalFetch; globalThis.localStorage = originalStorage; }
});

await at("U16 删除默认请求废纸篓而非永久删除", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => "", setItem: () => {} };
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return calls.length === 1 ? response(200, "待删除内容") : response(204);
  };
  try {
    const r = await safeDeleteNote("05-日记/2026-08-09.md", "待删除内容");
    assert.equal(r.ok, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].options.method, "DELETE");
    assert.equal(calls[1].url.includes("permanent"), false);
  } finally { globalThis.fetch = originalFetch; globalThis.localStorage = originalStorage; }
});

await at("U17 同路径删除使用浏览器锁", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  const originalNavigator = globalThis.navigator;
  let lockCalls = 0;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    locks: { request: async (name, options, job) => { lockCalls++; assert.equal(name, "brain-vault:05-日记/2026-08-09.md"); return job(); } },
  } });
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return calls.length === 1 ? response(200, "待删除内容") : response(204);
  };
  try {
    const r = await safeDeleteNote("05-日记/2026-08-09.md", "待删除内容");
    assert.equal(r.ok, true);
    assert.equal(lockCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
  }
});

console.log("\n结果: 通过 " + pass + " / 失败 " + fail);
process.exit(fail ? 1 : 0);
