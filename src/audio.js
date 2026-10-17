export function requestSystemAudio() {
  const media = navigator.mediaDevices;
  if (!media?.getDisplayMedia)
    return Promise.reject(
      Error(
        "System audio sharing is unavailable in this browser. Try desktop Chrome or Edge.",
      ),
    );
  return media.getDisplayMedia({
    video: true,
    audio: true,
    systemAudio: "include",
  });
}
import { isSampleMuted } from "./sample-audibility.js";
import { RATE, assigned, fitMarkers } from "./model.js";
import { compileEngine, planar } from "./wasm-engine.js";
export class AudioController {
  constructor(onEvent) {
    this.onEvent = onEvent;
    this.modulePromise = compileEngine();
    this.modulePromise.catch((e) =>
      this.onEvent({ type: "error", message: e.message }),
    );
    this.slots = new Map();
    this.previewSamples = new Map();
    this.prepared = new Map();
    this.generations = new Map();
    this.jobs = new Map();
    this.nextToken = 0;
    this.programGeneration = 0;
    this.worker = new Worker(new URL("./edit-worker.js", import.meta.url), {
      type: "module",
    });
    this.workerReady = this.modulePromise.then(
      (module) =>
        new Promise((resolve, reject) => {
          this.workerInit = { resolve, reject };
          this.worker.postMessage({ type: "init", module });
        }),
    );
    this.workerReady.catch(() => {});
    this.worker.onmessage = ({ data: m }) => {
      if (m.type === "ready") {
        this.workerInit.resolve();
        return;
      }
      if (m.type === "initError") {
        this.workerInit.reject(Error(m.message));
        return;
      }
      const job = this.jobs.get(m.token);
      if (job) {
        this.jobs.delete(m.token);
        if (m.type === "error") job.reject(Error(m.message));
        else job.resolve(m.audio);
      }
    };
    this.worker.onerror = () => {
      const error = Error("Sample processing worker failed");
      this.workerInit?.reject(error);
      for (const job of this.jobs.values()) job.reject(error);
      this.jobs.clear();
    };
  }
  async enable() {
    if (this.starting) {
      // A touch-down startup may be waiting for iOS user activation. Resume in
      // this gesture before awaiting that startup, otherwise neither can finish.
      const resume = this.context.resume();
      await Promise.all([this.starting, resume]);
      return;
    }
    if (this.context) {
      await this.context.resume();
      return;
    }
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) throw Error("This browser does not support Web Audio");
    this.context = new Context({ latencyHint: "interactive" });
    const ctx = this.context;
    this.starting = this.start(ctx);
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }
  async start(ctx) {
    await ctx.resume();
    try {
      const module = await this.modulePromise;
      await ctx.audioWorklet.addModule(
        new URL("./audio-worklet.js", import.meta.url),
      );
      this.node = new AudioWorkletNode(ctx, "nico-sampler", {
        numberOfInputs: 2,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { module },
      });
      this.node.onprocessorerror = () =>
        this.onEvent({
          type: "fatal",
          message:
            "Audio engine stopped. Reload the page to restart; your bank can still be saved.",
        });
      this.node.port.onmessage = ({ data }) => this.onEvent(data);
      this.node.connect(ctx.destination);
      ctx.onstatechange = () =>
        this.onEvent({ type: "state", state: ctx.state });
      await ctx.resume();
    } catch (error) {
      await ctx.close();
      this.context = null;
      throw error;
    }
  }
  send(m, transfer = []) {
    if (["load", "refresh", "config"].includes(m.type) && m.sample) {
      if (m.sample.audition_source_id)
        this.previewSamples.set(m.slot, m.sample);
      else this.previewSamples.delete(m.slot);
    }
    this.node?.port.postMessage(m, transfer);
  }
  async prepare(s) {
    if (!s.audio) return null;
    const gen = (this.generations.get(s.id) ?? 0) + 1;
    this.generations.set(s.id, gen);
    await this.workerReady;
    const token = ++this.nextToken,
      audio = await new Promise((resolve, reject) => {
        this.jobs.set(token, { resolve, reject });
        this.worker.postMessage({ type: "process", token, sample: s });
      });
    if (this.generations.get(s.id) !== gen) return null;
    this.prepared.set(s.id, audio);
    return audio;
  }
  async update(s, reprocess = false) {
    const slot = this.slots.get(s.id);
    if (slot == null) return;
    if (reprocess) {
      const data = await this.prepare(s);
      if (data && this.slots.get(s.id) === slot) this.upload(s, slot, data);
    } else this.send({ type: "config", slot, sample: this.descriptor(s) });
  }
  descriptor(s) {
    const { audio, ...rest } = s;
    const source = this.program?.samples.find(
      (row) => row.id === (s.audition_source_id ?? s.id),
    );
    return {
      ...rest,
      effective_mute: source
        ? isSampleMuted(source, this.program.samples)
        : !!s.mute,
      audio: [{ length: audio?.[0]?.length ?? 0 }],
    };
  }
  updateAudibility(p) {
    this.program = p;
    const configs = [];
    for (const s of p.samples) {
      const slot = this.slots.get(s.id);
      if (slot != null) configs.push({ slot, sample: this.descriptor(s) });
    }
    for (const [slot, s] of this.previewSamples)
      configs.push({ slot, sample: this.descriptor(s) });
    // One worklet transaction also clears shared wet tails, so mute is strictly silent.
    this.send({ type: "audibility", configs });
  }
  upload(s, slot, processed) {
    if (s.audition_source_id) this.previewSamples.set(slot, s);
    const audio = processed.slice();
    this.send(
      { type: "load", slot, id: s.id, sample: this.descriptor(s), audio },
      [audio.buffer],
    );
  }
  async syncProgram(p) {
    this.program = p;
    this.previewSamples.clear();
    const generation = ++this.programGeneration;
    this.send({ type: "clear" });
    this.slots.clear();
    for (let slot = 0; slot < p.samples.length; slot++) {
      const s = p.samples[slot];
      this.slots.set(s.id, slot);
      if (!s.audio) continue;
      const data = this.prepared.get(s.id) ?? (await this.prepare(s));
      if (generation !== this.programGeneration) return;
      if (data && this.node) this.upload(s, slot, data);
    }
  }
  on(p, note, velocity = 127, channel = 0, previewId = null) {
    if (!this.node) return;
    const samples = previewId
      ? p.samples.filter((s) => s.id === previewId)
      : p.samples.filter((s) => assigned(s, note));
    const slots = samples
      .filter((s) => !isSampleMuted(s, p.samples))
      .map((s) => this.slots.get(s.id))
      .filter((x) => x != null);
    this.send({ type: "on", slots, note, velocity, channel });
  }
  off(note, channel = 0) {
    this.send({ type: "off", note, channel });
  }
  panic() {
    this.send({ type: "panic" });
  }
  settings(state) {
    this.send({ type: "inputGain", db: state.record?.gain_db ?? 0 });
    this.send({ type: "settings", master: state.master, fx: state.fx });
  }
  processed(s) {
    const data = this.prepared.get(s.id);
    return data ? planar(data) : null;
  }
  async decode(file) {
    const bytes = await file.arrayBuffer();
    let ctx = new OfflineAudioContext(2, 1, RATE),
      decoded;
    try {
      decoded = await ctx.decodeAudioData(bytes);
    } catch {
      throw Error(
        `Cannot decode “${file.name}”. Try WAV, MP3, AAC or FLAC supported by this browser.`,
      );
    }
    if (!decoded.length || decoded.length > RATE * 600)
      throw Error("Samples must be between one frame and 10 minutes");
    // Use the browser speaker downmix instead of discarding center/surround channels.
    if (decoded.numberOfChannels > 2) {
      const mixer = new OfflineAudioContext(2, decoded.length, RATE),
        source = mixer.createBufferSource();
      source.buffer = decoded;
      source.connect(mixer.destination);
      source.start();
      decoded = await mixer.startRendering();
    }
    const channels = [
      decoded.getChannelData(0).slice(),
      decoded.getChannelData(Math.min(1, decoded.numberOfChannels - 1)).slice(),
    ];
    for (const channel of channels)
      for (let i = 0; i < channel.length; i++)
        if (!Number.isFinite(channel[i])) channel[i] = 0;
    return channels;
  }
  async connectInput(source, device, mode, sharedCapture = null) {
    await this.disconnectInput();
    await this.enable();
    const media = navigator.mediaDevices;
    if (!media)
      throw Error("Recording requires HTTPS and a browser with media capture");
    let stream;
    if (source === "system") {
      if (!media.getDisplayMedia)
        throw Error("Shared audio capture is unavailable in this browser");
      stream = await (sharedCapture ?? requestSystemAudio());
      if (!stream.getAudioTracks().length) {
        stream.getTracks().forEach((t) => t.stop());
        throw Error(
          "No audio shared. Choose a tab with audio and enable Share audio, or use a microphone.",
        );
      }
    } else {
      this.setCaptureSession(true);
      try {
        stream = await media.getUserMedia({
          audio: {
            deviceId: device ? { exact: device } : undefined,
            channelCount: { ideal: 2 },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
          video: false,
        });
      } catch (error) {
        this.setCaptureSession(false);
        throw error;
      }
    }
    this.stream = stream;
    try {
      this.input = this.context.createMediaStreamSource(stream);
      this.input.connect(this.node);
      this.setInputMonitoring(
        this.inputMonitoringWanted,
        this.inputMonitoringDb ?? 0,
        this.inputMonitoringMaster ?? 1,
      );
    } catch (error) {
      this.input?.disconnect();
      this.input = null;
      for (const track of stream.getTracks()) track.stop();
      this.stream = null;
      this.setCaptureSession(false);
      throw error;
    }
    for (const track of stream.getAudioTracks())
      track.onended = () => {
        this.send({ type: "recordStop" });
        if (stream.getAudioTracks().every((t) => t.readyState === "ended"))
          this.setCaptureSession(false);
        this.onEvent({ type: "inputEnded" });
      };
    return (await media.enumerateDevices().catch(() => [])).filter(
      (d) => d.kind === "audioinput",
    );
  }
  setCaptureSession(capturing) {
    const nav = globalThis.navigator;
    const ios =
      /iPhone|iPad|iPod/.test(nav?.userAgent ?? "") ||
      (nav?.platform === "MacIntel" && nav?.maxTouchPoints > 1);
    if (!ios || !nav?.audioSession) return;
    if (!capturing && !this.captureSessionActive) return;
    try {
      nav.audioSession.type = capturing ? "play-and-record" : "playback";
      this.captureSessionActive = capturing;
    } catch {
      /* Unsupported session policies must not block playback/capture. */
    }
  }
  setInputMonitoring(enabled, db = 0, master = 1) {
    this.inputMonitoringWanted = Boolean(enabled);
    this.inputMonitoringDb = db;
    this.inputMonitoringMaster = master;
    this.send({
      type: "monitor",
      gain: enabled && this.input ? Math.pow(10, db / 20) * master : 0,
    });
  }
  async disconnectInput() {
    this.send({ type: "monitor", gain: 0 });
    this.input?.disconnect();
    this.input = null;
    if (this.stream) {
      for (const t of this.stream.getTracks()) {
        t.onended = null;
        t.stop();
      }
      this.stream = null;
    }
    this.setCaptureSession(false);
  }
  forget(id) {
    this.prepared.delete(id);
    this.generations.delete(id);
  }
  trimCache(state) {
    const keep = new Set(
      state.programs.flatMap((p) => p.samples.map((s) => s.id)),
    );
    for (const id of this.prepared.keys()) if (!keep.has(id)) this.forget(id);
  }
}
