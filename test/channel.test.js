const test = require('node:test');
const assert = require('node:assert/strict');
const { createChannel } = require('../src/channel.js');

const tick = () => new Promise((r) => setImmediate(r));

function pair() {
  const target = new EventTarget();
  const ch = createChannel(target);
  const toMain = [];
  const toBridge = [];
  return { target, ch, toMain, toBridge };
}

test('bridge and MAIN exchange messages after the handshake (MAIN first)', async () => {
  const { ch, toMain, toBridge } = pair();
  const main = ch.openMain((m) => toMain.push(m));
  main.post({ type: 'state', mode: 'visible' }); // queued until connected
  const bridge = ch.openBridge((m) => toBridge.push(m));
  bridge.post({ type: 'trigger', event: 'snap' });
  await tick();
  assert.equal(main.connected, true);
  assert.deepEqual(toBridge, [{ type: 'state', mode: 'visible' }]);
  assert.deepEqual(toMain, [{ type: 'trigger', event: 'snap' }]);
});

test('bridge first: it asks for the token and still connects', () => {
  const { ch, toMain, toBridge } = pair();
  const bridge = ch.openBridge((m) => toBridge.push(m));
  bridge.post({ type: 'settings', settings: {} });
  const main = ch.openMain((m) => toMain.push(m));
  main.post({ type: 'state' });
  assert.deepEqual(toMain, [{ type: 'settings', settings: {} }]);
  assert.deepEqual(toBridge, [{ type: 'state' }]);
});

test('a page script cannot hijack the channel with a later handshake or by guessing names', () => {
  const { target, ch, toMain, toBridge } = pair();
  const main = ch.openMain((m) => toMain.push(m));
  ch.openBridge((m) => toBridge.push(m));
  // An attacker offers its own token after the real one: ignored.
  const fake = '00000000-0000-4000-8000-000000000000';
  target.dispatchEvent(new CustomEvent('plottwist:handshake', { detail: fake }));
  target.dispatchEvent(new CustomEvent(`plottwist-${fake}-main`, { detail: JSON.stringify({ type: 'trigger' }) }));
  // Asking MAIN to re-announce its token after connecting does nothing.
  const leaked = [];
  target.addEventListener('plottwist:handshake', (e) => leaked.push(e.detail));
  target.dispatchEvent(new CustomEvent('plottwist:handshake-request'));
  main.post({ type: 'state' });
  assert.deepEqual(toMain, []);
  assert.deepEqual(leaked, []);
  assert.deepEqual(toBridge, [{ type: 'state' }]);
});

test('malformed payloads are dropped', () => {
  const target = new EventTarget();
  const ch = createChannel(target);
  const got = [];
  let token;
  target.addEventListener('plottwist:handshake', (e) => { token = e.detail; }, { once: true });
  ch.openMain((m) => got.push(m));
  ch.openBridge(() => {});
  const send = (detail) => target.dispatchEvent(new CustomEvent(`plottwist-${token}-main`, { detail }));
  send('not json');
  send(JSON.stringify(null));
  send(JSON.stringify({ no: 'type' }));
  send({ type: 'object, not string' });
  send(JSON.stringify({ type: 'ok' }));
  assert.deepEqual(got, [{ type: 'ok' }]);
});

test('the token is a fresh random UUID each time', () => {
  const seen = new Set();
  for (let i = 0; i < 3; i++) {
    const target = new EventTarget();
    target.addEventListener('plottwist:handshake', (e) => seen.add(e.detail), { once: true });
    createChannel(target).openMain(() => {});
  }
  assert.equal(seen.size, 3);
  for (const t of seen) assert.match(t, /^[0-9a-f-]{36}$/);
});
