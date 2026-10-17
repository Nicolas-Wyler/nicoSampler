# Compatibility and verification

The application is a standard browser app/PWA, not a Chrome extension or Chrome-only packaged app. Its runtime is local HTML/CSS/JavaScript, WebAssembly, Web Audio/AudioWorklet and browser storage. HTTPS or loopback HTTP is required; file URLs are unsupported.

| Engine / environment | Evidence | Boundaries |
| --- | --- | --- |
| Chromium / Chrome | Automated actual-browser playback, editing, exports, recording fixtures, touch interactions, storage and stopped-origin offline tests | Physical Windows/Android/Edge installations are not individually certified |
| WebKit | Automated actual-browser playback, recording fixtures, save/import, offline cache and UI tests | Playwright WebKit is engine coverage, not a physical iPhone or shipping Safari certification |
| Firefox | Actual-browser core playback, file/ZIP, editor keyboard, recording fixtures and offline checks | Browser-specific MIDI, screen capture and installation remain capability-dependent |
| macOS ARM portable launcher | Native execution, HTTP/WASM, service worker offline reload, controlled stop and security tests | Unsigned/not notarized |
| Intel macOS launcher | Cross-built binary, architecture inspection and common server tests | Not executed on physical Intel hardware |

Windows/Linux releases are paused; previous downloads and source remain available.

All third-party runtime assets are bundled; there are no CDNs or analytics. Initial hosted loading requires a network connection. The service worker makes cached application assets available offline after installation; permission and device access remain browser controlled.

Safari on iOS 18.3 does not expose Web MIDI, so external MIDI devices cannot connect directly to this browser/PWA. Installing the PWA does not add the API. A native app/Core MIDI bridge would require a separate installation. See [WebKit implementation status](https://bugs.webkit.org/show_bug.cgi?id=107250) and [browser compatibility data](https://github.com/mdn/browser-compat-data/blob/main/api/Navigator.json).

MIDI controls appear when usable inputs are connected. Where Web MIDI is unavailable, use PC keys or the onscreen piano. Shared-tab/system audio depends on capture support and user sharing choices; microphone input is a separate capability. PWA installation UI differs across browsers, while the ordinary browser tab remains usable.

Recent independent Classic reviews achieved 9.0/10 with no reproduced blocker across their stated checks. Release testing includes generated, deterministic examples. Test counts change as new checks are added; do not read a past score as a guarantee of untested hardware or future changes. Raw personal-machine verification logs are intentionally excluded from this public repository. Portable repeatable tests and a release QA summary are provided instead.

Known deliberate limits: physical iPhone verification remains pending; cross-window Cut keeps original rows while pasting copies; transient Trim viewport/undo/live permission state are not restored from a project; PWA updates may need a reload after a new service worker activates. Unsigned native downloads may prompt for OS approval. Browser-local storage is origin/profile/port specific, so export ZIP backups.

## System-output recording

The original Python sampler uses a native macOS Swift helper for its direct System Audio input. The dependency-free browser/PWA build does not include that native helper. It requests system audio through the browser screen-sharing picker; this requires choosing a tab/window/screen, and full system-audio availability depends on the browser/OS. The sampler processes audio only and does not record or upload screen video. Installing the PWA does not grant native capture access.

MIDI permission is checked at startup where supported: existing grants reconnect automatically, prompt state uses Connect MIDI, and denied state explains Chrome site settings. Local PC Keyboard and None choices do not depend on Web MIDI.

iPhone piano views are limited to two visible octaves at their widest zoom; scrolling still reaches all notes. Automated phone audio/zoom checks run in desktop WebKit with touch emulation; they do not certify physical iOS 18.3 audio routing or silent-switch behavior.

On iPhone the piano uses explicit Play/Move modes. Safari has no keyboard attach/detach event: PC range hints are enabled after trusted key use outside editable fields and reset when leaving the app. This is usage detection, not hardware detection. Piano resize grips stay visible when folded, allowing a drag to reopen it; the height is bounded to half the window.
