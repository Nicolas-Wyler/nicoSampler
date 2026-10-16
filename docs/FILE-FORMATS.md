# File formats and persistence

## Project ZIP

A bank ZIP has `project.nicosbank` at its root. A program ZIP has `project.nicoprog` there. Exactly one recognized root manifest is required. JSON project metadata uses `type: sample_bank` or `sample_program`, version 3. Generated relative assets use the `relative-v1` layout and paths recorded in each sample. Names are sanitized, numbered and relative; traversal/absolute paths are rejected.

The archive contains raw WAV sources and individual sample containers. The importer validates manifest type/location, paths, sizes and referenced audio before committing the session. It rejects absent assets and unsupported manifests rather than treating arbitrary ZIPs as banks. Unpacked projects can be imported with their related folder/files through the relink workflow.

Banks preserve program order/current program and detached recorded takes. Programs preserve their own rows/selection and carry shared application preferences, but do not include unrelated programs or detached take-library recordings. Importing several programs uses the first file's shared settings and reports differences. Banks replace the current bank after confirmation; programs append.

## Sample container

`.nicosample` is a ZIP containing `sample.wav` and `settings.json`. Its `nico_sample` version 1 settings preserve reversible trim/loop, assignment/spread, playback/overlap, pitch, level, max velocity, pan, waveform display, envelopes, filter, bitcrusher and effect sends, plus relevant shared FX/master settings. The original source WAV is reused when available; processing is not destructively baked into it.

Sample-export ZIPs contain paired raw WAV/container assets. Landing/direct-drop import avoids duplicating a container's internal matching `.raw.wav` companion; separately supplied WAVs remain separate rows. All dropped audio is staged before modifying the session.

## Versioned preferences

A `preferences` object with version 1 normalizes and clones: MIDI source preference; recorder source/device/mode/threshold/rate/bits; octave; table widths/manual overrides/layout version; keyboard zoom/center; table and ribbon scroll ratios; and last Resample options. Master/FX and per-program MIDI channel remain canonical project fields. Older top-level preferences are accepted for backward compatibility.

View positions are normalized ratios rather than device pixels. Imported manual Sample widths may exceed 1000 px. Automatic Sample width follows the panel; other columns use intrinsic content and adaptive headers. The importer validates settings before assigning them, and prevents imported objects aliasing another program's live state.

Browser permissions, streams/handles, active monitor/capture/playback, sustain, open dialogs, drags/touch selection, clipboard, undo and per-editor temporary Trim viewport are runtime state. They are intentionally not resumed from saved files. Preferred IDs are retained even when hardware is absent; users choose available hardware before activating it.

## WAV and resampling

The WAV decoder supports PCM and IEEE float, RIFF chunks, alignment validation and WAVEFORMATEXTENSIBLE precision. The 12-bit writer uses a 16-bit PCM container, 12 valid bits and zeroed four low bits. See Microsoft's [WAVEFORMATEXTENSIBLE specification](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ksmedia/ns-ksmedia-waveformatextensible). Source-based render defaults use valid precision, not just container width.

Recording/export precision is independent of audible bitcrusher settings. Raw source WAV bytes remain attached to loaded/recorded rows; the playback cache is stereo 44.1 kHz Float32 data. Rendered exports apply sampler parameters; normal sample/project saves preserve source and settings. MP3 is encoded locally using the separately licensed bundled LAME JavaScript module.

## Browser storage

IndexedDB stores local session recovery and a separate same-origin sample clipboard. These databases are not a cross-browser/cloud sync service. The service worker caches application assets only; user recordings are not uploaded to a server. The portable HTTP server exposes static application files and a protected stop endpoint, not a user-audio upload endpoint.
