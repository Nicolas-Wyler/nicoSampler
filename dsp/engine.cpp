// Nico Sampler: all per-sample DSP runs in this C++/WebAssembly module.
// No threads, filesystem, WASI imports, exceptions or allocations in render().
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
using std::max;
using std::min;
#define API extern "C" __attribute__((visibility("default")))
static constexpr int MAX_SAMPLES = 513, MAX_VOICES = 128, MAX_FRAMES = 2048;
static float rate = 44100, master = 1.f, peak = 0;
static float outL[MAX_FRAMES], outR[MAX_FRAMES];
static int voiceLimit = 64;
static inline float clamp(float v, float a, float b) {
  return max(a, min(b, v));
}
struct Sample {
  float *raw = nullptr, *data = nullptr;
  int frames = 0;
  int key = 60, root = -1, low = 0, high = 127, mode = 0, start = 0, end = 0,
      loopStart = 0, loopEnd = 0, reverse = 0, bits = 32, crush = 44100,
      normalize = 0;
  float level = 1, semitone = 0, fine = 0, attack = 0, decay = 0, cutoff = 0,
        resonance = 0, fx1 = 0, fx2 = 0, pan = 0, panLeft = 1, panRight = 1;
  bool mono = false, muted = false;
  int monoChannel = 0;
  int filter = 0, maxVelocity = 0, spread = 0, coupled = 0;
  float minimum = 0, maximum = 0, resMin = 0, resMax = 0;
};
struct Voice {
  bool active = false, released = false, retired = false;
  int sample = 0, note = 0, channel = 0;
  double pos = 0;
  float speed = 1, velocity = 1, age = 0, releaseAge = -1, releaseGain = 1,
        stopAge = 0;
  float b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0, z1[2] = {}, z2[2] = {},
        smoothCutoff = 0, currentLevel = 0;
  float attack = 0, decay = 0, total = 0;
  int mode = 0;
};
struct Delay {
  float *buffer = nullptr;
  int size = 0, index = 0;
  double read = 0;
  float state[4] = {}, time = .3f, feedback = .35f;
  int channels = 2;
  bool initialized = false;
  void init(int c) {
    channels = c;
    size = int(rate * 1.5f) + 2;
    free(buffer);
    buffer = (float *)calloc(size * c, sizeof(float));
    clear();
  }
  void clear() {
    if (buffer)
      memset(buffer, 0, size * channels * sizeof(float));
    index = 0;
    read = 0;
    initialized = false;
    memset(state, 0, sizeof(state));
  }
  void process(float *input, float *wet) {
    const float target = clamp(time * rate, 1, rate * 1.5f);
    if (!initialized) {
      read = fmod(index - target + size, size);
      initialized = true;
    }
    if (feedback <= 0) {
      for (int c = 0; c < channels; c++) {
        buffer[index * channels + c] = input[c];
        wet[c] = 0;
        state[c] = 0;
      }
      index = (index + 1) % size;
      read = fmod(index - target + size, size);
      return;
    }
    double distance = fmod(index - read + size, size),
           speed = clamp(1 - (target - distance) * .001f, .5f, 2);
    int left = int(read), right = (left + 1) % size;
    float frac = float(read - left);
    for (int c = 0; c < channels; c++) {
      float d = (1 - frac) * buffer[left * channels + c] +
                frac * buffer[right * channels + c];
      d = .3f * d + .7f * state[c];
      state[c] = d;
      float current = input[c] + feedback * d;
      buffer[index * channels + c] =
          feedback > 1 ? std::tanh(current) : current;
      wet[c] = feedback * d;
    }
    index = (index + 1) % size;
    read = fmod(read + speed, size);
  }
};
static Sample samples[MAX_SAMPLES];
static Voice voices[MAX_VOICES];
static Delay delays[2];
static bool pedal[17] = {};
static inline float spreadValue(const Sample &s, int note, float base,
                                int kind) {
  if (s.root < 0 || s.spread != kind)
    return base;
  float t = clamp(float(note - s.low) / max(1, s.high - s.low), 0, 1);
  return s.minimum + (s.maximum - s.minimum) * t;
}
static inline float resonance(const Sample &s, int note) {
  if (s.root < 0 || (s.spread != 3 && s.spread != 4))
    return s.resonance;
  float t = clamp(float(note - s.low) / max(1, s.high - s.low), 0, 1);
  return s.coupled ? s.resMin + (s.resMax - s.resMin) * t : s.resMax;
}
static void updateFilter(Voice &v, const Sample &s, int frames) {
  float target = s.cutoff;
  if (s.root >= 0 && (s.spread == 3 || s.spread == 4))
    target = spreadValue(s, v.note, target, s.spread);
  if (target <= 0) {
    v.b0 = 1;
    v.b1 = v.b2 = v.a1 = v.a2 = 0;
    v.z1[0] = v.z1[1] = v.z2[0] = v.z2[1] = 0;
    v.smoothCutoff = 0;
    return;
  }
  if (v.smoothCutoff == 0)
    v.smoothCutoff = target;
  v.smoothCutoff +=
      (target - v.smoothCutoff) * (1 - std::exp(-frames / (rate * .015f)));
  float w = 6.28318530718f * clamp(v.smoothCutoff, 20, rate / 2 - 100) / rate,
        c = std::cos(w),
        a = std::sin(w) / (2 * (.707f + resonance(s, v.note) * .9f)),
        a0 = 1 + a;
  bool hp = s.root >= 0 && s.spread == 4   ? true
            : s.root >= 0 && s.spread == 3 ? false
                                           : s.filter == 1;
  v.b0 = (hp ? (1 + c) : (1 - c)) * .5f / a0;
  v.b1 = (hp ? -(1 + c) : (1 - c)) / a0;
  v.b2 = v.b0;
  v.a1 = -2 * c / a0;
  v.a2 = (1 - a) / a0;
}
API int allocate(int bytes) {
  if (bytes <= 0 || bytes > 256 * 1024 * 1024)
    return 0;
  return (int)(uintptr_t)malloc(bytes);
}
API void deallocate(int p) { free((void *)(uintptr_t)p); }
API int output_left() { return (int)(uintptr_t)outL; }
API int output_right() { return (int)(uintptr_t)outR; }
API void init(float sampleRate) {
  rate = clamp(sampleRate, 8000, 192000);
  delays[0].init(4);
  delays[1].init(2);
}
API void set_master(float value) { master = clamp(value, 0, 1); }
API void set_limit(int value) { voiceLimit = max(1, min(64, value)); }
API void set_fx(int slot, float time, float feedback) {
  if (slot < 0 || slot > 1)
    return;
  delays[slot].time = clamp(time, .001, 1.5);
  delays[slot].feedback = clamp(feedback, 0, 2);
}
API void clear_fx() {
  delays[0].clear();
  delays[1].clear();
}
API void panic() {
  for (auto &v : voices)
    v.active = false;
  for (auto &p : pedal)
    p = false;
  delays[0].clear();
  delays[1].clear();
  peak = 0;
}
API void remove_sample(int id) {
  if (id < 0 || id >= MAX_SAMPLES)
    return;
  for (auto &v : voices)
    if (v.sample == id)
      v.active = false;
  auto &s = samples[id];
  free(s.raw);
  free(s.data);
  s = Sample{};
}
API void clear_samples() {
  panic();
  for (int i = 0; i < MAX_SAMPLES; i++)
    remove_sample(i);
}
API int load_sample(int id, int pointer, int frames) {
  if (id < 0 || id >= MAX_SAMPLES || frames <= 0 || frames > 44100 * 600)
    return 0;
  remove_sample(id);
  auto &s = samples[id];
  s.raw = (float *)(uintptr_t)pointer;
  s.data = (float *)malloc(frames * 2 * sizeof(float));
  if (!s.data) {
    s.raw = nullptr;
    return 0;
  }
  s.frames = frames;
  s.end = s.loopEnd = frames;
  return 1;
}
// Configuration layout documented in wasm-engine.js; the JS bridge sends plain
// scalars.
API void configure(int id, int ptr) {
  if (id < 0 || id >= MAX_SAMPLES)
    return;
  auto &s = samples[id];
  const float *p = (float *)(uintptr_t)ptr;
  s.key = int(p[0]);
  s.root = int(p[1]);
  s.low = int(p[2]);
  s.high = int(p[3]);
  s.mode = int(p[4]);
  s.level = p[5];
  s.semitone = p[6];
  s.fine = p[7];
  s.attack = p[8];
  s.decay = p[9];
  s.cutoff = p[10];
  s.resonance = p[11];
  s.filter = int(p[12]);
  s.fx1 = p[13];
  s.fx2 = p[14];
  s.maxVelocity = int(p[15]);
  s.start = max(0, min(s.frames - 1, int(p[16])));
  s.end = max(s.start + 1, min(s.frames, int(p[17])));
  s.loopStart = max(s.start, min(s.end - 1, int(p[18])));
  s.loopEnd = max(s.loopStart + 1, min(s.end, int(p[19])));
  s.reverse = int(p[20]);
  s.crush = max(100, min(44100, int(p[21])));
  s.bits = max(1, min(32, int(p[22])));
  s.normalize = int(p[23]);
  s.spread = int(p[24]);
  s.minimum = p[25];
  s.maximum = p[26];
  s.resMin = p[27];
  s.resMax = p[28];
  s.coupled = int(p[29]);
  s.pan = clamp(p[30], -1.f, 1.f);
  s.mono = (int(p[31]) & 1) != 0;
  s.monoChannel = (int(p[31]) & 4) ? 1 : (int(p[31]) & 8) ? 2 : 0;
  s.muted = (int(p[31]) & 2) != 0;
  s.panLeft = s.pan == 0 ? 1.f : 1.41421356237f * cosf((s.pan + 1) * .785398163397f);
  s.panRight = s.pan == 0 ? 1.f : 1.41421356237f * sinf((s.pan + 1) * .785398163397f);
}
API void prepare(int id) {
  if (id < 0 || id >= MAX_SAMPLES)
    return;
  auto &s = samples[id];
  if (!s.data || !s.raw)
    return;
  float scale = std::pow(2.f, s.bits - 1), peak = 0;
  for (int i = 0; i < s.frames; i++) {
    int source = s.reverse ? s.frames - 1 - i : i;
    if (s.crush < 44100)
      source = int(std::floor(std::floor(double(source) * s.crush / 44100) *
                              44100 / s.crush));
    source = max(0, min(s.frames - 1, source));
    for (int c = 0; c < 2; c++) {
      float v = s.raw[source * 2 + c];
      if (!std::isfinite(v))
        v = 0;
      if (s.bits < 32)
        v = clamp(std::nearbyint(v * scale), -scale, scale - 1) / scale;
      s.data[i * 2 + c] = v;
      if (i >= s.start && i < s.end)
        peak = max(peak, std::abs(v));
    }
  }
  if (s.normalize && peak > 0)
    for (int i = s.start * 2; i < s.end * 2; i++)
      s.data[i] /= peak;
}
API void stop_sample(int id) {
  for (auto &v : voices)
    if (v.active && v.sample == id) {
      v.retired = true;
      v.stopAge = 0;
    }
}
API void trigger(int id, int note, int velocity, int channel) {
  if (id < 0 || id >= MAX_SAMPLES || velocity <= 0)
    return;
  auto &s = samples[id];
  if (!s.frames || !s.data || s.muted)
    return;
  int active = 0;
  Voice *oldest = nullptr;
  for (auto &v : voices)
    if (v.active) {
      if (!v.retired) {
        active++;
        if (!oldest || v.age > oldest->age)
          oldest = &v;
      }
      if (v.sample == id &&
          (s.mode == 0 || s.mode == 3 || s.mode == 6 ||
           ((s.mode == 2 || s.mode == 4 || s.mode == 7) && v.note == note))) {
        v.retired = true;
        v.stopAge = 0;
      }
    }
  if (active >= voiceLimit && oldest) {
    oldest->retired = true;
    oldest->stopAge = 0;
  }
  Voice *target = nullptr;
  for (auto &v : voices)
    if (!v.active) {
      target = &v;
      break;
    }
  if (!target) {
    target = &voices[0];
    for (auto &v : voices)
      if (v.age > target->age)
        target = &v;
  }
  *target = Voice{};
  auto &v = *target;
  v.active = true;
  v.sample = id;
  v.note = note;
  v.channel = channel;
  v.mode = s.mode;
  v.pos = s.start;
  float pitch =
      s.semitone + s.fine / 100 +
      (s.root >= 0 && (s.spread == 0 || s.spread == 1) ? note - s.root : 0);
  v.speed = std::pow(2.f, pitch / 12) * 44100 / rate;
  v.velocity = s.maxVelocity ? 1 : clamp(velocity / 127.f, 0, 1);
  v.total = (s.end - s.start) / v.speed;
  v.attack =
      min(v.total, max(0.f, spreadValue(s, note, s.attack, 5) * rate / 1000));
  v.decay =
      min(v.total, max(0.f, spreadValue(s, note, s.decay, 6) * rate / 1000));
  if (s.mode < 3 && v.attack + v.decay > v.total) {
    v.attack = min(v.attack, rate * .05f);
    v.decay = min(v.decay, max(0.f, v.total - v.attack));
  }
  v.currentLevel = spreadValue(s, note, s.level, 2);
  updateFilter(v, s, 128);
}
API void release(int note, int channel) {
  for (auto &v : voices)
    if (v.active && v.note == note && v.channel == channel) {
      v.released = true;
      if (v.mode < 3 || pedal[max(0, min(16, channel))])
        continue;
      if (v.mode >= 6) {
        v.total = v.age + (samples[v.sample].end - v.pos) / v.speed;
        v.decay = max(v.decay, rate * .005f);
      } else if (v.releaseAge < 0) {
        v.releaseAge = 0;
        v.releaseGain =
            v.attack > 0 ? min(1.f, v.age / max(1.f, v.attack - 1)) : 1;
        v.decay = max(rate * .005f, v.decay);
      }
    }
}
API void sustain(int channel, int down) {
  channel = max(0, min(16, channel));
  bool was = pedal[channel];
  pedal[channel] = down;
  if (was && !down)
    for (auto &v : voices)
      if (v.active && v.channel == channel && v.released && v.mode >= 3) {
        if (v.mode >= 6) {
          v.total = v.age + (samples[v.sample].end - v.pos) / v.speed;
          v.decay = max(v.decay, rate * .005f);
        } else if (v.releaseAge < 0) {
          v.releaseAge = 0;
          v.releaseGain =
              v.attack > 0 ? min(1.f, v.age / max(1.f, v.attack - 1)) : 1;
          v.decay = max(rate * .005f, v.decay);
        }
      }
}
API int active_voices() {
  int n = 0;
  for (auto &v : voices)
    if (v.active)
      n++;
  return n;
}
API float output_peak() { return peak; }
API int note_active(int n) {
  for (auto &v : voices)
    if (v.active && !v.retired && v.note == n)
      return 1;
  return 0;
}
API float position(int id) {
  for (auto &v : voices)
    if (v.active && v.sample == id && !v.retired)
      return v.pos;
  return -1;
}
API void render(int frames) {
  frames = max(0, min(MAX_FRAMES, frames));
  for (int i = 0; i < frames; i++)
    outL[i] = outR[i] = 0;
  // Coefficients update once per quantum, not once per channel/sample.
  for (auto &v : voices)
    if (v.active)
      updateFilter(v, samples[v.sample], frames);
  float blockPeak = 0;
  for (int frame = 0; frame < frames; frame++) {
    float dry[2] = {}, bus1[4] = {}, bus2[2] = {};
    for (auto &v : voices) {
      if (!v.active)
        continue;
      auto &s = samples[v.sample];
      bool gated = v.mode >= 3;
      bool looping =
          v.mode >= 6 && (!v.released || pedal[max(0, min(16, v.channel))]);
      if ((!looping && v.pos >= s.end) ||
          (v.retired && v.stopAge >= rate * .005f) ||
          (v.releaseAge >= 0 && v.releaseAge >= v.decay)) {
        v.active = false;
        continue;
      }
      if (looping && v.pos >= s.loopEnd)
        v.pos = s.loopStart +
                fmod(v.pos - s.loopEnd, max(1, s.loopEnd - s.loopStart));
      int left = int(v.pos), right = min(s.end - 1, left + 1);
      if (looping && right >= s.loopEnd)
        right = s.loopStart;
      float f = v.pos - left;
      float gain = 1;
      if (v.attack > 0)
        gain = min(gain, v.age / max(1.f, v.attack - 1));
      if (v.releaseAge >= 0)
        gain =
            v.releaseGain * max(0.f, 1 - v.releaseAge / max(1.f, v.decay - 1));
      else if ((!gated || (v.released && !pedal[max(0, min(16, v.channel))])) &&
               v.decay > 0)
        gain = min(gain,
                   clamp((v.total - 1 - v.age) / max(1.f, v.decay - 1), 0, 1));
      gain = min(gain, clamp(v.age / max(1.f, rate * .005f - 1), 0, 1));
      if (!looping)
        gain = min(gain, clamp(float((s.end - v.pos) / v.speed) /
                                   max(1.f, rate * .005f),
                               0, 1));
      if (v.retired)
        gain *= max(0.f, 1 - v.stopAge / (rate * .005f));
      float target = spreadValue(s, v.note, s.level, 2);
      v.currentLevel += (target - v.currentLevel) * .005f;
      gain *= v.velocity * v.currentLevel;
      for (int c = 0; c < 2; c++) {
        float x =
            (s.data[left * 2 + c] * (1 - f) + s.data[right * 2 + c] * f) * gain;
        if (s.mono) {
          if (s.monoChannel) {
            int channel = s.monoChannel - 1;
            x = (s.data[left * 2 + channel] * (1 - f) + s.data[right * 2 + channel] * f) * gain;
          } else x = (s.data[left * 2] * (1 - f) + s.data[right * 2] * f +
               s.data[left * 2 + 1] * (1 - f) + s.data[right * 2 + 1] * f) * .5f * gain;
        }
        float y = v.b0 * x + v.z1[c];
        v.z1[c] = v.b1 * x - v.a1 * y + v.z2[c];
        v.z2[c] = v.b2 * x - v.a2 * y;
        if (!std::isfinite(y)) {
          y = 0;
          v.z1[c] = v.z2[c] = 0;
        }
        y *= c == 0 ? s.panLeft : s.panRight;
        if (s.muted) y = 0;
        dry[c] += y;
        bus1[c] += y * s.fx1;
        bus1[c + 2] += y * s.fx1 * s.fx2;
        bus2[c] += y * s.fx2;
      }
      v.pos += v.speed;
      v.age++;
      if (v.retired)
        v.stopAge++;
      if (v.releaseAge >= 0)
        v.releaseAge++;
    }
    float wet1[4], wet2[2];
    delays[0].process(bus1, wet1);
    bus2[0] += wet1[2];
    bus2[1] += wet1[3];
    delays[1].process(bus2, wet2);
    float l = (dry[0] + wet1[0] + wet2[0]) * master,
          r = (dry[1] + wet1[1] + wet2[1]) * master;
    // Discard non-finite values before the Python-compatible block limiter.
    if (!std::isfinite(l))
      l = 0;
    if (!std::isfinite(r))
      r = 0;
    outL[frame] = l;
    outR[frame] = r;
    blockPeak = max(blockPeak, max(std::abs(l), std::abs(r)));
  }
  // Match the Python sampler: scale the complete output quantum to .95 peak.
  if (blockPeak > .95f) {
    const float gain = .95f / blockPeak;
    for (int i = 0; i < frames; i++) {
      outL[i] *= gain;
      outR[i] *= gain;
    }
  }
  peak = max(blockPeak, peak * .94f);
}
API int processed_pointer(int id) {
  return id >= 0 && id < MAX_SAMPLES ? (int)(uintptr_t)samples[id].data : 0;
}
API void accept_processed(int id) {
  if (id >= 0 && id < MAX_SAMPLES && samples[id].raw && samples[id].data)
    memcpy(samples[id].data, samples[id].raw,
           samples[id].frames * 2 * sizeof(float));
}

API int refresh_processed(int id, int ptr, int frames) {
  if (id < 0 || id >= MAX_SAMPLES)
    return 0;
  auto &s = samples[id];
  if (!s.data || s.frames != frames)
    return 0;
  memcpy(s.data, (void *)(uintptr_t)ptr, frames * 2 * sizeof(float));
  if (s.raw)
    memcpy(s.raw, (void *)(uintptr_t)ptr, frames * 2 * sizeof(float));
  return 1;
}
