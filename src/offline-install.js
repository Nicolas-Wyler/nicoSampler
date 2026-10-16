const badge = document.getElementById("offline-status");
let busy = false;
async function prepare() {
  if (busy) return;
  busy = true;
  badge.hidden = false;
  delete badge.dataset.error;
  badge.textContent = "Downloading offline copy… Keep this app open";
  try {
    if (!("serviceWorker" in navigator))
      throw Error("Offline installation unavailable");
    const registration = await navigator.serviceWorker.register(
      new URL("../sw.js", import.meta.url),
      { updateViaCache: "none" },
    );
    await registration.update().catch(() => {});
    const worker =
      registration.installing || registration.waiting || registration.active;
    if (!worker) throw Error("Open online to install");
    if (worker.state !== "activated") {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Download incomplete")),
          180000,
        );
        const check = () => {
          if (worker.state === "activated") {
            clearTimeout(timer);
            worker.removeEventListener("statechange", check);
            resolve();
          } else if (worker.state === "redundant") {
            clearTimeout(timer);
            worker.removeEventListener("statechange", check);
            reject(Error("Download interrupted"));
          }
        };
        worker.addEventListener("statechange", check);
        check();
      });
    }
    const ready = await navigator.serviceWorker.ready;
    const result = await new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(
        () => reject(Error("Offline verification timed out")),
        180000,
      );
      channel.port1.onmessage = ({ data }) => {
        clearTimeout(timer);
        channel.port1.close();
        resolve(data);
      };
      (ready.active || worker).postMessage({ type: "OFFLINE_STATUS", repair: navigator.onLine }, [
        channel.port2,
      ]);
    });
    if (!result.ready) throw Error("Offline download incomplete");
    await navigator.storage?.persist?.().catch(() => false);
    badge.textContent =
      "✓ Ready offline — app and examples saved on this device";
    badge.title =
      "Offline storage verified. Tap to dismiss. iOS may remove website data if device storage is cleared.";
    badge.onclick = () => {
      badge.hidden = true;
    };
    setTimeout(() => {
      if (!badge.dataset.error) badge.hidden = true;
    }, 12000);
  } catch (error) {
    badge.dataset.error = "true";
    badge.textContent = "Offline copy not ready — connect and tap to retry";
    badge.title = error.message;
    badge.onclick = prepare;
  } finally {
    busy = false;
  }
}
window.addEventListener("online", () => {
  if (badge.dataset.error) void prepare();
});
void prepare();
