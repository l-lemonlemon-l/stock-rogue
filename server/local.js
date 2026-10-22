// In-browser game host: runs the real game rules inside the page for solo play,
// so the web and Android versions work offline with no server.
// LocalServer.connect() returns an object that behaves like a WebSocket.
const { createHub } = require('./rooms');

const hub = createHub({ devConfig: !!globalThis.SR_DEV });

function connect() {
  const sock = {
    readyState: 0, onopen: null, onmessage: null, onclose: null, onerror: null,
    // server -> page (async, like a real socket)
    send(str) { if (sock.readyState === 1) queueMicrotask(() => sock.onmessage?.({ data: str })); },
    close() { if (sock.readyState > 1) return; sock.readyState = 3; conn.onClose(); },
  };
  const conn = hub.connection({ send: (s) => sock.send(s), close: () => sock.close(), get readyState() { return sock.readyState; } });
  // page -> server
  const page = {
    get readyState() { return sock.readyState; },
    set onopen(f) { sock.onopen = f; }, set onmessage(f) { sock.onmessage = f; }, set onclose(f) { sock.onclose = f; }, set onerror(f) { sock.onerror = f; },
    get onopen() { return sock.onopen; }, get onmessage() { return sock.onmessage; }, get onclose() { return sock.onclose; }, get onerror() { return sock.onerror; },
    send(str) { if (sock.readyState === 1) setTimeout(() => conn.onMessage(String(str)), 0); },
    close() { const was = sock.readyState; sock.close(); if (was === 1) setTimeout(() => sock.onclose?.({}), 0); },
  };
  setTimeout(() => { sock.readyState = 1; sock.onopen?.({}); }, 0);
  return page;
}

globalThis.LocalServer = { connect };
module.exports = { connect };
