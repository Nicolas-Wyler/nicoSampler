import { installPageZoomGuard } from "./page-gestures.js";
import { COLOR_PALETTE } from "./key-colors.js";
import { findFreeKeyBlock, hasAssignedKeys } from "./auto-assignment.js";
import { acceptsInput } from "./input-routing.js";
import { isSampleMuted } from "./sample-audibility.js";
import { EXAMPLE_FX } from "./example-kit.js";
import { initMasterKnob, syncMasterKnob } from "./master-knob.js";
import { RecordedTakesTable } from "./recorded-takes.js";
import { InputMonitor } from "./input-monitor.js";
import { applyPreferences, preferences } from "./settings.js";
import {
  planLandingImport,
  landingNotice,
  isLegacyEmptyProgram,
} from "./landing-import.js";
import { encodePcmWav } from "./wav-format.js";
import {
  renderSelectionDefaults,
  sourceRenderFormat,
  effectiveSampleFormat,
} from "./render-options.js";
import { rawWave } from "./sample-container.js";
import {
  initFilterUI,
  syncFilterUI,
  drawFilter,
  cutoffPosition,
  cutoffValue,
} from "./filter-ui.js";
import { updateMeters, dbPosition, positionDb } from "./meters.js";
import { initControls, syncControls } from "./controls.js";
import { RowSelection, moveRows } from "./selection.js";
import { ClassicUI, setRowPreviewIcon } from "./classic-ui.js";
import { installProgramDragging } from "./program-drag.js";
import {
  copySamples,
  readSamples,
  sameSampleSnapshot,
} from "./sample-clipboard.js";
import {
  playbackParts,
  playbackMode,
  newEmpty,
  singleLoaded,
  sortedFiles,
  batchLoaded,
  mixedLoaded,
  overlapping,
  unassign,
  spreadSettings,
  spreadStep,
} from "./workflows.js";
import {
  session,
  audioBytes,
  validateTakes,
  program,
  sample,
  uid,
  RATE,
  MODES,
  MODE_NAMES,
  SPREADS,
  noteName,
  bounds,
  assigned,
  clamp,
  fitMarkers,
  demoSamples,
  encodeWav,
  validateBank,
  validateSample,
} from "./model.js";
import { AudioController, requestSystemAudio } from "./audio.js";
import {
  saveRecovery,
  loadRecovery,
  clearRecovery,
  FileCodec,
  download,
} from "./storage.js";
import { Waveform } from "./waveform.js";
const $ = (id) => document.getElementById(id),
  listen = (id, type, fn) =>
    $(id)?.addEventListener(type, (e) => {
      // Keep browser-gated calls on the trusted event stack (not a later task).
      try {
        Promise.resolve(fn(e)).catch(report);
      } catch (error) {
        report(error);
      }
    });
let replaceTarget = null,
  rowValueKey = "level";
let state = session(),
  view = "pads",
  learn = null,
  busy = false,
  saveTimer,
  saveChain = Promise.resolve(),
  toastTimer,
  dirtyVersion = 0,
  savedVersion = 0,
  dragId = null;
const history = new Map(),
  held = new Map(),
  pointerNotes = new Map(),
  pressedNotes = new Set(),
  pressedChannels = new Map(),
  noteEpoch = new Map();
let panicEpoch = 0,
  midiMutedUntil = 0,
  inputMonitor = null;
const audio = new AudioController(audioEvent),
  codec = new FileCodec();
const current = () =>
    state.programs.find((p) => p.id === state.current) ?? state.programs[0],
  selected = () => current().samples.find((s) => s.id === current().selected);
const rowSelection = new RowSelection(),
  auditions = new Map();
const selectedIds = () => rowSelection.reconcile(current());
const touchSelectionUI = /iPhone|iPod|Android.*Mobile/i.test(
  navigator.userAgent,
);
document.body.classList.toggle("phone-ui", touchSelectionUI);
const storedBytes = () => audioBytes(state.programs, state.takes ?? []);
const projectedBytes = (audio, replacing = null, source = null) =>
  audioBytes(state.programs, state.takes ?? [], audio, replacing, source);
const sourceBytes = () =>
  state.programs.reduce(
    (n, p) =>
      n +
      p.samples.reduce((n, s) => n + (s.audio?.[0]?.byteLength ?? 0) * 2, 0),
    0,
  );
let pendingGuard = null,
  approvedClose = false;
function unsavedWork() {
  return (
    state.programs.some((p) => p.dirty) ||
    (state.takes ?? []).some(
      (t) =>
        !t.exported &&
        !state.programs.some((p) =>
          p.samples.some((s) => s.audio?.[0] === t.audio[0]),
        ),
    ) ||
    (take && !takeId) ||
    recording ||
    armed
  );
}
async function discardGuard(
  message,
  dirty = state.programs.some((p) => p.dirty),
) {
  if (pendingGuard) return false;
  const d = document.createElement("dialog");
  d.id = "unsaved-dialog";
  d.className = "editor";
  d.setAttribute("aria-label", dirty ? "Unsaved changes" : "Confirm action");
  d.innerHTML = `<header class="dialog-header"><h2>${dirty ? "Unsaved changes" : "Confirm action"}</h2></header><p class="guard-message"></p><div class="dialog-actions"></div>`;
  d.querySelector("p").textContent =
    message +
    (dirty
      ? " Save a bank before continuing, discard these changes, or cancel."
      : "");
  const actions = d.querySelector(".dialog-actions");
  const result = new Promise((resolve) => {
    pendingGuard = (value) => {
      pendingGuard = null;
      d.close();
      d.remove();
      resolve(value);
    };
    for (const [label, value] of dirty
      ? [
          ["Save bank", "save"],
          ["Discard", "discard"],
          ["Cancel", "cancel"],
        ]
      : [
          ["Continue", "discard"],
          ["Cancel", "cancel"],
        ]) {
      const b = document.createElement("button");
      b.textContent = label;
      b.addEventListener("click", () => pendingGuard?.(value));
      actions.append(b);
    }
    d.addEventListener("cancel", (e) => {
      e.preventDefault();
      pendingGuard?.("cancel");
    });
    d.addEventListener("close", () => pendingGuard?.("cancel"));
  });
  document.body.append(d);
  d.showModal();
  d.dataset.opened = String(performance.now());
  actions.lastElementChild.focus();
  const choice = await result;
  if (choice === "cancel") return false;
  if (choice === "save") {
    if (recording || armed) {
      status("Stop recording before saving and closing.");
      return false;
    }
    await saveBank();
    if (take && !takeId)
      download(takeWav ?? encodeWav(take), "Recording.wav", "audio/wav");
    await persist();
    if (state.programs.some((p) => p.dirty)) {
      status(
        "Changes arrived during saving. Please save again before continuing.",
      );
      return false;
    }
  }
  return true;
}
function textEntry(label, value) {
  const d = document.createElement("dialog");
  d.className = "editor";
  d.setAttribute("aria-label", label);
  d.innerHTML =
    '<header class="dialog-header"><h2></h2></header><form method="dialog"><label class="field"><span></span><input type="text" autofocus></label><div class="dialog-actions"><button value="cancel" type="button">Cancel</button><button value="save">Save</button></div></form>';
  d.querySelector("h2").textContent = label;
  d.querySelector("label span").textContent = label;
  const input = d.querySelector("input");
  input.value = value;
  d.querySelector('[value="cancel"]').onclick = () => d.close("cancel");
  return new Promise((resolve) => {
    d.addEventListener(
      "close",
      () => {
        const result = d.returnValue === "save" ? input.value : null;
        d.remove();
        resolve(result);
      },
      { once: true },
    );
    document.body.append(d);
    d.showModal();
    d.dataset.opened = String(performance.now());
    input.select();
  });
}
function updateBaseLatency() {
  const label = $("base-latency");
  if (!label) return;
  const latency = audio.context?.baseLatency;
  const text =
    typeof latency === "number" && Number.isFinite(latency) && latency >= 0
      ? `Base latency: ${(latency * 1000).toFixed(1)} ms`
      : "Base latency: unavailable";
  if (label.textContent !== text) label.textContent = text;
}
const SAMPLE_COLOR_SWATCHES = COLOR_PALETTE.map((color) => color.toUpperCase());
function openSampleColor(s) {
  if (!current().samples.includes(s)) return;
  const program = current();
  $("sample-color-dialog")?.close();
  const dialog = document.createElement("dialog");
  dialog.id = "sample-color-dialog";
  dialog.className = "editor";
  dialog.tabIndex = -1;
  dialog.setAttribute("aria-label", "Sample color");
  dialog.innerHTML = `<header class="dialog-header"><h2>Sample color</h2></header><p class="color-sample-name"></p><div class="sample-color-palette" role="group" aria-label="Color palette"></div><label class="field">Hex color<input id="sample-color-hex" type="text" maxlength="7" placeholder="#RRGGBB" autocomplete="off" spellcheck="false"></label><p class="sample-color-error" role="alert"></p><div class="dialog-actions"><button type="button" data-color-action="automatic">Automatic</button><span class="spacer"></span><button type="button" data-color-action="cancel">Cancel</button><button type="button" data-color-action="apply">Apply</button></div>`;
  dialog.querySelector(".color-sample-name").textContent = s.name;
  const palette = dialog.querySelector(".sample-color-palette"),
    input = dialog.querySelector("input"),
    error = dialog.querySelector(".sample-color-error");
  Object.assign(palette.style, {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(44px, 1fr))",
    gap: "8px",
    margin: "16px 0",
  });
  error.style.minHeight = "1.3em";
  error.style.color = "#FCA5A5";
  input.value = s.color ?? "";
  const swatches = [];
  const markSelected = () => {
    for (const button of swatches) {
      const active = button.dataset.color === input.value.toUpperCase();
      button.setAttribute("aria-pressed", String(active));
      button.style.boxShadow = active
        ? "0 0 0 2px var(--text, #E5E7EB)"
        : "none";
    }
  };
  for (const color of SAMPLE_COLOR_SWATCHES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sample-color-swatch";
    button.dataset.color = color;
    button.setAttribute("aria-label", color);
    button.title = color;
    Object.assign(button.style, {
      background: color,
      minWidth: "44px",
      minHeight: "44px",
      padding: "0",
      border: "1px solid #26312B",
      borderRadius: "6px",
    });
    button.addEventListener("click", () => {
      input.value = color;
      error.textContent = "";
      markSelected();
    });
    swatches.push(button);
    palette.append(button);
  }
  function apply(color) {
    if (!state.programs.includes(program) || !program.samples.includes(s)) {
      dialog.close();
      return;
    }
    s.color = color;
    touch(program);
    checkpoint(s);
    paint();
    changed();
    dialog.close();
    status(
      color
        ? `Color set for ${s.name}.`
        : `Automatic color restored for ${s.name}.`,
    );
  }
  const applyInput = () => {
    let value = input.value.trim();
    if (/^[0-9a-f]{6}$/i.test(value)) value = "#" + value;
    if (!value) return apply(null);
    if (!/^#[0-9a-f]{6}$/i.test(value)) {
      error.textContent = "Enter a six-digit color, for example #7DD3FC.";
      input.focus();
      return;
    }
    apply(value.toUpperCase());
  };
  input.addEventListener("input", () => {
    error.textContent = "";
    markSelected();
  });
  dialog.querySelector('[data-color-action="apply"]').onclick = applyInput;
  dialog.querySelector('[data-color-action="automatic"]').onclick = () =>
    apply(null);
  dialog.querySelector('[data-color-action="cancel"]').onclick = () =>
    dialog.close();
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyInput();
    }
  });
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    dialog.close();
  });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.dataset.opened = String(performance.now());
  document.body.append(dialog);
  markSelected();
  dialog.showModal();
  input.focus();
  input.select();
}
function status(text) {
  updateBaseLatency();
  $("status").textContent = text;
}
function report(error) {
  const message = error?.message ?? String(error);
  if (current().landing) $("landing-status").textContent = message;
  console.error(error);
  status(message);
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 8000);
}
function touch(p = current()) {
  p.dirty = true;
  p.revision = (p.revision ?? 0) + 1;
}
function changed() {
  approvedClose = false;
  dirtyVersion++;
  $("save-status").textContent = "Saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persist(), 500);
}
async function persist() {
  captureViewSettings();
  clearTimeout(saveTimer);
  const version = dirtyVersion,
    snapshot = structuredClone(state);
  saveChain = saveChain.catch(() => {}).then(() => saveRecovery(snapshot));
  try {
    await saveChain;
    savedVersion = version;
    if (version === dirtyVersion)
      $("save-status").textContent = "Saved on this device";
  } catch (error) {
    $("save-status").textContent = "Autosave failed · save bank";
    report(
      Error(
        "Local autosave failed. Download a bank now to keep your work. " +
          error.message,
      ),
    );
  }
}
function snapshot(s) {
  const { audio, ...data } = s;
  return structuredClone(data);
}
function checkpoint(s) {
  if (!s) return;
  const h = history.get(s.id) ?? { items: [], index: -1 },
    value = snapshot(s);
  if (
    h.index >= 0 &&
    JSON.stringify(h.items[h.index]) === JSON.stringify(value)
  )
    return;
  h.items = h.items.slice(0, h.index + 1);
  h.items.push(value);
  if (h.items.length > 100) h.items.shift();
  h.index = h.items.length - 1;
  history.set(s.id, h);
}
function setValue(id, value) {
  if (document.activeElement !== $(id)) $(id).value = value ?? "";
}
function option(value, text = value) {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = text;
  return o;
}
function paint() {
  updateBaseLatency();
  const p = current();
  const landing = p.landing === true;
  $("landing").hidden = !landing;
  $("sampler").hidden = landing;
  selectedIds();
  ui.render(state, p, learn);
  if (
    ![...$("input-source").options].some(
      (o) => o.value === (state.source ?? "PC Keyboard"),
    )
  )
    $("input-source").append(
      option(state.source, "MIDI input (connect to restore)"),
    );
  $("input-source").value = state.source ?? "PC Keyboard";
  $("midi-channel").value = p.channel;
  $("midi-channel").disabled = false;
  $("midi-channel-label").hidden =
    $("input-routing-label").hidden ||
    ["None", "PC Keyboard"].includes(state.source ?? "PC Keyboard");
  $("memory-info").textContent =
    `${(sourceBytes() / 1048576).toFixed(1)} MB source`;
  inspector();
  paintKeyboard();
  audio.trimCache(state);
  paintSettings();
  paintLearn();
  syncControls();
}
function captureViewSettings() {
  if (!current().landing && ui.getViewSettings)
    state.viewSettings = ui.getViewSettings();
}
function restoreSavedSettings() {
  restoreColumnWidths();
  restoreRecordingSettings();
}
function restoreSavedView() {
  ui.restoreViewSettings?.(state.viewSettings);
}
function paintSettings() {
  setValue("record-gain", state.record.gain_db ?? 0);
  $("master").value = Math.round(state.master * 100);
  $("master-value").value = Math.round(state.master * 100) + "%";
  syncMasterKnob();
  for (let i = 0; i < 2; i++) {
    setValue(`delay${i + 1}-time`, state.fx[i].time);
    setValue(`delay${i + 1}-feedback`, state.fx[i].feedback);
    if ($(`delay${i + 1}-value`))
      $(`delay${i + 1}-value`).value = state.fx[i].feedback.toFixed(2);
  }
  syncControls();
}
function syncRowValue() {
  const s = selected();
  if (!s) {
    $("row-value-dialog").close();
    return;
  }
  const pan = rowValueKey === "pan",
    value = Number(((s[rowValueKey] ?? 0) * 100).toFixed(2));
  $("row-value-title").textContent =
    { level: "Level", pan: "Pan", fx1: "FX1 send", fx2: "FX2 send" }[
      rowValueKey
    ] +
    " · " +
    s.name;
  $("row-value-unit-wrap").hidden = pan;
  $("row-value-pan-wrap").hidden = !pan;
  setValue(pan ? "row-value-pan" : "row-value-unit", value);
  $("row-value-number").min = pan ? -100 : 0;
  setValue("row-value-number", value);
  syncControls();
}
function inspector() {
  const s = selected();
  for (const id of ["duplicate-sample", "spread-open", "trim-open"])
    $(id).disabled =
      !s ||
      (["trim-open", "spread-open", "export-sample"].includes(id) && !s.audio);
  $("record-open").disabled = finishingRecording;
  const multi = rowSelection.mode || selectedIds().size > 1;
  document
    .querySelectorAll(".samples-panel .toolbar button")
    .forEach((button) => {
      if (
        ![
          "duplicate-sample",
          "mobile-select",
          "mobile-copy",
          "mobile-paste",
          "mobile-delete",
        ].includes(button.id)
      )
        button.disabled = multi || button.disabled;
    });
  for (const id of ["new-sample", "fx-open", "demo"])
    if ($(id)) $(id).disabled = multi;
  $("duplicate-sample").disabled = !selectedIds().size;
  const mobileMode = touchSelectionUI && rowSelection.mode;
  if (!mobileMode) {
    $("mobile-delete").dataset.armed = "";
    $("mobile-delete").textContent = "Delete";
    $("mobile-delete").classList.remove("confirm-delete");
  }
  $("mobile-select").hidden = !touchSelectionUI;
  $("mobile-select").textContent = mobileMode ? "Done" : "Select";
  $("mobile-select").disabled = !current().samples.length && !mobileMode;
  $("mobile-select").setAttribute("aria-pressed", String(mobileMode));
  for (const id of [
    "mobile-copy",
    "mobile-paste",
    "mobile-delete",
    "duplicate-sample",
  ]) {
    $(id).hidden = !mobileMode;
    $(id).disabled = id !== "mobile-paste" && !selectedIds().size;
  }
  for (const id of ["fx-open", "spread-open", "record-open", "trim-open"])
    $(id).hidden = mobileMode;
  for (const value of ["sample", "render"]) {
    const option = $("save-kind").querySelector(`[value="${value}"]`);
    if (option)
      option.disabled = !current().samples.some(
        (x) => selectedIds().has(x.id) && x.audio,
      );
  }
  if (!s) {
    wave.setSample(null, null);
    return;
  }
  for (const [id, v] of Object.entries({
    semitone: s.semitone,
    fine: s.fine,
    attack: s.attack_ms,
    decay: s.decay_ms,
    "filter-mode": s.filter_mode,
    resonance: s.lpf_resonance,
    "crush-rate": effectiveSampleFormat(s).rate / 1000,
    "crush-bits": effectiveSampleFormat(s).bits,
  }))
    setValue(id, v);
  $("reverse").checked = s.reverse;
  $("normalize").checked = !!s.normalization;
  $("filter-enabled").checked = s.lpf_cutoff != null;
  setValue("cutoff", cutoffPosition(s.lpf_cutoff, s.filter_mode));
  $("cutoff-value").value =
    s.lpf_cutoff == null ? "∞ · bypass" : `${Math.round(s.lpf_cutoff)} Hz`;
  $("resonance-value").value = s.lpf_resonance.toFixed(1);
  for (const name of ["envelope", "filter", "pitch"])
    document.querySelector(`#${name}-dialog h2`).textContent =
      `${name[0].toUpperCase() + name.slice(1)} · ${s.name}`;
  $("wave-title").textContent = s.name;
  document.querySelector("#trim-dialog>.dialog-header h2").textContent =
    "Trim · " + s.name;
  $("wave-empty").hidden = !!s.audio;
  for (const id of [
    "trim-start",
    "trim-end",
    "loop-start",
    "loop-end",
    "crush-rate",
    "crush-bits",
    "reverse",
    "normalize",
    "native-reset",
    "trim-export",
    "trim-play",
    "trim-stop",
    "zoom-in",
    "zoom-out",
    "zoom-fit",
    "wave-pan",
  ])
    $(id).disabled = !s.audio;
  wave.setSample(s, audio.processed(s));
  $("wave-channels").value =
    s.wave_view === "split"
      ? "show-stereo"
      : s.mono
        ? s.mono_channel === "left"
          ? "mono-left"
          : s.mono_channel === "right"
            ? "mono-right"
            : "mono"
        : "stereo";
  $("zoom-fit").textContent =
    wave.fitMode === "trim"
      ? "Trim start–end"
      : wave.fitMode === "loop"
        ? "Loop in–out"
        : "Full";
  syncFilterUI();
  syncRowValue();
  setValue("semitone-knob", s.semitone);
  setValue("fine-knob", s.fine);
  $("pitch-octave-down").disabled = s.semitone <= -48;
  $("pitch-octave-up").disabled = s.semitone >= 48;
  waveFields();
  drawEditorPreviews();
  const h = history.get(s.id);
  $("undo").disabled = !h || h.index <= 0;
  $("redo").disabled = !h || h.index >= h.items.length - 1;
}
function waveFields() {
  const s = selected();
  if (!s?.audio) return;
  const [a, b] = bounds(s);
  for (const [id, n] of Object.entries({
    "trim-start": a,
    "trim-end": b,
    "loop-start": s.loop_start ?? a,
    "loop-end": s.loop_end ?? b,
  }))
    setValue(id, (n / RATE).toFixed(5));
  $("wave-info").textContent =
    `${((b - a) / RATE).toFixed(3)} s · ${effectiveSampleFormat(s).rate / 1000} kHz · ${effectiveSampleFormat(s).bits}-bit · ${s.mono ? "mono" : sourceRenderFormat(s).channels === 1 ? "mono" : "stereo"}`;
}
function select(id, repaint = true) {
  if (id !== current().selected) {
    stopTrim();
    if (
      !current().samples.find((s) => s.id === id)?.audio &&
      $("trim-dialog").open
    )
      $("trim-dialog").close();
  }
  current().selected = id;
  rowSelection.select(id);
  if (learn) cancelLearning();
  const s = selected();
  checkpoint(s);
  if (repaint) paint();
  else {
    document
      .querySelectorAll("[data-id]")
      .forEach((el) => el.classList.toggle("selected", el.dataset.id === id));
    inspector();
  }
  changed();
}
function rowSelect(id, event = {}) {
  const p = current();
  rowSelection.reconcile(p);
  if (rowSelection.mode && !event.metaKey && !event.ctrlKey && !event.shiftKey)
    rowSelection.toggle(id);
  else
    rowSelection.click(
      id,
      event,
      p.samples.map((s) => s.id),
    );
  if (rowSelection.ids.size)
    p.selected = rowSelection.ids.has(id) ? id : [...rowSelection.ids].at(-1);
  else p.selected = null;
  stopTrim();
  if (learn) cancelLearning();
  paint();
  changed();
}
const clipboardWindowId = uid(),
  consumedCuts = new Set();
