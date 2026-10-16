import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "playwright";
const root = fileURLToPath(new URL("..", import.meta.url));
const probe = net.createServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["serve.mjs"], {
  cwd: root,
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let started = false;
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(origin)).ok) {
      started = true;
      break;
    }
  } catch {}
  await pause(50);
}
if (!started) {
  server.kill();
  throw Error("Preview server did not start");
}
const engines = { chromium, firefox, webkit };
try {
  for (const name of (process.env.BROWSERS ?? "chromium,firefox,webkit").split(
    ",",
  )) {
    assert.ok(engines[name], `Unknown browser ${name}`);
    const browser = await engines[name].launch({
      headless: true,
      ...(name === "chromium" && process.env.CHROME_PATH
        ? { executablePath: process.env.CHROME_PATH }
        : {}),
    });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (dialog) => dialog.accept());
    try {
      await page.goto(origin);
      await page.locator("#landing-new").waitFor();
      await page.locator("#landing-new").click();
      assert.equal(await page.locator("#sample-count").textContent(), "0");
      assert.equal(
        await page.locator(".remove-sample-button").isVisible(),
        false,
      );
      await page.locator("#load-kind").selectOption("example");
      await page.waitForFunction(
        () => document.querySelector("#sample-count").textContent === "16",
      );
      const size = await page
        .locator("#sample-grid")
        .evaluate((e) => [
          e.getBoundingClientRect().width,
          document.querySelector("#table-wrap").clientWidth,
        ]);
      assert.ok(size[0] >= size[1] - 1);
      assert.match(await page.locator("#table-head").textContent(), /Sample/);
      await page.locator("#enable-audio").click();
      await page.locator(".row-preview").first().click();
      await page.waitForFunction(
        () =>
          Number(
            document
              .querySelector("#output-meter")
              .parentElement.getAttribute("aria-valuenow"),
          ) > -60,
      );
      await page.locator("#panic").click();
      await page.locator("#master-knob").focus();
      await page.keyboard.press("Home");
      assert.equal(await page.locator("#master").inputValue(), "0");
      await page.keyboard.press("End");
      const downloadEvent = page.waitForEvent("download");
      await page.locator("#save-kind").selectOption("bank");
      const download = await downloadEvent;
      assert.match(download.suggestedFilename(), /\.zip$/i);
      await page.waitForFunction(
        () =>
          document.querySelector("#save-status").textContent ===
          "Saved on this device",
      );
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
      await page.reload();
      await page.waitForFunction(
        () => document.querySelector("#sample-count").textContent === "16",
      );
      assert.deepEqual(errors, []);
      console.log(
        `${name}: landing, generated kit, WASM playback, layout, Master, bank ZIP and recovery passed`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
