// DOM-backed controls keep the ordinary form values as the source of truth.
const selects = new Map(),
  rotaries = new Map(),
  scrolls = new Map();
let activeMenu = null,
  scheduled = false;
function closeMenu() {
  if (activeMenu) {
    const { menu, button } = activeMenu;
    if (menu.matches(":popover-open")) menu.hidePopover();
    menu.remove();
    button.setAttribute("aria-expanded", "false");
    activeMenu = null;
  }
}
export function selectLabel(select, text) {
  if (select.dataset.twoLineKeyMono && text === "Key Mono") return "Key\nMono";
  if (select.dataset.twoLineOneShot && text === "One-shot") return "One-\nshot";
  return (select.dataset.displayPrefix ?? "") + text;
}

function enhanceSelect(select) {
  if (selects.has(select)) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "custom-select";
  if (select.dataset.twoLineKeyMono || select.dataset.twoLineOneShot)
    button.classList.add("two-line-label");
  button.setAttribute("role", "combobox");
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");
  select.classList.add("control-source");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");
  select.after(button);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (activeMenu?.button === button) {
      closeMenu();
      return;
    }
    closeMenu();
    const menu = document.createElement("div");
    menu.className = "custom-options";
    menu.setAttribute("role", "listbox");
    menu.setAttribute("popover", "manual");
    menu.setAttribute("aria-label", button.getAttribute("aria-label"));
    [...select.options].forEach((option) => {
      if (option.hidden) return;
      const item = document.createElement("button");
      item.type = "button";
      item.className = "custom-option";
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(option.selected));
      item.textContent = option.text;
      item.disabled = option.disabled;
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        closeMenu();
        syncControls();
        button.focus();
      });
      menu.append(item);
    });
    (select.closest("dialog") ?? document.body).append(menu);
    activeMenu = { menu, button };
    button.setAttribute("aria-expanded", "true");
    if (menu.showPopover) menu.showPopover();
    const rect = button.getBoundingClientRect();
    const width = Math.min(
      Math.max(rect.width, menu.scrollWidth + 4),
      innerWidth - 16,
    );
    menu.style.width = width + "px";
    menu.style.left =
      Math.max(8, Math.min(rect.left, innerWidth - width - 8)) + "px";
    const height = Math.min(menu.scrollHeight, 240, innerHeight - 20);
    menu.style.maxHeight = height + "px";
    menu.style.top =
      (rect.bottom + height < innerHeight - 8
        ? rect.bottom + 3
        : Math.max(8, rect.top - height - 3)) + "px";
    (
      menu.querySelector('[aria-selected="true"]') ??
      menu.querySelector("button")
    )?.focus();
  });
  button.addEventListener("keydown", (e) => {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      const enabled = [...select.options].filter(
        (o) => !o.disabled && !o.hidden,
      );
      let i = enabled.indexOf(select.selectedOptions[0]);
      i =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? enabled.length - 1
            : Math.max(
                0,
                Math.min(
                  enabled.length - 1,
                  i + (e.key === "ArrowDown" ? 1 : -1),
                ),
              );
      if (enabled[i]) {
        select.value = enabled[i].value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        syncControls();
      }
    }
  });
  select.addEventListener("change", syncControls);
  selects.set(select, button);
}
function enhanceRotary(input) {
  if (rotaries.has(input)) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "effect-knob";
  button.setAttribute("role", "slider");
  button.setAttribute("aria-label", input.dataset.rotary);
  button.innerHTML =
    '<span class="effect-dial"></span><span class="effect-value"></span>';
  input.classList.add("control-source");
  input.tabIndex = -1;
  input.setAttribute("aria-hidden", "true");
  input.after(button);
  const min = Number(input.min),
    max = Number(input.max),
    step = Number(input.step);
  function set(value, final = false) {
    input.value = String(
      Math.max(min, Math.min(max, Math.round(value / step) * step)),
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
    if (final) input.dispatchEvent(new Event("change", { bubbles: true }));
    syncControls();
  }
  button.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    button.focus();
    button.setPointerCapture(e.pointerId);
    const y = e.clientY,
      start = Number(input.value);
    const move = (ev) => set(start + ((y - ev.clientY) * (max - min)) / 160);
    const done = () => {
      button.removeEventListener("pointermove", move);
      button.removeEventListener("pointerup", done);
      button.removeEventListener("pointercancel", done);
      set(Number(input.value), true);
    };
    button.addEventListener("pointermove", move);
    button.addEventListener("pointerup", done);
    button.addEventListener("pointercancel", done);
  });
  button.addEventListener("keydown", (e) => {
    if (
      [
        "ArrowUp",
        "ArrowRight",
        "ArrowDown",
        "ArrowLeft",
        "Home",
        "End",
      ].includes(e.key)
    ) {
      e.preventDefault();
      e.stopPropagation();
      set(
        e.key === "Home"
          ? min
          : e.key === "End"
            ? max
            : Number(input.value) +
              (["ArrowUp", "ArrowRight"].includes(e.key) ? step : -step) *
                (e.shiftKey ? 10 : 1),
        true,
      );
    }
  });
  rotaries.set(input, button);
}
function enhanceScroll(element) {
  if (scrolls.has(element)) return;
  const autoHide = element.id === "program-ribbon";
  let activityTimer = null,
    dragging = 0;
  function reveal() {
    if (!autoHide) return;
    clearTimeout(activityTimer);
    for (const { track } of tracks) track.classList.add("is-scrolling");
    if (!dragging)
      activityTimer = setTimeout(() => {
        for (const { track } of tracks) track.classList.remove("is-scrolling");
      }, 700);
  }
  const tracks = ["x", "y"].map((axis) => {
    const track = document.createElement("div");
    track.className =
      "custom-scrollbar " + axis + (autoHide ? " program-scrollbar" : "");
    const thumb = document.createElement("div");
    thumb.className = "custom-scroll-thumb";
    track.append(thumb);
    document.body.append(track);
    thumb.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      dragging++;
      reveal();
      thumb.setPointerCapture(e.pointerId);
      const start = axis === "x" ? e.clientX : e.clientY,
        offset = axis === "x" ? element.scrollLeft : element.scrollTop;
      const extent = axis === "x" ? element.scrollWidth : element.scrollHeight,
        visible = axis === "x" ? element.clientWidth : element.clientHeight;
      const trackSize = axis === "x" ? track.clientWidth : track.clientHeight;
      const thumbSize = axis === "x" ? thumb.clientWidth : thumb.clientHeight;
      const move = (ev) => {
        const delta = (axis === "x" ? ev.clientX : ev.clientY) - start;
        element[axis === "x" ? "scrollLeft" : "scrollTop"] =
          offset +
          (delta * (extent - visible)) / Math.max(1, trackSize - thumbSize);
      };
      const done = () => {
        dragging = Math.max(0, dragging - 1);
        reveal();
        thumb.removeEventListener("pointermove", move);
        thumb.removeEventListener("pointerup", done);
        thumb.removeEventListener("pointercancel", done);
      };
      thumb.addEventListener("pointermove", move);
      thumb.addEventListener("pointerup", done);
      thumb.addEventListener("pointercancel", done);
    });
    track.addEventListener("pointerdown", (e) => {
      if (e.target !== track) return;
      reveal();
      const r = track.getBoundingClientRect(),
        position = axis === "x" ? e.clientX - r.left : e.clientY - r.top,
        range = axis === "x" ? track.clientWidth : track.clientHeight;
      element[axis === "x" ? "scrollLeft" : "scrollTop"] =
        (position / range) *
          (axis === "x" ? element.scrollWidth : element.scrollHeight) -
        (axis === "x" ? element.clientWidth : element.clientHeight) / 2;
    });
    return { track, thumb, axis };
  });
  const observer = new ResizeObserver(scheduleScrollbars);
  const onScroll = () => {
    reveal();
    syncScrollbars();
  };
  scrolls.set(element, {
    tracks,
    baseRight: parseFloat(getComputedStyle(element).paddingRight) || 0,
    baseBottom: parseFloat(getComputedStyle(element).paddingBottom) || 0,
    originalRight: element.style.paddingRight,
    originalBottom: element.style.paddingBottom,
    observer,
    onScroll,
    cleanup: () => clearTimeout(activityTimer),
  });
  element.addEventListener("scroll", onScroll, { passive: true });
  observer.observe(element);
}
let scrollFrame = null;
function scheduleScrollbars() {
  if (scrollFrame != null) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = null;
    syncScrollbars();
  });
}
function syncScrollbars() {
  for (const [element, metadata] of scrolls) {
    const { tracks, observer, onScroll, cleanup } = metadata;
    if (!element.isConnected) {
      observer.disconnect();
      element.removeEventListener("scroll", onScroll);
      cleanup();
      for (const { track } of tracks) {
        if (track.matches(":popover-open")) track.hidePopover();
        track.remove();
      }
      scrolls.delete(element);
      continue;
    }
    const coarse = matchMedia("(pointer: coarse)").matches;
    const thickness = ((coarse ? 10 : 8) * 2) / 3;
    const hasX = element.scrollWidth > element.clientWidth + 1;
    const hasY = element.scrollHeight > element.clientHeight + 1;
    // The table owns its right lane; ordinary scrollers reserve padding for tracks.
    if (element.id !== "program-ribbon") {
      for (const [axis, overflow, base, original] of [
        ["Right", hasY, metadata.baseRight, metadata.originalRight],
        ["Bottom", hasX, metadata.baseBottom, metadata.originalBottom],
      ]) {
        if (axis === "Right" && element.id === "table-wrap") continue;
        const value =
          overflow && base < thickness + 1 ? `${thickness + 1}px` : original;
        if (element.style[`padding${axis}`] !== value)
          element.style[`padding${axis}`] = value;
      }
    }
    const ownerDialog = element.closest("dialog[open]");
    const modal = Boolean(ownerDialog?.matches(":modal"));
    const r = element.getBoundingClientRect();
    for (const { track, thumb, axis } of tracks) {
      const extent = axis === "x" ? element.scrollWidth : element.scrollHeight,
        visible = axis === "x" ? element.clientWidth : element.clientHeight,
        size = Math.max(
          0,
          (axis === "x" ? r.width : r.height) -
            ((axis === "x" ? hasY : hasX) ? thickness + 1 : 0) -
            2,
        );
      track.style[axis === "x" ? "height" : "width"] = thickness + "px";
      thumb.style[axis === "x" ? "height" : "width"] = thickness + "px";
      const visibleTrack = r.width > 0 && r.height > 0 && extent > visible + 1;
      // A modal dialog makes body siblings inert. Its tracks must belong to it
      // and enter the top layer so their fixed viewport coordinates stay valid.
      const parent = modal ? ownerDialog : document.body;
      if (track.parentElement !== parent) {
        if (track.matches(":popover-open")) track.hidePopover();
        parent.append(track);
      }
      if (modal) {
        track.setAttribute("popover", "manual");
        track.style.margin = "0";
        track.style.inset = "auto";
        track.style.padding = "0";
        track.style.border = "0";
        track.hidden = !visibleTrack;
        if (visibleTrack && !track.matches(":popover-open"))
          track.showPopover();
        if (!visibleTrack && track.matches(":popover-open"))
          track.hidePopover();
      } else {
        if (track.matches(":popover-open")) track.hidePopover();
        track.removeAttribute("popover");
        track.hidden = !visibleTrack;
      }
      if (ownerDialog) {
        const layer = Number(getComputedStyle(ownerDialog).zIndex);
        track.style.zIndex = String((Number.isFinite(layer) ? layer : 100) + 1);
      } else track.style.zIndex = "";
      track.style.left =
        (axis === "x" ? r.left : r.right - thickness - 1) + "px";
      track.style.top =
        (axis === "x"
          ? element.id === "program-ribbon"
            ? r.bottom + 1
            : r.bottom - thickness - 1
          : r.top) + "px";
      track.style[axis === "x" ? "width" : "height"] = Math.max(0, size) + "px";
      const thumbSize = Math.min(
        size,
        Math.max(coarse ? 44 : 28, (size * visible) / extent),
      );
      thumb.style[axis === "x" ? "width" : "height"] = thumbSize + "px";
      thumb.style.transform = `translate${axis.toUpperCase()}(${((axis === "x" ? element.scrollLeft : element.scrollTop) / Math.max(1, extent - visible)) * (size - thumbSize)}px)`;
    }
  }
}
export function syncControls() {
  if (
    activeMenu &&
    (!activeMenu.button.isConnected || activeMenu.button.disabled)
  )
    closeMenu();
  for (const [select, button] of selects) {
    if (!select.isConnected) {
      button.remove();
      selects.delete(select);
      continue;
    }
    const label =
      select.getAttribute("aria-label") ||
      select.labels?.[0]?.textContent.trim().split("\n")[0] ||
      select.name ||
      select.id;
    const text = selectLabel(select, select.selectedOptions[0]?.text ?? "");
    if (button.textContent !== text) button.textContent = text;
    button.setAttribute("aria-label", label);
    button.disabled = select.disabled;
    button.style.display = select.hidden ? "none" : "";
  }
  for (const [input, button] of rotaries) {
    const n = Number(input.value),
      min = Number(input.min),
      max = Number(input.max);
    button.style.setProperty(
      "--angle",
      -135 + (270 * (n - min)) / (max - min) + "deg",
    );
    button.setAttribute("aria-valuemin", min);
    button.setAttribute("aria-valuemax", max);
    button.setAttribute("aria-valuenow", n);
    button.querySelector(".effect-value").textContent =
      input.dataset.displayValue ??
      (input.dataset.decimals != null
        ? n.toFixed(Number(input.dataset.decimals)) + (input.dataset.unit ?? "")
        : input.dataset.rotary === "Time"
          ? n.toFixed(3) + " s"
          : n.toFixed(2));
    button.disabled = input.disabled;
  }
  syncScrollbars();
}
export function initControls() {
  const enhance = () => {
    document.querySelectorAll("select").forEach(enhanceSelect);
    document.querySelectorAll("dialog").forEach(enhanceScroll);
    document.querySelectorAll("[data-rotary]").forEach(enhanceRotary);
    syncControls();
  };
  enhance();
  [
    "table-wrap",
    "program-ribbon",
    "keyboard-scroll",
    "recorded-takes-wrap",
  ].forEach((id) => {
    const element = document.getElementById(id);
    if (element) enhanceScroll(element);
  });
  new MutationObserver((records) => {
    if (
      records.every((r) =>
        r.target.closest?.(
          ".custom-select,.custom-options,.effect-knob,.custom-scrollbar",
        ),
      )
    )
      return;
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        enhance();
      });
    }
  }).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["disabled", "selected", "hidden"],
  });
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (
        activeMenu &&
        !activeMenu.menu.contains(e.target) &&
        !activeMenu.button.contains(e.target)
      )
        closeMenu();
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && activeMenu) {
        e.stopImmediatePropagation();
        e.preventDefault();
        closeMenu();
      }
    },
    true,
  );
  window.addEventListener("resize", () => {
    closeMenu();
    syncScrollbars();
  });
  window.addEventListener("scroll", syncScrollbars, true);
  let z = 100;
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.target.open) {
        r.target.style.zIndex = String(++z);
        r.target.style.left = "50%";
        r.target.style.top = "50%";
        r.target.style.transform = "translate(-50%, -50%)";
      }
      syncScrollbars();
    }
  }).observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ["open"],
  });
}
