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
    // MIDI permission/discovery must be independent of audio startup.
    const midiPage = await browser.newPage();
    midiPage.on("dialog", dialog => dialog.accept());
    try {
      await midiPage.addInitScript(() => {
        window.midiQA = { calls: [], access: { inputs: new Map() }, notes: [], deny: true };
        midiQA.permission = { state: localStorage.getItem("qa-midi-permission") || "prompt", onchange: null };
        Object.defineProperty(navigator, "permissions", { configurable: true,
          value: { query: async () => midiQA.permission } });
        if (midiQA.permission.state === "granted") midiQA.deny = false;
        const post = MessagePort.prototype.postMessage;
        MessagePort.prototype.postMessage = function (message, ...args) {
          if (message?.type === "on") midiQA.notes.push(message.note);
          return post.call(this, message, ...args);
        };
        Object.defineProperty(navigator, "requestMIDIAccess", {
          configurable: true,
          value: async () => {
            midiQA.calls.push("midi");
            if (midiQA.deny) throw new DOMException("Fixture permission denied", "NotAllowedError");
            return midiQA.access;
          },
        });
        const C = window.AudioContext || window.webkitAudioContext;
        const resume = C.prototype.resume;
        C.prototype.resume = function () {
          midiQA.calls.push("audio");
          return resume.call(this);
        };
      });
      await midiPage.goto(origin);
      await midiPage.addStyleTag({ content: "#offline-status{display:none!important}" });
      await midiPage.locator("#landing-new").click();
      await midiPage.locator("#input-source").selectOption("None", { force: true });
      await midiPage.locator("#connect-midi").click();
      await midiPage.waitForFunction(() => !document.querySelector("#toast").hidden
        && document.querySelector("#toast").textContent.includes("MIDI permission was denied"));
      assert.equal(await midiPage.locator("#input-routing-label").isVisible(), true,
        "Input choices remain accessible even when external MIDI permission is denied");
      assert.equal(await midiPage.locator("#input-source").inputValue(), "None",
        "Permission denial preserves the explicit None routing choice");
      assert.ok(await midiPage.locator('#input-source option[value="PC Keyboard"]').count());
      assert.equal(await midiPage.locator("#connect-midi").textContent(), "Allow MIDI");
      await midiPage.locator("#connect-midi").click();
      await midiPage.waitForFunction(() => document.querySelector("#toast").textContent.includes("site settings"));
      assert.equal(await midiPage.evaluate(() => midiQA.calls.filter(x => x === "midi").length), 1,
        "Denied access shows guidance rather than repeatedly prompting");
      await midiPage.evaluate(() => {
        midiQA.deny = false;
        midiQA.permission.state = "granted";
        localStorage.setItem("qa-midi-permission", "granted");
        midiQA.permission.onchange();
      });
      await midiPage.waitForFunction(() => document.querySelector("#connect-midi").hidden);
      assert.equal(await midiPage.locator("#input-source").inputValue(), "None",
        "Automatic permission acquisition does not change routing");
      assert.equal((await midiPage.evaluate(() => midiQA.calls))[0], "midi",
        "MIDI permission is requested before audio startup");
      await midiPage.evaluate(() => {
        midiQA.access.inputs.set("qa-midi", { id: "qa-midi", name: "QA MIDI", state: "connected" });
        midiQA.access.onstatechange();
      });
      await midiPage.waitForFunction(() => !document.querySelector("#input-routing-label").hidden);
      assert.equal(await midiPage.locator("#connect-midi").isVisible(), false);
      await midiPage.locator("#input-source").selectOption("qa-midi");
      await midiPage.evaluate(() => {
        midiQA.access.inputs.get("qa-midi").state = "disconnected";
        midiQA.access.onstatechange();
      });
      assert.equal(await midiPage.locator("#input-routing-label").isVisible(), true);
      assert.equal(await midiPage.locator("#input-source").inputValue(), "qa-midi",
        "Disconnected external routing remains selected until explicit user choice");
      assert.equal(await midiPage.locator("#connect-midi").isVisible(), false,
        "Granted MIDI access stays connected with zero ports");
      await midiPage.locator("#load-kind").selectOption("example");
      await midiPage.waitForFunction(() => document.querySelector("#sample-count").textContent === "16");
      await midiPage.locator("#input-source").selectOption("qa-midi");
      await midiPage.locator("#load-kind").blur();
      await midiPage.evaluate(() => { midiQA.notes.length = 0; });
      await midiPage.keyboard.press("a");
      await midiPage.waitForTimeout(100);
      assert.equal(await midiPage.evaluate(() => midiQA.notes.length), 0,
        "Disconnected external input does not silently enable PC notes");
      await midiPage.locator("#input-source").selectOption("PC Keyboard");
      await midiPage.locator("#input-source").blur();
      await midiPage.keyboard.down("a");
      await midiPage.waitForFunction(() => midiQA.notes.length > 0);
      await midiPage.waitForFunction(() => Number(document.querySelector("#output-meter")
        .parentElement.getAttribute("aria-valuenow")) > -60);
      await midiPage.keyboard.up("a");
      assert.equal(await midiPage.locator("#midi-channel-label").isVisible(), false);
      await midiPage.waitForTimeout(300);
      await midiPage.waitForFunction(() => document.querySelector("#save-status").textContent.includes("Saved"));
      await midiPage.reload();
      await midiPage.waitForFunction(() => midiQA.calls.includes("midi"));
      assert.equal(await midiPage.evaluate(() => midiQA.calls.includes("audio")), false,
        "Previously granted MIDI reconnects automatically without activating audio");
      assert.equal(await midiPage.locator("#input-source").inputValue(), "PC Keyboard");
      await midiPage.evaluate(() => { midiQA.permission.state = "denied"; midiQA.permission.onchange(); });
      await midiPage.waitForFunction(() => document.querySelector("#connect-midi").textContent === "Allow MIDI");
      console.log(`${name}: MIDI permission lifecycle, PC recovery, hotplug and real typing playback passed`);
    } finally { await midiPage.close(); }
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
      assert.ok(await page.evaluate(() => Math.abs(document.querySelector('#keyboard').getBoundingClientRect().width /
        document.querySelector('#keyboard-scroll').clientWidth - 1) < 0.01),
        'Desktop piano retains the full-range zoom floor');
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
      // Manual Sample widths are authoritative even when the panel has spare room.
      const sampleDivider = page.getByRole("separator", { name: "Resize Sample", exact: true });
      const sampleWidth = () => page.locator("#table-head th").first().evaluate(e => e.getBoundingClientRect().width);
      const naturalSampleWidth = await sampleWidth();
      await sampleDivider.press("ArrowLeft");
      assert.ok(Math.abs(await sampleWidth() - (naturalSampleWidth - 10)) < 1,
        "Sample can shrink below its automatic fill width");
      for (let i = 0; i < 55; i++) await sampleDivider.press("ArrowLeft");
      assert.ok(await sampleWidth() < naturalSampleWidth - 30,
        "Sample can shrink below its natural content width");
      await sampleDivider.dblclick();
      const dividerRect = await sampleDivider.boundingBox();
      await page.mouse.move(dividerRect.x + dividerRect.width / 2, dividerRect.y + dividerRect.height / 2);
      await page.mouse.down();
      await page.mouse.move(dividerRect.x + dividerRect.width / 2 - 50, dividerRect.y + dividerRect.height / 2, { steps: 5 });
      await page.mouse.up();
      assert.ok(Math.abs(await sampleWidth() - (naturalSampleWidth - 50)) < 2,
        "Trusted pointer drag shrinks Sample width");
      await sampleDivider.dblclick();
      assert.ok(Math.abs(await sampleWidth() - naturalSampleWidth) < 2,
        "Reset Sample divider restores automatic fill");
      // The app icon opens the real settings dialog, including at phone widths.
      // Settings UI does not depend on service-worker installation. Keep its
      // asynchronous startup badge from intercepting the icon in this fixture.
      await page.addStyleTag({ content: "#offline-status { display: none !important; }" });
      for (const width of [320, 390, 1150]) {
        await page.setViewportSize({ width, height: 800 });
        await page.waitForTimeout(100);
        const pinned = await page.evaluate(async () => {
          const wrap = document.querySelector("#table-wrap");
          const first = document.querySelector("#sample-table tr td:first-child");
          const before = first.getBoundingClientRect().left;
          wrap.scrollLeft = wrap.scrollWidth;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const left = first.getBoundingClientRect();
          const header = document.querySelector("#table-head th:first-child").getBoundingClientRect();
          const level = document.querySelector("#sample-table tr .level-cell");
          const right = level.getBoundingClientRect();
          const rightHeader = document.querySelector("#table-head .level-cell").getBoundingClientRect();
          const panel = wrap.getBoundingClientRect();
          const gutter = parseFloat(getComputedStyle(wrap).paddingRight) || 0;
          const outside = [panel.left - 1, panel.right - Math.max(1, gutter / 2)];
          const noBleed = outside.every(x => !document.elementsFromPoint(x, left.top + left.height / 2)
            .some(e => e.closest?.("#sample-table")));
          return noBleed && Math.abs(before - left.left) < 1 && Math.abs(header.left - left.left) < 1
            && Math.abs(right.right - rightHeader.right) < 1
            && first.contains(document.elementFromPoint(left.left + left.width - 2, left.top + left.height / 2))
            && level.contains(document.elementFromPoint(right.left + right.width / 2, right.top + right.height / 2));
        });
        assert.ok(pinned, `Sample and Level stay pinned and hittable at ${width}px`);
        await page.locator("#table-wrap").evaluate(e => { e.scrollLeft = 0; });
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
      assert.equal(await page.locator('#duplicate-sample').isVisible(),false,
        'Desktop duplication uses the keyboard shortcut');
      await page.locator('#sample-table tr').first().locator('.sample-name').click();
      await page.keyboard.press('Escape');
      await page.keyboard.press('ControlOrMeta+d');
      await page.waitForFunction(()=>document.querySelector('#sample-count').textContent==='17');
      assert.equal(await page.locator('#sample-table tr.selected').count(),1);
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
