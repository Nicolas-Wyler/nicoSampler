import test from "node:test";
import assert from "node:assert/strict";
import { File } from "node:buffer";
import { planLandingImport, landingNotice } from "../src/landing-import.js";
import { packZip } from "../src/sample-container.js";
const file = (name, text = "bad") => new File([text], name);
test("bank hierarchy ignores malformed lower-ranking files without decoding them", async () => {
  const plan = await planLandingImport([
    file("x.wav"),
    file("bad.nicoprog"),
    file("bank.nicosbank"),
    file("bad.json"),
  ]);
  assert.equal(plan.kind, "bank");
  assert.deepEqual(
    plan.files.map((f) => f.name),
    ["bank.nicosbank"],
  );
  assert.equal(plan.ignored.length, 3);
  assert.match(landingNotice(plan), /bank takes priority/);
});
test("multiple programs outrank loose sample containers and WAVs", async () => {
  const plan = await planLandingImport([
    file("a.nicoprog"),
    file("b.nicoprog"),
    file("x.nicosample"),
    file("x.wav"),
  ]);
  assert.equal(plan.kind, "program");
  assert.equal(plan.files.length, 2);
  assert.equal(plan.ignored.length, 2);
});
test("multiple WAVs and containers all remain separate imports", async () => {
  const plan = await planLandingImport([
    file("x.nicosample"),
    file("x.wav"),
    file("y.wav"),
  ]);
  assert.equal(plan.kind, "samples");
  assert.equal(plan.files.length, 3);
});
test("multiple banks are rejected rather than silently picking one", async () => {
  await assert.rejects(
    planLandingImport([file("a.nicosbank"), file("b.nicosbank")]),
    /one bank at a time/,
  );
});
test("sample ZIP suppresses internal raw WAV companions but retains extra WAVs", async () => {
  const zip = packZip([
    ["samples/one.nicosample", new Uint8Array([1])],
    ["samples/one.raw.wav", new Uint8Array([2])],
    ["extra.wav", new Uint8Array([3])],
  ]);
  const plan = await planLandingImport([new File([zip], "Samples.zip")]);
  assert.equal(plan.kind, "samples");
  assert.deepEqual(
    plan.files.map((f) => f.name),
    ["samples/one.nicosample", "extra.wav"],
  );
});

import { isLegacyEmptyProgram } from "../src/landing-import.js";
import { program } from "../src/model.js";
import { newEmpty } from "../src/workflows.js";
test("legacy automatically-created blank recovers to landing", () => {
  const p = program();
  p.samples = [newEmpty()];
  assert.equal(isLegacyEmptyProgram(p), true);
  p.samples = [];
  assert.equal(isLegacyEmptyProgram(p), true);
});
test("configured or loaded work is retained, while default blank rows stay on landing", () => {
  const p = program();
  p.samples = [newEmpty()];
  p.landing = false;
  assert.equal(isLegacyEmptyProgram(p), true);
  delete p.landing;
  p.samples[0].level = 0.27;
  assert.equal(isLegacyEmptyProgram(p), false);
  p.samples = [newEmpty()];
  p.samples[0].audio = [new Float32Array(8), new Float32Array(8)];
  assert.equal(isLegacyEmptyProgram(p), false);
});
