import { syncControls } from "./controls.js";
const LOW = 20,
  HIGH = 21950,
  STEPS = 1000;
const bound = (v, min, max) => Math.max(min, Math.min(max, v));
export function cutoffValue(position, mode = "LPF") {
  const p = bound(Number(position), 0, STEPS);
  if ((mode === "HPF" && p === 0) || (mode !== "HPF" && p === STEPS))
    return null;
  return LOW * (HIGH / LOW) ** (p / STEPS);
}
export function cutoffPosition(value, mode = "LPF") {
  if (value == null) return mode === "HPF" ? 0 : STEPS;
  return bound(
    Math.round(
      (Math.log(Math.max(LOW, Number(value)) / LOW) / Math.log(HIGH / LOW)) *
        STEPS,
    ),
    mode === "HPF" ? 1 : 0,
    mode === "HPF" ? STEPS : STEPS - 1,
  );
}
function plotPadding(canvas) {
  return Math.max(
    18,
    (18 * canvas.width) / (canvas.clientWidth || canvas.width),
  );
}
function handlePosition(canvas, s) {
  const pad = plotPadding(canvas),
    ypad = Math.max(
      18,
      (18 * canvas.height) / (canvas.clientHeight || canvas.height),
    );
  return {
    x:
      pad +
      (cutoffPosition(s.lpf_cutoff, s.filter_mode) / STEPS) *
        (canvas.width - pad * 2),
    y:
      canvas.height -
      ypad -
      (bound(s.lpf_resonance ?? 0, 0, 10) / 10) * (canvas.height - ypad * 2),
  };
}
export function drawFilter(canvas, s) {
  if (!canvas || !s) return;
  const ctx = canvas.getContext("2d"),
    w = canvas.width,
    h = canvas.height,
    pad = plotPadding(canvas);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "#334a35";
  ctx.lineWidth = 1;
  for (const frequency of [20, 100, 1000, 10000, 21950]) {
    const x =
      pad + (Math.log(frequency / LOW) / Math.log(HIGH / LOW)) * (w - pad * 2);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 25; y < h; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "#b7e991";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x < w; x++) {
    const freq = LOW * (HIGH / LOW) ** bound((x - pad) / (w - pad * 2), 0, 1),
      ratio = freq / (s.lpf_cutoff ?? HIGH);
    let db = 0;
    if (s.lpf_cutoff != null) {
      const q = 0.707 + (s.lpf_resonance ?? 0) * 0.9,
        den = Math.sqrt((1 - ratio * ratio) ** 2 + (ratio / q) ** 2),
        amp =
          (s.filter_mode === "HPF" ? ratio * ratio : 1) / Math.max(1e-10, den);
      db = 20 * Math.log10(Math.max(1e-8, amp));
    }
    const y = bound(45 - db * 2.4, 3, h - 4);
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  const handle = handlePosition(canvas, s);
  ctx.setLineDash([4, 5]);
  ctx.strokeStyle = "#c1cfa877";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(handle.x, 0);
  ctx.lineTo(handle.x, h);
  ctx.moveTo(0, handle.y);
  ctx.lineTo(w, handle.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.ellipse(
    handle.x,
    handle.y,
    (16 * canvas.width) / (canvas.clientWidth || canvas.width),
    (16 * canvas.height) / (canvas.clientHeight || canvas.height),
    0,
    0,
    Math.PI * 2,
  );
  ctx.fillStyle = "#b7e991";
  ctx.fill();
  ctx.strokeStyle = "#15271b";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#c1cfa8";
  ctx.font = "13px Helvetica, Arial, sans-serif";
  ctx.fillText("20 Hz", 5, h - 5);
  ctx.fillText("22 kHz", w - 56, h - 5);
}
let config = null,
  canvas = null,
  resizeObserver = null;
export function syncFilterUI() {
  const s = config?.getSample();
  if (!s) return;
  const cutoff = document.getElementById("cutoff"),
    resonance = document.getElementById("resonance");
  const label =
    s.lpf_cutoff == null ? (s.filter_mode === "HPF" ? "0 Hz · off" : "∞ · off") : `${Math.round(s.lpf_cutoff)} Hz`;
  if (cutoff) {
    cutoff.value = String(cutoffPosition(s.lpf_cutoff, s.filter_mode));
    cutoff.dataset.displayValue = label;
    cutoff.nextElementSibling
      ?.querySelector(".effect-value")
      ?.replaceChildren(document.createTextNode(label));
    cutoff.nextElementSibling?.setAttribute("aria-valuetext", label);
  }
  if (resonance) {
    resonance.value = String(s.lpf_resonance ?? 0);
    const value = Number(s.lpf_resonance ?? 0).toFixed(1);
    resonance.dataset.displayValue = value;
    resonance.nextElementSibling
      ?.querySelector(".effect-value")
      ?.replaceChildren(document.createTextNode(value));
  }
  syncControls();
  drawFilter(canvas, s);
}
export function initFilterUI(options) {
  config = options;
  canvas = document.getElementById("filter-canvas");
  if (!canvas) return;
  canvas.setAttribute(
    "aria-label",
    "Filter response: drag horizontally for cutoff and vertically for resonance",
  );
  canvas.tabIndex = 0;
  let pointer = null;
  function update(e, final = false) {
    const s = config.getSample();
    if (!s) return;
    const r = canvas.getBoundingClientRect(),
      pad = (plotPadding(canvas) / canvas.width) * r.width,
      ypad =
        (Math.max(
          18,
          (18 * canvas.height) / (canvas.clientHeight || canvas.height),
        ) /
          canvas.height) *
        r.height;
    const position = Math.round(
        bound((e.clientX - r.left - pad) / (r.width - 2 * pad), 0, 1) * STEPS,
      ),
      resonance =
        Math.round(
          bound((r.bottom - ypad - e.clientY) / (r.height - 2 * ypad), 0, 1) *
            100,
        ) / 10;
    config.onChange(
      { cutoff: cutoffValue(position, s.filter_mode), resonance },
      final,
    );
    syncFilterUI();
  }
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    canvas.focus({ preventScroll: true });
    pointer = e.pointerId;
    canvas.setPointerCapture(pointer);
    update(e);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerId === pointer) update(e);
  });
  const finish = (e) => {
    if (e.pointerId !== pointer) return;
    update(e, true);
    pointer = null;
  };
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", () => {
    pointer = null;
  });
  canvas.addEventListener("keydown", (e) => {
    if (
      ![
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
      ].includes(e.key)
    )
      return;
    e.preventDefault();
    e.stopPropagation();
    const s = config.getSample();
    if (!s) return;
    let position = cutoffPosition(s.lpf_cutoff, s.filter_mode),
      resonance = s.lpf_resonance ?? 0;
    if (e.key === "Home") position = 0;
    else if (e.key === "End") position = STEPS;
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight")
      position += e.key === "ArrowLeft" ? -10 : 10;
    else
      resonance = bound(resonance + (e.key === "ArrowUp" ? 0.1 : -0.1), 0, 10);
    config.onChange(
      { cutoff: cutoffValue(position, s.filter_mode), resonance },
      true,
    );
    syncFilterUI();
  });
  resizeObserver?.disconnect();
  resizeObserver = new ResizeObserver(syncFilterUI);
  resizeObserver.observe(canvas);
  syncFilterUI();
}
