import { audioBytes } from "./model.js";
import { encodeSampleContainer, packZip } from "./sample-container.js";
const encoder = new TextEncoder(),
  MAX_ZIP = 0xffffffff;
function nameOf(sample, index) {
  const value = String(sample.name ?? "Sample")
    .normalize("NFKC")
    .replace(
      /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>:"/\\|?*]/g,
      "_",
    )
    .replace(/^[. ]+|[. ]+$/g, "");
  const name = [...value].slice(0, 48).join("") || "Sample";
  // The numeric prefix also prevents Windows reserved basenames and case collisions.
  return "samples/" + String(index + 1).padStart(3, "0") + "-" + name;
}
/** Export exactly the selected source samples in both reusable formats. */
export function sampleBundle(samples, state) {
  const loaded = samples.filter((sample) => sample.audio?.[0]?.length);
  if (!loaded.length) throw Error("Load a sample before saving");
  if (loaded.length * 2 > 65535)
    throw Error("Sample archive exceeds the ZIP entry limit");
  if (audioBytes([{ samples: loaded }]) > 128 * 1048576)
    throw Error("Samples exceed 128 MB source-audio budget");
  const entries = [];
  let size = 22;
  function add(name, buffer) {
    const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    size += 76 + 2 * encoder.encode(name).length + data.byteLength;
    if (data.byteLength > MAX_ZIP || size > MAX_ZIP)
      throw Error("Sample archive requires unsupported ZIP64");
    entries.push([name, data]);
  }
  loaded.forEach((sample, index) => {
    if (size + 2 * (44 + sample.audio[0].length * 8) > MAX_ZIP)
      throw Error("Sample archive requires unsupported ZIP64");
    const name = nameOf(sample, index),
      result = encodeSampleContainer(sample, state);
    add(name + ".raw.wav", result.wav);
    add(name + ".nicosample", result.container);
  });
  return packZip(entries);
}