let clipboardQueue = Promise.resolve();
async function copySelectedRows(cut, programId, ids) {
  const source = state.programs.find((p) => p.id === programId);
  const samples = source?.samples.filter((s) => ids.has(s.id)) ?? [];
  if (!samples.length) {
    status("Select samples to copy or cut.");
    return;
  }
  await copySamples(samples, {
    sourceProgramId: source.id,
    cut,
    originWindowId: clipboardWindowId,
  });
  status(
    cut
      ? `Cut ${samples.length} samples. Paste to complete the move; originals remain safe until then.`
      : `Copied ${samples.length} samples. Paste into another program or a sampler window in this browser.`,
  );
}
async function pasteSelectedRows(programId) {
  const payload = await readSamples();
  if (!payload?.samples.length) {
    status("The sampler clipboard is empty.");
    return;
  }
  const destination = state.programs.find((p) => p.id === programId);
  if (!destination) throw Error("The destination program was closed.");
  const source = state.programs.find((p) => p.id === payload.sourceProgramId);
  const sourceIds = new Set(payload.samples.map((s) => s.id));
  const localCut =
    payload.cut &&
    payload.originWindowId === clipboardWindowId &&
    !consumedCuts.has(payload.token);
  const move =
    localCut &&
    source &&
    payload.samples.every((snapshot) => {
      const row = source.samples.find((s) => s.id === snapshot.id);
      return (
        row &&
        sameSampleSnapshot(
          { ...row, audio_dirty: false },
          { ...snapshot, audio_dirty: false },
        )
      );
    });
  const copies = payload.samples.map((s) => ({
    ...structuredClone(s),
    id: uid(),
  }));
  const candidates = state.programs.map((p) => ({
    ...p,
    samples: [
      ...p.samples.filter(
        (s) => !(move && p === source && sourceIds.has(s.id)),
      ),
      ...(p === destination ? copies : []),
    ],
  }));
  if (candidates.find((p) => p.id === destination.id).samples.length > 512)
    throw Error("Maximum 512 rows; nothing was pasted or cut.");
  if (audioBytes(candidates, state.takes ?? []) > 128 * 1048576)
    throw Error(
      "128 MB source-audio budget reached; nothing was pasted or cut.",
    );
  // Every validation completes before either program is mutated.
  if (move) {
    source.samples = source.samples.filter((s) => !sourceIds.has(s.id));
    if (!source.samples.some((s) => s.id === source.selected))
      source.selected = source.samples[0]?.id ?? null;
    consumedCuts.add(payload.token);
    if (source !== destination) touch(source);
    for (const id of sourceIds) {
      audio.forget(id);
      auditions.delete(id);
    }
  }
  destination.samples.push(...copies);
  destination.selected = copies[0].id;
  touch(destination);
  for (const copy of copies) checkpoint(copy);
  if (current() === destination) {
    const mode = rowSelection.mode,
      explicitMode = rowSelection.explicitMode;
    rowSelection.select(destination.selected);
    rowSelection.mode = mode;
    rowSelection.explicitMode = explicitMode;
    rowSelection.ids = new Set(copies.map((s) => s.id));
  } else if (move && current() === source) rowSelection.select(source.selected);
  paint();
  changed();
  if (current() === destination || (move && current() === source))
    await audio.syncProgram(current());
  const suffix =
    payload.cut && !move && !consumedCuts.has(payload.token)
      ? " Originals were kept (another window or edited source)."
      : "";
  status(`${move ? "Moved" : "Pasted"} ${copies.length} samples.${suffix}`);
}
function collapseRowSelection() {
  if (!rowSelection.mode && selectedIds().size <= 1) return;
  rowSelection.select(current().selected);
  ui.render(state, current(), learn);
  inspector();
  syncControls();
}
document.addEventListener(
  "pointerdown",
  (e) => {
    if (e.target instanceof Element && !e.target.closest("#mobile-delete")) {
      $("mobile-delete").dataset.armed = "";
      $("mobile-delete").textContent = "Delete";
      $("mobile-delete").classList.remove("confirm-delete");
    }
    if (
      !(e.target instanceof Element) ||
      e.target.closest(
        "#sample-table, #program-ribbon button, .storagebar .custom-select, .storagebar select, .custom-options, dialog, .samples-panel .toolbar, .remove-sample-button",
      )
    )
      return;
    collapseRowSelection();
  },
  true,
);
function reorder(from, to, after = false) {
  const p = current();
  p.samples = moveRows(
    p.samples,
    Array.isArray(from) ? from : [from],
    to,
    after,
  );
  touch(p);
  paint();
  changed();
  void audio.syncProgram(p).catch(report);
}
async function previewSample(id) {
  const s = current().samples.find((s) => s.id === id);
  if (!s) return;
  if (selectedIds().has(id)) return previewSelection();
  if (!s.audio) return;
  if (auditions.has(id)) {
    auditions.delete(id);
    audio.send({ type: "stopSample", slot: audio.slots.get(id) });
    paint();
    return;
  }
  if (isSampleMuted(s, current().samples)) return;
  const p = current(),
    token = { seen: false, pending: true, started: performance.now() };
  auditions.set(id, token);
  paint();
  try {
    await enable();
  } catch (error) {
    auditions.delete(id);
    paint();
    throw error;
  }
  if (current() !== p || auditions.get(id) !== token) return;
  token.pending = false;
  token.started = performance.now();
  audio.on(p, s.root_note ?? s.key ?? 60, 127, -3, id);
}
async function previewSelection() {
  const p = current(),
    ids = selectedIds();
  const candidates = p.samples.filter((s) => ids.has(s.id) && s.audio);
  if (!candidates.length) return;
  if (candidates.some((s) => auditions.has(s.id))) {
    for (const s of candidates) {
      auditions.delete(s.id);
      const slot = audio.slots.get(s.id);
      if (slot != null) audio.send({ type: "stopSample", slot });
    }
    paint();
    return;
  }
  const samples = candidates.filter((s) => !isSampleMuted(s, p.samples));
  if (!samples.length) return;
  const tokens = samples.map((s) => {
    const token = { seen: false, pending: true, started: performance.now() };
    auditions.set(s.id, token);
    return token;
  });
  paint();
  try {
    await enable();
  } catch (error) {
    samples.forEach((s, i) => {
      if (auditions.get(s.id) === tokens[i]) auditions.delete(s.id);
    });
    paint();
    throw error;
  }
  if (current() !== p) return;
  samples.forEach((s, i) => {
    if (auditions.get(s.id) !== tokens[i]) return;
    tokens[i].pending = false;
    tokens[i].started = performance.now();
    audio.on(p, s.root_note ?? s.key ?? 60, 127, -3, s.id);
  });
}
async function commit(s, reprocess = false, repaint = false) {
  s.audio_dirty = s.audio_dirty || reprocess;
  touch();
  checkpoint(s);
  changed();
  await audio.update(s, reprocess);
  if (trimSampleId === s.id) refreshTrim(s);
  if (selected()?.id === s.id) {
    if (repaint) paint();
    else inspector();
  }
}
async function enable() {
  await audio.enable();
  $("enable-audio").hidden = audio.context.state === "running";
  $("enable-audio").textContent = "Resume audio";
  $("enable-audio").classList.toggle(
    "primary",
    audio.context.state !== "running",
  );
  audio.settings(state);
  if (!audio.synced) {
    await audio.syncProgram(current());
    audio.synced = true;
  }
  status(`Audio ready · ${audio.context.sampleRate / 1000} kHz`);
}
// iOS can withhold audio activation until touch-end; never await startup first.
document.addEventListener(
  "touchend",
  () => {
    if (audio.context && audio.context.state !== "running")
      void audio.context.resume().catch(report);
  },
  { capture: true, passive: true },
);
async function startNote(note, velocity = 127, channel = 0, previewId = null) {
  if (current().landing) return;
  if (channel > 0 && !["All", String(channel)].includes(current().channel))
    return;
  if (learn && !previewId) {
    await captureLearn(note);
    return;
  }
  // Initialize/resume in a gesture. Ignore MIDI while the user has not enabled audio.
  if (channel > 0 && !audio.node) return;
  const key = channel + ":" + note,
    ticket = (noteEpoch.get(key) ?? 0) + 1,
    panicTicket = panicEpoch;
  noteEpoch.set(key, ticket);
  if (!audio.node || audio.context.state !== "running") await enable();
  if (noteEpoch.get(key) !== ticket || panicTicket !== panicEpoch) return;
  audio.on(current(), note, velocity, channel, previewId);
  if (!pressedChannels.has(note)) pressedChannels.set(note, new Set());
  pressedChannels.get(note).add(channel);
  pressedNotes.add(note);
  paintPressed();
}
function releaseNote(note, channel = 0) {
  const key = channel + ":" + note;
  noteEpoch.set(key, (noteEpoch.get(key) ?? 0) + 1);
  audio.off(note, channel);
  const channels = pressedChannels.get(note);
  channels?.delete(channel);
  if (!channels?.size) {
    pressedChannels.delete(note);
    pressedNotes.delete(note);
  }
  paintPressed();
}
function releasePointer(id) {
  const entry = pointerNotes.get(id);
  if (entry) {
    pointerNotes.delete(id);
    releaseNote(entry.note, entry.channel);
  }
}
function releaseHeld() {
  for (const { note, channel } of held.values()) releaseNote(note, channel);
  held.clear();
  for (const id of pointerNotes.keys()) releasePointer(id);
  pressedNotes.clear();
  pressedChannels.clear();
  paintPressed();
}
function stopAll() {
  panicEpoch++;
  auditions.clear();
  stopTake();
  if ($("record-monitor").checked) {
    $("record-monitor").checked = false;
    audio.setInputMonitoring(false);
  }
  document.querySelectorAll("#sample-table .row-preview").forEach((b) => {
    setRowPreviewIcon(b, false);
    b.setAttribute("aria-label", "Play sample");
  });
  releaseHeld();
  audio.panic();
  learn = null;
  paintLearn();
  status("All voices and echoes stopped.");
}
async function preview() {
  const s = selected();
  if (!s?.audio) return;
  const n = s.root_note ?? s.key ?? 60;
  await startNote(n, 127, 0, s.id);
  setTimeout(
    () => releaseNote(n, 0),
    s.playback.startsWith("loop")
      ? 1500
      : Math.max(100, ((bounds(s)[1] - bounds(s)[0]) / RATE) * 1000),
  );
}
function paintKeyboard() {
  ui.pianoRender(state, current());
  paintPressed();
}
function paintPressed() {
  document
    .querySelectorAll(".piano-key")
    .forEach((el) =>
      el.classList.toggle("pressed", pressedNotes.has(Number(el.dataset.note))),
    );
}
function updateLearningDock() {
  const piano = document.querySelector(".keyboard-panel");
  const rect = piano?.getBoundingClientRect();
  const visible =
    !$("sampler").hidden &&
    rect &&
    rect.height > 0 &&
    getComputedStyle(piano).display !== "none";
  const dock = visible
    ? Math.max(
        1,
        Math.min(innerHeight - 1, Math.ceil(innerHeight - rect.top + 8)),
      )
    : 190;
  const value = dock + "px";
  if (
    document.documentElement.style.getPropertyValue("--note-learning-dock") !==
    value
  )
    document.documentElement.style.setProperty("--note-learning-dock", value);
}
function paintLearn() {
  document.body.classList.toggle("note-learning", learn != null);
  if (learn) document.body.dataset.learningType = learn.type;
  else delete document.body.dataset.learningType;
  updateLearningDock();
  let resized = false;
  document.querySelectorAll(".key-assignment").forEach((el) => {
    const row = el.closest("tr"),
      sample = current().samples.find((s) => s.id === row.dataset.id);
    if (!sample) return;
    const learning = row.dataset.id === learn?.id;
    el.classList.toggle("learning", learning);
    const label = learning
      ? "Press a key…"
      : sample.root_note != null
        ? `${noteName(sample.low_note)}:${noteName(sample.high_note)}\nr${noteName(sample.root_note)}`
        : sample.key == null
          ? "None"
          : `${sample.key} · ${noteName(sample.key)}`;
    if (el.textContent !== label) {
      el.textContent = label;
      resized = true;
    }
  });
  if (resized) ui.fitColumns();
}
let captureBusy = null;
async function captureLearn(note) {
  if (!learn || captureBusy === learn) return;
  const task = learn,
    s = selected();
  if (!s || task.id !== s.id) return;
  captureBusy = task;
  try {
    if (task.type === "batch-load") {
      try {
        mixedLoaded(s, task.items, note);
      } catch (error) {
        $("batch-prompt").textContent = error.message;
        return;
      }
      await applyLoadedBatch(s, task.items, note, task);
    } else if (task.type === "key" || task.type === "remove-spread") {
      const collision = overlapping(current().samples, s, [note]);
      if (
        collision.length &&
        !(await discardGuard(
          `${noteName(note)} is already assigned. Assign it anyway to play both samples?`,
          false,
        ))
      ) {
        cancelLearning();
        return;
      }
      s.key = note;
      s.root_note = s.low_note = s.high_note = null;
      s.spread_settings = null;
      cancelLearning();
      await commit(s, false, true);
      status(`${s.name} assigned to ${noteName(note)}.`);
    } else if (task.type === "spread") {
      let step;
      try {
        step = spreadStep(task.config.parameter, task.notes, note);
      } catch (error) {
        $("spread-prompt").textContent = error.message;
        return;
      }
      task.notes = step.notes;
      if (!step.complete) {
        spreadPrompt();
        return;
      }
      const notes = Array.from(
          { length: step.high - step.low + 1 },
          (_, i) => step.low + i,
        ),
        others = overlapping(current().samples, s, notes),
        choice = others.length
          ? await collisionChoice(
              notes.filter((n) => others.some((s) => assigned(s, n))),
            )
          : "Multi-assign";
      if (learn !== task) return;
      if (choice === "Cancel") {
        cancelLearning();
        status("Spread cancelled; existing assignments kept.");
        return;
      }
      if (choice === "Override")
        for (const other of others) {
          unassign(other);
          await audio.update(other);
        }
      Object.assign(s, {
        root_note: step.root,
        low_note: step.low,
        high_note: step.high,
        spread_settings: task.config,
        key: null,
      });
      cancelLearning();
      await commit(s, false, true);
      status(
        "Selected sample converted to " + task.config.parameter + " Spread.",
      );
    }
  } finally {
    if (captureBusy === task) captureBusy = null;
    paintLearn();
  }
}
// Faithful row actions, editor windows and Python-style key-capture workflows.
function safe(promise) {
  Promise.resolve(promise).catch(report);
}
async function newProgram() {
  if (state.programs.length >= 128) throw Error("Maximum 128 programs");
  if (inputMonitor?.active || inputMonitor?.wanted)
    await inputMonitor.deactivate("new-program");
  else if (inputConnected || recording || armed || finishingRecording)
    await disconnectRecordingInput();
  const p = program(`Program ${state.programs.length + 1}`);
  p.landing = true;
  state.programs.push(p);
  for (const d of document.querySelectorAll("dialog[open]")) d.close();
  $("landing-status").textContent = "";
  await switchProgram(p.id);
}
async function switchProgram(id) {
  if (id === state.current) return;
  stopTrim();
  cancelLearning();
  releaseHeld();
  audio.panic();
  state.current = id;
  paint();
  changed();
  await audio.syncProgram(current());
  status(current().name);
}
function openEditor(name, s = null) {
  if (s && s.id !== current().selected) select(s.id, false);
  const d = $(name + "-dialog");
  if (!d.open) d.show();
  d.dataset.opened = String(performance.now());
  d.focus();
  if (name === "trim") requestAnimationFrame(() => wave.draw());
  if (name === "batch" || name === "spread") paintLearn();
}
function cancelLearning() {
  learn = null;
  for (const id of ["batch-dialog", "spread-dialog"])
    if ($(id).open) $(id).close();
  paintLearn();
}
let resolveCollision = null,
  resolveReplacement = null;
