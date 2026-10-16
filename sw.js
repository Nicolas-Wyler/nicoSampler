const CACHE = "nico-sampler-classic-v2-5285dcb29bcd";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./src/app.js",
  "./src/example-kit.js",
  "./src/master-knob.js",
  "./src/input-monitor.js",
  "./src/settings.js",
  "./src/landing-import.js",
  "./src/landing.css",
  "./src/model.js",
  "./src/sample-audibility.js",
  "./src/storage.js",
  "./src/file-worker.js",
  "./src/audio.js",
  "./src/wasm-engine.js",
  "./src/audio-worklet.js",
  "./src/edit-worker.js",
  "./src/waveform.js",
  "./src/classic-ui.js",
  "./src/selection.js",
  "./src/controls.js",
  "./src/filter-ui.js",
  "./src/meters.js",
  "./src/sample-container.js",
  "./src/project-bundle.js",
  "./src/project-import.js",
  "./src/sample-bundle.js",
  "./src/wav-format.js",
  "./src/render-sample.js",
  "./src/resample-export.js",
  "./src/render-options.js",
  "./src/mp3-encoder.js",
  "./src/vendor/lamejs/lame.esm.js",
  "./src/rows.css",
  "./src/zoom-inertia.js",
  "./src/program-drag.js",
  "./src/sample-clipboard.js",
  "./src/workflows.js",
  "./src/engine.wasm",
  "./README.md",
  "./THIRD_PARTY_NOTICES.md",
  "./LICENSE",
];
self.addEventListener("install", (e) =>
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("nico-sampler-classic-") && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (e) => {
  if (
    e.request.method === "GET" &&
    new URL(e.request.url).origin === self.location.origin
  )
    e.respondWith(
      caches
        .match(e.request, { cacheName: CACHE, ignoreVary: true })
        .then(async (hit) => {
          if (hit) return hit;
          const url = new URL(e.request.url);
          const root = new URL("./", self.location.href);
          if (
            e.request.mode === "navigate" &&
            (url.pathname === root.pathname ||
              url.pathname === new URL("index.html", root).pathname)
          ) {
            const index = await caches.match(new URL("index.html", root), {
              cacheName: CACHE,
              ignoreVary: true,
            });
            if (index) return index;
          }
          return fetch(e.request);
        }),
    );
});
