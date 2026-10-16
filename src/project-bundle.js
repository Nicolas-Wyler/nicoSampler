import { audioBytes } from "./model.js";
import { newEmpty } from "./workflows.js";
import { encodeSampleContainer, packZip } from "./sample-container.js";

const encoder = new TextEncoder();
const ZIP_MAX = 0xffffffff,
  MAX_SOURCE = 128 * 1048576;
function safeName(value, fallback) {
  let name = String(value ?? "")
    .normalize("NFKC")
    .replace(
      /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>:"/\\|?*]/g,
      "_",
    )
    .replace(/^[. ]+|[. ]+$/g, "");
  name = [...name].slice(0, 48).join("") || fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
    name = "_" + name;
  return name;
}
const numbered = (index, name, fallback) =>
  String(index + 1).padStart(3, "0") + "-" + safeName(name, fallback);

/** Portable source archive: original project plus raw WAV and reversible settings per row. */
export function projectBundle(projectJSON, state, onlyCurrent = false) {
  const programs = onlyCurrent
    ? state.programs.filter((p) => p.id === state.current)
    : state.programs;
  if (!programs.length) throw Error("No program selected for export");
  const used = new Set(
    programs.flatMap((p) => p.samples.map((s) => s.audio?.[0]).filter(Boolean)),
  );
  const takes = onlyCurrent
    ? []
    : (state.takes ?? []).filter(
        (t) => t.audio?.[0]?.length && !used.has(t.audio[0]),
      );
  const loaded =
    programs.reduce(
      (count, p) =>
        count + p.samples.filter((s) => s.audio?.[0]?.length).length,
      0,
    ) + takes.length;
  if (1 + loaded * 2 > 65535)
    throw Error("Project archive exceeds the ZIP entry limit");
  if (audioBytes(programs, takes) > MAX_SOURCE)
    throw Error("Project exceeds 128 MB source-audio budget");
  const entries = [];
  let zipBytes = 22;
  const add = (name, bytes) => {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const nameBytes = encoder.encode(name).length;
    const next = zipBytes + data.byteLength + 76 + nameBytes * 2;
    if (data.byteLength > ZIP_MAX || next > ZIP_MAX)
      throw Error("Project archive requires unsupported ZIP64");
    entries.push([name, data]);
    zipBytes = next;
  };
  const manifest =
    typeof projectJSON === "string"
      ? JSON.parse(projectJSON)
      : structuredClone(projectJSON);
  manifest.asset_layout = "relative-v1";
  const manifestPrograms = onlyCurrent ? [manifest] : manifest.programs;
  if (
    !Array.isArray(manifestPrograms) ||
    manifestPrograms.length !== programs.length
  )
    throw Error("Project manifest does not match exported programs");
  const addSample = (path, sample) => {
    // Preflight both WAV copies before allocating either one.
    if (zipBytes + 2 * (44 + sample.audio[0].length * 8) > ZIP_MAX)
      throw Error("Project archive requires unsupported ZIP64");
    const result = encodeSampleContainer(sample, state);
    add(path + ".raw.wav", result.wav);
    add(path + ".nicosample", result.container);
  };
  programs.forEach((program, pi) => {
    const folder = "programs/" + numbered(pi, program.name, "Program");
    program.samples.forEach((sample, si) => {
      const target = manifestPrograms[pi].samples?.[si];
      if (!target)
        throw Error("Project manifest does not match exported samples");
      delete target.embedded;
      delete target.audio;
      if (sample.audio?.[0]?.length) {
        const path = folder + "/" + numbered(si, sample.name, "Sample");
        target.audio_file = path + ".raw.wav";
        target.container_file = path + ".nicosample";
        addSample(path, sample);
      }
    });
  });
  const recordings = [];
  takes.forEach((take, index) => {
    const sample = {
      ...newEmpty(take.name),
      audio: take.audio,
      source_wav: take.source_wav ?? null,
      recording_format: take.recording_format ?? null,
      level: 0.5,
    };
    const path = "recordings/" + numbered(index, take.name, "Recording");
    addSample(path, sample);
    const { audio, id, source_wav, ...params } = sample;
    recordings.push({
      ...params,
      audio_file: path + ".raw.wav",
      container_file: path + ".nicosample",
    });
  });
  if (recordings.length) manifest.recordings = recordings;
  add(
    onlyCurrent ? "project.nicoprog" : "project.nicosbank",
    encoder.encode(JSON.stringify(manifest)),
  );
  return packZip(entries);
}

