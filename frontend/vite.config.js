import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendDir = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(frontendDir, "../www");

function pruneSupersededBundles() {
  let currentBundleFiles = new Set();
  return {
    name: "prune-superseded-portal-bundles",
    generateBundle(_, bundle) {
      currentBundleFiles = new Set(Object.keys(bundle)
        .filter((file) => file.startsWith("assets/"))
        .map((file) => path.basename(file)));
    },
    closeBundle() {
      const assets = path.join(outputDir, "assets");
      if (!fs.existsSync(assets)) return;
      for (const name of fs.readdirSync(assets)) {
        // 只清理由 Vite 生成且已有新版本的 JS/CSS，不触碰部署目录中的其他资源。
        if (/^(?:index|ocr|src)-[A-Za-z0-9_-]+\.(?:js|css)$/.test(name) && !currentBundleFiles.has(name)) {
          fs.rmSync(path.join(assets, name), { force: true });
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), pruneSupersededBundles()],
  build: { outDir: "../www", emptyOutDir: false, chunkSizeWarningLimit: 2500 },
  resolve: {
    dedupe: ["react", "react-dom"],
    // 内置的本地图谱组件位于前端依赖树之外；显式指向门户已锁定的运行依赖。
    alias: { "d3-force": path.join(frontendDir, "node_modules", "d3-force", "src", "index.js") },
  },
  optimizeDeps: {
    include: ["@supermemory/memory-graph"],
  },
  server: { port: 5173 },
});
