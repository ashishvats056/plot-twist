# Plot Twist

**Drop a plot twist into your video call.** A Chrome extension that adds effects to your Google Meet camera. Everyone in the call sees them; the controls are only visible to you.

| Trigger | Effect |
|---|---|
| Raise both hands, palms showing (automatic, can be switched off) | Black-and-white **ABSOLUTE CINEMA** |
| **🫰 Vanish** button | You turn to dust and vanish (Thanos snap) |
| **🫰 Return** button | You reassemble |
| **💸 Money rain** button | Money rains down |
| **🤦 Facepalm** button | Facepalm overlay |
| **🎬 Cinema** button | Absolute Cinema without raising your hands |

Click the button while you act out the gesture (snap, facepalm), and it looks like the gesture did it.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder (the one containing `manifest.json`).
4. Open (or reload) a Meet tab and join a call.

If **Load unpacked** is greyed out, your Chrome is managed by your organisation and blocks unpacked extensions. Use a personal Chrome profile.

## Using it

Click the **Plot Twist** icon in Chrome's toolbar while you're in a Meet call (pin it from the puzzle-piece menu). The popup has the effect buttons, the room photo, the auto-detect settings and a master **Effects** switch. It talks only to the active tab, so open it from the Meet tab.

- **Effects switch** (saved): when off, Meet gets your camera untouched, and no detector or mic tap is created. Switching it off during a call takes effect immediately (frames pass straight through). Switching it back on applies the next time your camera starts: turn the camera off and on in Meet (the popup tells you).

- **📷 Capture empty room** (recommended before you vanish): click it, step out of frame during the 5-second countdown (you can close the popup; the countdown keeps running in the Meet tab), and it takes one photo of the room without you. After the dust settles, a vanish then fades quickly (about 1 s) into this photo, so no outline or halo of you is left. **Return** fades back to live and re-forms you. The photo is kept in memory for this tab only: it's never saved to disk, and it's deleted when your camera stops, when you leave or reload, or when you click **✕**.
- **Without a room photo**, a vanish still erases only you and keeps the rest of the frame live. The space where you were is filled with the room as the camera has seen it. Lean left and right once so it can see behind you.
- **Auto-detect** checkboxes are saved with your Chrome profile (`chrome.storage.sync`), so you set them once.
- **Auto-detect snaps / facepalm** (off by default): turn these on to trigger the effects from gestures instead of buttons. Auto snap detection also opens a second, unprocessed stream of your mic to hear snap clicks; with it off, the extension doesn't touch your mic.
- **Auto-detect Cinema gesture** (on by default): both hands up, palms showing → Absolute Cinema. Untick it to use only the button.
- Effects are drawn on the video you send. Meet mirrors your self-view, so "CINEMA" looks backwards to you but reads correctly for everyone else.

### Adding an effect

Add an entry to `createActions` in `src/actions.js` (`id`, `icon`, `label`, `enabled`, `run`). The popup builds its buttons from that list, so a new effect appears there automatically. Draw it in `src/effects.js` (see `drawMoney` for an example).

### Keyboard shortcuts (backup and testing)

| Keys | Action |
|---|---|
| Alt+Shift+S | Vanish / Return |
| Alt+Shift+M | Money rain |
| Alt+Shift+C | Absolute Cinema |
| Alt+Shift+F | Facepalm |
| Alt+Shift+D | Debug overlay: hand points, face box, pinch ratio, last event |

### Your own facepalm image

Save an animated GIF as `assets/facepalm.gif`, or a still image as `assets/facepalm.png` (`.jpg` and `.webp` also work). Then click the reload icon on the extension in `chrome://extensions` and reload the Meet tab.

- An **animated GIF** plays once, full frame, as a reaction cut-away, then fades out. The effect lasts as long as the GIF (between 1.5 and 6 s). Frames are decoded once in the detector with Chrome's built-in `ImageDecoder` and scaled to at most 960 px; GIFs longer than 120 frames are cut.
- A **still image** is blended over you for 2.5 s.
- Without either, a 🤦 emoji placeholder is shown.

