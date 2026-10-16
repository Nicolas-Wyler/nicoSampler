/** Program ordering is explicit: dragging the left grip never activates a tab. */
export function installProgramDragging(onReorder) {
  const ribbon = document.getElementById("program-ribbon");
  if (!ribbon) return () => {};
  const marker = document.createElement("div");
  marker.className = "program-insertion-marker";
  marker.hidden = true;
  document.body.append(marker);
  let drag = null,
    frame = 0;
  const idOf = (tab) => tab?.querySelector(".program")?.dataset.program;
  const tabs = () => [...ribbon.querySelectorAll(".program-tab")];
  function enhance() {
    for (const tab of tabs()) {
      if (tab.querySelector(".program-handle")) continue;
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "program-handle";
      handle.textContent = "⠿";
      handle.setAttribute(
        "aria-label",
        "Reorder " +
          (tab.querySelector(".program")?.textContent.replace(/^● /, "") ??
            "program"),
      );
      handle.title = "Drag to reorder program";
      tab.prepend(handle);
    }
  }
  function destination(x) {
    const candidates = tabs().filter((tab) => idOf(tab) !== drag?.id);
    if (!candidates.length) return null;
    for (const tab of candidates) {
      const r = tab.getBoundingClientRect();
      if (x < r.x + r.width / 2) return { tab, id: idOf(tab), after: false };
    }
    const tab = candidates.at(-1);
    return { tab, id: idOf(tab), after: true };
  }
  function paintMarker() {
    if (!drag?.moving) return;
    const target = destination(drag.x),
      ribbonRect = ribbon.getBoundingClientRect();
    drag.target = target;
    if (!target) {
      marker.hidden = true;
      return;
    }
    const rect = target.tab.getBoundingClientRect(),
      x = target.after ? rect.right : rect.left;
    marker.hidden = x < ribbonRect.left || x > ribbonRect.right;
    marker.style.left = x - 1 + "px";
    marker.style.top = ribbonRect.top + "px";
    marker.style.height = ribbonRect.height + "px";
  }
  function scroll() {
    if (!drag?.moving) {
      frame = 0;
      return;
    }
    const rect = ribbon.getBoundingClientRect(),
      edge = 36;
    let delta = 0;
    if (drag.x < rect.left + edge)
      delta = -Math.min(12, (rect.left + edge - drag.x) / 3);
    else if (drag.x > rect.right - edge)
      delta = Math.min(12, (drag.x - rect.right + edge) / 3);
    if (delta) ribbon.scrollLeft += delta;
    paintMarker();
    frame = requestAnimationFrame(scroll);
  }
  function clear() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    marker.hidden = true;
    for (const tab of tabs()) tab.classList.remove("program-dragging");
    drag = null;
  }
  function down(e) {
    const handle = e.target.closest(".program-handle");
    if (!handle || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const tab = handle.closest(".program-tab");
    drag = {
      id: idOf(tab),
      pointer: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      moving: false,
      target: null,
    };
    handle.focus({ preventScroll: true });
    handle.setPointerCapture(e.pointerId);
  }
  function move(e) {
    if (!drag || e.pointerId !== drag.pointer) return;
    e.preventDefault();
    drag.x = e.clientX;
    if (
      !drag.moving &&
      Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 5
    ) {
      drag.moving = true;
      tabs()
        .find((t) => idOf(t) === drag.id)
        ?.classList.add("program-dragging");
      frame = requestAnimationFrame(scroll);
    }
    paintMarker();
  }
  function up(e) {
    if (!drag || e.pointerId !== drag.pointer) return;
    e.preventDefault();
    e.stopPropagation();
    const completed = drag.moving ? { id: drag.id, target: drag.target } : null;
    clear();
    if (completed?.target)
      onReorder(completed.id, completed.target.id, completed.target.after);
  }
  function cancel(e) {
    if (drag && (!e.pointerId || e.pointerId === drag.pointer)) clear();
  }
  function click(e) {
    if (e.target.closest(".program-handle")) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }
  function key(e) {
    if (e.key === "Escape" && drag) {
      e.preventDefault();
      e.stopImmediatePropagation();
      clear();
      return;
    }
    const handle = e.target.closest?.(".program-handle");
    if (!handle || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
      return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const list = tabs(),
      tab = handle.closest(".program-tab"),
      index = list.indexOf(tab),
      target =
        e.key === "Home"
          ? list[0]
          : e.key === "End"
            ? list.at(-1)
            : list[index + (e.key === "ArrowRight" ? 1 : -1)];
    if (target && target !== tab)
      onReorder(
        idOf(tab),
        idOf(target),
        e.key === "End" || e.key === "ArrowRight",
      );
  }
  ribbon.addEventListener("pointerdown", down, true);
  ribbon.addEventListener("click", click, true);
  document.addEventListener("pointermove", move, {
    capture: true,
    passive: false,
  });
  document.addEventListener("pointerup", up, true);
  document.addEventListener("pointercancel", cancel, true);
  window.addEventListener("keydown", key, true);
  const observer = new MutationObserver(enhance);
  observer.observe(ribbon, { childList: true, subtree: true });
  enhance();
  return () => {
    clear();
    observer.disconnect();
    marker.remove();
    ribbon.removeEventListener("pointerdown", down, true);
    ribbon.removeEventListener("click", click, true);
    document.removeEventListener("pointermove", move, true);
    document.removeEventListener("pointerup", up, true);
    document.removeEventListener("pointercancel", cancel, true);
    window.removeEventListener("keydown", key, true);
  };
}
