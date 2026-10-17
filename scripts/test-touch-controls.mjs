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
    const page=await browser.newPage({viewport:{width:428,height:926},hasTouch:true,isMobile:true,
      userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      Object.defineProperty(Object.getPrototypeOf(navigator.mediaDevices),'getUserMedia',{
        configurable:true,value:async()=>{throw new DOMException('QA capture denied','NotAllowedError');}});
    });
    await page.goto(origin);await page.addStyleTag({content:'#offline-status{display:none!important}'});
    await page.locator('#landing-new').tap();await page.locator('#load-kind').selectOption('example');
    await page.waitForFunction(()=>document.querySelector('#sample-count').textContent==='16');
    const cdp=await page.context().newCDPSession(page);
    async function gesture(locator,{hold=0,dy=0,dx=0}={}){
      await locator.scrollIntoViewIfNeeded();const r=await locator.boundingBox(),x=r.x+r.width/2,y=r.y+r.height/2;
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
      if(hold)await page.waitForTimeout(hold);
      if(dy||dx){for(let n=1;n<=4;n++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*n/4,y:y+dy*n/4}]});await page.waitForTimeout(15);}}
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await page.waitForTimeout(100);
    }
    const level=page.locator('#sample-table tr').first().locator('.level-cell .knob');
    const levelValue=()=>level.getAttribute('aria-valuenow');
    const original=await levelValue();
    await gesture(level,{dy:65});
    assert.equal(await levelValue(),original,'quick swipe starting on knob scrolls without changing Level');
    assert.equal(await page.locator('#row-value-dialog').isVisible(),false);
    await page.locator('#table-wrap').evaluate(e=>e.scrollTop=0);
    await gesture(level);
    assert.equal(await page.locator('#row-value-dialog').isVisible(),true,'tap opens value editor');
    await page.locator('[data-close="row-value-dialog"]').tap();
    await gesture(level,{hold:420,dy:-35});
    assert.notEqual(await levelValue(),original,'hold then swipe adjusts Level');
    assert.equal(await page.locator('#sample-table').evaluate(e=>e.classList.contains('selection-mode')),false);
    assert.equal(await page.locator('#row-value-dialog').isVisible(),false);
    const pitch=page.locator('#sample-table tr').first().locator('.pitch-drag');
    const before=await pitch.textContent();
    await gesture(pitch,{dy:50});
    assert.equal(await pitch.textContent(),before,'quick pitch swipe preserves parameter');
    await page.locator('#table-wrap').evaluate(e=>e.scrollTop=0);
    await gesture(pitch);
    assert.equal(await page.locator('#pitch-dialog').isVisible(),true,'tap pitch opens editor');
    await page.locator('[data-close="pitch-dialog"]').tap();
    await gesture(pitch,{hold:420,dy:-25});
    assert.notEqual(await pitch.textContent(),before,'hold pitch swipe adjusts pitch');
    assert.equal(await page.locator('#sample-table').evaluate(e=>e.classList.contains('selection-mode')),false);
    await page.locator('#table-wrap').evaluate(e=>{e.scrollTop=0;e.scrollLeft=0;});
    await page.locator('#mobile-select').tap();
    await page.locator('#sample-table tr').nth(1).locator('.sample-name').tap();
    assert.equal(await page.locator('#sample-table tr.selected').count(),2);
    const beforeOrder=await page.locator('#sample-table tr').evaluateAll(rows=>rows.map(r=>r.dataset.id));
    const handle=await page.locator('#sample-table tr').first().locator('.row-handle').boundingBox();
    const target=await page.locator('#sample-table tr').nth(4).boundingBox();
    const x=handle.x+handle.width/2,y=handle.y+handle.height/2;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let n=1;n<=8;n++){
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+(target.y+target.height-4-y)*n/8}]});
      await page.waitForTimeout(30);
    }
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForTimeout(150);
    const afterOrder=await page.locator('#sample-table tr').evaluateAll(rows=>rows.map(r=>r.dataset.id));
    assert.ok(afterOrder.indexOf(beforeOrder[0])>=2,'trusted touch handle moves selected group');
    assert.equal(afterOrder.indexOf(beforeOrder[1]),afterOrder.indexOf(beforeOrder[0])+1,'group order stays stable');
    assert.equal(await page.locator('#sample-table tr.selected').count(),2);
    await page.locator('#mobile-select').tap();
    await page.locator('#record-open').tap();
    const threshold=page.locator('#threshold-marker');
    const initialThreshold=await threshold.getAttribute('aria-valuenow');
    await gesture(page.locator('.record-meter'),{dy:45});
    assert.equal(await threshold.getAttribute('aria-valuenow'),initialThreshold,'vertical meter swipe preserves threshold');
    await gesture(page.locator('.record-meter'),{dx:35});
    assert.notEqual(await threshold.getAttribute('aria-valuenow'),initialThreshold,'horizontal meter swipe adjusts threshold');
    await page.locator('#record-close').tap();
    console.log('Threshold trusted vertical/horizontal touch guard PASS');
    const master=page.locator('#master-knob');
    await gesture(master);
    assert.equal(await page.locator('#sampler-settings').isVisible(),true,'Master tap opens settings');
    await page.locator('#sampler-settings-close').tap();
    const masterBefore=await page.locator('#master').inputValue();
    await gesture(master,{hold:420,dy:-25});
    assert.notEqual(await page.locator('#master').inputValue(),masterBefore,'held Master adjusts');
    assert.equal(await page.locator('#sampler-settings').isVisible(),false);
    assert.deepEqual(errors,[]);
    console.log('Chromium trusted touch: quick swipes preserve Level/Pitch, taps open editors, hold-swipes adjust without selection PASS');
  } finally {await browser.close();}
} finally {server.kill();}