Only bundle an image you have the rights to. `assets/facepalm.gif` is git-ignored here because the local one is a film clip.

## How it works

```
camera ──► getUserMedia (hooked) ──► per-frame processor ──► effects canvas ──► track Meet sends
                                          │                         ▲
                                          ▼ small frame             │ gestures
                                 hidden extension iframe ──► MediaPipe hands + face
mic ───► click detector ─────────────────────────────────────────────┘
```

- `src/inject.js` runs in Meet's page before Meet loads. It replaces `navigator.mediaDevices.getUserMedia` so Meet receives a processed camera track (`MediaStreamTrackProcessor` → canvas → `MediaStreamTrackGenerator`). This keeps working when the Meet tab is in the background. When auto-detect snaps is on, it also opens a second, raw stream of the same mic to hear snap clicks: Chrome's default noise suppression strips most of a snap's click.
- `detector/` runs MediaPipe's hand landmarker, face detector and selfie segmenter inside an extension iframe. Meet's own security policy would block MediaPipe's wasm runtime if it ran in the page. The person mask is hard-edged and slightly enlarged, so none of you leaks into the saved room image.
- `src/actions.js` lists the effects the popup offers, which gestures may trigger them automatically, and the settings. `popup/` is the toolbar popup.
- `src/bridge.js` (isolated world) connects the popup and `chrome.storage` to `src/inject.js`. Chrome extension APIs aren't available in Meet's page world, so it relays over `src/channel.js`: DOM events on names that include a random per-page token, handed over before Meet's scripts run. Chrome injects a file into only one world, so the bridge loads copies of the shared modules from `src/isolated/` (regenerate them with `node dev/tools/build-isolated.js`; a test fails if they're stale).
- `src/gestures.js` turns landmarks and mic clicks into events (`snap`, `doubleSnap`, `cinema`, `facepalm`). It's pure logic and covered by unit tests.
- `src/background.js` builds the empty-room image. `src/vanish.js` erases the person and runs the dust, which affects only the person. `src/effects.js` draws the cinema, facepalm and money effects.

Nothing leaves your machine. All detection runs locally. The extension runs only on `meet.google.com` and asks for one permission, `storage`, to remember your settings.

## Develop

```bash
node dev/tools/build-isolated.js   # after editing src/actions.js or src/channel.js
node --test test/*.test.js
```

To try it without Meet, serve this folder and open the test page. It uses your webcam, or `?clip=<video url>` to use a video file as the camera:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000/dev/harness.html. It has plain buttons and checkboxes in place of the popup (`dev/harness-bridge.js`).

Tuning values (pinch thresholds, hold times, cooldowns, mic sensitivity) are at the top of `src/gestures.js`.

## Troubleshooting

In the Meet tab, open DevTools → Console and run `__plottwist.log`.
- No `detector ready` → the iframe didn't load. Check that the extension is enabled and reload the tab.
- `listening on processed mic` → Chrome refused the raw mic, so quieter snaps may be missed.
- `mic:off` in the debug overlay → the camera alone detects snaps. It works, but expect more misses and accidental triggers.
- Snaps get missed → in `src/gestures.js`, lower `minPeak` or `minHfRatio` in `createAudioTransientDetector`, raise `handRecentMs`, or lower `pressHoldMs`. Snaps fire by accident → do the opposite.
- `__plottwist.dump()` returns the last 60 s of pinch measurements and mic peaks; `__plottwist.exportRaw()` returns the raw hand landmarks, for replaying through `src/gestures.js` when tuning.

Bundled: MediaPipe Tasks Vision 0.10.35 (Apache-2.0, `vendor/`), and the hand landmarker, BlazeFace short-range and selfie segmenter models (`models/`).
