import {
  sample,
  uid,
  RATE,
  fitMarkers,
  assigned,
  validateSample,
} from "./model.js";
export function playbackParts(mode) {
  return {
    trigger: mode.startsWith("loop")
      ? "Loop"
      : mode.startsWith("hold")
        ? "Hold"
        : "One-shot",
    overlap: ["poly", "hold poly", "loop poly"].includes(mode)
      ? "Poly"
      : ["poly (key mono)", "hold mono", "loop mono"].includes(mode)
        ? "Key Mono"
        : "Mono",
  };
}
export function playbackMode(trigger, overlap) {
  return trigger === "One-shot"
    ? { Mono: "mono", Poly: "poly", "Key Mono": "poly (key mono)" }[overlap]
    : trigger.toLowerCase() +
        { Mono: "", Poly: " poly", "Key Mono": " mono" }[overlap];
}
export function newEmpty(name = "New Sample 1") {
  return { ...sample(name, null), level: 0.5 };
}
export function singleLoaded(source, file, audio) {
  const s = {
    ...source,
    audio,
    file_name: file.name.replace(/\.[^.]+$/, ""),
    audio_file: null,
    source_wav: null,
    recording_format: null,
    level: 0.5,
    trim_start: 0,
    trim_end: audio[0].length,
    loop_start: 0,
    loop_end: audio[0].length,
    reverse: false,
    crush_rate: source.crush_rate ?? RATE,
    crush_bits: source.crush_bits ?? 32,
    normalization: null,
    audio_dirty: false,
  };
  fitMarkers(s);
  return s;
}
export function sortedFiles(files) {
  return [...files].sort((a, b) => {
    const x = a.name.toLowerCase(),
      y = b.name.toLowerCase();
    return x < y
      ? -1
      : x > y
        ? 1
        : (a.webkitRelativePath ?? a.name).localeCompare(
            b.webkitRelativePath ?? b.name,
          );
  });
}
export function batchLoaded(source, items, start) {
  if (!Number.isInteger(start) || start < 0 || start + items.length > 128)
    throw Error(
      `Choose a lower root key: ${items.length} samples must fit below MIDI key 128.`,
    );
  return items.map(({ file, audio, source_wav }, i) => {
    const s = {
      ...source,
      id: uid(),
      name: file.name.replace(/\.[^.]+$/, ""),
      file_name: file.name.replace(/\.[^.]+$/, ""),
      audio,
      audio_file: null,
      source_wav: null,
      recording_format: null,
      level: 0.5,
      key: start + i,
      root_note: null,
      low_note: null,
      high_note: null,
      spread_settings: null,
      trim_start: 0,
      trim_end: audio[0].length,
      loop_start: 0,
      loop_end: audio[0].length,
      audio_dirty:
        !!source.reverse ||
        source.crush_rate !== RATE ||
        source.crush_bits !== 32,
    };
    fitMarkers(s);
    return s;
  });
}
export function overlapping(samples, source, notes) {
  return samples.filter(
    (s) => s !== source && notes.some((n) => assigned(s, n)),
  );
}
export function unassign(s) {
  s.key = s.root_note = s.low_note = s.high_note = null;
}
export function spreadSettings(parameter, values) {
  const numeric = (v) => {
    if (String(v).trim() === "") throw Error("Enter a number");
    const n = Number(v);
    if (!Number.isFinite(n)) throw Error("Enter a finite number");
    return n;
  };
  const q = { parameter };
  if (parameter !== "Pitch") {
    q.minimum = numeric(values.minimum);
    q.maximum = numeric(values.maximum);
    if (parameter === "Level") {
      q.minimum /= 100;
      q.maximum /= 100;
    }
    if (parameter.includes("Cutoff"))
      Object.assign(q, {
        resonance_min: numeric(values.resonance_min),
        resonance_max: numeric(values.resonance_max),
        coupled: !!values.coupled,
      });
  }
  const s = newEmpty();
  s.spread_settings = q;
  validateSample(s);
  if (q.coupled && q.resonance_min > q.resonance_max)
    throw Error("Minimum resonance must not exceed maximum resonance");
  return q;
}
export function spreadStep(parameter, notes, note) {
  if (parameter === "Pitch") {
    if (notes.length === 1 && note > notes[0])
      throw Error("The lower bound must be at or below the root.");
    if (notes.length === 2 && note < notes[0])
      throw Error("The upper bound must be at or above the root.");
  } else if (notes.length === 1 && note < notes[0])
    throw Error("The upper bound must be at or above the lower bound.");
  const next = [...notes, note],
    complete = next.length === (parameter === "Pitch" ? 3 : 2);
  return {
    notes: next,
    complete,
    ...(complete
      ? {
          root: next[0],
          low: parameter === "Pitch" ? next[1] : next[0],
          high: parameter === "Pitch" ? next[2] : next[1],
        }
      : {}),
  };
}
/** Plain audio learns consecutive keys; containers keep their own performance settings. */
export function mixedLoaded(source, items, start = 0) {
  const plain = items.filter((x) => !x.saved),
    rows = plain.length ? batchLoaded(source, plain, start) : [];
  let index = 0;
  return items.map((item) => {
    if (!item.saved) return rows[index++];
    const { audio, ...parameters } = item.saved.programs[0].samples[0];
    return { ...structuredClone(parameters), id: uid(), audio: item.audio };
  });
}
