import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioController } from '../src/audio.js';

test('a second activation unlocks a first gesture whose resume is still pending', async () => {
  const controller = Object.create(AudioController.prototype);
  const original = globalThis.AudioContext;
  let unlock, resumes = 0, started = false;
  const blocked = new Promise(resolve => { unlock = resolve; });
  class GestureContext {
    resume() {
      resumes++;
      if (resumes === 1) return blocked;
      unlock();
      return Promise.resolve();
    }
  }
  globalThis.AudioContext = GestureContext;
  controller.start = async ctx => { await ctx.resume(); started = true; };
  try {
    const first = controller.enable();
    assert.equal(resumes, 1);
    const second = controller.enable();
    assert.equal(resumes, 2, 'second gesture must resume before awaiting the first startup');
    await Promise.all([first, second]);
    assert.equal(started, true);
  } finally {
    unlock();
    globalThis.AudioContext = original;
  }
});

test('an already initialized context resumes inside the activation call', async () => {
  const controller = Object.create(AudioController.prototype);
  let resumes = 0;
  controller.starting = null;
  controller.context = { resume() { resumes++; return Promise.resolve(); } };
  const enabled = controller.enable();
  assert.equal(resumes, 1);
  await enabled;
});
