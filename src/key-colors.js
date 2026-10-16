import { assigned } from "./model.js";
const goldenAngle = 137.50776405003785;
function rgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  });
}
function luminance(channels) {
  return channels
    .map((v) => {
      const x = v / 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}
const selectedBackground = luminance([52, 72, 46]);
function candidateColor(index) {
  const hue = (12 + index * goldenAngle) % 360;
  let lightness = 0.68 + 0.015 * (Math.floor(index / 128) % 3);
  let channels = rgb(hue, 0.72, lightness);
  while ((luminance(channels) + 0.05) / (selectedBackground + 0.05) < 3.2) {
    lightness += 0.01;
    channels = rgb(hue, 0.72, lightness);
  }
  return "#" + channels.map((v) => v.toString(16).padStart(2, "0")).join("");
}
export function assignedNotes(sample) {
  return Array.from({ length: 128 }, (_, n) => n).filter((n) =>
    assigned(sample, n),
  );
}

export const COLOR_PALETTE = Object.freeze([
  "#e4b36b",
  "#77c7d3",
  "#bc9ce6",
  "#e8919e",
  "#a9cb75",
  "#7cace3",
  "#e59d76",
  "#d4a6d7",
  "#78c9a7",
  "#c4bd79",
  "#a6b4e7",
  "#dfa4be",
]);
const validColor = (value) => /^#[0-9a-f]{6}$/i.test(value ?? "");
const unique = (values) => [...new Set(values)];
const candidates = Object.freeze(
  unique([
    ...COLOR_PALETTE,
    ...Array.from({ length: 1024 }, (_, n) => candidateColor(n)),
  ]),
);
const covers = (entry, note) =>
  entry.notes.length > 0 &&
  note >= entry.notes[0] &&
  note <= entry.notes.at(-1);
function colorGradient(colors) {
  if (!colors.length) return "none";
  return (
    "linear-gradient(to bottom, " +
    colors
      .map(
        (color, i) =>
          `${color} ${(100 * i) / colors.length}% ${(100 * (i + 1)) / colors.length}%`,
      )
      .join(", ") +
    ")"
  );
}
/** Spread ranges define the colors. Single notes inherit covering ranges first. */
export function createKeyColorMap(samples) {
  const entries = samples.map((sample) => {
    const notes = assignedNotes(sample);
    return {
      sample,
      notes,
      spread: notes.length > 1,
      manual: validColor(sample.color) ? sample.color.toLowerCase() : null,
    };
  });
  const ranges = entries.filter((e) => e.spread);
  const token = (e) =>
    e.sample.color_group
      ? "family:" + e.sample.color_group
      : e.spread
        ? `range:${String(e.notes[0]).padStart(3, "0")}:${String(e.notes.at(-1)).padStart(3, "0")}`
        : `note:${String(e.notes[0]).padStart(3, "0")}`;
  // A range's automatic color is shared even when rows have different roots/settings.
  const rangeTokens = new Map();
  for (const e of ranges
    .filter((e) => !e.manual)
    .sort((a, b) => token(a).localeCompare(token(b)))) {
    const signature = e.notes[0] + ":" + e.notes.at(-1);
    if (!rangeTokens.has(signature)) rangeTokens.set(signature, token(e));
  }
  const resolvedToken = (e) =>
    e.spread
      ? (rangeTokens.get(e.notes[0] + ":" + e.notes.at(-1)) ?? token(e))
      : token(e);
  const isolated = entries.filter(
    (e) =>
      !e.spread &&
      e.notes.length &&
      !e.manual &&
      !ranges.some((r) => covers(r, e.notes[0])),
  );
  const tokens = unique([
    ...ranges
      .filter((e) => !e.manual)
      .map(resolvedToken)
      .sort(),
    ...isolated.map(resolvedToken).sort(),
  ]);
  const reserved = new Set(
    entries.filter((e) => e.manual).map((e) => e.manual),
  );
  const palette = candidates.filter((c) => !reserved.has(c));
  const groupColors = new Map(tokens.map((id, i) => [id, palette[i]]));
  const ownColor = (e) => e.manual ?? groupColors.get(resolvedToken(e));
  const rangeColorsAt = (n) =>
    unique(
      ranges
        .filter((e) => covers(e, n))
        .map(ownColor)
        .filter(Boolean),
    );
  const sampleColors = new Map();
  for (const e of entries) {
    let colors = [];
    if (e.notes.length) {
      if (e.manual || e.spread) colors = [ownColor(e)];
      else colors = rangeColorsAt(e.notes[0]);
      if (!colors.length) colors = [ownColor(e)];
    } else if (e.manual) colors = [e.manual];
    sampleColors.set(e.sample, unique(colors.filter(Boolean)));
  }
  const noteColors = Array.from({ length: 128 }, (_, n) =>
    unique([
      ...rangeColorsAt(n),
      ...entries
        .filter((e) => !e.spread && covers(e, n))
        .flatMap((e) => sampleColors.get(e.sample)),
    ]),
  );
  return {
    colorsForNote: (n) => noteColors[n] ?? [],
    colorsForSample: (s) => sampleColors.get(s) ?? [],
    gradientForSample: (s) => colorGradient(sampleColors.get(s) ?? []),
  };
}
