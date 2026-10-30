# Third-party notices

Plot Twist bundles the following third-party software and models. Each is
licensed under the Apache License, Version 2.0; the full text is in
`LICENSE-APACHE-2.0.txt`. None of them was modified.

## MediaPipe Tasks Vision 0.10.35

- Files: `vendor/vision_bundle.mjs`, `vendor/wasm/vision_wasm_internal.{js,wasm}`,
  `vendor/wasm/vision_wasm_nosimd_internal.{js,wasm}`
- Source: npm package `@mediapipe/tasks-vision@0.10.35`,
  https://github.com/google-ai-edge/mediapipe
- Copyright The MediaPipe Authors. Licensed under the Apache License, Version 2.0.

## MediaPipe models

| File | Model | Model card |
|---|---|---|
| `models/hand_landmarker.task` | MediaPipe Hand Landmarker (float16) | https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20(Lite_Full)%20with%20Fairness%20Oct%202021.pdf |
| `models/blaze_face_short_range.tflite` | MediaPipe BlazeFace (short range) | https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20(Short%20Range).pdf |
| `models/selfie_segmenter.tflite` | MediaPipe Selfie Segmenter | https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Selfie%20Segmentation.pdf |

Copyright Google LLC. Licensed under the Apache License, Version 2.0.

The models are used as their cards intend (live AR effects and video
conferencing, on the device). Plot Twist does not use them for surveillance or
identity recognition, which the cards rule out.

SHA-256 of the bundled files:

```
fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1  models/hand_landmarker.task
b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f  models/blaze_face_short_range.tflite
191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b  models/selfie_segmenter.tflite
55d7ab624fbb70dcc5adc4ae6d7ea9cfcb569139d3dbfbf2b1deafcb966bc0fe  vendor/vision_bundle.mjs
6a5c64584c2ab61c763b6e204afbdbc7ce1caf7f5216187322bca8df94f646bc  vendor/wasm/vision_wasm_internal.wasm
8a3092d34c79d3f57e6ba8592105e8a90f6b07c27891ffecd14cca428bfd3e31  vendor/wasm/vision_wasm_nosimd_internal.wasm
```
