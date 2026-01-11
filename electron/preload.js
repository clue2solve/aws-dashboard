const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  onShowShortcuts: (callback) => ipcRenderer.on('show-shortcuts', callback),
  platform: process.platform,
  isElectron: true,
})
