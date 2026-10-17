import { WasmEngine } from "./wasm-engine.js";
class SamplerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.engine = new WasmEngine(options.processorOptions.module, sampleRate);
    this.mapping = new Map();
    this.counter = 0;
    this.recording = false;
    this.armed = false;
    this.threshold = 0.063;
    this.recChannels = "Stereo";
    this.recordBuffer = new Float32Array(8192);
    this.recIndex = 0;
    this.recordFrames = 0;
    this.maxFrames = sampleRate * 180;
    this.inputGain = 1;
    this.peak = 0;
    this.port.onmessage = (e) => this.message(e.data);
    this.port.postMessage({ type: "ready" });
  }
  message(m) {
    try {
      const a = this.engine.api;
      if (m.type === "inputGain") {
        this.inputGain =
          10 ** (Math.max(-24, Math.min(24, Number(m.db) || 0)) / 20);
      } else if (m.type === "inputMode") {
        this.recChannels = m.mode;
        this.peak = 0;
      } else if (m.type === "threshold") {
        this.threshold = 10 ** (m.threshold / 20);
      } else if (m.type === "load") {
        this.engine.load(m.slot, m.audio);
        this.engine.configure(m.slot, m.sample);
        this.mapping.set(m.slot, m.id);
        this.port.postMessage({ type: "loaded", id: m.id });
      } else if (m.type === "refresh") {
        this.engine.refresh(m.slot, m.audio);
        this.engine.configure(m.slot, m.sample);
      } else if (m.type === "audibility") {
        for (const config of m.configs)
          this.engine.configure(config.slot, config.sample);
        a.clear_fx();
      } else if (m.type === "config") this.engine.configure(m.slot, m.sample);
      else if (m.type === "remove") {
        a.remove_sample(m.slot);
        this.mapping.delete(m.slot);
      } else if (m.type === "clear") {
        a.clear_samples();
        this.mapping.clear();
      } else if (m.type === "on")
        for (const slot of m.slots)
          a.trigger(slot, m.note, m.velocity, m.channel);
      else if (m.type === "off") a.release(m.note, m.channel);
      else if (m.type === "sustain") a.sustain(m.channel, m.down ? 1 : 0);
      else if (m.type === "panic") a.panic();
      else if (m.type === "stopSample") a.stop_sample(m.slot);
      else if (m.type === "settings") {
        a.set_master(m.master);
        for (let i = 0; i < 2; i++) a.set_fx(i, m.fx[i].time, m.fx[i].feedback);
      } else if (m.type === "record") {
        if (Number.isFinite(m.maxSeconds))
          this.maxFrames = Math.floor(
            sampleRate * Math.max(0.01, Math.min(180, m.maxSeconds)),
          );
        this.recordFrames = 0;
        this.recIndex = 0;
        this.recChannels = m.mode;
        this.threshold = 10 ** (m.threshold / 20);
        this.armed = m.arm;
        this.recording = !m.arm;
        if (this.recording) this.port.postMessage({ type: "recordStarted" });
      } else if (m.type === "recordStop") {
        this.flushRecord();
        this.recording = this.armed = false;
        this.port.postMessage({
          type: "recordDone",
          frames: this.recordFrames,
          rate: sampleRate,
        });
      }
    } catch (error) {
      this.port.postMessage({ type: "error", message: error.message });
    }
  }
  flushRecord() {
    if (!this.recIndex) return;
    const audio = this.recordBuffer.slice(0, this.recIndex);
    this.port.postMessage({ type: "recordChunk", audio }, [audio.buffer]);
    this.recIndex = 0;
  }
  process(inputs, outputs) {
    const output = outputs[0];
    if (!output?.length) return true;
    const n = output[0].length;
    try {
      const rendered = this.engine.output(n);
      output[0].set(rendered[0]);
      if (output[1]) output[1].set(rendered[1]);
      const input = inputs[0];
      let inputPeak = 0;
      for (let i = 0; i < n; i++) {
        let l = input?.[0]?.[i] ?? 0,
          r = input?.[1]?.[i] ?? l;
        if (this.recChannels === "Mono L") r = l;
        else if (this.recChannels === "Mono R") l = r;
        else if (this.recChannels === "Mono mix") l = r = (l + r) / 2;
        l *= this.inputGain;
        r *= this.inputGain;
        inputPeak = Math.max(inputPeak, Math.abs(l), Math.abs(r));
        if (
          this.armed &&
          Math.max(Math.abs(l), Math.abs(r)) >= this.threshold
        ) {
          this.armed = false;
          this.recording = true;
          this.port.postMessage({ type: "recordStarted" });
        }
        if (this.recording) {
          this.recordBuffer[this.recIndex++] = l;
          this.recordBuffer[this.recIndex++] = r;
          this.recordFrames++;
          if (this.recIndex === this.recordBuffer.length) this.flushRecord();
          if (this.recordFrames >= this.maxFrames) {
            this.flushRecord();
            this.recording = false;
            this.port.postMessage({
              type: "recordDone",
              frames: this.recordFrames,
              rate: sampleRate,
              limited: true,
            });
          }
        }
      }
      this.peak = Math.max(inputPeak, this.peak * 0.9);
      if ((this.counter += n) >= sampleRate / 25) {
        this.counter = 0;
        const notes = [];
        for (let i = 0; i < 128; i++)
          if (this.engine.api.note_active(i)) notes.push(i);
        const positions = {};
        for (const [slot, id] of this.mapping) {
          const p = this.engine.api.position(slot);
          if (p >= 0) positions[id] = p;
        }
        this.port.postMessage({
          type: "meter",
          peak: this.engine.api.output_peak(),
          inputPeak: this.peak,
          voices: this.engine.api.active_voices(),
          notes,
          positions,
        });
      }
    } catch (error) {
      for (const c of output) c.fill(0);
      if (!this.failed) {
        this.failed = true;
        this.port.postMessage({ type: "error", message: error.message });
      }
    }
    return true;
  }
}
registerProcessor("nico-sampler", SamplerProcessor);
