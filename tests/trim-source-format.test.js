import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sample, processAudio, validateSample } from "../src/model.js";
import {
  effectiveSampleFormat,
  processingSampleFormat,
} from "../src/render-options.js";
import { encodePcmWav } from "../src/wav-format.js";
import {
  rawWave,
  encodeSampleContainer,
  decodeSampleContainer,
} from "../src/sample-container.js";
import { WasmEngine, interleave } from "../src/wasm-engine.js";
const module = await WebAssembly.compile(
  await readFile(new URL("../src/engine.wasm", import.meta.url)),
);
test("12kHz 12-bit recording displays source precision without a second reduction", () => {
  const s = sample();
  s.source_wav = new Uint8Array(
    encodePcmWav(
      [Float32Array.from({ length: 1200 }, (_, i) => 0.2 * Math.sin(i * 0.13))],
      12000,
      12,
      1,
    ),
  );
  s.audio = rawWave(s.source_wav);
  assert.deepEqual(effectiveSampleFormat(s), {
    rate: 12000,
    bits: 12,
    channels: 1,
  });
  s.crush_rate = 12000;
  s.crush_bits = 12;
  assert.deepEqual(processingSampleFormat(s), { rate: 44100, bits: 32 });
  assert.deepEqual(processAudio(s), s.audio);
  s.crush_rate = 8000;
  s.crush_bits = 8;
  assert.deepEqual(effectiveSampleFormat(s), {
    rate: 8000,
    bits: 8,
    channels: 1,
  });
  assert.deepEqual(processingSampleFormat(s), { rate: 8000, bits: 8 });
});
test("Mono L/R selects only that source channel into both output channels", () => {
  for (const [mono_channel, expected] of [
    ["left", 0.2],
    ["right", -0.4],
    ["mix", -0.1],
  ]) {
    const s = sample();
    Object.assign(s, {
      mono: true,
      mono_channel,
      audio: [
        new Float32Array(4096).fill(0.2),
        new Float32Array(4096).fill(-0.4),
      ],
    });
    const e = new WasmEngine(module);
    e.load(0, interleave(s.audio));
    e.configure(0, s);
    e.api.set_master(1);
    e.api.trigger(0, 60, 127, 1);
    for (let i = 0; i < 4; i++) e.output(128);
    const output = e.output(128);
    for (const c of output)
      assert.ok(
        c.every((x) => Math.abs(x - expected) < 1e-5),
        mono_channel,
      );
  }
});
test("mono source channel survives container serialization and rejects invalid values", () => {
  const s = sample();
  Object.assign(s, {
    mono: true,
    mono_channel: "right",
    audio: [new Float32Array(20), new Float32Array(20)],
  });
  const result = decodeSampleContainer(
    encodeSampleContainer(s, {
      master: 1,
      fx: [
        { time: 0.1, feedback: 0 },
        { time: 0.2, feedback: 0 },
      ],
    }).container,
  );
  assert.equal(result.programs[0].samples[0].mono_channel, "right");
  s.mono_channel = "invalid";
  assert.throws(() => validateSample(s));
});
