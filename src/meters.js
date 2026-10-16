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
