import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";
import { encodePcmWav } from "../src/wav-format.js";
import { sample, session } from "../src/model.js";
import { encodeSampleContainer } from "../src/sample-container.js";
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
const wav = Buffer.from(
    encodePcmWav([new Float32Array(800).fill(0.1)], 8000, 16, 1),
  ),
  files = ["Zeta.wav", "Alpha.wav"].map((name) => ({
    name,
    mimeType: "audio/wav",
    buffer: wav,
  }));
const pcm = Buffer.alloc(800 * 8);
for (let i = 0; i < 1600; i++) pcm.writeFloatLE(0.1, i * 4);
const occupied = {
  type: "sample_bank",
  version: 3,
  source: "PC Keyboard",
  programs: [
    {
      name: "Occupied spread",
      channel: "All",
      selected: 1,
      samples: [
        {
          name: "Keep spread",
          root_note: 60,
          low_note: 60,
          high_note: 70,
          embedded: {
            encoding: "f32le-stereo",
            frames: 800,
            data: pcm.toString("base64"),
          },
        },
        { name: "Load target", key: null },
      ],
    },
  ],
};
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
    let page;
    try {
      const open = async () => {
        const p = await browser.newPage({ serviceWorkers: "block" });
        p.setDefaultTimeout(12000);
        await p.goto(origin);
        await p.addStyleTag({
          content: "#offline-status{display:none!important}",
        });
        return p;
      };
      page = await open();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page
        .locator("#landing-files")
        .setInputFiles({
          name: "Occupied.nicosbank",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify(occupied)),
        });
      await page.waitForFunction(
        () => document.querySelector("#sample-count").textContent === "2",
      );
      const names = () =>
          page.locator("#sample-table .sample-name").allTextContents(),
        keys = () =>
          page.locator("#sample-table .key-assignment").allTextContents();
      const chooseFiles = async (chosenFiles = files) => {
        const event = page.waitForEvent("filechooser");
        await page.locator("#load-kind + .custom-select").click();
        await page
          .locator(".custom-option")
          .getByText("Sample", { exact: true })
          .click();
        const chooser = await event;
        assert(chooser.isMultiple());
        await chooser.setFiles(chosenFiles);
        await page.waitForFunction(
          () =>
            document.querySelector("#auto-assign-dialog")?.open ||
            document.querySelector("#unsaved-dialog")?.open,
        );
        if (await page.locator("#unsaved-dialog").isVisible())
          await page
            .locator("#unsaved-dialog")
            .getByRole("button", { name: /^(Discard|Continue)$/ })
            .click();
        await page.locator("#auto-assign-dialog").waitFor({ state: "visible" });
      };
      const original = (await keys())[0];
      await chooseFiles();
      assert.equal(
        await page
          .locator("#auto-assign-dialog")
          .getByRole("button", { name: "Auto assign", exact: true })
          .isDisabled(),
        false,
      );
      await page
        .locator("#auto-assign-dialog")
        .getByRole("button", { name: "Auto assign", exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelector("#sample-count").textContent === "3",
      );
      const firstNames = await names(),
        firstKeys = await keys();
      assert(
        firstNames[1].startsWith("Alpha") && firstNames[2].startsWith("Zeta"),
      );
      assert.equal(firstKeys[0], original);
      assert.deepEqual(
        firstKeys.slice(1).map((x) => Number(/^\d+/.exec(x)?.[0])),
        [71, 72],
        "reserve existing spread and fit current 60–74 PC range",
      );
      await page.locator(".add-sample-button").click();
      await chooseFiles();
      await page
        .locator("#auto-assign-dialog")
        .getByRole("button", { name: "Keep unassigned", exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelector("#sample-count").textContent === "5",
      );
      assert.deepEqual((await keys()).slice(-2), ["None", "None"]);
      const beforeNames = await names(),
        beforeKeys = await keys();
      await chooseFiles();
      await page
        .locator("#auto-assign-dialog")
        .getByRole("button", { name: "Cancel import", exact: true })
        .click();
      await page.waitForTimeout(100);
      assert.deepEqual(await names(), beforeNames);
      assert.deepEqual(await keys(), beforeKeys);
      assert.equal(await page.locator("#sample-count").textContent(), "5");
      await page.close();
      page = await open();
      page.on("pageerror", (e) => errors.push(e.message));
      const transfer = await page.evaluateHandle(
        ({ bytes }) => {
          const d = new DataTransfer();
          for (const name of ["Zeta.wav", "Alpha.wav"])
            d.items.add(
              new File([Uint8Array.from(bytes)], name, { type: "audio/wav" }),
            );
          return d;
        },
        { bytes: [...wav] },
      );
      await page
        .locator("#landing-drop")
        .dispatchEvent("drop", { dataTransfer: transfer });
      await page.locator("#auto-assign-dialog").waitFor({ state: "visible" });
      await page
        .locator("#auto-assign-dialog")
        .getByRole("button", { name: "Auto assign", exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelector("#sample-count").textContent === "2",
      );
      const dropKeys = await keys();
      assert((await names())[0].startsWith("Alpha"));
      assert(
        dropKeys.every((x) => {
          const n = Number(/^\d+/.exec(x)?.[0]);
          return n >= 60 && n <= 74;
        }),
      );
      assert.equal(
        Number(/^\d+/.exec(dropKeys[1])[0]) -
          Number(/^\d+/.exec(dropKeys[0])[0]),
        1,
      );
      await page.locator(".add-sample-button").click();
      const containerFiles = [
        ["A-unassigned.nicosample", null, 17],
        ["B-unassigned.nicosample", null, -11],
        ["Z-assigned.nicosample", 60, 0],
      ].map(([file, key, fine]) => {
        const s = sample(file, key);
        Object.assign(s, {
          fine,
          audio: [
            new Float32Array(4410).fill(0.1),
            new Float32Array(4410).fill(0.1),
          ],
          trim_end: 4410,
          loop_end: 4410,
        });
        return {
          name: file,
          mimeType: "application/zip",
          buffer: Buffer.from(encodeSampleContainer(s, session()).container),
        };
      });
      await chooseFiles(containerFiles);
      await page
        .locator("#auto-assign-dialog")
        .getByRole("button", { name: "Auto assign", exact: true })
        .click();
      await page.waitForFunction(
        () => document.querySelector("#sample-count").textContent === "5",
      );
      const containerKeys = (await keys())
        .slice(-3)
        .map((x) => Number(/^\d+/.exec(x)?.[0]));
      assert.equal(
        containerKeys[2],
        60,
        "assigned container retains its stored key",
      );
      assert.equal(containerKeys[1] - containerKeys[0], 1);
      assert(
        containerKeys
          .slice(0, 2)
          .every(
            (n) =>
              n >= 60 &&
              n <= 74 &&
              ![60, ...dropKeys.map((x) => Number(/^\d+/.exec(x)[0]))].includes(
                n,
              ),
          ),
      );
      assert.match(
        await page
          .locator("#sample-table tr")
          .nth(2)
          .locator(".pitch-drag")
          .textContent(),
        /\+17/,
      );
      const collisionNames = await names(),
        collisionKeys = await keys();
      await page.locator("#sample-table .row-handle").nth(2).click();
      const singleChooser = page.waitForEvent("filechooser");
      await page.locator("#load-kind + .custom-select").click();
      await page
        .locator(".custom-option")
        .getByText("Sample", { exact: true })
        .click();
      await (await singleChooser).setFiles(containerFiles[2]);
      await page.waitForFunction(
        () =>
          document.querySelector("#unsaved-dialog")?.open ||
          document.querySelector("#collision-dialog")?.open,
      );
      if (await page.locator("#unsaved-dialog").isVisible())
        await page
          .locator("#unsaved-dialog")
          .getByRole("button", { name: /^(Discard|Continue)$/ })
          .click();
      await page.locator("#collision-dialog").waitFor({ state: "visible" });
      assert.equal(await page.locator("#auto-assign-dialog").count(), 0);
      await page.locator('[data-collision="Cancel"]').click();
      assert.deepEqual(await names(), collisionNames);
      assert.deepEqual(await keys(), collisionKeys);
      const assignedDrop = await page.evaluateHandle(
        ({ bytes }) => {
          const d = new DataTransfer();
          for (const name of [
            "Assigned one.nicosample",
            "Assigned two.nicosample",
          ])
            d.items.add(
              new File([Uint8Array.from(bytes)], name, {
                type: "application/zip",
              }),
            );
          return d;
        },
        { bytes: [...containerFiles[2].buffer] },
      );
      await page
        .locator("#table-wrap")
        .dispatchEvent("drop", { dataTransfer: assignedDrop });
      await page.locator("#collision-dialog").waitFor({ state: "visible" });
      assert.equal(await page.locator("#auto-assign-dialog").count(), 0);
      await page.locator('[data-collision="Cancel"]').click();
      assert.deepEqual(await names(), collisionNames);
      assert.deepEqual(await keys(), collisionKeys);
      assert.deepEqual(errors, []);
      console.log(
        `${name}: multi-WAV file picker assignment avoids occupied spread, preserves PC range/sort, keeps unassigned, cancels atomically; synthetic landing drop and unassigned containers assign while stored keys/settings remain; single-picker and assigned multi-drop collisions cancel atomically`,
      );
    } finally {
      await page?.close();
      await browser.close();
    }
  }
} finally {
  server.kill();
}
