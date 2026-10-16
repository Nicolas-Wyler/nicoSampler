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
