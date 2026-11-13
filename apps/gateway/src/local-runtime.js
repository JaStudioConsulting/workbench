import express from "express";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { createApp } from "../app.js";

export async function mountConsoleDist(app, { distDir }) {
  const absoluteDist = resolve(distDir);
  const indexPath = resolve(absoluteDist, "index.html");
  await access(indexPath);

  app.use(express.static(absoluteDist, { index: "index.html", fallthrough: true }));
  app.get("*", (req, res, next) => {
    if (req.path === "/mcp" || req.path.startsWith("/api/")) return next();
    if (!req.accepts("html")) return next();
    return res.sendFile(indexPath, (error) => error ? next(error) : undefined);
  });
  app.use("/api", (_req, res) => res.status(404).json({
    error: { code: "NOT_FOUND", message: "API route not found" },
  }));
  return app;
}

export async function createLocalRuntimeApp({ distDir, ...gatewayOptions } = {}) {
  if (!distDir) throw new Error("Console dist directory is required");
  return mountConsoleDist(await createApp(gatewayOptions), { distDir });
}
