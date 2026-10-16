# Third-party notices

The browser application uses no CDN assets or remote runtime dependencies. MP3 export includes a locally bundled LAME JavaScript encoder, as detailed below. Its C++/WebAssembly engine is compiled with the official WASI SDK 33. The compiled module may contain portions of wasi-libc (including musl math routines and dlmalloc) and LLVM compiler support. Applicable upstream notices and license texts are retained in `licenses/`.

- WASI SDK: https://github.com/WebAssembly/wasi-sdk/releases/tag/wasi-sdk-33
- wasi-libc: https://github.com/WebAssembly/wasi-libc
- musl: https://musl.libc.org/
- LLVM: https://llvm.org/

Build and test tools (WASI SDK, Node, Playwright, Prettier and clang-format) are developer tools and are not shipped as user runtime dependencies. WebKit/Chrome browser engines are not included in the app distribution. The original Python sampler is the local source for the musical behavior and DSP equations ported here.

## LAME JavaScript MP3 encoder

MP3 export uses lamejs 1.2.1, a JavaScript port of LAME, by Alex Zhukov and upstream contributors. Upstream: https://github.com/zhuker/lamejs; LAME: https://lame.sourceforge.net/. The package declares LGPL-3.0. Full license texts, original notices, corresponding JavaScript sources and the unminified browser bundle are supplied in `src/vendor/lamejs/`. The only bundle packaging change appends an ES-module export; replacement instructions are in `README.local.md` there. This encoder is separately imported and runs entirely offline in the browser.

## Portable localhost server

The native portable server is built from this repository's `tools/launcher` using Go. Compiled Go runtime/standard-library and bundled support code retain the BSD-style Go license, PATENTS and applicable third-party notices supplied in `portable/third-party/go/`. The compiler is a developer tool and is not included as a runtime. The sampler's custom license does not replace these third-party licenses.
