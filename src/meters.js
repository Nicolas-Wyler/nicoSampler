// The Python sampler's meters and recording threshold share this dBFS scale.
export const METER_FLOOR_DB = -60;
export const METER_SEGMENTS = 40;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export function amplitudeDb(peak) {
  const value = Number(peak);
  return Number.isFinite(value) && value > 0
    ? clamp(20 * Math.log10(value), METER_FLOOR_DB, 0)
    : METER_FLOOR_DB;
}
export function dbPosition(db) {
  const value = Number(db);
  return Number.isFinite(value)
    ? clamp((value - METER_FLOOR_DB) / -METER_FLOOR_DB, 0, 1)
    : 0;
}
export function positionDb(position) {
  const value = Number(position);
  return (
    METER_FLOOR_DB +
    clamp(Number.isFinite(value) ? value : 0, 0, 1) * -METER_FLOOR_DB
  );
}
export function peakPosition(peak) {
  return dbPosition(amplitudeDb(peak));
}
export function litSegments(peak) {
  return Math.round(peakPosition(peak) * METER_SEGMENTS);
}
function renderMeter(element, peak, label) {
  if (!element) return;
  if (element.children.length !== METER_SEGMENTS) {
    element.replaceChildren(
      ...Array.from({ length: METER_SEGMENTS }, (_, i) => {
        const segment = document.createElement("span");
        segment.className =
          "meter-led " + (i < 30 ? "green" : i < 36 ? "yellow" : "red");
        segment.setAttribute("aria-hidden", "true");
        return segment;
      }),
    );
  }
  const lit = litSegments(peak);
  [...element.children].forEach((segment, i) =>
    segment.classList.toggle("lit", i < lit),
  );
  element.dataset.lit = String(lit);
  element.style.width = "100%";
  element.style.background = "transparent";
  const parent = element.parentElement,
    db = amplitudeDb(peak);
  parent.style.setProperty(
    "--phone-meter-color",
    db >= -6 ? "#f2695d" : db >= -15 ? "#edcf5f" : "#a8d970",
  );
  parent.style.setProperty(
    "--phone-meter-strength",
    String(Number(peak) > 0 ? 0.15 + 0.85 * dbPosition(db) : 0.08),
  );
  parent.setAttribute("role", "meter");
  parent.setAttribute("aria-label", label);
  parent.setAttribute("aria-valuemin", METER_FLOOR_DB);
  parent.setAttribute("aria-valuemax", "0");
  parent.setAttribute("aria-valuenow", db.toFixed(1));
  parent.setAttribute(
    "aria-valuetext",
    Number(peak) > 0 ? `${db.toFixed(1)} dBFS` : "Silent",
  );
}
export function updateMeters(outputPeak = 0, inputPeak = 0) {
  renderMeter(
    document.getElementById("header-input-meter"),
    inputPeak,
    "Input level",
  );
  renderMeter(
    document.getElementById("output-meter"),
    outputPeak,
    "Output level",
  );
  renderMeter(
    document.getElementById("input-meter"),
    inputPeak,
    "Recording input level",
  );
}

// Top-to-bottom: two red, three amber, seven green LEDs on a dBFS scale.
const ROW_THRESHOLDS = [0, -3, -6, -9, -12, -18, -24, -30, -36, -42, -48, -55];
const rowClipUntil = new WeakMap();
export function rowMeterColor(index) {
  return index < 2 ? "red" : index < 5 ? "amber" : "green";
}
export function renderRowMeter(element, peak, now = performance.now()) {
  if (!element) return;
  const db = amplitudeDb(peak);
  if (Number.isFinite(Number(peak)) && Number(peak) >= 1) rowClipUntil.set(element, now + 1000);
  [...element.children].forEach((segment, index) => {
    const clippingHold = index === 0 && now < (rowClipUntil.get(element) ?? 0);
    segment.classList.toggle("lit", clippingHold || (Number(peak) > 0 && db >= ROW_THRESHOLDS[index]));
  });
  element.setAttribute("aria-valuenow", String(db));
}
