/** Input selection governs note sources, never explicit on-screen or audition actions. */
export function acceptsInput(source, kind, deviceId = null) {
  if (kind === "screen" || kind === "preview") return true;
  if (kind === "pc") return source === "PC Keyboard";
  if (
    kind !== "midi" ||
    typeof deviceId !== "string" ||
    !deviceId ||
    ["PC Keyboard", "None"].includes(source)
  )
    return false;
  return source === "all" || source === deviceId;
}
