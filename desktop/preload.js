const { contextBridge, ipcRenderer } = require('electron');

const info = ipcRenderer.sendSync('info');

contextBridge.exposeInMainWorld('stockRogue', {
  ...info,
  achieve: (id) => ipcRenderer.send('achieve', id),
  quit: () => ipcRenderer.send('quit'),
  askMic: () => ipcRenderer.invoke('mic'),
});
