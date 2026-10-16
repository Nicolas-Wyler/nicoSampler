import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  session,
  program,
  demoSamples,
  noteName,
  audioBytes,
} from "../src/model.js";
import { EXAMPLE_FX, EXAMPLE_KEYMAP } from "../src/example-kit.js";
import { metadata } from "../src/storage.js";
import { projectBundle, readProjectBundle } from "../src/project-bundle.js";
const directory = resolve(
  fileURLToPath(new URL("../examples/", import.meta.url)),
);
await mkdir(directory, { recursive: true });
const rows = demoSamples();
const state = (name, samples) => {
  const s = session(),
    p = program(name);
  p.samples = samples;
  p.selected = samples[0]?.id ?? null;
  s.programs = [p];
  s.current = p.id;
  s.source = "PC Keyboard";
  s.fx = structuredClone(EXAMPLE_FX);
  return s;
};
const drums = state("Original Circuit — Drums", rows.slice(0, 10));
const melodic = state("Original Circuit — Melodic", rows.slice(10));
const full = state("Original Circuit — Full Kit", rows);
const bank = state("Original Circuit — Drums", rows.slice(0, 10));
bank.programs.push(melodic.programs[0]);
const files = [];
for (const [filename, s, only] of [
  ["Original-Circuit-Bank.zip", bank, false],
  ["Original-Circuit-Drums.zip", drums, true],
  ["Original-Circuit-Melodic.zip", melodic, true],
  ["Original-Circuit-Full-Kit.zip", full, true],
]) {
  const raw = metadata(s, only),
    bundle = projectBundle(JSON.stringify(raw), s, only),
    contents = readProjectBundle(bundle);
  await writeFile(resolve(directory, filename), bundle);
  files.push({
    filename,
    type: raw.type,
    programs: s.programs.map((p) => p.name),
    rows: s.programs.reduce((n, p) => n + p.samples.length, 0),
    bytes: bundle.byteLength,
    sha256: createHash("sha256").update(bundle).digest("hex"),
    manifest:
      raw.type === "sample_bank" ? "project.nicosbank" : "project.nicoprog",
    entries: [...contents.files.keys()],
  });
}
const keymap = EXAMPLE_KEYMAP.map((d, i) => ({
  ...d,
  key: noteName(d.key),
  midi: d.key,
  range:
    d.low == null ? noteName(d.key) : `${noteName(d.low)}:${noteName(d.high)}`,
  root: d.low == null ? null : noteName(d.key),
  frames: rows[i].audio[0].length,
  level: rows[i].level,
  playback: rows[i].playback,
  pan: rows[i].pan,
}));
await writeFile(
  resolve(directory, "manifest.json"),
  JSON.stringify(
    {
      name: "Original Circuit",
      version: 1,
      provenance:
        "Original deterministic procedural synthesis in src/example-kit.js; no recordings or third-party audio.",
      sampleRate: 44100,
      pcmBytes: audioBytes([{ samples: rows }]),
      voices: rows.length,
      files,
      keymap,
    },
    null,
    2,
  ) + "\n",
);
const table = keymap
  .map(
    (d) =>
      `| ${d.name} | ${d.range} | ${d.root ?? "—"} | ${d.playback} | ${d.description} |`,
  )
  .join("\n");
await writeFile(
  resolve(directory, "README.md"),
  `# Original Circuit example bank\n\nAn original 16-voice kit generated entirely by the sampler's deterministic synthesis code. No external recordings, downloaded sample packs, or user audio are included. The bundled example sounds may be used in commercial music and performances under the project LICENSE. Software distribution and paid derivative products have separate terms; consult the release LICENSE.\n\n## Downloads\n\n- [Bank: Drums + Melodic](Original-Circuit-Bank.zip) — two program tabs, 16 voices total.\n- [Drums program](Original-Circuit-Drums.zip) — 10 drum voices.\n- [Melodic program](Original-Circuit-Melodic.zip) — six pitched/textural voices.\n- [Full Kit program](Original-Circuit-Full-Kit.zip) — all 16 voices in one tab, matching Load → Example kit.\n\nDrag a ZIP onto the landing screen or sample table, or use Load → Bank/Program. A bank replaces the open bank after confirmation; programs append tabs. Each archive contains its root project manifest, original raw WAVs, and non-destructive .nicosample containers in project-relative folders. Do not move individual assets out of their folders.\n\n## Colors\n\nRelated hi-hats, toms, snare/clap/rim and percussion share preset colors across the bank and programs. Spread instruments use one color per range. Click a sample color marker to customize it.\n\n## Playing\n\nAt the default PC-keyboard octave, A/W/S/E/D/F/T/G/Z/H trigger kick/rim/snare/clap/closed hat/open hat/low tom/high tom/shaker/metal. U triggers the fifth chord, J the sweep, and K/O/L the looping pad. The open hat uses key-mono retrigger; it is not a closed/open mutual-choke group.\n\nClick ← Octave twice for the C2 bass range; once for the C3 pluck. Click → Octave twice for the C6 bell. The on-screen keyboard and MIDI can reach every range directly. Hold pad notes for looping sustain, then release for a soft tail. Velocity remains expressive (Max is off). Every row starts at 50% level. Stereo voices, pan, envelopes, filters, and restrained delay sends demonstrate reusable non-destructive settings.\n\nIn the two-program bank, switch between Drums and Melodic to play each section; the Full Kit program combines their mappings in one tab. Load → Example kit adds the full kit to the current program. Existing program audio/settings are retained; an otherwise empty session also receives the kit's shared delay settings.\n\n| Voice | Trigger range | Root | Playback | Sound |\n| --- | --- | --- | --- | --- |\n${table}\n\n## Rebuild and inspect\n\nRun \`node scripts/build-examples.mjs\` from the sampler folder. Source: [example-kit.js](../src/example-kit.js). Audio rate: 44,100 Hz; ${rows.length} stereo voices; ${audioBytes([{ samples: rows }])} bytes of decoded PCM (under 15 MB). Archive assets use raw 32-bit floating-point WAV, preserving the generated source before sampler processing. [manifest.json](manifest.json) lists frame counts, mappings, archive entries, sizes and SHA-256 hashes. Rebuilding with the same source produces identical archive bytes.\n`,
);
console.log(
  JSON.stringify(
    files.map(({ filename, bytes, sha256 }) => ({ filename, bytes, sha256 })),
    null,
    2,
  ),
);
