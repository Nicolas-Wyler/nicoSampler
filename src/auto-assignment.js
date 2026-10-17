import { assigned } from "./model.js";
/** Find one free ascending block; preserve every existing assignment, including spreads. */
export function findFreeKeyBlock(
  samples,
  count,
  { min = 0, max = 127, center = 63.5 } = {},
) {
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    !Number.isInteger(min) ||
    !Number.isInteger(max) ||
    min < 0 ||
    max > 127 ||
    min > max ||
    !Number.isFinite(center)
  )
    return null;
  const used = new Set();
  for (let n = min; n <= max; n++)
    if (samples.some((s) => assigned(s, n))) used.add(n);
  const starts = [];
  for (let start = min; start + count - 1 <= max; start++)
    if (
      Array.from({ length: count }, (_, i) => start + i).every(
        (n) => !used.has(n),
      )
    )
      starts.push(start);
  starts.sort(
    (a, b) =>
      Math.abs(a + (count - 1) / 2 - center) -
        Math.abs(b + (count - 1) / 2 - center) || a - b,
  );
  return starts[0] ?? null;
}

export function hasAssignedKeys(sample) {
  return Array.from({ length: 128 }, (_, n) => n).some((n) =>
    assigned(sample, n),
  );
}
