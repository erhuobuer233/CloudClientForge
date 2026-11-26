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

  listClients: () => ipcRenderer.invoke('gui:list-clients'),
  launchClient: (p) => ipcRenderer.invoke('gui:launch-client', p),
  reveal: (p) => ipcRenderer.invoke('gui:reveal', p),
  deleteClient: (p) => ipcRenderer.invoke('gui:client-delete', p),
  renameClient: (p, name) => ipcRenderer.invoke('gui:client-rename', p, name),
  setClientIcon: (p) => ipcRenderer.invoke('gui:client-set-icon', p),
  openLauncher: () => ipcRenderer.invoke('gui:open-launcher'),
  openMain: () => ipcRenderer.invoke('gui:show-main'),
  installToolchain: () => ipcRenderer.invoke('gui:install-toolchain'),
  onToolchainLog: (cb) => ipcRenderer.on('gui:toolchain-log', (_e, text) => cb(text)),
  onToolchainStage: (cb) => ipcRenderer.on('gui:toolchain-stage', (_e, payload) => cb(payload)),
  checkUpdate: () => ipcRenderer.invoke('gui:check-update'),
  openExternal: (u) => ipcRenderer.invoke('gui:open-external', u),

  pickDir: () => ipcRenderer.invoke('gui:pick-dir'),
  openPath: (p) => ipcRenderer.invoke('gui:open-path', p),
  copy: (text) => ipcRenderer.invoke('gui:copy', text),

  minimize: () => ipcRenderer.send('gui:minimize'),
  close: () => ipcRenderer.send('gui:close'),
});
