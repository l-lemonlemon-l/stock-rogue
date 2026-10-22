// Desktop shell for Steam (Windows + Mac).
// Runs the game server inside the app for solo/LAN play, and lets players
// connect to the online server for internet multiplayer.
const { app, BrowserWindow, ipcMain, Menu, session, systemPreferences } = require('electron');
const os = require('os');
const path = require('path');
const config = require('./config.json');
const { startServer } = require('../server');

// ---------- Steam ----------
let steam = null;
let steamworks = null;
try {
  steamworks = require('steamworks.js');
  // In release builds, relaunch through Steam if the exe was started directly.
  if (app.isPackaged && config.requireSteam && steamworks.restartAppIfNecessary(config.steamAppId)) {
    app.exit(0);
  }
  steamworks.electronEnableSteamOverlay(); // must run before app is ready
} catch (e) {
  console.warn('steamworks.js not available:', e.message);
}

function initSteam() {
  if (!steamworks) return;
  try {
    steam = steamworks.init(config.steamAppId);
    console.log('Steam ready as', steam.localplayer.getName());
  } catch (e) {
    // Not launched through Steam (or Steam closed). Game still runs, without achievements.
    console.warn('Steam init failed:', e.message);
  }
}

ipcMain.on('achieve', (_e, id) => {
  try { if (steam && !steam.achievement.isActivated(id)) steam.achievement.activate(id); } catch {}
});
ipcMain.on('quit', () => app.quit());
// Voice chat: ask macOS for microphone access (shows the system prompt the first time).
ipcMain.handle('mic', async () => {
  if (process.platform !== 'darwin') return true;
  if (systemPreferences.getMediaAccessStatus('microphone') === 'granted') return true;
  return systemPreferences.askForMediaAccess('microphone');
});
ipcMain.on('info', (e) => {
  e.returnValue = {
    onlineServer: config.onlineServer,
    localPort,
    steamName: steam ? steam.localplayer.getName() : '',
    lanAddresses: config.allowLan ? lanAddresses() : [],
    iceServers: config.iceServers || [],
  };
});

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
}

// ---------- window ----------
let localPort = 0;

async function startLocalServer() {
  const host = config.allowLan ? '0.0.0.0' : '127.0.0.1';
  try {
    ({ port: localPort } = await startServer({ port: config.localPort, host }));
  } catch {
    ({ port: localPort } = await startServer({ port: 0, host })); // preferred port busy
  }
}

async function createWindow() {
  initSteam();
  // The game page may use the microphone (voice chat) and clipboard (save codes); nothing else.
  const allowed = new Set(['media', 'clipboard-sanitized-write', 'clipboard-read']);
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(allowed.has(perm)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => allowed.has(perm));
  await startLocalServer();

  const win = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#ffffff',
    title: 'Stock Rogue',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  win.loadURL(`http://localhost:${localPort}/`);
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen());
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit()); // Steam expects the game process to exit on close, Mac included
