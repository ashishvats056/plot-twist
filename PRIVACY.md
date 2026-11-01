# Plot Twist privacy policy

_Last updated: 1 November 2026_

Plot Twist is a Chrome extension that adds visual effects to your camera in
Google Meet. It is built to work entirely on your device.

## What Plot Twist collects

Nothing. Plot Twist does not collect, store, sell or share personal data. It has
no servers, no analytics and no advertising, and it makes no network requests.
Its extension pages are locked to `connect-src 'self'`.

## What it processes, and where

All processing happens in memory, in your browser, on your device.

- **Camera video** (only on `meet.google.com`, only while your camera is on and
  the Effects switch is on). Each frame is analysed to find your hands, face and
  outline, and the effects are drawn on it. The only place your video goes is
  the call itself, as the video Google Meet already sends. If you turn Effects
  off, Meet gets your camera unchanged.
- **Microphone audio** (only when you tick "Auto-detect snaps"). Plot Twist opens
  a second copy of your microphone, listens for the click of a finger snap, and
  throws each audio block away right after analysing it. With the box unticked,
  Plot Twist doesn't touch your microphone.
- **Empty background photo** (only if you click "Capture empty background"). One frame is
  kept in memory for that tab. It is deleted when your camera stops, when you
  reload or leave the page, or when you click ✕. It is never written to disk.
- **Cartoon facepalm.** Shortly after your camera starts, Plot Twist crops your
  face from one camera frame and turns it into a cartoon on your device. It is
  only shown in your video when you trigger the facepalm. It is kept in memory
  for that camera session, deleted when your camera stops, and never written to
  disk or sent anywhere.

## What it stores

Only your settings: the Effects switch and the three auto-detect checkboxes.
They are saved with `chrome.storage.sync`, so Chrome may sync them across your
signed-in browsers like any other extension setting. No video, audio, images or
gesture data is ever stored.

## Permissions

- **Runs on `https://meet.google.com/*` only**, to process your outgoing camera.
- **`storage`**, to remember your settings.

## Contact

Questions: open an issue at https://github.com/ashishvats056/plot-twist/issues.
