/** Row controls affect sound only; source audio, stored gain and all DSP parameters stay intact. */
export function isSampleMuted(sample, rows = []) {
  const list = Array.isArray(rows) ? rows : (rows?.samples ?? []);
  return (
    !!sample.mute || (!sample.solo && list.some((row) => row.solo && !row.mute))
  );
}
export function renderRows(state, sample) {
  if (Array.isArray(state?.soloContext)) return state.soloContext;
  const program =
    state?.programs?.find((p) => p.id === state.current) ??
    state?.programs?.find((p) => p.samples.some((s) => s.id === sample.id));
  return program?.samples ?? [sample];
}
