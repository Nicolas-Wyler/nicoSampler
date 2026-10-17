import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {WasmEngine,interleave} from '../src/wasm-engine.js';
import {sample,fitMarkers,RATE} from '../src/model.js';
const module=await WebAssembly.compile(fs.readFileSync(new URL('../src/engine.wasm',import.meta.url)));
function engine(audio,{master=1,wasm=module}={}){
 const e=new WasmEngine(wasm),s=sample();s.audio=audio;s.playback='poly';fitMarkers(s);
 e.load(0,interleave(audio));e.configure(0,s);e.api.set_master(master);e.api.trigger(0,60,127,0);return e;
}
function render(e,n,pattern=[128]){const out=[new Float32Array(n),new Float32Array(n)];for(let offset=0,j=0;offset<n;j++){const count=Math.min(pattern[j%pattern.length],n-offset),block=e.output(count);for(let c=0;c<2;c++)out[c].set(block[c],offset);offset+=count;}return out;}
const sine=(n,amplitude=2,frequency=55)=>Float32Array.from({length:n},(_,i)=>amplitude*Math.sin(2*Math.PI*frequency*i/RATE));
function residual(a,start,count,f=55){let ss=0,cc=0,energy=0;for(let j=0;j<count;j++){const i=start+j,v=a[i],phase=2*Math.PI*f*i/RATE;ss+=v*Math.sin(phase);cc+=v*Math.cos(phase);energy+=v*v;}const fundamental=2*(ss*ss+cc*cc)/count;return Math.sqrt(Math.max(0,energy-fundamental)/energy);}

test('limiting is independent of render quantum partition and links stereo',()=>{
 const left=sine(RATE*2,2),right=Float32Array.from(left,x=>x*.37);
 const a=render(engine([left,right]),RATE,[128]),b=render(engine([left,right]),RATE,[1,17,251,64,511]);
 let difference=0,ratioError=0,peak=0;
 for(let i=0;i<RATE;i++){difference=Math.max(difference,Math.abs(a[0][i]-b[0][i]));ratioError=Math.max(ratioError,Math.abs(a[1][i]-.37*a[0][i]));peak=Math.max(peak,Math.abs(a[0][i]),Math.abs(a[1][i]));}
 assert.ok(difference<2e-6,`partition difference ${difference}`);
 assert.ok(ratioError<2e-6,`stereo ratio error ${ratioError}`);
 assert.ok(peak<=1.000001,`sample peak ${peak}`);
});

test('quiet audio stays unity below protection, and meter reads final Master output',()=>{
 const left=sine(RATE,.4),right=Float32Array.from(left,x=>x*.5),e=engine([left,right],{master:.25});
 const out=render(e,4096);for(let i=1000;i<4096;i++)assert.ok(Math.abs(out[0][i]-left[i]*.25)<1e-6);
 const actual=Math.max(...out[0].map(Math.abs),...out[1].map(Math.abs));
 assert.ok(e.api.output_peak()<=.100001,`meter ${e.api.output_peak()} vs final ${actual}`);
 assert.ok(e.api.output_peak()>=actual*.9);
});

test('overload is bounded and meter cannot report the unprotected sum',()=>{
 const audio=[new Float32Array(8192).fill(4),new Float32Array(8192).fill(-2)],e=engine(audio);
 const out=render(e,4096);assert.ok(Math.max(...out[0])<=1.000001);assert.ok(e.api.output_peak()<=1.000001);
 assert.ok(e.api.output_peak()>.99);
});

test('panic clears protection memory so a quiet restart is unaffected',()=>{
 const loud=new Float32Array(RATE*2).fill(4),e=engine([loud,loud]);render(e,4096);e.api.panic();
 assert.equal(e.api.output_peak(),0);
 const s=sample();s.audio=[new Float32Array(8192).fill(.2),new Float32Array(8192).fill(.1)];fitMarkers(s);e.load(1,interleave(s.audio));e.configure(1,s);e.api.trigger(1,60,127,0);
 const out=render(e,2048);assert.ok(Math.abs(out[0][1500]-.2)<1e-6,'panic must not leave attenuation behind');
});

test('steady overload bass has low harmonic residual after protection settles',()=>{
 const audio=sine(RATE*3,2,55),out=render(engine([audio,audio]),RATE*2);
 const distortion=residual(out[0],RATE,RATE);
 const oldBlock=audio.slice(0,RATE*2);
 for(let offset=0;offset<oldBlock.length;offset+=128){
  const end=Math.min(oldBlock.length,offset+128);let peak=0;
  for(let i=offset;i<end;i++)peak=Math.max(peak,Math.abs(oldBlock[i]));
  if(peak>.95)for(let i=offset;i<end;i++)oldBlock[i]*=.95/peak;
 }
 const previous=residual(oldBlock,RATE,RATE);
 console.log(`55 Hz overloaded sine residual: old block ${(100*previous).toFixed(5)}%, new ${(100*distortion).toFixed(5)}%`);
 assert.ok(distortion<.005,`steady harmonic residual ${distortion}`);
 assert.ok(distortion<previous*.1,`residual improvement ${previous} -> ${distortion}`);
});

test('live monitor and sampler share one stereo ceiling and final meter',()=>{
 const e=engine([new Float32Array(8192).fill(.8),new Float32Array(8192).fill(.4)]);
 e.api.set_monitor(1);
 for(let i=0;i<12;i++)e.output(128,[new Float32Array(128).fill(.8),new Float32Array(128).fill(.4)]);
 const out=e.output(128,[new Float32Array(128).fill(.8),new Float32Array(128).fill(.4)]);
 assert.ok(out[0].every(x=>Math.abs(x-1)<1e-5),'combined1.6 signal limited once to1');
 assert.ok(out[1].every(x=>Math.abs(x-.5)<1e-5),'linked stereo ratio remains intact');
 assert.ok(e.api.output_peak()<=1.000001&&e.api.output_peak()>.99);
 e.api.set_monitor(0);e.api.panic();
 assert.ok(e.output(128,[]).every(c=>c.every(x=>x===0)));
});

test('monitor alone applies its supplied gain and meter sees that final signal',()=>{
 const e=new WasmEngine(module);e.api.set_monitor(.5);
 const out=e.output(128,[new Float32Array(128).fill(.2),new Float32Array(128).fill(-.1)]);
 assert.ok(out[0].every(x=>Math.abs(x-.1)<1e-7));assert.ok(out[1].every(x=>Math.abs(x+.05)<1e-7));
 assert.ok(Math.abs(e.api.output_peak()-.1)<1e-7);
 assert.ok(e.output(128,[]).every(c=>c.every(x=>x===0)),'missing capture channels cannot replay old input');
});

test('auxiliary take preview joins monitored and sampler audio before the final ceiling',()=>{
 const e=engine([new Float32Array(8192).fill(.6),new Float32Array(8192).fill(.3)]);e.api.set_monitor(1);
 const monitor=[new Float32Array(128).fill(.4),new Float32Array(128).fill(.2)],aux=[new Float32Array(128).fill(.6),new Float32Array(128).fill(.3)];
 let out;for(let i=0;i<12;i++)out=e.output(128,monitor,aux);
 assert.ok(out[0].every(x=>Math.abs(x-1)<1e-5));assert.ok(out[1].every(x=>Math.abs(x-.5)<1e-5));
 assert.ok(e.api.output_peak()<=1.000001&&e.api.output_peak()>.99);
 e.api.panic();e.api.set_monitor(0);assert.ok(e.output(128).every(c=>c.every(x=>x===0)),'omitted inputs are zeroed');
});