function collisionChoice(notes) {
  $("collision-message").textContent =
    "Already assigned keys: " + notes.map(noteName).join(", ");
  return new Promise((resolve) => {
    resolveCollision = (value) => {
      resolveCollision = null;
      $("collision-dialog").close();
      resolve(value);
    };
    $("collision-dialog").dataset.opened = String(performance.now());
    $("collision-dialog").showModal();
  });
}
function replacementChoice(name) {
  $("replace-message").textContent =
    `${name} already contains audio. Overwrite it or make a new row?`;
  return new Promise((resolve) => {
    resolveReplacement = (value) => {
      resolveReplacement = null;
      $("replace-dialog").close();
      resolve(value);
    };
    $("replace-dialog").dataset.opened = String(performance.now());
    $("replace-dialog").showModal();
  });
}
for (const b of document.querySelectorAll("[data-collision]"))
  b.onclick = () => resolveCollision?.(b.dataset.collision);
for (const b of document.querySelectorAll("[data-replacement]"))
  b.onclick = () => resolveReplacement?.(b.dataset.replacement);
$("collision-dialog").addEventListener("cancel", (e) => {
  e.preventDefault();
  resolveCollision?.("Cancel");
});
$("replace-dialog").addEventListener("cancel", (e) => {
  e.preventDefault();
  resolveReplacement?.("Cancel");
});
function learnKey(s) {
  if (s.root_note != null) {
    startSpread(s);
    return;
  }
  learn = learn?.id === s.id ? null : { type: "key", id: s.id };
  paint();
  status(
    learn
      ? "Press a MIDI, computer or onscreen key. Escape cancels."
      : "Assignment cancelled.",
  );
}
function startSpread(s = selected()) {
  if (!s?.audio) {
    status("Load a sound before spreading it.");
    return;
  }
  cancelLearning();
  select(s.id, false);
  $("spread-sample-name").textContent = s.file_name || s.name;
  $("spread-kind").value = s.spread_settings?.parameter ?? "Pitch";
  $("spread-options").hidden = false;
  $("spread-prompt").hidden = true;
  $("spread-summary").textContent = "";
  $("spread-remove").hidden = s.root_note == null;
  spreadFields();
  openEditor("spread");
}
let resonanceManual = new Set();
function spreadFields() {
  const s = selected(),
    kind = $("spread-kind").value,
    saved = s?.spread_settings?.parameter === kind ? s.spread_settings : null,
    cut = kind.includes("Cutoff"),
    defaults = kind === "Level" ? [10, 100] : cut ? [20, 21950] : [0, 1000];
  resonanceManual = new Set();
  $("spread-value-fields").hidden = kind === "Pitch";
  $("spread-filter-fields").hidden = !cut;
  $("spread-instructions").textContent =
    kind === "Pitch"
      ? "Play the root key, then the lower and upper bounds."
      : "Choose values, then play the lower and upper bounds.";
  $("spread-min-label").firstChild.textContent =
    "Minimum (" + (kind === "Level" ? "%" : cut ? "Hz" : "ms") + ")";
  $("spread-max-label").firstChild.textContent =
    "Maximum (" + (kind === "Level" ? "%" : cut ? "Hz" : "ms") + ")";
  $("spread-minimum").value = saved
    ? saved.minimum * (kind === "Level" ? 100 : 1)
    : defaults[0];
  $("spread-maximum").value = saved
    ? saved.maximum * (kind === "Level" ? 100 : 1)
    : defaults[1];
  $("spread-rmin").value =
    saved?.resonance_min ?? (Number($("spread-minimum").value) / 21950) * 10;
  $("spread-rmax").value =
    saved?.resonance_max ?? (Number($("spread-maximum").value) / 21950) * 10;
  $("spread-couple").checked = saved?.coupled ?? false;
  $("spread-rmin").disabled = !$("spread-couple").checked;
}
function spreadPrompt() {
  if (!learn || learn.type !== "spread") return;
  const names =
    learn.config.parameter === "Pitch"
      ? ["root key", "lower bound", "upper bound"]
      : ["lower bound", "upper bound"];
  $("spread-prompt").textContent =
    `Step ${learn.notes.length + 1} of ${names.length}: Please play the ${names[learn.notes.length]}.`;
  $("spread-summary").textContent = learn.notes
    .map((n, i) => names[i] + ": " + noteName(n))
    .join(" · ");
}
listen("spread-open", "click", () => startSpread());
listen("spread-kind", "change", spreadFields);
listen(
  "spread-couple",
  "change",
  () => ($("spread-rmin").disabled = !$("spread-couple").checked),
);
for (const id of ["spread-rmin", "spread-rmax"])
  listen(id, "input", () => resonanceManual.add(id));
for (const [id, target] of [
  ["spread-minimum", "spread-rmin"],
  ["spread-maximum", "spread-rmax"],
])
  listen(id, "input", () => {
    if (!resonanceManual.has(target))
      $(target).value = clamp(
        (Number($(id).value) / 21950) * 10,
        0,
        10,
      ).toFixed(3);
  });
listen("spread-ok", "click", () => {
  const s = selected();
  let config;
  try {
    config = spreadSettings($("spread-kind").value, {
      minimum: $("spread-minimum").value,
      maximum: $("spread-maximum").value,
      resonance_min: $("spread-rmin").value,
      resonance_max: $("spread-rmax").value,
      coupled: $("spread-couple").checked,
    });
  } catch (error) {
    report(
      Error(
        "Enter valid spread values. Level: 0–100%; cutoff: 20–21950 Hz; resonance: 0–10; attack/decay: non-negative milliseconds.",
      ),
    );
    return;
  }
  learn = { type: "spread", id: s.id, notes: [], config };
  $("spread-options").hidden = true;
  $("spread-prompt").hidden = false;
  spreadPrompt();
  paintLearn();
  $("spread-dialog").focus();
});
listen("spread-remove", "click", () => {
  learn = { type: "remove-spread", id: selected().id };
  $("spread-options").hidden = true;
  $("spread-prompt").hidden = false;
  $("spread-prompt").textContent =
    "Please play the key to assign this sample to.";
  $("spread-summary").textContent =
    "The current spread is kept until a key is chosen.";
  paintLearn();
  $("spread-dialog").focus();
});
listen("spread-cancel", "click", cancelLearning);
listen("batch-cancel", "click", () => {
  cancelLearning();
  status("Loading cancelled; previous rows and assignments were kept.");
});
let trimLoopHeld = false,
  trimSampleId = null,
  trimToken = 0;
async function playTrim(looping) {
  const s = selected();
  if (!s?.audio) return;
  await enable();
  const token = ++trimToken;
  stopTrim(false);
  const data = audio.prepared.get(s.id) ?? (await audio.prepare(s));
  if (!data || token !== trimToken) return;
  const preview = {
    ...s,
    id: "trim-preview",
    audition_source_id: s.id,
    playback: looping ? "loop" : "poly",
    attack_ms: 0,
    decay_ms: 0,
    root_note: null,
    low_note: null,
    high_note: null,
    key: null,
  };
  const slot = 512;
  if (audio.slots.get(s.id) === slot)
    throw Error(
      "Trim audition needs one free voice asset slot (maximum 512 rows for audition).",
    );
  audio.upload(preview, slot, data);
  trimData = data;
  audio.send({
    type: "on",
    slots: [slot],
    note: 60,
    velocity: 127,
    channel: -2,
  });
  trimSampleId = s.id;
  trimLoopHeld = looping;
}
function stopTrim(invalidate = true) {
  wave.zoomMotion?.cancel();
  if (invalidate) trimToken++;
  audio.send({ type: "stopSample", slot: 512 });
  trimLoopHeld = false;
  trimSampleId = null;
}
function releaseTrim() {
  audio.off(60, -2);
  trimLoopHeld = false;
}
listen("trim-open", "click", () => {
  if (selected()?.audio) openEditor("trim");
});
listen("trim-play", "click", () => playTrim(false));
listen("trim-stop", "click", () => stopTrim());
listen("trim-export", "click", saveSelectedSamples);
listen("fx-open", "click", () => openEditor("fx"));
for (const b of document.querySelectorAll("[data-fx]"))
  b.onclick = () => {
    document
      .querySelectorAll("[data-fx]")
      .forEach((x) => x.classList.toggle("active", x === b));
    document
      .querySelectorAll(".delay")
      .forEach((x, i) => (x.hidden = i !== Number(b.dataset.fx)));
  };
document.querySelector('[data-fx="0"]').click();
for (const button of document.querySelectorAll("[data-close]"))
  button.onclick = () => {
    if (button.dataset.close === "trim-dialog") stopTrim();
    if (button.dataset.close === "spread-dialog") cancelLearning();
    $(button.dataset.close).close();
  };
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.tabIndex = -1;
  dialog.addEventListener("cancel", (e) => {
    if (dialog.id === "trim-dialog") stopTrim();
    if (["batch-dialog", "spread-dialog"].includes(dialog.id)) {
      e.preventDefault();
      cancelLearning();
    }
  });
  const header = dialog.querySelector(".dialog-header");
  if (header) {
    let drag;
    header.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      const rect = dialog.getBoundingClientRect();
      drag = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
      header.setPointerCapture(e.pointerId);
    });
    header.addEventListener("pointermove", (e) => {
      if (!drag) return;
      dialog.style.left =
        clamp(
          drag.left + e.clientX - drag.x,
          0,
          Math.max(0, innerWidth - dialog.offsetWidth),
        ) + "px";
      dialog.style.top =
        clamp(
          drag.top + e.clientY - drag.y,
          0,
          Math.max(0, innerHeight - dialog.offsetHeight),
        ) + "px";
      dialog.style.transform = "none";
    });
    for (const type of ["pointerup", "pointercancel"])
      header.addEventListener(type, () => (drag = null));
  }
}
for (const input of document.querySelectorAll("dialog input[type=number]"))
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
      input.closest("dialog").focus();
    }
  });
listen("load-program", "click", () => {
  requestedLoadType = "sample_program";
  $("bank-files").click();
});
listen("input-source", "change", (e) => {
  stopAll();
  cancelLearning();
  stopTrim();
  state.source = e.target.value;
  touch();
  paint();
  changed();
  status("Input: " + state.source);
});
const thresholdMeter = document.querySelector(".record-meter"),
  thresholdMarker = document.createElement("span");
thresholdMarker.id = "threshold-marker";
thresholdMeter.append(thresholdMarker);
thresholdMarker.tabIndex = 0;
thresholdMarker.setAttribute("role", "slider");
thresholdMarker.setAttribute("aria-label", "Recording trigger threshold");
thresholdMarker.setAttribute("aria-valuemin", "-60");
thresholdMarker.setAttribute("aria-valuemax", "0");
function drawThreshold() {
  const threshold = Number(state.record.threshold ?? -24);
  thresholdMarker.style.left = dbPosition(threshold) * 100 + "%";
  thresholdMarker.setAttribute("aria-valuenow", threshold.toFixed(1));
  thresholdMarker.setAttribute(
    "aria-valuetext",
    threshold.toFixed(1) + " dBFS",
  );
  thresholdMeter.title =
    "Trigger threshold: " + threshold.toFixed(1) + " dBFS. Drag to change.";
}
function setRecordThreshold(value) {
  state.record.threshold = Math.round(clamp(value, -60, 0) * 10) / 10;
  touch();
  drawThreshold();
  changed();
  if (armed)
    audio.send({ type: "threshold", threshold: state.record.threshold });
}
let thresholdDragging = false,
  thresholdTouch = null;
thresholdMeter.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  if (e.pointerType === "touch") {
    thresholdTouch = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      moved: false,
    };
    return;
  }
  e.preventDefault();
  thresholdMarker.focus({ preventScroll: true });
  thresholdDragging = true;
  thresholdMeter.setPointerCapture(e.pointerId);
  dragThreshold(e);
});
thresholdMeter.addEventListener("pointermove", (e) => {
  if (thresholdTouch?.id === e.pointerId && !thresholdDragging) {
    const dx = Math.abs(e.clientX - thresholdTouch.x),
      dy = Math.abs(e.clientY - thresholdTouch.y);
    if (Math.max(dx, dy) < 8) return;
    thresholdTouch.moved = true;
    if (dy >= dx) {
      thresholdTouch = null;
      return;
    }
    thresholdDragging = true;
    thresholdMeter.setPointerCapture(e.pointerId);
  }
  if (thresholdDragging) dragThreshold(e);
});
thresholdMeter.addEventListener("pointerup", (e) => {
  if (thresholdTouch?.id === e.pointerId && !thresholdTouch.moved)
    dragThreshold(e);
  thresholdDragging = false;
  thresholdTouch = null;
});
for (const type of ["pointercancel", "lostpointercapture"])
  thresholdMeter.addEventListener(type, () => {
    thresholdDragging = false;
    thresholdTouch = null;
  });
function dragThreshold(e) {
  const r = thresholdMeter.getBoundingClientRect();
  setRecordThreshold(positionDb((e.clientX - r.left) / r.width));
}
thresholdMarker.addEventListener("keydown", (e) => {
  if (
    ![
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Home",
      "End",
    ].includes(e.key)
  )
    return;
  e.preventDefault();
  e.stopPropagation();
  setRecordThreshold(
    e.key === "Home"
      ? -60
      : e.key === "End"
        ? 0
        : state.record.threshold +
          (["ArrowRight", "ArrowUp"].includes(e.key) ? 1 : -1) *
            (e.shiftKey ? 0.1 : 1),
  );
});
const ui = new ClassicUI({
  isLearning: () => learn != null,
  sampleColor: openSampleColor,
  viewChanged: (settings) => {
    if (current().landing) return;
    state.viewSettings = settings;
    touch();
    changed();
  },
  program: (id) => safe(switchProgram(id)),
  newProgram: () => safe(newProgram()),
  removeProgram: (id) => safe(removeProgram(id)),
  newSample: () => safe(newSample()),
  deleteSelection: () => safe(deleteRows(new Set(selectedIds()), false)),
  renameProgram: async (p) => {
    const name = await textEntry("Program name", p.name);
    if (name?.trim()) {
      p.name = name.trim();
      touch(p);
      paint();
      changed();
    }
  },
  columns: (widths, manual) => {
    state.columns = [...widths];
    state.columnManual = manual;
    state.columnSizingVersion = 4;
    touch();
    changed();
  },
  select,
  rowSelect,
  selectedIds,
  selectionMode: () => rowSelection.mode,
  auditioning: (id) => auditions.has(id),
  previewSample: (id) => safe(previewSample(id)),
  paint,
  reorder,
  openValue: (s, key) => {
    rowValueKey = key;
    select(s.id, false);
    syncRowValue();
    openEditor("row-value");
  },
  rename: (s, name) => {
    s.name = name;
    safe(commit(s, false, true));
  },
  open: (name, s) => openEditor(name, s),
  learn: learnKey,
  edit: (s, key, value) => {
    select(s.id, false);
    if (key === "playback")
      audio.send({ type: "stopSample", slot: audio.slots.get(s.id) });
    s[key] = value;
    if (key === "mute" || key === "solo") {
      if (value) s[key === "mute" ? "solo" : "mute"] = false;
      audio.updateAudibility(current());
    }
    safe(commit(s, false, true));
  },
  live: (s) => {
    touch();
    changed();
    safe(audio.update(s));
  },
  finish: (s) => safe(commit(s, false, false)),
  pointerOn: (id, note) => {
    pointerNotes.set(id, { note, channel: -1 });
    safe(startNote(note, 127, -1));
  },
  pointerOff: releasePointer,
  screenOn: (n) => safe(startNote(n, 127, -1)),
  screenOff: (n) => releaseNote(n, -1),
});

installProgramDragging((id, targetId, after) => {
  const reordered = moveRows(state.programs, [id], targetId, after);
  if (reordered.every((p, i) => p === state.programs[i])) return;
  state.programs = reordered;
  touch();
  paint();
  changed();
});

const wave = new Waveform($("waveform"), (done) => {
  const s = selected();
  waveFields();
  if (!s) return;
  if (done) {
    void commit(s, !!s.normalization).catch(report);
  } else {
    void audio.update(s, false).catch(report);
    if (trimSampleId === s.id) refreshTrim(s);
  }
});
wave.onView = () => {
  const n = selected()?.audio?.[0]?.length ?? 1,
    span = wave.viewEnd - wave.viewStart;
  $("wave-pan").value = n > span ? (wave.viewStart / (n - span)) * 1000 : 0;
  $("zoom-fit").textContent =
    wave.fitMode === "trim"
      ? "Trim start–end"
      : wave.fitMode === "loop"
        ? "Loop in–out"
        : "Full";
};
for (let n = 1; n <= 16; n++) $("midi-channel").append(option(String(n)));

