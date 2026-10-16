import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  demoSamples,
  audioBytes,
  validateSample,
  assigned,
} from "../src/model.js";
import { EXAMPLE_KEYMAP } from "../src/example-kit.js";
import { importProjectBundle } from "../src/project-import.js";
const kit = demoSamples();
test("original kit has sixteen valid expressive voices within a 15 MB source budget", () => {
  assert.equal(kit.length, 16);
  assert.equal(
    kit.filter((s, i) => EXAMPLE_KEYMAP[i].group === "drums").length,
    10,
  );
  assert.ok(audioBytes([{ samples: kit }]) < 15 * 1048576);
  for (const s of kit) {
    validateSample(s);
    assert.equal(s.level, 0.5);
    assert.equal(s.max_velocity, false);
    assert.equal(s.audio.length, 2);
    assert.equal(s.audio[0].length, s.audio[1].length);
    let peak = 0,
      power = 0;
    for (const c of s.audio)
      for (const x of c) {
        assert.ok(Number.isFinite(x));
        peak = Math.max(peak, Math.abs(x));
        power += x * x;
      }
    assert.ok(
      peak > 0.05 && peak <= 0.821,
      s.name + " moderate non-silent peak",
    );
    assert.ok(power > 1, s.name + " usable signal");
  }
  assert.ok(kit.some((s) => s.playback === "loop poly"));
  assert.ok(kit.some((s) => s.filter_mode === "HPF"));
  assert.ok(kit.some((s) => s.lpf_cutoff != null));
  assert.ok(kit.some((s) => s.fx1 > 0));
  assert.ok(kit.some((s) => s.pan < 0) && kit.some((s) => s.pan > 0));
  assert.ok(kit.some((s) => s.audio[0].some((x, i) => x !== s.audio[1][i])));
});
test("generated audio is deterministic and source arrays never alias other voices", () => {
  const second = demoSamples();
  for (let i = 0; i < kit.length; i++) {
    assert.deepEqual(kit[i].audio, second[i].audio);
    assert.notEqual(kit[i].audio[0].buffer, second[i].audio[0].buffer);
    assert.notEqual(kit[i].id, second[i].id);
  }
  assert.equal(
    new Set(kit.flatMap((s) => s.audio.map((c) => c.buffer))).size,
    32,
  );
});
test("drums and pitched ranges have deliberate nonoverlapping MIDI mappings", () => {
  const counts = Array.from(
    { length: 128 },
    (_, note) => kit.filter((s) => assigned(s, note)).length,
  );
  for (let n = 36; n <= 95; n++)
    assert.equal(counts[n], n >= 36 && n <= 95 ? 1 : 0, `MIDI ${n}`);
  assert.equal(
    counts.reduce((n, x) => n + x, 0),
    60,
  );
});
test("looping pad source has periodic boundary continuity in each channel", () => {
  const pad = kit.find((s) => s.name === "Air Pad");
  for (const c of pad.audio) {
    const seam = Math.abs(c[0] - c.at(-1));
    let maxStep = 0;
    for (let i = 1; i < c.length; i++)
      maxStep = Math.max(maxStep, Math.abs(c[i] - c[i - 1]));
    assert.ok(seam < maxStep * 1.1);
  }
});
for (const [filename, voices, programs] of [
  ["Original-Circuit-Bank.zip", 16, 2],
  ["Original-Circuit-Drums.zip", 10, 1],
  ["Original-Circuit-Melodic.zip", 6, 1],
  ["Original-Circuit-Full-Kit.zip", 16, 1],
])
  test(`download ${filename} restores original source and every row's reusable settings`, async () => {
    const bytes = await readFile(
        new URL("../examples/" + filename, import.meta.url),
      ),
      loaded = importProjectBundle(bytes);
    assert.equal(loaded.programs.length, programs);
    const rows = loaded.programs.flatMap((p) => p.samples);
    assert.equal(rows.length, voices);
    for (const row of rows) {
      const original = kit.find((s) => s.name === row.name);
      assert.ok(original);
      for (const key of [
        "key",
        "level",
        "pan",
        "playback",
        "root_note",
        "low_note",
        "high_note",
        "attack_ms",
        "decay_ms",
        "lpf_cutoff",
        "lpf_resonance",
        "filter_mode",
        "fx1",
        "fx2",
      ])
        assert.deepEqual(row[key], original[key], row.name + " " + key);
      assert.deepEqual(row.audio, original.audio);
      assert.ok(row.source_wav.byteLength > 44);
    }
  });
