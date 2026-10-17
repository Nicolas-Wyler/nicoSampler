import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { webkit, devices } from "playwright";
const root = fileURLToPath(new URL("..", import.meta.url)),
  probe = net.createServer();
await new Promise((r) => probe.listen(0, "127.0.0.1", r));
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const origin = `http://127.0.0.1:${port}`,
  server = spawn(process.execPath, ["serve.mjs"], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore",
  });
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(origin)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 50));
}
try {
 for(const [model,width,height] of [['iPhone 12 Pro Max',428,926],['iPhone 12 Pro Max',926,428],['iPhone 12',390,844],['iPhone 12',844,390]]){
  const browser=await webkit.launch({headless:true});try{
   const page=await browser.newPage({...devices[model],viewport:{width,height}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{
    window.updaterQA={checks:0,states:[],delay:false};
    const original=window.fetch;
    window.fetch=async function(input,...args){
     if(String(input?.url||input).includes('/sw.js')){updaterQA.checks++;if(updaterQA.delay)await new Promise(r=>setTimeout(r,350));}
     return original.call(this,input,...args);
    };
    document.addEventListener('DOMContentLoaded',()=>new MutationObserver(()=>{
     const b=document.querySelector('#app-update');updaterQA.states.push({html:b.innerHTML,action:b.dataset.action,disabled:b.disabled});
    }).observe(document.querySelector('#app-update'),{childList:true,attributes:true}));
   });
   await page.goto(origin);await page.addStyleTag({content:'#offline-status{display:none!important}'});
   await page.locator('#landing-new').tap();await page.locator('#load-kind').selectOption('example');
   await page.waitForFunction(()=>document.querySelector('#sample-count').textContent==='16');
   const idle=page.locator('#app-update[data-action="check"]');
   await idle.waitFor({state:'visible',timeout:120000});
   const geometry=await idle.evaluate(e=>{const r=e.getBoundingClientRect(),svg=e.querySelector('svg').getBoundingClientRect(),style=getComputedStyle(e);return{width:r.width,svg:svg.width,opacity:Number(style.opacity),fits:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),label:e.getAttribute('aria-label')};});
   assert.equal(geometry.width,28);assert.equal(geometry.svg,18);assert.ok(geometry.opacity>=.8&&geometry.fits&&geometry.hit);assert.equal(geometry.label,'Check for updates');
   const before=await page.evaluate(()=>{updaterQA.delay=true;updaterQA.states=[];return updaterQA.checks;});
   await idle.tap();
   await page.waitForFunction(n=>updaterQA.checks>n,before);
   await page.waitForFunction(()=>updaterQA.states.some(s=>s.html.includes('update-spinner')&&s.html.includes('<svg')));
   await idle.waitFor({state:'visible'});
   await page.context().setOffline(true);
   await page.waitForFunction(()=>document.querySelector('#app-update').textContent==='Offline');
   assert.equal(await page.locator('#app-update').isVisible(),true);
   await page.context().setOffline(false);
   await idle.waitFor({state:'visible'});
   assert.equal(await idle.locator('svg path').count(),1);
   assert.deepEqual(errors,[]);
   console.log(`${model} ${width}x${height}: visible idle SVG, trusted check/spinner, offline/reconnect PASS`);
  }finally{await browser.close();}
 }
}finally{server.kill();}
