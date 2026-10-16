const validRate = (rate) =>
  Number.isInteger(rate) && rate >= 8000 && rate <= 384000;
const validBits = (bits) => [8, 12, 16, 24, 32].includes(bits);
const fallback = () => ({ rate: 44100, bits: 32, channels: 2 });
/** Source-file precision is independent of the audible bitcrusher settings. */
export function sourceRenderFormat(sample) {
  const raw = sample.source_wav;
  if (raw) {
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw),
      view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const text = (p, n) => String.fromCharCode(...bytes.subarray(p, p + n));
    if (bytes.length >= 12 && text(0, 4) === "RIFF" && text(8, 4) === "WAVE") {
      for (let p = 12; p + 8 <= bytes.length; ) {
        const size = view.getUint32(p + 4, true),
          start = p + 8;
        if (start + size > bytes.length) break;
        if (text(p, 4) === "fmt " && size >= 16) {
          const rate = view.getUint32(start + 4, true),
            containerBits = view.getUint16(start + 14, true),
            bits =
              view.getUint16(start, true) === 0xfffe && size >= 40
                ? view.getUint16(start + 18, true) || containerBits
                : containerBits,
            channels = view.getUint16(start + 2, true);
          if (validRate(rate) && validBits(bits) && channels > 0)
            return { rate, bits, channels: channels === 1 ? 1 : 2 };
          break;
        }
        p = start + size + (size % 2);
      }
    }
  }
  const format = sample.recording_format;
  if (format) {
    const rate = format.sample_rate ?? format.rate,
      bits = format.bit_depth ?? format.bits;
    if (validRate(rate) && validBits(bits))
      return { rate, bits, channels: format.channels === 1 ? 1 : 2 };
  }
  return fallback();
}
export function renderSelectionDefaults(samples) {
  const formats = samples
    .filter((s) => s.audio?.[0]?.length)
    .map(sourceRenderFormat);
  const mixed =
    new Set(formats.map((f) => `${f.rate}/${f.bits}/${f.channels}`)).size > 1;
  return {
    mixed,
    formats,
    common: mixed ? fallback() : (formats[0] ?? fallback()),
  };
}
