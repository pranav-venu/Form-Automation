const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  run: p => ipcRenderer.invoke('form:run', p),
  bounds: r => ipcRenderer.send('form:bounds', r),
  hide: () => ipcRenderer.send('form:hide'),
  authStart: () => ipcRenderer.invoke('auth:start'),
  authCancel: () => ipcRenderer.send('auth:cancel'),
  signOut: () => ipcRenderer.invoke('form:signout'),
  onSubmitted: cb => ipcRenderer.on('form:submitted', (_e, k) => cb(k)),
  onNeedView: cb => ipcRenderer.on('form:need-view', () => cb())
});
