import { renderSample } from "./render-sample.js";
import { encodePcmWav, resampleAudio } from "./wav-format.js";
import { sourceRenderFormat } from "./render-options.js";
import { packZip } from "./sample-container.js";
const safe = (name) =>
  String(name ?? "Sample")
    .replace(/[\u0000-\u001f<>:"\/\\|?*]/g, "_")
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 100) || "Sample";
export async function resampleExport(samples, state, options) {
  const {
    rate = 44100,
    bits = 32,
    channels = 2,
    format = "wav",
    bitrate = 192,
    policy = "common",
  } = options;
  if (
    !["wav", "mp3"].includes(format) ||
    ![1, 2].includes(channels) ||
    !Number.isInteger(rate) ||
    rate < 8000 ||
    rate > 384000 ||
    ![8, 12, 16, 24, 32].includes(bits)
  )
    throw Error("Unsupported render format");
  if (!["common", "source"].includes(policy))
    throw Error("Unsupported render settings policy");
  if (
    format === "mp3" &&
    (policy === "source" ||
      ![22050, 32000, 44100, 48000].includes(rate) ||
      ![128, 192, 256, 320].includes(bitrate) ||
      (rate === 22050 && bitrate !== 128))
  )
    throw Error("Unsupported MP3 rate or bitrate");
  const loaded = samples.filter((s) => s.audio?.[0]?.length);
  if (!loaded.length) throw Error("Select loaded samples to render");
  const encodeMp3 =
      format === "mp3" ? (await import("./mp3-encoder.js")).encodeMp3 : null,
    entries = [];
  let total = 0;
  for (let i = 0; i < loaded.length; i++) {
    const sample = loaded[i],
      target =
        policy === "source"
          ? sourceRenderFormat(sample)
          : { rate, bits, channels };
    let audio = await renderSample(sample, state, 44100);
    if (Math.round((audio[0].length * target.rate) / 44100) * 8 > 128 * 1048576)
      throw Error("Rendered sample exceeds the 128 MB output limit");
    audio = resampleAudio(audio, 44100, target.rate);
    if (target.channels === 1)
      audio = [Float32Array.from(audio[0], (v, j) => (v + audio[1][j]) / 2)];
    const bytes =
      format === "wav"
        ? new Uint8Array(
            encodePcmWav(audio, target.rate, target.bits, target.channels),
          )
        : encodeMp3(audio, rate, channels, bitrate);
    total += bytes.byteLength;
    if (total > 512 * 1048576)
      throw Error("Rendered exports exceed the 512 MB archive limit");
    entries.push([
      `${loaded.length > 1 ? String(i + 1).padStart(3, "0") + "-" : ""}${safe(sample.name)}.${format}`,
      bytes,
    ]);
  }
  if (entries.length === 1)
    return {
      name: entries[0][0],
      data: entries[0][1],
      type: format === "wav" ? "audio/wav" : "audio/mpeg",
    };
  return {
    name: "Rendered samples.zip",
    data: packZip(entries),
    type: "application/zip",
  };
}
