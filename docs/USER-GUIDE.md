# User guide

## Starting a workspace

A fresh session, a new program, and closing the last program show a landing screen. Its drop area also opens a multi-file picker when clicked. **Empty project** opens the main sampler with zero rows. The table's plus button adds a default row; new rows and newly loaded WAVs start at 50% level.

Dropped files follow a hierarchy. A bank takes precedence over separately dropped programs, sample containers and WAVs. Programs take precedence over loose sample containers/WAVs, and multiple programs may be imported together. With neither bank nor program present, all sample containers and WAVs create rows. The status explains ignored files. A bank/program's referenced WAVs still supply its audio; they are not added as duplicate rows.

The same hierarchy applies when dropping files into the main sampler. Samples append rows, programs add tabs, and a bank asks before replacing all open programs and local recordings. Cancel preserves the session. The Samples panel highlights while external files are dragged over the window. Example ZIPs can be dropped directly.

## Programs and rows

Use the program ribbon plus button for a new program. Drag a tab's left grip to reorder it. Its X closes it and asks about unsaved work. The asterisk means changes have not been exported. Browser autosave is separate from an exported project backup.

Sample normally takes the remaining panel width. Other columns fit their text with padding. Envelope/Trigger/Overlap/Level/Max vel use full headers when space permits and compact labels otherwise. Knob and checkbox widths stay fixed. Text-column dividers can be dragged; double-click resets automatic sizing. Rows never become narrower than the panel; wide content scrolls inside it. Mute/Solo, MIDI activity, the drag grip and playback stay at the left edge while scrolling. Level is the final column and stays at the right edge. The vertical scrollbar has its own reserved lane so it cannot cover Level.

Click a row to select it; Command-click (Ctrl-click on Windows) toggles rows, and Shift-click selects a range. A long press on desktop or touch enters selection mode with that one row selected. This initial single selection keeps the mode open so you can add more rows. Once you have selected multiple rows, reducing the group back to one exits selection mode automatically. Reducing it to zero also exits and leaves no row selected. Editing fades while grips and selected-row play remain usable. An outside click or Escape exits selection mode.

Drag a selected grip to move the selected group to the highlighted insertion line. The footer plus/minus controls remain at the left while scrolling. Minus first changes to red **Sure?**; the next click removes the selected rows. Clicking elsewhere or Escape cancels confirmation. Minus disappears when there are no rows.

A selected row's play button auditions the selected loaded group. It becomes Stop; pressing it again stops that group. Space does the same outside text/numeric entry and outside Trim's own audition workflow. Audition does not require a MIDI assignment. Duplicate supports multiple rows.

Command/Ctrl+C, X and V copy, cut and paste rows between program tabs. A cut removes originals only after a validated paste succeeds. If the original changed after cutting, it is kept and the earlier copy is pasted. Two windows in the same browser profile/origin can copy/paste through a sampler-local clipboard. Cross-window Cut intentionally pastes copies and keeps the originals.

## Playing and assigning notes

The onscreen piano always works independently of the selected PC/MIDI input. The computer keyboard supplies musical notes only when Input is PC Keyboard, except while editing a text/number field. None disables PC and external MIDI note input. Selecting an external MIDI input disables PC note input and routes notes from that device (or all devices when All MIDI inputs is selected). The channel selector supports All, None and individual channels. Available devices require browser permission and OS support.

Each MIDI note has a stable color. Assigned piano keys use that color, and the thin marker to the left of M/S shows every assigned note as a separate segment, from low at the top to high at the bottom. Shared notes share colors across rows and programs. Unassigned rows have a neutral marker; note labels remain available alongside the colors.

Click a Key cell to learn a note. Spread assigns a range: Pitch learns root, lower, upper; other spread controls learn lower then upper. The collapsed cell shows low:high and rRoot on two lines. The custom menu options stay single-line. The main **Load → Sample** workflow retains its key-learning behavior for batches; direct drops create immediate default/container rows.

Keyboard zoom is separate from browser-page zoom. The octave buttons move the PC keyboard range. The range fading, octave buttons and PC range label appear only for PC Keyboard input; other input modes show the piano without PC-range fading. Maximum keyboard magnification shows roughly one octave across the display; zooming out exposes the full MIDI range. Panic stops voices and ignores incoming MIDI for one second.

## Editing audio

Trim stores boundaries and playback parameters without destroying the original source. Its display can show mono, mixed stereo, or separate stereo waveforms; the split display is a view choice. Drag the large boundary/loop grips. Full cycles through full source, trim boundaries and loop boundaries. Pinch/scroll zoom has momentum.

