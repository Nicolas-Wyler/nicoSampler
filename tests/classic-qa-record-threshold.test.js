import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { WasmEngine } from "../src/wasm-engine.js";
const module = await WebAssembly.compile(
  await readFile(new URL("../src/engine.wasm", import.meta.url)),
);
async function worklet() {
  let Processor;
  const events = [];
  const code = (
    await readFile(new URL("../src/audio-worklet.js", import.meta.url), "utf8")
  ).replace(/^import .*;\n/, "");
  vm.runInNewContext(code, {
    WasmEngine,
    sampleRate: 44100,
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { postMessage: (m) => events.push(m) };
      }
    },
    registerProcessor: (name, p) => (Processor = p),
    Float32Array,
    Math,
    Error,
  });
  const p = new Processor({ processorOptions: { module } });
  return {
    p,
    events,
    run: () =>
      p.process(
        [[new Float32Array(128).fill(0.01), new Float32Array(128).fill(0.5)]],
        [[new Float32Array(128), new Float32Array(128)]],
      ),
  };
}
test("record MonoL detector and input meter ignore hot unselected right channel", async () => {
  const { p, events, run } = await worklet();
  p.message({ type: "record", mode: "Mono L", threshold: -20, arm: true });
  for (let i = 0; i < 20; i++) run();
  assert.equal(p.recordFrames, 0);
  assert.ok(!events.some((e) => e.type === "recordStarted"));
  const meter = events.find((e) => e.type === "meter");
  assert.ok(
    meter && Math.abs(meter.inputPeak - 0.01) < 1e-6,
    JSON.stringify(meter),
  );
});
test("changing monitored channel while armed makes threshold and recording use selected signal", async () => {
  const { p, events, run } = await worklet();
  p.message({ type: "record", mode: "Mono L", threshold: -20, arm: true });
  run();
  p.message({ type: "inputMode", mode: "Mono R" });
  run();
  assert.equal(p.recordFrames, 128);
  assert.ok(events.some((e) => e.type === "recordStarted"));
  p.message({ type: "recordStop" });
  const chunk = events.find((e) => e.type === "recordChunk");
  assert.ok(chunk.audio.every((x) => x === 0.5));
});
test("record gain applies equally to meter, arm threshold and recorded samples", async () => {
  const { p, events, run } = await worklet();
  p.message({ type: "inputGain", db: 6.020599913279624 });
  p.message({ type: "record", mode: "Mono L", threshold: -35, arm: true });
  for (let i = 0; i < 20; i++) run();
  assert.ok(events.some((e) => e.type === "recordStarted"));
  const meter = events.find((e) => e.type === "meter");
  assert.ok(Math.abs(meter.inputPeak - 0.02) < 1e-6);
  p.message({ type: "recordStop" });
  assert.ok(
    events
      .find((e) => e.type === "recordChunk")
      .audio.every((x) => Math.abs(x - 0.02) < 1e-6),
  );
});
test("attenuating record gain suppresses arm detection and input meter", async () => {
  const { p, events, run } = await worklet();
  p.message({ type: "inputGain", db: -20 });
  p.message({ type: "record", mode: "Mono R", threshold: -20, arm: true });
  for (let i = 0; i < 20; i++) run();
  assert.equal(p.recordFrames, 0);
  assert.ok(
    Math.abs(events.find((e) => e.type === "meter").inputPeak - 0.05) < 1e-6,
  );
});
