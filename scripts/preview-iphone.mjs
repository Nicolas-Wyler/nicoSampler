// Maintainer preview only; generated app copies live under ignored artifacts/.
import { webkit, devices } from "playwright";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(
  fileURLToPath(new URL("../artifacts/iphone-preview/app/", import.meta.url)),
);
await fs.access(path.join(root, "index.html"));
const smaller = process.argv.includes("--small");
const model = smaller ? "iPhone 12" : "iPhone 12 Pro Max";
const viewport = smaller
  ? { width: 390, height: 844 }
  : { width: 428, height: 926 };
const port = smaller ? 17872 : 17871;
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".zip": "application/zip",
};
const server = http.createServer(async (req, res) => {
  try {
    const name = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      ),
      file = path.resolve(root, "." + (name === "/" ? "/index.html" : name));
    if (
      !file.startsWith(root + path.sep) &&
      file !== path.join(root, "index.html")
    )
      throw Error("Invalid path");
    res.setHeader(
      "Content-Type",
      types[path.extname(file)] || "application/octet-stream",
    );
    res.setHeader("Cache-Control", "no-store");
    res.end(await fs.readFile(file));
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
const browser = await webkit.launch({
  headless: process.env.PREVIEW_HEADLESS === "1",
});
const context = await browser.newContext({
  ...devices[model],
  viewport,
});
const page = await context.newPage();
await page.goto(`http://127.0.0.1:${port}/`);
console.log(
  `Local ${model} preview: fixed ${viewport.width}×${viewport.height} viewport; WebKit + touch. Close the window or press Ctrl+C to stop.`,
);
async function close() {
  await browser.close();
  server.close();
}
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
browser.on("disconnected", () => server.close());
if (process.env.PREVIEW_HEADLESS === "1") {
  await page.waitForFunction(() =>
    document.querySelector("[data-app-version]").textContent.startsWith("v"),
  );
  await page.evaluate(() => {
    window.previewTouchReceived = false;
    document.addEventListener(
      "touchstart",
      () => {
        window.previewTouchReceived = true;
      },
      { once: true },
    );
  });
  await page.touchscreen.tap(5, 5);
  const result = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    touch: window.previewTouchReceived,
    coarse: matchMedia("(pointer:coarse)").matches,
    version: document.querySelector("[data-app-version]").textContent,
  }));
  console.log(JSON.stringify(result));
  if (
    result.width !== viewport.width ||
    result.height !== viewport.height ||
    !result.touch ||
    !result.coarse
  )
    throw Error("Invalid iPhone preview configuration");
  await close();
}
