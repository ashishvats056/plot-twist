// The facepalm editor: pick your own emoji, picture/GIF or picture link. It is
// saved in chrome.storage.local (this device only); the Meet tab's detector
// picks the change up straight away. Opened in its own small window, because
// the toolbar popup closes when a file picker or permission prompt opens.
(function () {
  'use strict';

  const A = globalThis.PlotTwistActions;
  const KEY = A.CUSTOM_FACEPALM_KEY;
  const MAX = A.MAX_FACEPALM_BYTES;
  const EMOJIS = ['🤦', '🤦‍♂️', '🤦‍♀️', '🙈', '😩', '🫠', '😑', '🙄', '😬'];
  const TYPES = ['image/gif', 'image/png', 'image/jpeg', 'image/webp'];
  const $ = (id) => document.getElementById(id);

  let current = null;

  function say(text, tone = '') {
    $('msg').textContent = text;
    $('msg').dataset.tone = tone;
  }

  function render() {
    const p = $('preview');
    p.textContent = '';
    if (current && current.kind === 'image') {
      p.append(Object.assign(document.createElement('img'), { src: current.dataUrl, alt: 'Your facepalm picture' }));
      $('current-label').textContent = 'Your picture';
      $('current-hint').textContent = 'A GIF plays once, full frame; a still picture is blended over you.';
    } else if (current && current.kind === 'emoji') {
      p.textContent = current.emoji;
      $('current-label').textContent = 'Your emoji';
      $('current-hint').textContent = 'Shown big over your video.';
    } else {
      p.textContent = '🤦';
      $('current-label').textContent = 'Default';
      $('current-hint').textContent = 'A cartoon of your face, made on your device (the 🤦 emoji until it is ready).';
    }
    $('reset').hidden = !current;
    for (const b of $('emoji-row').children) {
      b.setAttribute('aria-pressed', String(!!current && current.kind === 'emoji' && current.emoji === b.textContent));
    }
  }

  async function save(value) {
    const clean = A.sanitizeCustomFacepalm(value);
    if (!clean) throw new Error('That can’t be used as a facepalm.');
    await chrome.storage.local.set({ [KEY]: clean });
    current = clean;
    render();
  }

  // The real type from the first bytes: the file name or a server's header can lie.
  function sniff(bytes) {
    const b = (i) => bytes[i];
    if (b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46) return 'image/gif';
    if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return 'image/png';
    if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'image/jpeg';
    if (b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46
      && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) return 'image/webp';
    return null;
  }

  // Bytes → a checked data: URL (a picture this browser can decode).
  async function toDataUrl(blob) {
    if (blob.size > MAX) throw new Error('That picture is over 4 MB. Try a smaller one.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const type = sniff(bytes);
    if (!TYPES.includes(type)) throw new Error('That isn’t a GIF, PNG, JPEG or WebP picture.');
    const typed = new Blob([bytes], { type });
    const bmp = await createImageBitmap(typed).catch(() => null);
    if (!bmp) throw new Error('That picture couldn’t be opened.');
    bmp.close();
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('That picture couldn’t be read.'));
      r.readAsDataURL(typed);
    });
  }

  async function useFile(file) {
    if (!file) return;
    say('Adding…');
    try {
      await save({ kind: 'image', dataUrl: await toDataUrl(file) });
      say('Done. Your facepalm is ready, also in a call that is already running.', 'ok');
    } catch (e) {
      say(e.message, 'error');
    }
  }

  // Asks for access to that one site only, downloads the picture once, keeps a
  // copy and gives the access back: nothing is fetched again during calls.
  async function useLink(raw) {
    let url;
    try { url = new URL(raw.trim()); } catch { say('That doesn’t look like a link.', 'error'); return; }
    if (url.protocol !== 'https:') { say('Use an https:// link.', 'error'); return; }
    const origins = [`${url.origin}/*`];
    // Must be the first await: Chrome only shows the prompt during the click.
    const granted = await chrome.permissions.request({ origins }).catch(() => false);
    if (!granted) { say('Chrome didn’t allow access to that site, so the picture wasn’t downloaded.', 'error'); return; }
    say('Downloading…');
    try {
      const res = await fetch(url.href, { credentials: 'omit', redirect: 'follow', cache: 'no-store' });
      if (!res.ok) throw new Error(`The site answered ${res.status}. Check the link opens a picture.`);
      const size = Number(res.headers.get('content-length'));
      if (size > MAX) throw new Error('That picture is over 4 MB. Try a smaller one.');
      await save({ kind: 'image', dataUrl: await toDataUrl(await res.blob()) });
      $('link').value = '';
      say('Done. The picture is saved on this device; the link isn’t used again.', 'ok');
    } catch (e) {
      say(e instanceof TypeError ? 'Couldn’t download that. Check it’s a direct link to a picture.' : e.message, 'error');
    } finally {
      chrome.permissions.remove({ origins }).catch(() => {});
    }
  }

  for (const e of EMOJIS) {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: e, title: `Use ${e}` });
    b.addEventListener('click', () => save({ kind: 'emoji', emoji: e }).then(() => say(`Done. Your facepalm is ${e}`, 'ok')));
    $('emoji-row').append(b);
  }
  $('emoji-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const emoji = A.sanitizeEmoji($('emoji').value);
    if (!emoji) { say('Type or paste an emoji first.', 'error'); return; }
    save({ kind: 'emoji', emoji }).then(() => { $('emoji').value = ''; say(`Done. Your facepalm is ${emoji}`, 'ok'); },
      (e) => say(e.message, 'error'));
  });
  $('file').addEventListener('change', (ev) => { useFile(ev.target.files[0]); ev.target.value = ''; });
  const drop = $('drop');
  drop.addEventListener('dragover', (ev) => { ev.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (ev) => {
    ev.preventDefault();
    drop.classList.remove('over');
    useFile(ev.dataTransfer.files[0]);
  });
  $('link-form').addEventListener('submit', (ev) => { ev.preventDefault(); useLink($('link').value); });
  $('reset').addEventListener('click', async () => {
    await chrome.storage.local.remove(KEY);
    current = null;
    render();
    say('Back to the default facepalm.', 'ok');
  });

  chrome.storage.local.get(KEY).then((v) => { current = A.sanitizeCustomFacepalm(v[KEY]); render(); });
  render();
})();
