import test from 'node:test';
import assert from 'node:assert/strict';
import {buildVersion} from '../scripts/lib/build-version.mjs';
import {session,validateBank} from '../src/model.js';
import {metadata} from '../src/storage.js';
test('every CI run and rerun receives a distinct version',()=>{
 assert.equal(buildVersion('0.2.0',{GITHUB_RUN_NUMBER:'15',GITHUB_RUN_ATTEMPT:'1'}),'0.2.15');
 assert.equal(buildVersion('0.2.0',{GITHUB_RUN_NUMBER:'16',GITHUB_RUN_ATTEMPT:'1'}),'0.2.16');
 assert.equal(buildVersion('0.2.0',{GITHUB_RUN_NUMBER:'15',GITHUB_RUN_ATTEMPT:'2'}),'0.2.15+build.2');
});
test('local builds get timestamp identities and reproduction is explicit',()=>{
 assert.notEqual(buildVersion('0.2.0',{},100),buildVersion('0.2.0',{},101));
 assert.equal(buildVersion('0.2.0',{SAMPLER_BUILD_VERSION:'0.2.15'}),'0.2.15');
 assert.throws(()=>buildVersion('0.2.0',{SAMPLER_BUILD_VERSION:'../bad'}));
});
test('keyboard fold state survives saved bank preferences',()=>{
 const state=session();state.viewSettings={keyboard:{collapsed:true,zoom:2,position:.4},tableScroll:0,programScroll:0};
 const restored=validateBank(metadata(state,true));assert.equal(restored.viewSettings.keyboard.collapsed,true);
 const raw=metadata(state,true);raw.preferences.view.keyboard.collapsed='true';assert.throws(()=>validateBank(raw),/fold state/);
});
