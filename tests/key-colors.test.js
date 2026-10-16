import test from 'node:test';
import assert from 'node:assert/strict';
import {keyColor, assignedNotes, sampleColorGradient} from '../src/key-colors.js';
function luminance(hex) {
  return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);
}
test('all128 MIDI colors are stable, unique and visible on row backgrounds',()=>{
  const palette=Array.from({length:128},(_,n)=>keyColor(n));assert.equal(new Set(palette).size,128);
  for(let n=0;n<128;n++) {
    assert.match(palette[n],/^#[0-9a-f]{6}$/);assert.equal(keyColor(n),palette[n]);
    for(const bg of ['#34482e','#1d261f'])assert.ok((luminance(palette[n])+.05)/(luminance(bg)+.05)>=3.2);
    // Dark piano note labels retain readable contrast on every assigned key.
    assert.ok((luminance(palette[n])+.05)/(luminance('#101713')+.05)>=4.5);
  }
  for(const n of [-1,128,null,60.5])assert.equal(keyColor(n),null);
});
test('single, spread and shared assignments derive exactly from note routing',()=>{
  assert.deepEqual(assignedNotes({key:60}),[60]);
  assert.deepEqual(assignedNotes({key:null}),[]);
  const a={root_note:60,low_note:59,high_note:62};assert.deepEqual(assignedNotes(a),[59,60,61,62]);
  const gradient=sampleColorGradient(a);for(const n of [59,60,61,62])assert.ok(gradient.includes(keyColor(n)));
  assert.equal(sampleColorGradient({key:60}),sampleColorGradient({key:60,mute:true,name:'other'}));
  assert.equal(sampleColorGradient({key:null}),'none');
});
