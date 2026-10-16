import { WasmEngine, interleave } from "./wasm-engine.js";
let engine;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      engine = new WasmEngine(data.module);
      postMessage({ type: "ready" });
      return;
    }
    const { token, sample: s } = data;
    engine.load(0, interleave(s.audio));
    engine.configure(0, s);
    engine.api.prepare(0);
    const processed = engine.processed(0, s.audio[0].length);
    engine.api.remove_sample(0);
    postMessage({ type: "processed", token, audio: processed }, [
      processed.buffer,
    ]);
  } catch (error) {
    postMessage({
      type: data.type === "init" ? "initError" : "error",
      token: data.token,
      message: error.message,
    });
  }
};
