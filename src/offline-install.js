import { smartphoneUI } from "./device-ui.js";
import { APP_VERSION } from "./version.js";
document.title = `nicoSampler · v${APP_VERSION}`;
document.querySelectorAll("[data-app-version]").forEach((element) => {
  element.textContent = "v" + APP_VERSION;
});
const badge = document.getElementById("offline-status");
const button = document.getElementById("app-update");
let badgeSwipe = null;
badge.style.touchAction = "none";
badge.addEventListener("pointerdown", event => {
  badgeSwipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
  if (event.isTrusted) badge.setPointerCapture(event.pointerId);
});
badge.addEventListener("pointermove", event => {
  if (!badgeSwipe || badgeSwipe.id !== event.pointerId) return;
  const dy = event.clientY - badgeSwipe.y;
  if (dy < -22 && Math.abs(dy) > Math.abs(event.clientX - badgeSwipe.x)) {
    badgeSwipe = null;
    const animation = badge.animate([
      {transform:"translateX(-50%) translateY(0)",opacity:1},
      {transform:"translateX(-50%) translateY(-90px)",opacity:0}
    ], {duration:160,easing:"ease-out"});
    animation.onfinish = () => {badge.hidden = true;};
    event.preventDefault();
  }
});
for (const type of ["pointerup", "pointercancel"]) badge.addEventListener(type, () => { badgeSwipe = null; });

const workerURL = new URL("../sw.js", import.meta.url);
let registration,
  preparing = false,
  checking = false,
  updating = false,
  hideTimer;
