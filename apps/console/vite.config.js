import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
const gateway = process.env.VITE_GATEWAY_URL;
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        resumeBrander: fileURLToPath(new URL("./resume-brander.html", import.meta.url)),
      },
    },
  },
  server: gateway ? { proxy: { "/api": { target: gateway, changeOrigin: true }, "/mcp": { target: gateway, changeOrigin: true } } } : undefined,
});
