#!/bin/sh
# Open the portable sampler with the macOS default browser; no interpreter runtime is required by the server.
set -eu
LAUNCHER_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
case "$(uname -m)" in
  arm64) LAUNCHER_ARCH=arm64 ;;
  x86_64) LAUNCHER_ARCH=amd64 ;;
  *) echo "This package supports Apple Silicon and Intel Macs."; exit 1 ;;
esac
LAUNCHER_SERVER="$LAUNCHER_DIR/bin/darwin-$LAUNCHER_ARCH/nicoSampler-server"
if [ ! -x "$LAUNCHER_SERVER" ]; then
  echo "Launcher binary is missing or not executable. Extract the complete portable ZIP first."
  exit 1
fi
exec "$LAUNCHER_SERVER" --app "$LAUNCHER_DIR/app"