listen("enable-audio", "click", enable);
listen("panic", "click", () => {
  midiMutedUntil = performance.now() + 1000;
  stopAll();
  status("Panic: all voices stopped; MIDI ignored for 1 second.");
});
listen("new-program", "click", newProgram);
async function removeProgram(id) {
  const removed = state.programs.find((p) => p.id === id);
  if (!removed) return;
  if (removed.dirty && !(await discardGuard(`Remove ${removed.name}?`, true)))
    return;
  const wasCurrent = state.current === id;
  if (state.programs.length === 1) {
    if (inputMonitor?.active || inputMonitor?.wanted)
      await inputMonitor.deactivate("last-program");
    else if (inputConnected || recording || armed || finishingRecording)
      await disconnectRecordingInput();
  }
  if (wasCurrent) {
    stopAll();
    stopTrim();
    cancelLearning();
  }
  state.programs = state.programs.filter((p) => p !== removed);
  if (!state.programs.length) {
    const p = program("Program 1");
    p.landing = true;
    state.programs.push(p);
  }
  if (wasCurrent) state.current = state.programs[0].id;
  touch();
  paint();
  changed();
  if (wasCurrent) await audio.syncProgram(current());
}
async function newSample() {
  const wasLanding = current().landing === true;
  const p = current(),
    x = newEmpty(`New Sample ${p.samples.length + 1}`);
  if (p.samples.length >= 512) throw Error("Maximum 512 rows");
  p.samples.push(x);
  p.landing = false;
  p.selected = x.id;
  touch(p);
  checkpoint(x);
  paint();
  if (wasLanding) restoreSavedView();
  changed();
  await audio.syncProgram(p);
}
async function duplicateSelectedRows() {
  const p = current(),
    ids = selectedIds();
  const sources = p.samples.filter((s) => ids.has(s.id));
  if (!sources.length) return;
  if (p.samples.length + sources.length > 512) throw Error("Maximum 512 rows");
  const additionalBytes = sources.reduce(
    (total, s) => total + audioBytes([{ samples: [s] }]),
    0,
  );
  if (storedBytes() + additionalBytes > 128 * 1048576)
    throw Error("128 MB source-audio budget reached");
  const copies = sources.map((s) => ({
    ...structuredClone(s),
    id: uid(),
    name: s.name + " copy",
  }));
  p.samples.push(...copies);
  p.selected = copies[0].id;
  const selectionMode = rowSelection.mode,
    explicitMode = rowSelection.explicitMode;
  rowSelection.select(p.selected);
  rowSelection.mode = selectionMode;
  rowSelection.explicitMode = explicitMode;
  rowSelection.ids = new Set(copies.map((s) => s.id));
  for (const copy of copies) checkpoint(copy);
  touch(p);
  paint();
  changed();
  await audio.syncProgram(p);
}
listen("duplicate-sample", "click", duplicateSelectedRows);
listen("mobile-select", "click", () => {
  if (rowSelection.mode) rowSelection.select(current().selected);
  else {
    rowSelection.reconcile(current());
    rowSelection.enter(current().selected, true);
  }
  paint();
});
listen("mobile-copy", "click", () =>
  copySelectedRows(false, current().id, new Set(selectedIds())),
);
listen("mobile-paste", "click", () => pasteSelectedRows(current().id));
listen("mobile-delete", "click", () => {
  const button = $("mobile-delete");
  const signature = JSON.stringify([...selectedIds()].sort());
  if (button.dataset.armed === signature) {
    button.dataset.armed = "false";
    button.textContent = "Delete";
    button.classList.remove("confirm-delete");
    return deleteRows(new Set(selectedIds()), false);
  }
  button.dataset.armed = signature;
  button.textContent = "Sure?";
  button.classList.add("confirm-delete");
});

async function deleteRows(ids, ask = true) {
  const p = current();
  if (
    !ids.size ||
    (ask &&
      !(await discardGuard(`Remove ${ids.size} selected samples?`, p.dirty)))
  )
    return;
  const explicitMode = rowSelection.explicitMode;
  const previousSelected = p.selected;
  const index = p.samples.findIndex((s) => ids.has(s.id));
  p.samples = p.samples.filter((s) => !ids.has(s.id));
  for (const id of ids) {
    audio.forget(id);
    auditions.delete(id);
  }
  p.selected = p.samples.some((s) => s.id === previousSelected)
    ? previousSelected
    : (p.samples[Math.min(index, p.samples.length - 1)]?.id ?? null);
  rowSelection.select(p.selected);
  if (explicitMode) {
    rowSelection.mode = true;
    rowSelection.explicitMode = true;
  }
  touch(p);
  paint();
  changed();
  await audio.syncProgram(p);
}
listen("preview", "click", preview);
listen("midi-channel", "change", (e) => {
  stopAll();
  current().channel = e.target.value;
  touch();
  changed();
});
listen("master", "input", (e) => {
  state.master = Number(e.target.value) / 100;
  for (const player of takePlayers.values())
    player.gain.gain.setValueAtTime(state.master, audio.context.currentTime);
  audio.setInputMonitoring(
    $("record-monitor").checked,
    state.record.gain_db ?? 0,
    state.master,
  );
  touch();
  $("master-value").value = e.target.value + "%";
  audio.settings(state);
  changed();
});
for (let i = 0; i < 2; i++)
  for (const key of ["time", "feedback"])
    listen(`delay${i + 1}-${key}`, key === "time" ? "change" : "input", (e) => {
      const x = Number(e.target.value);
      if (
        !Number.isFinite(x) ||
        x < (key === "time" ? 0.001 : 0) ||
        x > (key === "time" ? 1.5 : 2)
      ) {
        paintSettings();
        throw Error("Delay time must be .001–1.5 s, feedback 0–2");
      }
      state.fx[i][key] = x;
      touch();
      paintSettings();
      audio.settings(state);
      changed();
    });
for (const [id, key, min, max, integer] of [
  ["sample-key", "key", 0, 127, true],
  ["semitone", "semitone", -48, 48, true],
  ["fine", "fine", -100, 100, true],
  ["attack", "attack_ms", 0, Number.MAX_VALUE, false],
  ["decay", "decay_ms", 0, Number.MAX_VALUE, false],
  ["crush-rate", "crush_rate", 0.1, 44.1, false],
  ["crush-bits", "crush_bits", 1, 32, true],
])
  listen(id, "change", async (e) => {
    const s = selected();
    if (!s) return;
    if (e.target.value.trim() === "" && key !== "key") {
      e.target.value =
        key === "crush_rate"
          ? effectiveSampleFormat(s).rate / 1000
          : key === "crush_bits"
            ? effectiveSampleFormat(s).bits
            : s[key];
      throw Error("Enter a valid number");
    }
    const x =
      e.target.value === "" && key === "key" ? null : Number(e.target.value);
    if (
      x !== null &&
      (!Number.isFinite(x) ||
        x < min ||
        x > max ||
        (integer && !Number.isInteger(x)))
    ) {
      e.target.value =
        key === "crush_rate"
          ? effectiveSampleFormat(s).rate / 1000
          : key === "crush_bits"
            ? effectiveSampleFormat(s).bits
            : s[key];
      throw Error(
        `Value must be ${min}–${max}${integer ? " (whole number)" : ""}`,
      );
    }
    s[key] = key === "crush_rate" ? Math.round(x * 1000) : x;
    if (["attack_ms", "decay_ms"].includes(key) && s.audio) {
      const duration = ((bounds(s)[1] - bounds(s)[0]) / RATE) * 1000;
      s.attack_ms = Math.min(s.attack_ms, duration);
      s.decay_ms = Math.min(s.decay_ms, duration);
      if (s.attack_ms + s.decay_ms > duration) {
        s.attack_ms = Math.min(s.attack_ms, 50);
        s.decay_ms = Math.min(s.decay_ms, Math.max(0, duration - s.attack_ms));
      }
    }
    await commit(s, ["crush_rate", "crush_bits"].includes(key), true);
  });
listen("sample-name", "change", async (e) => {
  const s = selected();
  if (s) {
    s.name = e.target.value.trim() || "Untitled sample";
    await commit(s, false, true);
  }
});
listen("playback", "change", async (e) => {
  const s = selected();
  if (s) {
    audio.send({ type: "stopSample", slot: audio.slots.get(s.id) });
    s.playback = e.target.value;
    await commit(s, false, true);
  }
});
for (const key of ["level", "fx1", "fx2"])
  listen(key, "input", async (e) => {
    const s = selected();
    if (s) {
      s[key] = Number(e.target.value) / 100;
      $(key + "-value").value = e.target.value + "%";
      await audio.update(s);
      touch();
      changed();
    }
  });
for (const key of ["level", "fx1", "fx2"])
  listen(key, "change", () => {
    checkpoint(selected());
    paint();
  });
for (const [id, key, reprocess] of [
  ["max-velocity", "max_velocity", false],
  ["reverse", "reverse", true],
  ["normalize", "normalization", true],
])
  listen(id, "change", async (e) => {
    const s = selected();
    if (!s) return;
    s[key] =
      key === "normalization"
        ? e.target.checked
          ? [0, 1, 1]
          : null
        : e.target.checked;
    await commit(s, reprocess, true);
  });
listen("filter-mode", "change", async (e) => {
  const s = selected();
  if (s) {
    s.filter_mode = e.target.value;
    await commit(s, false, true);
  }
});
listen("filter-enabled", "change", async (e) => {
  const s = selected();
  if (s) {
    s.lpf_cutoff = e.target.checked ? 2000 : null;
    await commit(s, false, true);
  }
});
listen("cutoff", "input", async (e) => {
  const s = selected();
  if (!s) return;
  s.lpf_cutoff = cutoffValue(e.target.value, s.filter_mode);
  $("filter-enabled").checked = s.lpf_cutoff != null;
  syncFilterUI();
  await audio.update(s);
  touch();
  changed();
});
listen("resonance", "input", async (e) => {
  const s = selected();
  if (!s) return;
  s.lpf_resonance = Number(e.target.value);
  syncFilterUI();
  await audio.update(s);
  touch();
  changed();
});
for (const id of ["cutoff", "resonance"])
  listen(id, "change", () => {
    checkpoint(selected());
    ui.render(state, current(), learn);
  });
for (const [id, key] of [
  ["trim-start", "trim_start"],
  ["trim-end", "trim_end"],
  ["loop-start", "loop_start"],
  ["loop-end", "loop_end"],
])
  listen(id, "change", async (e) => {
    const s = selected();
    if (!s?.audio) return;
    const n = s.audio[0].length,
      frame = Math.round(Number(e.target.value) * RATE);
    if (!Number.isFinite(frame) || frame < 0 || frame > n) {
      waveFields();
      throw Error("Marker is outside the sample");
    }
    if (key === "trim_start") {
      if (frame >= s.trim_end) {
        waveFields();
        throw Error("Trim start must precede trim end");
      }
      s.trim_start = frame;
    }
    if (key === "trim_end") {
      if (frame <= s.trim_start) {
        waveFields();
        throw Error("Trim end must follow trim start");
      }
      s.trim_end = frame;
    }
    if (key === "loop_start") {
      if (frame >= (s.loop_end ?? s.trim_end)) {
        waveFields();
        throw Error("Loop start must precede loop end");
      }
      s.loop_start = frame;
      s.trim_start = Math.min(s.trim_start, frame);
    }
    if (key === "loop_end") {
      if (frame <= (s.loop_start ?? s.trim_start)) {
        waveFields();
        throw Error("Loop end must follow loop start");
      }
      s.loop_end = frame;
      s.trim_end = Math.max(s.trim_end, frame);
    }
    fitMarkers(s);
    await commit(s, !!s.normalization, true);
  });
listen("native-reset", "click", async () => {
  const s = selected();
  if (s?.audio) {
    if (
      current().dirty &&
      !(await discardGuard("Reset source edits and trim?", true))
    )
      return;
    Object.assign(s, {
      reverse: false,
      normalization: null,
      crush_rate: RATE,
      crush_bits: 32,
      trim_start: 0,
      trim_end: s.audio[0].length,
      loop_start: 0,
      loop_end: s.audio[0].length,
    });
    await commit(s, true, true);
  }
});
for (const [id, factor] of [
  ["zoom-in", 0.5],
  ["zoom-out", 2],
])
  listen(id, "click", () => wave.zoom(factor));
