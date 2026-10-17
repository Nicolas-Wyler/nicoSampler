import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
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
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try {
  const page=await browser.newPage({viewport:{width:428,height:926},hasTouch:true,isMobile:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'});
  page.on('dialog',d=>d.accept());
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.pianoQA={on:[],off:[]};const post=MessagePort.prototype.postMessage;MessagePort.prototype.postMessage=function(m,...a){if(m?.type==='on')pianoQA.on.push(m.note);if(m?.type==='off')pianoQA.off.push(m.note);return post.call(this,m,...a);};});
  await page.goto(origin);await page.addStyleTag({content:'#offline-status{display:none!important}'});
  await page.locator('#landing-new').tap();await page.locator('#load-kind').selectOption('example');
  await page.waitForFunction(()=>document.querySelector('#sample-count').textContent==='16');
  if(await page.locator('#enable-audio').isVisible())await page.locator('#enable-audio').tap();
  await page.waitForFunction(()=>document.querySelector('#enable-audio').hidden);
  await page.locator('#input-source').selectOption('None');
  const cdp=await page.context().newCDPSession(page);
  const send=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});
  const snapshot=()=>page.evaluate(()=>({width:document.querySelector('#keyboard').getBoundingClientRect().width,scroll:document.querySelector('#keyboard-scroll').scrollLeft}));
  const keys=await page.evaluate(()=>{const area=document.querySelector('#keyboard-scroll').getBoundingClientRect();return [...document.querySelectorAll('.piano-key:not(.black)')].map(e=>{const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.bottom-12,n:Number(e.dataset.note),left:r.left,right:r.right};}).filter(p=>p.left>area.left+15&&p.right<area.right-15).slice(2,5);});
  assert.equal(keys.length,3);
  const [a,b,c]=keys;
  await page.evaluate(()=>{pianoQA.on=[];pianoQA.off=[];});
  await send('touchStart',[{id:1,x:a.x,y:a.y}]);
  await send('touchStart',[{id:1,x:a.x,y:a.y},{id:2,x:c.x,y:c.y}]);
  await page.waitForFunction(()=>pianoQA.on.length>=2);
  assert.equal(await page.evaluate(()=>pianoQA.off.length),0,'second finger preserves first held note');
  await send('touchEnd',[]);await page.waitForTimeout(60);
  await page.evaluate(()=>{pianoQA.on=[];pianoQA.off=[];});
  const before=await snapshot();
  await send('touchStart',[{id:3,x:a.x,y:a.y}]);
  await send('touchMove',[{id:3,x:b.x,y:b.y}]);
  await send('touchEnd',[]);await page.waitForTimeout(60);
  assert.ok(await page.evaluate(([x,y])=>pianoQA.on.includes(x)&&pianoQA.on.includes(y)&&pianoQA.off.includes(x),[a.n,b.n]),'glissando releases old and triggers next note');
  await send('touchStart',[{id:4,x:a.x,y:a.y},{id:5,x:c.x,y:c.y}]);
  await send('touchMove',[{id:4,x:a.x-30,y:a.y},{id:5,x:c.x+30,y:c.y}]);
  await send('touchEnd',[]);await page.waitForTimeout(150);
  const playAfter=await snapshot();assert.ok(Math.abs(playAfter.width-before.width)<1&&Math.abs(playAfter.scroll-before.scroll)<1,'Play locks pan and zoom');
  await page.locator('#keyboard-mode').tap();assert.equal(await page.locator('#keyboard-mode').textContent(),'Move');
  await page.evaluate(()=>{pianoQA.on=[];pianoQA.off=[];});
  const area=await page.locator('#keyboard-scroll').boundingBox(),y=area.y+area.height-20,x=area.x+area.width/2;
  const panBefore=await snapshot();
  await send('touchStart',[{id:6,x,y}]);
  for(let n=1;n<=6;n++){await send('touchMove',[{id:6,x:x-15*n,y}]);await page.waitForTimeout(20);}
  await send('touchEnd',[]);await page.waitForTimeout(300);
  assert.ok(Math.abs((await snapshot()).scroll-panBefore.scroll)>10,'Move native one-finger pan scrolls '+JSON.stringify({before:panBefore,after:await snapshot(),styles:await page.locator('#keyboard-scroll').evaluate(e=>({overflow:getComputedStyle(e).overflowX,touch:getComputedStyle(e).touchAction,locked:e.dataset.navigationLocked,mode:document.querySelector('.keyboard-panel').dataset.touchMode}))}));
  const zoomBefore=await snapshot();
  await send('touchStart',[{id:7,x:x-35,y},{id:8,x:x+35,y}]);
  for(let n=1;n<=5;n++){await send('touchMove',[{id:7,x:x-35-8*n,y},{id:8,x:x+35+8*n,y}]);await page.waitForTimeout(20);}
  await send('touchEnd',[]);await page.waitForTimeout(300);
  assert.ok((await snapshot()).width>zoomBefore.width*1.1,'Move pinch changes zoom');
  assert.equal(await page.evaluate(()=>pianoQA.on.length),0,'Move pan and pinch never start notes');
  const grips=page.locator('.piano-resize-handle');assert.equal(await grips.count(),2);
  for(let i=0;i<2;i++){
   const r=await grips.nth(i).boundingBox(),h=await page.locator('#keyboard').evaluate(e=>e.getBoundingClientRect().height);
   await send('touchStart',[{id:10+i,x:r.x+r.width/2,y:r.y+r.height/2}]);
   await send('touchMove',[{id:10+i,x:r.x+r.width/2,y:r.y+r.height/2-25}]);
   await send('touchEnd',[]);await page.waitForTimeout(60);
   assert.ok(await page.locator('#keyboard').evaluate(e=>e.getBoundingClientRect().height)>h+20,'both height grips adjust');
  }
  const folded=()=>page.locator('.keyboard-panel').evaluate(e=>e.classList.contains('is-folded'));
  let gr=await grips.first().boundingBox(),gx=gr.x+gr.width/2,gy=gr.y+gr.height/2;
  await send('touchStart',[{id:21,x:gx,y:gy}]);
  await send('touchMove',[{id:21,x:gx,y:gy+150}]);
  assert.equal(await folded(),true,'drag below minimum folds');
  await send('touchMove',[{id:21,x:gx,y:gy-20}]);await page.waitForTimeout(80);
  assert.equal(await folded(),false,'same gesture can reopen');
  await send('touchEnd',[]);
  gr=await grips.last().boundingBox();gx=gr.x+gr.width/2;gy=gr.y+gr.height/2;
  await send('touchStart',[{id:22,x:gx,y:gy}]);
  await send('touchMove',[{id:22,x:gx,y:gy+200}]);await send('touchEnd',[]);
  assert.equal(await folded(),true);
  assert.equal(await grips.first().isVisible(),true);
  gr=await grips.first().boundingBox();gx=gr.x+gr.width/2;gy=gr.y+gr.height/2;
  await send('touchStart',[{id:23,x:gx,y:gy}]);
  await send('touchMove',[{id:23,x:gx,y:gy-35}]);await send('touchEnd',[]);
  assert.equal(await folded(),false,'later gesture reopens folded piano');
  gr=await grips.last().boundingBox();gx=gr.x+gr.width/2;gy=gr.y+gr.height/2;
  await send('touchStart',[{id:24,x:gx,y:gy}]);
  await send('touchMove',[{id:24,x:gx,y:Math.max(1,gy-700)}]);await send('touchEnd',[]);
  assert.ok(await page.locator('#keyboard').evaluate(e=>e.getBoundingClientRect().height)<=926/2+1,'height limited to half viewport');
  await grips.first().press('Home');assert.ok(Math.abs(await page.locator('#keyboard').evaluate(e=>e.getBoundingClientRect().height)-90)<1);
  await grips.first().press('ArrowUp');await grips.first().press('ArrowUp');
  await page.waitForTimeout(350);await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('Saved'));
  await page.reload();await page.waitForFunction(()=>document.querySelector('#sample-count').textContent==='16');
  assert.equal(await page.locator('#keyboard-mode').textContent(),'Move');
  assert.ok(Math.abs(await page.locator('#keyboard').evaluate(e=>e.getBoundingClientRect().height)-110)<1,'height persists');
  assert.deepEqual(errors,[]);
  console.log('Trusted Chromium piano: Play chords/gliss lockednavigation; Move nativepan/pinch silent; two resizegrips/min/recovery PASS');
 } finally {await browser.close();}
} finally {server.kill();}
