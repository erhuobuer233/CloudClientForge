'use strict';

/**
 * @@PRODUCT@@ 桌面版 —— 预加载脚本（由 CloudClientForge 生成）
 *
 * 只做两件事：
 *  1. 向页面暴露一个极小的只读标识对象，便于页面/调试时识别桌面客户端。
 *  2. 把「页面是否处于全屏 / 浏览器是否支持键盘锁」上报给主进程。
 *
 * 第 2 点是全屏体验的保险：若站点自己调用
 * requestFullscreen({ keyboardLock: 'browser' }) + navigator.keyboard.lock()，
 * 键盘锁生效时 Esc 会交给游戏、Chromium 不会退出全屏；万一键盘锁不可用，
 * 主进程会启用 Esc 兜底拦截，避免全屏被 Esc 意外顶掉。
 */

const { contextBridge, ipcRenderer } = require('electron');

const versions = (() => {
  try {
    return {
      electron: process.versions.electron || '',
      chrome: process.versions.chrome || '',
    };
  } catch (_) {
    return { electron: '', chrome: '' };
  }
})();

try {
  contextBridge.exposeInMainWorld('@@SLUG@@DesktopClient', {
    isDesktopClient: true,
    name: '@@PRODUCT@@ Desktop',
    versions,
  });
} catch (_) {
  /* 忽略：暴露失败不影响页面本身 */
}

function reportFullscreenState() {
  let fullscreen = false;
  let canLock = false;
  try {
    fullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
    canLock = !!(navigator.keyboard && typeof navigator.keyboard.lock === 'function');
  } catch (_) {
    /* 忽略 */
  }
  ipcRenderer.send('@@SLUG@@:fullscreen-state', { fullscreen, canLock });
}

document.addEventListener('fullscreenchange', reportFullscreenState, true);
document.addEventListener('webkitfullscreenchange', reportFullscreenState, true);
window.addEventListener('load', reportFullscreenState, true);
window.addEventListener('DOMContentLoaded', reportFullscreenState, true);

// ---------------------------------------------------------------- 指针锁定（视角）

/**
 * 站点 UI 打开 → 释放指针锁定；关闭 UI → 想重新锁定但需要用户手势。
 * 这里记录最后一次真正锁定的元素，并暴露一个恢复函数给主进程（带 userGesture 调用），
 * 这样「退出 UI 后视角不动」可以在不打扰用户的情况下自愈。
 */
let lastLockedEl = null;

function reportPointerLock(kind) {
  try {
    ipcRenderer.send('@@SLUG@@:pointerlock', { kind });
  } catch (_) {
    /* 忽略 */
  }
}

function onPointerLockChange() {
  let el = null;
  try {
    el = document.pointerLockElement || document.webkitPointerLockElement || null;
  } catch (_) {
    el = null;
  }
  if (el) {
    lastLockedEl = el;
    reportPointerLock('locked');
  } else {
    reportPointerLock('lost');
  }
}

try {
  contextBridge.exposeInMainWorld('__ccfRelock', () => {
    try {
      if (document.pointerLockElement) return true; // 已经锁着，无需处理
      const el = lastLockedEl && lastLockedEl.isConnected ? lastLockedEl : document.body;
      if (!el || typeof el.requestPointerLock !== 'function') return false;
      const ret = el.requestPointerLock();
      if (ret && typeof ret.catch === 'function') ret.catch(() => {});
      return true;
    } catch (_) {
      return false;
    }
  });
} catch (_) {
  /* 暴露失败不影响页面本身 */
}

document.addEventListener('pointerlockchange', onPointerLockChange, true);
document.addEventListener('webkitpointerlockchange', onPointerLockChange, true);
document.addEventListener(
  'pointerlockerror',
  () => {
    reportPointerLock('error');
  },
  true
);