listen("zoom-fit", "click", () => wave.fit());
listen("wave-pan", "input", (e) => {
  const n = selected()?.audio?.[0]?.length ?? 1,
    span = wave.viewEnd - wave.viewStart;
  wave.panBy((Number(e.target.value) / 1000) * (n - span) - wave.viewStart);
});
async function undo(direction) {
  const s = selected(),
    h = history.get(s?.id);
  if (!h) return;
  const index = clamp(h.index + direction, 0, h.items.length - 1);
  if (index === h.index) return;
  h.index = index;
  Object.assign(s, structuredClone(h.items[index]));
  touch();
  changed();
  await audio.update(s, true);
  paint();
}
listen("undo", "click", () => undo(-1));
listen("redo", "click", () => undo(1));
async function saveSelectedSamples() {
  const ids = new Set(selectedIds()),
    samples = current().samples.filter((s) => ids.has(s.id) && s.audio);
  if (!samples.length) throw Error("Select loaded samples to save.");
  const name =
    samples.length === 1
      ? samples[0].name
      : `${current().name} - selected samples`;
  status("Packing selected raw WAVs and sample containers…");
  const result = await codec.exportSamples(samples, state);
  download(result, name + ".zip", "application/zip");
  status(
    `Saved ${samples.length} selected sample${samples.length === 1 ? "" : "s"} with raw WAVs and containers.`,
  );
}
async function offerAutoAssignment(count, samples) {
  const pc = state.source === "PC Keyboard";
  const area = $("keyboard-scroll"),
    middle = area.getBoundingClientRect().left + area.clientWidth / 2;
  const nearest = [...document.querySelectorAll(".piano-key")].sort(
    (a, b) =>
      Math.abs(
        a.getBoundingClientRect().left +
          a.getBoundingClientRect().width / 2 -
          middle,
      ) -
      Math.abs(
        b.getBoundingClientRect().left +
          b.getBoundingClientRect().width / 2 -
          middle,
      ),
  )[0];
  const options = pc
    ? {
        min: Math.max(0, 60 + state.octave * 12),
        max: Math.min(127, 74 + state.octave * 12),
        center: 67 + state.octave * 12,
      }
    : { center: Number(nearest?.dataset.note ?? 64) };
  const start = findFreeKeyBlock(samples, count, options);
  const dialog = document.createElement("dialog");
  dialog.id = "auto-assign-dialog";
  dialog.className = "editor";
  dialog.dataset.opened = String(performance.now());
  const heading = document.createElement("h2");
  heading.textContent = "Assign imported audio?";
  const message = document.createElement("p");
  message.textContent =
    start === null
      ? `No free block of ${count} keys fits ${pc ? "the current PC keyboard range" : "the piano"}. Load unassigned, or cancel and free some keys${pc ? " or change octave" : ""}.`
      : `Assign ${count} unassigned samples to ${noteName(start)}–${noteName(start + count - 1)} in file-name order? Existing assignments stay unchanged${pc ? "; this block fits the current PC keyboard range" : ""}.`;
  const actions = document.createElement("div");
  actions.className = "dialog-actions";
  dialog.append(heading, message, actions);
  document.body.append(dialog);
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    for (const [label, value] of [
      ["Auto assign", { start }],
      ["Keep unassigned", { start: null }],
      ["Cancel import", null],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.disabled = label === "Auto assign" && start === null;
      button.onclick = () => finish(value);
      actions.append(button);
    }
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      finish(null);
    });
    dialog.addEventListener("close", () => finish(null));
    dialog.showModal();
  });
}
function batchAssignable(item) {
  return !item.saved || !hasAssignedKeys(item.saved.programs[0].samples[0]);
}
async function applyLoadedBatch(source, items, start = 0, task = null) {
  const p = current(),
    replacements = mixedLoaded(source, items, start ?? 0);
  let assignmentIndex = 0;
  replacements.forEach((row, i) => {
    if (!items[i].saved) row.source_wav = items[i].source_wav ?? null;
    if (!batchAssignable(items[i])) return;
    if (start === null) unassign(row);
    else {
      unassign(row);
      row.key = start + assignmentIndex++;
    }
  });
  const notes = Array.from({ length: 128 }, (_, n) => n).filter((n) =>
      replacements.some((s) => assigned(s, n)),
    ),
    others = overlapping(p.samples, source, notes);
  const choice = others.length
    ? await collisionChoice(
        notes.filter((n) => others.some((s) => assigned(s, n))),
      )
    : "Multi-assign";
  if (task && learn !== task) return false;
  if (choice === "Cancel") {
    cancelLearning();
    status("Loading cancelled; existing rows were kept.");
    return false;
  }
  if (choice === "Override")
    for (const other of others) {
      audio.send({ type: "stopSample", slot: audio.slots.get(other.id) });
      unassign(other);
    }
  const shared = items.find((x) => x.saved)?.saved;
  if (shared) {
    state.fx = structuredClone(shared.fx);
    state.master = shared.master;
    audio.settings(state);
  }
  const index = p.samples.indexOf(source);
  p.samples.splice(index, 1, ...replacements);
  p.selected = replacements[0].id;
  rowSelection.select(p.selected);
  audio.forget(source.id);
  cancelLearning();
  for (const row of replacements) checkpoint(row);
  touch(p);
  paint();
  changed();
  await audio.syncProgram(p);
  status(
    `Loaded ${replacements.length} samples. Container settings were restored; imported audio ${start === null ? "is unassigned" : "uses consecutive keys"}.`,
  );
  return true;
}
async function addFiles(files) {
  if (busy || learn?.type === "batch-load")
    throw Error("Finish or cancel the current sample load first");
  if (!selected()) await newSample();
  const s = selected(),
    p = current();
  if (!s) return;
  if (files.length > 128)
    throw Error("Select at most 128 files so each can receive a MIDI key.");
  if (
    (s.audio || s.audio_dirty) &&
    p.dirty &&
    !(await discardGuard("Replace this sample row?", true))
  )
    return;
  cancelLearning();
  busy = true;
  try {
    const items = [];
    for (const file of sortedFiles(files)) {
      status("Loading " + file.name + "…");
      if (/\.nicosample$/i.test(file.name)) {
        const saved = await codec.import(file);
        items.push({ file, audio: saved.programs[0].samples[0].audio, saved });
      } else {
        let decoded,
          sourceWav = null;
        if (/\.wav$/i.test(file.name)) {
          try {
            sourceWav = new Uint8Array(await file.arrayBuffer());
            decoded = rawWave(sourceWav);
          } catch {
            sourceWav = null;
          }
        }
        decoded ??= await audio.decode(file);
        items.push({ file, audio: decoded, source_wav: sourceWav });
      }
    }
    const shared = items
      .filter((x) => x.saved)
      .map((x) => JSON.stringify({ fx: x.saved.fx, master: x.saved.master }));
    if (
      new Set(shared).size > 1 &&
      !(await discardGuard(
        "These containers have different shared FX/master settings. Use the first container’s shared settings for the loaded samples?",
        false,
      ))
    )
      return;
    const proposed = state.programs.map((p) => ({
      ...p,
      samples: p.samples.filter((x) => x !== s),
    }));
    proposed.push({
      samples: items.map((x) => ({
        audio: x.audio,
        source_wav: x.saved?.programs[0].samples[0].source_wav ?? x.source_wav,
      })),
    });
    if (audioBytes(proposed, state.takes ?? []) > 128 * 1048576)
      throw Error("128 MB audio budget reached");
    if (current() !== p || !p.samples.includes(s)) return;
    if (items.length === 1) {
      if (items[0].saved) {
        const incoming = items[0].saved.programs[0].samples[0];
        const notes = Array.from({ length: 128 }, (_, n) => n).filter((n) =>
          assigned(incoming, n),
        );
        const collisions = overlapping(p.samples, s, notes);
        if (collisions.length) {
          const choice = await collisionChoice(
            notes.filter((n) => collisions.some((row) => assigned(row, n))),
          );
          if (choice === "Cancel") {
            status("Import cancelled.");
            return;
          }
          if (choice === "Override")
            for (const row of collisions) unassign(row);
        }
        const saved = items[0].saved,
          id = s.id;
        Object.assign(s, saved.programs[0].samples[0], { id });
        state.fx = structuredClone(saved.fx);
        state.master = saved.master;
        audio.settings(state);
      } else
        Object.assign(s, singleLoaded(s, items[0].file, items[0].audio), {
          source_wav: items[0].source_wav ?? null,
        });
      audio.forget(s.id);
      history.delete(s.id);
      checkpoint(s);
      touch(p);
      await audio.prepare(s);
      paint();
      changed();
      await audio.syncProgram(p);
      status(
        `Loaded ${items[0].file.name} into ${s.name}. Assign a MIDI key to play it.`,
      );
    } else if (items.length) {
      if (p.samples.length - 1 + items.length > 512)
        throw Error("Maximum 512 rows");
      const assignableCount = items.filter(batchAssignable).length;
      if (assignableCount < 2) {
        await applyLoadedBatch(s, items, null);
        return;
      }
      const savedRows = items
        .filter(
          (x) => x.saved && hasAssignedKeys(x.saved.programs[0].samples[0]),
        )
        .map((x) => x.saved.programs[0].samples[0]);
      const assignment = await offerAutoAssignment(assignableCount, [
        ...p.samples.filter((row) => row !== s),
        ...savedRows,
      ]);
      if (assignment && current() === p)
        await applyLoadedBatch(s, items, assignment.start);
    }
  } finally {
    busy = false;
  }
}
listen("load-audio", "click", () => {
  $("audio-files").multiple = true;
  $("audio-files").click();
});
listen("audio-files", "change", async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  if (files.length) await addFiles(files);
});
async function loadDemo() {
  if (busy) return;
  const p = current();
  if (
    p.samples.length &&
    !(await discardGuard("Add the demo kit to the current program?", false))
  )
    return;
  const samples = demoSamples();
  const fresh = !state.programs.some((program) =>
    program.samples.some((s) => s.audio),
  );
  if (
    storedBytes() + samples.reduce((n, s) => n + s.audio[0].byteLength * 2, 0) >
    128 * 1048576
  )
    throw Error("Source-audio budget reached");
  if (p.samples.length + samples.length > 512) throw Error("Maximum 512 rows");
  if (p.samples.length === 1 && !p.samples[0].audio && p.samples[0].key == null)
    p.samples = [];
  p.samples.push(...samples);
  p.landing = false;
  if (fresh) {
    state.fx = structuredClone(EXAMPLE_FX);
    audio.settings(state);
  }
  touch(p);
  p.selected = samples[0].id;
  for (const s of samples) checkpoint(s);
  paint();
  changed();
  await audio.syncProgram(p);
  status(
    "Original 16-voice example kit loaded. A/S/D/F: kick/snare/closed/open hat; K/O/L: pad. Shift octaves for bass, pluck and bell.",
  );
}
listen("demo", "click", loadDemo);
listen("demo-empty", "click", loadDemo);
async function saveBank(only = false) {
  captureViewSettings();
  status("Packing original audio and settings…");
  const revisions = new Map(state.programs.map((p) => [p.id, p.revision ?? 0]));
  const saveIds = new Set(
      state.programs.filter((p) => !only || p === current()).map((p) => p.id),
    ),
    downloadName = only ? current().name : "Nico Sampler bank";
  const capturedTakes = new Set((state.takes ?? []).map((t) => t.id));
  const result = await codec.exportProject(state, only);
  download(result.bundle, downloadName + ".zip", "application/zip");
  if (!only)
    for (const t of state.takes ?? [])
      if (capturedTakes.has(t.id)) t.exported = true;
  for (const p of state.programs)
    if (saveIds.has(p.id) && (p.revision ?? 0) === revisions.get(p.id)) {
      p.dirty = false;
      for (const s of p.samples) s.audio_dirty = false;
    }
  paint();
  await persist();
  status(
    `Saved ${only ? "program" : "bank"} with original audio and reversible edits.`,
  );
}
listen("save-bank", "click", () => saveBank());
listen("save-program", "click", () => saveBank(true));
listen("open-bank", "click", () => {
  requestedLoadType = "sample_bank";
  $("bank-files").click();
});
let pendingImport = null;
let requestedLoadType = "sample_bank";
listen("bank-files", "change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (recording || armed || finishingRecording)
    throw Error("Finish recording before importing a program or bank.");
  if (busy) throw Error("Wait for the current import");
  busy = true;
  try {
    status(`Opening ${file.name}…`);
    const imported = await codec.import(file, requestedLoadType);
    if (imported.importType !== requestedLoadType)
      throw Error(
        requestedLoadType === "sample_program"
          ? "Unsupported sampler program. Choose Load Bank for a bank file."
          : "Unsupported sampler bank. Choose Load Program for a program file.",
      );
    const missing = [
      ...imported.programs.flatMap((p) => p.samples),
      ...(imported.pendingRecordings ?? []),
    ].filter((s) => !s.audio && s.audio_file);
    pendingImport = {
      state: imported,
      only: imported.importType === "sample_program",
      missing,
      fileName: file.name,
    };
    if (missing.length) {
      const relative = imported.asset_layout === "relative-v1";
      $("relink-empty").hidden = relative;
      $("relink-pick").hidden = relative;
      $("missing-files").textContent = missing
        .map((s) => s.audio_file)
        .join("\n");
      $("relink-dialog").showModal();
    } else await finishImport();
  } catch (error) {
    busy = false;
    pendingImport = null;
    throw error;
  }
});
function restoreColumnWidths() {
  const previousVersion = state.columnSizingVersion ?? 0;
  const migrate = previousVersion !== 4;
  if (previousVersion < 3) {
    state.columnManual = previousVersion >= 2 ? { ...state.columnManual } : {};
    delete state.columnManual[0];
  }
  if (previousVersion < 4) {
    // v4 places Level after Pan; keep every manual width attached to its column.
    const order = [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 5];
    state.columns =
      Array.isArray(state.columns) && state.columns.length >= 12
        ? order.map((index) => state.columns[index])
        : undefined;
    state.columnManual = Object.fromEntries(
      Object.entries(state.columnManual ?? {}).flatMap(([index, width]) => {
        const mapped = order.indexOf(Number(index));
        return mapped < 0 ? [] : [[mapped, width]];
      }),
    );
  }
  state.columnSizingVersion = 4;
  ui.restoreWidths(state.columns, state.columnManual);
  if (migrate) changed();
}
async function finishImport() {
  const item = pendingImport;
  if (!item) return;
  const incomingTakes = [
    ...(item.state.takes ?? []),
    ...(item.state.pendingRecordings ?? [])
      .filter((s) => s.audio)
      .map((s) => ({
        id: uid(),
        name: s.name,
        audio: s.audio,
        source_wav: s.source_wav,
        recording_format: s.recording_format,
        exported: true,
      })),
  ];
  const candidatePrograms = item.only
    ? [...state.programs, item.state.programs[0]]
    : item.state.programs;
  const candidateTakes = item.only
    ? [...(state.takes ?? []), ...incomingTakes]
    : incomingTakes;
  if (audioBytes(candidatePrograms, candidateTakes) > 128 * 1048576) {
    pendingImport = null;
    busy = false;
    throw Error(
      "Imported programs and local recordings exceed the 128 MB audio budget. Export/delete takes or use a smaller bank.",
    );
  }
  if (
    !item.only &&
    !(await discardGuard(
      "Really replace all open programs and local recordings with this bank?",
      unsavedWork(),
    ))
  ) {
    pendingImport = null;
    busy = false;
    status("Import cancelled.");
    return;
  }
  // Release the old input before replacing state, so pending capture cannot enter the new bank.
  if (inputMonitor?.active || inputMonitor?.wanted)
    await inputMonitor.deactivate("import");
  else if (inputConnected) await disconnectRecordingInput();
  stopAll();
  stopTrim();
  cancelLearning();
  stopTake();
  for (const dialog of document.querySelectorAll("dialog[open]"))
    dialog.close();
  if (item.only) {
    const p = item.state.programs[0];
    if (state.programs.length >= 128) throw Error("Maximum 128 programs");
    state.programs.push(p);
    state.current = p.id;
    state.fx = structuredClone(item.state.fx);
    state.master = item.state.master;
    state.takes = candidateTakes;
    applyPreferences(state, item.state);
    audio.settings(state);
  } else {
    state = item.state;
    state.takes = incomingTakes;
    take = null;
    takeWav = null;
    takeId = null;
    refreshTakes();
    history.clear();
  }
  restoreSavedSettings();
  pendingImport = null;
  busy = false;
  releaseHeld();
  audio.panic();
  audio.prepared.clear();
  audio.generations.clear();
  for (const p of state.programs) for (const s of p.samples) checkpoint(s);
  paint();
  restoreSavedView();
  changed();
  audio.settings(state);
  await audio.syncProgram(current());
  status(
    "Imported bank/program. Select a missing row and use Sample to load its audio.",
  );
}
listen("relink-pick", "click", () => $("relink-files").click());
listen("relink-folder", "click", () => $("project-folder").click());
listen("relink-files", "change", async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  if (!pendingImport) return;
  const lookup = new Map();
  for (const f of files) {
    const key = f.name.toLowerCase();
    if (lookup.has(key))
      throw Error(
        "Duplicate filenames selected. Relink one directory at a time.",
      );
    lookup.set(key, f);
  }
  for (const s of pendingImport.missing) {
    const name = s.audio_file
        .replace(/\\/g, "/")
        .split("/")
        .pop()
        .toLowerCase(),
      file = lookup.get(name);
    if (file && !s.audio) {
      const decoded = await audio.decode(file);
      const loaded = pendingImport.state.programs
        .flatMap((p) => p.samples)
        .reduce((n, s) => n + (s.audio?.[0]?.byteLength ?? 0) * 2, 0);
      if (loaded + decoded[0].byteLength * 2 > 128 * 1048576)
        throw Error("Legacy bank exceeds the 128 MB source-audio budget");
      s.audio = decoded;
      s.file_name = file.name;
      fitMarkers(s);
    }
  }
  const remaining = pendingImport.missing.filter((s) => !s.audio);
  $("missing-files").textContent = remaining
    .map((s) => s.audio_file)
    .join("\n");
  if (!remaining.length) {
    $("relink-dialog").close();
    await finishImport();
  } else status(`${remaining.length} referenced files still missing.`);
});
listen("relink-empty", "click", async () => {
  $("relink-dialog").close();
  await finishImport();
});
listen("relink-cancel", "click", () => {
  $("relink-dialog").close();
  pendingImport = null;
  busy = false;
  status("Import cancelled.");
});
$("relink-dialog").addEventListener("cancel", () => {
  pendingImport = null;
  busy = false;
});
// File drops are staged completely before changing the active session.
async function importLanding(files) {
  if (recording || armed || finishingRecording)
    throw Error("Finish recording before importing files.");
  if (busy) throw Error("Wait for the current import.");
  const target = current();
  const wasLanding = target.landing === true;
  busy = true;
  $("landing-drop").disabled = true;
  $("landing-new").disabled = true;
  $("landing-status").textContent = "Inspecting files…";
  status("Inspecting files…");
  try {
    const plan = await planLandingImport(files);
    const imported = [];
    const rows = [];
    for (const file of plan.kind === "samples"
      ? sortedFiles(plan.files)
      : plan.files) {
      $("landing-status").textContent = "Loading " + file.name + "…";
      status("Loading " + file.name + "…");
      if (plan.kind !== "samples" || /\.nicosample$/i.test(file.name)) {
        const saved = await codec.import(file);
        if (plan.kind === "samples") rows.push(...saved.programs[0].samples);
        else {
          const expected =
            plan.kind === "bank" ? "sample_bank" : "sample_program";
          if (saved.importType !== expected)
            throw Error(`${file.name} does not contain a valid ${plan.kind}.`);
          imported.push(saved);
        }
        if (plan.kind === "samples") imported.push(saved);
      } else {
        let source = null,
          decoded;
        if (/\.wav$/i.test(file.name)) {
          try {
            source = new Uint8Array(await file.arrayBuffer());
            decoded = rawWave(source);
          } catch {
            source = null;
          }
        }
        decoded ??= await audio.decode(file);
        const row = singleLoaded(
          newEmpty(file.name.replace(/\.[^.]+$/, "")),
          file,
          decoded,
        );
        row.source_wav = source;
        rows.push(row);
      }
    }
    // Loose WAVs can supply externally referenced assets; they do not become extra rows.
    for (const saved of imported) {
      for (const row of [
        ...saved.programs.flatMap((p) => p.samples),
        ...(saved.pendingRecordings ?? []),
      ]) {
        if (row.audio || !row.audio_file) continue;
        const path = row.audio_file.replace(/\\/g, "/");
        let matches = files.filter(
          (f) => (f.webkitRelativePath || f.name) === path,
        );
        if (!matches.length)
          matches = files.filter((f) => f.name === path.split("/").pop());
        if (matches.length !== 1)
          throw Error(
            `Missing or ambiguous referenced audio: ${row.audio_file}. Import the project ZIP or include its WAV files.`,
          );
        row.source_wav = new Uint8Array(await matches[0].arrayBuffer());
        row.audio = rawWave(row.source_wav);
        fitMarkers(row);
      }
      for (const t of saved.pendingRecordings ?? []) {
        if (t.audio)
          (saved.takes ??= []).push({ ...t, id: uid(), exported: true });
      }
    }
    const assignableRows = rows.filter((row) => !hasAssignedKeys(row));
    if (plan.kind === "samples" && assignableRows.length > 1) {
      const assignment = await offerAutoAssignment(assignableRows.length, [
        ...target.samples,
        ...rows.filter((row) => !assignableRows.includes(row)),
      ]);
      if (!assignment) {
        status("Import cancelled.");
        return;
      }
      assignableRows.forEach((row, i) => {
        if (assignment.start === null) unassign(row);
        else {
          row.key = assignment.start + i;
          row.root_note = null;
          row.low_note = row.high_note = null;
          row.spread_settings = null;
        }
      });
    }
    const existing = state.programs.filter((p) => !wasLanding || p !== target);
    const incomingPrograms = imported.flatMap((saved) => saved.programs);
    const nextPrograms =
      plan.kind === "bank"
        ? incomingPrograms
        : plan.kind === "program"
          ? [...existing, ...incomingPrograms]
          : state.programs.map((p) =>
              p === target ? { ...p, samples: [...p.samples, ...rows] } : p,
            );
    const incomingTakes =
      plan.kind === "samples" ? [] : imported.flatMap((s) => s.takes ?? []);
    const nextTakes =
      plan.kind === "bank"
        ? incomingTakes
        : [...(state.takes ?? []), ...incomingTakes];
    if (nextPrograms.length > 128) throw Error("Maximum 128 programs.");
    if (plan.kind === "samples" && target.samples.length + rows.length > 512)
      throw Error("Maximum 512 sample rows.");
    if (audioBytes(nextPrograms, nextTakes) > 128 * 1048576)
      throw Error("128 MB audio budget reached.");
    if (current() !== target)
      throw Error("The active program changed; import cancelled.");
    if (
      plan.kind === "bank" &&
      (!wasLanding || existing.length > 0 || unsavedWork()) &&
      !(await discardGuard(
        "Really replace all open programs and local recordings with this bank?",
        unsavedWork(),
      ))
    ) {
      $("landing-status").textContent = "Import cancelled.";
      status("Import cancelled.");
      return;
    }
    if (plan.kind !== "samples") {
      if (inputMonitor?.active || inputMonitor?.wanted)
        await inputMonitor.deactivate("import");
      else if (inputConnected) await disconnectRecordingInput();
    }
    if (plan.kind === "samples") {
      const notes = Array.from({ length: 128 }, (_, n) => n).filter((n) =>
        rows.some((row) => assigned(row, n)),
      );
      const collisions = overlapping(target.samples, null, notes);
      if (collisions.length) {
        const choice = await collisionChoice(
          notes.filter((n) => collisions.some((row) => assigned(row, n))),
        );
        if (choice === "Cancel") {
          status("Import cancelled.");
          return;
        }
        if (choice === "Override") for (const row of collisions) unassign(row);
      }
    }
    stopAll();
    stopTrim();
    cancelLearning();
    stopTake();
    for (const dialog of document.querySelectorAll("dialog[open]"))
      dialog.close();
    if (plan.kind === "bank") {
      take = null;
      takeWav = null;
      takeId = null;
      refreshTakes();
      state = imported[0];
      state.takes = nextTakes;
      restoreColumnWidths();
      history.clear();
    } else if (plan.kind === "program") {
      state.programs = nextPrograms;
      state.current = incomingPrograms[0].id;
      state.takes = nextTakes;
    } else {
      target.samples.push(...rows);
      target.selected = rows[0].id;
      target.landing = false;
      touch(target);
    }
    if (imported.length) {
      // FX/master belong to the bank, so use the first imported file consistently.
      state.fx = structuredClone(imported[0].fx);
      state.master = imported[0].master;
      if (plan.kind !== "samples") applyPreferences(state, imported[0]);
    }
    if (plan.kind !== "samples") restoreSavedSettings();
    for (const p of state.programs) {
      if (incomingPrograms.includes(p)) p.landing = false;
      for (const row of p.samples) checkpoint(row);
    }
    rowSelection.select(current().selected);
    releaseHeld();
    audio.panic();
    audio.prepared.clear();
    audio.generations.clear();
    paint();
    if (plan.kind !== "samples") restoreSavedView();
    changed();
    audio.settings(state);
    await audio.syncProgram(current());
    const sharedDiffer =
      imported.length > 1 &&
      new Set(
        imported.map((s) => JSON.stringify([s.fx, s.master, preferences(s)])),
      ).size > 1;
    const notice = [
      landingNotice(plan),
      sharedDiffer
        ? "These files have different shared application settings; the first file’s settings were used."
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    status(
      `Imported ${plan.kind === "samples" ? rows.length + " samples" : plan.files.length + " " + (plan.kind === "bank" ? "bank" : "programs")}. ${notice}`,
    );
    if (notice) {
      $("toast").textContent = notice;
      $("toast").hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => ($("toast").hidden = true), 12000);
    }
  } finally {
    busy = false;
    $("landing-drop").disabled = false;
    $("landing-new").disabled = false;
  }
}
listen("landing-new", "click", async () => {
  if (busy) return;
  const p = current();
  p.landing = false;
  p.selected = null;
  rowSelection.select(null);
  touch(p);
  paint();
  changed();
  await audio.syncProgram(p);
  status("Empty project. Add a row with + or drop files here.");
});
listen("landing-drop", "click", () => $("landing-files").click());
listen("landing-files", "change", async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  if (files.length) await importLanding(files);
});
// External file drops highlight the whole samples section wherever they enter.
let dragDepth = 0;
function clearFileDrag() {
  dragDepth = 0;
  document.body.classList.remove("drag-over");
}
document.addEventListener("dragenter", (e) => {
  if (!e.dataTransfer?.types.includes("Files")) return;
  e.preventDefault();
  dragDepth++;
  document.body.classList.add("drag-over");
});
document.addEventListener("dragover", (e) => {
  if (!e.dataTransfer?.types.includes("Files")) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
  document.body.classList.add("drag-over");
});
document.addEventListener("dragleave", (e) => {
  if (
    --dragDepth <= 0 ||
    e.clientX <= 0 ||
    e.clientY <= 0 ||
    e.clientX >= innerWidth ||
    e.clientY >= innerHeight
  )
    clearFileDrag();
});
window.addEventListener("blur", clearFileDrag);
document.addEventListener("dragend", clearFileDrag);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") clearFileDrag();
});
document.addEventListener("drop", (e) => {
  clearFileDrag();
  if (!e.dataTransfer?.files.length) return;
  e.preventDefault();
  void importLanding([...e.dataTransfer.files]).catch(report);
});
// MIDI follows device hotplug, channel filtering and velocity-zero note-off convention.
let midi = null;
let midiPermission = "prompt";
let midiConnection = null;
function refreshMidi() {
  const inputs = [...(midi?.inputs.values() ?? [])].filter(
    (input) => input.state !== "disconnected",
  );
  const connected = inputs.length > 0;
  $("input-routing-label").hidden = false;
  $("midi-channel-label").hidden =
    !connected ||
    ["None", "PC Keyboard"].includes(state.source ?? "PC Keyboard");
  $("connect-midi").hidden =
    !navigator.requestMIDIAccess ||
    Boolean(midi) ||
    midiPermission === "granted";
  $("connect-midi").textContent =
    midiPermission === "denied" ? "Allow MIDI" : "Connect MIDI";
  const value = state.source ?? "PC Keyboard";
  $("input-source").replaceChildren(
    option("PC Keyboard"),
    option("None"),
    option("all", "All MIDI inputs"),
  );
  for (const input of inputs) {
    $("input-source").append(option(input.id, input.name || "MIDI input"));
    input.onmidimessage = (e) => {
      if (
        performance.now() < midiMutedUntil ||
        current().landing ||
        !acceptsInput(state.source, "midi", input.id)
      )
        return;
      const [statusByte, note, velocity] = e.data,
        type = statusByte & 240,
        channel = (statusByte & 15) + 1;
      if (type === 144 && velocity > 0)
        void startNote(note, velocity, channel).catch(report);
      else if (type === 128 || type === 144) releaseNote(note, channel);
      else if (type === 176 && note === 64)
        audio.send({ type: "sustain", channel, down: velocity >= 64 });
      else if (type === 176 && [120, 123].includes(note)) stopAll();
    };
  }
  if (![...$("input-source").options].some((o) => o.value === value))
    $("input-source").append(option(value, "Saved MIDI input (disconnected)"));
  $("input-source").value = value;
  $("midi-status").textContent = "";
  syncControls();
}
async function connectMidi(interactive = false) {
  if (midiConnection) return midiConnection;
  if (!navigator.requestMIDIAccess) return;
  if (interactive && midiPermission === "denied") {
    throw Error(
      "MIDI is blocked. Open Chrome site settings, allow MIDI devices, then return here. PC Keyboard works without MIDI permission.",
    );
  }
  midiConnection = (async () => {
    try {
      const request = navigator.requestMIDIAccess({ sysex: false });
      if (interactive) void enable().catch(report);
      const access = await request;
      midi = access;
      midiPermission = "granted";
      midi.onstatechange = () => {
        stopAll();
        refreshMidi();
      };
      // Discovery never changes the selected note source.
      refreshMidi();
    } catch (error) {
      if (["NotAllowedError", "SecurityError"].includes(error?.name))
        midiPermission = "denied";
      refreshMidi();
      throw Error(
        midiPermission === "denied"
          ? "MIDI permission was denied. Allow MIDI in Chrome site settings. PC Keyboard remains available in Input."
          : `MIDI connection failed: ${error?.message || "unknown browser error"}`,
      );
    } finally {
      midiConnection = null;
    }
  })();
  return midiConnection;
}
listen("connect-midi", "click", () => connectMidi(true));
listen("midi-source", "change", stopAll);
async function initializeMidi() {
  refreshMidi();
  if (!navigator.requestMIDIAccess) return;
  try {
    const permission = await navigator.permissions.query({
      name: "midi",
      sysex: false,
    });
    const update = () => {
      midiPermission = permission.state;
      if (permission.state !== "granted" && midi) {
        for (const input of midi.inputs.values()) input.onmidimessage = null;
        midi.onstatechange = null;
        midi = null;
        stopAll();
      }
      refreshMidi();
      if (permission.state === "granted") void connectMidi().catch(report);
    };
    permission.onchange = update;
    update();
  } catch {
    // Older browsers may expose Web MIDI without its Permissions descriptor.
    midiPermission = "prompt";
    refreshMidi();
  }
}
void initializeMidi();
// Computer keyboard: do not capture typing or command shortcuts.
const keyMap = {
  a: 0,
  w: 1,
  s: 2,
  e: 3,
  d: 4,
  f: 5,
  t: 6,
  g: 7,
  z: 8,
  h: 9,
  u: 10,
  j: 11,
  k: 12,
  o: 13,
  l: 14,
};
function editing(target) {
  return (
    target instanceof Element &&
    target.closest(
      "textarea,[contenteditable=true],input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=file]):not([type=hidden])",
    )
  );
}
document.addEventListener(
  "keydown",
  (e) => {
    const key = e.key.toLowerCase();
    if (
      ui.phonePiano &&
      !ui.externalKeyboardSeen &&
      e.isTrusted &&
      !editing(e.target) &&
      !e.isComposing &&
      e.key !== "Unidentified"
    ) {
      ui.externalKeyboardSeen = true;
      paint();
    }
    if (current().landing && !document.querySelector("dialog[open]")) return;
    if (
      (e.metaKey || e.ctrlKey) &&
      key === "a" &&
      !editing(e.target) &&
      !$("trim-dialog").open &&
      !$("record-dialog").open
    ) {
      e.preventDefault();
      const p = current();
      rowSelection.reconcile(p);
      rowSelection.ids = new Set(p.samples.map((s) => s.id));
      paint();
      return;
    }
    if (e.key === "Escape") {
      if (e.target.matches?.("#recorded-takes-body input")) return;
      if (
        $("record-dialog").open &&
        (takeTable.selection.mode || takeTable.selection.ids.size > 1)
      ) {
        e.preventDefault();
        takeTable.collapse();
        return;
      }
      if (rowSelection.mode || selectedIds().size > 1) {
        rowSelection.select(current().selected);
        paint();
      }
      if (document.querySelector(".custom-options")) return;
      e.preventDefault();
      const top = [...document.querySelectorAll("dialog[open]")]
        .sort(
          (a, b) =>
            Number(a.dataset.opened ?? 0) - Number(b.dataset.opened ?? 0),
        )
        .at(-1);
      if (top) {
        if (top.id === "unsaved-dialog") {
          pendingGuard?.("cancel");
          return;
        }
        if (top.id === "collision-dialog") {
          resolveCollision?.("Cancel");
          return;
        }
        if (top.id === "replace-dialog") {
          resolveReplacement?.("Cancel");
          return;
        }
        if (["spread-dialog", "batch-dialog"].includes(top.id)) {
          cancelLearning();
          return;
        }
        if (top.id === "record-dialog") {
          void closeRecorder();
          return;
        }
        if (top.id === "trim-dialog") stopTrim();
        top.close();
        return;
      }
      if (learn) {
        cancelLearning();
        return;
      }
      return;
    }
    if (
      (e.metaKey || e.ctrlKey) &&
      key === "z" &&
      $("trim-dialog").open &&
      !editing(e.target)
    ) {
      e.preventDefault();
      void undo(e.shiftKey ? 1 : -1).catch(report);
      return;
    }
    if (
      (e.metaKey || e.ctrlKey) &&
      !e.altKey &&
      ["c", "x", "v"].includes(key) &&
      !$("record-dialog").open &&
      !editing(e.target)
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) {
        const programId = current().id,
          ids = new Set(selectedIds());
        clipboardQueue = clipboardQueue
          .catch(() => {})
          .then(() =>
            key === "v"
              ? pasteSelectedRows(programId)
              : copySelectedRows(key === "x", programId, ids),
          )
          .catch(report);
      }
      return;
    }
    if (
      (e.metaKey || e.ctrlKey) &&
      !e.altKey &&
      key === "d" &&
      !editing(e.target) &&
      !document.querySelector("dialog[open]")
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) void duplicateSelectedRows().catch(report);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && key === "s" && !editing(e.target)) {
      e.preventDefault();
      void saveBank().catch(report);
      return;
    }
    if (
      e.code === "Space" &&
      !$("trim-dialog").open &&
      !$("record-dialog").open &&
      !editing(e.target) &&
      !e.shiftKey &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) void previewSelection().catch(report);
      return;
    }
    if ($("record-dialog").open) {
      if (["F8", "F9", "F10"].includes(e.key)) {
        e.preventDefault();
        if (e.key === "F8") safe(previewTakes());
        else if (e.key === "F9" && !recording) safe(beginRecord(false));
        else if (e.key === "F10") audio.send({ type: "recordStop" });
        return;
      }
      if (e.code === "Space" && !editing(e.target)) {
        e.preventDefault();
        if (e.repeat) return;
        if (e.shiftKey) {
          if (armed) audio.send({ type: "recordStop" });
          else if (!recording) safe(beginRecord(true));
        } else if (recording) audio.send({ type: "recordStop" });
        else if (takeTable.selected().length) safe(previewTakes());
        else safe(beginRecord(false));
        return;
      }
    }
    if ($("trim-dialog").open && e.code === "Space" && !editing(e.target)) {
      e.preventDefault();
      if (!e.repeat && !e.shiftKey) void playTrim(true).catch(report);
      return;
    }
    if (editing(e.target) || e.metaKey || e.ctrlKey || e.altKey || e.repeat)
      return;
    if (
      (e.key === "ArrowUp" || e.key === "ArrowDown") &&
      !e.target.closest(
        "[role=combobox],[role=listbox],[role=option],[role=slider],input[type=range],#filter-canvas",
      )
    ) {
      e.preventDefault();
      const p = current(),
        i = p.samples.findIndex((s) => s.id === p.selected),
        row =
          p.samples[
            clamp(i + (e.key === "ArrowUp" ? -1 : 1), 0, p.samples.length - 1)
          ];
      if (row) select(row.id);
      return;
    }
    if (key in keyMap && acceptsInput(state.source, "pc")) {
      const note = 60 + state.octave * 12 + keyMap[key];
      if (note < 0 || note > 127) return;
      e.preventDefault();
      held.set(e.code, { note, channel: 0 });
      void startNote(note).catch(report);
    }
  },
  true,
);
document.addEventListener("keyup", (e) => {
  if (e.code === "Space" && trimLoopHeld) {
    e.preventDefault();
    releaseTrim();
  }
  const item = held.get(e.code);
  if (item) {
    held.delete(e.code);
    releaseNote(item.note, item.channel);
  }
});
window.addEventListener("blur", () => {
  releaseHeld();
  if (trimLoopHeld) releaseTrim();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    releaseHeld();
    void persist();
  }
});
window.addEventListener("beforeunload", (e) => {
  if (!approvedClose && unsavedWork()) {
    e.preventDefault();
    e.returnValue = "";
  }
});
window.addEventListener("pagehide", () => {
  releaseHeld();
  void persist();
});
function shiftOctave(d) {
  releaseHeld();
  state.octave = clamp(state.octave + d, -5, 5);
  touch();
  paintKeyboard();
  changed();
}
listen("octave-down", "click", () => shiftOctave(-1));
listen("octave-up", "click", () => shiftOctave(1));
// Recording keeps the hardware input disconnected from audible output.
let recChunks = [],
  take = null,
  takeWav = null,
  recordingFormat = null,
  takeId = null,
  recording = false,
  finishingRecording = false,
  armed = false,
  inputConnected = false,
  inputConnecting = null,
  inputConnectionEpoch = 0,
  recordStart = 0,
  takePlayers = new Map(),
  takePreviewPending = new Set(),
  takePreviewEpoch = 0,
  takeTable = null;
