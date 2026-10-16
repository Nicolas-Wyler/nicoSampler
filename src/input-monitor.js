/** Browser-reported output latency only; missing measurements remain unknown. */
export function reportedLatency(value) {
  if (typeof value === "number")
    return Number.isFinite(value) && value >= 0 ? value : null;
  if (!value || typeof value !== "object") return null;
  const parts = [value.baseLatency, value.outputLatency].filter(
    (n) => typeof n === "number" && Number.isFinite(n) && n >= 0,
  );
  return parts.length ? parts.reduce((sum, n) => sum + n, 0) : null;
}
/** Runtime capture switch. The app owns permission, recording finalization and teardown. */
export class InputMonitor {
  constructor({
    button,
    meter,
    getLatency = () => null,
    onEnable = async () => true,
    onDisable = async () => {},
    onAutoDisable = () => {},
    onState = () => {},
    onError = (error) => console.error(error),
    now = () => performance.now(),
  } = {}) {
    if (!button) throw Error("Input monitor button is required");
    Object.assign(this, {
      button,
      meter:
        meter?.closest?.(".input-monitor-control") ??
        meter ??
        button.closest?.(".input-monitor-control"),
      getLatency,
      onEnable,
      onDisable,
      onAutoDisable,
      onState,
      onError,
      now,
    });
    this._active = false;
    this._wanted = false;
    this._busy = false;
    this._pending = null;
    this.onClick = () => {
      void this.toggle().catch(this.onError);
    };
    button.addEventListener("click", this.onClick);
    this.update();
  }
  get active() {
    return this._active;
  }
  get wanted() {
    return this._wanted;
  }
  get busy() {
    return this._busy;
  }
  latency() {
    try {
      return reportedLatency(this.getLatency());
    } catch {
      return null;
    }
  }
  update() {
    this.button.disabled = this._busy;
    this.button.setAttribute("aria-pressed", String(this._active));
    this.button.setAttribute(
      "aria-label",
      this._active ? "Deactivate input monitor" : "Activate input monitor",
    );
    this.button.classList.toggle("active", this._active);
    this.button.classList.toggle("busy", this._busy);
    this.meter?.classList.toggle("monitor-active", this._active);
    this.meter?.classList.toggle("monitor-busy", this._busy);
    const label =
      this.button.querySelector(".input-monitor-label") ?? this.button;
    label.textContent = this._busy
      ? this._wanted
        ? "Connecting…"
        : "Disconnecting…"
      : this._active
        ? "Deactivate?"
        : "Click to activate";
    this.onState({
      active: this._active,
      busy: this._busy,
      wanted: this._wanted,
    });
  }
  async activate() {
    this._wanted = true;
    if (this._pending) await this._pending;
    if (!this._wanted) return false;
    if (this._active) return true;
    this.baseline = this.latency();
    this._busy = true;
    this.update();
    this._pending = (async () => {
      try {
        const enabled = await this.onEnable();
        if (enabled === false) {
          this._wanted = false;
          return false;
        }
        this._active = true;
        this.startPolling();
        return true;
      } catch (error) {
        this._wanted = false;
        throw error;
      } finally {
        this._busy = false;
        this._pending = null;
        this.update();
      }
    })();
    return this._pending;
  }
  async deactivate(reason = "manual", details) {
    this._wanted = false;
    if (this._pending) {
      try {
        await this._pending;
      } catch {}
    }
    if (!this._active) {
      this.update();
      return false;
    }
    this.stopPolling();
    this._busy = true;
    this.update();
    this._pending = (async () => {
      try {
        await this.onDisable(reason, details);
        this._active = false;
        if (reason === "latency") await this.onAutoDisable(details);
        return true;
      } catch (error) {
        this._wanted = this._active;
        if (this._active) this.startPolling();
        throw error;
      } finally {
        this._busy = false;
        this._pending = null;
        this.update();
      }
    })();
    return this._pending;
  }
  toggle() {
    return this._active || this._wanted ? this.deactivate() : this.activate();
  }
  startPolling() {
    this.stopPolling();
    this.startedAt = this.now();
    this.rises = 0;
    this.timer = setInterval(() => this.checkLatency(), 500);
  }
  stopPolling() {
    clearInterval(this.timer);
    this.timer = null;
    this.rises = 0;
  }
  checkLatency() {
    if (!this._active || this._busy || this.now() - this.startedAt < 2000)
      return;
    const current = this.latency();
    if (current == null) {
      this.rises = 0;
      return;
    }
    if (this.baseline == null) {
      this.baseline = current;
      this.rises = 0;
      return;
    }
    const threshold = Math.max(0.005, this.baseline * 0.5);
    this.rises = current - this.baseline > threshold ? this.rises + 1 : 0;
    if (this.rises >= 3) {
      const details = {
        baseline: this.baseline,
        current,
        increase: current - this.baseline,
        threshold,
      };
      this.stopPolling();
      void this.deactivate("latency", details).catch(this.onError);
    }
  }
  dispose() {
    this.stopPolling();
    this.button.removeEventListener("click", this.onClick);
  }
}
