import test from "node:test";
import assert from "node:assert/strict";
import {
  encodePcmWav,
  decodePcmWav,
  resampleAudio,
} from "../src/wav-format.js";
import { rawWave } from "../src/sample-container.js";
import { validateBank } from "../src/model.js";
const left = new Float32Array([-1, -0.9, -0.5, -0.001, 0, 0.001, 0.25, 0.9, 1]);
const right = left.slice().reverse();
for (const channels of [1, 2])
  for (const rate of [8000, 11025, 22050, 44100, 96000]) {
    test(`12-bit ${channels === 1 ? "mono" : "stereo"} at ${rate}Hz has valid extensible header and 12-bit precision`, () => {
      const wav = encodePcmWav([left, right], rate, 12, channels),
        v = new DataView(wav),
        decoded = decodePcmWav(wav);
      assert.equal(wav.byteLength, 68 + left.length * channels * 2);
      assert.equal(v.getUint32(4, true), wav.byteLength - 8);
      assert.equal(v.getUint32(16, true), 40);
      assert.equal(v.getUint16(20, true), 0xfffe);
      assert.equal(v.getUint16(22, true), channels);
      assert.equal(v.getUint32(24, true), rate);
      assert.equal(v.getUint32(28, true), rate * channels * 2);
      assert.equal(v.getUint16(32, true), channels * 2);
      assert.equal(v.getUint16(34, true), 16);
      assert.equal(v.getUint16(36, true), 22);
      assert.equal(v.getUint16(38, true), 12);
      assert.equal(v.getUint32(40, true), channels === 1 ? 4 : 3);
      assert.deepEqual(
        [...new Uint8Array(wav, 44, 16)],
        [1, 0, 0, 0, 0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113],
      );
      assert.equal(String.fromCharCode(...new Uint8Array(wav, 60, 4)), "data");
      assert.equal(v.getUint32(64, true), left.length * channels * 2);
      assert.equal(decoded.bits, 12);
      assert.equal(decoded.containerBits, 16);
      assert.equal(decoded.validBits, 12);
      assert.equal(decoded.rate, rate);
      assert.equal(decoded.channels, channels);
      for (let i = 0; i < left.length; i++)
        for (let c = 0; c < channels; c++) {
          const source = [left, right][c][i],
            integer = v.getInt16(68 + (i * channels + c) * 2, true),
            expected = Math.round(source * (source < 0 ? 2048 : 2047));
          assert.equal(integer & 15, 0);
          assert.equal(integer, expected * 16);
          assert.equal(decoded.audio[c][i], expected / 2048);
          assert.ok(Math.abs(decoded.audio[c][i] - source) < 1 / 1024);
        }
      if (channels === 1) assert.deepEqual(decoded.audio[0], decoded.audio[1]);
      assert.deepEqual(
        rawWave(new Uint8Array(wav)),
        resampleAudio(decoded.audio, rate, 44100),
      );
    });
  }
test("12-bit WAV clips finite over-range audio and rejects nonfinite data", () => {
  const a = new Float32Array([-2, 2]);
  assert.deepEqual(
    decodePcmWav(encodePcmWav([a], 8000, 12, 1)).audio[0],
    new Float32Array([-1, 2047 / 2048]),
  );
  assert.throws(
    () => encodePcmWav([new Float32Array([NaN])], 8000, 12, 1),
    /non-finite/,
  );
});
test("decoder rejects invalid extensible precision and unsupported subtypes", () => {
  const raw = encodePcmWav([left], 8000, 12, 1);
  for (const bits of [0, 17, 65535]) {
    const invalid = raw.slice(0);
    new DataView(invalid).setUint16(38, bits, true);
    assert.throws(() => decodePcmWav(invalid), /valid bits/);
  }
  const short = raw.slice(0);
  new DataView(short).setUint16(36, 21, true);
  assert.throws(() => decodePcmWav(short), /extensible/);
  const guid = raw.slice(0);
  new DataView(guid).setUint8(59, 0);
  assert.throws(() => decodePcmWav(guid), /subtype/);
});
test("recording model accepts lower sample rates with all five bit depths", () => {
  for (const rate of [8000, 11025])
    for (const bits of [8, 12, 16, 24, 32]) {
      const state = validateBank({
        type: "sample_program",
        version: 3,
        name: "Test",
        samples: [],
        record: { sample_rate: rate, bit_depth: bits },
      });
      assert.equal(state.record.sample_rate, rate);
      assert.equal(state.record.bit_depth, bits);
    }
  assert.throws(
    () =>
      validateBank({
        type: "sample_program",
        version: 3,
        samples: [],
        record: { sample_rate: 5000, bit_depth: 12 },
      }),
    /recording format/,
  );
});