let recordDestination = null;
const recordingFinishedWaiters = new Set();
async function finishActiveCapture() {
  if (recording || armed) {
    finishingRecording = true;
    audio.send({ type: "recordStop" });
    recording = armed = false;
    updateRecordButtons();
  }
  if (finishingRecording)
    await new Promise((resolve) => recordingFinishedWaiters.add(resolve));
}
async function disconnectRecordingInput() {
  $("record-monitor").checked = false;
  audio.setInputMonitoring(false);
  inputConnectionEpoch++;
  await finishActiveCapture();
  await audio.disconnectInput();
  inputConnected = false;
  updateRecordButtons();
}
inputMonitor = new InputMonitor({
  button: $("input-monitor"),
  meter: $("input-monitor-control"),
  getLatency: () => ({
    baseLatency: audio.context?.baseLatency,
    outputLatency: audio.context?.outputLatency,
  }),
  onEnable: async () => {
    if (inputConnected) return true;
    restoreRecordingSettings();
    return connectRecordingInput({ monitor: true });
  },
  onDisable: async () => disconnectRecordingInput(),
  onAutoDisable: () => {
    const message =
      "Input monitoring deactivated because browser-reported audio latency increased. Any active recording was stopped first.";
    status(message);
    $("toast").textContent = message;
    $("toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($("toast").hidden = true), 12000);
  },
  onState: () => updateRecordButtons(),
  onError: report,
});
let recorderOwnsMonitor = false;
listen("record-open", "click", async () => {
  if (finishingRecording)
    throw Error("Wait for the recording to finish processing.");
  if ($("record-dialog").open) {
    $("record-dialog").focus();
    return;
  }
  const s = selected();
  recordDestination = {
    programId: current().id,
    sampleId: s?.id ?? null,
    makeNew: true,
  };
  $("record-monitor").checked = false;
  audio.setInputMonitoring(false);
  recorderOwnsMonitor = !inputMonitor.active && !inputMonitor.wanted;
  restoreRecordingSettings();
  refreshTakes();
  drawThreshold();
  $("record-dialog").show();
  $("record-dialog").dataset.opened = String(performance.now());
  void refreshRecordingDevices();
  await inputMonitor.activate();
  audio.send({ type: "inputMode", mode: state.record.mode });
});
async function closeRecorder() {
  $("record-monitor").checked = false;
  audio.setInputMonitoring(false);
  stopTake();
  await finishActiveCapture();
  if (recorderOwnsMonitor) await inputMonitor.deactivate();
  if (!inputMonitor.active && inputConnected) await disconnectRecordingInput();
  recorderOwnsMonitor = false;
  $("record-dialog").close();
  updateRecordButtons();
}
listen("record-close", "click", closeRecorder);
$("record-dialog").addEventListener("cancel", () => {
  void closeRecorder().catch(report);
});
const SYSTEM_AUDIO_DEVICE = "__system_audio__";
function populateRecordingDevices(devices) {
  const preferred = state.record.device ?? "";
  const inputs = devices.filter((d) => d.kind === "audioinput");
  $("record-device").replaceChildren(
    option("", "System default"),
    ...inputs.map((d, i) =>
      option(d.deviceId, d.label || `Audio input ${i + 1}`),
    ),
    option(SYSTEM_AUDIO_DEVICE, "Share tab / system audio…"),
  );
  if (
    preferred &&
    ![...$("record-device").options].some((o) => o.value === preferred)
  )
    $("record-device").append(
      option(preferred, "Saved input (unavailable; using default)"),
    );
  $("record-device").value =
    $("record-source").value === "system" ? SYSTEM_AUDIO_DEVICE : preferred;
  syncControls();
}
async function refreshRecordingDevices() {
  try {
    populateRecordingDevices(
      (await navigator.mediaDevices?.enumerateDevices()) ?? [],
    );
  } catch {
    populateRecordingDevices([]);
  }
}
navigator.mediaDevices?.addEventListener?.(
  "devicechange",
  () => void refreshRecordingDevices(),
);
async function connectRecordingInput({ monitor = false } = {}) {
  if (recording || armed || finishingRecording)
    throw Error("Finish recording before changing input.");
  if (inputConnecting) return inputConnecting;
  const epoch = ++inputConnectionEpoch;
  const source = $("record-source").value,
    chosen =
      source === "system"
        ? (state.record.device ?? "")
        : $("record-device").value;
  if (state.record.source !== source || state.record.device !== chosen) {
    state.record.source = source;
    state.record.device = chosen;
    touch();
    changed();
  }
  inputConnected = false;
  $("record-status").textContent = "Connecting input…";
  // Invoke the browser sharing picker within the selection click's activation.
  const sharedCapture = source === "system" ? requestSystemAudio() : null;
  sharedCapture?.catch(() => {});
  inputConnecting = (async () => {
    try {
      // Capture may be the first audio gesture; upload the current program too.
      await enable();
      let devices,
        fallback = false;
      try {
        devices = await audio.connectInput(
          source,
          chosen,
          $("record-mode").value,
          sharedCapture,
        );
      } catch (error) {
        if (
          source !== "mic" ||
          !chosen ||
          !["NotFoundError", "OverconstrainedError"].includes(error.name)
        )
          throw error;
        devices = await audio.connectInput(source, "", $("record-mode").value);
        fallback = true;
      }
      if (
        epoch !== inputConnectionEpoch ||
        (!monitor && !inputMonitor?.active && !$("record-dialog").open)
      ) {
        await audio.disconnectInput();
        return false;
      }
      populateRecordingDevices(devices);
      inputConnected = true;
      if ($("record-dialog").open && !inputMonitor.active && !inputMonitor.busy)
        await inputMonitor.activate();
      audio.send({ type: "inputMode", mode: $("record-mode").value });
      $("record-status").textContent = fallback
        ? "Saved input unavailable; using system default. Saved preference retained."
        : "Input connected. Ready to record.";
      state.record.device = chosen;
      changed();
      return true;
    } catch (error) {
      inputConnected = false;
      $("record-status").textContent =
        "Input unavailable. Choose a source/device, or press Record or Arm to retry.";
      if (error.name === "NotAllowedError")
        throw Error(
          "Recording permission denied or sharing cancelled. Press Record or Arm to retry after allowing access.",
        );
      throw error;
    } finally {
      if (!inputConnected && sharedCapture)
        void sharedCapture
          .then((stream) => stream.getTracks().forEach((track) => track.stop()))
          .catch(() => {});
      inputConnecting = null;
      updateRecordButtons();
    }
  })();
  updateRecordButtons();
  return inputConnecting;
}
listen("record-source", "change", () => {
  $("record-device").value =
    $("record-source").value === "system"
      ? SYSTEM_AUDIO_DEVICE
      : (state.record.device ?? "");
  return connectRecordingInput();
});
listen("record-device", "change", () => {
  $("record-source").value =
    $("record-device").value === SYSTEM_AUDIO_DEVICE ? "system" : "mic";
  return connectRecordingInput();
});
function updateRecordButtons() {
  const locked = recording || armed || finishingRecording;
  $("record-start").disabled = locked || !!inputConnecting;
  $("record-arm").disabled = locked || !!inputConnecting;
  $("record-stop").disabled = !recording && !armed;
  $("record-start").hidden = recording || armed || finishingRecording;
  $("record-arm").hidden = recording || armed || finishingRecording;
  $("record-stop").hidden = !recording && !armed && !finishingRecording;
  $("record-stop").textContent = finishingRecording
    ? "Finishing…"
    : armed
      ? "Listening…"
      : "Stop";
  for (const id of [
    "record-source",
    "record-device",
    "record-mode",
    "record-rate",
    "record-bits",
  ])
    $(id).disabled =
      locked ||
      (!!inputConnecting &&
        ["record-source", "record-device", "record-mode"].includes(id));
  takeTable?.render();
  $("record-open").disabled = finishingRecording;
  $("record-open").classList.toggle("active", locked);
  syncControls();
}
listen("takes-select", "click", () => {
  if (takeTable.selection.mode) takeTable.collapse();
  else {
    takeTable.selection.enter(takeTable.primary, true);
    takeTable.render();
  }
});
async function beginRecord(arm) {
  if (recording || armed || finishingRecording)
    throw Error("Wait for the current recording to finish.");
  if ((state.takes ?? []).length >= 512)
    throw Error("Maximum 512 recorded takes. Delete a take before recording.");
  if (!inputConnected && !(await connectRecordingInput())) return;
  if (recording || armed || finishingRecording)
    throw Error("Wait for the current recording to finish.");
  stopTake();
  take = null;
  takeWav = null;
  takeId = null;
  recChunks = [];
  refreshTakes();
  recordingFormat = {
    sample_rate: Number($("record-rate").value),
    bit_depth: Number($("record-bits").value),
    channels: $("record-mode").value === "Stereo" ? 2 : 1,
  };
  const threshold = Number(state.record.threshold ?? -24);
  if (!Number.isFinite(threshold) || threshold < -60 || threshold > 0)
    throw Error("Threshold must be -60–0 dB");
  state.record = {
    ...state.record,
    sample_rate: recordingFormat.sample_rate,
    bit_depth: recordingFormat.bit_depth,
    device: $("record-device").value,
    mode: $("record-mode").value,
    threshold,
  };
  recording = !arm;
  armed = arm;
  recordStart = performance.now();
  const bytesPerSecond =
    RATE * 8 +
    recordingFormat.sample_rate *
      recordingFormat.channels *
      Math.ceil(recordingFormat.bit_depth / 8);
  const maxSeconds = Math.min(
    180,
    (128 * 1048576 - storedBytes() - 65536) / bytesPerSecond,
  );
  if (maxSeconds < 0.05) {
    recording = armed = false;
    updateRecordButtons();
    throw Error(
      "Audio storage is full. Delete samples or takes before recording.",
    );
  }
  audio.send({
    type: "record",
    mode: state.record.mode,
    threshold,
    arm,
    maxSeconds,
  });
  $("record-status").textContent = arm
    ? "Armed · waiting for threshold…"
    : "Recording…";
  updateRecordButtons();
  changed();
}
listen("record-start", "click", () => beginRecord(false));
listen("record-arm", "click", () => beginRecord(true));
listen("record-stop", "click", () => audio.send({ type: "recordStop" }));
takeTable = new RecordedTakesTable($("recorded-takes-body"), {
  entries: () => state.takes ?? [],
  open: () => $("record-dialog").open,
  locked: () => recording || armed || finishingRecording,
  playing: (id) => takePlayers.has(id) || takePreviewPending.has(id),
  play: (entries) => safe(previewTakes(entries)),
  rename: (entry, name) => {
    entry.name = name;
    entry.exported = false;
    touch();
    changed();
  },
  remove: (entry) => {
    stopTake(entry.id);
    state.takes = (state.takes ?? []).filter((t) => t.id !== entry.id);
    touch();
    if (takeId === entry.id) {
      take = null;
      takeWav = null;
      takeId = null;
    }
    changed();
  },
  selectionChanged: (entries) => {
    $("take-use").disabled =
      !entries.length || recording || armed || finishingRecording;
    $("take-use").textContent =
      entries.length > 1 ? "Use Recordings" : "Use Recording";
    if (!recording && !armed && !finishingRecording) {
      const entry = entries.at(-1);
      take = entry?.audio ?? null;
      takeWav = entry?.source_wav ?? null;
      takeId = entry?.id ?? null;
    }
  },
});
function stopTake(id = null) {
  takePreviewEpoch++;
  if (id) takePreviewPending.delete(id);
  else takePreviewPending.clear();
  for (const [key, player] of takePlayers) {
    if (id && key !== id) continue;
    takePlayers.delete(key);
    player.source.onended = null;
    try {
      player.source.stop();
    } catch {}
    player.gain.disconnect();
  }
  takeTable?.updatePlayback();
}
async function previewTakes(entries = takeTable.selected()) {
  if (recording || armed || finishingRecording || !entries.length) return;
  if (
    entries.some((t) => takePlayers.has(t.id) || takePreviewPending.has(t.id))
  ) {
    for (const entry of entries) stopTake(entry.id);
    return;
  }
  const epoch = ++takePreviewEpoch;
  for (const entry of entries) takePreviewPending.add(entry.id);
  takeTable.updatePlayback();
  try {
    await enable();
  } catch (error) {
    for (const entry of entries) takePreviewPending.delete(entry.id);
    takeTable.updatePlayback();
    throw error;
  }
  if (epoch !== takePreviewEpoch) {
    for (const entry of entries) takePreviewPending.delete(entry.id);
    takeTable.updatePlayback();
    return;
  }
  for (const entry of entries) takePreviewPending.delete(entry.id);
  for (const entry of entries) {
    const buffer = audio.context.createBuffer(2, entry.audio[0].length, RATE);
    buffer.copyToChannel(entry.audio[0], 0);
    buffer.copyToChannel(entry.audio[1], 1);
    const source = audio.context.createBufferSource(),
      gain = audio.context.createGain();
    source.buffer = buffer;
    gain.gain.value = state.master;
    source.connect(gain);
    gain.connect(audio.node, 0, 1);
    takePlayers.set(entry.id, { source, gain });
    source.onended = () => {
      if (takePlayers.get(entry.id)?.source === source)
        takePlayers.delete(entry.id);
      gain.disconnect();
      takeTable.updatePlayback();
    };
    source.start();
  }
  takeTable.updatePlayback();
}
async function useTake() {
  if (recording || armed || finishingRecording) return;
  const entries = takeTable.selected();
  if (!entries.length) return;
  const p =
    state.programs.find((p) => p.id === recordDestination?.programId) ??
    current();
  if (p.samples.length + entries.length > 512) throw Error("Maximum 512 rows");
  for (const entry of entries) {
    const s = {
      ...newEmpty(),
      name: entry.name,
      audio: entry.audio,
      source_wav: entry.source_wav,
      recording_format: entry.recording_format,
      file_name: entry.name + ".wav",
      trim_start: 0,
      trim_end: entry.audio[0].length,
      loop_start: 0,
      loop_end: entry.audio[0].length,
      crush_rate: Math.min(entry.recording_format?.sample_rate ?? RATE, RATE),
      crush_bits: entry.recording_format?.bit_depth ?? 32,
      level: 0.5,
      audio_dirty: false,
    };
    p.samples.push(s);
    p.selected = s.id;
    checkpoint(s);
  }
  touch(p);
  await closeRecorder();
  paint();
  changed();
  await audio.syncProgram(p);
  status("Recordings added. Original takes remain in the recorder.");
}
listen("take-use", "click", useTake);
listen("record-monitor", "change", () =>
  audio.setInputMonitoring(
    $("record-monitor").checked,
    state.record.gain_db ?? 0,
    state.master,
  ),
);
async function finishRecording(m) {
  finishingRecording = true;
  recording = armed = false;
  const format = {
    ...(recordingFormat ?? { sample_rate: 44100, bit_depth: 16, channels: 2 }),
  };
  updateRecordButtons();
  $("record-status").textContent = "Finishing recording…";
  try {
    if (!m.frames) {
      $("record-status").textContent = "No audio recorded.";
      return;
    }
    const combined = new Float32Array(
      recChunks.reduce((n, c) => n + c.length, 0),
    );
    let offset = 0;
    for (const chunk of recChunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    recChunks = [];
    const frames = combined.length / 2,
      l = new Float32Array(frames),
      r = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      l[i] = combined[i * 2];
      r[i] = combined[i * 2 + 1];
    }
    let converted = [l, r];
    if (m.rate !== format.sample_rate) {
      const ctx = new OfflineAudioContext(
          2,
          Math.max(1, Math.ceil((frames * format.sample_rate) / m.rate)),
          format.sample_rate,
        ),
        buffer = ctx.createBuffer(2, frames, m.rate);
      buffer.copyToChannel(l, 0);
      buffer.copyToChannel(r, 1);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start();
      const result = await ctx.startRendering();
      converted = [
        result.getChannelData(0).slice(),
        result.getChannelData(1).slice(),
      ];
    }
    const finishedWav = encodePcmWav(
      converted,
      format.sample_rate,
      format.bit_depth,
      format.channels,
    );
    const finishedTake = rawWave(finishedWav);
    takeWav = finishedWav;
    take = finishedTake;
    recordingFormat = { ...format };
    takeId = uid();
    (state.takes ??= []).push({
      id: takeId,
      name: `Take ${new Date().toLocaleTimeString()}`,
      audio: take,
      source_wav: takeWav,
      recording_format: { ...format },
    });
    changed();
    if (storedBytes() > 128 * 1048576)
      report(
        Error(
          "Take retained in the recorder. Free audio storage before saving the bank.",
        ),
      );
    takeTable.selection.select(takeId);
    takeTable.primary = takeId;
    refreshTakes();
    $("record-status").textContent = m.limited
      ? "Recording limit reached. Take stored."
      : "Take stored. Play, rename or select recordings below.";
  } finally {
    finishingRecording = false;
    for (const resolve of recordingFinishedWaiters) resolve();
    recordingFinishedWaiters.clear();
    updateRecordButtons();
  }
}
function refreshTakes() {
  takeTable.render();
  syncControls();
}
function audioEvent(m) {
  updateBaseLatency();
  if (m.type === "error" || m.type === "fatal") {
    report(Error(m.message));
    if (m.type === "fatal") {
      $("enable-audio").hidden = false;
      $("enable-audio").textContent = "Reload to restart";
    }
  } else if (m.type === "meter") {
    for (const [id, token] of auditions) {
      if (m.positions[id] != null) token.seen = true;
      else if (
        !token.pending &&
        (token.seen || performance.now() - token.started > 250)
      )
        auditions.delete(id);
      const button = document.querySelector(`[data-id="${id}"] .row-preview`);
      if (button) {
        setRowPreviewIcon(button, auditions.has(id));
        button.setAttribute(
          "aria-label",
          `${auditions.has(id) ? "Stop" : "Play"} sample`,
        );
      }
    }
    updateMeters(m.peak, m.inputPeak);
    $("engine-status").textContent = `${m.voices} voices · C++ / WASM`;
    // Sounding voices can outlive key-up (one-shots, release tails and sustain).
    // Piano highlights represent input presses only; row LEDs still show playback.
    paintPressed();
    document
      .querySelectorAll("[data-id]")
      .forEach((el) =>
        el.classList.toggle("playing", m.positions[el.dataset.id] != null),
      );
    wave.position =
      m.positions["trim-preview"] ?? m.positions[selected()?.id] ?? -1;
    wave.draw();
    if (recording)
      $("record-status").textContent =
        `Recording · ${((performance.now() - recordStart) / 1000).toFixed(1)} s`;
  } else if (m.type === "state") {
    $("enable-audio").hidden = m.state === "running";
    $("enable-audio").textContent = "Resume audio";
    if (m.state !== "running")
      status("Audio paused by browser. Tap Resume audio.");
  } else if (m.type === "recordChunk") recChunks.push(m.audio);
  else if (m.type === "recordStarted") {
    recording = true;
    armed = false;
    recordStart = performance.now();
    updateRecordButtons();
    $("record-status").textContent = "Recording…";
  } else if (m.type === "recordDone") void finishRecording(m).catch(report);
  else if (m.type === "inputEnded") {
    $("record-monitor").checked = false;
    audio.setInputMonitoring(false);
    if (inputMonitor?.active) safe(inputMonitor.deactivate("input-ended"));
    inputConnected = false;
    updateRecordButtons();
    status("Recording input disconnected.");
  }
}
listen("help", "click", () => $("help-dialog").showModal());
listen("help-close", "click", () => $("help-dialog").close());
listen("persistent-storage", "click", async () => {
  const granted = await navigator.storage?.persist?.();
  status(
    granted
      ? "Persistent storage granted. Keep downloading bank backups."
      : "Browser did not grant persistent storage. Download banks for backups.",
  );
});
listen("reset-session", "click", async () => {
  if (
    !(await discardGuard(
      "Clear every program and sample from this local session?",
    ))
  )
    return;
  if (inputMonitor?.active || inputMonitor?.wanted)
    await inputMonitor.deactivate("reset");
  else if (inputConnected || recording || armed || finishingRecording)
    await disconnectRecordingInput();
  for (const dialog of document.querySelectorAll("dialog[open]"))
    dialog.close();
  stopAll();
  clearTimeout(saveTimer);
  await saveChain.catch(() => {});
  await clearRecovery();
  state = session();
  state.source = "PC Keyboard";
  state.programs[0].landing = true;
  stopTake();
  take = null;
  takeWav = null;
  takeId = null;
  refreshTakes();
  history.clear();
  audio.prepared.clear();
  audio.generations.clear();
  paint();
  audio.settings(state);
  await audio.syncProgram(current());
  changed();
  status("Started a new session.");
});
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  $("install").hidden = false;
});
listen("install", "click", async () => {
  if (installPrompt) {
    await installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    $("install").hidden = true;
  }
});

