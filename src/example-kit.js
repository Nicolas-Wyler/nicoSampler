// Original deterministic synthesis. No recordings, downloaded assets or user audio.
export const EXAMPLE_FX = [
  { time: 0.25, feedback: 0.24 },
  { time: 0.375, feedback: 0.32 },
];
export const EXAMPLE_KEYMAP = [
  {
    name: "Punch Kick",
    key: 60,
    seconds: 0.85,
    group: "drums",
    description: "Pitch-diving sine body with a soft transient",
  },
  {
    name: "Maple Rim",
    key: 61,
    seconds: 0.18,
    group: "drums",
    description: "Short woody inharmonic rim",
  },
  {
    name: "Velvet Snare",
    key: 62,
    seconds: 0.42,
    group: "drums",
    description: "Tuned body with filtered noise wires",
  },
  {
    name: "Room Clap",
    key: 63,
    seconds: 0.58,
    group: "drums",
    description: "Four staggered noise bursts and stereo room tail",
  },
  {
    name: "Closed Hat",
    key: 64,
    seconds: 0.16,
    group: "drums",
    description: "High-pass noise and six metallic oscillators",
  },
  {
    name: "Open Hat",
    key: 65,
    seconds: 1.15,
    group: "drums",
    description: "Long metallic hat; Key Mono retrigger",
  },
  {
    name: "Low Tom",
    key: 66,
    seconds: 0.7,
    group: "drums",
    description: "Low resonant tom with pitch fall",
  },
  {
    name: "High Tom",
    key: 67,
    seconds: 0.48,
    group: "drums",
    description: "Higher resonant tom with pitch fall",
  },
  {
    name: "Seed Shaker",
    key: 68,
    seconds: 0.28,
    group: "drums",
    description: "Double noise gesture with a stereo offset",
  },
  {
    name: "Alloy Perc",
    key: 69,
    seconds: 1.25,
    group: "drums",
    description: "Bell-like inharmonic metal percussion",
  },
  {
    name: "Warm Bass",
    key: 36,
    low: 36,
    high: 47,
    seconds: 1.2,
    group: "melodic",
    description: "C2 triangle/sine bass, pitch spread C2:B2",
  },
  {
    name: "Glass Pluck",
    key: 48,
    low: 48,
    high: 59,
    seconds: 0.95,
    group: "melodic",
    description: "C3 harmonic pluck, pitch spread C3:B3",
  },
  {
    name: "Fifth Stab",
    key: 70,
    seconds: 0.85,
    group: "melodic",
    description: "Stereo C4/G4 chord, single-key trigger A#4",
  },
  {
    name: "Echo Sweep",
    key: 71,
    seconds: 1.8,
    group: "melodic",
    description: "Stereo rising noise and chirped partials",
  },
  {
    name: "Air Pad",
    key: 72,
    low: 72,
    high: 83,
    seconds: 2,
    group: "melodic",
    description: "Periodic stereo C5 pad, pitch spread C5:B5; loops while held",
  },
  {
    name: "Prism Bell",
    key: 84,
    low: 84,
    high: 95,
    seconds: 0.9,
    group: "melodic",
    description: "Stereo C6 FM bell, pitch spread C6:B6",
  },
];
const TAU = 2 * Math.PI;
const noteHz = (n) => 440 * 2 ** ((n - 69) / 12);
const seeded = (seed) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2147483648 - 1;
};
const sine = (f, t) => Math.sin(TAU * f * t);
const triangle = (f, t) => (2 / Math.PI) * Math.asin(sine(f, t));
const hit = (t, start, decay) =>
  t < start ? 0 : Math.exp(-(t - start) * decay);