const decoder = new TextDecoder("utf-8", { fatal: true });
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let n = i;
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function checksum(bytes) {
  let n = 0xffffffff;
  for (const byte of bytes) n = crcTable[(n ^ byte) & 255] ^ (n >>> 8);
  return (n ^ 0xffffffff) >>> 0;
}
function validPath(name) {
  return (
    name.length > 0 &&
    !/[\\\u0000-\u001f\u007f:]/.test(name) &&
    !name.startsWith("/") &&
    name.split("/").every((part) => part && part !== "." && part !== "..")
  );
}
/** Validate a ZIP32 stored archive before exposing any project-relative assets. */
export function readZipEntries(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.byteLength < 22 || bytes.byteLength > ZIP_MAX)
    throw Error("Invalid project archive size");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
    if (
      view.getUint32(p, true) === 0x06054b50 &&
      p + 22 + view.getUint16(p + 20, true) === bytes.length
    ) {
      end = p;
      break;
    }
  }
  if (end < 0) throw Error("Missing project ZIP directory");
  const count = view.getUint16(end + 10, true),
    directory = view.getUint32(end + 16, true),
    size = view.getUint32(end + 12, true);
  if (
    !count ||
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true) ||
    view.getUint16(end + 8, true) !== count ||
    directory + size !== end ||
    directory >= end
  )
    throw Error("Invalid project ZIP directory");
  const files = new Map(),
    ranges = [];
  let position = directory;
  for (let index = 0; index < count; index++) {
    if (position + 46 > end || view.getUint32(position, true) !== 0x02014b50)
      throw Error("Invalid project ZIP entry");
    const flags = view.getUint16(position + 8, true),
      method = view.getUint16(position + 10, true),
      sum = view.getUint32(position + 16, true),
      compressed = view.getUint32(position + 20, true),
      length = view.getUint32(position + 24, true),
      nameLength = view.getUint16(position + 28, true),
      extra = view.getUint16(position + 30, true),
      comment = view.getUint16(position + 32, true),
      offset = view.getUint32(position + 42, true);
    const next = position + 46 + nameLength + extra + comment;
    if (
      (flags !== 0 && flags !== 0x800) ||
      method !== 0 ||
      compressed !== length ||
      length === ZIP_MAX ||
      next > end ||
      view.getUint16(position + 34, true) !== 0 ||
      offset + 30 > directory
    )
      throw Error("Unsupported project ZIP entry");
    const name = decoder.decode(
      bytes.subarray(position + 46, position + 46 + nameLength),
    );
    if (!validPath(name) || files.has(name))
      throw Error("Unsafe or duplicate project ZIP path");
    if (
      view.getUint32(offset, true) !== 0x04034b50 ||
      view.getUint16(offset + 6, true) !== flags ||
      view.getUint16(offset + 8, true) !== 0 ||
      view.getUint32(offset + 14, true) !== sum ||
      view.getUint32(offset + 18, true) !== length ||
      view.getUint32(offset + 22, true) !== length
    )
      throw Error("Invalid project local ZIP entry");
    const localNameLength = view.getUint16(offset + 26, true),
      start = offset + 30 + localNameLength + view.getUint16(offset + 28, true);
    if (
      start + length > directory ||
      decoder.decode(
        bytes.subarray(offset + 30, offset + 30 + localNameLength),
      ) !== name
    )
      throw Error("Invalid project ZIP data bounds");
    const data = bytes.subarray(start, start + length);
    if (checksum(data) !== sum) throw Error("Project ZIP checksum failed");
    files.set(name, data);
    ranges.push([offset, start + length]);
    position = next;
  }
  if (position !== end) throw Error("Invalid project ZIP directory size");
  ranges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++)
    if (ranges[i][0] < ranges[i - 1][1])
      throw Error("Overlapping project ZIP entries");
  return files;
}

export function readProjectBundle(buffer) {
  const files = readZipEntries(buffer);
  const projects = [...files.keys()].filter((name) =>
    /^project\.(?:nicoprog|nicosbank)$/.test(name),
  );
  if (projects.length !== 1)
    throw Error("Project ZIP must contain exactly one project manifest");
  return { project: decoder.decode(files.get(projects[0])), files };
}
