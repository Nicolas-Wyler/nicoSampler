import test from "node:test";
import assert from "node:assert/strict";
import { findFreeKeyBlock, hasAssignedKeys } from "../src/auto-assignment.js";
import { sample, assigned } from "../src/model.js";
test("auto assignment finds a centered ascending block without touching existing samples", () => {
  const s = { ...sample(), key: 64 };
  const before = structuredClone(s),
    start = findFreeKeyBlock([s], 4);
  assert.equal(start, 60);
  assert.deepEqual(s, before);
  for (let n = start; n < start + 4; n++) assert(!assigned(s, n));
});
test("PC auto assignment stays within the current octave window and shifts around occupied keys", () => {
  const rows = [
    { ...sample(), key: 66 },
    { ...sample(), key: 67 },
  ];
  const options = { min: 60, max: 74, center: 67 };
  assert.equal(findFreeKeyBlock(rows, 4, options), 68);
  assert.equal(findFreeKeyBlock(rows, 16, options), null);
  assert.equal(
    findFreeKeyBlock(
      Array.from({ length: 15 }, (_, i) => ({ ...sample(), key: 60 + i })),
      1,
      options,
    ),
    null,
  );
});
test("spreads and MIDI boundaries reserve their complete assigned ranges", () => {
  const s = { ...sample(), root_note: 60, low_note: 60, high_note: 72 };
  for (let n = 60; n <= 72; n++) assert(assigned(s, n));
  const start = findFreeKeyBlock([s], 3, { min: 60, max: 74, center: 67 });
  assert.equal(start, null);
  assert.equal(
    findFreeKeyBlock([], 8, { min: 120, max: 127, center: 127 }),
    120,
  );
  assert.equal(findFreeKeyBlock([], 9, { min: 120, max: 127 }), null);
  assert.equal(findFreeKeyBlock([], 0), null);
});

test("unassigned containers are eligible while assigned keys and spreads stay reserved", () => {
  assert.equal(
    hasAssignedKeys({ ...sample(), key: null, root_note: null }),
    false,
  );
  assert.equal(hasAssignedKeys({ ...sample(), key: 60 }), true);
  assert.equal(
    hasAssignedKeys({
      ...sample(),
      key: null,
      root_note: 60,
      low_note: 48,
      high_note: 72,
    }),
    true,
  );
});
