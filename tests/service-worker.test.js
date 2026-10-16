import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
const origin='https://example.test';
async function request(path,{direct=false,index=false,mode='navigate'}={}) {
  const handlers={},matches=[];let network=0,result;
  const response={ok:true,body:'cached app'};
  vm.runInNewContext(source,{
    URL,
    self:{location:{origin,href:origin+'/sampler/sw.js'},addEventListener:(n,h)=>handlers[n]=h},
    caches:{match:async(value,options)=>{matches.push({url:String(value.url??value),options});
      if(options.ignoreVary && (direct || (index && String(value).endsWith('/sampler/index.html'))))return response;
    }},
    fetch:async()=>{network++;throw Error('offline');}
  });
  handlers.fetch({request:{url:origin+path,method:'GET',mode},respondWith:p=>result=p});
  try {return {response:await result,matches,network};}catch(error){return{error,matches,network};}
}
test('cached static responses survive a hosting Vary header difference',async()=>{
  const r=await request('/sampler/',{direct:true});assert.equal(r.response.body,'cached app');assert.equal(r.network,0);assert.equal(r.matches[0].options.ignoreVary,true);
});
test('offline app navigation falls back to the precached index including query URLs',async()=>{
  for(const path of ['/sampler/','/sampler/?source=install','/sampler/index.html?source=install']){
    const r=await request(path,{index:true});assert.equal(r.response.body,'cached app');assert.equal(r.network,0);
  }
});
test('missing documents and non-navigation resources do not receive the app shell',async()=>{
  for(const [path,mode]of [['/sampler/missing.pdf','navigate'],['/sampler/','cors']]){
    const r=await request(path,{index:true,mode});assert.match(r.error.message,/offline/);assert.equal(r.network,1);
  }
});

test('offline installation retries interrupted assets before activating',async()=>{
  const handlers={},attempts=new Map();let installed,skipped=false;
  vm.runInNewContext(source,{URL,Request:class {constructor(url){this.url=url;}},self:{location:{origin,href:origin+'/sampler/sw.js'},addEventListener:(n,h)=>handlers[n]=h,skipWaiting:()=>{skipped=true;}},caches:{open:async()=>({add:async request=>{const count=(attempts.get(request.url)||0)+1;attempts.set(request.url,count);if(count===1)throw Error('interrupted');}})}});
  handlers.install({waitUntil:p=>installed=p});await installed;
  assert.ok(attempts.size>40);assert.ok([...attempts.values()].every(n=>n===2));assert.equal(skipped,true);
});
test('failed offline asset never activates an incomplete installation',async()=>{
  const handlers={};let installed,attempts=0,skipped=false;
  vm.runInNewContext(source,{URL,Request:class {},self:{location:{origin,href:origin+'/sampler/sw.js'},addEventListener:(n,h)=>handlers[n]=h,skipWaiting:()=>{skipped=true;}},caches:{open:async()=>({add:async()=>{attempts++;throw Error('offline');}})}});
  handlers.install({waitUntil:p=>installed=p});await assert.rejects(installed,/offline/);assert.equal(skipped,false);assert.ok(attempts>=3);
});
test('ready offline confirmation requires every cached resource',async()=>{
  for(const missing of [false,true]){
    const handlers={};let pending,result;
    vm.runInNewContext(source,{URL,self:{location:{origin,href:origin+'/sampler/sw.js'},addEventListener:(n,h)=>handlers[n]=h},caches:{open:async()=>({match:async url=>missing&&String(url).endsWith('/src/engine.wasm')?undefined:{ok:true}})}});
    handlers.message({data:{type:'OFFLINE_STATUS'},ports:[{postMessage:r=>result=r}],waitUntil:p=>pending=p});await pending;
    assert.equal(result.ready,!missing);assert.equal(result.cached,result.total-(missing?1:0));
  }
});
