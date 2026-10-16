let initialized = false;
const clamp = (value) => Math.max(0, Math.min(100, value));
export function syncMasterKnob() {
  const button = document.getElementById("master-knob");
  const input = document.getElementById("master");
  if (!button || !input) return;
  const value = clamp(Number(input.value));
  button.style.setProperty("--angle", `${-135 + value * 2.7}deg`);
  button.setAttribute("aria-valuenow", String(value));
  button.setAttribute("aria-valuetext", `${value}%`);
  button.title = `Master: ${value}%. Drag vertically or use arrow keys. Double-click to reset.`;
}
export function initMasterKnob() {
  if (initialized) return;
  const button = document.getElementById("master-knob");
  const input = document.getElementById("master");
  if (!button || !input) return;
  initialized = true;
  let drag = null;
  const set = (value) => {
    input.value = String(Math.round(clamp(value)));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    syncMasterKnob();
  };
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    button.focus({ preventScroll: true });
    drag = {
      id: event.pointerId,
      y: event.clientY,
      value: Number(input.value),
    };
    button.setPointerCapture(event.pointerId);
  });
  button.addEventListener("pointermove", (event) => {
    if (drag?.id === event.pointerId)
      set(drag.value + ((drag.y - event.clientY) * 100) / 150);
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    button.addEventListener(type, (event) => {
      if (drag?.id === event.pointerId) drag = null;
    });
  }
  button.addEventListener("keydown", (event) => {
    const steps = {
      ArrowUp: 1,
      ArrowRight: 1,
      ArrowDown: -1,
      ArrowLeft: -1,
      PageUp: 10,
      PageDown: -10,
    };
    if (!(event.key in steps) && !["Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    set(
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? 100
          : Number(input.value) + steps[event.key],
    );
  });
  button.addEventListener("dblclick", () => set(50));
  input.addEventListener("input", syncMasterKnob);
  syncMasterKnob();
}
