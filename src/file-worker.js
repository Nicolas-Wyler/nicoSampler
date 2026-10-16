function base64(bytes) {
  let t = "";
  for (let i = 0; i < bytes.length; i += 24576)
    t += String.fromCharCode(...bytes.subarray(i, i + 24576));
  return btoa(t);
}
function encodeAudio(channels) {
  const n = channels[0].length,
    b = new Uint8Array(n * 8),
    view = new DataView(b.buffer);
  for (let i = 0; i < n; i++) {
    view.setFloat32(i * 8, channels[0][i], true);
    view.setFloat32(i * 8 + 4, channels[1]?.[i] ?? channels[0][i], true);
  }
  return base64(b);
}
self.onmessage = async ({ data: { type, data, token } }) => {
  try {
    if (type === "project-import") {
      const { importProjectBundle } = await import("./project-import.js");
      const result = importProjectBundle(data.buffer, data.expectedType);
      const buffers = new Set(
        [
          ...result.programs.flatMap((p) => p.samples.map((s) => s.audio)),
          ...(result.takes ?? []).map((t) => t.audio),
        ]
          .filter(Boolean)
          .flatMap((a) => a.map((c) => c.buffer)),
      );
      postMessage({ token, result }, [...buffers]);
    } else if (type === "project") {
      const { metadata } = await import("./storage.js");
      const { projectBundle } = await import("./project-bundle.js");
      const raw = metadata(data.state, data.onlyCurrent),
        programs = raw.type === "sample_program" ? [raw] : raw.programs;
      for (const p of programs) for (const s of p.samples) delete s.embedded;
      const project = JSON.stringify(raw),
        bundle = projectBundle(project, data.state, data.onlyCurrent);
      postMessage({ token, result: { project, bundle } }, [bundle.buffer]);
    } else if (type === "render") {
      const { resampleExport } = await import("./resample-export.js");
      const result = await resampleExport(data.samples, data, data.options);
      postMessage({ token, result }, [result.data.buffer]);
    } else if (type === "samples") {
      const { sampleBundle } = await import("./sample-bundle.js");
      const result = sampleBundle(data.samples, data);
      postMessage({ token, result }, [result.buffer]);
    } else if (type === "sample") {
      const { encodeSampleContainer } = await import("./sample-container.js");
      const result = encodeSampleContainer(data.sample, data);
      postMessage({ token, result }, [result.wav, result.container.buffer]);
    } else if (type === "encode") {
      const programs = data.type === "sample_program" ? [data] : data.programs;
      for (const p of programs)
        for (const s of p.samples)
          if (s.embedded) {
            s.embedded.data = encodeAudio(s.embedded.channels);
            delete s.embedded.channels;
          }
      postMessage({ token, result: JSON.stringify(data) });
    } else {
      const raw = JSON.parse(data),
        programs = raw.type === "sample_program" ? [raw] : raw.programs,
        audio = [];
      let total = 0;
      if (!Array.isArray(programs) || programs.length > 128)
        throw Error("Invalid bank");
      for (const p of programs) {
        if (!Array.isArray(p.samples) || p.samples.length > 512)
          throw Error("Invalid samples");
        for (const s of p.samples) {
          let channels = null;
          if (s.embedded) {
            const e = s.embedded;
            if (
              e.encoding !== "f32le-stereo" ||
              !Number.isInteger(e.frames) ||
              e.frames <= 0 ||
              e.frames > 44100 * 600 ||
              typeof e.data !== "string" ||
              e.data.length > 180 * 1024 * 1024
            )
              throw Error("Invalid embedded audio");
            total += e.frames * 8;
            if (total > 128 * 1024 * 1024)
              throw Error("Bank exceeds 128 MB source-audio budget");
            const str = atob(e.data);
            if (str.length !== e.frames * 8)
              throw Error("Embedded audio length mismatch");
            const bytes = Uint8Array.from(str, (c) => c.charCodeAt(0)),
              v = new DataView(bytes.buffer),
              l = new Float32Array(e.frames),
              r = new Float32Array(e.frames);
            for (let i = 0; i < e.frames; i++) {
              l[i] = v.getFloat32(i * 8, true);
              r[i] = v.getFloat32(i * 8 + 4, true);
              if (!Number.isFinite(l[i]) || !Number.isFinite(r[i]))
                throw Error("Non-finite audio in bank");
            }
            channels = [l, r];
            delete s.embedded;
          }
          audio.push(channels);
        }
      }
      postMessage({ token, result: { raw, audio } });
    }
  } catch (error) {
    postMessage({ token, error: error.message });
  }
};
