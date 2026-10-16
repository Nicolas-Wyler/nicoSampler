/** Ordered, anchored desktop table selection; UI state only. */
export class RowSelection {
  constructor() {
    this.ids = new Set();
    this.anchor = null;
    this.program = null;
    this.mode = false;
    this.modeHadMultiple = false;
    this.allowEmpty = false;
    this.primary = null;
  }
  reconcile(program) {
    if (this.program !== program.id) {
      this.program = program.id;
      this.mode = false;
      this.modeHadMultiple = false;
      this.allowEmpty = false;
      this.primary = program.selected ?? null;
      this.ids = new Set(program.selected ? [program.selected] : []);
      this.anchor = program.selected ?? null;
    }
    if (
      !this.mode &&
      program.selected &&
      !this.ids.has(program.selected) &&
      (!this.allowEmpty || program.selected !== this.primary)
    ) {
      this.allowEmpty = false;
      this.ids = new Set([program.selected]);
      this.anchor = program.selected;
    }
    const valid = new Set(program.samples.map((s) => s.id));
    this.ids = new Set([...this.ids].filter((id) => valid.has(id)));
    if (!this.mode && !this.allowEmpty && !this.ids.size && valid.size)
      this.ids.add(
        valid.has(program.selected) ? program.selected : program.samples[0].id,
      );
    if (!valid.has(this.anchor)) this.anchor = [...this.ids][0] ?? null;
    this.settleMode();
    this.primary = program.selected ?? null;
    return this.ids;
  }
  settleMode() {
    if (!this.mode) return;
    if (this.ids.size > 1) this.modeHadMultiple = true;
    if (!this.ids.size || (this.modeHadMultiple && this.ids.size <= 1)) {
      this.mode = false;
      this.allowEmpty = !this.ids.size;
    }
  }
  select(id) {
    this.mode = false;
    this.modeHadMultiple = false;
    this.allowEmpty = !id;
    this.primary = id ?? null;
    this.ids = new Set(id ? [id] : []);
    this.anchor = id;
    return this.ids;
  }
  enter(id) {
    this.select(id);
    this.mode = true;
    return this.ids;
  }
  toggle(id) {
    if (this.ids.has(id)) this.ids.delete(id);
    else this.ids.add(id);
    this.anchor = id;
    this.settleMode();
    return this.ids;
  }
  click(id, event, order) {
    if (event.shiftKey && this.anchor && order.includes(this.anchor)) {
      const a = order.indexOf(this.anchor),
        b = order.indexOf(id);
      const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
      this.ids =
        event.metaKey || event.ctrlKey
          ? new Set([...this.ids, ...range])
          : new Set(range);
    } else if (event.metaKey || event.ctrlKey) {
      if (this.ids.has(id)) {
        if (this.ids.size > 1) this.ids.delete(id);
      } else this.ids.add(id);
      this.anchor = id;
    } else this.select(id);
    this.settleMode();
    return this.ids;
  }
}
/** Move a discontiguous selection as one stable block, without mutating input. */
export function moveRows(rows, ids, targetId, after = false) {
  const chosen = new Set(ids),
    block = rows.filter((row) => chosen.has(row.id));
  if (!block.length || chosen.has(targetId)) return [...rows];
  const rest = rows.filter((row) => !chosen.has(row.id));
  const target = rest.findIndex((row) => row.id === targetId);
  if (target < 0) return [...rows];
  rest.splice(target + (after ? 1 : 0), 0, ...block);
  return rest;
}
