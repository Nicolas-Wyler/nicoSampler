const installed = new WeakMap();
const types = [
  "gesturestart",
  "gesturechange",
  "gestureend",
  "touchstart",
  "touchmove",
  "wheel",
  "keydown",
];
/** Cancel browser zoom defaults while leaving events available to the piano/waveform. */
export function isPageZoomGesture(event) {
  if (event.type.startsWith("gesture")) return true;
  if (event.type === "touchstart" || event.type === "touchmove")
    return (event.touches?.length ?? 0) > 1;
  if (event.type === "wheel") return !!(event.ctrlKey || event.metaKey);
  return (
    event.type === "keydown" &&
    !!(event.metaKey || event.ctrlKey) &&
    ["+", "-", "=", "0"].includes(event.key)
  );
}
/** Only actual overflow containers may consume browser scrolling. */
export function isInsideScrollSection(element, styleFor = el => getComputedStyle(el)) {
  for (let el = element; el?.nodeType === 1; el = el.parentElement) {
    if (el.tagName === "BODY" || el.tagName === "HTML") return false;
    const style = styleFor(el);
    if ((/auto|scroll/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1) ||
        (/auto|scroll/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1)) return true;
  }
  return false;
}
export function installPageZoomGuard(target = document) {
  if (installed.has(target)) return installed.get(target);
  const guard = (event) => {
    if (!event.cancelable) return;
    const pageScroll = (event.type === "touchmove" || event.type === "wheel") &&
      event.target?.nodeType === 1 && !isInsideScrollSection(event.target);
    if (isPageZoomGesture(event) || pageScroll) event.preventDefault();
  };
  const options = { capture: true, passive: false };
  for (const type of types) target.addEventListener(type, guard, options);
  const cleanup = () => {
    for (const type of types) target.removeEventListener(type, guard, options);
    installed.delete(target);
  };
  installed.set(target, cleanup);
  return cleanup;
}
