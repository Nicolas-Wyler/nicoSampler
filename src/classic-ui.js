import { noteName, assigned, clamp } from "./model.js";
import { playbackParts, playbackMode } from "./workflows.js";
import { createZoomInertia } from "./zoom-inertia.js";
import { selectLabel } from "./controls.js";
import { createKeyColorMap } from "./key-colors.js";
// Geometry and placement match the previous 17px macOS row glyphs.
// Shared by initial rendering, playback-meter updates, and Panic.
export function setRowPreviewIcon(button, playing) {
  button.innerHTML = `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" fill="currentColor">${playing ? '<rect x="12.08" y="14.16" width="7.84" height="7.84" />' : '<path d="M9.88 8.06 22.25 15.2 9.88 22.34Z" />'}</svg>`;
}
const headers = [
  "Sample",
  "Env",
  "Trig",
  "Ovl",
  "Key",
  "Max",
  "Pitch",
  "Filter",
  "FX1",
  "FX2",
  "Pan",
  "Lvl",
];
const fullHeaders = {
  1: "Envelope",
  2: "Trigger",
  3: "Overlap",
  5: "Max vel",
  11: "Level",
};
const LOCKED_COLUMNS = new Set([5, 8, 9, 10, 11]);
const ROW_SIZE = 49;
const KNOB_DIAMETER = 24;
const fixedColumnWidth = (i) => (i === 5 ? ROW_SIZE : KNOB_DIAMETER * 1.5);
const baseWidths = [220, 80, 110, 110, 156, 76, 76, 80, 64, 64, 72, 68];
const element = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};
export class ClassicUI {
  constructor(api) {
    this.api = api;
    this.widths = [...baseWidths];
    this.custom = false;
    this.manualWidths = new Map();
    this.dragId = null;
    this.table = document.getElementById("sample-table");
    this.head = document.getElementById("table-head");
    this.cols = document.getElementById("table-cols");
    this.piano = document.getElementById("keyboard");
    this.keyboardScroll = document.getElementById("keyboard-scroll");
    this.keyboardZoom = 1;
    this.zoomMotion = createZoomInertia({
      getScale: () => this.keyboardZoom,
      setScale: (scale, x) => this.setKeyboardZoom(scale, x, true),
      min: 1,
      max: 75 / 7,
    });
    this.pinchPointers = new Map();
    this.installKeyboardZoom();
    this.installTouchSelection();
    this.installRowDragging();
    document.addEventListener(
      "pointerdown",
      (e) => {
        if (!e.target.closest(".remove-sample-button"))
          this.resetRemoveConfirmation();
        if (!this.rowDrag) this.suppressDragClickUntil = 0;
        this.suppressSelectionClick = false;
      },
      true,
    );
    document.addEventListener(
      "keydown",
      (e) => {
        this.suppressSelectionClick = false;
        this.suppressDragClickUntil = 0;
        if (e.key === "Escape") this.resetRemoveConfirmation();
      },
      true,
    );
    this.buildHeaders();
    const tableWrap = document.getElementById("table-wrap");
    this.tableResizeObserver = new ResizeObserver(() => {
      const width = tableWrap.clientWidth;
      const height = tableWrap.clientHeight;
      if (
        width !== this.lastTableViewportWidth ||
        height !== this.lastTableViewportHeight
      ) {
        this.lastTableViewportWidth = width;
        this.lastTableViewportHeight = height;
        if (width > 0) {
          cancelAnimationFrame(this.tableLayoutFrame);
          this.tableLayoutFrame = requestAnimationFrame(() =>
            this.fitColumns(),
          );
        }
      }
      if (width > 0 && this.pendingViewSettings)
        this.restoreViewSettings(this.pendingViewSettings);
    });
    this.tableResizeObserver.observe(tableWrap);
    for (const area of [
      this.keyboardScroll,
      tableWrap,
      document.getElementById("program-ribbon"),
    ]) {
      area.addEventListener("scroll", () => this.queueViewChanged(), {
        passive: true,
      });
    }
  }
  setKeyboardCollapsed(collapsed) {
    document
      .querySelector(".keyboard-panel")
      .classList.toggle("is-folded", collapsed);
    const button = document.getElementById("keyboard-fold");
    button.textContent = collapsed ? "⌃" : "⌄";
    button.setAttribute("aria-expanded", String(!collapsed));
    button.setAttribute(
      "aria-label",
      collapsed ? "Expand piano" : "Fold piano",
    );
    button.title = collapsed ? "Expand piano" : "Fold piano";
  }
  getViewSettings() {
    if (!this.keyboardScroll.clientWidth && this.pendingViewSettings)
      return structuredClone(this.pendingViewSettings);
    const ratio = (area) =>
      area.scrollWidth > area.clientWidth
        ? area.scrollLeft / (area.scrollWidth - area.clientWidth)
        : 0;
    const keyboard = this.keyboardScroll;
    return {
      keyboard: {
        collapsed: document
          .querySelector(".keyboard-panel")
          .classList.contains("is-folded"),
        zoom: this.keyboardZoom,
        position:
          keyboard.scrollWidth > 0
            ? (keyboard.scrollLeft + keyboard.clientWidth / 2) /
              keyboard.scrollWidth
            : 0.5,
      },
      tableScroll: ratio(document.getElementById("table-wrap")),
      programScroll: ratio(document.getElementById("program-ribbon")),
    };
  }
  queueViewChanged() {
    if (this.restoringView) return;
    clearTimeout(this.viewChangeTimer);
    this.viewChangeTimer = setTimeout(() => {
      if (this.restoringView) return;
      const settings = this.getViewSettings(),
        signature = JSON.stringify(settings);
      if (signature === this.lastViewSignature) return;
      this.lastViewSignature = signature;
      this.api.viewChanged?.(settings);
    }, 120);
  }
  restoreViewSettings(settings) {
    if (!settings || typeof settings !== "object") return;
    clearTimeout(this.viewChangeTimer);
    cancelAnimationFrame(this.viewRestoreFrame);
    this.zoomMotion.cancel();
    this.restoringView = true;
    const finite = (value, fallback, min, max) =>
      Number.isFinite(value) ? clamp(value, min, max) : fallback;
    const zoom = finite(settings.keyboard?.zoom, 1, 1, 75 / 7),
      position = finite(settings.keyboard?.position, 0.5, 0, 1);
    this.pendingViewSettings = {
      keyboard: {
        zoom,
        position,
        collapsed: settings.keyboard?.collapsed === true,
      },
      tableScroll: finite(settings.tableScroll, 0, 0, 1),
      programScroll: finite(settings.programScroll, 0, 0, 1),
    };
    this.setKeyboardCollapsed(settings.keyboard?.collapsed === true);
    this.keyboardZoom = zoom;
    this.viewRestoreFrame = requestAnimationFrame(() => {
      if (!this.keyboardScroll.clientWidth) return;
      this.keyboardZoom = zoom;
      this.applyPianoZoom();
      this.keyboardScroll.scrollLeft =
        position * this.keyboardScroll.scrollWidth -
        this.keyboardScroll.clientWidth / 2;
      const table = document.getElementById("table-wrap"),
        programs = document.getElementById("program-ribbon");
      table.scrollLeft =
        finite(settings.tableScroll, 0, 0, 1) *
        Math.max(0, table.scrollWidth - table.clientWidth);
      programs.scrollLeft =
        finite(settings.programScroll, 0, 0, 1) *
        Math.max(0, programs.scrollWidth - programs.clientWidth);
      this.pendingViewSettings = null;
      this.lastViewSignature = JSON.stringify(this.getViewSettings());
      this.restoringView = false;
    });
  }
  resetRemoveConfirmation() {
    this.removeArmed = false;
    const button = document.querySelector(".remove-sample-button");
    if (button) {
      button.textContent = "−";
      button.classList.remove("confirm-delete");
      button.setAttribute("aria-label", "Remove selected samples");
    }
  }
  installTouchSelection() {
    this.touchPointers = new Set();
    this.blockedTouchPointers = new Set();
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (event.pointerType !== "touch" || event.selectionReplay) return;
        this.touchPointers.add(event.pointerId);
        if (this.touchPointers.size > 1 && this.touchSelection) {
          const pending = this.touchSelection;
          clearTimeout(pending.timer);
          if (!pending.dragging)
            this.blockedTouchPointers.add(pending.pointerId);
          if (event.target.closest("#sample-table tr"))
            this.blockedTouchPointers.add(event.pointerId);
          this.touchSelection = null;
          this.finishRowDrag(true);
        }
      },
      true,
    );
    document.getElementById("table-wrap").addEventListener("scroll", () => {
      const pending = this.touchSelection;
      if (pending && !pending.dragging) {
        clearTimeout(pending.timer);
        pending.scrolling = true;
      }
    });
    const finish = (event, cancel = false) => {
      this.touchPointers.delete(event.pointerId);
      if (this.blockedTouchPointers.delete(event.pointerId)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.suppressSelectionClick = true;
        return;
      }
      const pending = this.touchSelection;
      if (!pending || pending.pointerId !== event.pointerId) return;
      clearTimeout(pending.timer);
      this.touchSelection = null;
      const mode = this.api.selectionMode?.() ?? false;
      if (pending.dragging) return;
      if (
        cancel ||
        pending.long ||
        pending.scrolling ||
        (mode && !pending.dragging && !pending.preview)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.suppressSelectionClick = true;
        if (
          !cancel &&
          !pending.long &&
          !pending.scrolling &&
          mode &&
          !pending.dragging &&
          !pending.preview
        )
          this.api.rowSelect(pending.id, {});
      }
    };
    document.addEventListener(
      "pointermove",
      (event) => {
        const pending = this.touchSelection;
        if (!pending || pending.pointerId !== event.pointerId || pending.long)
          return;
        if (
          Math.hypot(event.clientX - pending.x, event.clientY - pending.y) <= 8
        )
          return;
        clearTimeout(pending.timer);
        if (!pending.isTouch) {
          this.touchSelection = null;
          return;
        }
        if (pending.dragging || pending.scrolling) return;
        const mode = this.api.selectionMode?.() ?? false;
        if (
          pending.target.closest(".row-handle") ||
          (!mode && pending.target.closest(".knob,.pitch-drag"))
        ) {
          pending.dragging = true;
          const replay = new PointerEvent("pointerdown", {
            bubbles: true,
            cancelable: true,
            pointerId: event.pointerId,
            pointerType: "touch",
            clientX: pending.x,
            clientY: pending.y,
            button: 0,
            buttons: 1,
          });
          Object.defineProperty(replay, "selectionReplay", { value: true });
          pending.target.dispatchEvent(replay);
        } else pending.scrolling = true;
      },
      true,
    );
    document.addEventListener("pointerup", (event) => finish(event), {
      capture: true,
      passive: false,
    });
    document.addEventListener("pointercancel", (event) => finish(event, true), {
      capture: true,
      passive: false,
    });
  }
  deferTouchSelection(event, id, selected) {
    const isTouch = event.pointerType === "touch";
    if (
      event.selectionReplay ||
      (!isTouch && event.pointerType !== "mouse") ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey
    )
      return false;
    const mode = this.api.selectionMode?.() ?? false;
    if (!isTouch && mode) return false;
    if (isTouch) event.stopImmediatePropagation();
    if (isTouch && this.touchPointers.size > 1)
      this.blockedTouchPointers.add(event.pointerId);
    if (this.blockedTouchPointers.has(event.pointerId)) return true;
    if (this.touchSelection) {
      clearTimeout(this.touchSelection.timer);
      this.touchSelection = null;
    }
    const pending = {
      id,
      isTouch,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      target: event.target,
      long: false,
      dragging: false,
      scrolling: false,
      preview:
        mode && selected && Boolean(event.target.closest(".row-preview")),
    };
    if (!mode)
      pending.timer = setTimeout(() => {
        if (
          this.touchSelection !== pending ||
          pending.dragging ||
          pending.scrolling ||
          this.rowDrag?.active
        )
          return;
        pending.long = true;
        this.finishRowDrag(true);
        this.suppressSelectionClick = true;
        this.api.enterSelection?.(id);
      }, 500);
    this.touchSelection = pending;
    return isTouch;
  }
  installRowDragging() {
    document.addEventListener(
      "pointermove",
      (e) => {
        const drag = this.rowDrag;
        if (!drag || e.pointerId !== drag.pointerId) return;
        drag.x = e.clientX;
        drag.y = e.clientY;
        if (
          !drag.active &&
          Math.hypot(drag.x - drag.startX, drag.y - drag.startY) >= 5
        ) {
          drag.active = true;
          clearTimeout(this.touchSelection?.timer);
          document.body.classList.add("dragging-samples");
          for (const row of this.table.rows)
            if (drag.ids.includes(row.dataset.id))
              row.classList.add("row-dragging");
          this.insertionLine = element("div", "row-insertion-line");
          this.insertionLine.setAttribute("aria-hidden", "true");
          document.body.append(this.insertionLine);
          const scroll = () => {
            if (!this.rowDrag?.active) return;
            const area = document.getElementById("table-wrap"),
              rect = area.getBoundingClientRect();
            const speed =
              drag.y < rect.top + 34
                ? -Math.min(16, (rect.top + 34 - drag.y) / 3)
                : drag.y > rect.bottom - 34
                  ? Math.min(16, (drag.y - rect.bottom + 34) / 3)
                  : 0;
            if (speed) {
              area.scrollTop += speed;
              this.updateRowDrop();
            }
            this.dragScrollFrame = requestAnimationFrame(scroll);
          };
          this.dragScrollFrame = requestAnimationFrame(scroll);
        }
        if (drag.active) {
          e.preventDefault();
          this.updateRowDrop();
        }
      },
      { capture: true, passive: false },
    );
    document.addEventListener(
      "pointerup",
      (e) => {
        if (this.suppressSelectionClick && e.target.closest("#sample-grid")) {
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
        if (this.rowDrag?.pointerId === e.pointerId) this.finishRowDrag(false);
      },
      true,
    );
    document.addEventListener(
      "pointercancel",
      (e) => {
        if (this.rowDrag?.pointerId === e.pointerId) this.finishRowDrag(true);
      },
      true,
    );
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape" && this.rowDrag) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.finishRowDrag(true);
        }
      },
      true,
    );
    document.addEventListener(
      "click",
      (e) => {
        if (this.suppressSelectionClick && e.target.closest("#sample-grid")) {
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
        if (
          performance.now() < (this.suppressDragClickUntil ?? 0) &&
          e.target.closest(".row-handle")
        ) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      true,
    );
  }
  updateRowDrop() {
    const drag = this.rowDrag;
    if (!drag?.active) return;
    const area = document.getElementById("table-wrap"),
      bounds = area.getBoundingClientRect();
    const rows = [...this.table.rows].filter(
      (row) => !drag.ids.includes(row.dataset.id),
    );
    if (!rows.length) {
      drag.target = null;
      this.insertionLine.hidden = true;
      return;
    }
    let row = rows.find(
      (row) =>
        drag.y <
        row.getBoundingClientRect().top +
          row.getBoundingClientRect().height / 2,
    );
    const after = !row;
    row ??= rows.at(-1);
    const rect = row.getBoundingClientRect(),
      y = after ? rect.bottom : rect.top;
    drag.target = { id: row.dataset.id, after };
    this.insertionLine.hidden = y < bounds.top || y > bounds.bottom;
    Object.assign(this.insertionLine.style, {
      left: bounds.left + "px",
      top: y + "px",
      width: bounds.width + "px",
    });
  }
  finishRowDrag(cancel) {
    const drag = this.rowDrag;
    if (!drag) return;
    this.rowDrag = null;
    cancelAnimationFrame(this.dragScrollFrame);
    document.body.classList.remove("dragging-samples");
    for (const row of this.table.rows) row.classList.remove("row-dragging");
    this.insertionLine?.remove();
    this.insertionLine = null;
    if (drag.handle.hasPointerCapture(drag.pointerId))
      drag.handle.releasePointerCapture(drag.pointerId);
    if (!drag.active) return;
    this.suppressDragClickUntil = performance.now() + 500;
    if (!cancel && drag.target) {
      const rect = document
        .getElementById("table-wrap")
        .getBoundingClientRect();
      if (
        drag.x < rect.left - 30 ||
        drag.x > rect.right + 30 ||
        drag.y < rect.top - 30 ||
        drag.y > rect.bottom + 30
      )
        return;
      if (!drag.wasSelected) this.api.rowSelect?.(drag.id, {});
      this.api.reorder(drag.ids, drag.target.id, drag.target.after);
    }
  }
  installKeyboardZoom() {
    const area = this.keyboardScroll;
    area.addEventListener(
      "wheel",
      (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        e.stopPropagation();
        this.zoomMotion.wheel(
          this.keyboardZoom * Math.exp(-e.deltaY * 0.005),
          e.clientX,
        );
      },
      { passive: false },
    );
    const distance = () => {
      const values = [...this.pinchPointers.values()];
      return values.length < 2
        ? 0
        : Math.hypot(values[1].x - values[0].x, values[1].y - values[0].y);
    };
    area.addEventListener(
      "pointerdown",
      (e) => {
        if (e.pointerType !== "touch") return;
        if (!this.pinchPointers.size) this.zoomMotion.cancel();
        this.pinchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.pinchPointers.size === 2) {
          this.learningPianoTap = null;
          for (const id of this.pinchPointers.keys()) this.api.pointerOff(id);
          const points = [...this.pinchPointers.values()];
          const midpoint = (points[0].x + points[1].x) / 2;
          this.pinchStart = {
            distance: distance(),
            zoom: this.keyboardZoom,
            contentX:
              (area.scrollLeft + midpoint - area.getBoundingClientRect().left) /
              this.keyboardZoom,
          };
          if (e.isTrusted) area.setPointerCapture(e.pointerId);
          this.zoomMotion.begin();
          e.preventDefault();
          e.stopImmediatePropagation();
        } else if (this.pinchPointers.size > 2) {
          for (const id of this.pinchPointers.keys()) this.api.pointerOff(id);
          this.pinchStart = null;
          this.zoomMotion.cancel();
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      true,
    );
    area.addEventListener(
      "pointermove",
      (e) => {
        if (!this.pinchPointers.has(e.pointerId)) return;
        const pendingTap = this.learningPianoTap;
        if (
          pendingTap?.id === e.pointerId &&
          Math.hypot(e.clientX - pendingTap.x, e.clientY - pendingTap.y) > 8
        )
          this.learningPianoTap = null;
        this.pinchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (!this.pinchStart || this.pinchPointers.size !== 2) return;
        e.preventDefault();
        e.stopPropagation();
        const points = [...this.pinchPointers.values()];
        const midpoint = (points[0].x + points[1].x) / 2;
        this.zoomMotion.update(
          (this.pinchStart.zoom * distance()) /
            Math.max(1, this.pinchStart.distance),
          midpoint,
        );
        // Keep the original content under the moving two-finger midpoint.
        // Scale-only anchoring cannot pan when the finger distance is constant.
        area.scrollLeft =
          this.pinchStart.contentX * this.keyboardZoom -
          (midpoint - area.getBoundingClientRect().left);
        this.queueViewChanged();
      },
      { capture: true, passive: false },
    );
    const end = (e) => {
      this.pinchPointers.delete(e.pointerId);
      if (this.pinchPointers.size < 2 && this.pinchStart) {
        this.pinchStart = null;
        if (e.type === "pointercancel") this.zoomMotion.cancel();
        else this.zoomMotion.release();
      }
    };
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
      area.addEventListener(event, end, true);
    new ResizeObserver(() => this.applyPianoZoom()).observe(area);
  }
  setKeyboardZoom(value, clientX, fromMotion = false) {
    if (!fromMotion) this.zoomMotion.cancel();
    const area = this.keyboardScroll,
      rect = area.getBoundingClientRect();
    const x = clamp(
      clientX == null ? area.clientWidth / 2 : clientX - rect.left,
      0,
      area.clientWidth,
    );
    const relative = (area.scrollLeft + x) / this.keyboardZoom;
    this.keyboardZoom = clamp(value, 1, 75 / 7);
    this.applyPianoZoom();
    area.scrollLeft = relative * this.keyboardZoom - x;
    this.queueViewChanged();
  }
  applyPianoZoom() {
    const whites = [];
    for (let n = 0; n < 128; n++)
      if (![1, 3, 6, 8, 10].includes(n % 12)) whites.push(n);
    const width =
      (this.keyboardScroll.clientWidth / whites.length) * this.keyboardZoom;
    this.piano.style.width = whites.length * width + "px";
    for (const button of this.piano.children) {
      const n = Number(button.dataset.note),
        black = [1, 3, 6, 8, 10].includes(n % 12);
      button.style.width = (black ? width * 0.64 : width) + "px";
      button.style.left =
        (black
          ? whites.filter((v) => v < n).length * width - width * 0.32
          : whites.indexOf(n) * width) + "px";
    }
  }
  buildHeaders() {
    this.cols.replaceChildren(
      ...this.widths.map((w) => {
        const c = document.createElement("col");
        c.style.width = w + "px";
        return c;
      }),
    );
    this.head.replaceChildren(
      ...headers.map((title, i) => {
        const th = element(
            "th",
            LOCKED_COLUMNS.has(i) ? "square-header" : "",
            title,
          ),
          resize = element("span", "resize-handle");
        resize.role = "separator";
        resize.tabIndex = 0;
        resize.setAttribute("aria-label", "Resize " + title);
        let start;
        resize.addEventListener("dblclick", (e) => {
          e.preventDefault();
          this.manualWidths.delete(i);
          this.fitColumns();
          this.api.columns(this.widths, Object.fromEntries(this.manualWidths));
        });
        resize.addEventListener("pointerdown", (e) => {
          start = { x: e.clientX, width: this.widths[i] };
          resize.setPointerCapture(e.pointerId);
        });
        resize.addEventListener("pointermove", (e) => {
          if (!start) return;
          this.manualWidths.set(
            i,
            clamp(start.width + e.clientX - start.x, 45, i === 0 ? 10000 : 500),
          );
          this.layoutColumns();
        });
        const end = () => {
          if (start) {
            start = null;
            this.custom = true;
            this.manualWidths.set(i, this.widths[i]);
            this.api.columns(
              this.widths,
              Object.fromEntries(this.manualWidths),
            );
          }
        };
        resize.addEventListener("pointerup", end);
        resize.addEventListener("pointercancel", end);
        resize.addEventListener("keydown", (e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            this.manualWidths.set(
              i,
              clamp(
                this.widths[i] + (e.key === "ArrowRight" ? 10 : -10),
                45,
                i === 0 ? 10000 : 500,
              ),
            );
            this.layoutColumns();
            this.custom = true;
            this.manualWidths.set(i, this.widths[i]);
            this.api.columns(
              this.widths,
              Object.fromEntries(this.manualWidths),
            );
          }
        });
        if (i === 11) th.classList.add("level-cell");
        if (!LOCKED_COLUMNS.has(i)) th.append(resize);
        return th;
      }),
    );
    this.applyWidths();
  }
  applyWidths() {
    [...this.cols.children].forEach(
      (c, i) => (c.style.width = this.widths[i] + "px"),
    );
    document.getElementById("sample-grid").style.width =
      this.widths.reduce((a, b) => a + b, 0) + "px";
    this.updateHeaderLabels();
  }
  updateHeaderLabels() {
    const context = document.createElement("canvas").getContext("2d");
    [...this.head.children].forEach((th, i) => {
      const long = fullHeaders[i];
      if (!long) return;
      const style = getComputedStyle(th);
      context.font = style.font;
      const padding =
        (parseFloat(style.paddingLeft) || 0) +
        (parseFloat(style.paddingRight) || 0) +
        (parseFloat(style.borderLeftWidth) || 0) +
        (parseFloat(style.borderRightWidth) || 0);
      const needed =
        Math.ceil(context.measureText(long).width) +
        padding +
        (LOCKED_COLUMNS.has(i) ? 0 : 9);
      const expanded = LOCKED_COLUMNS.has(i) || this.expandedHeaders?.has(i);
      th.firstChild.textContent =
        expanded && needed <= this.widths[i] + 0.01 ? long : headers[i];
      th.setAttribute("aria-label", long);
    });
  }
  layoutColumns() {
    if (!this.minimumWidths) return;
    this.widths = this.minimumWidths.map((width, i) =>
      LOCKED_COLUMNS.has(i)
        ? fixedColumnWidth(i)
        : this.manualWidths.has(i)
          ? Math.max(i === 0 ? 116 : 45, this.manualWidths.get(i))
          : width,
    );
    const wrap = document.getElementById("table-wrap"),
      wrapStyle = getComputedStyle(wrap);
    const available =
      wrap.clientWidth -
      (parseFloat(wrapStyle.paddingLeft) || 0) -
      (parseFloat(wrapStyle.paddingRight) || 0);
    this.expandedHeaders = new Set();
    const proposed = this.widths.map((width, i) =>
      LOCKED_COLUMNS.has(i)
        ? width
        : Math.max(width, this.fullHeaderWidths?.[i] ?? 0),
    );
    const fullFits =
      proposed.reduce((sum, width) => sum + width, 0) <= available;
    Object.keys(fullHeaders)
      .map(Number)
      .filter((i) => !LOCKED_COLUMNS.has(i))
      .forEach((i) => {
        if (
          fullFits ||
          (this.manualWidths.has(i) &&
            this.widths[i] >= (this.fullHeaderWidths?.[i] ?? Infinity))
        ) {
          this.expandedHeaders.add(i);
          this.widths[i] = proposed[i];
        }
      });
    const remaining =
      available - this.widths.reduce((sum, width) => sum + width, 0);
    if (remaining > 0) {
      // A user-sized Sample column must not be expanded again by panel fitting.
      // Keep rows panel-wide by assigning spare room to the envelope preview.
      this.widths[this.manualWidths.has(0) ? 1 : 0] += remaining;
    }
    this.applyWidths();
  }
  restoreWidths(widths, manualWidths) {
    this.manualWidths = new Map();
    if (Array.isArray(widths) && [11, 12, 13].includes(widths.length)) {
      this.widths = [
        ...widths.slice(0, headers.length),
        ...baseWidths.slice(widths.length),
      ].map((w, i) => clamp(Number(w) || 80, 45, i === 0 ? 10000 : 500));
      this.custom = true;
      this.manualWidths =
        manualWidths && typeof manualWidths === "object"
          ? new Map(
              Object.entries(manualWidths)
                .filter(
                  ([i]) =>
                    Number(i) < headers.length &&
                    !LOCKED_COLUMNS.has(Number(i)),
                )
                .map(([i, w]) => [
                  Number(i),
                  clamp(Number(w) || 45, 45, Number(i) === 0 ? 10000 : 500),
                ]),
            )
          : new Map();
      this.applyWidths();
    }
  }
  fitColumns() {
    const wrap = document.getElementById("table-wrap");
    const gutter =
      wrap.scrollHeight > wrap.clientHeight + 1
        ? matchMedia("(pointer: coarse)").matches
          ? (10 * 2) / 3 + 1
          : (8 * 2) / 3 + 1
        : 0;
    wrap.style.setProperty("--sample-scroll-gutter", gutter + "px");
    // Measure intrinsic content, never the stretched width of a full-cell control.
    const measure = document.createElement("canvas").getContext("2d");
    const px = (value) => parseFloat(value) || 0;
    const boxWidth = (style) =>
      px(style.paddingLeft) +
      px(style.paddingRight) +
      px(style.borderLeftWidth) +
      px(style.borderRightWidth);
    const textWidth = (node, text) => {
      measure.font = getComputedStyle(node).font;
      return Math.max(
        0,
        ...String(text)
          .split("\n")
          .map((line) => measure.measureText(line).width),
      );
    };
    const textBox = (node) =>
      textWidth(node, node.textContent) + boxWidth(getComputedStyle(node));
    const widths = [...this.head.children].map(
      (th, i) =>
        textWidth(th, headers[i]) +
        boxWidth(getComputedStyle(th)) +
        (LOCKED_COLUMNS.has(i) ? 0 : 9),
    );
    for (const row of this.table.rows) {
      [...row.cells].forEach((cell, i) => {
        let width = boxWidth(getComputedStyle(cell)),
          count = 0;
        const children = cell.firstElementChild?.matches(".sample-cell-content")
          ? cell.firstElementChild.children
          : cell.children;
        for (const child of children) {
          if (child.matches(".custom-select")) continue;
          count++;
          if (child.matches("select")) {
            const button = child.nextElementSibling?.matches(".custom-select")
              ? child.nextElementSibling
              : null;
            const text = child.selectedOptions[0]?.textContent ?? "";
            const label = selectLabel(child, text);
            // Reserve the same 6px breathing room as the custom full-cell selector.
            width += textWidth(button ?? child, label) + 12;
          } else if (child.matches(".row-fixed-controls")) {
            width += 106;
          } else if (child.matches(".sample-name")) {
            width += ROW_SIZE - 1;
          } else if (child.matches(".key-assignment,.pitch-drag")) {
            width += textBox(child);
          } else if (child.matches(".mini-preview")) {
            width += 61;
          } else {
            const style = getComputedStyle(child);
            width += px(style.width) || child.getBoundingClientRect().width;
          }
        }
        if (cell.firstElementChild?.matches(".sample-cell-content"))
          width += Math.max(0, count - 1) * 4;
        if (getComputedStyle(cell).display === "flex")
          width +=
            Math.max(0, count - 1) * px(getComputedStyle(cell).columnGap);
        widths[i] = Math.max(widths[i], width);
      });
    }
    this.fullHeaderWidths = [...this.head.children].map((th, i) =>
      fullHeaders[i]
        ? Math.ceil(
            textWidth(th, fullHeaders[i]) +
              boxWidth(getComputedStyle(th)) +
              (LOCKED_COLUMNS.has(i) ? 0 : 9),
          )
        : 0,
    );
    this.minimumWidths = widths.map((w, i) =>
      LOCKED_COLUMNS.has(i) ? fixedColumnWidth(i) : Math.ceil(w),
    );
    this.layoutColumns();
  }

  render(state, current, learn) {
    const keyColors = createKeyColorMap(current.samples);
    const api = this.api,
      programs = document.getElementById("program-ribbon");
    programs.replaceChildren(
      ...state.programs.map((p) => {
        const b = element(
          "button",
          p === current ? "program active" : "program",
          p.name + (p.dirty ? " *" : ""),
        );
        b.dataset.program = p.id;
        b.addEventListener("click", () => api.program(p.id));
        b.addEventListener("dblclick", () => api.renameProgram(p));
        const tab = element(
          "span",
          "program-tab" + (p === current ? " active" : ""),
        );
        b.setAttribute("aria-pressed", String(p === current));
        const remove = element(
          "button",
          "program-remove" + (p === current ? " active" : ""),
          "×",
        );
        remove.setAttribute("aria-label", "Remove program " + p.name);
        remove.title = "Remove program " + p.name;
        remove.dataset.program = p.id;
        remove.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          api.removeProgram(p.id);
        });
        tab.append(b, remove);
        return tab;
      }),
    );
    const add = element("button", "add-program", "＋");
    add.setAttribute("aria-label", "New program");
    add.onclick = () => api.newProgram();
    programs.append(add);
    const selection = api.selectedIds?.() ?? new Set([current.selected]);
    const multiple = selection.size > 1;
    const selectionMode = api.selectionMode?.() ?? false;
    this.table.classList.toggle("selection-mode", selectionMode);
    const rowSelect = (id, event) =>
      api.rowSelect ? api.rowSelect(id, event) : api.select(id, false);
    const fragment = document.createDocumentFragment();
    for (const s of current.samples) {
      const tr = element("tr", selection.has(s.id) ? "selected" : "");
      tr.dataset.id = s.id;
      tr.tabIndex = -1;
      tr.setAttribute("aria-selected", String(selection.has(s.id)));
      tr.onclick = (e) => rowSelect(s.id, e);
      tr.addEventListener(
        "pointerdown",
        (e) => {
          if (e.selectionReplay) return;
          if (this.deferTouchSelection(e, s.id, selection.has(s.id))) return;
          if (e.target.matches("input.inline-name")) return;
          const modified = e.metaKey || e.ctrlKey || e.shiftKey;
          if (
            modified ||
            ((multiple || selectionMode) &&
              !e.target.closest(".row-handle") &&
              !(selection.has(s.id) && e.target.closest(".row-preview")))
          ) {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.suppressSelectionClick = true;
            rowSelect(s.id, e);
          }
        },
        true,
      );
      tr.addEventListener(
        "click",
        (e) => {
          if (
            (multiple ||
              selectionMode ||
              e.metaKey ||
              e.ctrlKey ||
              e.shiftKey) &&
            !e.target.matches("input.inline-name") &&
            !(selection.has(s.id) && e.target.closest(".row-preview"))
          ) {
            e.preventDefault();
            e.stopImmediatePropagation();
            rowSelect(s.id, e);
          }
        },
        true,
      );
      const cells = headers.map(() => element("td"));
      cells[2].classList.add("select-cell");
      cells[3].classList.add("select-cell");
      cells[4].classList.add("key-cell");
      for (const i of LOCKED_COLUMNS) cells[i].classList.add("square-cell");
      cells[11].classList.add("level-cell");
      tr.append(...cells);
      const channels = element("span", "row-channel-buttons");
      const mute = element(
        "button",
        "row-channel-toggle row-mute" + (s.mute ? " active" : ""),
        "M",
      );
      const solo = element(
        "button",
        "row-channel-toggle row-solo" + (s.solo ? " active" : ""),
        "S",
      );
      mute.setAttribute("aria-label", "Mute " + s.name);
      mute.setAttribute("aria-pressed", String(Boolean(s.mute)));
      solo.setAttribute("aria-label", "Solo " + s.name);
      solo.setAttribute("aria-pressed", String(Boolean(s.solo)));
      mute.disabled = Boolean(s.solo && !s.mute);
      solo.disabled = Boolean(s.mute && !s.solo);
      if (mute.disabled) mute.style.pointerEvents = "none";
      if (solo.disabled) solo.style.pointerEvents = "none";
      mute.onclick = (event) => {
        event.stopPropagation();
        api.edit(s, "mute", !s.mute);
      };
      solo.onclick = (event) => {
        event.stopPropagation();
        api.edit(s, "solo", !s.solo);
      };
      channels.append(mute, solo);
      const led = element("span", "activity");
      led.setAttribute("aria-label", "Sample activity");
      const handle = element("button", "row-handle", "⋮⋮");
      handle.draggable = false;
      handle.onpointerdown = (e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        e.stopPropagation();
        this.finishRowDrag(true);
        const wasSelected = selection.has(s.id);
        this.rowDrag = {
          id: s.id,
          ids: wasSelected
            ? current.samples
                .filter((row) => selection.has(row.id))
                .map((row) => row.id)
            : [s.id],
          wasSelected,
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          x: e.clientX,
          y: e.clientY,
          active: false,
          handle,
        };
        handle.setPointerCapture(e.pointerId);
      };
      handle.title = "Select or drag sample";
      handle.setAttribute("aria-label", "Select " + s.name);
      handle.onclick = (e) => {
        e.stopPropagation();
        rowSelect(s.id, e);
      };
      handle.ondragstart = (e) => {
        this.dragId = s.id;
        this.dragIds = selection.has(s.id)
          ? current.samples
              .filter((row) => selection.has(row.id))
              .map((row) => row.id)
          : [s.id];
        if (!selection.has(s.id)) rowSelect(s.id, e);
        e.dataTransfer.setData("text/plain", JSON.stringify(this.dragIds));
        e.dataTransfer.effectAllowed = "move";
      };
      handle.ondragend = () => {
        this.dragId = null;
        this.dragIds = null;
      };
      const preview = element("button", "row-preview");
      setRowPreviewIcon(preview, Boolean(api.auditioning?.(s.id)));
      preview.setAttribute(
        "aria-label",
        (api.auditioning?.(s.id) ? "Stop preview of " : "Play preview of ") +
          s.name,
      );
      preview.disabled = selection.has(s.id)
        ? !current.samples.some((row) => selection.has(row.id) && row.audio)
        : !s.audio;
      if (preview.disabled) preview.style.pointerEvents = "none";
      preview.onclick = (e) => {
        e.stopPropagation();
        api.previewSample?.(s.id);
      };
      const name = element(
        "button",
        "sample-name",
        s.name + (s.audio ? "" : " · no audio"),
      );
      name.title = "Rename " + s.name;
      name.onclick = (e) => {
        e.stopPropagation();
        if (multiple || selectionMode) {
          rowSelect(s.id, e);
          return;
        }
        api.select(s.id, false);
        const input = element("input", "inline-name");
        input.value = s.name;
        let done = false;
        const finish = (save) => {
          if (done) return;
          done = true;
          if (save && input.value.trim()) api.rename(s, input.value.trim());
          else name.replaceWith(name);
          api.paint();
        };
        input.onkeydown = (ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            finish(true);
          }
          if (ev.key === "Escape") {
            ev.preventDefault();
            ev.stopPropagation();
            finish(false);
          }
        };
        input.onblur = () => finish(true);
        name.replaceWith(input);
        input.focus();
        input.select();
      };
      const fixedControls = element("span", "row-fixed-controls");
      const stripe = element("button", "row-key-colors");
      stripe.style.backgroundImage = keyColors.gradientForSample(s);
      stripe.setAttribute("aria-label", "Choose color for " + s.name);
      stripe.title = "Choose color for " + s.name;
      stripe.onclick = (event) => {
        event.stopPropagation();
        api.sampleColor?.(s);
      };
      fixedControls.append(stripe, channels, led, handle, preview);
      const content = element("span", "sample-cell-content");
      content.append(fixedControls, name);
      cells[0].append(content);
      const env = element("button", "mini-preview");
      env.setAttribute("aria-label", "Edit envelope for " + s.name);
      const a = Math.min(35, s.attack_ms / 25),
        d = Math.min(35, s.decay_ms / 25);
      env.innerHTML = `<svg viewBox="0 0 64 28" aria-hidden="true"><path d="M2 25 L${3 + a} 4 L${60 - d} 4 L62 25"/></svg>`;
      env.onclick = (e) => {
        e.stopPropagation();
        api.open("envelope", s);
      };
      cells[1].append(env);
      const parts = playbackParts(s.playback);
      for (const [i, values, value] of [
        [2, ["One-shot", "Hold", "Loop"], parts.trigger],
        [
          3,
          s.root_note != null ? ["Mono", "Key Mono", "Poly"] : ["Mono", "Poly"],
          parts.overlap === "Key Mono" && s.root_note == null
            ? "Mono"
            : parts.overlap,
        ],
      ]) {
        const select = element("select");
        if (i === 3) select.dataset.twoLineKeyMono = "true";
        if (i === 2) select.dataset.twoLineOneShot = "true";
        select.setAttribute(
          "aria-label",
          (i === 2 ? "Trigger" : "Overlap") + " for " + s.name,
        );
        for (const v of values) {
          const o = element("option", "", v);
          o.value = v;
          select.append(o);
        }
        select.value = value;
        select.onclick = (e) => e.stopPropagation();
        select.onchange = () => {
          api.select(s.id, false);
          const t = cells[2].querySelector("select").value,
            o = cells[3].querySelector("select").value;
          api.edit(s, "playback", playbackMode(t, o));
        };
        cells[i].append(select);
      }
      const note = element(
        "button",
        "key-assignment",
        learn?.id === s.id
          ? "Press a key…"
          : s.root_note != null
            ? `${noteName(s.low_note)}:${noteName(s.high_note)}\nr${noteName(s.root_note)}`
            : s.key == null
              ? "None"
              : `${s.key} · ${noteName(s.key)}`,
      );
      note.onclick = (e) => {
        e.stopPropagation();
        api.select(s.id, false);
        api.learn(s);
      };
      cells[4].append(note);
      cells[11].append(this.knob(s, "level", "Level"));
      const max = element("input");
      max.type = "checkbox";
      max.checked = s.max_velocity;
      max.setAttribute("aria-label", "Max velocity for " + s.name);
      max.onclick = (e) => e.stopPropagation();
      max.onchange = () => api.edit(s, "max_velocity", max.checked);
      cells[5].append(max);
      const pitch = element(
        "button",
        "pitch-drag",
        `${s.semitone >= 0 ? "+" : ""}${s.semitone}/${s.fine >= 0 ? "+" : ""}${s.fine}`,
      );
      pitch.setAttribute("aria-label", "Pitch for " + s.name);
      let pd;
      pitch.onpointerdown = (e) => {
        e.stopPropagation();
        api.select(s.id, false);
        pd = { y: e.clientY, value: s.semitone * 100 + s.fine, moved: false };
        pitch.setPointerCapture(e.pointerId);
      };
      pitch.onpointermove = (e) => {
        if (!pd) return;
        if (Math.abs(e.clientY - pd.y) > 4) pd.moved = true;
        if (pd.moved) {
          const cents = clamp(pd.value + (pd.y - e.clientY) * 10, -4900, 4900),
            v = cents / 100,
            lo = Math.floor(v),
            f = v - lo,
            rounded = f === 0.5 ? (lo % 2 === 0 ? lo : lo + 1) : Math.round(v);
          s.semitone = clamp(rounded, -48, 48);
          s.fine = Math.round(cents - s.semitone * 100);
          pitch.textContent = `${s.semitone >= 0 ? "+" : ""}${s.semitone}/${s.fine >= 0 ? "+" : ""}${s.fine}`;
          this.fitColumns();
          api.live(s);
        }
      };
      pitch.onpointerup = (e) => {
        e.stopPropagation();
        const moved = pd?.moved;
        pd = null;
        if (moved) api.finish(s);
        else api.open("pitch", s);
      };
      pitch.onpointercancel = () => {
        pd = null;
        api.finish(s);
      };
      pitch.onclick = (e) => e.stopPropagation();
      cells[6].append(pitch);
      const filter = element("button", "mini-preview");
      filter.setAttribute("aria-label", "Edit filter for " + s.name);
      const enabled = s.lpf_cutoff != null,
        x = enabled
          ? clamp(
              8 + (Math.log(s.lpf_cutoff / 20) / Math.log(21950 / 20)) * 42,
              8,
              50,
            )
          : 60;
      filter.innerHTML = `<svg viewBox="0 0 64 28" aria-hidden="true"><path d="${!enabled ? "M2 14 L62 14" : s.filter_mode === "HPF" ? `M2 25 L${x} 6 L62 6` : `M2 6 L${x} 6 L62 25`}"/></svg>`;
      filter.onclick = (e) => {
        e.stopPropagation();
        api.open("filter", s);
      };
      cells[7].append(filter);
      cells[8].append(this.knob(s, "fx1", "FX1"));
      cells[9].append(this.knob(s, "fx2", "FX2"));
      cells[10].append(this.knob(s, "pan", "Pan"));
      tr.ondragover = (e) => {
        if (this.dragId) e.preventDefault();
      };
      tr.ondrop = (e) => {
        if (this.dragId) {
          e.preventDefault();
          e.stopPropagation();
          api.reorder(
            this.dragIds ?? [this.dragId],
            s.id,
            e.clientY >
              tr.getBoundingClientRect().top +
                tr.getBoundingClientRect().height / 2,
          );
        }
      };
      if (multiple || selectionMode) {
        for (const control of tr.querySelectorAll("button,input,select")) {
          if (control !== handle && control !== name && control !== preview) {
            control.disabled = true;
            control.style.pointerEvents = "none";
          }
        }
        name.setAttribute("aria-label", "Select " + s.name);
        name.title = "Select sample";
      }
      tr.addEventListener("contextmenu", (event) => {
        if (this.touchSelection || selectionMode) event.preventDefault();
      });
      fragment.append(tr);
    }
    this.table.replaceChildren(fragment);
    const table = this.table.closest("table");
    const footer = table.tFoot ?? table.createTFoot();
    const addRow = element("tr", "add-sample-row");
    const addCell = element("td");
    addCell.colSpan = headers.length;
    const addSample = element("button", "add-sample-button", "+");
    addSample.setAttribute("aria-label", "New sample");
    addSample.title = "New sample";
    addSample.disabled = multiple || selectionMode;
    addSample.onclick = () => api.newSample();
    const actions = element("span", "sample-row-actions");
    const removeSamples = element("button", "remove-sample-button", "−");
    removeSamples.setAttribute("aria-label", "Remove selected samples");
    removeSamples.title =
      "Click, then confirm Sure? to remove selected samples";
    removeSamples.disabled = selection.size === 0;
    removeSamples.hidden = current.samples.length === 0;
    this.removeArmed = false;
    removeSamples.onclick = (e) => {
      e.stopPropagation();
      if (this.removeArmed) {
        this.resetRemoveConfirmation();
        api.deleteSelection?.();
      } else {
        this.removeArmed = true;
        removeSamples.textContent = "Sure?";
        removeSamples.classList.add("confirm-delete");
        removeSamples.setAttribute(
          "aria-label",
          "Confirm remove selected samples",
        );
      }
    };
    actions.append(addSample, removeSamples);
    addCell.append(actions);
    addRow.append(addCell);
    footer.replaceChildren(addRow);
    this.fitColumns();
    document.getElementById("sample-count").textContent =
      current.samples.length;
  }
  knob(s, key, label) {
    const api = this.api,
      el = element("button", "knob" + (key === "pan" ? " pan-knob" : ""));
    const min = key === "pan" ? -1 : 0,
      max = 1,
      span = max - min;
    if (key === "pan" && s.pan == null) s.pan = 0;
    el.setAttribute("role", "slider");
    el.setAttribute("aria-label", label + " for " + s.name);
    el.setAttribute("aria-valuemin", String(min * 100));
    el.setAttribute("aria-valuemax", "100");
    el.title = "Drag vertically or use arrow keys";
    const dial = element("span", "dial"),
      read = element("span", "knob-value");
    el.append(dial, read);
    const update = () => {
      el.style.setProperty(
        "--angle",
        -135 + ((s[key] - min) / span) * 270 + "deg",
      );
      read.textContent =
        key === "pan"
          ? Math.abs(s.pan) < 0.005
            ? "C"
            : (s.pan < 0 ? "L" : "R") + Math.round(Math.abs(s.pan) * 100)
          : Math.round(s[key] * 100);
      el.setAttribute(
        "aria-valuetext",
        key === "pan"
          ? Math.abs(s.pan) < 0.005
            ? "Center"
            : Math.round(Math.abs(s.pan) * 100) +
              "% " +
              (s.pan < 0 ? "left" : "right")
          : String(Math.round(s[key] * 100)),
      );
      el.setAttribute("aria-valuenow", String(Math.round(s[key] * 100)));
    };
    update();
    let drag;
    el.onpointerdown = (e) => {
      e.stopPropagation();
      api.select(s.id, false);
      drag = { y: e.clientY, value: s[key], moved: false };
      el.setPointerCapture(e.pointerId);
    };
    el.onpointermove = (e) => {
      if (!drag) return;
      if (Math.abs(e.clientY - drag.y) > 3) drag.moved = true;
      if (!drag.moved) return;
      s[key] = clamp(
        drag.value + ((drag.y - e.clientY) / 150) * span,
        min,
        max,
      );
      update();
      api.live(s);
    };
    el.onpointerup = (e) => {
      e.stopPropagation();
      const moved = drag?.moved;
      drag = null;
      if (moved) api.finish(s);
      else api.openValue?.(s, key);
    };
    el.onpointercancel = () => {
      const moved = drag?.moved;
      drag = null;
      if (moved) api.finish(s);
    };
    el.onclick = (e) => e.stopPropagation();
    el.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) api.openValue?.(s, key);
        return;
      }
      if (
        ![
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "Home",
          "End",
        ].includes(e.key)
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      s[key] =
        e.key === "Home"
          ? min
          : e.key === "End"
            ? max
            : clamp(
                s[key] +
                  (["ArrowUp", "ArrowRight"].includes(e.key) ? 0.01 : -0.01),
                min,
                max,
              );
      update();
      api.live(s);
      api.finish(s);
    };
    return el;
  }
  pianoRender(state, current) {
    const keyColors = createKeyColorMap(current.samples);
    const pcSource = state.source === "PC Keyboard";
    const start = 0,
      end = 127,
      whites = [];
    for (let n = 0; n <= 127; n++)
      if (![1, 3, 6, 8, 10].includes(n % 12)) whites.push(n);
    const width =
      (this.keyboardScroll.clientWidth / whites.length) * this.keyboardZoom;
    this.piano.style.width = whites.length * width + "px";
    this.piano.replaceChildren();
    const pc = new Set(
      Object.values({
        a: 60,
        w: 61,
        s: 62,
        e: 63,
        d: 64,
        f: 65,
        t: 66,
        g: 67,
        z: 68,
        h: 69,
        u: 70,
        j: 71,
        k: 72,
        o: 73,
        l: 74,
      }).map((n) => n + state.octave * 12),
    );
    for (let n = 0; n <= 127; n++) {
      const black = [1, 3, 6, 8, 10].includes(n % 12),
        button = element(
          "button",
          "piano-key" +
            (black ? " black" : "") +
            (current.samples.some((s) => assigned(s, n)) ? " assigned" : "") +
            (pcSource && !pc.has(n) ? " dim" : ""),
          !black && n % 12 === 0 ? noteName(n) : "",
        );
      const noteColors = keyColors.colorsForNote(n);
      if (noteColors.length) {
        const bands = element("span", "piano-key-colors");
        bands.setAttribute("aria-hidden", "true");
        for (const color of noteColors) {
          const band = element("span");
          band.style.backgroundColor = color;
          bands.append(band);
        }
        button.append(bands);
      }
      button.dataset.note = n;
      button.setAttribute("aria-label", `${n} · ${noteName(n)}`);
      button.style.width = (black ? width * 0.64 : width) + "px";
      button.style.left =
        (black
          ? whites.filter((v) => v < n).length * width - width * 0.32
          : whites.indexOf(n) * width) + "px";
      button.onpointerdown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        button.setPointerCapture(e.pointerId);
        if (
          e.pointerType === "touch" &&
          (this.api.isLearning?.() ??
            document.body.classList.contains("note-learning"))
        ) {
          this.learningPianoTap = {
            id: e.pointerId,
            note: n,
            x: e.clientX,
            y: e.clientY,
          };
        } else this.api.pointerOn(e.pointerId, n);
      };
      for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
        button.addEventListener(type, (e) => {
          e.stopPropagation();
          const pendingTap = this.learningPianoTap;
          if (pendingTap?.id === e.pointerId) {
            this.learningPianoTap = null;
            if (
              e.type === "pointerup" &&
              Math.hypot(e.clientX - pendingTap.x, e.clientY - pendingTap.y) <=
                8 &&
              (this.api.isLearning?.() ??
                document.body.classList.contains("note-learning"))
            )
              this.api.pointerOn(e.pointerId, pendingTap.note);
          }
          this.api.pointerOff(e.pointerId);
        });
      button.onkeydown = (e) => {
        if (["Enter", " "].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          if (!e.repeat) this.api.screenOn(n);
        }
      };
      button.onkeyup = (e) => {
        if (["Enter", " "].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          this.api.screenOff(n);
        }
      };
      this.piano.append(button);
    }
    this.applyPianoZoom();
    document.getElementById("octave-label").hidden = !pcSource;
    document.getElementById("octave-label").textContent =
      `PC keyboard: ${noteName(Math.max(0, 60 + state.octave * 12))}–${noteName(Math.min(127, 74 + state.octave * 12))}`;
    for (const id of ["octave-down", "octave-up"])
      document.getElementById(id).hidden = !pcSource;
    document.getElementById("octave-down").disabled = state.octave <= -5;
    document.getElementById("octave-up").disabled = state.octave >= 5;
  }
}
