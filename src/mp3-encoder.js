import lamejs from "./vendor/lamejs/lame.esm.js";
const RATES = [22050, 32000, 44100, 48000],
  BITRATES = [128, 192, 256, 320];
/** Offline encoding. Run inside the export worker to keep the main UI responsive. */
export function encodeMp3(audio, rate = 44100, channels = 2, bitrate = 192) {
  if (
    !Array.isArray(audio) ||
    !audio.length ||
    !audio[0]?.length ||
    audio.some((channel) => channel.length !== audio[0].length)
  )
    throw new Error("MP3 audio must contain equal, nonempty channels.");
  if (
    !RATES.includes(rate) ||
    ![1, 2].includes(channels) ||
    !BITRATES.includes(bitrate)
  )
    throw new Error("Unsupported MP3 rate, channels, or bitrate.");
  if (rate === 22050 && bitrate > 160)
    throw new Error(
      "22.05 kHz MP3 supports up to 160 kbps. Choose 128 kbps or a higher sample rate.",
    );
  const encoder = new lamejs.Mp3Encoder(channels, rate, bitrate),
    chunks = [];
  let size = 0;
  function add(chunk) {
    if (chunk.length) {
      const copy = new Uint8Array(chunk.length);
      copy.set(chunk);
      chunks.push(copy);
      size += copy.length;
    }
  }
  const frameSize = 1152;
  for (let offset = 0; offset < audio[0].length; offset += frameSize) {
    const n = Math.min(frameSize, audio[0].length - offset),
      pcm = Array.from({ length: channels }, () => new Int16Array(n));
    for (let channel = 0; channel < channels; channel++) {
      const source = audio[channel] ?? audio[0];
      for (let i = 0; i < n; i++) {
        const raw = source[offset + i];
        if (!Number.isFinite(raw))
          throw new Error("MP3 audio contains non-finite samples.");
        const value = Math.max(-1, Math.min(1, raw));
        pcm[channel][i] = Math.round(value * (value < 0 ? 32768 : 32767));
      }
    }
    add(
      channels === 1
        ? encoder.encodeBuffer(pcm[0])
        : encoder.encodeBuffer(pcm[0], pcm[1]),
    );
  }
  add(encoder.flush());
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}
