# Portable desktop launchers

The portable package contains the current browser sampler in `app/` and small native local servers. It does not include the Python sampler, sequencer, synthesizer, Go compiler, Node.js, or Python. End users need their existing browser and their operating system's ordinary Terminal or Command Prompt.

Extract the complete ZIP into one folder before opening it. On macOS, double-click **Start.command**. On 64-bit Windows, double-click **Start.cmd**. The wrapper selects the included Apple Silicon / Intel Mac or ARM64 / x64 Windows executable, starts a server bound exclusively to `127.0.0.1`, and opens the operating system's default browser. No administrator access, software installation, or remote server is required.

Keep the launcher window open. Save your projects before quitting. Press **Ctrl+C** in that window to stop, or open the printed **Launcher controls** URL and choose **Stop local server**. Closing a browser tab alone does not stop the local server. A previously cached sampler tab may keep running after the server stops; save and close that tab when finished. The token in the controls URL authorizes stopping only this launcher instance.

The default address uses port **17870**. A second launch detects an existing server for this same app folder on the preferred local port range and reuses its address, preserving the browser recovery origin. If the preferred port is occupied by an unrelated service, the launcher tries the next available port and prints a warning. Browser recovery, permissions, and offline caches are scoped to the address and port; returning to the original port returns to that origin's browser storage. Saved ZIP projects remain portable between origins and machines. The launcher never reads the operating system clipboard or exposes a filesystem write endpoint.

These binaries are unsigned and not notarized. macOS or Windows may display an unsigned-download security prompt. The package does not disable Gatekeeper, quarantine, SmartScreen, antivirus, PowerShell execution policy, or other protections. A downloaded unsigned launcher cannot promise a completely prompt-free first launch.

## Package layout

```text
portable/
  Start.command
  Start.cmd
  app/                         complete static sampler, including engine.wasm
  bin/
    darwin-arm64/nicoSampler-server
    darwin-amd64/nicoSampler-server
    windows-amd64/nicoSampler-server.exe
    windows-arm64/nicoSampler-server.exe
  third-party/go/              licenses for the compiled Go runtime/stdlib
```

The project release packager supplies `app/`; the launcher build does not copy or change either older sampler stack. Packaging on macOS must preserve the executable bit on Start.command and both macOS binaries. Architecture-specific packages may omit the other platforms' binaries and unused wrapper, while preserving the matching `bin/<platform>-<architecture>/` path.

## Rebuilding (maintainers only)

Use an official Go **1.27 or newer** toolchain. Check its archive against the SHA-256 value published by the [official Go downloads service](https://go.dev/dl/?mode=json) before extracting it. This build used Go 1.27.2; the local verification record is not part of the end-user runtime. No third-party Go modules are required.

On macOS or Linux:

```sh
GO_BIN=/path/to/verified/go/bin/go ./scripts/build-launchers.sh
```

On a Windows development machine with Go available, run `scripts/build-launchers.ps1` using your normal permitted development environment. The script does not change execution policy. `GO_BIN` can name a verified Go executable instead of one on PATH.

Both scripts run the server's Go tests and cross-compile the four native targets with `CGO_ENABLED=0`, `-trimpath`, and `-buildvcs=false`. Go's source and rebuild scripts remain in `tools/launcher/`. The Go toolchain itself is not shipped. The generated binaries include Go runtime/standard-library code; keep `portable/third-party/go/` and the project's third-party notices in distributed archives.

The server supports `--app /path/to/app`, `--port 17870`, and `--no-open`. A port of `0` requests a free local port for testing. The printed browser URL always points to `127.0.0.1`. HTTP requests are read-only except the token- and same-origin-protected shutdown endpoint. Paths outside `app/`, including symlinks escaping the root, are rejected; directories are not listed; WebAssembly is served as `application/wasm`; and `sw.js` receives the correct service-worker scope header.

## Verification and practical limits

Go tests cover static HTTP, WASM/JavaScript MIME types, service-worker scope, HEAD requests, traversal and symlink escapes, host/origin/remote-address rejection, shutdown tokens, loopback binding, port collisions, and default-browser command construction. macOS ARM64 runs a real native-server integration test locally. Windows and Intel Mac artifacts are cross-compiled and inspected for their target architecture; their UI launch behavior still needs testing on those actual systems before claiming full platform validation.
