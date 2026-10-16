#!/bin/sh
set -eu
cd "$(dirname "$0")"
SDK="${WASI_SDK_PATH:-$HOME/.cache/nico-sampler-toolchain/wasi-sdk-33.0-arm64-macos}"
if [ ! -x "$SDK/bin/clang++" ]; then
  echo 'Set WASI_SDK_PATH to an extracted WASI SDK (build tools only; users do not need it).' >&2
  exit 1
fi
"$SDK/bin/clang++" dsp/engine.cpp -o src/engine.wasm -O3 -std=c++17 -fno-exceptions -fno-rtti -mexec-model=reactor -Wl,--export-all -Wl,--initial-memory=16777216 -Wl,--max-memory=536870912 -Wl,--strip-all
