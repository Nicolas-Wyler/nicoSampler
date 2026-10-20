import { processingSampleFormat } from "./render-options.js";
import { generateExampleKit } from "./example-kit.js";
import { applyPreferences } from "./settings.js";
export const RATE = 44100;
export const MODES = [
  "mono",
  "poly",
  "poly (key mono)",
  "hold",
  "hold mono",
  "hold poly",
  "loop",
  "loop mono",
  "loop poly",
];
export const MODE_NAMES = [
  "One-shot · Mono",
  "One-shot · Poly",
  "One-shot · Key mono",
  "Hold · Mono",
  "Hold · Key mono",
  "Hold · Poly",
  "Loop · Mono",
  "Loop · Key mono",
  "Loop · Poly",
];
export const SPREADS = [
  "Pitch",
  "Level",
  "LPF Cutoff",
  "HPF Cutoff",
  "Attack",
  "Decay",
];
export const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  `s${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const noteName = (n) =>
  n == null
    ? "—"
    : ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][
        n % 12
      ] +
      (Math.floor(n / 12) - 1);
export function sample(name = "New sample", key = 60) {
  return {
    id: uid(),
    name,
    key,
    level: 1,
    mute: false,
    solo: false,
    color: null,
    color_group: null,
    max_velocity: false,
    pan: 0,
    mono: false,
    mono_channel: "mix",
    wave_view: "mixed",
    source_wav: null,
    recording_format: null,
    fx1: 0,
    fx2: 0,
    semitone: 0,
    fine: 0,
    lpf_cutoff: null,
    lpf_resonance: 0,
    filter_mode: "LPF",
    root_note: null,
    low_note: null,
    high_note: null,
    spread_settings: null,
    playback: "mono",
    attack_ms: 0,
    decay_ms: 0,
    trim_start: 0,
    trim_end: null,
    loop_start: null,
    loop_end: null,
    reverse: false,
    crush_rate: RATE,
    crush_bits: 32,
    normalization: null,
    file_name: "",
    audio_file: null,
    audio: null,
    sampleRate: RATE,
  };
}
export function program(name = "Program 1") {
  return { id: uid(), name, channel: "All", selected: null, samples: [] };
}
export function session() {
  const p = program();
  return {
    type: "sample_bank",
    version: 3,
    takes: [],
    programs: [p],
    current: p.id,
    fx: [
      { time: 0.3, feedback: 0 },
      { time: 0.3, feedback: 0 },
    ],
    octave: 0,
    master: 0.5,
    record: {
      source: "mic",
      device: "",
      mode: "Stereo",
      threshold: -24,
      sample_rate: 44100,
      bit_depth: 16,
    },
  };
}
export function bounds(s) {
  const n = s.audio?.[0]?.length ?? 0;
  return [
    clamp(s.trim_start, 0, Math.max(0, n - 1)),
    clamp(s.trim_end ?? n, 1, Math.max(1, n)),
  ];
}
export function assigned(s, n) {
  return s.root_note == null
    ? s.key === n
    : n >= s.low_note && n <= s.high_note;
}
export function parameter(s, n, name) {
  const settings = s.spread_settings;
  if (!settings || s.root_note == null || n == null) return s[name];
  const t = clamp(
    (n - s.low_note) / Math.max(1, s.high_note - s.low_note),
    0,
    1,
  );
  const v =
    (settings.minimum ?? 0) +
    ((settings.maximum ?? 0) - (settings.minimum ?? 0)) * t;
  const mapping = { Level: "level", Attack: "attack_ms", Decay: "decay_ms" };
  if (mapping[settings.parameter] === name) return v;
  if (settings.parameter.includes("Cutoff")) {
    if (name === "lpf_cutoff") return v;
    if (name === "filter_mode") return settings.parameter.slice(0, 3);
    if (name === "lpf_resonance")
      return settings.coupled
        ? settings.resonance_min +
            (settings.resonance_max - settings.resonance_min) * t
        : settings.resonance_max;
  }
  return s[name];
}
function number(v, lo, hi, label, integer = false) {
  if (
    typeof v !== "number" ||
    !Number.isFinite(v) ||
    v < lo ||
    v > hi ||
    (integer && !Number.isInteger(v))
  )
    throw Error(`Invalid ${label}`);
  return v;
}
export function validateSample(raw) {
  if (!raw || typeof raw !== "object") throw Error("Invalid sample");
  const s = { ...sample(), ...raw, id: uid(), audio: null, sampleRate: RATE };
  if (
    s.source_wav != null &&
    !(s.source_wav instanceof ArrayBuffer) &&
    !(s.source_wav instanceof Uint8Array)
  )
    throw Error("Invalid source WAV");
  if (typeof s.mute !== "boolean" || typeof s.solo !== "boolean")
    throw Error("Invalid mute/solo setting");
  if (
    s.color != null &&
    (typeof s.color !== "string" || !/^#[0-9a-f]{6}$/i.test(s.color))
  )
    throw Error("Invalid sample color");
  if (s.color != null) s.color = s.color.toUpperCase();
  if (
    s.color_group != null &&
    (typeof s.color_group !== "string" ||
      !s.color_group.trim() ||
      s.color_group.length > 80 ||
      /[\u0000-\u001f\u007f]/.test(s.color_group))
  )
    throw Error("Invalid sample color group");
  if (s.color_group != null) s.color_group = s.color_group.trim();
  // Explicit mute wins for ambiguous imported settings.
  if (s.mute) s.solo = false;
  delete s.effective_mute;
  delete s.audition_source_id;
  s.name = String(s.name).slice(0, 200);
  s.file_name = String(s.file_name ?? "").slice(0, 300);
  for (const k of ["level", "fx1", "fx2"]) number(s[k], 0, 1, k);
  number(s.pan, -1, 1, "pan");
  s.mono_channel ??= "mix";
  if (!["mix", "left", "right"].includes(s.mono_channel))
    throw Error("Invalid mono channel");
  if (typeof s.mono !== "boolean" || !["mixed", "split"].includes(s.wave_view))
    throw Error("Invalid channel mode/view");
  number(s.semitone, -48, 48, "pitch", true);
  number(s.fine, -100, 100, "fine pitch", true);
  number(s.crush_rate, 100, RATE, "crush rate", true);
  number(s.crush_bits, 1, 32, "bit depth", true);
  number(s.lpf_resonance, 0, 10, "resonance");
  if (s.lpf_cutoff != null) number(s.lpf_cutoff, 20, 21950, "cutoff");
  if (!["LPF", "HPF"].includes(s.filter_mode) || !MODES.includes(s.playback))
    throw Error("Invalid playback/filter mode");
  for (const k of ["attack_ms", "decay_ms"])
    number(s[k], 0, Number.MAX_VALUE, k);
  for (const k of ["key", "root_note", "low_note", "high_note"])
    if (s[k] != null) number(s[k], 0, 127, k, true);
  if (
    [s.root_note, s.low_note, s.high_note].some((v) => v != null) &&
    !(
      s.root_note != null &&
      s.low_note != null &&
      s.high_note != null &&
      s.low_note <= s.root_note &&
      s.root_note <= s.high_note
    )
  )
    throw Error("Invalid key range");
  for (const k of ["trim_start", "trim_end", "loop_start", "loop_end"])
    if (s[k] != null) number(s[k], 0, 2 ** 31, k, true);
  if (s.trim_end != null && s.trim_start >= s.trim_end)
    throw Error("Invalid trim bounds");
  s.reverse = !!s.reverse;
  s.max_velocity = !!s.max_velocity;
  s.normalization = s.normalization ? [0, 1, 1] : null;
  if (s.spread_settings) {
    const q = s.spread_settings;
    if (!SPREADS.includes(q.parameter)) throw Error("Invalid spread");
    if (q.parameter !== "Pitch") {
      const hi =
          q.parameter === "Level"
            ? 1
            : q.parameter.includes("Cutoff")
              ? 21950
              : Number.MAX_VALUE,
        lo = q.parameter.includes("Cutoff") ? 20 : 0;
      number(q.minimum, lo, hi, "spread minimum");
      number(q.maximum, q.minimum, hi, "spread maximum");
      if (q.parameter.includes("Cutoff")) {
        q.resonance_min ??= 0;
        q.resonance_max ??= 0;
        number(q.resonance_min, 0, 10, "spread resonance");
        number(q.resonance_max, 0, 10, "spread resonance");
      }
    }
    s.spread_settings = { ...q };
  }
  return s;
}
export function fitMarkers(s) {
  if (!s.audio?.[0]?.length) return;
  const n = s.audio[0].length;
  s.trim_start = clamp(s.trim_start, 0, n - 1);
  s.trim_end = clamp(s.trim_end ?? n, s.trim_start + 1, n);
  if (!s.playback.startsWith("loop")) {
    s.loop_start = clamp(s.loop_start ?? s.trim_start, 0, n);
    s.loop_end = clamp(s.loop_end ?? s.trim_end, 0, n);
  } else {
    s.loop_start = clamp(s.loop_start ?? s.trim_start, 0, s.trim_end - 1);
    s.loop_end = clamp(s.loop_end ?? s.trim_end, s.loop_start + 1, s.trim_end);
  }
}
export function validateBank(raw) {
  if (
    !raw ||
    !["sample_bank", "sample_program"].includes(raw.type) ||
    ![1, 2, 3].includes(raw.version)
  )
    throw Error("Unsupported sampler file");
  if (raw.type === "sample_bank" && raw.version === 1)
    throw Error(
      "Legacy v1 bank: import its individual .nicoprog files instead",
    );
  const entries = raw.type === "sample_program" ? [raw] : raw.programs;
  if (!Array.isArray(entries) || !entries.length || entries.length > 128)
    throw Error("Bank must contain 1–128 programs");
  const state = session();
  state.programs = entries.map((p) => {
    if (!Array.isArray(p.samples) || p.samples.length > 512)
      throw Error("Invalid sample list (maximum 512 per program)");
    const channel = String(p.channel ?? "All");
    if (
      ![
        "All",
        "None",
        ...Array.from({ length: 16 }, (_, i) => String(i + 1)),
      ].includes(channel)
    )
      throw Error("Invalid MIDI channel");
    const q = {
      ...program(String(p.name ?? "Program").slice(0, 200)),
      channel,
      samples: p.samples.map(validateSample),
    };
    q.selected =
      q.samples[Number.isInteger(p.selected) ? p.selected : -1]?.id ?? null;
    return q;
  });
  const currentIndex = number(
    raw.currentIndex ?? 0,
    0,
    state.programs.length - 1,
    "selected program",
    true,
  );
  state.current = state.programs[currentIndex].id;
  state.fx = structuredClone(raw.fx ?? entries[0].settings?.fx ?? state.fx);
  if (!Array.isArray(state.fx) || state.fx.length !== 2)
    throw Error("Expected two FX slots");
  for (const f of state.fx) {
    number(f.time, 0.001, 1.5, "delay time");
    number(f.feedback, 0, 2, "feedback");
  }
  state.master = number(raw.master ?? 1, 0, 1, "master level");
  applyPreferences(state, {
    ...raw,
    columns: raw.columns ?? entries[0].settings?.column_widths,
  });
  return state;
}
// Process source audio off the real-time thread. Edits remain non-destructive.
function roundEven(x) {
  const lo = Math.floor(x),
    f = x - lo;
  return f === 0.5 ? (lo % 2 === 0 ? lo : lo + 1) : Math.round(x);
}
export function processAudio(s) {
  if (!s.audio) return null;
  const len = s.audio[0].length,
    [start, end] = bounds(s),
    out = [new Float32Array(len), new Float32Array(len)],
    format = processingSampleFormat(s),
    rate = format.rate;
  let peak = 0;
  const scale = 2 ** (format.bits - 1);
  for (let i = 0; i < len; i++) {
    const frame = s.reverse ? len - 1 - i : i,
      held =
        rate < RATE
          ? Math.floor((Math.floor((frame * rate) / RATE) * RATE) / rate)
          : frame;
    for (let c = 0; c < 2; c++) {
      let v = s.audio[c]?.[held] ?? s.audio[0][held];
      if (format.bits < 32)
        v = clamp(roundEven(v * scale), -scale, scale - 1) / scale;
      out[c][i] = v;
      if (i >= start && i < end) peak = Math.max(peak, Math.abs(v));
    }
  }
  if (s.normalization && peak > 0)
    for (let c = 0; c < 2; c++)
      for (let i = start; i < end; i++) out[c][i] /= peak;
  return out;
}
export function encodeWav(audio, rate = RATE) {
  const n = audio[0].length,
    bytes = new ArrayBuffer(44 + n * 8),
    v = new DataView(bytes);
  const text = (p, t) => {
    for (let i = 0; i < t.length; i++) v.setUint8(p + i, t.charCodeAt(i));
  };
  text(0, "RIFF");
  v.setUint32(4, 36 + n * 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 3, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 8, true);
  v.setUint16(32, 8, true);
  v.setUint16(34, 32, true);
  text(36, "data");
  v.setUint32(40, n * 8, true);
  for (let i = 0; i < n; i++)
    for (let c = 0; c < 2; c++)
      v.setFloat32(44 + i * 8 + c * 4, audio[c]?.[i] ?? audio[0][i], true);
  return bytes;
}
export function demoSamples() {
  return generateExampleKit(sample, RATE);
}

// Count unique backing buffers: a take used as a sample shares its PCM rather
// than spending the budget twice. Replacements may still be retained as takes.
export function audioBytes(
  programs,
  takes = [],
  additional = null,
  replacing = null,
  additionalSource = null,
) {
  const buffers = new Set();
  const entries = [
    ...programs.flatMap((p) =>
      p.samples.filter((s) => s !== replacing).map((s) => s.audio),
    ),
    ...takes.map((t) => t.audio),
    additional,
  ];
  for (const audio of entries)
    if (audio) for (const channel of audio) buffers.add(channel.buffer);
  for (const raw of [
    ...programs.flatMap((p) =>
      p.samples.filter((s) => s !== replacing).map((s) => s.source_wav),
    ),
    ...takes.map((t) => t.source_wav),
    additionalSource,
  ]) {
    if (raw instanceof ArrayBuffer) buffers.add(raw);
    else if (ArrayBuffer.isView(raw)) buffers.add(raw.buffer);
  }
  return [...buffers].reduce((sum, b) => sum + b.byteLength, 0);
}
export function validateTakes(raw = []) {
  if (!Array.isArray(raw) || raw.length > 512)
    throw Error("Invalid recovered take library");
  for (const t of raw) {
    if (
      typeof t.id !== "string" ||
      typeof t.name !== "string" ||
      !Array.isArray(t.audio) ||
      t.audio.length !== 2 ||
      !t.audio.every((c) => c instanceof Float32Array) ||
      !t.audio[0].length ||
      t.audio[0].length !== t.audio[1].length ||
      t.audio[0].length > RATE * 180
    )
      throw Error("Invalid recovered recording");
    for (const c of t.audio)
      for (const v of c)
        if (!Number.isFinite(v)) throw Error("Invalid recorded audio");
  }
  return raw;
}
