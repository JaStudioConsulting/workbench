import { cloudflare } from "@cloudflare/vite-plugin";
import { sites } from "@openai/sites-vite-plugin";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const repositoryRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(repositoryRoot, "apps/console"),
  plugins: [react(), sites(), cloudflare({ configPath: path.join(repositoryRoot, "wrangler.jsonc") })],
  build: {
    outDir: path.join(repositoryRoot, "dist"),
    emptyOutDir: true,
  },
});
