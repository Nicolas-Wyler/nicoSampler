// Versioned user preferences only. Browser permissions and live audio objects are never saved.
const DEFAULT_RECORD = {
  source: "mic",
  device: "",
  mode: "Stereo",
  threshold: -24,
  sample_rate: 44100,
  bit_depth: 16,
};
const string = (value, name, fallback = "") => {
  if (value == null) return fallback;
  if (typeof value !== "string" || value.length > 4096)
    throw Error(`Invalid ${name}`);
  return value;
};
const number = (value, min, max, name, fallback) => {
  if (value == null) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw Error(`Invalid ${name}`);
  return value;
};
export function normalizePreferences(raw = {}) {
  const bag = raw.preferences;
  if (
    bag != null &&
    (typeof bag !== "object" || Array.isArray(bag) || bag.version !== 1)
  )
    throw Error("Unsupported preferences version");
  const input = bag ?? raw;
  const recordInput = input.record ?? raw.record ?? {};
  if (typeof recordInput !== "object" || Array.isArray(recordInput))
    throw Error("Invalid recording settings");
  const record = Object.fromEntries(
    Object.entries(DEFAULT_RECORD).map(([key, value]) => [
      key,
      recordInput[key] ?? value,
    ]),
  );
  record.source = string(record.source, "recording source", "mic");
  record.device = string(record.device, "recording device");
  if (
    !["mic", "system"].includes(record.source) ||
    !["Stereo", "Mono L", "Mono R", "Mono mix"].includes(record.mode)
  )
    throw Error("Invalid recording source or channel mode");
  record.threshold = number(
    record.threshold,
    -60,
    0,
    "recording threshold",
    -24,
  );
  if (
    ![8000, 11025, 22050, 32000, 44100, 48000, 96000].includes(
      record.sample_rate,
    ) ||
    ![8, 12, 16, 24, 32].includes(record.bit_depth)
  )
    throw Error("Invalid recording format");
  const columns = input.columns ?? raw.columns;
  if (
    columns != null &&
    (!Array.isArray(columns) ||
      columns.length > 32 ||
      columns.some((n) => !Number.isFinite(n) || n < 0 || n > 10000))
  )
    throw Error("Invalid table column widths");
  const manual = input.columnManual ?? raw.columnManual;
  if (
    manual != null &&
    (typeof manual !== "object" ||
      Array.isArray(manual) ||
      Object.entries(manual).some(
        ([key, n]) =>
          !/^\d+$/.test(key) ||
          Number(key) > 31 ||
          !Number.isFinite(n) ||
          n < 16 ||
          n > 10000,
      ))
  )
    throw Error("Invalid manual table column widths");
  const view = input.view ?? raw.viewSettings ?? {};
  if (typeof view !== "object" || Array.isArray(view))
    throw Error("Invalid saved view");
  const renderInput = input.render ?? raw.renderOptions;
  const render =
    renderInput == null
      ? undefined
      : Object.fromEntries(
          ["policy", "rate", "bits", "channels", "format", "bitrate"].map(
            (key) => [key, renderInput[key]],
          ),
        );
  if (
    render != null &&
    (typeof render !== "object" ||
      Array.isArray(render) ||
      !["wav", "mp3"].includes(render.format) ||
      !["source", "common"].includes(render.policy) ||
      !Number.isInteger(render.rate) ||
      render.rate < 8000 ||
      render.rate > 384000 ||
      ![8, 12, 16, 24, 32].includes(render.bits) ||
      ![1, 2].includes(render.channels) ||
      ![128, 192, 256, 320].includes(render.bitrate))
  )
    throw Error("Invalid resample export settings");
  const octave = number(input.octave ?? raw.octave, -5, 5, "octave", 0);
  const sizingVersion = number(
    input.columnSizingVersion ?? raw.columnSizingVersion,
    0,
    100,
    "table layout version",
    0,
  );
  if (!Number.isInteger(octave) || !Number.isInteger(sizingVersion))
    throw Error("Invalid integer application setting");
  const keyboard = view.keyboard ?? {};
  if (typeof keyboard !== "object" || Array.isArray(keyboard))
    throw Error("Invalid keyboard view");
  return {
    version: 1,
    source: string(input.source ?? raw.source, "MIDI input", "PC Keyboard"),
    octave,
    record,
    render: render ? { ...render } : undefined,
    columns: columns ? [...columns] : undefined,
    columnManual: manual ? { ...manual } : undefined,
    columnSizingVersion: sizingVersion,
    view: {
      keyboard: {
        zoom: number(keyboard.zoom, 1, 75 / 7, "keyboard zoom", 1),
        position: number(keyboard.position, 0, 1, "keyboard position", 0.5),
      },
      tableScroll: number(view.tableScroll, 0, 1, "table scroll position", 0),
      programScroll: number(
        view.programScroll,
        0,
        1,
        "program scroll position",
        0,
      ),
    },
  };
}
export function preferences(state) {
  return normalizePreferences({
    source: state.source,
    octave: state.octave,
    record: state.record,
    columns: state.columns,
    columnManual: state.columnManual,
    columnSizingVersion: state.columnSizingVersion,
    preferences: {
      version: 1,
      source: state.source,
      octave: state.octave,
      record: state.record,
      columns: state.columns,
      columnManual: state.columnManual,
      columnSizingVersion: state.columnSizingVersion,
      view: state.viewSettings,
      render: state.renderOptions,
    },
  });
}
export function applyPreferences(state, raw) {
  const saved = normalizePreferences(raw);
  for (const key of [
    "source",
    "octave",
    "record",
    "columns",
    "columnManual",
    "columnSizingVersion",
  ])
    state[key] = structuredClone(saved[key]);
  state.viewSettings = structuredClone(saved.view);
  state.renderOptions = structuredClone(saved.render);
  return saved;
}