async function boot() {
  try {
    view =
      localStorage.getItem("nico-rack-view") === "table" ? "table" : "pads";
  } catch {}
  paint();
  // Project launchers can open the browser sampler with a same-origin or
  // localhost URL to a native .sampler.zip bundle.  This keeps conversion and
  // playback in the GitHub sampler format; the helper only serves the bundle.
  const launchUrl = new URLSearchParams(location.search).get("projectUrl");
  if (launchUrl) {
    try {
      const response = await fetch(launchUrl, { cache: "no-store" });
      if (!response.ok) throw Error(`Project download failed (${response.status})`);
      const blob = await response.blob();
      const name = decodeURIComponent(launchUrl.split("/").pop() || "project.sampler.zip");
      await importLanding([new File([blob], name, { type: "application/zip" })]);
      history.replaceState({}, "", location.pathname);
    } catch (error) {
      report(Error("The browser sampler could not load this project: " + error.message));
    }
  }
  try {
    const saved = await loadRecovery();
    if (saved) {
      // Validate metadata before accepting a persisted session, retaining browser-local PCM separately.
      const clean = validateBank({
        type: "sample_bank",
        version: 3,
        currentIndex: Math.max(
          0,
          saved.programs.findIndex((p) => p.id === saved.current),
        ),
        fx: saved.fx,
        octave: saved.octave,
        master: saved.master,
        record: saved.record,
        preferences: preferences(saved),
        programs: saved.programs.map((p) => ({
          ...p,
          selected: p.samples.findIndex((s) => s.id === p.selected),
        })),
      });
      for (let i = 0; i < clean.programs.length; i++)
        for (let j = 0; j < clean.programs[i].samples.length; j++) {
          const s = clean.programs[i].samples[j],
            raw = saved.programs[i].samples[j];
          s.audio = raw.audio;
          fitMarkers(s);
        }
      for (let i = 0; i < clean.programs.length; i++) {
        const legacyEmpty = isLegacyEmptyProgram(saved.programs[i]);
        clean.programs[i].landing =
          saved.programs[i].landing === true || legacyEmpty;
        if (legacyEmpty) {
          clean.programs[i].samples = [];
          clean.programs[i].selected = null;
        }
        clean.programs[i].dirty = !!saved.programs[i].dirty;
        clean.programs[i].revision = Number.isFinite(saved.programs[i].revision)
          ? saved.programs[i].revision
          : 0;
      }
      clean.takes = validateTakes(saved.takes ?? []);
      if (audioBytes(clean.programs, clean.takes) > 128 * 1048576)
        throw Error("Recovered audio exceeds the memory budget");
      state = clean;
      restoreSavedSettings();
      for (const p of state.programs) for (const s of p.samples) checkpoint(s);
      paint();
      restoreSavedView();
      status("Recovered your local session. Enable audio to play.");
      await audio.syncProgram(current());
    }
  } catch (error) {
    report(
      Error(
        "Recovery could not be loaded; saved data was preserved. " +
          error.message,
      ),
    );
  }
}
function drawEditorPreviews() {
  const s = selected();
  if (!s) return;
  const c = $("envelope-canvas");
  if (c) {
    const ctx = c.getContext("2d"),
      w = c.width,
      h = c.height,
      duration = s.audio ? ((bounds(s)[1] - bounds(s)[0]) / RATE) * 1000 : 1000;
    ctx.clearRect(0, 0, w, h);
    const a = Math.min(s.attack_ms, duration) / Math.max(1, duration),
      d = Math.min(s.decay_ms, duration) / Math.max(1, duration);
    const px = (20 * w) / (c.clientWidth || w),
      py = (20 * h) / (c.clientHeight || h);
    const attackX = px + a * (w - 2 * px),
      decayX = w - px - d * (w - 2 * px);
    ctx.strokeStyle = "#b7e991";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, h - py);
    ctx.lineTo(attackX, py);
    ctx.lineTo(decayX, py);
    ctx.lineTo(w - px, h - py);
    ctx.stroke();
    for (const x of [attackX, decayX]) {
      ctx.beginPath();
      ctx.ellipse(
        x,
        py,
        (16 * w) / (c.clientWidth || w),
        (16 * h) / (c.clientHeight || h),
        0,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = "#b7e991";
      ctx.fill();
    }
  }
  drawFilter($("filter-canvas"), s);
}

