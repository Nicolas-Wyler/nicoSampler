import test from "node:test";
import assert from "node:assert/strict";
import { RowSelection } from "../src/selection.js";
test("explicit selection stays active through zero, one and multiple rows until Done", () => {
  const selection = new RowSelection();
  const p = { id: "p", selected: "a", samples: [{ id: "a" }, { id: "b" }] };
  selection.reconcile(p);
  selection.enter("a", true);
  for (const id of ["a", "b", "a", "b"]) {
    selection.toggle(id);
    p.selected = [...selection.ids].at(-1) ?? null;
    selection.reconcile(p);
    assert.equal(selection.mode, true);
  }
  selection.select(p.selected);
  assert.equal(selection.mode, false);
});
test("switching programs exits explicit selection and uses the new primary row", () => {
  const selection = new RowSelection();
  selection.reconcile({ id: "p", selected: "a", samples: [{ id: "a" }] });
  selection.enter("a", true);
  selection.reconcile({ id: "q", selected: "b", samples: [{ id: "b" }] });
  assert.equal(selection.mode, false);
  assert.equal(selection.explicitMode, false);
  assert.deepEqual([...selection.ids], ["b"]);
});
