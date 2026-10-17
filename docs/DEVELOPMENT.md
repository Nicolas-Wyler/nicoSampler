# Developer guide

## Source map

- `src/app.js`: application state, import/save, recorder, routing and UI coordination.
- `src/classic-ui.js`, `src/rows.css`, `style.css`: table, touch selection, adaptive layout, keyboard and controls.
- `src/audio.js`, `src/audio-worklet.js`, `src/wasm-engine.js`: browser audio, worklet and compiled engine integration.
- `dsp/engine.cpp` → `src/engine.wasm`: real-time synthesis/playback/effect processing.
- `src/model.js`, `settings.js`, `storage.js`: validation, portable preferences, local recovery and serialization.
- `src/project-*`, `sample-*`, `wav-format.js`: archives, containers, relative assets and audio formats.
- `src/render-*`, `resample-export.js`, `mp3-encoder.js`: offline processing and export.
- `src/example-kit.js`, `scripts/build-examples.mjs`: deterministic original demo synthesis and archives.
- `tools/launcher`: dependency-free native loopback server source and security tests.
- `src/vendor/lamejs`, `licenses`, `portable/third-party`: bundled source and required third-party notices.

## Run and test

Use Node.js 22 or newer and install FFmpeg (`ffprobe` on PATH, or set `FFPROBE`) for independent MP3 format checks. `npm ci` installs developer-only Playwright. `npm run serve` starts the loopback preview. End users do not need Node.

```sh
npm ci
npm test
npm run test:integration
npx playwright install
npm run test:browser
```

`npm test` first regenerates the example archives, then runs Node's test runner on `tests/*.test.js`. Tests cover model validation, DSP, worker memory, formats, bundles, non-destructive settings, workflow races, selection, 12-bit WAV, persistent preferences and examples. Integration scripts exercise real WASM rendering and related modules; the archive interoperability check additionally requires Python 3 from the developer environment (standard library only). Browser smoke tests start their own server and use only generated audio; no personal audio or local developer paths are needed. `BROWSERS=chromium,firefox,webkit` selects engines. Browsers are developer tools and are not shipped with the app.

Synthetic streams/latency are test fixtures, not proof of physical microphone/MIDI latency. Current limits include a 128-voice engine, 128 programs, 512 rows per program and 128 MiB source-audio budget. Group auditions larger than the voice limit are limited by that engine capacity.

## Rebuild DSP

The precompiled `src/engine.wasm` is included. To modify it, download an official WASI SDK, set `WASI_SDK_PATH` and run `./build.sh` on a POSIX development system. The command uses C++17, optimization, no exceptions/RTTI, a reactor module and explicit memory limits. Native C++/WASI build tools are not runtime requirements. Preserve upstream runtime/compiler notices.

## Examples and release builds

`npm run build:examples` recreates the bank and three program ZIPs from seeded procedural synthesis. No imported recordings are used. Verify `examples/manifest.json`; hashes and raw sources are reproducible.

Build portable servers with `scripts/build-launchers.sh` or `.ps1` using the documented Go toolchain. See [portable documentation](PORTABLE-LAUNCHER.md). A developer toolchain is needed only to rebuild native servers.

`npm run build:release` creates the static browser build, docs bundle, examples bundle, source archive and architecture-specific portable packages in `dist/`, plus SHA256SUMS. It refreshes the service-worker content hash for the distributed copy after its README/docs are assembled. Do not edit packaged files after hashing. `npm run check:public` rejects personal paths, credentials, recordings and private verification artifacts from the public source/distribution plan.

The Pages workflow tests and archives each build as a numbered GitHub prerelease, then publishes the static `dist/web` directory. Versions use the base major/minor and workflow run number; reruns add a build suffix. The window title, visible version, update target, service worker and archive manifest share that version. Existing release assets are never overwritten. Local builds get timestamped development versions; `SAMPLER_BUILD_VERSION` can reproduce a reviewed candidate. No workflow sends user audio or browser recovery to a server.

## Contributions and licensing

This is source available under a custom license, not permissive/OSI open source. Read LICENSE before redistributing or commercializing a fork. Contributions should be offered under the same project terms, preserve third-party notices, and identify meaningful behavior changes. Music made with the app is unrestricted by the software-distribution condition and needs no attribution.

## Local iPhone layout preview

Primary compatibility target: iPhone 12 Pro Max running iOS 18.3. Desktop WebKit emulation cannot reproduce that exact iOS engine; physical-device validation is required for platform-specific behavior.

Every local release build also generates ignored `artifacts/iphone-preview/Start.command`. Double-click it to launch WebKit at a fixed iPhone 12 Pro Max viewport (428 × 926) with touch and coarse-pointer settings. Use `iPhone 12 Smaller.command` for a second 390 × 844 preview; both can run together. Install Playwright WebKit first with `npx playwright install webkit` if needed. This preview and its app copy stay local and are excluded from public archives. It simulates layout, not physical iOS hardware, permissions or Safari integration.

`npm run test:recorder` exercises synthetic captured audio, audible monitoring, take-table selection/playback, rename/delete, recovery and MIDI routing in Chrome/WebKit. `npm run test:auto-assign` covers multi-file imports and collision-free key assignment in both engines. These tests use generated fixtures, not user recordings.
