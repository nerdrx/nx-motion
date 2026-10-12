const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('motion', {
  pickFiles: () => ipcRenderer.invoke('pickFiles'),
  inspect: paths => ipcRenderer.invoke('inspect', paths),
  pickOutput: () => ipcRenderer.invoke('pickOutput'),
  start: request => ipcRenderer.invoke('start', request),
  cancel: () => ipcRenderer.invoke('cancel'),
  reveal: file => ipcRenderer.invoke('reveal', file),
  droppedFiles: files => Array.from(files, file => webUtils.getPathForFile(file)).filter(Boolean),
  onProgress: callback => {
    const listener = (_, event) => callback(event);
    ipcRenderer.on('progress', listener);
    return () => ipcRenderer.removeListener('progress', listener);
  }
});
