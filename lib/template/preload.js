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
  // 返回 Promise<boolean>：true = 真的锁上了（Chrome 113+ 的 requestPointerLock 有 Promise 返回值）
  contextBridge.exposeInMainWorld('__ccfRelock', () => {
    try {
      if (document.pointerLockElement) return Promise.resolve(true);
      const el = lastLockedEl && lastLockedEl.isConnected ? lastLockedEl : document.body;
      if (!el || typeof el.requestPointerLock !== 'function') return Promise.resolve(false);
      const ret = el.requestPointerLock();
      if (ret && typeof ret.then === 'function') {
        return ret.then(
          () => !!document.pointerLockElement,
          () => false
        );
      }
      // 老版本没有返回值：等一拍再看状态
      return new Promise((resolve) => {
        setTimeout(() => resolve(!!document.pointerLockElement), 50);
      });
    } catch (_) {
      return Promise.resolve(false);
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
// ---- 光标隐藏检测：游戏把 cursor 设成 none 时不一定是 pointer lock ----
// 云游戏常见做法是「隐藏系统光标 + 自己算相对位移」。这种模式下鼠标撞到窗口边缘就没法继续转；
// 重新锁定（pointer lock）后会变成无边界相对移动。所以把「光标隐藏」当作信号上报给主进程。
//
// 追求最快：只在「未锁定」期间开一个 requestAnimationFrame 轮询（锁定后立刻停），
// 每帧只检查 gameCanvas / body / 鼠标下元素；样式变化本该在这一帧结算完，
// 这时调 getComputedStyle 最便宜，通常隐藏后 1 帧（≈16ms）内就能发现。

let lastMouse = { x: 0, y: 0, t: 0 };
let cursorHiddenState = null;
let watchRaf = null;
let lastReportAt = 0;

window.addEventListener(
  'mousemove',
  (e) => {
    lastMouse = { x: e.clientX, y: e.clientY, t: Date.now() };
  },
  true
);

function sendCursor(hidden) {
  cursorHiddenState = hidden;
  lastReportAt = Date.now();
  try {
    ipcRenderer.send('@@SLUG@@:cursor', { hidden, sentAt: lastReportAt });
  } catch (_) {}
}

/** 光标是否被隐藏：gameCanvas → body → 鼠标下元素（顺序按命中率排，少调几次 getComputedStyle） */
function isCursorHidden() {
  const none = (el) => {
    if (!el) return false;
    try {
      return getComputedStyle(el).cursor === 'none';
    } catch (_) {
      return false;
    }
  };
  try {
    if (none(lastLockedEl)) return true;
    if (none(document.body)) return true;
    if (lastMouse.t && none(document.elementFromPoint(lastMouse.x, lastMouse.y))) return true;
  } catch (_) {
    /* 忽略 */
  }
  return false;
}

function watchFrame() {
  watchRaf = null;
  let locked = false;
  try {
    locked = !!document.pointerLockElement;
  } catch (_) {}
  if (locked) {
    if (cursorHiddenState !== false) sendCursor(false);
    return; // 锁上了，停止轮询
  }

  const hidden = isCursorHidden();
  if (hidden !== cursorHiddenState) {
    sendCursor(hidden);
  } else if (hidden && Date.now() - lastReportAt > 400) {
    // 一直隐藏着：低频心跳，主进程那边失败时会靠它重试
    lastReportAt = Date.now();
    try {
      ipcRenderer.send('@@SLUG@@:cursor-tick', {});
    } catch (_) {}
  }
  watchRaf = requestAnimationFrame(watchFrame);
}

function startWatch() {
  if (watchRaf) return;
  watchRaf = requestAnimationFrame(watchFrame);
}

function stopWatch() {
  if (watchRaf) {
    cancelAnimationFrame(watchRaf);
    watchRaf = null;
  }
}

// 锁定一变化就切轮询状态：丢锁 → 开始逐帧看；锁上 → 立刻停
document.addEventListener(
  'pointerlockchange',
  () => {
    let locked = false;
    try {
      locked = !!document.pointerLockElement;
    } catch (_) {}
    if (locked) {
      if (cursorHiddenState !== false) sendCursor(false);
      stopWatch();
    } else {
      startWatch();
    }
  },
  true
);

// 最快路径：DOM 样式/类名一变就在微任务里立刻探（未锁定时才做，成本可控），
// 通常比等下一帧（≈16ms）再早十几毫秒；rAF 轮询继续作为兜底。
try {
  const mo = new MutationObserver(() => {
    let locked = false;
    try {
      locked = !!document.pointerLockElement;
    } catch (_) {}
    if (locked) return;
    const hidden = isCursorHidden();
    if (hidden !== cursorHiddenState) sendCursor(hidden);
  });
  mo.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style', 'class'],
    subtree: true,
    childList: true,
  });
} catch (_) {
  /* 忽略 */
}

// 兜底：页面一开始就没锁定（或从别的状态进来）也开一次
window.addEventListener('load', () => {
  let locked = false;
  try {
    locked = !!document.pointerLockElement;
  } catch (_) {}
  if (!locked) startWatch();
});
