import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {sample,fitMarkers} from '../src/model.js';
import {WasmEngine,interleave} from '../src/wasm-engine.js';

test('MPC playback starts at trim start and wraps into an earlier loop without rewriting source audio',async()=>{
 const s=sample('MPC bass',60);Object.assign(s,{audio:[Float32Array.from({length:100},(_,i)=>i/1000)],trim_start:70,trim_end:100,loop_start:60,loop_end:100,playback:'loop poly'});
 const original=s.audio[0].slice();fitMarkers(s);
 assert.equal(s.trim_start,70);assert.equal(s.loop_start,60);assert.deepEqual(s.audio[0],original);
 const engine=new WasmEngine(await WebAssembly.compile(fs.readFileSync(new URL('../src/engine.wasm',import.meta.url))));
 engine.load(0,interleave(s.audio));engine.configure(0,s);engine.api.set_master(1);engine.api.trigger(0,60,127,0);
 const output=engine.output(80)[0].slice(),gain=output[1]/(original[71]/(44100*.005-1));
 assert.ok(gain>0);
 for(let i=1;i<80;i++){const frame=i<30?70+i:60+(i-30)%40;assert.ok(Math.abs(output[i]-original[frame]*gain*Math.min(1,i/(44100*.005-1)))<1e-6,`frame ${i}`);}
});
test('unused loop markers do not change trim boundaries',()=>{
 const s=sample();Object.assign(s,{audio:[new Float32Array(100)],trim_start:10,trim_end:80,loop_start:93,loop_end:100,playback:'poly'});fitMarkers(s);
 assert.equal(s.trim_start,10);assert.equal(s.trim_end,80);assert.equal(s.loop_start,93);assert.equal(s.loop_end,100);
});
