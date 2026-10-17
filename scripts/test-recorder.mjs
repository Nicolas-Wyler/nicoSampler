import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";
const root = fileURLToPath(new URL("..", import.meta.url)),
  probe = net.createServer();
await new Promise((r) => probe.listen(0, "127.0.0.1", r));
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const origin = `http://127.0.0.1:${port}`,
  server = spawn(process.execPath, ["serve.mjs"], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore",
  });
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(origin)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 50));
}
try {
  for (const [name, type] of [
    ["chromium", chromium],
    ["webkit", webkit],
  ]) {
    const browser = await type.launch({
      headless: true,
      ...(name === "chromium" && process.env.CHROME_PATH
        ? { executablePath: process.env.CHROME_PATH }
        : {}),
    });
    const page = await browser.newPage({
        viewport: { width: 1150, height: 844 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.setDefaultTimeout(15000);
    try {
      await page.addInitScript(() => {
        const C = window.AudioContext || window.webkitAudioContext;
        window.recorderQA = { requests: 0, streams: [], analysers: [] };
        const ctx = new C(),
          source = ctx.createConstantSource();
        source.offset.value = 0.04;
        source.start();
        document.addEventListener("pointerdown", () => void ctx.resume(), {
          capture: true,
        });
        Object.defineProperty(
          Object.getPrototypeOf(navigator.mediaDevices),
          "getUserMedia",
          {
            configurable: true,
            value: async () => {
              recorderQA.requests++;
              const d = ctx.createMediaStreamDestination();
              source.connect(d);
              recorderQA.streams.push(d.stream);
              return d.stream;
            },
          },
        );
        Object.defineProperty(
          Object.getPrototypeOf(navigator.mediaDevices),
          "enumerateDevices",
          {
            configurable: true,
            value: async () => [
              {
                kind: "audioinput",
                deviceId: "fixture",
                label: "Synthetic input",
              },
            ],
          },
        );
        Object.defineProperty(navigator, "requestMIDIAccess", {
          configurable: true,
          value: async () => ({
            inputs: new Map([
              [
                "fixture-midi",
                {
                  id: "fixture-midi",
                  name: "Synthetic MIDI",
                  state: "connected",
                },
              ],
            ]),
          }),
        });
        const connect = AudioNode.prototype.connect;
        AudioNode.prototype.connect = function (...args) {
          const result = connect.apply(this, args);
          if (args[0] === this.context.destination) {
            let a = recorderQA.analysers.find(
              (a) => a.context === this.context,
            );
            if (!a) {
              a = this.context.createAnalyser();
              a.fftSize = 512;
              recorderQA.analysers.push(a);
            }
            connect.call(this, a);
          }
          return result;
        };
      });
      await page.goto(origin);
      await page.addStyleTag({
        content: "#offline-status{display:none!important}",
      });
      await page.locator("#landing-new").click();
      await page.locator(".add-sample-button").click();
      await page.locator(".sample-name").click();
      await page.locator("input.inline-name").fill("Recorder fixture");
      await page.locator("input.inline-name").press("Enter");
      await page.locator("#connect-midi").click();
      await page.waitForFunction(
        () => !document.querySelector("#input-routing-label").hidden,
      );
      await page.locator("#input-source").selectOption("PC Keyboard");
      assert.equal(
        await page.locator("#midi-channel-label").isVisible(),
        false,
      );
      await page.locator("#input-source").selectOption("None");
      assert.equal(
        await page.locator("#midi-channel-label").isVisible(),
        false,
      );
      await page.locator("#input-source").selectOption("all");
      assert.equal(await page.locator("#midi-channel-label").isVisible(), true);
      await page.locator("#record-open").click();
      await page.waitForFunction(
        () =>
          document
            .querySelector("#input-monitor")
            .getAttribute("aria-pressed") === "true" &&
          !document.querySelector("#record-start").disabled,
      );
      assert.equal(await page.locator("#record-monitor").isChecked(), false);
      const peak = () =>
        page.evaluate(() =>
          Math.max(
            0,
            ...recorderQA.analysers.map((a) => {
              const data = new Float32Array(a.fftSize);
              a.getFloatTimeDomainData(data);
              return Math.max(...data.map(Math.abs));
            }),
          ),
        );
      await page.waitForTimeout(150);
      assert(
        (await peak()) < 1e-7,
        "capture must not leak to output while Monitor is off",
      );
      await page.locator("#record-monitor").check();
      await page.waitForTimeout(150);
      assert(
        (await peak()) > 0.01,
        "Monitor on routes the actual input signal",
      );
      const unityPeak = await peak();
      await page.locator("#master").evaluate((e) => {
        e.value = "0";
        e.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await page.waitForTimeout(150);
      assert((await peak()) < 1e-7, "Master mutes the live monitor output");
      await page.locator("#master").evaluate((e) => {
        e.value = "50";
        e.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await page.waitForTimeout(150);
      await page.locator("#record-gain").evaluate((e) => {
        e.value = "6";
        e.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await page.waitForTimeout(150);
      assert(
        (await peak()) > unityPeak * 1.8,
        "recording gain updates the live monitor path",
      );
      await page.locator("#record-gain").evaluate((e) => {
        e.value = "0";
        e.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await page.locator("#record-monitor").uncheck();
      await page.waitForTimeout(150);
      assert((await peak()) < 1e-7, "Monitor off silences the output path");
      for (let i = 1; i <= 3; i++) {
        await page.locator("#record-start").click();
        await page.waitForTimeout(900);
        await page.locator("#record-stop").click();
        await page.waitForFunction(
          (n) =>
            document.querySelectorAll("#recorded-takes-body [data-take-id]")
              .length === n &&
            !document.querySelector("#record-start").disabled,
          i,
        );
      }
      const rows = page.locator("#recorded-takes-body [data-take-id]");
      assert.match(
        await rows.first().locator("td").nth(2).textContent(),
        /0\.[5-9]\d s|1\.\d\d s/,
      );
      assert.equal(
        await rows.first().locator("td").nth(3).textContent(),
        "44.1 kHz",
      );
      assert.equal(
        await rows.first().locator("td").nth(4).textContent(),
        "16-bit",
      );
      await rows.first().locator(".take-name").click();
      await page
        .getByRole("textbox", { name: "Recording name" })
        .fill("Renamed take");
      await page
        .getByRole("textbox", { name: "Recording name" })
        .press("Enter");
      assert.equal(
        await rows.first().locator(".take-name").textContent(),
        "Renamed take",
      );
      await rows.first().locator("td").nth(2).click();
      await rows
        .nth(2)
        .locator("td")
        .nth(2)
        .click({ modifiers: ["ControlOrMeta"] });
      assert.equal(
        await page.locator("#recorded-takes-body tr.selected").count(),
        2,
      );
      const calls = await page.evaluate(() => recorderQA.requests);
      await rows.first().locator(".take-play").click();
      await page.waitForFunction(
        () =>
          document.querySelectorAll(
            "#recorded-takes-body tr.selected .take-play svg rect",
          ).length === 2,
      );
      await rows.first().locator(".take-play").click();
      await page.waitForFunction(
        () =>
          document.querySelectorAll(
            "#recorded-takes-body tr.selected .take-play svg path",
          ).length === 2,
      );
      assert.equal(
        await page.evaluate(() => recorderQA.requests),
        calls,
        "take preview must not request another capture permission",
      );
      await rows
        .nth(1)
        .locator("td")
        .nth(2)
        .click({ modifiers: ["Shift"] });
      assert.equal(
        await page.locator("#recorded-takes-body tr.selected").count(),
        2,
      );
      await rows.first().locator("td").nth(2).click();
      const box = await rows.first().locator("td").nth(2).boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(620);
      await page.mouse.up();
      assert(
        await page
          .locator("#recorded-takes-body")
          .evaluate((e) => e.classList.contains("selection-mode")),
      );
      await rows.nth(1).locator("td").nth(2).click();
      assert.equal(
        await page.locator("#recorded-takes-body tr.selected").count(),
        2,
        "tap immediately after longpress toggles another take",
      );
      await page.locator("#record-status").click();
      await rows.last().locator(".take-delete").click();
      assert.equal(await rows.count(), 3);
      assert.equal(
        await rows.last().locator(".take-delete").textContent(),
        "Sure?",
      );
      await rows.last().locator(".take-delete").click();
      assert.equal(await rows.count(), 2);
      await rows.first().locator("td").nth(2).click();
      await rows
        .last()
        .locator("td")
        .nth(2)
        .click({ modifiers: ["ControlOrMeta"] });
      await page.locator("#take-use").click();
      await page.waitForFunction(
        () =>
          !document.querySelector("#record-dialog").open &&
          document.querySelector("#sample-count").textContent === "3",
      );
      assert(
        await page.evaluate(() =>
          recorderQA.streams.every((s) =>
            s.getTracks().every((t) => t.readyState === "ended"),
          ),
        ),
        "owned capture stops on recorder close",
      );
      await page.waitForTimeout(250);
      await page.waitForFunction(
        () =>
          document.querySelector("#save-status").textContent ===
          "Saved on this device",
      );
      await page.reload();
      await page.addStyleTag({
        content: "#offline-status{display:none!important}",
      });
      await page.waitForFunction(
        () => document.querySelector("#sample-count").textContent === "3",
      );
      await page.locator("#record-open").click();
      await page.waitForFunction(
        () => !document.querySelector("#record-start").disabled,
      );
      assert.equal(
        await rows.count(),
        2,
        "Use Recording retains original takes through recovery",
      );
      assert.equal(
        await rows.first().locator(".take-name").textContent(),
        "Renamed take",
      );
      assert.equal(await page.locator("#record-monitor").isChecked(), false);
      await page.locator("#record-close").click();
      await page.waitForTimeout(150);
      assert((await peak()) < 1e-7);
      assert.deepEqual(errors, []);
      console.log(
        `${name}: recorder capture/table metadata, monitor signal, selection, rename/delete, group SVG playback, retained takes and routing passed`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  server.kill();
}
