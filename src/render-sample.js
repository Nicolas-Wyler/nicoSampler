import { isSampleMuted, renderRows } from "./sample-audibility.js";
import { WasmEngine, compileEngine, interleave } from "./wasm-engine.js";
import { bounds, fitMarkers, RATE } from "./model.js";
let compiled;
const BLOCK = 128,
  QUIET = 1e-5,
  MAX_BYTES = 128 * 1048576;
/** Render a finite audition through the exact live WASM DSP, without touching live state. */
export async function renderSample(sample, state, outputRate = RATE) {
  if (!Number.isInteger(outputRate) || outputRate < 8000 || outputRate > 192000)
    throw Error("Unsupported render sample rate");
  if (!sample.audio?.[0]?.length)
    throw Error("Load a sample before resampling");
  const source = sample.audio;
  if (
    source[0].length > RATE * 600 ||
    source.reduce((n, c) => n + c.byteLength, 0) > MAX_BYTES
  )
    throw Error("Source exceeds resampling limit");
  for (const channel of source)
    for (const value of channel)
      if (!Number.isFinite(value)) throw Error("Non-finite source audio");
  const settings = { ...sample, audio: source };
  fitMarkers(settings);
  const [start, end] = bounds(settings),
    pitch = settings.semitone + settings.fine / 100;
  const speed = (2 ** (pitch / 12) * RATE) / outputRate;
  if (!Number.isFinite(speed) || speed <= 0)
    throw Error("Invalid sample pitch");
  const dryFrames = Math.ceil((end - start) / speed),
    maxFrames = Math.min(outputRate * 600, Math.floor(MAX_BYTES / 8));
  if (dryFrames > maxFrames)
    throw Error("Rendered sample exceeds 600 seconds or 128 MB");
  if (isSampleMuted(sample, renderRows(state, sample)))
    return [
      new Float32Array(Math.max(1, dryFrames)),
      new Float32Array(Math.max(1, dryFrames)),
    ];
  compiled ??= compileEngine().catch((error) => {
    compiled = null;
    throw error;
  });
  const engine = new WasmEngine(await compiled, outputRate);
  const chunks = [[], []];
  let total = 0,
    lastAudible = 0,
    quiet = 0,
    voicesEnded = null;
  try {
    engine.load(0, interleave(source));
    engine.configure(0, settings);
    engine.api.prepare(0);
    engine.api.set_master(state.master ?? 1);
    const fx = state.fx ?? [
      { time: 0.3, feedback: 0.35 },
      { time: 0.3, feedback: 0.35 },
    ];
    fx.forEach((effect, index) =>
      engine.api.set_fx(index, effect.time, effect.feedback),
    );
    const wet1 = settings.fx1 > 0 && fx[0]?.feedback > 0,
      wet2 = settings.fx2 > 0 && fx[1]?.feedback > 0;
    const wait = (wet1 ? fx[0].time : 0) + (wet2 ? fx[1].time : 0);
    const quietNeeded = Math.ceil(Math.max(0.5, wait + 0.1) * outputRate);
    const loop = settings.playback.startsWith("loop");
    let releaseAt = loop
      ? Math.max(1, Math.ceil((settings.loop_end - start) / speed))
      : Infinity;
    const note = settings.root_note ?? settings.key ?? 60;
    engine.api.trigger(0, note, 127, 0);
    while (total < maxFrames) {
      if (total >= releaseAt) {
        engine.api.release(note, 0);
        releaseAt = Infinity;
      }
      const count = Math.min(BLOCK, maxFrames - total, releaseAt - total);
      const block = engine.output(count);
      let audible = false;
      for (let c = 0; c < 2; c++) {
        const data = block[c].slice();
        for (let i = 0; i < count; i++) {
          if (!Number.isFinite(data[i]))
            throw Error("Non-finite resampled audio");
          if (Math.abs(data[i]) >= QUIET) {
            audible = true;
            lastAudible = Math.max(lastAudible, total + i + 1);
          }
        }
        chunks[c].push(data);
      }
      total += count;
      if (!engine.api.active_voices()) {
        voicesEnded ??= total;
        quiet = audible ? 0 : quiet + count;
        if (quiet >= quietNeeded || total - voicesEnded >= outputRate * 10)
          break;
      }
    }
    if (engine.api.active_voices())
      throw Error("Rendered sample exceeded its duration limit");
    const length = Math.min(total, Math.max(dryFrames, lastAudible, 1));
    return chunks.map((parts) => {
      const channel = new Float32Array(length);
      let offset = 0;
      for (const part of parts) {
        const count = Math.min(part.length, length - offset);
        if (count <= 0) break;
        channel.set(part.subarray(0, count), offset);
        offset += count;
      }
      return channel;
    });
  } finally {
    engine.api.clear_samples();
    engine.api.deallocate(engine.configPtr);
  }
}
