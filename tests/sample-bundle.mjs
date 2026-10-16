import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {sample,session} from '../src/model.js';
import {decodeSampleContainer} from '../src/sample-container.js';
import {sampleBundle} from '../src/sample-bundle.js';
const state=session();state.master=.63;state.fx=[{time:.17,feedback:.21},{time:.4,feedback:.52}];
const one=sample('../Same:name'),two=sample('../same:NAME'),other=sample('Unselected');
for(const row of [one,two,other])row.audio=[Float32Array.of(.125,-.25,.75),Float32Array.of(-.5,.25,.125)];
Object.assign(one,{level:.34,pan:-.72,reverse:true,semitone:4,fine:-22,fx1:.28,trim_start:1,trim_end:3});
state.programs[0].samples=[one,two,other];
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'nico-samples-'));
try{
 const filename=path.join(directory,'samples.zip');await fs.writeFile(filename,sampleBundle([one,two,sample('Blank')],state));
 const files=JSON.parse(execFileSync('python3',['-c',`import zipfile,json,base64,sys
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 print(json.dumps({n:base64.b64encode(z.read(n)).decode() for n in z.namelist()}))`,filename],{encoding:'utf8'}));
 const names=Object.keys(files);assert.equal(names.length,4);assert.equal(new Set(names.map(name=>name.toLowerCase())).size,4);
 assert(names.every(name=>name.startsWith('samples/')&&!name.includes('..')&&!name.includes(':')&&!name.includes('Unselected')));
 assert(!names.some(name=>name.includes('project.')));
 const container=decodeSampleContainer(Buffer.from(files[names.find(name=>name.startsWith('samples/001-')&&name.endsWith('.nicosample'))],'base64'));
 const actual=container.programs[0].samples[0];
 for(const key of ['level','pan','reverse','semitone','fine','fx1','trim_start','trim_end'])assert.equal(actual[key],one[key]);
 assert.deepEqual([...actual.audio[0]],[...one.audio[0]]);assert.deepEqual(container.fx,state.fx);assert.equal(container.master,state.master);
 const raw=Buffer.from(files[names.find(name=>name.startsWith('samples/001-')&&name.endsWith('.raw.wav'))],'base64');assert.equal(raw.readFloatLE(44),.125);
 assert.throws(()=>sampleBundle([sample('Blank')],state),/Load a sample/);
 assert.throws(()=>sampleBundle(Array(32768).fill(one),state),/entry limit/);
 console.log('Selected-sample ZIP: independent Python CRC, selected-only scope, raw PCM, exact parameters, safe duplicate/case filenames, blank rows and entry limit passed.');
}finally{await fs.rm(directory,{recursive:true,force:true})}
