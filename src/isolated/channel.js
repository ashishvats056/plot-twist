// GENERATED from src/channel.js by dev/tools/build-isolated.js. Do not edit.
// Private messaging between the isolated-world bridge (bridge.js) and the
// MAIN-world script (inject.js).
//
// Meet's own scripts share the MAIN world: they can listen to any DOM event
// whose name they know. So messages travel on event names that contain a
// random per-page token. The token is handed over at document_start, before
// any page script exists, and the DOM/JSON functions used here are captured at
// that moment, so patches the page makes later can't observe the traffic.
// Message payloads are JSON strings (only primitives cross worlds reliably).
(function (root) {
  'use strict';

  if (root.PlotTwistChannel) return;

  const HANDSHAKE = 'plottwist:handshake';
  const REQUEST = 'plottwist:handshake-request';
  const QUEUE_MAX = 50;
  const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  const proto = EventTarget.prototype;
  const dispatch = proto.dispatchEvent;
  const listen = proto.addEventListener;
  const unlisten = proto.removeEventListener;
  const Custom = CustomEvent;
  const detailOf = Object.getOwnPropertyDescriptor(CustomEvent.prototype, 'detail').get;
  const { parse, stringify } = JSON;
  const randomUUID = crypto.randomUUID.bind(crypto);

  const names = (token) => ({ toMain: `plottwist-${token}-main`, toBridge: `plottwist-${token}-bridge` });

  function createChannel(target = root) {
    const send = (type, detail) => dispatch.call(target, new Custom(type, { detail }));

    function wire(inName, outName, onMessage) {
      listen.call(target, inName, (e) => {
        const detail = detailOf.call(e);
        if (typeof detail !== 'string') return;
        let msg;
        try { msg = parse(detail); } catch { return; }
        if (msg && typeof msg === 'object' && typeof msg.type === 'string') onMessage(msg);
      });
      return (msg) => send(outName, stringify(msg));
    }

    // Buffers messages until the other side is connected.
    function outbox() {
      let post = null;
      let queue = [];
      return {
        connect(p) { post = p; queue.forEach(p); queue = []; },
        get connected() { return !!post; },
        post(msg) {
          if (post) post(msg);
          else if (queue.length < QUEUE_MAX) queue.push(msg);
        },
      };
    }

    // MAIN world: creates the token and offers it to the bridge.
    function openMain(onMessage) {
      const token = randomUUID();
      const { toMain, toBridge } = names(token);
      const out = outbox();
      const offer = () => send(HANDSHAKE, token);
      const post = wire(toMain, toBridge, (msg) => {
        if (msg.type !== 'connected') { onMessage(msg); return; }
        if (out.connected) return;
        unlisten.call(target, REQUEST, offer); // no more offers once the bridge has it
        out.connect(post);
      });
      listen.call(target, REQUEST, offer);
      offer();
      return { post: (m) => out.post(m), get connected() { return out.connected; } };
    }

    // Isolated world: accepts the first token offered (always ours: it arrives
    // before page scripts run), then ignores further offers.
    function openBridge(onMessage) {
      const out = outbox();
      const accept = (e) => {
        const token = detailOf.call(e);
        if (out.connected || typeof token !== 'string' || !TOKEN_RE.test(token)) return;
        unlisten.call(target, HANDSHAKE, accept);
        const { toMain, toBridge } = names(token);
        const post = wire(toBridge, toMain, onMessage);
        post({ type: 'connected' });
        out.connect(post);
      };
      listen.call(target, HANDSHAKE, accept);
      send(REQUEST, ''); // in case the MAIN script ran first
      return { post: (m) => out.post(m), get connected() { return out.connected; } };
    }

    return { openMain, openBridge };
  }

  const api = { createChannel, ...createChannel() };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PlotTwistChannel = api;
})(globalThis);
