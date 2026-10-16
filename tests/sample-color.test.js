import test from "node:test";
import assert from "node:assert/strict";
import {
  sample,
  validateSample,
  session,
  program,
  validateBank,
} from "../src/model.js";
import { metadata } from "../src/storage.js";
import { projectBundle } from "../src/project-bundle.js";
import { importProjectBundle } from "../src/project-import.js";
import {
  encodeSampleContainer,
  decodeSampleContainer,
} from "../src/sample-container.js";
const fixture = () => {
  const s = sample("Color voice", 60);
  s.audio = [new Float32Array(128).fill(0.2), new Float32Array(128).fill(0.3)];
  s.trim_end = s.loop_end = 128;
  s.color = "#12ABEF";
  s.color_group = "acoustic-drums";
  return s;
};
test("manual colors and preset groups are optional, canonical and validated", () => {
  assert.equal(sample().color, null);
  assert.equal(sample().color_group, null);
  const s = validateSample({
    ...fixture(),
    color: "#aabbcc",
    color_group: "  drums  ",
  });
  assert.equal(s.color, "#AABBCC");
  assert.equal(s.color_group, "drums");
  for (const color of ["red", "#abc", "#12345g", "#12345678", {}, 3])
    assert.throws(
      () => validateSample({ ...fixture(), color }),
      /sample color/,
    );
  for (const color_group of [
    "",
    " ".repeat(3),
    "x".repeat(81),
    "drums\nother",
    {},
  ])
    assert.throws(
      () => validateSample({ ...fixture(), color_group }),
      /sample color group/,
    );
});
test("program/bank JSON and ZIP retain per-row colors without changing source or DSP parameters", () => {
  const s = fixture(),
    other = {
      ...fixture(),
      id: "other",
      color: null,
      color_group: "other-family",
    },
    state = session(),
    p = program("Colors");
  p.samples = [s, other];
  p.selected = s.id;
  state.programs = [p];
  state.current = p.id;
  for (const only of [true, false]) {
    const raw = metadata(state, only),
      json = validateBank(raw);
    assert.deepEqual(
      json.programs[0].samples.map((s) => [s.color, s.color_group]),
      [
        ["#12ABEF", "acoustic-drums"],
        [null, "other-family"],
      ],
    );
    const zip = projectBundle(JSON.stringify(raw), state, only),
      loaded = importProjectBundle(zip).programs[0].samples;
    assert.equal(loaded[0].color, "#12ABEF");
    assert.equal(loaded[1].color, null);
    assert.deepEqual(loaded[0].audio, s.audio);
    assert.equal(loaded[0].level, s.level);
    assert.equal(loaded[0].pan, s.pan);
  }
});
test("individual sample containers preserve manual color/group and raw WAV", () => {
  const s = fixture(),
    state = session(),
    encoded = encodeSampleContainer(s, state),
    loaded = decodeSampleContainer(encoded.container).programs[0].samples[0];
  assert.equal(loaded.color, s.color);
  assert.equal(loaded.color_group, s.color_group);
  assert.deepEqual(loaded.audio, s.audio);
  assert.equal(loaded.source_wav.byteLength, encoded.wav.byteLength);
});
