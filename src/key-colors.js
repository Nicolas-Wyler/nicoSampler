import { assigned } from './model.js';
const goldenAngle = 137.50776405003785;
function rgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  });
}
function luminance(channels) {
  return channels.map((v) => {
    const x = v / 255;
    return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4;
  }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
}
const selectedBackground = luminance([52, 72, 46]);
const colors = Object.freeze(Array.from({length:128}, (_, note) => {
  const hue = (12 + note * goldenAngle) % 360;
  let lightness = .68, channels = rgb(hue, .72, lightness);
  while ((luminance(channels) + .05) / (selectedBackground + .05) < 3.2) {
    lightness += .01;
    channels = rgb(hue, .72, lightness);
  }
  return '#' + channels.map(v => v.toString(16).padStart(2, '0')).join('');
}));
/** Stable per MIDI note across programs/windows; neighboring notes use distant hues. */
export function keyColor(note) {
  return Number.isInteger(note) && note >= 0 && note <= 127 ? colors[note] : null;
}
export function assignedNotes(sample) {
  return Array.from({length:128}, (_, n) => n).filter(n => assigned(sample, n));
}
/** Hard segments, low note at the top. Identical assignments intentionally share colors. */
export function sampleColorGradient(sample) {
  const notes = assignedNotes(sample);
  if (!notes.length) return 'none';
  return 'linear-gradient(to bottom, ' + notes.map((note, i) =>
    `${keyColor(note)} ${100 * i / notes.length}% ${100 * (i + 1) / notes.length}%`
  ).join(', ') + ')';
}
