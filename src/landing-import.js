import { newEmpty } from "./workflows.js";
import { readZipEntries } from "./project-bundle.js";

/** Inspect metadata before decoding audio, so lower-ranking files remain ignored. */
export async function planLandingImport(files) {
  if (!files.length) throw Error("Choose files to import.");
  if (files.length > 512) throw Error("Choose at most 512 files.");
  const entries = [];
  for (const file of files) {
    let kind = "other";
    if (/\.nicosbank$/i.test(file.name)) kind = "bank";
    else if (/\.nicoprog$/i.test(file.name)) kind = "program";
    else if (/\.nicosample$/i.test(file.name)) kind = "sample";
    else if (/\.wav$/i.test(file.name)) kind = "wave";
    else if (/\.(json|zip)$/i.test(file.name)) {
      try {
        let text;
        if (/\.zip$/i.test(file.name)) {
          const zipped = readZipEntries(await file.arrayBuffer());
          const manifest =
            zipped.get("project.nicosbank") ?? zipped.get("project.nicoprog");
          if (!manifest) {
            const samples = [...zipped].filter(([path]) =>
              /\.nicosample$/i.test(path),
            );
            const waves = [...zipped].filter(
              ([path]) =>
                /\.wav$/i.test(path) &&
                !samples.some(
                  ([name]) =>
                    path === name.replace(/\.nicosample$/i, ".raw.wav"),
                ),
            );
            if (!samples.length && !waves.length)
              throw Error(
                "ZIP has no bank/program at its expected root or supported sample files.",
              );
            entries.push({
              file,
              kind: "sample-zip",
              members: [...samples, ...waves],
            });
            continue;
          }
          text = new TextDecoder().decode(manifest);
        } else text = await file.text();
        const raw = JSON.parse(text);
        kind =
          raw.type === "sample_bank"
            ? "bank"
            : raw.type === "sample_program"
              ? "program"
              : "other";
      } catch (error) {
        entries.push({ file, kind: "other", error });
        continue;
      }
    }
    entries.push({ file, kind });
  }
  const kind = entries.some((e) => e.kind === "bank")
    ? "bank"
    : entries.some((e) => e.kind === "program")
      ? "program"
      : "samples";
  const accepted = entries.filter((e) =>
    kind === "samples"
      ? ["sample", "wave", "sample-zip"].includes(e.kind)
      : e.kind === kind,
  );
  if (!accepted.length)
    throw (
      entries.find((e) => e.error)?.error ??
      Error("No supported bank, program, sample container or WAV files found.")
    );
  if (kind === "bank" && accepted.length > 1)
    throw Error(
      "Drop one bank at a time. Multiple programs can be imported together.",
    );
  for (const entry of accepted)
    if (entry.file.size > 360 * 1048576)
      throw Error(`${entry.file.name} exceeds the 360 MB file limit.`);
  const ignored = entries
    .filter((e) => !accepted.includes(e))
    .map((e) => e.file.name);
  const selected = accepted.flatMap((e) =>
    e.members
      ? e.members.map(
          ([name, bytes]) =>
            new File([bytes], name, {
              type: /\.wav$/i.test(name)
                ? "audio/wav"
                : "application/octet-stream",
            }),
        )
      : [e.file],
  );
  return { kind, files: selected, ignored };
}

export function landingNotice(plan) {
  return plan.ignored.length
    ? `Ignored ${plan.ignored.length} separately dropped file${plan.ignored.length === 1 ? "" : "s"} because ${plan.kind === "bank" ? "the bank takes" : plan.kind === "program" ? "programs take" : "supported audio files take"} priority: ${plan.ignored.join(", ")}.`
    : "";
}

/** Older builds automatically created this placeholder before landing existed. */
export function isLegacyEmptyProgram(program) {
  if (!program.samples.length) return true;
  if (
    program.samples.length !== 1 ||
    program.channel !== "All" ||
    !/^Program \d+$/.test(program.name)
  )
    return false;
  const row = program.samples[0];
  if (row.audio || row.audio_file || row.source_wav || row.audio_dirty)
    return false;
  const defaults = newEmpty();
  return Object.entries(defaults).every(
    ([key, value]) => key === "id" || (row[key] ?? value) === value,
  );
}
