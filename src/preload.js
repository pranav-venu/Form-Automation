const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  run: p => ipcRenderer.invoke('form:run', p),
  bounds: r => ipcRenderer.send('form:bounds', r),
  hide: () => ipcRenderer.send('form:hide'),
  authStart: () => ipcRenderer.invoke('auth:start'),
  authCancel: () => ipcRenderer.send('auth:cancel'),
  signOut: () => ipcRenderer.invoke('form:signout'),
  onSubmitted: cb => ipcRenderer.on('form:submitted', (_e, k) => cb(k)),
  readStore: () => ipcRenderer.sendSync('store:read'),
  writeStore: d => ipcRenderer.send('store:write', d),
  onStore: cb => ipcRenderer.on('store:changed', (_e, d) => cb(d)),
  onNeedView: cb => ipcRenderer.on('form:need-view', () => cb())
});
