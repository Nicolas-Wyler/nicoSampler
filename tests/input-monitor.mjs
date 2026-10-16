import assert from 'node:assert/strict';
import {InputMonitor,reportedLatency} from '../src/input-monitor.js';
function button(){const classes=new Set(),label={textContent:''};return{disabled:false,attrs:{},classList:{toggle(name,on){on?classes.add(name):classes.delete(name)}},setAttribute(k,v){this.attrs[k]=v},querySelector(){return label},addEventListener(){},removeEventListener(){},label,classes}}
assert.equal(reportedLatency({}),null);assert.equal(reportedLatency({baseLatency:.01,outputLatency:.02}),.03);assert.equal(reportedLatency({baseLatency:NaN,outputLatency:undefined}),null);
let now=0,latency=.01,enabled=0,disabled=0,notifications=0,activeDuringDisconnect;
const control=button(),monitor=new InputMonitor({button:control,getLatency:()=>latency,now:()=>now,onEnable:async()=>{enabled++;return true},onDisable:async(reason)=>{disabled++;activeDuringDisconnect=monitor.active;assert.equal(reason,'latency')},onAutoDisable:details=>{notifications++;assert(details.increase>.005)}});
try{
 assert.equal(control.label.textContent,'Click to activate');assert.equal(monitor.active,false);await monitor.activate();assert.equal(enabled,1);assert.equal(control.label.textContent,'Deactivate?');
 latency=.03;now=1500;monitor.checkLatency();assert.equal(monitor.active,true);
 for(const time of[2000,2500]){now=time;monitor.checkLatency();assert.equal(disabled,0)}now=3000;monitor.checkLatency();await new Promise(r=>setTimeout(r,0));assert.equal(disabled,1);assert.equal(notifications,1);assert.equal(activeDuringDisconnect,true);assert.equal(monitor.active,false);
}finally{monitor.dispose()}
let unknown=null;now=0;const missing=new InputMonitor({button:button(),getLatency:()=>unknown,now:()=>now});
try{await missing.activate();for(let i=0;i<20;i++){now+=500;missing.checkLatency()}assert(missing.active);unknown=.1;now+=500;missing.checkLatency();unknown=.14;for(let i=0;i<5;i++){now+=500;missing.checkLatency()}assert(missing.active);await missing.deactivate();}finally{missing.dispose()}
const rejected=new InputMonitor({button:button(),onEnable:async()=>false});assert.equal(await rejected.activate(),false);assert.equal(rejected.active,false);rejected.dispose();
let resolveEnable,stopped=0;const concurrent=new InputMonitor({button:button(),onEnable:()=>new Promise(resolve=>resolveEnable=resolve),onDisable:async()=>{stopped++}});
const activating=concurrent.activate(),closing=concurrent.deactivate();resolveEnable(true);await activating;await closing;assert.equal(stopped,1);assert.equal(concurrent.active,false);concurrent.dispose();
console.log('Input monitor: default off, activation/cancellation, safe disconnect order, settling, sustained latency rise,50%threshold and missing measurements passed.');
