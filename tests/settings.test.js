import test from "node:test";
import assert from "node:assert/strict";
import { session, program, validateBank } from "../src/model.js";
import { newEmpty } from "../src/workflows.js";
import { metadata } from "../src/storage.js";
import { projectBundle } from "../src/project-bundle.js";
import { importProjectBundle } from "../src/project-import.js";
import { preferences, applyPreferences } from "../src/settings.js";
const fixture = () => {
  const state = session(),
    p = program("Second");
  p.channel = "11";
  p.samples = [newEmpty("First row"), newEmpty("Selected row")];
  p.selected = p.samples[1].id;
  state.programs.push(p);
  state.current = p.id;
  state.source = "preferred-midi-id";
  state.octave = -3;
  state.master = 0.42;
  state.fx = [
    { time: 0.18, feedback: 0.77 },
    { time: 0.9, feedback: 0.31 },
  ];
  state.record = {
    source: "system",
    device: "preferred-mic-id",
    mode: "Mono R",
    threshold: -37.5,
    sample_rate: 11025,
    bit_depth: 12,
  };
  state.columns = [8000, 49, 49, 49, 49, 36, 49, 49, 49, 36, 36, 36];
  state.columnManual = { 0: 8000, 4: 131 };
  state.columnSizingVersion = 3;
  state.viewSettings = {
    keyboard: { zoom: 6.2, position: 0.73 },
    tableScroll: 0.61,
    programScroll: 0.47,
  };
  state.renderOptions = {
    format: "mp3",
    rate: 48000,
    bits: 12,
    channels: 1,
    policy: "common",
    bitrate: 256,
  };
  return state;
};
for (const only of [false, true])
  test(`${only ? "program" : "bank"} JSON and ZIP restore application preferences and selection`, () => {
    const source = fixture(),
      raw = metadata(source, only),
      decoded = validateBank(JSON.parse(JSON.stringify(raw)));
    assert.deepEqual(preferences(decoded), preferences(source));
    assert.equal(decoded.master, 0.42);
    assert.deepEqual(decoded.fx, source.fx);
    const p = decoded.programs.find((p) => p.name === "Second");
    assert.equal(p.channel, "11");
    assert.equal(
      p.samples.find((s) => s.id === p.selected).name,
      "Selected row",
    );
    assert.equal(
      decoded.programs.find((p) => p.id === decoded.current).name,
      "Second",
    );
    assert.deepEqual(
      decoded.programs.map((p) => p.name),
      only ? ["Second"] : ["Program 1", "Second"],
    );
    const zip = projectBundle(JSON.stringify(raw), source, only),
      restored = importProjectBundle(zip.buffer);
    assert.deepEqual(preferences(restored), preferences(source));
    assert.deepEqual(restored.fx, source.fx);
    assert.equal(restored.master, source.master);
  });
test("legacy files default missing preferences without dropping legacy globals", () => {
  const state = fixture(),
    raw = metadata(state, true);
  delete raw.preferences;
  const loaded = validateBank(raw);
  assert.equal(loaded.source, "preferred-midi-id");
  assert.equal(loaded.record.source, "system");
  assert.equal(loaded.record.bit_depth, 12);
  assert.deepEqual(loaded.viewSettings, {
    keyboard: { collapsed: false, zoom: 1, position: 0.5 },
    tableScroll: 0,
    programScroll: 0,
  });
  const legacy = validateBank({
    type: "sample_program",
    version: 3,
    samples: [],
  });
  assert.equal(legacy.source, "PC Keyboard");
  assert.equal(legacy.record.source, "mic");
  assert.equal(legacy.record.threshold, -24);
});
test("preference application clones mutable state and excludes unknown live fields", () => {
  const source = fixture(),
    raw = metadata(source, true);
  raw.preferences.record.active = true;
  raw.preferences.record.permission = "granted";
  const target = session();
  applyPreferences(target, raw);
  assert.equal(target.record.active, undefined);
  assert.equal(target.record.permission, undefined);
  target.record.threshold = -2;
  target.columns[0] = 200;
  target.viewSettings.keyboard.zoom = 1;
  assert.equal(source.record.threshold, -37.5);
  assert.equal(source.columns[0], 8000);
  assert.equal(source.viewSettings.keyboard.zoom, 6.2);
  const loaded = validateBank(raw);
  loaded.fx[0].time = 0.7;
  assert.equal(raw.fx[0].time, 0.18);
});
test("invalid preferences are rejected before they can reach UI controls", () => {
  const raw = metadata(fixture(), true);
  for (const change of [
    (p) => (p.version = 99),
    (p) => (p.record.threshold = NaN),
    (p) => (p.record.mode = "bad"),
    (p) => (p.record.source = "bad"),
    (p) => (p.source = {}),
    (p) => (p.view.keyboard.zoom = 100),
    (p) => (p.view.tableScroll = -1),
    (p) => (p.columnManual[0] = 10001),
    (p) => (p.octave = 0.5),
    (p) => (p.render.bitrate = 999),
  ]) {
    const invalid = structuredClone(raw);
    change(invalid.preferences);
    assert.throws(() => validateBank(invalid), /Invalid|Unsupported/);
  }
});
