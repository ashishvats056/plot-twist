// Isolated-world helper: mounts the hidden detector iframe (an extension page)
// into Meet. The MAIN-world script asks for a (re)mount via a 'plottwist:mount' event.
(function () {
  'use strict';

  const ID = 'plottwist-detector';
  const SRC = chrome.runtime.getURL('detector/detector.html');

  function mount() {
    if (document.getElementById(ID)) return;
    const parent = document.body || document.documentElement;
    if (!parent) return;
    const frame = document.createElement('iframe');
    frame.id = ID;
    frame.src = SRC;
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    Object.assign(frame.style, {
      position: 'fixed', left: '-10px', bottom: '0', width: '1px', height: '1px',
      opacity: '0', border: '0', pointerEvents: 'none',
    });
    parent.appendChild(frame);
  }

  window.addEventListener('plottwist:mount', mount);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
