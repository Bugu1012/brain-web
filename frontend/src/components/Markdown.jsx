import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useNavigate } from "react-router-dom";
import { preprocessWikilinks } from "../lib/vault.js";
import { fetchJson } from "../lib/api.js";

let graphPromise = null;
function loadGraph() {
  if (!graphPromise) graphPromise = fetchJson("cache/graph.json").catch(() => ({ nodes: [] }));
  return graphPromise;
}
export function invalidateGraphCache() { graphPromise = null; }

export default function Markdown({ text }) {
  const nav = useNavigate();
  const src = useMemo(() => preprocessWikilinks(text || ""), [text]);

  async function openWiki(name) {
    const g = await loadGraph();
    const node = (g.nodes || []).find((n) => n.title === name);
    if (node) nav("/browse/" + node.id.split("/").map(encodeURIComponent).join("/"));
    else nav("/search?q=" + encodeURIComponent(name));
  }

  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            if (href && href.startsWith("#/wiki/")) {
              const name = decodeURIComponent(href.slice(7));
              return (
                <a
                  className="wikilink"
                  href={href}
                  onClick={(e) => { e.preventDefault(); openWiki(name); }}
                >
                  {children}
                </a>
              );
            }
            if (href && href.startsWith("#/")) return <a href={href}>{children}</a>;
            return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
          },
        }}
      >
        {src}
      </ReactMarkdown>
    </div>
  );
}