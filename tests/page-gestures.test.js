import test from "node:test";
import assert from "node:assert/strict";
import {
  isPageZoomGesture,
  installPageZoomGuard,
} from "../src/page-gestures.js";
const event = (type, fields = {}) =>
  Object.assign(new Event(type, { cancelable: true }), fields);
test("browser multitouch zoom is canceled without blocking the sampler pinch listener", () => {
  const target = new EventTarget();
  const remove = installPageZoomGuard(target);
  let internalPinch = 0;
  target.addEventListener("touchmove", (e) => {
    if (e.touches.length === 2)
      internalPinch += Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
  });
  const pinch = event("touchmove", {
    touches: [
      { clientX: 10, clientY: 10 },
      { clientX: 50, clientY: 10 },
    ],
  });
  target.dispatchEvent(pinch);
  assert.equal(pinch.defaultPrevented, true);
  assert.equal(internalPinch, 40);
  const finger = event("touchmove", {
    touches: [{ clientX: 10, clientY: 10 }],
  });
  target.dispatchEvent(finger);
  assert.equal(finger.defaultPrevented, false);
  const pointer = event("pointermove", { pointerType: "touch" });
  target.dispatchEvent(pointer);
  assert.equal(pointer.defaultPrevented, false);
  remove();
});
test("single taps, double-tap click sequences and ordinary shortcuts retain native event delivery", () => {
  const target = new EventTarget();
  const remove = installPageZoomGuard(target);
  let clicks = 0;
  target.addEventListener("click", () => clicks++);
  for (let i = 0; i < 2; i++) {
    const start = event("touchstart", { touches: [{}] }),
      end = event("touchend", { touches: [] }),
      click = event("click");
    target.dispatchEvent(start);
    target.dispatchEvent(end);
    target.dispatchEvent(click);
    assert.equal(start.defaultPrevented, false);
    assert.equal(end.defaultPrevented, false);
  }
  assert.equal(clicks, 2);
  const save = event("keydown", { key: "s", metaKey: true });
  target.dispatchEvent(save);
  assert.equal(save.defaultPrevented, false);
  remove();
});
test("Safari gesture events and browser zoom shortcuts are guarded; installation cleans up safely", () => {
  const target = new EventTarget(),
    remove = installPageZoomGuard(target);
  assert.equal(installPageZoomGuard(target), remove);
  for (const e of [
    event("gesturestart"),
    event("gesturechange"),
    event("gestureend"),
    event("touchstart", { touches: [{}, {}] }),
    event("wheel", { ctrlKey: true }),
    event("keydown", { key: "+", metaKey: true }),
    event("keydown", { key: "0", ctrlKey: true }),
  ]) {
    target.dispatchEvent(e);
    assert.equal(e.defaultPrevented, true, e.type);
  }
  assert.equal(isPageZoomGesture(event("wheel", { deltaY: 5 })), false);
  remove();
  const after = event("gesturechange");
  target.dispatchEvent(after);
  assert.equal(after.defaultPrevented, false);
});
