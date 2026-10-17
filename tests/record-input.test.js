import test from "node:test";
import assert from "node:assert/strict";
import { AudioController, requestSystemAudio } from "../src/audio.js";
function mockMedia(media) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: media,
  });
}
function setup() {
  const calls = [];
  return {
    calls,
    setInputMonitoring: AudioController.prototype.setInputMonitoring,
    disconnectInput: async () => {
      calls.push("disconnect");
    },
    enable: async () => {
      calls.push("enable");
    },
    context: {
      createMediaStreamSource: () => ({
        connect: () => calls.push("connected"),
      }),
    },
    node: {},
    send: () => {},
    onEvent: () => {},
  };
}
test("system audio picker starts immediately and its stream is used without a second prompt", async () => {
  const order = [],
    track = {
      stop() {
        this.stopped = true;
      },
    },
    stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  mockMedia({
    getDisplayMedia: (options) => {
      order.push("picker");
      assert.equal(options.systemAudio, "include");
      assert.equal(options.audio, true);
      return Promise.resolve(stream);
    },
    enumerateDevices: async () => [{ kind: "audioinput", deviceId: "usb" }],
  });
  const shared = requestSystemAudio();
  assert.deepEqual(order, ["picker"]);
  const controller = setup();
  const devices = await AudioController.prototype.connectInput.call(
    controller,
    "system",
    "usb",
    "Stereo",
    shared,
  );
  assert.equal(controller.stream, stream);
  assert.equal(devices[0].deviceId, "usb");
  assert.equal(order.length, 1);
  assert.ok(!track.stopped);
});
test("video-only sharing stops all tracks and reports how to enable audio", async () => {
  const track = {
      stop() {
        this.stopped = true;
      },
    },
    stream = { getAudioTracks: () => [], getTracks: () => [track] };
  mockMedia({ getDisplayMedia: async () => stream });
  await assert.rejects(
    AudioController.prototype.connectInput.call(
      setup(),
      "system",
      "",
      "Stereo",
      requestSystemAudio(),
    ),
    /No audio shared/,
  );
  assert.equal(track.stopped, true);
});
test("microphone input uses the chosen device and enumeration errors do not break capture", async () => {
  const track = {},
    stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  mockMedia({
    getUserMedia: async (options) => {
      assert.deepEqual(options.audio.deviceId, { exact: "usb" });
      assert.equal(options.audio.autoGainControl, false);
      return stream;
    },
    enumerateDevices: async () => {
      throw Error("enumeration unavailable");
    },
  });
  const controller = setup();
  assert.deepEqual(
    await AudioController.prototype.connectInput.call(
      controller,
      "mic",
      "usb",
      "Stereo",
    ),
    [],
  );
  assert.equal(controller.stream, stream);
});

test("audible input monitoring stays disconnected by default, applies gain only on request and tears down", async () => {
  const links = [],
    values = [];
  const gain = {
    gain: { setValueAtTime: (v, t) => values.push([v, t]) },
    connect: (n) => links.push(n),
    disconnect: () => links.push("disconnect monitor"),
  };
  const controller = {
    input: {
      connect: (n) => links.push(n),
      disconnect: () => links.push("disconnect input"),
    },
    context: { currentTime: 2, destination: {}, createGain: () => gain },
    stream: null,
  };
  AudioController.prototype.setInputMonitoring.call(controller, false);
  assert.equal(links.length, 0);
  AudioController.prototype.setInputMonitoring.call(controller, true, -6);
  assert.equal(links.length, 2);
  assert.ok(Math.abs(values[0][0] - Math.pow(10, -6 / 20)) < 1e-8);
  AudioController.prototype.setInputMonitoring.call(controller, false);
  assert.equal(values.at(-1)[0], 0);
  await AudioController.prototype.disconnectInput.call(controller);
  assert.equal(controller.monitorOutput, null);
  assert.equal(controller.input, null);
  assert.ok(links.includes("disconnect monitor"));
});
