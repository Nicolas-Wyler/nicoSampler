import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { sample } from "../src/model.js";
import { encodeSampleContainer } from "../src/sample-container.js";
const require = createRequire(import.meta.url);
const playwright = require("playwright");
const s = sample("MIDI highlight regression");
Object.assign(s, {
  key: 60,
  playback: "poly",
  audio: [new Float32Array(44100 * 2).fill(0.15)],
});
const file = {
  name: "highlight.nicosample",
  mimeType: "application/zip",
  buffer: Buffer.from(
    encodeSampleContainer(s, {
      master: 1,
      fx: [
        { time: 0.1, feedback: 0 },
        { time: 0.2, feedback: 0 },
      ],
    }).container,
  ),
};
for (const name of ["chromium", "webkit"]) {
  const browser = await playwright[name].launch({
    headless: true,
    ...(name === "chromium" && process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
  try {
    const page = await browser.newPage({ serviceWorkers: "block" });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.testMidiInput = {
        id: "test",
        name: "Test MIDI",
        state: "connected",
      };
      Object.defineProperty(navigator, "requestMIDIAccess", {
        value: async () => ({
          inputs: new Map([["test", testMidiInput]]),
          outputs: new Map(),
        }),
      });
    });
    await page.goto(process.env.SAMPLER_URL || "http://127.0.0.1:8770/");
    await page.locator("#audio-files").setInputFiles(file);
    await page.waitForFunction(
      () => !document.querySelector("#spread-open").disabled,
    );
    await page.locator("#connect-midi").click();
    await page.waitForFunction(() => !!testMidiInput.onmidimessage);
    const send = (data) =>
      page.evaluate((data) => testMidiInput.onmidimessage({ data }), data);
    const key = page.locator('.piano-key[data-note="60"]');
    for (const off of [
      [128, 60, 64],
      [144, 60, 0],
    ]) {
      await send([144, 60, 100]);
      await page.waitForFunction(() =>
        document
          .querySelector('.piano-key[data-note="60"]')
          .classList.contains("pressed"),
      );
      await send(off);
      await page.waitForTimeout(250); // Several meter ticks used to re-highlight the released key.
      assert.equal(
        await key.evaluate((e) => e.classList.contains("pressed")),
        false,
        "note-off stays visually released",
      );
      assert.match(
        await page.locator("#engine-status").textContent(),
        /[1-9]\d* voices/,
        "one-shot still sounds",
      );
    }
    await page.waitForTimeout(2200);
    await send([144, 60, 100]);
    await page.waitForTimeout(2300);
    assert.equal(
      await key.evaluate((e) => e.classList.contains("pressed")),
      true,
      "held input stays highlighted after sample ends",
    );
    await send([128, 60, 0]);
    await page.waitForTimeout(100);
    assert.equal(
      await key.evaluate((e) => e.classList.contains("pressed")),
      false,
    );
    const r = await key.boundingBox();
    await page.mouse.move(r.x + r.width / 2, r.y + r.height - 4);
    await page.mouse.down();
    await page.waitForTimeout(50);
    assert.equal(
      await key.evaluate((e) => e.classList.contains("pressed")),
      true,
    );
    await send([144, 60, 100]);
    await send([128, 60, 0]);
    await page.waitForTimeout(150);
    assert.equal(
      await key.evaluate((e) => e.classList.contains("pressed")),
      true,
      "onscreen hold survives MIDI key-up",
    );
    await page.mouse.up();
    await page.waitForTimeout(150);
    assert.equal(
      await key.evaluate((e) => e.classList.contains("pressed")),
      false,
    );
    await send([144, 60, 100]);
    await send([145, 60, 100]);
    await send([128, 60, 0]);
    await page.waitForTimeout(150);
    assert.equal(
      await key.evaluate((e) => e.classList.contains("pressed")),
      true,
      "second MIDI channel survives first channel key-up",
    );
    await send([129, 60, 0]);
    await page.waitForTimeout(150);
    assert.equal(
      await key.evaluate((e) => e.classList.contains("pressed")),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      `${name}: both MIDI note-off forms release highlight while one-shot continues; held key survives sample end PASS`,
    );
  } finally {
    await browser.close();
  }
}