function synth(index, rate, seconds) {
  const length = Math.round(rate * seconds),
    left = new Float32Array(length),
    right = new Float32Array(length),
    noise = seeded(0x4e49434f + index * 7919);
  let phase = 0,
    previous = 0,
    low = 0;
  for (let i = 0; i < length; i++) {
    const t = i / rate,
      n = noise();
    low += 0.12 * (n - low);
    const hp = n - previous;
    previous = n;
    let a = 0,
      b = null;
    if (index === 0) {
      phase += (TAU * (46 + 132 * Math.exp(-t * 38))) / rate;
      a =
        0.86 * Math.sin(phase) * Math.exp(-t * 8) +
        hp * 0.075 * Math.exp(-t * 170);
    } else if (index === 1)
      a =
        (sine(820, t) * 0.56 + sine(1217, t) * 0.28 + hp * 0.11) *
        Math.exp(-t * 45);
    else if (index === 2)
      a =
        0.25 * sine(181, t) * Math.exp(-t * 21) +
        0.12 * sine(327, t) * Math.exp(-t * 28) +
        0.58 * (n - low) * Math.exp(-t * 13);
    else if (index === 3) {
      const env = [0, 0.012, 0.025, 0.039].reduce(
        (sum, start) => sum + hit(t, start, 125),
        0,
      );
      a = (n - low) * (0.32 * env + 0.19 * hit(t, 0.04, 11));
      b = hp * 0.17 * env + (n - low) * 0.22 * hit(t, 0.046, 10);
    } else if (index === 4 || index === 5) {
      const metal =
        [4019, 5381, 6317, 7811, 8933, 10301].reduce(
          (sum, f) => sum + Math.sign(sine(f, t)),
          0,
        ) / 6;
      a = (0.16 * metal + 0.24 * hp) * Math.exp(-t * (index === 4 ? 48 : 6.4));
    } else if (index === 6 || index === 7) {
      const base = index === 6 ? 94 : 151;
      phase += (TAU * (base + base * 0.7 * Math.exp(-t * 28))) / rate;
      a =
        (0.76 * Math.sin(phase) + 0.1 * sine(base * 1.53, t)) *
          Math.exp(-t * (index === 6 ? 9 : 12)) +
        hp * 0.025 * Math.exp(-t * 100);
    } else if (index === 8) {
      const env = hit(t, 0, 32) + 0.75 * hit(t, 0.071, 27);
      a = hp * 0.29 * env;
      b = (n - low) * 0.35 * (hit(t, 0.004, 32) + 0.75 * hit(t, 0.077, 27));
    } else if (index === 9) {
      a =
        (sine(541, t) * 0.32 +
          sine(817, t) * 0.18 +
          sine(1291, t) * 0.12 +
          sine(2333, t) * 0.07) *
        Math.exp(-t * 5);
      b =
        (sine(543, t) * 0.32 +
          sine(821, t) * 0.18 +
          sine(1297, t) * 0.12 +
          sine(2341, t) * 0.07) *
        Math.exp(-t * 5.2);
    } else if (index === 10) {
      const f = noteHz(36);
      a =
        (sine(f, t) * 0.52 + triangle(f, t) * 0.19 + sine(f * 2, t) * 0.09) *
        Math.exp(-t * 1.1);
    } else if (index === 11) {
      const f = noteHz(48);
      a =
        (sine(f, t) * 0.47 +
          sine(f * 2, t) * 0.2 * Math.exp(-t * 6) +
          sine(f * 3, t) * 0.1 * Math.exp(-t * 12) +
          sine(f * 5, t) * 0.05 * Math.exp(-t * 18)) *
        Math.exp(-t * 3.3);
      b =
        (sine(f, t) * 0.47 +
          sine(f * 2.003, t) * 0.2 * Math.exp(-t * 6) +
          sine(f * 3.004, t) * 0.1 * Math.exp(-t * 12)) *
        Math.exp(-t * 3.3);
    } else if (index === 12) {
      const f = noteHz(60);
      a =
        (sine(f, t) * 0.28 +
          sine(f * 1.5, t) * 0.22 +
          triangle(f * 2, t) * 0.1) *
        Math.exp(-t * 4.3);
      b =
        (sine(f * 1.001, t) * 0.28 +
          sine(f * 1.502, t) * 0.22 +
          triangle(f * 2.001, t) * 0.1) *
        Math.exp(-t * 4.3);
    } else if (index === 13) {
      const env = Math.sin((Math.PI * t) / seconds) ** 2;
      phase += (TAU * (180 + 1900 * (t / seconds) ** 2)) / rate;
      a = (Math.sin(phase) * 0.18 + (n - low) * 0.11) * env;
      b =
        (Math.sin(phase + 0.9 * Math.sin(TAU * 0.7 * t)) * 0.18 + hp * 0.08) *
        env;
    } else if (index === 14) {
      a =
        sine(523, t) * 0.28 +
        sine(523.5, t) * 0.1 +
        sine(1046, t) * 0.07 +
        sine(1569, t) * 0.035;
      b =
        sine(523, t) * 0.28 +
        sine(522.5, t) * 0.1 +
        sine(1046.5, t) * 0.07 +
        sine(1569.5, t) * 0.035;
    } else {
      const f = noteHz(84),
        mod = 2.1 * Math.exp(-t * 7);
      a =
        Math.sin(TAU * f * t + mod * sine(f * 2.003, t)) *
        0.6 *
        Math.exp(-t * 5);
      b =
        Math.sin(TAU * f * t + mod * sine(f * 1.997, t)) *
        0.6 *
        Math.exp(-t * 5);
    }
    // Non-loop sources have short click-free endpoints; the pad itself is periodic.
    const fade =
      index === 14
        ? 1
        : Math.min(1, i / (rate * 0.0015), (length - 1 - i) / (rate * 0.012));
    left[i] = a * fade;
    right[i] = (b ?? a) * fade;
  }
  let peak = 0;
  for (let i = 0; i < length; i++)
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  const gain = peak > 0.82 ? 0.82 / peak : 1;
  for (let i = 0; i < length; i++) {
    left[i] *= gain;
    right[i] *= gain;
  }
  return [left, right];
}
/** Inject the app's sample factory to avoid a model/generator import cycle. */
export function generateExampleKit(makeSample, rate = 44100) {
  return EXAMPLE_KEYMAP.map((definition, index) => {
    const s = makeSample(definition.name, definition.key);
    s.audio = synth(index, rate, definition.seconds);
    Object.assign(s, {
      level: 0.5,
      color_group: [
        "kick", "snare", "snare", "snare", "hats", "hats", "toms", "toms",
        "percussion", "percussion", "bass", "pluck", "chord", "fx", "pad", "bell",
      ][index],
      color: [
        "#E4B36B", "#E8919E", "#E8919E", "#E8919E", "#77C7D3", "#77C7D3",
        "#BC9CE6", "#BC9CE6", "#A9CB75", "#A9CB75", "#7CACE3", "#78C9A7",
        "#D4A6D7", "#C4BD79", "#A6B4E7", "#DFA4BE",
      ][index],
      trim_start: 0,
      trim_end: s.audio[0].length,
      loop_start: 0,
      loop_end: s.audio[0].length,
      file_name: definition.name + ".wav",
      sampleRate: rate,
      attack_ms: 1.5,
      decay_ms: 12,
      playback: "poly",
      pan: [
        0, -0.12, 0, 0.1, -0.2, 0.18, -0.25, 0.25, 0.3, -0.22, 0, -0.12, 0.12,
        0, 0, 0.22,
      ][index],
    });
    if (index === 5) s.playback = "poly (key mono)";
    if (index === 10)
      Object.assign(s, {
        playback: "hold mono",
        attack_ms: 5,
        decay_ms: 75,
        lpf_cutoff: 1600,
        lpf_resonance: 0.4,
      });
    if (index === 11)
      Object.assign(s, {
        attack_ms: 2,
        decay_ms: 28,
        lpf_cutoff: 6500,
        lpf_resonance: 0.18,
        fx1: 0.16,
      });
    if (index === 12)
      Object.assign(s, {
        attack_ms: 4,
        decay_ms: 45,
        lpf_cutoff: 4300,
        lpf_resonance: 0.25,
        fx1: 0.12,
      });
    if (index === 13)
      Object.assign(s, {
        attack_ms: 15,
        decay_ms: 90,
        filter_mode: "HPF",
        lpf_cutoff: 220,
        lpf_resonance: 0.12,
        fx2: 0.12,
      });
    if (index === 14)
      Object.assign(s, {
        playback: "loop poly",
        attack_ms: 85,
        decay_ms: 140,
        lpf_cutoff: 3600,
        lpf_resonance: 0.16,
        fx1: 0.12,
        fx2: 0.08,
      });
    if (index === 15)
      Object.assign(s, {
        attack_ms: 2,
        decay_ms: 30,
        lpf_cutoff: 11000,
        lpf_resonance: 0.08,
        fx2: 0.17,
      });
    if (definition.low != null)
      Object.assign(s, {
        root_note: definition.key,
        low_note: definition.low,
        high_note: definition.high,
        spread_settings: { parameter: "Pitch" },
      });
    return s;
  });
}
