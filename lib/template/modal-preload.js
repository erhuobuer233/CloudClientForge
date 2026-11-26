'use strict';

/** 自绘对话框的预加载：把点击结果回传给主进程。 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('modalApi', {
  done: (index) => ipcRenderer.send('modal-result', index),
});