function placeButton() {
  const phone = smartphoneUI();
  if (phone) {
    document.getElementById("settings-update-control").hidden = false;
    button.classList.remove("landing-update");
    document.getElementById("settings-update-slot").append(button);
    return;
  }
  const main = document.getElementById("sampler");
  const landing = main.hidden;
  button.classList.toggle("landing-update", landing);
  if (landing) document.body.append(button);
  else
    document
      .querySelector(".audio-tools")
      .insertBefore(button, document.getElementById("panic"));
}
placeButton();
new MutationObserver(placeButton).observe(document.getElementById("sampler"), {
  attributes: true,
  attributeFilter: ["hidden"],
});
const refreshIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 5v6h-6M20 11a8 8 0 1 0-1.8 6.1"/></svg>';
function show(text, enabled = false, action = "none") {
  button.dataset.action = action;
  button.title = action === "check" ? "Check for updates" : text;
  button.setAttribute(
    "aria-label",
    action === "check" ? "Check for updates" : text,
  );
  clearTimeout(hideTimer);
  button.hidden = false;
  button.disabled = !enabled;
  button.textContent = text;
  if (action === "check") button.innerHTML = refreshIcon;
}
function rpc(worker, message, progress) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      reject(Error("Offline download timed out"));
    }, 180000);
    channel.port1.onmessage = ({ data }) => {
      if ("progress" in data) {
        progress?.(data.progress);
        return;
      }
      clearTimeout(timer);
      channel.port1.close();
      data.error ? reject(Error(data.error)) : resolve(data);
    };
    worker.postMessage(message, [channel.port2]);
  });
}
async function waitState(worker, state) {
  if (worker.state === state) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(Error("Update not ready")), 180000);
    const done = (error) => {
      clearTimeout(timer);
      worker.removeEventListener("statechange", check);
      error ? reject(error) : resolve();
    };
    const check = () => {
      if (worker.state === state) done();
      else if (worker.state === "redundant")
        done(Error("Download interrupted"));
    };
    worker.addEventListener("statechange", check);
    check();
  });
}
async function checkUpdates() {
  if (!registration || preparing || checking || updating) return;
  if (!navigator.onLine) {
    show("Offline");
    return;
  }
  checking = true;
  clearTimeout(hideTimer);
  button.hidden = false;
  button.disabled = true;
  button.innerHTML = `<span class="update-spinner" aria-hidden="true">${refreshIcon}</span> Checking…`;
  try {
    const local = await rpc(registration.active, { type: "OFFLINE_STATUS" });
    const response = await fetch(workerURL, { cache: "no-store" });
    if (!response.ok) throw Error("Update check unavailable");
    const awaitText = await response.text();
    const remote = /const CACHE = "([^"]+)"/.exec(awaitText)?.[1];
    if (!remote) throw Error("Invalid update response");
    const remoteVersion =
      /const VERSION = "([^"]+)"/.exec(awaitText)?.[1] ?? null;
    if (remote !== local.version || remoteVersion !== APP_VERSION) {
      show(
        remoteVersion ? `Update v${remoteVersion}` : "Update",
        true,
        "update",
      );
      button.title = remoteVersion
        ? `Current v${APP_VERSION} → update v${remoteVersion}`
        : `Current v${APP_VERSION} → update available`;
    } else {
      show("No updates found");
      hideTimer = setTimeout(() => {
        if (!updating) show("↻", true, "check");
      }, 3000);
    }
  } catch (error) {
    show(
      !navigator.onLine || error instanceof TypeError
        ? "Offline"
        : "Update check unavailable",
    );
  } finally {
    checking = false;
  }
}
async function saveBeforeUpdate() {
  const promises = [];
  window.dispatchEvent(
    new CustomEvent("sampler-before-update", {
      detail: { waitUntil: (p) => promises.push(p) },
    }),
  );
  await Promise.all(promises);
}
async function applyUpdate() {
  if (updating || button.disabled) return;
  updating = true;
  try {
    await saveBeforeUpdate();
    show("Updating 0%");
    button.style.setProperty("--progress", "0%");
    await registration.update();
    let worker = registration.waiting || registration.installing;
    if (worker) {
      await waitState(worker, "installed");
      await rpc(worker, { type: "APPLY_UPDATE" }, (fraction) => {
        const percent = Math.round(fraction * 100);
        show(`Updating ${percent}%`);
        button.style.setProperty("--progress", percent + "%");
      });
      await waitState(worker, "activated");
    }
    show("Update complete");
    button.style.setProperty("--progress", "100%");
    await saveBeforeUpdate();
    location.reload();
  } catch (error) {
    show(error.message + " · Retry", true, "update");
    button.style.setProperty("--progress", "0%");
  } finally {
    updating = false;
  }
}
button.addEventListener("click", () => {
  if (button.dataset.action === "check") void checkUpdates();
  else void applyUpdate();
});
async function prepare() {
  if (preparing) return;
  if (window.__PWA_DEVICE_DEBUGGER__) {
    badge.hidden = false;
    badge.textContent = `nicoSampler v${APP_VERSION} · Local preview updated`;
    setTimeout(() => { badge.hidden = true; }, 1200);
    show("Local source · automatic reload");
    return;
  }
  preparing = true;
  show(navigator.onLine ? "Checking…" : "Offline");
  badge.hidden = false;
  delete badge.dataset.error;
  badge.textContent = `nicoSampler v${APP_VERSION} · Preparing offline copy…`;
  try {
    if (!("serviceWorker" in navigator))
      throw Error("Offline installation unavailable");
    registration = await navigator.serviceWorker.register(workerURL, {
      updateViaCache: "none",
    });
    if (!registration.active) {
      const worker = registration.installing || registration.waiting;
      if (!worker) throw Error("Open online to install");
      await waitState(worker, "activated");
    }
    const result = await rpc(registration.active, {
      type: "OFFLINE_STATUS",
      repair: navigator.onLine,
    });
    if (!result.ready) throw Error("Offline download incomplete");
    await navigator.storage?.persist?.().catch(() => false);
    badge.textContent = `✓ v${APP_VERSION} · Ready offline`;
    badge.onclick = () => {
      badge.hidden = true;
    };
    setTimeout(() => {
      if (!badge.dataset.error) badge.hidden = true;
    }, 1500);
  } catch (error) {
    if (!registration)
      show(navigator.onLine ? "Update check unavailable" : "Offline");
    badge.dataset.error = "true";
    badge.textContent = "Offline copy not ready — connect and tap to retry";
    badge.title = error.message;
    badge.onclick = () => void prepare();
  } finally {
    preparing = false;
    void checkUpdates();
  }
}
window.addEventListener("online", () => {
  if (badge.dataset.error) void prepare();
  else void checkUpdates();
});
window.addEventListener("offline", () => {
  if (!updating) show("Offline");
});
window.addEventListener("pageshow", () => void checkUpdates());
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void checkUpdates();
});
setInterval(() => {
  if (!document.hidden) void checkUpdates();
}, 300000);
void prepare();
