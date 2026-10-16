# Compatibility and verification

The application is a standard browser app/PWA, not a Chrome extension or Chrome-only packaged app. Its runtime is local HTML/CSS/JavaScript, WebAssembly, Web Audio/AudioWorklet and browser storage. HTTPS or loopback HTTP is required; file URLs are unsupported.

| Engine / environment | Evidence | Boundaries |
| --- | --- | --- |
| Chromium / Chrome | Automated actual-browser playback, editing, exports, recording fixtures, touch interactions, storage and stopped-origin offline tests | Physical Windows/Android/Edge installations are not individually certified |
| WebKit | Automated actual-browser playback, recording fixtures, save/import, offline cache and UI tests | Playwright WebKit is engine coverage, not a physical iPhone or shipping Safari certification |
| Firefox | Actual-browser core playback, file/ZIP, editor keyboard, recording fixtures and offline checks | Browser-specific MIDI, screen capture and installation remain capability-dependent |
| macOS ARM portable launcher | Native execution, HTTP/WASM, service worker offline reload, controlled stop and security tests | Unsigned/not notarized |
| Intel macOS / Windows x64 / Windows ARM64 launchers | Cross-built binaries, architecture inspection and common server tests | Not executed on each target's physical hardware |

All third-party runtime assets are bundled; there are no CDNs or analytics. Initial hosted loading requires a network connection. The service worker makes cached application assets available offline after installation; permission and device access remain browser controlled.

Safari on iOS 18.3 does not expose Web MIDI, so external MIDI devices cannot connect directly to this browser/PWA. Installing the PWA does not add the API. A native app/Core MIDI bridge would require a separate installation. See [WebKit implementation status](https://bugs.webkit.org/show_bug.cgi?id=107250) and [browser compatibility data](https://github.com/mdn/browser-compat-data/blob/main/api/Navigator.json).

MIDI controls appear when usable inputs are connected. Where Web MIDI is unavailable, use PC keys or the onscreen piano. Shared-tab/system audio depends on capture support and user sharing choices; microphone input is a separate capability. PWA installation UI differs across browsers, while the ordinary browser tab remains usable.

Recent independent Classic reviews achieved 9.0/10 with no reproduced blocker across their stated checks. Release testing includes generated, deterministic examples. Test counts change as new checks are added; do not read a past score as a guarantee of untested hardware or future changes. Raw personal-machine verification logs are intentionally excluded from this public repository. Portable repeatable tests and a release QA summary are provided instead.

Known deliberate limits: physical iPhone verification remains pending; cross-window Cut keeps original rows while pasting copies; transient Trim viewport/undo/live permission state are not restored from a project; PWA updates may need a reload after a new service worker activates. Unsigned native downloads may prompt for OS approval. Browser-local storage is origin/profile/port specific, so export ZIP backups.
