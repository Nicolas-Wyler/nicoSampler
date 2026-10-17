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
    setCaptureSession: AudioController.prototype.setCaptureSession,
    disconnectInput: async () => {
      calls.push("disconnect");
    },
    enable: async () => {
      calls.push("enable");
    },
    context: {
      createMediaStreamSource: () => ({
        connect: () => calls.push("connected"),
        disconnect: () => calls.push("source-disconnected"),
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

test("audible monitor joins the protected worklet mix, applies Master/gain, and tears down", async () => {
  const messages=[],links=[];
  const controller={
    input:{disconnect:()=>links.push("disconnected")},stream:null,
    setCaptureSession: AudioController.prototype.setCaptureSession,
    send:message=>messages.push(message),
    context:{createGain:()=>{throw Error("Monitor must not bypass the protected worklet output");}},
  };
  AudioController.prototype.setInputMonitoring.call(controller,false);
  assert.deepEqual(messages.at(-1),{type:"monitor",gain:0});
  AudioController.prototype.setInputMonitoring.call(controller,true,-6,.5);
  assert.ok(Math.abs(messages.at(-1).gain-Math.pow(10,-6/20)*.5)<1e-8);
  AudioController.prototype.setInputMonitoring.call(controller,false);
  assert.equal(messages.at(-1).gain,0);
  await AudioController.prototype.disconnectInput.call(controller);
  assert.equal(controller.input,null);
  assert.equal(messages.at(-1).gain,0);
  assert.deepEqual(links,["disconnected"]);
});

function mockIosSession() {
 const changes=[];
 Object.defineProperty(navigator,'userAgent',{configurable:true,value:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X)'});
 Object.defineProperty(navigator,'audioSession',{configurable:true,value:{set type(value){changes.push(value);}}});
 return changes;
}
test('iOS capture session changes only around capture and restores playback after stopped tracks',async()=>{
 const changes=mockIosSession(),track={readyState:'live',stop(){this.readyState='ended';changes.push('track-stopped');}},stream={getAudioTracks:()=>[track],getTracks:()=>[track]};
 mockMedia({getUserMedia:async()=>stream,enumerateDevices:async()=>[]});
 const c=setup();
 AudioController.prototype.setCaptureSession.call(c,false);assert.deepEqual(changes,[],'initial playback policy unchanged');
 await AudioController.prototype.connectInput.call(c,'mic','','Stereo');
 assert.deepEqual(changes,['play-and-record']);
 await AudioController.prototype.disconnectInput.call(c);
 assert.deepEqual(changes,['play-and-record','track-stopped','playback']);
});
test('iOS capture denial restores playback without changing microphone-free startup',async()=>{
 const changes=mockIosSession();mockMedia({getUserMedia:async()=>{throw new DOMException('Denied','NotAllowedError');}});
 await assert.rejects(AudioController.prototype.connectInput.call(setup(),'mic','','Stereo'),/Denied/);
 assert.deepEqual(changes,['play-and-record','playback']);
});
test('ending all iOS microphone tracks restores playback session',async()=>{
 const changes=mockIosSession(),track={readyState:'live',stop(){}},stream={getAudioTracks:()=>[track],getTracks:()=>[track]};
 mockMedia({getUserMedia:async()=>stream,enumerateDevices:async()=>[]});const c=setup();
 await AudioController.prototype.connectInput.call(c,'mic','','Stereo');track.readyState='ended';track.onended();
 assert.deepEqual(changes,['play-and-record','playback']);
});
test('iOS capture setup failure stops granted tracks and restores playback session',async()=>{
 const changes=mockIosSession(),track={stopped:false,stop(){this.stopped=true;}},stream={getAudioTracks:()=>[track],getTracks:()=>[track]};
 mockMedia({getUserMedia:async()=>stream,enumerateDevices:async()=>[]});const c=setup();
 c.context.createMediaStreamSource=()=>{throw Error('Context closed during permission prompt');};
 await assert.rejects(AudioController.prototype.connectInput.call(c,'mic','','Stereo'),/Context closed/);
 assert.equal(track.stopped,true,'granted stream cannot leak when node setup fails');
 assert.deepEqual(changes,['play-and-record','playback']);
});
