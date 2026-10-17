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
const port = Number(process.env.PREVIEW_PORT) || 0;
// Scale only an outer presentation frame; the app keeps its phone-sized viewport.
const previewShell = (
  viewport,
  orientation,
) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${model} ${orientation} · nicoSampler preview</title><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#292929;color:#ddd;font:13px Helvetica,Arial,sans-serif}
body{display:flex;flex-direction:column;align-items:center;padding:12px;gap:10px}header{flex:none;text-align:center;line-height:1.5}#frame{position:relative;flex:none;outline:2px solid #969696;background:#151b17;box-shadow:0 4px 20px #0008}iframe{display:block;border:0;width:${viewport.width}px;height:${viewport.height}px;transform-origin:top left}
</style></head><body><header>${model} ${orientation} · ${viewport.width} × ${viewport.height} CSS px<br><span id="scale"></span> · local WebKit layout preview</header><div id="frame"><iframe title="iPhone sampler preview" src="/" allow="microphone; midi; clipboard-read; clipboard-write"></iframe></div><script>
const frame=document.querySelector('#frame'),phone=document.querySelector('iframe');
function fit(){const s=Math.max(.1,Math.min(.7,(innerWidth-32)/${viewport.width},(innerHeight-document.querySelector('header').offsetHeight-38)/${viewport.height}));frame.style.width=(${viewport.width}*s)+'px';frame.style.height=(${viewport.height}*s)+'px';phone.style.transform='scale('+s+')';document.querySelector('#scale').textContent=Math.round(s*100)+'% display scale';}
addEventListener('resize',fit);fit();</script></body></html>`;
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
    if (new URL(req.url, "http://localhost").pathname === "/__phone-preview") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      const landscape =
        new URL(req.url, "http://localhost").searchParams.get("orientation") ===
        "landscape";
      const view = landscape
        ? { width: viewport.height, height: viewport.width }
        : viewport;
      res.end(previewShell(view, landscape ? "landscape" : "portrait"));
      return;
    }
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
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, "127.0.0.1", resolve);
});
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await webkit.launch({
  headless: process.env.PREVIEW_HEADLESS === "1",
});
const previews = [];
for (const orientation of ["portrait", "landscape"]) {
  const view =
    orientation === "portrait"
      ? viewport
      : { width: viewport.height, height: viewport.width };
  const context = await browser.newContext({
    ...devices[model],
    screen: view,
    viewport:
      orientation === "portrait"
        ? { width: 520, height: 700 }
        : { width: 760, height: 430 },
  });
  const page = await context.newPage();
  await page.goto(`${origin}/__phone-preview?orientation=${orientation}`);
  const phone = page.frames().find((frame) => frame.parentFrame());
  if (!phone) throw Error("Phone preview frame did not load");
  previews.push({ page, phone, view, orientation });
  console.log(
    `Local ${model} ${orientation}: fixed ${view.width}×${view.height} CSS viewport; scaled display, WebKit + touch.`,
  );
}
console.log("Close both windows or press Ctrl+C to stop.");
let remaining = previews.length;
for (const { page } of previews)
  page.on("close", () => {
    if (--remaining === 0) void close();
  });
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await browser.close();
  server.close();
}
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
browser.on("disconnected", () => server.close());
if (process.env.PREVIEW_HEADLESS === "1") {
  for (const { page, phone, view, orientation } of previews) {
    await phone.waitForFunction(() =>
      document.querySelector("[data-app-version]").textContent.startsWith("v"),
    );
    await phone.evaluate(() => {
      window.previewTouchReceived = false;
      document.addEventListener(
        "touchstart",
        () => {
          window.previewTouchReceived = true;
        },
        { once: true },
      );
    });
    const frameBox = await page.locator("iframe").boundingBox();
    await page.touchscreen.tap(frameBox.x + 5, frameBox.y + 5);
    const result = await phone.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      touch: window.previewTouchReceived,
      coarse: matchMedia("(pointer:coarse)").matches,
      version: document.querySelector("[data-app-version]").textContent,
    }));
    const shell = await page.evaluate(() => {
      const r = document.querySelector("#frame").getBoundingClientRect();
      return {
        fits:
          r.left >= 0 &&
          r.top >= 0 &&
          r.right <= innerWidth &&
          r.bottom <= innerHeight,
        outline: getComputedStyle(document.querySelector("#frame"))
          .outlineWidth,
      };
    });
    console.log(JSON.stringify({ orientation, ...result, ...shell }));
    if (
      result.width !== view.width ||
      result.height !== view.height ||
      !result.touch ||
      !result.coarse ||
      !shell.fits ||
      shell.outline !== "2px"
    )
      throw Error("Invalid iPhone preview configuration");
  }
  await close();
}
