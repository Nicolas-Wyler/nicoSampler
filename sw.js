const VERSION = "0.2.0-dev";
const CACHE = "nico-sampler-classic-v2-c8b3dfd7325b";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./src/app.js",
  "./src/offline-install.js",
  "./src/version.js",
  "./src/example-kit.js",
  "./src/master-knob.js",
  "./src/input-monitor.js",
  "./src/settings.js",
  "./src/landing-import.js",
  "./src/landing.css",
  "./src/model.js",
  "./src/key-colors.js",
  "./src/input-routing.js",
  "./src/page-gestures.js",
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
async function cacheAssets(cache, missingOnly = false, progress = () => {}) {
  let completed = 0;
  for (let offset = 0; offset < ASSETS.length; offset += 4) {
    await Promise.all(
      ASSETS.slice(offset, offset + 4).map(async (asset) => {
        const url = new URL(asset, self.location.href);
        if (missingOnly && (await cache.match(url, { ignoreVary: true }))) {
          progress(++completed, ASSETS.length);
          return;
        }
        for (let attempt = 0; ; attempt++) {
          try {
            await cache.add(new Request(url, { cache: "reload" }));
            progress(++completed, ASSETS.length);
            return;
          } catch (error) {
            if (attempt >= 2) throw error;
          }
        }
      }),
    );
  }
}
async function manualUpdateSupported() {
  const active = self.registration?.active;
  if (!active) return false;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      resolve(false);
    }, 2000);
    channel.port1.onmessage = ({ data }) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(data.manualUpdates === true);
    };
    active.postMessage({ type: "OFFLINE_STATUS" }, [channel.port2]);
  });
}
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      // One-time migration from older automatic workers, then wait for user consent.
      if (await manualUpdateSupported()) return;
      await cacheAssets(await caches.open(CACHE));
      await self.skipWaiting();
    })(),
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
        .match(e.request, {
          cacheName: CACHE,
          ignoreVary: true,
          ignoreSearch: new URL(e.request.url).pathname.startsWith(
            new URL("./icons/", self.location.href).pathname,
          ),
        })
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

self.addEventListener("message", (event) => {
  if (event.data?.type === "APPLY_UPDATE") {
    event.waitUntil(
      (async () => {
        const port = event.ports[0];
        try {
          await cacheAssets(
            await caches.open(CACHE),
            false,
            (completed, total) =>
              port?.postMessage({ progress: completed / total }),
          );
          port?.postMessage({ done: true });
          await self.skipWaiting();
        } catch (error) {
          port?.postMessage({ error: error.message });
        }
      })(),
    );
    return;
  }
  if (event.data?.type !== "OFFLINE_STATUS") return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      if (event.data.repair) {
        try {
          await cacheAssets(cache, true);
        } catch {
          /* Report incomplete state below so the user can retry. */
        }
      }
      const present = await Promise.all(
        ASSETS.map((asset) =>
          cache.match(new URL(asset, self.location.href), { ignoreVary: true }),
        ),
      );
      event.ports[0]?.postMessage({
        version: CACHE,
        appVersion: VERSION,
        manualUpdates: true,
        ready: present.every(Boolean),
        cached: present.filter(Boolean).length,
        total: ASSETS.length,
      });
    })(),
  );
});
