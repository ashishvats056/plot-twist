# Chrome Web Store listing (draft)

## Name
Plot Twist

## Summary (max 132 characters)
Effects for your Google Meet camera: dissolve into dust and vanish, money rain, Absolute Cinema and a facepalm, all on your device.

## Category
Fun (or Productivity → Communication)

## Single purpose
Plot Twist adds visual effects to the camera video you send in Google Meet calls.

## Description
Drop a plot twist into your next Google Meet call.

The effects:
• Vanish: you dissolve into dust and disappear, while your background stays live. Snap again (or click Return) to re-form.
• Money rain: banknotes fall across your video.
• Absolute Cinema: your video turns black-and-white with a dramatic title.
• Facepalm: a cute animated cartoon of you facepalming, made on your device. Or add your own: any emoji, picture, GIF or picture link (hover over Facepalm and click ✎).

Everyone in the call sees the effects. Only you see the controls.

Three ways to set them off:
• With a gesture: snap your fingers to vanish (and snap again to return), snap twice quickly for money rain, raise both hands for Absolute Cinema, or put your hand on your face to facepalm. Turn each one on in the popup. Snap detection listens to your microphone for the click.
• With a button: click the Plot Twist icon in the toolbar and pick an effect. Nothing to detect, so it always works.
• With the keyboard, in the Meet tab: Alt+Shift (Option+Shift on a Mac) plus S (vanish/return), M (money rain), C (cinema) or F (facepalm).

Make it your own: the buttons mean you can pair any effect with any move you like. Wave goodbye and vanish as you leave the call. Throw your hands up and make it rain when the deal closes. Lean back, slow-clap or drop a mic, then hit Cinema. Click right as you do it, and the call sees a perfectly timed plot twist.

Tip: capture a photo of your empty background first. Step out of frame during the 5-second countdown, and your vanish will then fade cleanly into that photo. It is kept for the whole call, until you close the tab.

Private by design
• Everything runs on your device. No servers, no analytics, no network requests (except downloading a facepalm picture from a link, once, if you add one).
• Your video goes only where Meet already sends it.
• The microphone is used only if you turn on snap detection.
• Only your settings and your own facepalm (on this device only) are saved. The cartoon only keeps a few colours and traits (glasses, beard) in memory, never a picture, and forgets them when your camera stops.
• The master Effects switch passes your camera through untouched.

Works on meet.google.com. Requires a recent version of Chrome.

## Permission justifications
- Host access `https://meet.google.com/*`: Plot Twist has to process the camera video on Google Meet pages to draw the effects. It runs on no other site.
- `storage`: saves the Effects switch, the auto-detect checkboxes, and your own facepalm emoji or picture (local only). It also keeps the empty background photo for its tab in Chrome's memory (`chrome.storage.session`, never on disk) until the tab is closed or the user clicks ✕.
- Optional host access `https://*/*`: asked for one site at a time, only when the user adds a facepalm picture from a link; used for that one download and removed straight after.
- Remote code: none. All code, including the MediaPipe wasm runtime, is bundled.

## Data usage disclosures (Privacy practices tab)
- Collects no user data in any category.
- Certify: data is not sold, not used for purposes unrelated to the single purpose, and not used for creditworthiness or lending.
- Privacy policy URL: host PRIVACY.md (e.g. GitHub Pages or the repo's PRIVACY.md).

## Screenshots (1280×800, final, in `dist/store-assets/`)
1. Popup open beside a Meet call (light mode).
2. Vanish mid-dust, seen from another participant.
3. Absolute Cinema frame.
4. Money rain frame.
5. Cartoon facepalm.

## Demo video
`dist/store-assets/plot-twist-demo.mp4` (39.7 s, 1080p, no sound). The store only takes a YouTube link: upload it to YouTube as Unlisted, then paste the link in the Store listing tab.

## Promo images
- Small promo tile (440×280): `python3 dev/tools/make_promo.py` writes `dist/store-assets/promo-small-440x280.png`.

## Notes before submitting
- Don't name the dust effect after any film or comic character in the listing, the screenshots or the promo images.
- Ship a facepalm image you have the rights to, or none (the default: the cartoon of the user's face, or the 🤦 emoji). The local `assets/facepalm.gif` is a film clip and is excluded from the store zip.
