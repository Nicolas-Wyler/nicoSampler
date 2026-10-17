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
  for (const [model, width, height] of [["iPhone 12 Pro Max",428,926],["iPhone 12 Pro Max",926,428],["iPhone 12",390,844],["iPhone 12",844,390]]) {
    const browser=await webkit.launch({headless:true});
    try {
      const page=await browser.newPage({...devices[model],viewport:{width,height}});
      const errors=[];page.on("pageerror",e=>errors.push(e.message));
      await page.addInitScript(()=>{
        window.phoneAudioQA={contexts:[],notes:[],peaks:[]};
        const C=window.AudioContext||window.webkitAudioContext;
        const resume=C.prototype.resume;
        C.prototype.resume=function(){if(!phoneAudioQA.contexts.includes(this))phoneAudioQA.contexts.push(this);return resume.call(this);};
        const post=MessagePort.prototype.postMessage;
        MessagePort.prototype.postMessage=function(m,...args){if(m?.type==='on')phoneAudioQA.notes.push(m.note);return post.call(this,m,...args);};
        const connect=AudioNode.prototype.connect;
        AudioNode.prototype.connect=function(...args){const result=connect.apply(this,args);if(args[0]===this.context.destination){const a=this.context.createAnalyser();a.fftSize=512;connect.call(this,a);phoneAudioQA.peaks.push(a);}return result;};
        phoneAudioQA.peak=()=>Math.max(0,...phoneAudioQA.peaks.map(a=>{const d=new Float32Array(a.fftSize);a.getFloatTimeDomainData(d);return Math.max(...d.map(Math.abs));}));
      });
      await page.goto(origin);
      await page.addStyleTag({content:'#offline-status{display:none!important}'});
      await page.locator('#landing-new').tap();
      await page.locator('#load-kind').selectOption('example');
      await page.waitForFunction(()=>document.querySelector('#sample-count').textContent==='16');
      if(await page.locator('#enable-audio').isVisible())await page.locator('#enable-audio').tap();
      await page.waitForFunction(()=>phoneAudioQA.contexts.some(c=>c.state==='running'));
      await page.locator('#input-source').selectOption('None',{force:true});
      const key=page.locator('[data-note="60"]');
      await key.scrollIntoViewIfNeeded();
      const r=await key.boundingBox();
      assert.ok(r&&r.y+r.height<=height,'piano key fits phone');
      await page.touchscreen.tap(r.x+r.width/2,r.y+r.height-8);
      await page.waitForFunction(()=>phoneAudioQA.notes.includes(60));
      await page.waitForFunction(()=>phoneAudioQA.peak()>0.00001);
      const lights=await page.evaluate(async()=>{
        const input=document.querySelector('#header-input-meter').parentElement,
          output=document.querySelector('#output-meter').parentElement;
        const a=input.getBoundingClientRect(),b=output.getBoundingClientRect();
        const {updateMeters}=await import('/src/meters.js');
        const states=[.1,.3,.7].map(peak=>{updateMeters(peak,0);return{
          color:output.style.getPropertyValue('--phone-meter-color'),
          strength:Number(output.style.getPropertyValue('--phone-meter-strength'))};});
        return{widths:[a.width,b.width],heights:[a.height,b.height],sameY:Math.abs(a.y-b.y)<1,
          horizontal:b.left>a.right,gray:getComputedStyle(input).filter,states};
      });
      assert.deepEqual(lights.widths,[18,18]);assert.deepEqual(lights.heights,[18,18]);
      assert.ok(lights.sameY&&lights.horizontal);assert.ok(lights.gray.includes('grayscale(1)'));
      assert.deepEqual(lights.states.map(s=>s.color),['#a8d970','#edcf5f','#f2695d']);
      assert.ok(lights.states[0].strength<lights.states[1].strength&&lights.states[1].strength<lights.states[2].strength);
      const visibleWhites=()=>page.evaluate(()=>document.querySelector('#keyboard-scroll').clientWidth/
        document.querySelector('.piano-key:not(.black)').getBoundingClientRect().width);
      assert.ok(Math.abs(await visibleWhites()-14)<0.1,'iPhone initially shows fourteen white keys');
      await page.locator('#keyboard-mode').tap();
      assert.equal(await page.locator('#keyboard-mode').textContent(),'Move');
      await page.evaluate(()=>{
        const area=document.querySelector('#keyboard-scroll'),r=area.getBoundingClientRect();
        const send=(type,id,x)=>area.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:id,pointerType:'touch',clientX:r.left+x,clientY:r.top+20}));
        send('pointerdown',71,30);send('pointerdown',72,180);
        send('pointermove',72,40);send('pointerup',71,30);send('pointerup',72,40);
      });
      await page.waitForTimeout(400);
      assert.ok(await visibleWhites()<=14.1,'pinch cannot zoom below iPhone floor');
      await page.waitForTimeout(300);
      await page.waitForFunction(()=>document.querySelector('#save-status').textContent.includes('Saved'));
      await page.evaluate(async()=>{
        const {loadRecovery,saveRecovery}=await import('/src/storage.js');
        const saved=await loadRecovery();
        saved.takes=[0,1].map(i=>({id:'phone-qa-take-'+i,name:'Phone take '+i,
          audio:[new Float32Array(4410),new Float32Array(4410)],recording_format:{sample_rate:44100,bit_depth:16}}));
        saved.viewSettings={...(saved.viewSettings||{}),keyboard:{zoom:1,position:.5,collapsed:false,touchMode:'move',height:110}};
        await saveRecovery(saved);
      });
      await page.reload();
      await page.waitForFunction(()=>document.querySelector('#sample-count').textContent==='16');
      await page.waitForTimeout(100);
      assert.ok(Math.abs(await visibleWhites()-14)<0.1,'restored desktop zoom clamps to iPhone floor');
      assert.equal(await page.locator('#keyboard-mode').textContent(),'Move');
      assert.ok(Math.abs(await page.locator('#keyboard').evaluate(e=>e.getBoundingClientRect().height)-110)<1,'piano height recovers');
      await page.locator('#keyboard-fold').tap();
      assert.equal(await page.locator('#keyboard-mode').isVisible(),false);
      assert.equal(await page.locator('.piano-resize-handle').first().isVisible(),true,'folded piano keeps resize grips available');
      await page.locator('#keyboard-fold').tap();
      assert.equal(await page.locator('#keyboard-mode').isVisible(),true);
      assert.equal(await page.locator('.octave-controls').isVisible(),false,'phone has no keyboard hints before typing');
      await page.locator('#input-source').selectOption('PC Keyboard');
      await page.locator('#input-source').blur();
      assert.equal(await page.locator('.octave-controls').isVisible(),false);
      await page.keyboard.press('a');
      assert.equal(await page.locator('.octave-controls').isVisible(),true,'trusted typing reveals octave controls');
      await page.locator('#input-source').selectOption('None');
      assert.equal(await page.locator('.octave-controls').isVisible(),false,'None hides keyboard hints');
      assert.equal(await page.locator('.sample-name').first().evaluate(e=>getComputedStyle(e).getPropertyValue('-webkit-user-select') || getComputedStyle(e).getPropertyValue('user-select')),'none');
      await page.locator('.sample-name').first().tap();
      assert.equal(await page.locator('input.inline-name').evaluate(e=>getComputedStyle(e).getPropertyValue('-webkit-user-select') || getComputedStyle(e).getPropertyValue('user-select')),'text');
      await page.locator('input.inline-name').press('Escape');
      await page.locator('#mobile-select').tap();
      assert.equal(await page.locator('#mobile-select').textContent(),'Done');
      const tableRows=page.locator('#sample-table tr[data-id]');
      await tableRows.first().locator('.sample-name').tap();
      assert.equal(await page.locator('#sample-table tr.selected').count(),0);
      assert.equal(await page.locator('#mobile-select').textContent(),'Done','zero selection keeps explicit mode');
      await tableRows.first().locator('.sample-name').tap();
      assert.equal(await page.locator('#sample-table tr.selected').count(),1);
      assert.equal(await page.locator('#mobile-select').textContent(),'Done','one selection keeps explicit mode');
      await tableRows.nth(1).locator('.sample-name').tap();
      assert.equal(await page.locator('#sample-table tr.selected').count(),2);
      for(const id of ['fx-open','spread-open','record-open','trim-open'])assert.equal(await page.locator('#'+id).isVisible(),false);
      await page.locator('#mobile-copy').tap();
      await page.locator('#duplicate-sample').tap();
      await page.waitForFunction(()=>document.querySelector('#sample-count').textContent==='18');
      assert.equal(await page.locator('#sample-table tr.selected').count(),2);
      await page.locator('#mobile-paste').tap();
      await page.waitForFunction(()=>document.querySelector('#sample-count').textContent==='20');
      await page.locator('#mobile-delete').tap();
      assert.equal(await page.locator('#mobile-delete').textContent(),'Sure?');
      assert.equal(await page.locator('#sample-count').textContent(),'20');
      await page.locator('#mobile-delete').tap();
      await page.waitForFunction(()=>document.querySelector('#sample-count').textContent==='18');
      await page.locator('#mobile-select').tap();
      assert.equal(await page.locator('#mobile-select').textContent(),'Select');
      assert.equal(await page.locator('#mobile-copy').isVisible(),false);
      await page.locator('#record-open').tap();
      const takeRows=page.locator('#recorded-takes-body tr');
      await page.waitForFunction(()=>document.querySelectorAll('#recorded-takes-body tr').length===2);
      await takeRows.first().locator('td').nth(2).tap();
      await page.locator('#takes-select').tap();
      assert.equal(await page.locator('#takes-select').textContent(),'Done');
      await takeRows.first().locator('td').nth(2).tap();
      assert.equal(await page.locator('#recorded-takes-body tr.selected').count(),0);
      assert.equal(await page.locator('#takes-select').textContent(),'Done');
      await takeRows.last().locator('td').nth(2).tap();
      assert.equal(await page.locator('#recorded-takes-body tr.selected').count(),1);
      assert.equal(await page.locator('#takes-select').textContent(),'Done');
      await takeRows.first().locator('td').nth(2).tap();
      assert.equal(await page.locator('#recorded-takes-body tr.selected').count(),2);
      assert.equal(await page.locator('#record-dialog #mobile-copy,#record-dialog #mobile-paste').count(),0);
      await page.locator('#takes-select').tap();
      assert.equal(await page.locator('#takes-select').textContent(),'Select');
      await page.locator('#record-close').tap();
      assert.deepEqual(errors,[]);
      console.log(`${model}: trusted audio activation + touchscreen piano DSP/output PASS (${width}x${height})`);
    } finally {await browser.close();}
  }
} finally {server.kill();}
