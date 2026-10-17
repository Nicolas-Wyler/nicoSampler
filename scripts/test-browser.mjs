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
          document.querySelector("#table-wrap").clientWidth -
            (parseFloat(
              getComputedStyle(document.querySelector("#table-wrap"))
                .paddingRight,
            ) || 0),
        ]);
      assert.ok(size[0] >= size[1] - 1);
      assert.match(await page.locator("#table-head").textContent(), /Sample/);
      // A full kit creates a vertical scrollbar; it must not intercept Level.
      await page.waitForFunction(() => {
        const dial = document.querySelector(
          "#sample-table tr .level-cell .dial",
        );
        if (!dial) return false;
        const r = dial.getBoundingClientRect();
        const hit = document.elementFromPoint(
          r.right - 1,
          r.top + r.height / 2,
        );
        return hit?.closest(".knob") === dial.closest(".knob");
      });
      // The app icon opens the real settings dialog, including at phone widths.
      // Settings UI does not depend on service-worker installation. Keep its
      // asynchronous startup badge from intercepting the icon in this fixture.
      await page.addStyleTag({ content: "#offline-status { display: none !important; }" });
      for (const width of [320, 390, 1150]) {
        await page.setViewportSize({ width, height: 800 });
        await page.locator("#sampler-settings-open").click();
        assert.ok(await page.locator("#sampler-settings").isVisible());
        const fits = await page.locator("#sampler-settings").evaluate(e => {
          const r = e.getBoundingClientRect();
          return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
        });
        assert.ok(fits, `Settings dialog fits ${width}px`);
        await page.locator("#sampler-settings-close").click();
      }
      await page.locator("#sampler-settings-open").click();
      await page.locator("#settings-master").fill("73");
      await page.locator("#settings-master").press("Tab");
      assert.equal(await page.locator("#master").inputValue(), "73");
      await page.locator("#settings-master").fill("101");
      await page.locator("#settings-master").press("Tab");
      assert.equal(await page.locator("#settings-master").inputValue(), "73");
      await page.locator("#settings-input").selectOption("None");
      await page.locator("#settings-channel").selectOption("7");
      await page.locator("#settings-piano").uncheck();
      assert.equal(await page.locator("#input-source").inputValue(), "None");
      assert.equal(await page.locator("#midi-channel").inputValue(), "7");
      assert.equal(await page.locator("#keyboard-fold").getAttribute("aria-expanded"), "false");
      await page.locator("#settings-master").focus();
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#sampler-settings").isVisible(), false);
      // View preferences debounce before autosave; do not accept a stale Saved badge.
      await page.waitForTimeout(250);
      await page.waitForFunction(() => document.querySelector("#save-status").textContent === "Saved on this device");
      await page.reload();
      await page.waitForFunction(() => document.querySelector("#sample-count").textContent === "16");
      await page.addStyleTag({ content: "#offline-status { display: none !important; }" });
      await page.locator("#sampler-settings-open").click();
      assert.equal(await page.locator("#settings-master").inputValue(), "73");
      assert.equal(await page.locator("#settings-input").inputValue(), "None");
      assert.equal(await page.locator("#settings-channel").inputValue(), "7");
      assert.equal(await page.locator("#settings-piano").isChecked(), false);
      await page.locator("#settings-input").selectOption("PC Keyboard");
      await page.locator("#settings-channel").selectOption("All");
      await page.locator("#settings-piano").check();
      await page.locator("#sampler-settings-close").click();
      await page.locator("#enable-audio").click();
      const rowPreview = page.locator(".row-preview").first();
      assert.equal(await rowPreview.locator("svg path").count(), 1);
      assert.equal(await rowPreview.locator("svg").getAttribute("aria-hidden"), "true");
      await rowPreview.click();
      await page.waitForFunction(() => !!document.querySelector(".row-preview svg rect"));
      assert.match(await rowPreview.getAttribute("aria-label"), /Stop/);

      await page.waitForFunction(
        () =>
          Number(
            document
              .querySelector("#output-meter")
              .parentElement.getAttribute("aria-valuenow"),
          ) > -60,
      );
      await rowPreview.click();
      await page.waitForFunction(() => !!document.querySelector(".row-preview svg path"));
      assert.match(await rowPreview.getAttribute("aria-label"), /Play/);
      await page.locator(".row-handle").nth(1).click({ modifiers: ["ControlOrMeta"] });
      assert.equal(await page.locator("#sample-table tr.selected").count(), 2);
      await rowPreview.click();
      await page.waitForFunction(() => document.querySelectorAll("#sample-table tr.selected .row-preview svg rect").length === 2);
      await rowPreview.click();
      await page.waitForFunction(() => document.querySelectorAll("#sample-table tr.selected .row-preview svg path").length === 2);
      await page.locator("#panic").click();
      assert.equal(await page.locator(".row-preview svg path").count(), 16);

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
        `${name}: landing, generated kit, WASM playback, layout, icon settings validation/routing/fold/recovery, Master and bank ZIP passed`,
      );
    } finally {
      await browser.close();
    }
  }
  await new Promise((resolve, reject) => {
    const regression = spawn(
      process.execPath,
      ["tests/midi-highlight-browser.mjs"],
      {
        cwd: root,
        env: {
          ...process.env,
          SAMPLER_URL: origin,
          PLAYWRIGHT_CHROMIUM_EXECUTABLE: process.env.CHROME_PATH ?? "",
        },
        stdio: "inherit",
      },
    );
    regression.once("error", reject);
    regression.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(Error("MIDI highlight regression failed")),
    );
  });
} finally {
  server.kill();
}