The two stacked M/S buttons mute or solo a row. An active Mute silences that row; Solo limits playback to the soloed rows in the current program. Multiple rows can be soloed. Turning either mode off restores the original level. While one is active, the other button is disabled. These settings are saved with the sample and program. Mute/Solo changes also clear existing shared delay tails so muted audio stops immediately; this briefly resets the existing delay tails of other rows too. Their new audio continues normally.

Pitch offers semitone and fine controls, rotary knobs and octave buttons. Level, pan, envelopes and filter parameters remain reversible. The filter spectrum handle moves cutoff horizontally and resonance vertically; the endpoints disable the appropriate low/high-pass cutoff. Envelopes use enlarged touch grips. Sample audition remains available while editing; Trim keeps its own Space playback behavior.

Bitcrushing is non-destructive: its rate/bits are audible processing parameters, not the cache's stored precision. Saving a sample preserves raw WAV plus its reproducible container settings. Filter, envelopes and delays are applied during playback/rendering. FX opens shared analog-delay Time and Feedback controls with an effect-type selector.

## Input monitoring and recording

The top In meter defaults to gray with **Click to activate** over it. Click to connect the selected recording source/device. When active, hover or keyboard focus highlights it and shows **Deactivate?**; click to disconnect. Listening is not speaker monitoring: the input is not fed to your speakers. The Record dialog reuses an active connection, and closing it preserves explicit header monitoring.

If reported base/output latency rises beyond both 5 ms and 50% of its settled baseline for three consecutive 500 ms checks, monitoring stops and a notice explains why. Any active take is stopped and processed before disconnecting. The baseline settles for two seconds; unknown readings do not cause a guess. This is browser-reported latency, not a measured hardware round trip. Base latency has a persistent status label, showing unavailable when the browser has no reading.

Open Record from a selected row. Source and Device share a row; Channels, Sample rate and Bit depth share another. Their labels appear inside collapsed menus. Input connects automatically; source/device changes reconnect. Browser permission is still required. After a denied permission you can retry with Record or Arm.

**Record** starts immediately and becomes Stop. **Arm** becomes Listening… until the meter threshold is crossed, then Stop. Clicking Listening… cancels arming. Set threshold by tapping the segmented meter or dragging its physical fader cap; its transparent touch target is larger than the visible cap. The marker also supports arrow/Home/End keys.

The default recording format is 44.1 kHz/16-bit. Rates include 8, 11.025, 22.05, 32, 44.1, 48 and 96 kHz; depths include 8, 12, 16 and 24-bit PCM plus 32-bit float. A 12-bit WAV uses 12 valid PCM bits in 16-bit storage. Recorded takes retain their chosen WAV format even though playback uses the sampler's internal audio cache. Recordings have a three-minute limit; loaded samples have a ten-minute limit. Memory/voice limits are described in the developer guide.

Completed takes live in the browser-local Recorded takes library. Reopen Record to choose, preview, use/replace, export or discard an older take. Choosing no take hides its actions. Export WAV downloads a file; browser recovery does not silently write audio into an OS folder. Save Bank includes detached takes as well as program audio.

## Saving and rendering

Save/Load list Bank, Program and Sample in that order. Save Bank/Program produces one project ZIP with its root manifest and relative assets. Save Sample exports selected sample containers and raw WAVs, using a ZIP for multiple files. Load Sample accepts multiple WAVs and containers. A project ZIP must have the expected bank/program file at its root.

Bank and Program files include persistent recorder, MIDI, octave, master/FX, keyboard view, table/ribbon layout and Resample settings. Loading applies them. Live microphone/MIDI permissions, monitor-on state, playing/armed notes, open dialogs, drags, undo history and the temporary Trim viewport are not resumed. Per-sample waveform display and DSP settings are saved. Program files include that program's assets; detached recorded takes belong to a bank.

Save → Resample renders selected samples with processing applied, to WAV or MP3. It exports audio only, not containers. Multiple renders download as one ZIP. Matching source formats supply defaults; mixed formats offer per-source settings or a common chosen format. WAV supports the low rates and 12-bit precision. MP3 has its own supported rates/bitrates and does not represent a PCM bit-depth choice.

Use downloaded ZIP backups to move between browsers/computers. Browser-local recovery and the sampler clipboard are tied to origin, port and profile; private browsing or clearing browser data can remove them.
