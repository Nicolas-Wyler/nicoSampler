import { preferences } from "./settings.js";
import {
  referencedRecordings,
  validateRelativeAssets,
} from "./project-import.js";
import { decodeSampleContainer } from "./sample-container.js";
import { validateBank, fitMarkers } from "./model.js";
function database() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("nico-sampler-classic", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("session");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function saveRecovery(state) {
  const db = await database();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction("session", "readwrite");
      tx.objectStore("session").put(state, "current");
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? Error("Autosave was interrupted"));
    });
  } finally {
    db.close();
  }
}
export async function loadRecovery() {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const r = db.transaction("session").objectStore("session").get("current");
      r.onsuccess = () => resolve(r.result ?? null);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
export async function clearRecovery() {
  const db = await database();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction("session", "readwrite");
      tx.objectStore("session").clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export function download(data, name, type = "application/octet-stream") {
  const blob = data instanceof Blob ? data : new Blob([data], { type }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[\\/:*?"<>|]/g, "_");
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function metadata(state, onlyCurrent = false) {
  const programs = onlyCurrent
    ? state.programs.filter((p) => p.id === state.current)
    : state.programs;
  return {
    type: onlyCurrent ? "sample_program" : "sample_bank",
    version: 3,
    ...(onlyCurrent
      ? {}
      : {
          currentIndex: Math.max(
            0,
            state.programs.findIndex((p) => p.id === state.current),
          ),
        }),
    fx: state.fx,
    master: state.master,
    octave: state.octave,
    source: state.source,
    columns: state.columns,
    columnManual: state.columnManual,
    columnSizingVersion: state.columnSizingVersion,
    record: state.record,
    preferences: preferences(state),
    ...(onlyCurrent
      ? serializeProgram(programs[0])
      : { programs: programs.map(serializeProgram) }),
  };
}
function serializeProgram(p) {
  return {
    type: "sample_program",
    version: 3,
    name: p.name,
    channel: p.channel,
    selected: p.samples.findIndex((s) => s.id === p.selected),
    samples: p.samples.map(({ id, audio, source_wav, ...s }) => ({
      ...s,
      audio_file: audio ? null : s.audio_file,
      embedded: audio
        ? { encoding: "f32le-stereo", frames: audio[0].length, channels: audio }
        : null,
    })),
  };
}
export class FileCodec {
  constructor() {
    this.worker = new Worker(new URL("./file-worker.js", import.meta.url), {
      type: "module",
    });
    this.waiting = new Map();
    this.next = 0;
    this.worker.onmessage = ({ data }) => {
      const p = this.waiting.get(data.token);
      if (!p) return;
      this.waiting.delete(data.token);
      if (data.error) p.reject(Error(data.error));
      else p.resolve(data.result);
    };
    this.worker.onerror = () => {
      for (const p of this.waiting.values())
        p.reject(Error("File worker failed"));
      this.waiting.clear();
    };
  }
  run(type, data) {
    return new Promise((resolve, reject) => {
      const token = ++this.next;
      this.waiting.set(token, { resolve, reject });
      this.worker.postMessage({ type, data, token });
    });
  }
  async exportProject(state, onlyCurrent = false) {
    return this.run("project", { state, onlyCurrent });
  }
  async renderSamples(samples, state, options) {
    const current = state.programs?.find((p) => p.id === state.current);
    return this.run("render", {
      samples,
      soloContext:
        current?.samples.map(({ id, mute, solo }) => ({ id, mute, solo })) ??
        samples.map(({ id, mute, solo }) => ({ id, mute, solo })),
      fx: state.fx,
      master: state.master,
      options,
    });
  }
  async exportSamples(samples, state) {
    return this.run("samples", { samples, fx: state.fx, master: state.master });
  }
  async exportSample(sample, state) {
    return this.run("sample", { sample, fx: state.fx, master: state.master });
  }
  async export(state, onlyCurrent = false) {
    return this.run("encode", metadata(state, onlyCurrent));
  }
  async import(file, expectedType) {
    if (file.size > 360 * 1024 * 1024)
      throw Error("Bank is too large (360 MB file limit)");
    if (/\.zip$/i.test(file.name))
      return this.run("project-import", {
        buffer: await file.arrayBuffer(),
        expectedType,
      });
    if (/\.nicosample$/i.test(file.name))
      return decodeSampleContainer(await file.arrayBuffer());
    const { raw, audio } = await this.run("decode", await file.text()),
      state = validateBank(raw);
    let i = 0,
      total = 0;
    for (const p of state.programs)
      for (const s of p.samples) {
        const data = audio[i++];
        if (data) {
          s.audio = data;
          total += data[0].byteLength * 2;
          if (total > 128 * 1024 * 1024)
            throw Error("Bank exceeds the 128 MB source-audio budget");
          fitMarkers(s);
        }
      }
    state.asset_layout = raw.asset_layout;
    state.pendingRecordings = referencedRecordings(raw);
    if (raw.asset_layout === "relative-v1")
      validateRelativeAssets(state, state.pendingRecordings);
    Object.defineProperty(state, "importType", { value: raw.type });
    return state;
  }
}
