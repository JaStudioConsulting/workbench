import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const consoleRoot = new URL("../", import.meta.url);
const publicRoot = new URL("../public/", import.meta.url);

function readPngDimensions(buffer) {
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual(buffer.subarray(0, 8), pngSignature, "PNG file must start with a valid PNG signature");
  const chunkType = buffer.subarray(12, 16).toString("ascii");
  assert.equal(chunkType, "IHDR", "First PNG chunk must be IHDR");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

test("console HTML entry includes manifest, Apple touch icon, and iPad standalone metadata", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.match(html, /<meta\s+name="viewport"\s+content="[^"]*viewport-fit=cover[^"]*"\s*\/>/);
  assert.match(html, /<meta\s+name="theme-color"\s+content="#273c30"\s*\/>/);
  assert.match(html, /<meta\s+name="mobile-web-app-capable"\s+content="yes"\s*\/>/);
  assert.match(html, /<meta\s+name="apple-mobile-web-app-capable"\s+content="yes"\s*\/>/);
  assert.match(html, /<meta\s+name="apple-mobile-web-app-status-bar-style"\s+content="default"\s*\/>/);
  assert.match(html, /<meta\s+name="apple-mobile-web-app-title"\s+content="JA Workbench"\s*\/>/);
  assert.match(html, /<link\s+rel="manifest"\s+href="\/manifest\.webmanifest"\s*\/>/);
  assert.match(html, /<link\s+rel="apple-touch-icon"\s+href="\/icons\/apple-touch-icon\.png"\s+sizes="180x180"\s*\/>/);
  assert.match(html, /<link\s+rel="icon"\s+href="\/icons\/workbench-icon\.svg"\s+type="image\/svg\+xml"\s*\/>/);
  assert.match(html, /<link\s+rel="icon"\s+href="\/icons\/workbench-icon-192\.png"\s+type="image\/png"\s+sizes="192x192"\s*\/>/);

  const localRefs = [...html.matchAll(/\b(?:href|src)="(\/[^"]+)"/g)].map((match) => match[1]);
  assert.ok(localRefs.length >= 5, "Expected manifest, icons, and script local references in index.html");

  for (const ref of localRefs) {
    const relativePath = ref.slice(1);
    const targetUrl = relativePath.startsWith("src/")
      ? new URL(relativePath, consoleRoot)
      : new URL(relativePath, publicRoot);
    await access(targetUrl);
  }
});

test("web app manifest defines standalone full-screen config matching Workbench theme and valid local icons", async () => {
  const [manifestRaw, stylesCss] = await Promise.all([
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  ]);

  const manifest = JSON.parse(manifestRaw);

  assert.equal(manifest.id, "/");
  assert.equal(manifest.short_name, "JA Workbench");
  assert.match(manifest.name, /Recruiting Workbench/);
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.background_color, "#faf7f2");
  assert.equal(manifest.theme_color, "#273c30");
  assert.match(stylesCss, /--bg:\s*#faf7f2/i);
  assert.match(stylesCss, /--forest:\s*#273c30/i);

  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 4);

  const purposes = new Set(manifest.icons.map((icon) => icon.purpose));
  assert.ok(purposes.has("any"), "Manifest must include standard any-purpose icons");
  assert.ok(purposes.has("maskable"), "Manifest must include a maskable icon entry");

  const declaredSizes = new Set(manifest.icons.map((icon) => icon.sizes));
  for (const requiredSize of ["any", "180x180", "192x192", "512x512"]) {
    assert.ok(declaredSizes.has(requiredSize), `Manifest icons must include size ${requiredSize}`);
  }

  for (const icon of manifest.icons) {
    assert.match(icon.src, /^\/icons\/[a-z0-9.-]+\.(?:svg|png)$/);
    const iconUrl = new URL(icon.src.slice(1), publicRoot);
    const buffer = await readFile(iconUrl);

    if (icon.type === "image/png") {
      const [expectedWidth, expectedHeight] = icon.sizes.split("x").map(Number);
      const { width, height } = readPngDimensions(buffer);
      assert.equal(width, expectedWidth, `${icon.src} width must match declared size`);
      assert.equal(height, expectedHeight, `${icon.src} height must match declared size`);
    } else if (icon.type === "image/svg+xml") {
      const svg = buffer.toString("utf8");
      assert.match(svg, /<svg[^>]+viewBox="0 0 512 512"/);
      assert.match(svg, /#213328/i);
      assert.match(svg, /#273c30/i);
      assert.match(svg, /#d9c38d/i);
      assert.doesNotMatch(svg, /purple|violet|indigo|#[89a-f][0-9a-f][0-5][0-9a-f][89a-f][0-9a-f]/i);
      assert.doesNotMatch(svg, /https?:\/\/(?!www\.w3\.org\/2000\/svg\b)/i);
    } else {
      assert.fail(`Unexpected icon media type: ${icon.type}`);
    }
  }
});

test("console does not register a service worker or cache private recruiting data offline", async () => {
  const [html, mainJsx, appJsx] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/main.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
  ]);
  const combined = `${html}\n${mainJsx}\n${appJsx}`;
  assert.doesNotMatch(combined, /serviceWorker|caches\.open|CacheStorage/i);
  await assert.rejects(access(new URL("../public/sw.js", import.meta.url)));
  await assert.rejects(access(new URL("../public/service-worker.js", import.meta.url)));
});
