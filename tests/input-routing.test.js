import test from "node:test";
import assert from "node:assert/strict";
import { acceptsInput } from "../src/input-routing.js";
test("routing matrix isolates PC, None, all MIDI, and individual devices", () => {
  for (const [source, pc, first, second] of [
    ["PC Keyboard", true, false, false],
    ["None", false, false, false],
    ["all", false, true, true],
    ["midi-1", false, true, false],
    ["disconnected", false, false, false],
  ]) {
    assert.equal(acceptsInput(source, "pc"), pc);
    assert.equal(acceptsInput(source, "midi", "midi-1"), first);
    assert.equal(acceptsInput(source, "midi", "midi-2"), second);
    assert.equal(acceptsInput(source, "screen"), true);
    assert.equal(acceptsInput(source, "preview"), true);
  }
});
test("unknown note sources or missing MIDI device IDs cannot accidentally enable input", () => {
  assert.equal(acceptsInput("all", "midi"), false);
  assert.equal(acceptsInput("all", "unknown"), false);
  assert.equal(acceptsInput(undefined, "pc"), false);
  assert.equal(acceptsInput("None", "midi", "None"), false);
  assert.equal(acceptsInput("PC Keyboard", "midi", "PC Keyboard"), false);
});
