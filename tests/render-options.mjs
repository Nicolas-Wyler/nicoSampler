import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {sample,session,fitMarkers} from '../src/model.js';
import {encodePcmWav,decodePcmWav} from '../src/wav-format.js';
import {sourceRenderFormat,renderSelectionDefaults} from '../src/render-options.js';
import {resampleExport} from '../src/resample-export.js';
const wav=await fs.readFile(new URL('../src/engine.wasm',import.meta.url));
globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>wav.buffer.slice(wav.byteOffset,wav.byteOffset+wav.byteLength)});
function row(name,rate,bits,channels){const s=sample(name);s.audio=[new Float32Array(1024).fill(.13),new Float32Array(1024).fill(.22)];fitMarkers(s);s.source_wav=encodePcmWav(s.audio,rate,bits,channels);s.crush_rate=11025;s.crush_bits=5;return s}
const one=row('One',48000,24,1),same=row('Same',48000,24,1),different=row('Different',32000,16,2),state=session();
assert.deepEqual(sourceRenderFormat(one),{rate:48000,bits:24,channels:1});
assert.equal(renderSelectionDefaults([one,same]).mixed,false);assert.deepEqual(renderSelectionDefaults([one,same]).common,{rate:48000,bits:24,channels:1});
assert.equal(renderSelectionDefaults([one,different]).mixed,true);
const fallback=sample('Unknown');fallback.audio=one.audio;fallback.crush_rate=12000;fallback.crush_bits=7;
assert.deepEqual(sourceRenderFormat(fallback),{rate:44100,bits:32,channels:2});
fallback.recording_format={sample_rate:16000,bit_depth:8,channels:1};assert.deepEqual(sourceRenderFormat(fallback),{rate:16000,bits:8,channels:1});
const render=await resampleExport([one],state,{policy:'source'}),decoded=decodePcmWav(render.data);assert.equal(decoded.rate,48000);assert.equal(decoded.bits,24);assert.equal(decoded.channels,1);
const high=row('High',384000,32,2),highOutput=await resampleExport([high],state,{policy:'source'});assert.equal(decodePcmWav(highOutput.data).rate,384000);
const mixed=await resampleExport([one,different],state,{policy:'source'});assert.equal(mixed.type,'application/zip');
// Read the two stored WAV payloads independently of the sample-container parser.
const bytes=mixed.data,view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let p=0;const formats=[];
while(p+30<bytes.length&&view.getUint32(p,true)===0x04034b50){const length=view.getUint32(p+18,true),names=view.getUint16(p+26,true),extra=view.getUint16(p+28,true),start=p+30+names+extra;const audio=decodePcmWav(bytes.subarray(start,start+length));formats.push([audio.rate,audio.bits,audio.channels]);p=start+length}
assert.deepEqual(formats,[[48000,24,1],[32000,16,2]]);
const common=await resampleExport([one],state,{rate:8000,bits:32,channels:2,policy:'common'});assert.equal(decodePcmWav(common.data).rate,8000);
await assert.rejects(()=>resampleExport([one],state,{format:'mp3',policy:'source'}),/MP3/);
console.log('Render defaults: original WAV/recording formats, matching/mixed detection, crush-independent fallback, per-source exports, common8k and384k WAV exports passed.');

const twelve = row("Twelve",11025,12,1);
const renderedTwelve = await resampleExport([twelve],state,{policy:"source"});
const twelveFormat = decodePcmWav(renderedTwelve.data);
assert.equal(twelveFormat.bits,12);assert.equal(twelveFormat.containerBits,16);assert.equal(twelveFormat.rate,11025);
console.log("12-bit source-based WAV rendering preserves valid precision and 11.025 kHz rate.");