let envelopeDragging = null;
if ($("envelope-canvas")) {
  const c = $("envelope-canvas");
  c.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const s = selected();
    if (!s) return;
    const r = c.getBoundingClientRect(),
      duration = s.audio ? ((bounds(s)[1] - bounds(s)[0]) / RATE) * 1000 : 1000,
      x = clamp((e.clientX - r.left - 20) / (r.width - 40), 0, 1),
      attack = s.attack_ms / Math.max(1, duration),
      decay = 1 - s.decay_ms / Math.max(1, duration);
    envelopeDragging =
      Math.abs(x - attack) <= Math.abs(x - decay) ? "attack_ms" : "decay_ms";
    c.setPointerCapture(e.pointerId);
    dragEnvelope(e);
  });
  c.addEventListener("pointermove", (e) => {
    if (envelopeDragging) dragEnvelope(e);
  });
  for (const type of ["pointerup", "pointercancel"])
    c.addEventListener(type, () => {
      if (envelopeDragging) {
        envelopeDragging = null;
        safe(commit(selected(), false, true));
      }
    });
  function dragEnvelope(e) {
    const s = selected(),
      r = c.getBoundingClientRect(),
      duration = s.audio ? ((bounds(s)[1] - bounds(s)[0]) / RATE) * 1000 : 1000,
      t = clamp((e.clientX - r.left - 20) / (r.width - 40), 0, 1);
    s[envelopeDragging] = Math.round(
      (envelopeDragging === "attack_ms" ? t : 1 - t) * duration,
    );
    if (s.attack_ms + s.decay_ms > duration) {
      if (envelopeDragging === "attack_ms")
        s.decay_ms = Math.max(0, duration - s.attack_ms);
      else s.attack_ms = Math.max(0, duration - s.decay_ms);
    }
    setValue("attack", s.attack_ms);
    setValue("decay", s.decay_ms);
    drawEditorPreviews();
    safe(audio.update(s));
    touch();
    changed();
  }
}
let trimData = null;
function refreshTrim(s) {
  if (trimSampleId !== s.id) return;
  const data = audio.prepared.get(s.id),
    descriptor = {
      ...s,
      id: "trim-preview",
      audition_source_id: s.id,
      playback: trimLoopHeld ? "loop" : "poly",
      attack_ms: 0,
      decay_ms: 0,
      root_note: null,
      low_note: null,
      high_note: null,
      key: null,
    };
  if (data && data !== trimData) {
    trimData = data;
    const copied = data.slice();
    audio.send(
      {
        type: "refresh",
        slot: 512,
        id: "trim-preview",
        audio: copied,
        sample: audio.descriptor(descriptor),
      },
      [copied.buffer],
    );
  } else
    audio.send({
      type: "config",
      slot: 512,
      sample: audio.descriptor(descriptor),
    });
}

state.source = "PC Keyboard";
state.programs[0].landing = true;
void boot();

// Browser zoom is disabled; piano/waveform handlers still receive their own gestures.
installPageZoomGuard();
const scheduleLearningDock = () => requestAnimationFrame(updateLearningDock);
window.addEventListener("resize", scheduleLearningDock);
window.addEventListener("orientationchange", scheduleLearningDock);
window.visualViewport?.addEventListener("resize", scheduleLearningDock);
const learningDockObserver = new ResizeObserver(updateLearningDock);
for (const panel of document.querySelectorAll(".keyboard-panel,.octavebar"))
  learningDockObserver.observe(panel);

initControls();
initMasterKnob();

initFilterUI({
  getSample: selected,
  onChange: ({ cutoff, resonance }, final) => {
    const s = selected();
    if (!s) return;
    s.lpf_cutoff = cutoff;
    s.lpf_resonance = resonance;
    $("filter-enabled").checked = cutoff != null;
    touch();
    changed();
    safe(audio.update(s));
    if (final) {
      checkpoint(s);
      ui.render(state, current(), learn);
    }
  },
});
listen("wave-channels", "change", async (e) => {
  const s = selected();
  if (!s) return;
  if (e.target.value === "show-stereo") s.wave_view = "split";
  else {
    s.mono = e.target.value.startsWith("mono");
    s.mono_channel =
      e.target.value === "mono-left"
        ? "left"
        : e.target.value === "mono-right"
          ? "right"
          : "mix";
    s.wave_view = "mixed";
  }
  await commit(s, false, true);
});
listen("record-mode", "change", (e) => {
  if (recording || armed || finishingRecording) {
    e.target.value = state.record.mode;
    syncControls();
    return;
  }
  state.record.mode = e.target.value;
  touch();
  audio.send({ type: "inputMode", mode: e.target.value });
  changed();
});
updateMeters(0, 0);

for (const [id, key] of [
  ["semitone-knob", "semitone"],
  ["fine-knob", "fine"],
]) {
  listen(id, "input", async (e) => {
    const s = selected();
    if (!s) return;
    s[key] = Number(e.target.value);
    setValue(key, s[key]);
    touch();
    changed();
    await audio.update(s);
  });
  listen(id, "change", () => {
    const s = selected();
    if (s) safe(commit(s, false, true));
  });
}
for (const [id, delta] of [
  ["pitch-octave-down", -12],
  ["pitch-octave-up", 12],
])
  listen(id, "click", async () => {
    const s = selected();
    if (!s) return;
    const n = clamp(s.semitone + delta, -48, 48);
    if (n === s.semitone) return;
    s.semitone = n;
    await commit(s, false, true);
  });

for (const id of ["row-value-unit", "row-value-pan"]) {
  listen(id, "input", async (e) => {
    const s = selected();
    if (!s) return;
    s[rowValueKey] = Number(e.target.value) / 100;
    setValue("row-value-number", Number(e.target.value));
    touch();
    changed();
    await audio.update(s);
  });
  listen(id, "change", () => {
    const s = selected();
    if (s) safe(commit(s, false, true));
  });
}
listen("row-value-number", "change", async (e) => {
  const s = selected();
  if (!s) return;
  const value = Number(e.target.value),
    minimum = rowValueKey === "pan" ? -100 : 0;
  if (
    !e.target.value.trim() ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > 100
  ) {
    syncRowValue();
    throw Error(`Value must be ${minimum}–100%`);
  }
  s[rowValueKey] = value / 100;
  await commit(s, false, true);
});
listen("save-kind", "change", async (e) => {
  const kind = e.target.value;
  e.target.value = "";
  syncControls();
  if (!kind) return;
  if (kind === "sample") await saveSelectedSamples();
  else if (kind === "render") {
    prepareRenderOptions();
    openEditor("resample");
  } else await saveBank(kind === "program");
});
listen("load-kind", "change", async (e) => {
  const kind = e.target.value;
  e.target.value = "";
  syncControls();
  if (!kind) return;
  if (kind === "sample") {
    $("audio-files").multiple = true;
    $("audio-files").click();
    return;
  }
  if (kind === "example") {
    await loadDemo();
    return;
  }
  requestedLoadType = kind === "program" ? "sample_program" : "sample_bank";
  $("bank-files").click();
});
listen("project-folder", "change", async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  if (!pendingImport) return;
  const lookup = new Map();
  for (const f of files) {
    const full = f.webkitRelativePath || f.name,
      relative = full.includes("/") ? full.slice(full.indexOf("/") + 1) : full;
    if (lookup.has(relative)) throw Error("Ambiguous project folder");
    lookup.set(relative, f);
  }
  for (const s of pendingImport.missing) {
    if (s.audio) continue;
    const file = lookup.get(s.audio_file);
    if (!file) continue;
    if (s.container_file && !lookup.has(s.container_file))
      throw Error("Project folder is missing " + s.container_file);
    s.source_wav = new Uint8Array(await file.arrayBuffer());
    s.audio = rawWave(s.source_wav);
    fitMarkers(s);
  }
  const remaining = pendingImport.missing.filter((s) => !s.audio);
  $("missing-files").textContent = remaining
    .map((s) => s.audio_file)
    .join("\n");
  if (remaining.length) {
    status(
      "Choose the folder containing the project file; " +
        remaining.length +
        " relative audio files are still missing.",
    );
    return;
  }
  $("relink-dialog").close();
  await finishImport();
});

function restoreRecordingSettings() {
  $("record-source").value = state.record.source ?? "mic";
  const preferred = state.record.device ?? "";
  if (
    preferred &&
    ![...$("record-device").options].some((o) => o.value === preferred)
  )
    $("record-device").append(option(preferred, "Saved audio input"));
  $("record-device").value =
    state.record.source === "system" ? SYSTEM_AUDIO_DEVICE : preferred;
  $("record-mode").value = state.record.mode;
  syncRecordFormat();
  drawThreshold();
}
function syncRecordFormat() {
  const rate = state.record.sample_rate ?? 44100,
    bits = state.record.bit_depth ?? 16;
  $("record-rate").value = String(rate);
  $("record-bits").value = String(bits);
  syncControls();
}
for (const id of ["record-rate", "record-bits"])
  listen(id, "change", () => {
    state.record.sample_rate = Number($("record-rate").value);
    state.record.bit_depth = Number($("record-bits").value);
    touch();
    syncRecordFormat();
    changed();
  });

let renderDefaults = null;
function prepareRenderOptions() {
  const samples = current().samples.filter(
    (s) => selectedIds().has(s.id) && s.audio,
  );
  renderDefaults = renderSelectionDefaults(samples);
  const common = renderDefaults.common,
    rate = $("render-rate");
  if (
    ![...rate.options].some((option) => Number(option.value) === common.rate)
  ) {
    const option = document.createElement("option");
    option.value = String(common.rate);
    option.textContent = `${common.rate / 1000} kHz`;
    rate.append(option);
  }
  rate.value = String(common.rate);
  $("render-bits").value = String(common.bits);
  $("render-channels").value = String(common.channels);
  $("render-format").value = "wav";
  $("render-policy").value = renderDefaults.mixed ? "source" : "common";
  if (state.renderOptions) {
    const saved = state.renderOptions;
    if (![...rate.options].some((o) => Number(o.value) === saved.rate))
      rate.append(option(String(saved.rate), `${saved.rate / 1000} kHz`));
    for (const key of [
      "policy",
      "rate",
      "bits",
      "channels",
      "format",
      "bitrate",
    ])
      $("render-" + key).value = String(saved[key]);
  }
  syncRenderOptions();
}
function syncRenderOptions() {
  const mp3 = $("render-format").value === "mp3",
    rate = $("render-rate"),
    policy = $("render-policy");
  if (mp3) policy.value = "common";
  policy.querySelector('[value="source"]').disabled = mp3;
  $("render-policy-label").hidden = !renderDefaults?.mixed;
  for (const option of rate.options)
    option.disabled =
      mp3 && ![22050, 32000, 44100, 48000].includes(Number(option.value));
  if (mp3 && ![22050, 32000, 44100, 48000].includes(Number(rate.value)))
    rate.value = "44100";
  for (const option of $("render-bitrate").options)
    option.disabled = mp3 && rate.value === "22050" && option.value !== "128";
  if (mp3 && rate.value === "22050") $("render-bitrate").value = "128";
  const source = policy.value === "source" && !mp3;
  for (const id of ["render-rate", "render-bits", "render-channels"])
    $(id).disabled = source;
  $("render-bits-label").hidden = mp3;
  $("render-bitrate-label").hidden = !mp3;
  const mixed = $("render-mixed");
  mixed.hidden = !renderDefaults?.mixed;
  mixed.textContent = source
    ? "The selected sources have different formats. Each WAV will use its own original rate, bit depth and channel count. Choose one common format to convert them together."
    : "The selected sources have different formats. All exports will use the common settings below.";
  $("render-selection").textContent =
    `${current().samples.filter((s) => selectedIds().has(s.id) && s.audio).length} selected loaded samples`;
  syncControls();
}
function captureRenderOptions() {
  state.renderOptions = {
    policy: $("render-policy").value,
    rate: Number($("render-rate").value),
    bits: Number($("render-bits").value),
    channels: Number($("render-channels").value),
    format: $("render-format").value,
    bitrate: Number($("render-bitrate").value),
  };
  touch();
  changed();
}
for (const id of [
  "render-format",
  "render-rate",
  "render-policy",
  "render-bits",
  "render-channels",
  "render-bitrate",
])
  listen(id, "change", () => {
    syncRenderOptions();
    captureRenderOptions();
  });
let rendering = false;
async function exportRendered() {
  if (rendering) return;
  const samples = current().samples.filter(
    (s) => selectedIds().has(s.id) && s.audio,
  );
  if (!samples.length) throw Error("Select loaded samples to render.");
  captureRenderOptions();
  const options = {
    policy: $("render-policy").value,
    rate: Number($("render-rate").value),
    bits: Number($("render-bits").value),
    channels: Number($("render-channels").value),
    format: $("render-format").value,
    bitrate: Number($("render-bitrate").value),
  };
  rendering = true;
  $("render-export").disabled = true;
  status("Rendering through the sampler engine…");
  try {
    const result = await codec.renderSamples(samples, state, options);
    download(result.data, result.name, result.type);
    status(
      `Rendered ${samples.length} sample${samples.length === 1 ? "" : "s"}. Source audio and settings are unchanged.`,
    );
    $("resample-dialog").close();
  } finally {
    rendering = false;
    $("render-export").disabled = false;
  }
}
listen("render-export", "click", exportRendered);
$("resample-dialog").addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Enter" && !document.querySelector(".custom-options")) {
      e.preventDefault();
      safe(exportRendered());
    }
  },
  true,
);

listen("record-gain", "input", (e) => {
  state.record.gain_db = Math.max(-24, Math.min(24, Number(e.target.value)));
  audio.send({ type: "inputGain", db: state.record.gain_db });
  audio.setInputMonitoring(
    $("record-monitor").checked,
    state.record.gain_db,
    state.master,
  );
  changed();
});
window.addEventListener("sampler-before-update", (event) => {
  event.detail.waitUntil(
    (async () => {
      if (recording || armed || finishingRecording)
        throw Error("Stop recording before updating");
      captureViewSettings();
      clearTimeout(saveTimer);
      await saveChain.catch(() => {});
      await saveRecovery(structuredClone(state));
      approvedClose = true;
    })(),
  );
});

listen("keyboard-mode", "click", () =>
  ui.setPianoTouchMode(ui.pianoTouchMode === "play" ? "move" : "play"),
);
listen("keyboard-fold", "click", () => {
  for (const id of [...pointerNotes.keys()]) releasePointer(id);
  ui.setKeyboardCollapsed(
    !document.querySelector(".keyboard-panel").classList.contains("is-folded"),
  );
  ui.queueViewChanged();
  updateLearningDock();
});

listen("sampler-settings-open", "click", () => {
  $("settings-master").value = $("master").value;
  for (const [target, source] of [
    ["settings-input", "input-source"],
    ["settings-channel", "midi-channel"],
  ]) {
    $(target).replaceChildren(
      ...[...$(source).options].map((o) => o.cloneNode(true)),
    );
    $(target).value = $(source).value;
  }
  $("settings-piano").checked = !document
    .querySelector(".keyboard-panel")
    .classList.contains("is-folded");
  $("sampler-settings").showModal();
  syncControls();
});
listen("sampler-settings-close", "click", () => $("sampler-settings").close());
listen("settings-master", "change", (event) => {
  const value = Number(event.target.value);
  if (
    event.target.value.trim() === "" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100
  ) {
    event.target.value = $("master").value;
    return;
  }
  $("master").value = String(value);
  $("master").dispatchEvent(new Event("input", { bubbles: true }));
});
for (const [target, source] of [
  ["settings-input", "input-source"],
  ["settings-channel", "midi-channel"],
]) {
  listen(target, "change", () => {
    $(source).value = $(target).value;
    $(source).dispatchEvent(new Event("change", { bubbles: true }));
    syncControls();
  });
}
listen("settings-piano", "change", () => {
  for (const id of [...pointerNotes.keys()]) releasePointer(id);
  ui.setKeyboardCollapsed(!$("settings-piano").checked);
  ui.queueViewChanged();
  updateLearningDock();
});

// Safari has no keyboard-attachment event. Re-detect typing use after leaving the app.
window.addEventListener("pagehide", () => {
  if (ui.phonePiano) ui.externalKeyboardSeen = false;
});

window.addEventListener("pageshow", () => {
  if (ui.phonePiano) paintKeyboard();
});
