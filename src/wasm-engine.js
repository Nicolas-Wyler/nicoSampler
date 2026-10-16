import { MODES, SPREADS, bounds } from "./model.js";
export async function compileEngine() {
  const r = await fetch(new URL("./engine.wasm", import.meta.url));
  if (!r.ok) throw Error("Audio engine could not be downloaded");
  return WebAssembly.compile(await r.arrayBuffer());
}
export class WasmEngine {
  constructor(module, rate = 44100) {
    const instance = new WebAssembly.Instance(module, {});
    this.api = instance.exports;
    this.api._initialize?.();
    this.api.init(rate);
    this.configPtr = this.api.allocate(128);
    if (!this.configPtr) throw Error("Audio engine ran out of memory");
  }
  load(id, interleaved) {
    const p = this.api.allocate(interleaved.byteLength);
    if (!p) throw Error("Sample exceeds available audio memory");
    new Float32Array(this.api.memory.buffer, p, interleaved.length).set(
      interleaved,
    );
    if (!this.api.load_sample(id, p, interleaved.length / 2)) {
      this.api.deallocate(p);
      throw Error("Sample cannot fit in audio memory");
    }
    this.api.accept_processed(id);
  }
  refresh(id, interleaved) {
    const p = this.api.allocate(interleaved.byteLength);
    if (!p) throw Error("Audio memory exhausted");
    try {
      new Float32Array(this.api.memory.buffer, p, interleaved.length).set(
        interleaved,
      );
      if (!this.api.refresh_processed(id, p, interleaved.length / 2))
        throw Error("Preview source size changed");
    } finally {
      this.api.deallocate(p);
    }
  }
  configure(id, s) {
    const [start, end] = bounds(s),
      q = s.spread_settings;
    const data = [
      s.key ?? -1,
      s.root_note ?? -1,
      s.low_note ?? 0,
      s.high_note ?? 127,
      MODES.indexOf(s.playback),
      s.level,
      s.semitone,
      s.fine,
      s.attack_ms,
      s.decay_ms,
      s.lpf_cutoff ?? 0,
      s.lpf_resonance,
      s.filter_mode === "HPF" ? 1 : 0,
      s.fx1,
      s.fx2,
      s.max_velocity ? 1 : 0,
      start,
      end,
      s.loop_start ?? start,
      s.loop_end ?? end,
      s.reverse ? 1 : 0,
      s.crush_rate,
      s.crush_bits,
      s.normalization ? 1 : 0,
      q ? SPREADS.indexOf(q.parameter) + 1 : 0,
      q?.minimum ?? 0,
      q?.maximum ?? 0,
      q?.resonance_min ?? 0,
      q?.resonance_max ?? 0,
      q?.coupled ? 1 : 0,
      s.pan ?? 0,
      (s.mono ? 1 : 0) | (s.mute || s.effective_mute ? 2 : 0),
    ];
    new Float32Array(this.api.memory.buffer, this.configPtr, 32).set(data);
    this.api.configure(id, this.configPtr);
  }
  output(n) {
    this.api.render(n);
    return [
      new Float32Array(this.api.memory.buffer, this.api.output_left(), n),
      new Float32Array(this.api.memory.buffer, this.api.output_right(), n),
    ];
  }
  processed(id, n) {
    return new Float32Array(
      this.api.memory.buffer,
      this.api.processed_pointer(id),
      n * 2,
    ).slice();
  }
}
export function interleave(audio) {
  const n = audio[0].length,
    a = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    a[i * 2] = audio[0][i];
    a[i * 2 + 1] = audio[1]?.[i] ?? audio[0][i];
  }
  return a;
}
export function planar(a) {
  const n = a.length / 2,
    l = new Float32Array(n),
    r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    l[i] = a[i * 2];
    r[i] = a[i * 2 + 1];
  }
  return [l, r];
}
