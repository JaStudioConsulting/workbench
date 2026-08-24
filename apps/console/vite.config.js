import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const gateway = process.env.VITE_GATEWAY_URL;
export default defineConfig({
  plugins: [react()],
  server: gateway ? { proxy: { "/api": { target: gateway, changeOrigin: true }, "/mcp": { target: gateway, changeOrigin: true } } } : undefined,
});
