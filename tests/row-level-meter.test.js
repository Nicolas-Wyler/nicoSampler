import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {WasmEngine,interleave} from '../src/wasm-engine.js';
import {sample,fitMarkers} from '../src/model.js';
import {renderRowMeter} from '../src/meters.js';
const module=await WebAssembly.compile(fs.readFileSync(new URL('../src/engine.wasm',import.meta.url)));
function fixture(){
 const e=new WasmEngine(module),rows=[];
 for(const [id,amplitude] of [[0,.1],[1,.5]]){const s=sample();s.playback='poly';s.level=1;s.audio=[new Float32Array(44100*3).fill(amplitude),new Float32Array(44100*3).fill(amplitude)];fitMarkers(s);e.load(id,interleave(s.audio));e.configure(id,s);rows.push(s)}
 return {e,rows};
}
function advance(e,n=16){for(let i=0;i<n;i++)e.output(128)}
test('row peaks measure independent post-fader audio and sum simultaneous voices',()=>{
 const {e}=fixture();e.api.trigger(0,60,127,0);e.api.trigger(1,61,127,0);advance(e);
 assert(Math.abs(e.api.sample_peak(0)-.1)<.001);assert(Math.abs(e.api.sample_peak(1)-.5)<.001);
 e.api.trigger(0,62,127,0);advance(e);assert(Math.abs(e.api.sample_peak(0)-.2)<.001);assert(Math.abs(e.api.sample_peak(1)-.5)<.001);
 e.api.set_master(0);advance(e);assert(e.api.sample_peak(1)>.49,'row meter remains before master');
});
test('mute meters decay through silence and Panic clears immediately',()=>{
 const {e,rows}=fixture();e.api.trigger(0,60,127,0);advance(e);const peak=e.api.sample_peak(0);rows[0].mute=true;e.configure(0,rows[0]);advance(e,350);assert(e.api.sample_peak(0)<peak*.03);e.api.panic();assert.equal(e.api.sample_peak(0),0);assert.equal(e.api.sample_peak(-1),0);
});
test('row LED thresholds distinguish silence, quiet signal, amber and clipping',()=>{
 const lit=new Set(),attrs={};const element={children:Array.from({length:12},(_,i)=>({classList:{toggle:(_,on)=>on?lit.add(i):lit.delete(i)}})),setAttribute:(k,v)=>attrs[k]=v};
 renderRowMeter(element,0);assert.equal(lit.size,0);
 renderRowMeter(element,.01);assert.equal(lit.size,4);
 renderRowMeter(element,.5);assert.equal(lit.size,10);assert(!lit.has(0));assert(lit.has(2));
 renderRowMeter(element,1);assert.equal(lit.size,12);assert(lit.has(0));assert.equal(attrs['aria-valuenow'],'0');
});
