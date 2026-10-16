import { validateSample, fitMarkers, audioBytes, RATE } from "./model.js";
const DB = "nico-sampler-classic-clipboard",
  STORE = "payload",
  MAX = 128 * 1048576;
function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? Error("Sample clipboard is unavailable"));
    request.onblocked = () =>
      reject(Error("Sample clipboard is busy in another window"));
  });
}
function validateRows(samples) {
  if (!Array.isArray(samples) || samples.length > 512)
    throw Error("Sample clipboard supports at most 512 rows");
  if (samples.some((row) => !row || typeof row !== "object"))
    throw Error("Invalid clipboard sample");
  if (new Set(samples.map((row) => row.id)).size !== samples.length)
    throw Error("Duplicate clipboard sample identities");
  if (audioBytes([{ samples }]) > MAX)
    throw Error("Sample clipboard exceeds the 128 MB source-audio budget");
  for (const row of samples) {
    if (typeof row?.id !== "string" || !row.id)
      throw Error("Invalid clipboard sample identity");
    const { audio: sourceAudio, source_wav, ...metadata } = row;
    const checked = validateSample({
      ...structuredClone(metadata),
      source_wav,
    });
    if (row.audio != null) {
      const audio = row.audio;
      if (
        !Array.isArray(audio) ||
        audio.length !== 2 ||
        !audio.every((channel) => channel instanceof Float32Array) ||
        !audio[0].length ||
        audio[0].length !== audio[1].length ||
        audio[0].length > RATE * 600
      )
        throw Error("Invalid clipboard source audio");
      for (const channel of audio)
        for (const value of channel)
          if (!Number.isFinite(value))
            throw Error("Non-finite clipboard source audio");
      checked.audio = audio;
      fitMarkers(checked);
    }
  }
}
function validatePayload(payload) {
  if (payload == null) return null;
  if (
    payload.version !== 1 ||
    typeof payload.token !== "string" ||
    typeof payload.sourceProgramId !== "string" ||
    typeof payload.originWindowId !== "string" ||
    typeof payload.cut !== "boolean" ||
    !Number.isFinite(payload.createdAt)
  )
    throw Error("Unsupported sample clipboard format");
  validateRows(payload.samples);
  return payload;
}
/** An app-local, same-origin clipboard; never reads or changes the OS clipboard. */
export async function copySamples(
  samples,
  { sourceProgramId, cut = false, originWindowId = "" } = {},
) {
  if (Array.isArray(samples) && samples.length === 0) return null;
  if (typeof sourceProgramId !== "string" || typeof originWindowId !== "string")
    throw Error("Clipboard source identity is required");
  validateRows(samples);
  const payload = {
    version: 1,
    token:
      globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    createdAt: Date.now(),
    sourceProgramId,
    originWindowId,
    cut: Boolean(cut),
    samples: structuredClone(samples),
  };
  const db = await database();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(payload, "current");
      transaction.oncomplete = resolve;
      transaction.onerror = () =>
        reject(
          transaction.error ?? Error("Sample clipboard could not be saved"),
        );
      transaction.onabort = () =>
        reject(
          transaction.error ?? Error("Sample clipboard save was interrupted"),
        );
    });
  } finally {
    db.close();
  }
  return structuredClone(payload);
}
export async function readSamples() {
  const db = await database();
  try {
    const payload = await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE),
        request = transaction.objectStore(STORE).get("current");
      let value;
      request.onsuccess = () => {
        value = request.result ?? null;
      };
      transaction.oncomplete = () => resolve(value);
      transaction.onerror = () =>
        reject(
          transaction.error ??
            request.error ??
            Error("Sample clipboard could not be read"),
        );
      transaction.onabort = () =>
        reject(
          transaction.error ?? Error("Sample clipboard read was interrupted"),
        );
    });
    return structuredClone(validatePayload(payload));
  } finally {
    db.close();
  }
}
/** Exact snapshot comparison: changed sources must never be removed by a pending cut. */
export function sameSampleSnapshot(current, snapshot) {
  const seen = new WeakMap();
  function equal(a, b) {
    if (Object.is(a, b)) return true;
    if (
      a == null ||
      b == null ||
      typeof a !== "object" ||
      typeof b !== "object"
    )
      return false;
    if (
      ArrayBuffer.isView(a) ||
      ArrayBuffer.isView(b) ||
      a instanceof ArrayBuffer ||
      b instanceof ArrayBuffer
    ) {
      const bytes = (value) =>
        value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : ArrayBuffer.isView(value)
            ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
            : null;
      const aa = bytes(a),
        bb = bytes(b);
      return Boolean(
        aa &&
          bb &&
          a.constructor === b.constructor &&
          aa.length === bb.length &&
          aa.every((value, index) => value === bb[index]),
      );
    }
    if (seen.get(a) === b) return true;
    seen.set(a, b);
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a),
      other = Object.keys(b);
    return (
      keys.length === other.length &&
      keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]))
    );
  }
  return equal(current, snapshot);
}
