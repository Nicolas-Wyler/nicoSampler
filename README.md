# nicoSampler

A source-available sampler that runs in your browser. Audio processing uses a C++/WebAssembly engine and an AudioWorklet; the interface uses JavaScript and HTML/CSS. No Python, plugin, or compiler is needed to play it.

**Preview builds:** every published build has its own version and downloadable release. Desktop layout is the current focus. The repository contains the current Classic sampler only.

## Start

- **Hosted PWA:** open the [hosted sampler](https://nicolas-wyler.github.io/nicoSampler/). Let the first load finish online. You can then use it offline in that browser; installing it as a PWA is optional and browser dependent.
- **Portable download:** extract the complete macOS release ZIP, then double-click `Start.command`. A bundled server opens your default browser on localhost. No administrator installation or separate runtime is needed. Keep its terminal window open.
- **Developer preview:** install Node.js 22 or newer and run `npm run serve`, then open <http://127.0.0.1:8770/>.

An unpacked HTML file opened with `file://` is not a supported launch method. Portable binaries are unsigned; the OS may ask you to approve the download. Browser microphone, MIDI, and screen-sharing permission prompts remain under your control.

## First sound

Choose **Empty project**, then **Load → Example kit**. The original **Original Circuit** kit contains 16 drum and melodic voices. Click a row's play button or the onscreen piano. Enable/resume audio if prompted. You can also drop the downloadable example bank onto the landing screen.

The piano spans MIDI notes 0–127. The kit includes ten drums at notes 60–69 and bass, pluck, chord, sweep, pad, and bell sounds elsewhere. [Example key map and downloads](examples/README.md).

## What it does

- Multiple program tabs, sample rows, touch/desktop multi-selection, group dragging, copy/cut/paste, and row audition.
- Non-destructive trim, looping, pitch, envelopes, filtering, bitcrushing, pan, and two shared delay sends.
- Recording with meter-based threshold, 8–96 kHz formats, 8/12/16/24-bit PCM or 32-bit float, and a recoverable take library.
- Portable program/bank ZIPs containing raw WAVs, sample containers, and persistent sampler settings; rendered WAV/MP3 exports are separate.
- Local offline app assets, original procedural examples, and optional input monitoring with a browser-reported latency safeguard.

Core playback and file workflows are tested in Chromium, Firefox and WebKit. This is engine testing, not certification of every device. MIDI, shared-system-audio capture, PWA installation, permissions and available audio devices depend on the browser/OS. Missing capabilities do not prevent using the onscreen instrument and local files. iOS layout refinement and physical audio/MIDI certification remain future work.

## Your files

Projects and recorded takes recover in this browser's local storage. They are not automatically written to a Finder/Explorer folder or synced between browsers. **Save → Bank** downloads a portable archive, including saved takes; use **Use Recording** to add a take to the sample table, then **Save → Sample** or **Save → Resample** to export it. Browser recovery belongs to its origin, port and profile. Keep project ZIP backups.

## Documentation

- [User guide](docs/USER-GUIDE.md)
- [Files and saved settings](docs/FILE-FORMATS.md)
- [Portable launchers](docs/PORTABLE-LAUNCHER.md)
- [Developer guide](docs/DEVELOPMENT.md)
- [Compatibility and verification](docs/COMPATIBILITY.md)
- [Release notes](release-notes/0.2.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## License

Read the short [nicoSampler Source-Available License](LICENSE). Tinkering and free forks are allowed with retained notices. Commercial music and performances require neither permission nor attribution. Commercializing the software—including paid DAW integration—and monetized tutorials/reviews/demos primarily about the app require prior written permission. Third-party components keep their own licenses. This commercial restriction means the project is source available, not OSI-approved open source.

Commercial licensing requests can be made through this repository. No license applies to ownership of your own musical output.
