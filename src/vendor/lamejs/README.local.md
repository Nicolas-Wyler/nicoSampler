# Bundled LAME JavaScript encoder

Upstream: https://github.com/zhuker/lamejs
Distribution: https://registry.npmjs.org/lamejs/-/lamejs-1.2.1.tgz
Version: 1.2.1, package license LGPL-3.0.
Downloaded package SHA-256: `d8d099ef788808c15bc9b4a407dd23ae935feb1152e6bb0efdcd24e3e91c2a2d`.

The browser encoder is bundled locally; it does not fetch code or install anything at runtime. `lame.esm.js` is upstream `lame.min.js` with one appended `export default lamejs;` statement. No encoder logic is changed. `lame.all.js` is the unminified bundle; `source/` contains the corresponding JavaScript sources. The original package manifest and license notice, inherited COPYING, and complete LGPLv3/GPLv3 license texts are included here.

To replace or modify the separately imported encoder, replace `lame.esm.js` with an ES module exporting an object with `Mp3Encoder`, or change the import in `../../mp3-encoder.js`. The application source is supplied alongside this library. Encoding runs in the local export worker; no server receives the audio.
