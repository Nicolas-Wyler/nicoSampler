import assert from 'node:assert/strict';
import {amplitudeDb,dbPosition,positionDb,peakPosition,litSegments} from '../src/meters.js';
assert.equal(amplitudeDb(0),-60);assert.equal(litSegments(0),0);assert.equal(litSegments(1),40);assert.equal(litSegments(.001),0);assert.equal(litSegments(.1),27);assert.equal(litSegments(10),40);assert.equal(peakPosition(NaN),0);
for(const db of [-60,-48,-33.9794000867,-24,-12,0]) {assert.ok(Math.abs(positionDb(dbPosition(db))-db)<1e-10);assert.ok(Math.abs(peakPosition(10**(db/20))-dbPosition(db))<1e-10);}
assert.ok(Math.abs(peakPosition(.02)-.4336766652)<1e-8);assert.equal(litSegments(.02),17);console.log('Python40LED dBFS mapping, threshold/amplitude alignment, clipping, silence passed');
