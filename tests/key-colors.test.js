import test from "node:test";
import assert from "node:assert/strict";
import {
  createKeyColorMap,
  assignedNotes,
  COLOR_PALETTE,
} from "../src/key-colors.js";
import { demoSamples } from "../src/model.js";
const spread = (low, high, root = low) => ({
  key: null,
  root_note: root,
  low_note: low,
  high_note: high,
});
test("whole spread and identical ranges share one solid color despite root/settings differences", () => {
  const a = spread(48, 59),
    b = spread(48, 59, 54);
  const map = createKeyColorMap([a, b]);
  const color = map.colorsForSample(a);
  assert.equal(color.length, 1);
  assert.deepEqual(map.colorsForSample(b), color);
  for (let n = 48; n <= 59; n++) assert.deepEqual(map.colorsForNote(n), color);
});
test("overlap bands represent ranges; single notes inside inherit those ranges", () => {
  const a = spread(48, 60),
    b = spread(56, 67),
    single = { key: 58 },
    isolated = { key: 75 };
  const map = createKeyColorMap([a, b, single, isolated]);
  assert.notDeepEqual(map.colorsForSample(a), map.colorsForSample(b));
  assert.deepEqual(map.colorsForNote(58), [
    ...map.colorsForSample(a),
    ...map.colorsForSample(b),
  ]);
  assert.deepEqual(map.colorsForSample(single), map.colorsForNote(58));
  assert.equal(map.colorsForNote(75).length, 1);
  assert.deepEqual(map.colorsForNote(0), []);
});
test("manual colors are sample-local, persist on unassigned rows and do not mutate input", () => {
  const a = spread(48, 59),
    b = { ...spread(48, 59), color: "#123ABC" },
    u = { key: null, color: "#abcdef" };
  const before = JSON.stringify([a, b, u]);
  const map = createKeyColorMap([a, b, u]);
  assert.deepEqual(map.colorsForSample(b), ["#123abc"]);
  assert.equal(map.colorsForNote(50).length, 2);
  assert.deepEqual(map.colorsForSample(u), ["#abcdef"]);
  assert.equal(JSON.stringify([a, b, u]), before);
});
test("logical families share colors and reordering rows leaves the map unchanged", () => {
  const a = { key: 60, color_group: "hats" },
    b = { key: 61, color_group: "hats" },
    c = spread(72, 83);
  const map = createKeyColorMap([a, b, c]),
    other = createKeyColorMap([c, b, a]);
  assert.deepEqual(map.colorsForSample(a), map.colorsForSample(b));
  for (const s of [a, b, c])
    assert.deepEqual(map.colorsForSample(s), other.colorsForSample(s));
  assert.equal(
    createKeyColorMap([{ key: null }]).gradientForSample({ key: null }),
    "none",
  );
  assert.deepEqual(assignedNotes(spread(48, 50)), [48, 49, 50]);
});
test("512 distinct automatic spread groups have distinct colors without wrapping the palette", () => {
  const samples = [];
  for (let lo = 0; lo < 128 && samples.length < 512; lo++)
    for (let hi = lo + 1; hi < 128 && samples.length < 512; hi++)
      samples.push(spread(lo, hi));
  const map = createKeyColorMap(samples);
  assert.equal(
    new Set(samples.map((s) => map.colorsForSample(s)[0])).size,
    512,
  );
});
test("example hats/toms/snare families share preset colors across separate programs", () => {
  const kit = demoSamples(),
    byName = (name) => kit.find((s) => s.name === name);
  assert.equal(byName("Closed Hat").color, byName("Open Hat").color);
  assert.equal(byName("Low Tom").color, byName("High Tom").color);
  assert.equal(byName("Velvet Snare").color, byName("Room Clap").color);
  for (const s of kit) assert.match(s.color, /^#[0-9A-F]{6}$/);
  assert.equal(new Set(COLOR_PALETTE).size, COLOR_PALETTE.length);
});
