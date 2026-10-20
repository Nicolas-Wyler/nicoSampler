import { createZoomInertia } from "./zoom-inertia.js";
import { RATE, bounds, clamp, fitMarkers } from "./model.js";
export class Waveform {
  constructor(canvas, onEdit) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onEdit = onEdit;
    this.viewStart = 0;
    this.viewEnd = 1;
    this.pointers = new Map();
    this.position = -1;
    this.fitMode = "full";
    this.resetZoomMotion();
    this.observer = new ResizeObserver(() => this.draw());
    this.observer.observe(canvas);
    canvas.addEventListener("pointerdown", (e) => this.down(e));
    canvas.addEventListener("pointermove", (e) => this.move(e));
    canvas.addEventListener("pointerup", (e) => this.up(e));
    canvas.addEventListener("pointercancel", (e) => this.up(e));
    canvas.addEventListener(
      "wheel",
      (e) => {
        if (!this.sample?.audio) return;
        e.preventDefault();
        if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY))
          this.panBy(
            ((e.deltaX || e.deltaY) * (this.viewEnd - this.viewStart)) /
              this.width,
          );
        else {
          const scale =
            this.sample.audio[0].length / (this.viewEnd - this.viewStart);
          this.zoomMotion.wheel(scale * Math.exp(-e.deltaY * 0.005), {
            frame: this.frame(e.offsetX),
            ratio: clamp(e.offsetX / this.width, 0, 1),
          });
        }
      },
      { passive: false },
    );
  }
  resetZoomMotion() {
    this.zoomMotion?.cancel();
    const n = this.sample?.audio?.[0]?.length ?? 1;
    this.zoomMotion = createZoomInertia({
      getScale: () => n / (this.viewEnd - this.viewStart),
      min: 1,
      max: n / Math.min(32, n),
      setScale: (scale, focal) => {
        if (!this.sample?.audio) return;
        const span = n / scale,
          frame = focal?.frame ?? (this.viewStart + this.viewEnd) / 2,
          ratio = focal?.ratio ?? 0.5;
        this.viewStart = clamp(frame - span * ratio, 0, n - span);
        this.viewEnd = this.viewStart + span;
        this.fitMode = null;
        this.draw();
        this.onView?.();
      },
    });
  }
  setSample(s, processed) {
    const changed = this.sample?.id !== s?.id || this.source !== s?.audio?.[0];
    this.source = s?.audio?.[0];
    this.sample = s;
    this.processed = processed;
    if (changed) {
      this.viewStart = 0;
      this.viewEnd = s?.audio?.[0]?.length ?? 1;
      this.position = -1;
      this.fitMode = "full";
      this.resetZoomMotion();
    }
    this.buildPeaks();
    this.draw();
  }
  buildPeaks() {
    const a = this.processed ?? this.sample?.audio;
    if (!a) {
      this.peaks = null;
      return;
    }
    const n = a[0].length,
      bins = Math.min(4096, n),
      stride = Math.ceil(n / bins);
    const peaks = Array.from({ length: 3 }, () => ({
      min: new Float32Array(bins),
      max: new Float32Array(bins),
      stride,
    }));
    for (let b = 0; b < bins; b++)
      for (let i = b * stride; i < Math.min(n, (b + 1) * stride); i++) {
        const l = a[0][i],
          r = a[1]?.[i] ?? l,
          values = [l, r, (l + r) / 2];
        for (let c = 0; c < 3; c++) {
          peaks[c].min[b] = Math.min(peaks[c].min[b], values[c]);
          peaks[c].max[b] = Math.max(peaks[c].max[b], values[c]);
        }
      }
    this.channelPeaks = peaks;
    this.peaks = {
      min: Float32Array.from(peaks[0].min, (v, i) =>
        Math.min(v, peaks[1].min[i]),
      ),
      max: Float32Array.from(peaks[0].max, (v, i) =>
        Math.max(v, peaks[1].max[i]),
      ),
      stride,
    };
  }
  frame(x) {
    return (
      this.viewStart +
      clamp(x / this.width, 0, 1) * (this.viewEnd - this.viewStart)
    );
  }
  x(frame) {
    return (
      ((frame - this.viewStart) / (this.viewEnd - this.viewStart)) * this.width
    );
  }
  zoom(factor, center = (this.viewStart + this.viewEnd) / 2) {
    this.zoomMotion?.cancel();
    const n = this.sample?.audio?.[0]?.length;
    if (!n) return;
    const span = clamp(
        (this.viewEnd - this.viewStart) * factor,
        Math.min(32, n),
        n,
      ),
      t = (center - this.viewStart) / (this.viewEnd - this.viewStart);
    this.viewStart = clamp(center - span * t, 0, n - span);
    this.viewEnd = this.viewStart + span;
    this.fitMode = null;
    this.draw();
    this.onView?.();
  }
  panBy(delta) {
    this.zoomMotion?.cancel();
    const n = this.sample?.audio?.[0]?.length;
    if (!n) return;
    const span = this.viewEnd - this.viewStart;
    this.viewStart = clamp(this.viewStart + delta, 0, n - span);
    this.viewEnd = this.viewStart + span;
    this.fitMode = null;
    this.draw();
    this.onView?.();
  }
  fit() {
    this.zoomMotion?.cancel();
    if (!this.sample?.audio) return;
    const [a, b] = bounds(this.sample),
      modes = ["full", "trim", "loop"];
    this.fitMode =
      this.fitMode == null
        ? "full"
        : modes[(modes.indexOf(this.fitMode) + 1) % 3];
    const spans = {
      full: [0, this.sample.audio[0].length],
      trim: [a, b],
      loop: [this.sample.loop_start ?? a, this.sample.loop_end ?? b],
    };
    [this.viewStart, this.viewEnd] = spans[this.fitMode];
    this.draw();
    this.onView?.();
  }
  down(e) {
    if (!this.sample?.audio) return;
    this.zoomMotion?.cancel();
    const rect = this.canvas.getBoundingClientRect(),
      x = e.clientX - rect.left,
      y = e.clientY - rect.top;
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x, y });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = {
        distance: Math.max(1, Math.abs(a.x - b.x)),
        span: this.viewEnd - this.viewStart,
        center: this.frame((a.x + b.x) / 2),
        ratio: clamp((a.x + b.x) / 2 / this.width, 0, 1),
      };
      this.drag = null;
      this.zoomMotion.begin();
      return;
    }
    const s = this.sample,
      [a, b] = bounds(s),
      markers =
        y > this.height * 0.62
          ? [
              ["loop_start", s.loop_start ?? a],
              ["loop_end", s.loop_end ?? b],
            ]
          : [
              ["trim_start", a],
              ["trim_end", b],
            ];
    const near = markers.sort(
      (a, b) => Math.abs(this.x(a[1]) - x) - Math.abs(this.x(b[1]) - x),
    )[0];
    this.drag =
      Math.abs(this.x(near[1]) - x) < (e.pointerType === "touch" ? 44 : 32)
        ? { marker: near[0] }
        : { pan: true, x, start: this.viewStart, end: this.viewEnd };
  }
  move(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const rect = this.canvas.getBoundingClientRect(),
      x = e.clientX - rect.left,
      y = e.clientY - rect.top;
    this.pointers.set(e.pointerId, { x, y });
    if (this.pointers.size === 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()],
        span = this.viewEnd - this.viewStart;
      const n = this.sample.audio[0].length;
      this.zoomMotion.update(
        n /
          ((this.pinch.span * Math.max(1, this.pinch.distance)) /
            Math.max(1, Math.abs(a.x - b.x))),
        { frame: this.pinch.center, ratio: this.pinch.ratio },
      );
      return;
    }
    if (!this.drag) return;
    if (this.drag.pan) {
      const delta =
          ((x - this.drag.x) * (this.drag.end - this.drag.start)) / this.width,
        n = this.sample.audio[0].length,
        span = this.drag.end - this.drag.start;
      this.viewStart = clamp(this.drag.start - delta, 0, n - span);
      this.viewEnd = this.viewStart + span;
      this.draw();
      this.onView?.();
      return;
    }
    const s = this.sample,
      n = s.audio[0].length,
      frame = Math.round(this.frame(x));
    if (this.drag.marker === "trim_start") {
      s.trim_start = clamp(frame, 0, (s.trim_end ?? n) - 1);
    }
    if (this.drag.marker === "trim_end") {
      s.trim_end = clamp(frame, s.trim_start + 1, n);
    }
    if (this.drag.marker === "loop_start") {
      s.loop_start = clamp(frame, 0, (s.loop_end ?? s.trim_end ?? n) - 1);
    }
    if (this.drag.marker === "loop_end") {
      s.loop_end = clamp(frame, (s.loop_start ?? s.trim_start) + 1, n);
      s.trim_end = Math.max(s.trim_end ?? n, s.loop_end);
    }
    fitMarkers(s);
    this.draw();
    this.onEdit(false);
  }
  up(e) {
    const edited = this.drag?.marker;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2 && this.pinch) {
      this.pinch = null;
      if (e.type === "pointercancel") this.zoomMotion?.cancel();
      else this.zoomMotion.release();
    }
    if (!this.pointers.size) {
      this.drag = null;
      if (edited) this.onEdit(true);
    }
  }
  draw() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width || 600;
    this.height = rect.height || 205;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    if (
      this.canvas.width !== Math.round(this.width * dpr) ||
      this.canvas.height !== Math.round(this.height * dpr)
    ) {
      this.canvas.width = Math.round(this.width * dpr);
      this.canvas.height = Math.round(this.height * dpr);
    }
    const c = this.ctx,
      w = this.width,
      h = this.height;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    c.fillStyle = "#121a16";
    c.fillRect(0, 0, w, h);
    c.strokeStyle = "#2c3c2e";
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, h / 2);
    c.lineTo(w, h / 2);
    c.stroke();
    const s = this.sample;
    if (!s?.audio || !this.peaks) return;
    const [start, end] = bounds(s),
      ls = s.loop_start ?? start,
      le = s.loop_end ?? end;
    c.fillStyle = "#253923";
    c.fillRect(this.x(start), 25, this.x(end) - this.x(start), h - 45);
    const n = s.audio[0].length,
      span = this.viewEnd - this.viewStart,
      audio = this.processed ?? s.audio;
    const split = s.wave_view === "split";
    const lanes = split
      ? [0, 1]
      : [
          s.mono
            ? s.mono_channel === "left"
              ? 0
              : s.mono_channel === "right"
                ? 1
                : 2
            : -1,
        ];
    for (let lane = 0; lane < lanes.length; lane++) {
      const channel = lanes[lane],
        data = channel === -1 ? this.peaks : this.channelPeaks[channel];
      const top = 30 + (lane * (h - 60)) / lanes.length,
        laneHeight = (h - 60) / lanes.length,
        center = top + laneHeight / 2,
        scale = Math.max(1, laneHeight / 2 - 9);
      c.strokeStyle = "#2c3c2e";
      c.beginPath();
      c.moveTo(0, center);
      c.lineTo(w, center);
      c.stroke();
      c.fillStyle = lane === 1 ? "#7cc9d4" : "#b8d792";
      for (let x = 0; x < w; x++) {
        const a = Math.floor(this.frame(x)),
          b = Math.min(n, Math.max(a + 1, Math.floor(this.frame(x + 1))));
        let lo = 0,
          hi = 0;
        if (span / w < data.stride) {
          for (let i = a; i < b; i++) {
            const l = audio[0][i],
              r = audio[1]?.[i] ?? l;
            const values =
              channel === -1
                ? [l, r]
                : [channel === 0 ? l : channel === 1 ? r : (l + r) / 2];
            for (const v of values) {
              lo = Math.min(lo, v);
              hi = Math.max(hi, v);
            }
          }
        } else
          for (
            let i = Math.floor(a / data.stride);
            i <= Math.min(data.min.length - 1, Math.floor(b / data.stride));
            i++
          ) {
            lo = Math.min(lo, data.min[i]);
            hi = Math.max(hi, data.max[i]);
          }
        c.fillRect(x, center - hi * scale, 1, Math.max(1, (hi - lo) * scale));
      }
      if (split) {
        c.font = "11px Helvetica, Arial, sans-serif";
        c.fillText(lane === 0 ? "L" : "R", 8, top + 13);
      }
    }
    c.font = "9px Helvetica, Arial, sans-serif";
    c.fillStyle = "#8da17f";
    const sec = span / RATE,
      target = sec / (w / 90),
      mag = 10 ** Math.floor(Math.log10(Math.max(1 / RATE, target))),
      step = [1, 2, 5, 10].find((n) => n * mag >= target) * mag;
    for (
      let t = Math.ceil(this.viewStart / RATE / step) * step;
      t <= this.viewEnd / RATE;
      t += step
    ) {
      const x = this.x(t * RATE);
      c.fillText(
        sec < 1
          ? `${Math.round(t * 1000)} ms`
          : `${t.toFixed(sec < 10 ? 2 : 1)} s`,
        x + 3,
        13,
      );
    }
    const marker = (frame, label, color, bottom = false) => {
      let x = this.x(frame);
      if (x < 0 || x > w) return;
      x = clamp(x, 1, w - 1);
      c.fillStyle = color;
      c.strokeStyle = color;
      c.beginPath();
      c.moveTo(x, 24);
      c.lineTo(x, h - 20);
      c.stroke();
      const handleWidth = 24,
        handleHeight = 25;
      const hx = clamp(x - handleWidth / 2, 0, w - handleWidth),
        hy = bottom ? h - handleHeight - 3 : 3;
      c.beginPath();
      c.roundRect(hx, hy, handleWidth, handleHeight, 5);
      c.fill();
      c.strokeStyle = "#334a35";
      for (const offset of [-3, 3]) {
        c.beginPath();
        c.moveTo(hx + handleWidth / 2 + offset, hy + 7);
        c.lineTo(hx + handleWidth / 2 + offset, hy + handleHeight - 7);
        c.stroke();
      }
      c.textAlign = x > w - 60 ? "right" : "left";
      c.fillText(label, x + (x > w - 60 ? -5 : 5), bottom ? h - 7 : 29);
      c.textAlign = "left";
    };
    marker(start, "START", "#b7e991");
    marker(end, "END", "#b7e991");
    marker(ls, "LOOP IN", "#f1c587", true);
    marker(le, "LOOP OUT", "#f1c587", true);
    if (this.position >= this.viewStart && this.position <= this.viewEnd) {
      c.strokeStyle = "#fff";
      c.beginPath();
      c.moveTo(this.x(this.position), 20);
      c.lineTo(this.x(this.position), h - 20);
      c.stroke();
    }
  }
}
