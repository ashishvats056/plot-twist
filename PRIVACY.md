# Plot Twist privacy policy

_Last updated: 1 November 2026_

Plot Twist is a Chrome extension that adds visual effects to your camera in
Google Meet. It is built to work entirely on your device.

## What Plot Twist collects

Nothing. Plot Twist does not collect, sell or share personal data. It has no
servers, no analytics and no advertising. It makes no network requests, with
one exception that you start yourself: if you add your own facepalm from a
link, it downloads that one picture, once (see below).

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
  kept in Chrome's memory for that tab, so it lasts through turning your camera
  off and on and reloading the page. It is deleted when you close the tab, when
  you click ✕, or when you quit Chrome. It is never written to disk or sent anywhere.
- **Cartoon facepalm.** Shortly after your camera starts, Plot Twist looks at
  one camera frame on your device and notes a few things to draw a cartoon
  character that looks like you: your skin, hair and shirt colours, and whether
  you wear glasses or have a beard. Only those colours and yes/no traits are
  kept, never a picture. They are kept in memory for that camera session,
  deleted when your camera stops, and never written to disk or sent anywhere.
- **Your own facepalm** (only if you add one by hovering over Facepalm and
  clicking ✎). You can pick an emoji, a picture or GIF from your computer, or
  a link to one. A link is downloaded once, straight from that site, after
  Chrome asks you to allow access to that one site; the access is given back
  as soon as the download ends, and the link is not used again. Plot Twist
  sends nothing to that site beyond the request for the picture (no cookies).

## What it stores

- Your settings: the Effects switch and the three auto-detect checkboxes.
  They are saved with `chrome.storage.sync`, so Chrome may sync them across
  your signed-in browsers like any other extension setting.
- Your own facepalm, if you add one: the emoji or a copy of the picture. It is
  saved with `chrome.storage.local`, on this device only (never synced), until
  you click "Use the default" or remove the extension.

No video, audio, camera frames or gesture data is ever stored.

## Permissions

- **Runs on `https://meet.google.com/*` only**, to process your outgoing camera.
- **`storage`**, to remember your settings and your own facepalm.
- **Optional access to a website** (`https://*/*`, asked for one site at a
  time and only when you add a facepalm from a link), to download that picture.
  It is removed again right after the download.

## Contact

Questions: open an issue at https://github.com/ashishvats056/plot-twist/issues.
