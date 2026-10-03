import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

const projectRoot = path.resolve(import.meta.dirname);
const webRoot = path.resolve(projectRoot, "vendor", "web");

export default defineConfig({
  root: path.join(projectRoot, "tauri-ui"),
  publicDir: path.join(projectRoot, "public"),
  plugins: [react()],
  css: {
    postcss: path.join(webRoot, "postcss.config.cjs"),
  },
  resolve: {
    alias: {
      "@": projectRoot,
      "maplibre-gl": path.join(webRoot, "node_modules", "maplibre-gl"),
      "pmtiles": path.join(webRoot, "node_modules", "pmtiles"),
    },
    dedupe: ["react", "react-dom"],
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    fs: {
      allow: [projectRoot, webRoot],
    },
  },
  build: {
    outDir: path.join(projectRoot, "dist-tauri"),
    emptyOutDir: true,
    sourcemap: false,
  },
});
