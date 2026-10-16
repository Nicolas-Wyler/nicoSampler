import assert from 'node:assert/strict';
import { createZoomInertia } from '../src/zoom-inertia.js';
let time=0, next=0, frames=new Map(), reduced=false;
globalThis.performance={now:()=>time};
globalThis.requestAnimationFrame=fn=>{frames.set(++next,fn);return next};
globalThis.cancelAnimationFrame=id=>frames.delete(id);
globalThis.matchMedia=()=>({matches:reduced});
let scale=1, focal;
const motion=createZoomInertia({getScale:()=>scale,setScale:(s,f)=>{scale=s;focal=f},min:1,max:4});
function tick(){time+=16;const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(time))}
motion.begin();time+=16;motion.update(1.5,72);motion.release();
const first=[...frames.values()];frames.clear();first.forEach(fn=>fn(time));assert(scale>1.5);assert.equal(frames.size,1);
tick();assert(scale>1.5);assert.equal(focal,72);
for(let i=0;i<30;i++)tick();assert.equal(frames.size,0);assert(scale<4);
motion.begin();time+=16;motion.update(3.99,30);motion.release();for(let i=0;i<30;i++)tick();assert.equal(scale,4);assert.equal(frames.size,0);
scale=1;motion.begin();time+=16;motion.update(1.5,10);motion.release();motion.cancel();assert.equal(frames.size,0);
reduced=true;motion.begin();time+=16;motion.update(2,20);motion.release();assert.equal(frames.size,0);assert.equal(scale,2);
console.log('Zoom momentum: coasting, focal point, damping, limits, cancel, and reduced motion passed.');
