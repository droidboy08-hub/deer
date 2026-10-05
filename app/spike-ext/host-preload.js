const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('crx', {
  getState: (p) => ipcRenderer.invoke('crx-msg-remote', p, 'browserAction.getState'),
  activate: (p, d) => ipcRenderer.invoke('crx-msg-remote', p, 'browserAction.activate', d),
});
