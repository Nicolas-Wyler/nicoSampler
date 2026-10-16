import test from 'node:test';
import assert from 'node:assert/strict';
import { RowSelection } from '../src/selection.js';
const fixture = () => ({id:'p', selected:'b', samples:['a','b','c','d'].map(id=>({id}))});
test('touch selection can deselect the final row without reconciliation restoring it',()=>{
  const p=fixture(), selection=new RowSelection();selection.reconcile(p);selection.enter('b');selection.toggle('b');
  assert.equal(selection.mode,true);assert.deepEqual([...selection.reconcile(p)],[]);
  selection.toggle('c');assert.deepEqual([...selection.reconcile(p)],['c']);
});
test('modifier ranges and toggles remain available during touch selection',()=>{
  const p=fixture(), selection=new RowSelection(), order=p.samples.map(s=>s.id);selection.reconcile(p);selection.enter('b');
  selection.click('d',{shiftKey:true},order);assert.deepEqual([...selection.ids],['b','c','d']);
  selection.click('c',{metaKey:true},order);assert.deepEqual([...selection.ids],['b','d']);assert.equal(selection.mode,true);
});
test('explicit single selection or a program change exits touch selection',()=>{
  const p=fixture(), selection=new RowSelection();selection.reconcile(p);selection.enter('b');selection.toggle('c');
  selection.select('c');assert.equal(selection.mode,false);assert.deepEqual([...selection.ids],['c']);
  selection.enter('a');selection.reconcile({...p,id:'other'});assert.equal(selection.mode,false);assert.deepEqual([...selection.ids],['b']);
});
