import test from "node:test";
import assert from "node:assert/strict";
import { encodePcmWav, decodePcmWav } from "../src/wav-format.js";
import {
  sourceRenderFormat,
  renderSelectionDefaults,
} from "../src/render-options.js";

test("12-bit recorded source keeps effective precision in resample defaults", () => {
  const audio = [
    new Float32Array([-0.7, 0, 0.4]),
    new Float32Array([0.2, 0, -0.1]),
  ];
  const wav = encodePcmWav(audio, 11025, 12, 2);
  const row = { audio, source_wav: wav };
  assert.deepEqual(sourceRenderFormat(row), {
    rate: 11025,
    bits: 12,
    channels: 2,
  });
  assert.deepEqual(renderSelectionDefaults([row]).common, {
    rate: 11025,
    bits: 12,
    channels: 2,
  });
  const target = encodePcmWav(
    decodePcmWav(wav).audio,
    11025,
    sourceRenderFormat(row).bits,
    2,
  );
  assert.equal(decodePcmWav(target).bits, 12);
});

test("12-bit take metadata remains usable without a raw WAV", () => {
  assert.deepEqual(
    sourceRenderFormat({
      recording_format: { sample_rate: 8000, bit_depth: 12, channels: 1 },
    }),
    { rate: 8000, bits: 12, channels: 1 },
  );
});
