#!/bin/sh
# Maintainer build only. End users receive native binaries, never this toolchain.
set -eu
RELEASE_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
LAUNCHER_GO=${GO_BIN:-go}
if ! command -v "$LAUNCHER_GO" >/dev/null 2>&1; then
  echo "Go 1.27+ is required to rebuild. Set GO_BIN to a verified Go executable." >&2
  exit 1
fi
cd "$RELEASE_ROOT/tools/launcher"
GOTOOLCHAIN=local "$LAUNCHER_GO" test ./...
for LAUNCHER_TARGET in darwin/arm64 darwin/amd64; do
  LAUNCHER_OS=${LAUNCHER_TARGET%/*}
  LAUNCHER_ARCH=${LAUNCHER_TARGET#*/}
  LAUNCHER_OUT="$RELEASE_ROOT/portable/bin/$LAUNCHER_OS-$LAUNCHER_ARCH"
  mkdir -p "$LAUNCHER_OUT"
  LAUNCHER_EXT=
  if [ "$LAUNCHER_OS" = windows ]; then LAUNCHER_EXT=.exe; fi
  CGO_ENABLED=0 GOTOOLCHAIN=local GOOS="$LAUNCHER_OS" GOARCH="$LAUNCHER_ARCH" \
    "$LAUNCHER_GO" build -trimpath -buildvcs=false -ldflags='-s -w -buildid=' -o "$LAUNCHER_OUT/nicoSampler-server$LAUNCHER_EXT" .
done
cp Start.command Start.cmd "$RELEASE_ROOT/portable/"
chmod +x "$RELEASE_ROOT/portable/Start.command"
mkdir -p "$RELEASE_ROOT/portable/third-party/go"
LAUNCHER_GOROOT=$(GOTOOLCHAIN=local "$LAUNCHER_GO" env GOROOT)
cp "$LAUNCHER_GOROOT/LICENSE" "$RELEASE_ROOT/portable/third-party/go/LICENSE"
cp "$LAUNCHER_GOROOT/PATENTS" "$RELEASE_ROOT/portable/third-party/go/PATENTS"
for LAUNCHER_LICENSE in "$LAUNCHER_GOROOT"/src/vendor/golang.org/x/*/LICENSE; do
  [ -f "$LAUNCHER_LICENSE" ] || continue
  LAUNCHER_VENDOR=$(basename "$(dirname "$LAUNCHER_LICENSE")")
  cp "$LAUNCHER_LICENSE" "$RELEASE_ROOT/portable/third-party/go/golang.org-x-$LAUNCHER_VENDOR-LICENSE"
done
GOTOOLCHAIN=local "$LAUNCHER_GO" version > "$RELEASE_ROOT/portable/third-party/go/TOOLCHAIN.txt"
cp "$RELEASE_ROOT/tools/launcher/licenses/GO-NOTICE.txt" "$RELEASE_ROOT/portable/third-party/go/NOTICE.txt"
echo "Native portable servers built in $RELEASE_ROOT/portable/bin. Copy the static app to portable/app before packaging."
