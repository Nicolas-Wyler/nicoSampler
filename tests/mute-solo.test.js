import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sample, validateSample, session, program } from "../src/model.js";
import { WasmEngine, interleave } from "../src/wasm-engine.js";
import { isSampleMuted } from "../src/sample-audibility.js";
import { metadata } from "../src/storage.js";
import { projectBundle } from "../src/project-bundle.js";
import { importProjectBundle } from "../src/project-import.js";
import {
  encodeSampleContainer,
  decodeSampleContainer,
} from "../src/sample-container.js";
const module = await WebAssembly.compile(
  await readFile(new URL("../src/engine.wasm", import.meta.url)),
);
const source = () => {
  const s = sample("Sustain", 60);
  s.audio = [
    new Float32Array(44100).fill(0.2),
    new Float32Array(44100).fill(0.1),
  ];
  s.level = 0.37;
  s.playback = "loop poly";
  s.trim_end = s.loop_end = 44100;
  s.loop_start = 0;
  return s;
};
const configure = (e, rows) =>
  rows.forEach((s, i) =>
    e.configure(i, { ...s, effective_mute: isSampleMuted(s, rows) }),
  );
const audible = (e) => {
  const audio = e.output(256).map((c) => c.slice());
  return audio.some((c) => c.some((v) => Math.abs(v) > 1e-7));
};
test("defaults, strict flags and imported mutual exclusion preserve all source parameters", () => {
  const s = source(),
    loaded = validateSample({ ...s, mute: true, solo: true });
  assert.equal(loaded.mute, true);
  assert.equal(loaded.solo, false);
  assert.equal(loaded.level, 0.37);
  assert.equal(sample().mute, false);
  assert.equal(sample().solo, false);
  assert.throws(() => validateSample({ ...s, mute: "yes" }), /mute\/solo/);
});
test("current-program solo is additive, explicit mute wins and other programs do not participate", () => {
  const a = source(),
    b = source(),
    c = source();
  b.solo = true;
  assert.equal(isSampleMuted(a, [a, b]), true);
  assert.equal(isSampleMuted(b, [a, b]), false);
  a.solo = true;
  assert.equal(isSampleMuted(a, [a, b]), false);
  a.mute = true;
  assert.equal(isSampleMuted(a, [a, b]), true);
  assert.equal(isSampleMuted(c, [c]), false);
  assert.equal(isSampleMuted(c, [{ solo: true, mute: true }, c]), false);
});
test("live WASM mute silences existing filtered voices exactly and unmutes without changing level or PCM", () => {
  const e = new WasmEngine(module),
    s = source();
  s.lpf_cutoff = 2400;
  s.lpf_resonance = 1.2;
  const before = s.audio.map((c) => c.slice());
  e.load(0, interleave(s.audio));
  e.configure(0, s);
  e.api.trigger(0, 60, 127, 0);
  e.output(512);
  assert.equal(audible(e), true);
  const position = e.api.position(0);
  s.mute = true;
  e.configure(0, s);
  assert.equal(audible(e), false);
  assert.equal(e.api.active_voices(), 1);
  assert.notEqual(e.api.position(0), position);
  s.mute = false;
  e.configure(0, s);
  assert.equal(audible(e), true);
  assert.equal(s.level, 0.37);
  assert.deepEqual(s.audio, before);
});
test("WASM refuses muted new voices for every input channel", () => {
  const e = new WasmEngine(module),
    s = source();
  s.mute = true;
  e.load(0, interleave(s.audio));
  e.configure(0, s);
  for (const channel of [-3, -2, -1, 0, 1, 16])
    e.api.trigger(0, 60, 127, channel);
  assert.equal(e.api.active_voices(), 0);
  assert.equal(audible(e), false);
});
test("solo configuration immediately masks other already-playing voices and restores original levels", () => {
  const e = new WasmEngine(module),
    rows = [source(), source()];
  rows.forEach((s, i) => e.load(i, interleave(s.audio)));
  configure(e, rows);
  e.api.trigger(0, 60, 127, 0);
  e.output(512);
  assert.equal(audible(e), true);
  rows[1].solo = true;
  configure(e, rows);
  assert.equal(audible(e), false);
  rows[0].solo = true;
  configure(e, rows);
  assert.equal(audible(e), true);
  rows[0].solo = false;
  rows[1].solo = false;
  configure(e, rows);
  assert.equal(audible(e), true);
  assert.deepEqual(
    rows.map((s) => s.level),
    [0.37, 0.37],
  );
});
test("bank/program ZIP and individual container save persistent M/S flags without runtime masks", () => {
  const state = session(),
    p = program("Flags");
  p.samples = [source(), source()];
  p.samples[0].mute = true;
  p.samples[1].solo = true;
  p.selected = p.samples[1].id;
  state.programs = [p];
  state.current = p.id;
  for (const only of [true, false]) {
    const raw = metadata(state, only),
      zip = projectBundle(JSON.stringify(raw), state, only),
      loaded = importProjectBundle(zip);
    assert.equal(loaded.programs[0].samples[0].mute, true);
    assert.equal(loaded.programs[0].samples[1].solo, true);
    assert.ok(
      loaded.programs[0].samples.every((s) => s.effective_mute === undefined),
    );
  }
  const encoded = encodeSampleContainer(p.samples[0], state),
    saved = decodeSampleContainer(encoded.container);
  assert.equal(saved.programs[0].samples[0].mute, true);
  assert.deepEqual(saved.programs[0].samples[0].audio, p.samples[0].audio);
});
test("muting clears old shared delay returns while keeping the active source position", () => {
  const e = new WasmEngine(module),
    s = source();
  s.fx1 = 0.6;
  s.fx2 = 0.4;
  e.load(0, interleave(s.audio));
  e.configure(0, s);
  e.api.set_fx(0, 0.01, 0.5);
  e.api.set_fx(1, 0.015, 0.4);
  e.api.trigger(0, 60, 127, 0);
  for (let i = 0; i < 40; i++) e.output(128);
  assert.equal(audible(e), true);
  s.mute = true;
  e.configure(0, s);
  e.api.clear_fx();
  for (let i = 0; i < 10; i++) assert.equal(audible(e), false);
  assert.equal(e.api.active_voices(), 1);
  s.mute = false;
  e.configure(0, s);
  assert.equal(audible(e), true);
});
test("audibility transaction updates every row and trim preview without changing stored levels", async () => {
  const { AudioController } = await import("../src/audio.js"),
    a = source(),
    b = source();
  b.solo = true;
  const p = { samples: [a, b] },
    messages = [],
    controller = Object.create(AudioController.prototype);
  Object.assign(controller, {
    program: p,
    slots: new Map([
      [a.id, 0],
      [b.id, 1],
    ]),
    previewSamples: new Map([
      [512, { ...a, id: "trim-preview", audition_source_id: a.id }],
    ]),
    node: { port: { postMessage: (m) => messages.push(m) } },
  });
  controller.updateAudibility(p);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, "audibility");
  assert.deepEqual(
    messages[0].configs.map((c) => [c.slot, c.sample.effective_mute]),
    [
      [0, true],
      [1, false],
      [512, true],
    ],
  );
  assert.ok(messages[0].configs.every((c) => c.sample.level === 0.37));
  controller.on(p, 60, 127, -1);
  assert.deepEqual(messages.at(-1).slots, [1]);
});
test("Resample exports silence for explicit mute and current-program solo exclusion", async () => {
  const { renderSample } = await import("../src/render-sample.js"),
    { resampleExport } = await import("../src/resample-export.js"),
    { decodePcmWav } = await import("../src/wav-format.js");
  const a = source(),
    b = source();
  b.solo = true;
  const state = {
    programs: [{ id: "p", samples: [a, b] }],
    current: "p",
    master: 1,
  };
  const excluded = await renderSample(a, state);
  assert.equal(excluded[0].length, 44100);
  assert.ok(excluded.every((c) => c.every((x) => x === 0)));
  a.mute = true;
  const result = await resampleExport([a], state, {
      rate: 8000,
      bits: 12,
      channels: 1,
      format: "wav",
    }),
    decoded = decodePcmWav(result.data);
  assert.equal(decoded.bits, 12);
  assert.equal(decoded.rate, 8000);
  assert.ok(decoded.audio.every((c) => c.every((x) => x === 0)));
  assert.equal(a.level, 0.37);
});
test("render worker receives only current-program solo flags as context", async () => {
  const { FileCodec } = await import("../src/storage.js"),
    a = source(),
    b = source();
  b.solo = true;
  let data;
  await FileCodec.prototype.renderSamples.call(
    {
      run: (_, payload) => {
        data = payload;
      },
    },
    [a],
    {
      programs: [
        { id: "current", samples: [a, b] },
        { id: "other", samples: [{ id: "other-solo", solo: true }] },
      ],
      current: "current",
      master: 1,
      fx: [],
    },
    {},
  );
  assert.deepEqual(data.soloContext, [
    { id: a.id, mute: false, solo: false },
    { id: b.id, mute: false, solo: true },
  ]);
  assert.equal(data.soloContext[0].audio, undefined);
});
