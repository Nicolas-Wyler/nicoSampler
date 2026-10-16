// Maintainer integration test. Node/Playwright are never needed by portable end users.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "nico-launcher-"));
const platform = process.platform === "win32" ? "windows" : process.platform,
  arch = process.arch === "x64" ? "amd64" : process.arch;
const executable = path.join(
  root,
  "portable",
  "bin",
  `${platform}-${arch}`,
  "nicoSampler-server" + (platform === "windows" ? ".exe" : ""),
);
await fs.writeFile(
  path.join(fixture, "index.html"),
  `<!doctype html><title>Launcher fixture</title><body>nicoSampler launcher fixture<script type="module">await WebAssembly.compile(await(await fetch('/engine.wasm')).arrayBuffer());document.body.dataset.wasm='ready';await navigator.serviceWorker.register('/sw.js');</script>`,
);
await fs.writeFile(
  path.join(fixture, "engine.wasm"),
  new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
);
await fs.writeFile(
  path.join(fixture, "sw.js"),
  `self.addEventListener('install',e=>{e.waitUntil(caches.open('fixture').then(c=>c.addAll(['/','/engine.wasm'])));self.skipWaiting()});self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(e.request.method==='GET')e.respondWith(caches.match(e.request).then(x=>x||fetch(e.request)))});`,
);
const child = spawn(
  executable,
  ["--app", fixture, "--port", "0", "--no-open"],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let output = "";
child.stdout.on("data", (chunk) => (output += chunk));
child.stderr.on("data", (chunk) => (output += chunk));
let browser;
try {
  const start = Date.now();
  while (!output.includes("Launcher controls:")) {
    if (Date.now() - start > 10000)
      throw Error("Server startup timed out: " + output);
    await new Promise((r) => setTimeout(r, 20));
  }
  const address = output.match(/^URL: (.+)$/m)[1],
    control = output.match(/^Launcher controls: (.+)$/m)[1],
    origin = new URL(address).origin;
  assert.equal(new URL(address).hostname, "127.0.0.1");
  assert.equal(
    (await fetch(address + "engine.wasm")).headers.get("content-type"),
    "application/wasm",
  );
  assert.equal(
    (await fetch(address + "sw.js")).headers.get("service-worker-allowed"),
    "/",
  );
  assert.equal(
    (await fetch(address, { headers: { Origin: "https://attacker.example" } }))
      .status,
    403,
  );
  const token = new URL(control).searchParams.get("token");
  assert.equal(
    (
      await fetch(address + "__launcher/stop", {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "token=wrong",
      })
    ).status,
    403,
  );
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : {}),
  });
  const context = await browser.newContext(),
    page = await context.newPage();
  await page.goto(address);
  await page.waitForFunction(() => document.body.dataset.wasm === "ready");
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.wasm === "ready");
  await context.setOffline(false);
  assert.equal((await fetch(control)).status, 200);
  const second = spawn(
    executable,
    ["--app", fixture, "--port", String(new URL(address).port), "--no-open"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let secondOutput = "";
  second.stdout.on("data", (chunk) => (secondOutput += chunk));
  second.stderr.on("data", (chunk) => (secondOutput += chunk));
  const secondCode = await new Promise((resolve) =>
    second.once("exit", resolve),
  );
  assert.equal(secondCode, 0);
  assert(secondOutput.includes("Reusing the existing nicoSampler"));
  assert(secondOutput.includes("URL: " + address));
  assert.equal((await fetch(address)).status, 200);

  const stopped = new Promise((resolve) => child.once("exit", resolve));
  assert.equal(
    (
      await fetch(address + "__launcher/stop", {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ token }),
      })
    ).status,
    200,
  );
  assert.equal(await stopped, 0);
  const report = {
    native: `${platform}/${arch}`,
    loopback: true,
    reusedSameOrigin: true,
    wasmCompiledInBrowser: true,
    serviceWorkerOfflineReload: true,
    originProtection: true,
    invalidStopTokenRejected: true,
    authorizedStopExitCode: 0,
  };
  await fs.mkdir(path.join(root, "artifacts"), { recursive: true });
  await fs.writeFile(
    path.join(root, "artifacts", "portable-launcher.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  if (child.exitCode == null) child.kill("SIGTERM");
  await fs.rm(fixture, { recursive: true, force: true });
}
