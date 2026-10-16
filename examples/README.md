# Original Circuit example bank

An original 16-voice kit generated entirely by the sampler's deterministic synthesis code. No external recordings, downloaded sample packs, or user audio are included. The bundled example sounds may be used in commercial music and performances under the project LICENSE. Software distribution and paid derivative products have separate terms; consult the release LICENSE.

## Downloads

- [Bank: Drums + Melodic](Original-Circuit-Bank.zip) — two program tabs, 16 voices total.
- [Drums program](Original-Circuit-Drums.zip) — 10 drum voices.
- [Melodic program](Original-Circuit-Melodic.zip) — six pitched/textural voices.
- [Full Kit program](Original-Circuit-Full-Kit.zip) — all 16 voices in one tab, matching Load → Example kit.

Drag a ZIP onto the landing screen or sample table, or use Load → Bank/Program. A bank replaces the open bank after confirmation; programs append tabs. Each archive contains its root project manifest, original raw WAVs, and non-destructive .nicosample containers in project-relative folders. Do not move individual assets out of their folders.

## Playing

At the default PC-keyboard octave, A/W/S/E/D/F/T/G/Z/H trigger kick/rim/snare/clap/closed hat/open hat/low tom/high tom/shaker/metal. U triggers the fifth chord, J the sweep, and K/O/L the looping pad. The open hat uses key-mono retrigger; it is not a closed/open mutual-choke group.

Click ← Octave twice for the C2 bass range; once for the C3 pluck. Click → Octave twice for the C6 bell. The on-screen keyboard and MIDI can reach every range directly. Hold pad notes for looping sustain, then release for a soft tail. Velocity remains expressive (Max is off). Every row starts at 50% level. Stereo voices, pan, envelopes, filters, and restrained delay sends demonstrate reusable non-destructive settings.

In the two-program bank, switch between Drums and Melodic to play each section; the Full Kit program combines their mappings in one tab. Load → Example kit adds the full kit to the current program. Existing program audio/settings are retained; an otherwise empty session also receives the kit's shared delay settings.

| Voice | Trigger range | Root | Playback | Sound |
| --- | --- | --- | --- | --- |
| Punch Kick | C4 | — | poly | Pitch-diving sine body with a soft transient |
| Maple Rim | C♯4 | — | poly | Short woody inharmonic rim |
| Velvet Snare | D4 | — | poly | Tuned body with filtered noise wires |
| Room Clap | D♯4 | — | poly | Four staggered noise bursts and stereo room tail |
| Closed Hat | E4 | — | poly | High-pass noise and six metallic oscillators |
| Open Hat | F4 | — | poly (key mono) | Long metallic hat; Key Mono retrigger |
| Low Tom | F♯4 | — | poly | Low resonant tom with pitch fall |
| High Tom | G4 | — | poly | Higher resonant tom with pitch fall |
| Seed Shaker | G♯4 | — | poly | Double noise gesture with a stereo offset |
| Alloy Perc | A4 | — | poly | Bell-like inharmonic metal percussion |
| Warm Bass | C2:B2 | C2 | hold mono | C2 triangle/sine bass, pitch spread C2:B2 |
| Glass Pluck | C3:B3 | C3 | poly | C3 harmonic pluck, pitch spread C3:B3 |
| Fifth Stab | A♯4 | — | poly | Stereo C4/G4 chord, single-key trigger A#4 |
| Echo Sweep | B4 | — | poly | Stereo rising noise and chirped partials |
| Air Pad | C5:B5 | C5 | loop poly | Periodic stereo C5 pad, pitch spread C5:B5; loops while held |
| Prism Bell | C6:B6 | C6 | poly | Stereo C6 FM bell, pitch spread C6:B6 |

## Rebuild and inspect

Run `node scripts/build-examples.mjs` from the sampler folder. Source: [example-kit.js](../src/example-kit.js). Audio rate: 44,100 Hz; 16 stereo voices; 4851000 bytes of decoded PCM (under 15 MB). Archive assets use raw 32-bit floating-point WAV, preserving the generated source before sampler processing. [manifest.json](manifest.json) lists frame counts, mappings, archive entries, sizes and SHA-256 hashes. Rebuilding with the same source produces identical archive bytes.
