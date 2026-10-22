// HTTP (serves the client) + WebSocket (game traffic) on one port.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { createHub } = require('./rooms');

const PUBLIC = path.join(__dirname, '..', 'public');
const SHARED = path.join(__dirname, '..', 'shared');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.txt': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png' };


function startServer({ port = 8080, host = '0.0.0.0' } = {}) {
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const root = url.startsWith('/shared/') ? SHARED : PUBLIC;
  const rel = url.startsWith('/shared/') ? url.slice('/shared'.length) : url;
  const file = path.join(root, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

const hub = createHub({ devConfig: !!process.env.DEV });
wss.on('connection', (ws) => {
  const c = hub.connection(ws);
  ws.on('message', (raw) => c.onMessage(String(raw)));
  ws.on('close', c.onClose);
});

return new Promise((resolve) => server.listen(port, host, () => resolve({ server, port: server.address().port })));
}

module.exports = { startServer };

if (require.main === module) {
  startServer({ port: Number(process.env.PORT) || 8080 }).then(({ port }) =>
    console.log(`Stock Rogue running on http://localhost:${port}`));
}
