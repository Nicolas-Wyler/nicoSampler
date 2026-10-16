import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {WasmEngine} from '../src/wasm-engine.js';
import {session,sample} from '../src/model.js';
import {metadata} from '../src/storage.js';
const workerCode=await readFile(new URL('../src/file-worker.js',import.meta.url),'utf8');
function fileWorker(){const messages=[],scope={self:{},postMessage:m=>messages.push(m),atob,btoa,Uint8Array,Float32Array,DataView,ArrayBuffer,JSON,Number,Error};vm.runInNewContext(workerCode,scope);return {call:(type,data)=>{scope.self.onmessage({data:{type,data,token:1}});return messages.pop();}};}
test('file worker embeds and recovers stereo audio without mutation or loss',()=>{const state=session(),s=sample();s.audio=[new Float32Array([-.75,0,.25]),new Float32Array([.5,.125,-.125])];state.programs[0].samples=[s];const w=fileWorker(),encoded=w.call('encode',metadata(state));assert.ok(!encoded.error);assert.equal(s.audio[0][0],-.75);const decoded=w.call('decode',encoded.result);assert.ok(!decoded.error);assert.deepEqual(Array.from(decoded.result.audio[0][0]),[-.75,0,.25]);assert.deepEqual(Array.from(decoded.result.audio[0][1]),[.5,.125,-.125]);});
test('file worker rejects malformed, truncated, nonfinite and oversized audio',()=>{const w=fileWorker();for(const raw of ['{',JSON.stringify({programs:[{samples:[{embedded:{encoding:'wrong'}}]}]}),JSON.stringify({programs:[{samples:[{embedded:{encoding:'f32le-stereo',frames:1,data:''}}]}]}),JSON.stringify({programs:[{samples:[{embedded:{encoding:'f32le-stereo',frames:44100*601,data:''}}]}]})])assert.ok(w.call('decode',raw).error);const b=Buffer.alloc(8);b.writeFloatLE(NaN);b.writeFloatLE(0,4);assert.ok(w.call('decode',JSON.stringify({programs:[{samples:[{embedded:{encoding:'f32le-stereo',frames:1,data:b.toString('base64')}}]}]})).error);});
const module=await WebAssembly.compile(await readFile(new URL('../src/engine.wasm',import.meta.url)));
async function worklet(rate=48000){let Processor;const messages=[];const code=(await readFile(new URL('../src/audio-worklet.js',import.meta.url),'utf8')).replace(/^import .*;\n/,'');const scope={WasmEngine,sampleRate:rate,AudioWorkletProcessor:class{constructor(){this.port={postMessage:m=>messages.push(m)};}},registerProcessor:(name,p)=>Processor=p,Float32Array,Math,Error};vm.runInNewContext(code,scope);const p=new Processor({processorOptions:{module}});return {p,messages,process:(l=new Float32Array(128),r=l)=>{const out=[new Float32Array(128),new Float32Array(128)];p.process([[l,r]],[out]);return out;}};}
test('worklet arm waits for threshold, records stereo and flushes on stop',async()=>{const {p,messages,process}=await worklet();p.message({type:'record',mode:'Stereo',threshold:-20,arm:true});process();assert.equal(p.recordFrames,0);const l=new Float32Array(128);l[20]=.5;const r=new Float32Array(128).fill(.01);process(l,r);assert.equal(p.recordFrames,108);p.message({type:'recordStop'});const chunk=messages.find(m=>m.type==='recordChunk');assert.equal(chunk.audio.length,216);assert.equal(chunk.audio[0],.5);assert.ok(Math.abs(chunk.audio[1]-.01)<1e-7);assert.equal(messages.at(-1).type,'recordDone');});
test('worklet mono channel choices and recording limit are exact',async()=>{for(const [mode,left,right] of [['Mono L',.3,.3],['Mono R',.7,.7],['Mono mix',.5,.5]]){const {p,messages,process}=await worklet();p.maxFrames=100;p.message({type:'record',mode,threshold:-20,arm:false});process(new Float32Array(128).fill(.3),new Float32Array(128).fill(.7));const chunk=messages.find(m=>m.type==='recordChunk');assert.equal(chunk.audio.length,200);assert.ok(Math.abs(chunk.audio[0]-left)<1e-6);assert.ok(Math.abs(chunk.audio[1]-right)<1e-6);assert.equal(messages.at(-1).limited,true);assert.equal(p.recording,false);}});
test('threshold trigger and meter use the selected recording channels',async()=>{
 for(const[mode,l,r,starts,peak]of[['Mono R',.8,.01,false,.01],['Mono L',.01,.8,false,.01],['Mono mix',.8,-.8,false,0],['Stereo',.8,.01,true,.8]]){
  const {p,messages,process}=await worklet();p.message({type:'inputMode',mode});p.message({type:'record',mode,threshold:-20,arm:true});
  for(let i=0;i<20;i++)process(new Float32Array(128).fill(l),new Float32Array(128).fill(r));
  assert.equal(messages.some(m=>m.type==='recordStarted'),starts,mode);
  const meter=messages.filter(m=>m.type==='meter').at(-1);assert.ok(meter,mode);assert.ok(Math.abs(meter.inputPeak-peak)<1e-6,mode);
 }
});
