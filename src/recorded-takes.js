import { RATE } from "./model.js";
import { RowSelection } from "./selection.js";
import { setRowPreviewIcon } from "./classic-ui.js";
export class RecordedTakesTable {
  constructor(body, api) {
    this.body = body;
    this.api = api;
    this.selection = new RowSelection();
    this.confirm = null;
    document.addEventListener("pointerdown", (e) => {
      if (
        api.open() &&
        !e.target.closest("#recorded-takes-table") &&
        !e.target.closest("#take-use,#takes-select") &&
        (this.selection.mode || this.selection.ids.size > 1)
      ) {
        this.selection.select(this.primary);
        this.render();
      }
    });
  }
  selected() {
    return this.entries().filter((t) => this.selection.ids.has(t.id));
  }
  entries() {
    return this.api.entries();
  }
  select(id, e = {}) {
    if (this.selection.mode && !e.metaKey && !e.ctrlKey && !e.shiftKey)
      this.selection.toggle(id);
    else
      this.selection.click(
        id,
        e,
        this.entries().map((t) => t.id),
      );
    this.primary = this.selection.ids.has(id)
      ? id
      : ([...this.selection.ids].at(-1) ?? null);
    this.confirm = null;
    this.render();
  }
  collapse() {
    this.selection.select(this.primary);
    this.render();
  }
  render() {
    const selectButton = document.getElementById("takes-select");
    if (selectButton) {
      selectButton.hidden = !/iPhone|iPod|Android.*Mobile/i.test(
        navigator.userAgent,
      );
      selectButton.textContent = this.selection.mode ? "Done" : "Select";
      selectButton.disabled = this.api.locked();
      selectButton.setAttribute("aria-pressed", String(this.selection.mode));
    }
    const entries = this.entries();
    this.selection.reconcile({
      id: "recorded-takes",
      samples: entries,
      selected: this.primary,
    });
    this.primary = [...this.selection.ids].at(-1) ?? null;
    const rows = entries.map((t) => {
      const tr = document.createElement("tr");
      tr.dataset.takeId = t.id;
      tr.classList.toggle("selected", this.selection.ids.has(t.id));
      tr.setAttribute("aria-selected", String(this.selection.ids.has(t.id)));
      tr.onclick = (e) => {
        if (!this.api.locked()) this.select(t.id, e);
      };
      const cell = () => {
        const td = document.createElement("td");
        tr.append(td);
        return td;
      };
      const play = document.createElement("button");
      play.type = "button";
      play.className = "row-preview take-play";
      setRowPreviewIcon(play, this.api.playing(t.id));
      play.setAttribute(
        "aria-label",
        `${this.api.playing(t.id) ? "Stop" : "Play"} ${t.name}`,
      );
      play.disabled = this.api.locked();
      play.onclick = (e) => {
        e.stopPropagation();
        if (e.metaKey || e.ctrlKey || e.shiftKey) {
          this.select(t.id, e);
          return;
        }
        if (!this.selection.ids.has(t.id)) {
          this.selection.select(t.id);
          this.primary = t.id;
        }
        this.api.play(this.selected());
      };
      cell().append(play);
      const name = document.createElement("button");
      name.type = "button";
      name.className = "take-name";
      name.textContent = t.name;
      name.title = "Rename " + t.name;
      name.disabled = this.api.locked();
      name.onclick = (e) => {
        e.stopPropagation();
        if (this.selection.mode || e.metaKey || e.ctrlKey || e.shiftKey) {
          this.select(t.id, e);
          return;
        }
        this.selection.select(t.id);
        this.primary = t.id;
        this.render();
        const current = this.body.querySelector(
          `[data-take-id="${t.id}"] .take-name`,
        );
        const input = document.createElement("input");
        input.type = "text";
        input.value = t.name;
        input.setAttribute("aria-label", "Recording name");
        let done = false;
        const finish = (save) => {
          if (done) return;
          done = true;
          const value = input.value.trim();
          if (save && value) this.api.rename(t, value.slice(0, 200));
          this.render();
        };
        input.onkeydown = (e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            finish(true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            finish(false);
          }
        };
        input.onblur = () => finish(true);
        current.replaceWith(input);
        input.focus();
        input.select();
      };
      cell().append(name);
      cell().textContent = (t.audio[0].length / RATE).toFixed(2) + " s";
      cell().textContent =
        (t.recording_format?.sample_rate ?? 44100) / 1000 + " kHz";
      cell().textContent = (t.recording_format?.bit_depth ?? 32) + "-bit";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "row-delete take-delete";
      remove.disabled = this.api.locked();
      remove.setAttribute("aria-label", "Delete " + t.name);
      if (this.confirm === t.id) {
        remove.textContent = "Sure?";
        remove.classList.add("confirm-delete");
      } else
        remove.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 10v7M14 10v7"/></svg>';
      remove.onclick = (e) => {
        e.stopPropagation();
        if (this.confirm === t.id) {
          this.confirm = null;
          this.api.remove(t);
          this.render();
        } else {
          this.confirm = t.id;
          this.render();
        }
      };
      cell().append(remove);
      return tr;
    });
    if (!entries.length) {
      const tr = document.createElement("tr"),
        td = document.createElement("td");
      td.colSpan = 6;
      td.textContent = "No recorded takes yet.";
      tr.append(td);
      rows.push(tr);
    }
    this.body.classList.toggle("selection-mode", this.selection.mode);
    this.body.replaceChildren(...rows);
    this.api.selectionChanged?.(this.selected());
  }
  updatePlayback() {
    for (const tr of this.body.querySelectorAll("[data-take-id]")) {
      const t = this.entries().find((t) => t.id === tr.dataset.takeId);
      if (!t) continue;
      const b = tr.querySelector(".take-play");
      setRowPreviewIcon(b, this.api.playing(t.id));
      b.setAttribute(
        "aria-label",
        `${this.api.playing(t.id) ? "Stop" : "Play"} ${t.name}`,
      );
    }
  }
}
