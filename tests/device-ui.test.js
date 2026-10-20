import test from 'node:test';
import assert from 'node:assert/strict';
import {isSmartphone} from '../src/device-ui.js';
test('Phone screen with touch selects smartphone mode in either orientation',()=>{
 for(const [screenWidth,screenHeight] of [[428,926],[926,428],[360,800],[412,915]])assert(isSmartphone({screenWidth,screenHeight,touchPoints:5}));
});
test('Tablets, touch laptops and non-touch screens keep desktop layout',()=>{
 for(const [screenWidth,screenHeight,touchPoints] of [[768,1024,5],[1024,768,5],[1440,900,10],[428,926,0]])assert.equal(isSmartphone({screenWidth,screenHeight,touchPoints}),false);
});
