import { readProjectBundle } from "./project-bundle.js";
import { rawWave } from "./sample-container.js";
import {
  validateBank,
  validateSample,
  fitMarkers,
  audioBytes,
  uid,
} from "./model.js";
export function validAssetPath(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    !/[\\\u0000-\u001f:]/.test(path) &&
    !path.startsWith("/") &&
    path.split("/").every((x) => x && x !== "." && x !== "..")
  );
}
export function referencedRecordings(raw) {
  if (raw.recordings == null) return [];
  if (!Array.isArray(raw.recordings) || raw.recordings.length > 512)
    throw Error("Invalid recorded-take list");
  return raw.recordings.map((r) => validateSample(r));
}
export function validateRelativeAssets(state, recordings = []) {
  for (const s of [
    ...state.programs.flatMap((p) => p.samples),
    ...recordings,
  ]) {
    if (s.audio_file != null && !validAssetPath(s.audio_file))
      throw Error("Invalid project-relative audio path");
    if (s.container_file != null && !validAssetPath(s.container_file))
      throw Error("Invalid project-relative container path");
  }
}
/** Validate the manifest, paths and all referenced audio before touching the session. */
export function importProjectBundle(buffer, expectedType) {
  const { project, files } = readProjectBundle(buffer),
    raw = JSON.parse(project);
  if (!["sample_program", "sample_bank"].includes(raw.type))
    throw Error("ZIP project has an unsupported type");
  const expected = expectedType ?? raw.type,
    filename =
      expected === "sample_bank" ? "project.nicosbank" : "project.nicoprog";
  if (!files.has(filename) || raw.type !== expected)
    throw Error(
      `ZIP must contain ${filename} at its root for this Load choice.`,
    );
  if (raw.asset_layout !== "relative-v1")
    throw Error("Unsupported project ZIP asset layout");
  const state = validateBank(raw),
    recordings = referencedRecordings(raw);
  validateRelativeAssets(state, recordings);
  let total = 0;
  for (const s of [
    ...state.programs.flatMap((p) => p.samples),
    ...recordings,
  ]) {
    if (!s.audio_file) continue;
    const wav = files.get(s.audio_file);
    if (!wav) throw Error(`ZIP is missing referenced audio: ${s.audio_file}`);
    if (s.container_file && !files.has(s.container_file))
      throw Error(`ZIP is missing sample container: ${s.container_file}`);
    s.source_wav = wav.slice();
    s.audio = rawWave(s.source_wav);
    total += s.audio[0].byteLength * 2;
    if (total > 128 * 1048576)
      throw Error("Project exceeds 128 MB source-audio budget");
    fitMarkers(s);
  }
  state.takes = recordings.map((s) => ({
    id: uid(),
    name: s.name,
    audio: s.audio,
    source_wav: s.source_wav,
    recording_format: s.recording_format,
    exported: true,
  }));
  if (state.takes.some((t) => !t.audio))
    throw Error("Missing recorded-take audio");
  if (audioBytes(state.programs, state.takes) > 128 * 1048576)
    throw Error("Project exceeds audio budget");
  state.importType = raw.type;
  state.asset_layout = raw.asset_layout;
  return state;
}
