// Builds the static web version (also used by the Android app) into www/.
// Usage: node tools/build-web.js [web|android|artifact] [online server URL]
// "artifact" makes a solo-only copy in www-artifact/ for hosting where the page cannot open network connections.
// Solo runs are hosted inside the page, so www/ works from any static host, offline, or inside the Android app.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const platform = process.argv[2] || 'web';
const OUT = path.join(ROOT, platform === 'artifact' ? 'www-artifact' : 'www');
const onlineServer = platform === 'artifact' ? '' : process.argv[3] || require('../desktop/config.json').onlineServer;

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'public'), OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, 'shared'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'shared', 'meta.js'), path.join(OUT, 'shared', 'meta.js'));

esbuild.buildSync({
  entryPoints: [path.join(ROOT, 'server', 'local.js')],
  bundle: true, format: 'iife', platform: 'browser', target: 'es2020', minify: true,
  outfile: path.join(OUT, 'localserver.js'),
});

fs.writeFileSync(path.join(OUT, 'config.js'),
  `window.SR_CONFIG = ${JSON.stringify({ platform, onlineServer })};\n`);

const htmlPath = path.join(OUT, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');
html = html.replace('<script src="shared/meta.js"></script>', '<script src="config.js"></script>\n<script src="localserver.js"></script>\n<script src="shared/meta.js"></script>');
if (platform === 'android') html = html.replace(/<meta name="viewport"[^>]*>/, '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">');
if (platform === 'artifact') {   // the host adds its own document skeleton
  html = html.replace(/<!doctype html>/i, '').replace(/<\/?(html|body)[^>]*>/gi, '').replace(/<\/?head>/gi, '')
    .replace(/<meta charset[^>]*>\s*/i, '').replace(/<meta name="viewport"[^>]*>\s*/i, '');
}
fs.writeFileSync(htmlPath, html);

const size = fs.readdirSync(OUT, { recursive: true }).reduce((n, f) => { const p = path.join(OUT, f); return n + (fs.statSync(p).isFile() ? fs.statSync(p).size : 0); }, 0);
console.log(`Built ${platform} version in ${path.basename(OUT)}/ (${Math.round(size / 1024)} KB), online server ${onlineServer}`);
