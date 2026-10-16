import {decodePcmWav,resampleAudio} from "./wav-format.js";
import { encodeWav, validateBank, fitMarkers, RATE } from "./model.js";
// A dependency-free ZIP (stored entries): standard WAV + explicit reversible settings.
const encoder = new TextEncoder(),
  decoder = new TextDecoder("utf-8", { fatal: true }),
  MAX = 128 * 1048576 + 1048576;
const table = Uint32Array.from({ length: 256 }, (_, i) => {
  let n = i;
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc(bytes) {
  let n = 0xffffffff;
  for (const b of bytes) n = table[(n ^ b) & 255] ^ (n >>> 8);
  return (n ^ 0xffffffff) >>> 0;
}
export function packZip(entries) {
  const parts = [],
    central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const n = encoder.encode(name),
      b = new Uint8Array(data),
      sum = crc(b),
      h = new Uint8Array(30 + n.length),
      v = new DataView(h.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x800, true);
    v.setUint32(14, sum, true);
    v.setUint32(18, b.length, true);
    v.setUint32(22, b.length, true);
    v.setUint16(26, n.length, true);
    h.set(n, 30);
    parts.push(h, b);
    const c = new Uint8Array(46 + n.length),
      w = new DataView(c.buffer);
    w.setUint32(0, 0x02014b50, true);
    w.setUint16(4, 20, true);
    w.setUint16(6, 20, true);
    w.setUint16(8, 0x800, true);
    w.setUint32(16, sum, true);
    w.setUint32(20, b.length, true);
    w.setUint32(24, b.length, true);
    w.setUint16(28, n.length, true);
    w.setUint32(42, offset, true);
    c.set(n, 46);
    central.push(c);
    offset += h.length + b.length;
  }
  const size = central.reduce((n, c) => n + c.length, 0),
    end = new Uint8Array(22),
    v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, entries.length, true);
  v.setUint16(10, entries.length, true);
  v.setUint32(12, size, true);
  v.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + 22);
  let i = 0;
  for (const p of [...parts, ...central, end]) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}
export function unpackZip(buffer) {
  const b = new Uint8Array(buffer),
    v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 22 || b.length > MAX)
    throw Error("Invalid sample container size");
  const end = b.length - 22;
  if (
    v.getUint32(end, true) !== 0x06054b50 ||
    v.getUint16(end + 8, true) !== 2 ||
    v.getUint16(end + 10, true) !== 2 ||
    v.getUint16(end + 4, true) ||
    v.getUint16(end + 6, true)
  )
    throw Error("Invalid sample container directory");
  let pos = v.getUint32(end + 16, true);
  const directory = pos,
    files = new Map();
  if (pos >= end || pos + v.getUint32(end + 12, true) !== end)
    throw Error("Invalid sample directory bounds");
  for (let i = 0; i < 2; i++) {
    if (pos + 46 > end || v.getUint32(pos, true) !== 0x02014b50)
      throw Error("Invalid ZIP entry");
    const flags = v.getUint16(pos + 8, true),
      method = v.getUint16(pos + 10, true),
      sum = v.getUint32(pos + 16, true),
      size = v.getUint32(pos + 24, true),
      nl = v.getUint16(pos + 28, true),
      extra = v.getUint16(pos + 30, true),
      comment = v.getUint16(pos + 32, true),
      off = v.getUint32(pos + 42, true);
    if (
      flags !== 0x800 ||
      method ||
      v.getUint32(pos + 20, true) !== size ||
      pos + 46 + nl + extra + comment > end ||
      off + 30 > directory
    )
      throw Error("Unsupported sample ZIP entry");
    const name = decoder.decode(b.subarray(pos + 46, pos + 46 + nl));
    if (!["sample.wav", "settings.json"].includes(name) || files.has(name))
      throw Error("Unexpected sample container entry");
    if (
      v.getUint32(off, true) !== 0x04034b50 ||
      v.getUint16(off + 6, true) !== flags ||
      v.getUint16(off + 8, true) !== 0 ||
      v.getUint32(off + 14, true) !== sum ||
      v.getUint32(off + 18, true) !== size ||
      v.getUint32(off + 22, true) !== size
    )
      throw Error("Invalid local ZIP entry");
    const len = v.getUint16(off + 26, true),
      start = off + 30 + len + v.getUint16(off + 28, true);
    if (
      start + size > directory ||
      decoder.decode(b.subarray(off + 30, off + 30 + len)) !== name
    )
      throw Error("Invalid sample data bounds");
    const data = b.subarray(start, start + size);
    if (crc(data) !== sum) throw Error("Sample container checksum failed");
    files.set(name, data);
    pos += 46 + nl + extra + comment;
  }
  if (pos !== end || !files.has("sample.wav") || !files.has("settings.json"))
    throw Error("Incomplete sample container");
  return files;
}
export function rawWave(buffer) {
  const decoded=decodePcmWav(buffer);
  if(decoded.audio[0].length>decoded.rate*600)throw Error("Sample exceeds 10 minutes");
  return resampleAudio(decoded.audio,decoded.rate,RATE);
}
export function encodeSampleContainer(s, state) {
  if (!s.audio?.[0]?.length) throw Error("Load a sample before saving");
  const { audio, id, source_wav, ...params } = s;
  const settings = {
    type: "nico_sample",
    version: 1,
    sample: params,
    fx: state.fx,
    master: state.master,
  };
  const wav = source_wav ? (source_wav instanceof ArrayBuffer ? source_wav.slice(0) : source_wav.slice().buffer) : encodeWav(audio);
  return {
    wav,
    container: packZip([
      ["sample.wav", wav],
      ["settings.json", encoder.encode(JSON.stringify(settings)).buffer],
    ]),
  };
}
export function decodeSampleContainer(buffer) {
  const files = unpackZip(buffer),
    raw = JSON.parse(decoder.decode(files.get("settings.json")));
  if (raw.type !== "nico_sample" || raw.version !== 1 || !raw.sample)
    throw Error("Unsupported sample container");
  const state = validateBank({
    type: "sample_program",
    version: 3,
    name: raw.sample.name,
    channel: "All",
    samples: [raw.sample],
    fx: raw.fx,
    master: raw.master,
  });
  const s = state.programs[0].samples[0];
  s.source_wav=files.get("sample.wav").slice();
  s.audio = rawWave(s.source_wav);
  fitMarkers(s);
  state.programs[0].selected = s.id;
  Object.defineProperty(state, "importType", { value: "sample_program" });
  Object.defineProperty(state, "isSampleContainer", { value: true });
  return state;
}
