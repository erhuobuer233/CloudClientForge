'use strict';

/**
 * CloudClientForge GUI —— 预加载脚本
 * 只暴露界面需要的几个能力，渲染进程不直接碰 Node。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('forgeGui', {
  info: () => ipcRenderer.invoke('gui:info'),
  settings: () => ipcRenderer.invoke('gui:settings'),
  saveSettings: (obj) => ipcRenderer.invoke('gui:save-settings', obj),

  start: (opts) => ipcRenderer.invoke('forge:start', opts),
  cancel: () => ipcRenderer.invoke('forge:cancel'),
  onLog: (cb) => ipcRenderer.on('forge:log', (_e, payload) => cb(payload)),
  onExit: (cb) => ipcRenderer.on('forge:exit', (_e, payload) => cb(payload)),

  pickDir: () => ipcRenderer.invoke('gui:pick-dir'),
  openPath: (p) => ipcRenderer.invoke('gui:open-path', p),
  copy: (text) => ipcRenderer.invoke('gui:copy', text),

  minimize: () => ipcRenderer.send('gui:minimize'),
  close: () => ipcRenderer.send('gui:close'),
});
