const finiteRate = (rate) => {
  if (!Number.isInteger(rate) || rate < 8000 || rate > 384000)
    throw new Error("Invalid WAV sample rate.");
};
const tag = (view, offset, text) => {
  for (let i = 0; i < text.length; i++)
    view.setUint8(offset + i, text.charCodeAt(i));
};
const text = (view, offset, length) =>
  String.fromCharCode(
    ...new Uint8Array(view.buffer, view.byteOffset + offset, length),
  );
function inputChannels(audio) {
  if (
    !Array.isArray(audio) ||
    !audio.length ||
    !audio[0] ||
    audio.some((c) => c.length !== audio[0].length)
  )
    throw new Error("Audio channels must have equal lengths.");
  return audio;
}
export function encodePcmWav(audio, rate, bits, channels = 2) {
  inputChannels(audio);
  finiteRate(rate);
  if (![8, 12, 16, 24, 32].includes(bits) || ![1, 2].includes(channels))
    throw new Error("Unsupported WAV format.");
  const extensible = bits === 12;
  const containerBits = extensible ? 16 : bits;
  const dataOffset = extensible ? 68 : 44;
  const frames = audio[0].length,
    bytes = containerBits / 8,
    alignment = channels * bytes,
    size = frames * alignment;
  if (size > 0xffffffff - (dataOffset - 8) - 1)
    throw new Error("WAV exceeds RIFF size limit.");
  const buffer = new ArrayBuffer(dataOffset + size + (size % 2)),
    v = new DataView(buffer);
  tag(v, 0, "RIFF");
  v.setUint32(4, buffer.byteLength - 8, true);
  tag(v, 8, "WAVE");
  tag(v, 12, "fmt ");
  v.setUint32(16, extensible ? 40 : 16, true);
  v.setUint16(20, extensible ? 0xfffe : bits === 32 ? 3 : 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * alignment, true);
  v.setUint16(32, alignment, true);
  v.setUint16(34, containerBits, true);
  if (extensible) {
    // WAVEFORMATEXTENSIBLE: valid PCM bits are left-aligned; unused LSBs are zero.
    // https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ksmedia/ns-ksmedia-waveformatextensible
    v.setUint16(36, 22, true);
    v.setUint16(38, bits, true);
    v.setUint32(40, channels === 1 ? 4 : 3, true);
    new Uint8Array(buffer, 44, 16).set([
      1, 0, 0, 0, 0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113,
    ]);
  }
  tag(v, dataOffset - 8, "data");
  v.setUint32(dataOffset - 4, size, true);
  let p = dataOffset;
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < channels; c++) {
      const source = audio[c] ?? audio[0],
        raw = source[i];
      if (!Number.isFinite(raw))
        throw new Error("Audio contains non-finite samples.");
      const x = Math.max(-1, Math.min(1, raw));
      if (bits === 8)
        v.setUint8(p, Math.max(0, Math.min(255, Math.round(x * 128 + 128))));
      else if (bits === 12)
        v.setInt16(p, Math.round(x * (x < 0 ? 2048 : 2047)) * 16, true);
      else if (bits === 16)
        v.setInt16(p, Math.round(x * (x < 0 ? 32768 : 32767)), true);
      else if (bits === 24) {
        const n = Math.round(x * (x < 0 ? 8388608 : 8388607));
        v.setUint8(p, n & 255);
        v.setUint8(p + 1, (n >> 8) & 255);
        v.setUint8(p + 2, (n >> 16) & 255);
      } else v.setFloat32(p, raw, true);
      p += bytes;
    }
  return buffer;
}
export function decodePcmWav(buffer) {
  if (ArrayBuffer.isView(buffer))
    buffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    );
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 12)
    throw new Error("Truncated WAV header.");
  const v = new DataView(buffer);
  if (text(v, 0, 4) !== "RIFF" || text(v, 8, 4) !== "WAVE")
    throw new Error("Not a RIFF WAV.");
  const end = v.getUint32(4, true) + 8;
  if (end > v.byteLength || end < 12) throw new Error("Truncated WAV file.");
  let format = null;
  const chunks = [];
  for (let p = 12; p < end; ) {
    if (p + 8 > end) throw new Error("Truncated WAV chunk.");
    const id = text(v, p, 4),
      size = v.getUint32(p + 4, true),
      start = p + 8,
      next = start + size;
    if (next > end) throw new Error("Truncated WAV chunk data.");
    if (id === "fmt ") {
      if (size < 16 || format) throw new Error("Invalid WAV format chunk.");
      let code = v.getUint16(start, true);
      const channels = v.getUint16(start + 2, true),
        rate = v.getUint32(start + 4, true),
        alignment = v.getUint16(start + 12, true),
        bits = v.getUint16(start + 14, true);
      let validBits = bits;
      if (code === 0xfffe) {
        if (size < 40 || v.getUint16(start + 16, true) < 22)
          throw new Error("Invalid extensible WAV.");
        const guidTail = [0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113];
        if (guidTail.some((byte, i) => v.getUint8(start + 28 + i) !== byte))
          throw new Error("Unsupported extensible WAV subtype.");
        code = v.getUint32(start + 24, true);
        validBits = v.getUint16(start + 18, true);
        if (
          validBits < 1 ||
          validBits > bits ||
          (code === 3 && validBits !== 32)
        )
          throw new Error("Invalid extensible WAV valid bits.");
      }
      finiteRate(rate);
      if (
        channels < 1 ||
        channels > 32 ||
        ![8, 16, 24, 32].includes(bits) ||
        ![1, 3].includes(code) ||
        (code === 3 && bits !== 32) ||
        alignment !== channels * (bits / 8) ||
        v.getUint32(start + 8, true) !== rate * alignment
      )
        throw new Error("Unsupported WAV format.");
      format = { code, channels, rate, alignment, bits, validBits };
    } else if (id === "data") chunks.push({ start, size });
    p = next + (size % 2);
    if (p > end && next !== end) throw new Error("Truncated WAV padding.");
  }
  if (!format || !chunks.length)
    throw new Error("WAV format or audio data is missing.");
  const { code, channels, rate, alignment, bits, validBits } = format;
  if (chunks.some((c) => c.size % alignment))
    throw new Error("Incomplete WAV frame.");
  const frames = chunks.reduce((n, c) => n + c.size / alignment, 0),
    audio = [new Float32Array(frames), new Float32Array(frames)],
    bytes = bits / 8;
  let frame = 0;
  const read = (p) => {
    let x;
    if (code === 3) x = v.getFloat32(p, true);
    else if (bits === 8) x = (v.getUint8(p) - 128) / 128;
    else if (bits === 16) x = v.getInt16(p, true) / 32768;
    else if (bits === 24) {
      let n =
        v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getUint8(p + 2) << 16);
      if (n & 0x800000) n -= 0x1000000;
      x = n / 8388608;
    } else x = v.getInt32(p, true) / 2147483648;
    if (!Number.isFinite(x)) throw new Error("WAV contains non-finite audio.");
    return x;
  };
  for (const chunk of chunks)
    for (let p = chunk.start; p < chunk.start + chunk.size; p += alignment) {
      audio[0][frame] = read(p);
      audio[1][frame] = channels === 1 ? audio[0][frame] : read(p + bytes);
      frame++;
    }
  return {
    audio,
    rate,
    bits: validBits,
    containerBits: bits,
    validBits,
    channels,
  };
}
export function resampleAudio(audio, from, to) {
  inputChannels(audio);
  finiteRate(from);
  finiteRate(to);
  if (from === to) return audio;
  const length = Math.round((audio[0].length * to) / from),
    output = audio.map(() => new Float32Array(length));
  if (!length) return output;
  const taps = 32,
    phases = 1024,
    cutoff = Math.min(1, to / from) * 0.94,
    kernel = new Float64Array(taps * phases);
  for (let phase = 0; phase < phases; phase++) {
    const fraction = phase / phases;
    let sum = 0;
    for (let tap = 0; tap < taps; tap++) {
      const distance = tap - 15 - fraction,
        z = Math.PI * distance * cutoff,
        window =
          0.42 +
          0.5 * Math.cos((Math.PI * distance) / 16) +
          0.08 * Math.cos((2 * Math.PI * distance) / 16),
        weight = (Math.abs(z) < 1e-12 ? 1 : Math.sin(z) / z) * cutoff * window;
      kernel[phase * taps + tap] = weight;
      sum += weight;
    }
    for (let tap = 0; tap < taps; tap++) kernel[phase * taps + tap] /= sum;
  }
  for (let i = 0; i < length; i++) {
    const position = (i * from) / to,
      center = Math.floor(position),
      phase = Math.min(phases - 1, Math.round((position - center) * phases)),
      offset = phase * taps;
    for (let c = 0; c < audio.length; c++) {
      let sum = 0;
      for (let tap = 0; tap < taps; tap++)
        sum +=
          audio[c][
            Math.max(0, Math.min(audio[c].length - 1, center + tap - 15))
          ] * kernel[offset + tap];
      output[c][i] = sum;
    }
  }
  return output;
}
