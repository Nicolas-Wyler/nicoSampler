/** Shared logarithmic zoom momentum for a piano or waveform viewport. */
export function createZoomInertia({ getScale, setScale, min, max }) {
  let frame = 0,
    quietTimer = 0,
    velocity = 0,
    lastTime = 0;
  let lastScale = 1,
    focalPoint,
    active = false,
    wheelActive = false;
  const reduced = () =>
    globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const clamp = (value) => Math.max(min, Math.min(max, value));
  function cancel() {
    cancelAnimationFrame(frame);
    clearTimeout(quietTimer);
    frame = quietTimer = 0;
    velocity = 0;
    active = wheelActive = false;
  }
  function begin() {
    cancel();
    active = true;
    lastTime = performance.now();
    lastScale = getScale();
  }
  function update(scale, focal) {
    if (!active) begin();
    const now = performance.now(),
      next = clamp(scale),
      elapsed = Math.max(8, now - lastTime);
    const instantaneous = (Math.log(next / lastScale) / elapsed) * 1000;
    velocity = Math.max(
      -3.5,
      Math.min(3.5, velocity * 0.4 + instantaneous * 0.6),
    );
    focalPoint = focal;
    lastTime = now;
    lastScale = next;
    setScale(next, focalPoint);
  }
  function release(fromWheel = false) {
    clearTimeout(quietTimer);
    quietTimer = 0;
    active = wheelActive = false;
    if (
      reduced() ||
      Math.abs(velocity) < 0.02 ||
      (!fromWheel && performance.now() - lastTime > 100)
    ) {
      velocity = 0;
      return;
    }
    const start = performance.now();
    let previous = start;
    const animate = (now) => {
      const elapsed = Math.max(1, Math.min(32, now - previous));
      previous = now;
      velocity *= Math.exp(-elapsed / 65);
      const current = getScale(),
        next = clamp(current * Math.exp((velocity * elapsed) / 1000));
      setScale(next, focalPoint);
      if (
        now - start < 220 &&
        Math.abs(velocity) > 0.02 &&
        next !== current &&
        next > min &&
        next < max
      )
        frame = requestAnimationFrame(animate);
      else {
        frame = 0;
        velocity = 0;
      }
    };
    frame = requestAnimationFrame(animate);
  }
  function wheel(scale, focal) {
    if (!wheelActive) {
      begin();
      wheelActive = true;
    }
    clearTimeout(quietTimer);
    update(scale, focal);
    quietTimer = setTimeout(() => release(true), 60);
  }
  return { begin, update, release, cancel, wheel };
}
