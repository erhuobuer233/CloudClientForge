'use strict';

/**
 * @@PRODUCT@@ 桌面版 —— 主进程（由 CloudClientForge 生成）
 *
 * 源站点：@@CLOUD_URL@@
 * 生成时间：@@BUILT_AT@@（生成器版本 @@FORGE_VERSION@@）
 *
 * 这是把官方网页端封装成 Windows 桌面客户端的主进程，功能：
 *  1. 无浏览器外壳：没有地址栏/标签页/“按 Esc 退出全屏”的浏览器提示。
 *  2. 登录状态持久化（独立 partition），下次打开免登录。
 *  3. 默认窗口化（1280×800 居中）；检测到「进入游戏」后自动全屏，退出游戏后恢复窗口。
 *  4. 全屏时阻止显示器休眠；后台不降频，避免串流卡顿。
 *  5. 站点里的网页类入口（公告、下载、用户中心、协议、客服…）一律交给系统浏览器，
 *     客户端窗口始终停在游戏页面上。
 *  6. 关窗 / Alt+F4 走自己的确认流程，确认后强制结束进程，不留后台残留。
 *  7. F11 / Alt+Enter 手动全屏；Ctrl+Shift+H 回入口；F12 开发者工具；Ctrl+W 屏蔽。
 */

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  shell,
  session,
  ipcMain,
  powerSaveBlocker,
  nativeImage,
  screen,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// ---------------------------------------------------------------- 常量

const CLOUD_URL = '@@CLOUD_URL@@';
const PARTITION = 'persist:@@SLUG@@';
const PRODUCT = '@@PRODUCT@@';
const DISPLAY_NAME = '@@DISPLAY_NAME@@';
const APP_DIR = path.join(__dirname, '..');
const ICON_ICO = path.join(APP_DIR, 'assets', 'icon.ico');
const ICON_PNG = path.join(APP_DIR, 'assets', 'icon.png');

/**
 * 允许留在客户端窗口内的地址前缀：默认是入口页自己（同源 + 同一级路径），
 * 其它一律交给系统浏览器。生成时可用 -AllowUrls 追加（登录域名、支付域名等）。
 */
const IN_APP_PREFIXES = @@IN_APP_PREFIXES@@;

/** 「进入游戏」需要看的画面元素 id（生成时可用 -ProbeSelectors 指定）。 */
const GAME_ELEMENT_IDS = @@GAME_ELEMENT_IDS@@;

const DEFAULT_SETTINGS = {
  autoFullscreen: false, // 启动后是否直接全屏（默认否：启动界面用普通窗口）
  fullscreenInGame: true, // 开始游戏后自动全屏，退出游戏回到启动界面时恢复窗口
  keepAwake: true,
  confirmOnExit: true,
  relock: true, // UI 关闭后自动恢复「视角锁定」（指针锁定），见 relockAfterUI()
  zoom: 1,
  window: { width: 1280, height: 800, x: null, y: null, maximized: false },
};

// ---------------------------------------------------------------- 设置读写

let settingsPath = null;
let settings = { ...DEFAULT_SETTINGS, window: { ...DEFAULT_SETTINGS.window } };
let saveTimer = null;

function getSettingsPath() {
  if (!settingsPath) settingsPath = path.join(app.getPath('userData'), 'settings.json');
  return settingsPath;
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(getSettingsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    settings = {
      ...DEFAULT_SETTINGS,
      ...parsed,
      window: { ...DEFAULT_SETTINGS.window, ...(parsed.window || {}) },
    };
  } catch (_) {
    /* 首次运行或文件损坏：使用默认值 */
  }
}

function saveSettingsSoon() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(path.dirname(getSettingsPath()), { recursive: true });
      fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf8');
    } catch (e) {
      console.warn('[settings] 保存失败:', e.message);
    }
  }, 400);
}

// ---------------------------------------------------------------- 单实例

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  bootstrap();
}

function bootstrap() {
  app.commandLine.appendSwitch('enable-features', 'KeyboardLock');
  // 伪装成普通 Chrome，避免个别站点对 Electron UA 做兼容性拦截。
  app.userAgentFallback = chromeLikeUserAgent();

  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(onReady);

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', () => {
    stopKeepAwake();
    isQuitting = true;
  });

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  });
}

function chromeLikeUserAgent() {
  const chrome = process.versions.chrome || '140.0.0.0';
  return (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    `(KHTML, like Gecko) Chrome/${chrome} Safari/537.36`
  );
}

/** 该地址是否应该留在客户端窗口内；其余一律交给浏览器。 */
function isInAppUrl(url) {
  try {
    return IN_APP_PREFIXES.some((prefix) => String(url).startsWith(prefix));
  } catch (_) {
    return false;
  }
}

// ---------------------------------------------------------------- 运行期状态
let mainWindow = null;
let tray = null;
let keepAwakeId = null;
let isQuitting = false;
let quitPromptOpen = false;
let gameRunning = false;
let gamePollTimer = null;
let gamePollBusy = false;
let htmlFullscreen = false;
let keyboardLockAvailable = true;
let escFallbackArmed = false;
let loadedOnce = false;
let loadFailures = 0;
let zoomPersistTimer = null;

// ---------------------------------------------------------------- 就绪

function onReady() {
  Menu.setApplicationMenu(null);
  loadSettings();
  hardenSession();
  createSplashWindow();
  createMainWindow();
  createTray();
}

// ---------------------------------------------------------------- 启动画面（圆角）

let splashWindow = null;
let splashShownAt = 0;

function createSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) return;
  splashWindow = new BrowserWindow({
    width: 460,
    height: 300,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    show: false,
    title: PRODUCT,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html')).catch(() => {});
  splashWindow.once('ready-to-show', () => {
    if (!splashWindow || splashWindow.isDestroyed()) return;
    splashShownAt = Date.now();
    splashWindow.show();
  });
  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

function splashStatus(text) {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  splashWindow.webContents
    .executeJavaScript('window.setStatus(' + JSON.stringify(String(text)) + ')', true)
    .catch(() => {});
}

/**
 * 关闭启动画面：至少显示 800ms 再淡出，避免页面加载太快时只闪一下
 * （否则用户可能根本看不到这张启动卡，还以为是黑屏）。
 */
function closeSplash() {
  const win = splashWindow;
  if (!win || win.isDestroyed()) return;
  splashWindow = null;
  const wait = Math.max(0, 800 - (Date.now() - splashShownAt));
  setTimeout(() => {
    try {
      if (win.isDestroyed()) return;
      win.webContents.executeJavaScript('window.hideSplash()', true).catch(() => {});
      setTimeout(() => {
        try {
          if (!win.isDestroyed()) win.destroy();
        } catch (_) {
          /* 忽略 */
        }
      }, 240);
    } catch (_) {
      /* 忽略 */
    }
  }, wait);
}

// ---------------------------------------------------------------- 自绘对话框（圆角）

/**
 * 用自绘的小窗口代替系统原生 MessageBox：圆角、深色、和客户端/启动画面同一套风格。
 * 返回 Promise<number>：按钮下标，用户直接关窗/按 Esc 返回 -1。
 */
function askModal(opts) {
  return new Promise((resolve) => {
    const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    const win = new BrowserWindow({
      width: 460,
      height: 204,
      parent: parent || undefined,
      modal: !!parent,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: true,
      show: false,
      title: PRODUCT,
      webPreferences: {
        preload: path.join(__dirname, 'modal-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    let settled = false;
    const finish = (index) => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener('modal-result', onResult);
      try {
        if (!win.isDestroyed()) win.destroy();
      } catch (_) {
        /* 忽略 */
      }
      resolve(index);
    };
    const onResult = (event, index) => {
      if (event.sender === win.webContents) finish(Number(index));
    };

    ipcMain.on('modal-result', onResult);
    win.on('closed', () => finish(-1));
    win.loadFile(path.join(__dirname, 'modal.html')).catch(() => {});
    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return;
      win.show();
      win.webContents
        .executeJavaScript('window.__setModal(' + JSON.stringify(opts || {}) + ')', true)
        .catch(() => {});
    });
  });
}

function hardenSession() {
  const ses = session.fromPartition(PARTITION);

  // 站点是第一方官方页面：放行其所需的权限（指针锁、全屏、串流相关的媒体能力等）。
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(true));
  ses.setPermissionCheckHandler(() => true);
}

// ---------------------------------------------------------------- 主窗口

function createMainWindow() {
  createSplashWindow();
  splashStatus('正在加载页面…');
  const w = settings.window || {};
  const pos = sanitizePosition(w);

  mainWindow = new BrowserWindow({
    width: Number(w.width) || 1280,
    height: Number(w.height) || 800,
    x: pos.x,
    y: pos.y,
    minWidth: 1024,
    minHeight: 576,
    show: false,
    backgroundColor: '#0a0a14',
    title: DISPLAY_NAME,
    icon: fs.existsSync(ICON_ICO) ? ICON_ICO : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false, // 切到后台也保持串流帧率
      autoplayPolicy: 'no-user-gesture-required',
      zoomFactor: clampZoom(settings.zoom),
    },
  });

  mainWindow.setMenuBarVisibility(false);

  let shown = false;
  const showOnce = () => {
    if (shown || !mainWindow || mainWindow.isDestroyed()) return;
    shown = true;
    if (settings.window && settings.window.maximized) {
      mainWindow.maximize();
    } else if (!Number.isFinite(pos.x)) {
      mainWindow.center();
    }
    splashStatus('准备就绪');
    mainWindow.show();
    closeSplash();
  };
  mainWindow.once('ready-to-show', showOnce);
  const showFallback = setTimeout(showOnce, 8000);
  mainWindow.on('closed', () => clearTimeout(showFallback));

  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault(); // 固定标题，不让页面改来改去
  });

  mainWindow.on('resize', rememberBounds);
  mainWindow.on('move', rememberBounds);
  mainWindow.on('maximize', rememberBounds);
  mainWindow.on('unmaximize', rememberBounds);
  mainWindow.on('enter-full-screen', () => {
    updateKeepAwake();
    refreshTrayMenu();
  });
  mainWindow.on('leave-full-screen', () => {
    updateKeepAwake();
    refreshTrayMenu();
  });
  mainWindow.on('focus', updateKeepAwake);
  mainWindow.on('blur', updateKeepAwake);
  mainWindow.on('minimize', updateKeepAwake);
  mainWindow.on('restore', updateKeepAwake);

  mainWindow.on('closed', () => {
    stopGameStateWatch();
    gameRunning = false;
    mainWindow = null;
  });

  // ---- 关窗（X 按钮 / Alt+F4）先询问，确认后强制结束 ----
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    confirmAndQuit();
  });

  wireWebContents(mainWindow);
  startGameStateWatch();

  mainWindow.loadURL(CLOUD_URL).catch((err) => {
    console.warn('[load] 首次加载失败:', err && err.message);
  });
}

function wireWebContents(win) {
  const wc = win.webContents;

  wc.on('enter-html-full-screen', () => {
    htmlFullscreen = true;
    updateKeepAwake();
    refreshTrayMenu();
  });
  wc.on('leave-html-full-screen', () => {
    htmlFullscreen = false;
    updateKeepAwake();
    refreshTrayMenu();
  });

  // ---- 快捷键：全部在主进程处理 ----
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = String(input.key || '');
    const lower = key.toLowerCase();
    const ctrl = !!input.control;
    const shift = !!input.shift;
    const alt = !!input.alt;

    // Esc 兜底：仅当页面进入全屏、但站点的键盘锁不可用时启用。
    if (key === 'Escape' && escFallbackArmed && htmlFullscreen) {
      event.preventDefault();
      wc.executeJavaScript(
        "window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true,cancelable:true}));",
        true
      ).catch(() => {});
      return;
    }

    if (ctrl && shift && lower === 'h') {
      event.preventDefault();
      goHome();
      return;
    }
    if (ctrl && lower === 'w') {
      event.preventDefault(); // 防止误按 Ctrl+W 直接关掉串流
      return;
    }
    if (key === 'F11' || (alt && (key === 'Enter' || key === 'Return'))) {
      event.preventDefault();
      if (!input.isAutoRepeat) toggleFullscreen();
      return;
    }
    if (alt && (key === 'F4' || lower === 'f4')) {
      event.preventDefault();
      if (!input.isAutoRepeat) confirmAndQuit();
      return;
    }
    if (input.isAutoRepeat) return;

    // F5 / Ctrl+R 故意不拦截：会和游戏内按键冲突，重新加载用托盘菜单。
    if (key === 'F12' || (ctrl && shift && lower === 'i')) {
      event.preventDefault();
      if (wc.isDevToolsOpened()) wc.closeDevTools();
      else wc.openDevTools({ mode: 'detach' });
      return;
    }
    if (ctrl && (key === '0' || key === ')')) {
      event.preventDefault();
      applyZoom(1);
      return;
    }
    if (ctrl && (key === '=' || key === '+' || lower === '=')) {
      event.preventDefault();
      applyZoom(getZoom() + 0.1);
      return;
    }
    if (ctrl && (key === '-' || key === '_')) {
      event.preventDefault();
      applyZoom(getZoom() - 0.1);
      return;
    }
  });

  wc.on('zoom-changed', () => scheduleZoomPersist(wc.getZoomFactor()));

  // ---- 所有新窗口 / 外链：一律交给系统默认浏览器 ----
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  // ---- 顶层跳转：只允许入口地址留在客户端内，其余交给浏览器 ----
  wc.on('will-navigate', (event, url) => {
    if (isInAppUrl(url)) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url).catch(() => {});
  });

  // ---- 不让页面用 beforeunload 卡住关闭 / 刷新 ----
  wc.on('will-prevent-unload', (event) => {
    event.preventDefault();
  });

  // ---- 加载失败自动重试 ----
  wc.on('did-start-loading', () => {
    splashStatus('正在连接服务器…');
  });

  wc.on('did-finish-load', () => {
    loadFailures = 0;
    splashStatus('正在准备游戏页面…');
    startGameStateWatch();
    if (!loadedOnce) {
      loadedOnce = true;
      if (settings.autoFullscreen) {
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFullScreen()) {
            mainWindow.setFullScreen(true);
          }
        }, 900);
      }
    }
  });

  wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    if (errorCode === -3) return; // ERR_ABORTED：正常的跳转中断
    loadFailures += 1;
    console.warn(`[load] 失败(${errorCode} ${errorDescription}) 第 ${loadFailures} 次: ${validatedURL}`);
    if (loadFailures <= 5) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(CLOUD_URL).catch(() => {});
      }, 1500 * loadFailures);
    } else {
      closeSplash();
      askModal({
        icon: '!',
        tone: 'warn',
        title: '页面加载失败',
        detail: `无法打开 ${DISPLAY_NAME}（${errorDescription || errorCode}）。\n请检查网络后重试。`,
        buttons: ['重试', '退出'],
        primary: 0,
      })
        .then((index) => {
          if (index === 0) {
            loadFailures = 0;
            goHome();
          } else {
            app.quit();
          }
        })
        .catch(() => {});
    }
  });

  wc.on('render-process-gone', (_e, details) => {
    console.warn('[crash] 渲染进程退出:', details && details.reason);
    if (isQuitting || !mainWindow || mainWindow.isDestroyed()) return;
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
    }, 800);
  });

  wc.on('unresponsive', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    askModal({
      icon: '…',
      tone: 'warn',
      title: '页面似乎卡住了',
      detail: '页面有一段时间没有响应，要重新加载吗？',
      buttons: ['继续等待', '重新加载'],
      primary: 1,
    })
      .then((index) => {
        if (index === 1 && mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
      })
      .catch(() => {});
  });
}

// ---------------------------------------------------------------- 游戏状态检测

/**
 * 判断「是否已经进入游戏画面」。
 *
 * 云游戏站点的实现五花八门，这里用一套通用判据（而不是绑死某个站点）：
 *  ① 页面自己进入了全屏（document.fullscreenElement）→ 直接算游戏中；
 *  ② 命中已知的画面元素 id（GAME_ELEMENT_IDS，生成时可用 -ProbeSelectors 指定）：
 *     元素可见、铺开 ≥30% 视口，并且确实是画面（canvas / 有流 / 有画面尺寸 / 内含 video|canvas）；
 *  ③ 兜底：任意铺满 ≥70% 视口的 video / canvas 正在出画面（video 还要求真的在播、不是循环宣传片）。
 *
 * 启动界面里那种「先创建好但隐藏」的元素不会命中（要求可见），
 * 所以「开始游戏前窗口化、开始游戏后才全屏」在大多数站点上都能成立。
 */
const GAME_STATE_PROBE = `(() => {
  try {
    if (document.fullscreenElement) return true;

    const vw = Math.max(window.innerWidth, 1);
    const vh = Math.max(window.innerHeight, 1);

    const visibleBig = (el, ratio, minW, minH) => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (parseFloat(cs.opacity || '1') === 0) return false;
      const w = el.offsetWidth || 0;
      const h = el.offsetHeight || 0;
      if (w < (minW || 320) || h < (minH || 200)) return false;
      return w * h >= vw * vh * ratio;
    };

    const drawing = (el) => {
      if (el.tagName === 'CANVAS') return true; // WebCodecs / canvas 渲染
      if (el.readyState >= 2) return true;      // 有画面帧
      if (el.videoWidth > 0) return true;
      if (el.srcObject || el.currentSrc) return true;
      if (el.querySelector && el.querySelector('video, canvas')) return true; // 容器元素
      return false;
    };

    // ② 已知的画面元素
    for (const id of @@GAME_IDS_JSON@@) {
      const el = document.getElementById(id);
      if (visibleBig(el, 0.3) && drawing(el)) return true;
    }

    // ③ 兜底：铺满视口的媒体元素
    const media = document.querySelectorAll('video, canvas');
    for (const el of media) {
      if (!visibleBig(el, 0.7)) continue;
      if (el.tagName === 'CANVAS') return true;
      if (el.loop) continue;                    // 循环播放的多半是宣传片
      if (el.paused) continue;
      if (drawing(el)) return true;
    }

    return false;
  } catch (e) { return false; }
})()`;

async function detectGameRunning() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const wc = mainWindow.webContents;
  if (!wc || wc.isDestroyed()) return false;

  let frames = [];
  try {
    const sub = wc.mainFrame.framesInSubtree;
    frames = Array.isArray(sub) && sub.length ? sub : [wc.mainFrame];
  } catch (_) {
    frames = [wc.mainFrame];
  }

  for (const frame of frames) {
    try {
      const found = await withTimeout(frame.executeJavaScript(GAME_STATE_PROBE, true), 2000);
      if (found) return true;
    } catch (_) {
      /* frame 正在导航或被销毁，忽略 */
    }
  }
  return false;
}

/** 给可能卡住的 Promise 加超时，避免轮询被永久阻塞。 */
function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve(false); }
    }, ms);
    promise
      .then((v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } })
      .catch(() => { if (!settled) { settled = true; clearTimeout(timer); resolve(false); } });
  });
}

async function pollGameState() {
  if (gamePollBusy) return;
  gamePollBusy = true;
  try {
    const running = await withTimeout(detectGameRunning(), 3000);
    if (running !== gameRunning) {
      gameRunning = running;
      applyGameFullscreen(running);
      refreshTrayMenu();
    }
  } finally {
    gamePollBusy = false;
  }
}

function startGameStateWatch() {
  stopGameStateWatch();
  pollGameState().catch(() => {});
  gamePollTimer = setInterval(() => {
    pollGameState().catch(() => {});
  }, 800);
}

function stopGameStateWatch() {
  if (gamePollTimer) {
    clearInterval(gamePollTimer);
    gamePollTimer = null;
  }
}

/**
 * 只在「游戏开始 / 结束」这两个状态跳变时动手，用户手动切全屏不会被反复覆盖。
 */
function applyGameFullscreen(running) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!settings.fullscreenInGame) return;

  if (running) {
    if (!mainWindow.isFullScreen()) mainWindow.setFullScreen(true);
  } else {
    if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
    mainWindow.webContents
      .executeJavaScript(
        'document.fullscreenElement && document.exitFullscreen ? document.exitFullscreen().catch(()=>{}) : null',
        true
      )
      .catch(() => {});
  }
  updateKeepAwake();
}

// ---------------------------------------------------------------- 退出流程

function confirmAndQuit() {
  if (isQuitting) return;
  if (!settings.confirmOnExit) {
    forceQuit();
    return;
  }
  if (quitPromptOpen) return;
  quitPromptOpen = true;

  askModal({
    icon: '?',
    title: `确定要退出${DISPLAY_NAME}吗？`,
    detail: '退出会结束当前的云游戏会话。',
    buttons: ['退出', '继续游戏'],
    primary: 1,
    danger: 0,
  })
    .then((index) => {
      quitPromptOpen = false;
      if (index === 0) {
        forceQuit();
      } else if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
    })
    .catch(() => {
      quitPromptOpen = false;
      forceQuit();
    });
}

/**
 * 强制退出：destroy() 不触发页面的 unload / beforeunload，能绕开站点的拦截；
 * 之后再兜一层 app.exit()，确保进程一定结束、不留后台残留。
 */
function forceQuit() {
  isQuitting = true;
  stopKeepAwake();
  stopGameStateWatch();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
  }

  app.quit();

  const t = setTimeout(() => app.exit(0), 2000);
  if (t && typeof t.unref === 'function') t.unref();
}

// ---------------------------------------------------------------- 窗口行为

/** 显示器配置变化后，历史窗口坐标可能已经跑到屏幕外，这里做一次可见性校验。 */
function sanitizePosition(w) {
  if (!Number.isFinite(w.x) || !Number.isFinite(w.y)) return { x: undefined, y: undefined };
  try {
    const width = Number(w.width) || 1280;
    const height = Number(w.height) || 800;
    const ok = screen.getAllDisplays().some(({ workArea: a }) => {
      const overlapX = Math.min(w.x + width, a.x + a.width) - Math.max(w.x, a.x);
      const overlapY = Math.min(w.y + height, a.y + a.height) - Math.max(w.y, a.y);
      return overlapX >= 120 && overlapY >= 80;
    });
    return ok ? { x: w.x, y: w.y } : { x: undefined, y: undefined };
  } catch (_) {
    return { x: w.x, y: w.y };
  }
}

function rememberBounds() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isFullScreen()) return;
  const maximized = mainWindow.isMaximized();
  settings.window = {
    ...settings.window,
    maximized,
    width: maximized ? settings.window.width : mainWindow.getBounds().width,
    height: maximized ? settings.window.height : mainWindow.getBounds().height,
  };
  if (!maximized) {
    const b = mainWindow.getBounds();
    settings.window.x = b.x;
    settings.window.y = b.y;
  }
  saveSettingsSoon();
}

function toggleFullscreen() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const leaving = mainWindow.isFullScreen() || htmlFullscreen;
  if (leaving) {
    mainWindow.webContents
      .executeJavaScript(
        'document.fullscreenElement && document.exitFullscreen ? document.exitFullscreen().catch(()=>{}) : null',
        true
      )
      .catch(() => {})
      .finally(() => {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFullScreen()) {
          mainWindow.setFullScreen(false);
        }
        updateKeepAwake();
      });
  } else {
    mainWindow.setFullScreen(true);
    updateKeepAwake();
  }
}

function goHome() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  loadFailures = 0;
  mainWindow.loadURL(CLOUD_URL).catch(() => {});
  mainWindow.show();
  mainWindow.focus();
}

function getZoom() {
  if (!mainWindow || mainWindow.isDestroyed()) return clampZoom(settings.zoom);
  return clampZoom(mainWindow.webContents.getZoomFactor());
}

function clampZoom(z) {
  const n = Number(z);
  if (!Number.isFinite(n)) return 1;
  return Math.min(2, Math.max(0.5, Math.round(n * 100) / 100));
}

function applyZoom(z) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const value = clampZoom(z);
  mainWindow.webContents.setZoomFactor(value);
  settings.zoom = value;
  saveSettingsSoon();
}

function scheduleZoomPersist(z) {
  if (zoomPersistTimer) clearTimeout(zoomPersistTimer);
  zoomPersistTimer = setTimeout(() => {
    settings.zoom = clampZoom(z);
    saveSettingsSoon();
  }, 300);
}

// ---------------------------------------------------------------- 防息屏

function updateKeepAwake() {
  const inFullscreen =
    !!mainWindow &&
    !mainWindow.isDestroyed() &&
    (mainWindow.isFullScreen() || htmlFullscreen) &&
    mainWindow.isVisible() &&
    !mainWindow.isMinimized();

  const want = settings.keepAwake && inFullscreen;

  if (want && keepAwakeId === null) {
    try {
      keepAwakeId = powerSaveBlocker.start('prevent-display-sleep');
    } catch (_) {
      keepAwakeId = null;
    }
  } else if (!want && keepAwakeId !== null) {
    stopKeepAwake();
  }
}

function stopKeepAwake() {
  if (keepAwakeId !== null) {
    try {
      powerSaveBlocker.stop(keepAwakeId);
    } catch (_) {
      /* 忽略 */
    }
    keepAwakeId = null;
  }
}

// ---------------------------------------------------------------- 托盘

function createTray() {
  const iconPath = fs.existsSync(ICON_ICO) ? ICON_ICO : ICON_PNG;
  if (!fs.existsSync(iconPath)) return;
  try {
    let image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) return;
    image = image.resize({ width: 16, height: 16 });
    tray = new Tray(image);
    tray.setToolTip(DISPLAY_NAME);
    tray.on('double-click', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return createMainWindow();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    });
    refreshTrayMenu();
  } catch (e) {
    console.warn('[tray] 托盘图标创建失败（不影响使用）:', e.message);
    tray = null;
  }
}

function trayMenu() {
  const fullscreen = !!mainWindow && !mainWindow.isDestroyed() && (mainWindow.isFullScreen() || htmlFullscreen);
  return Menu.buildFromTemplate([
    {
      label: '显示主界面',
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) return createMainWindow();
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      },
    },
    { type: 'separator' },
    {
      label: '全屏  (F11 / Alt+Enter)',
      type: 'checkbox',
      checked: fullscreen,
      click: () => toggleFullscreen(),
    },
    {
      label: '启动时自动全屏',
      type: 'checkbox',
      checked: !!settings.autoFullscreen,
      click: (item) => {
        settings.autoFullscreen = item.checked;
        saveSettingsSoon();
      },
    },
    {
      label: '玩游戏时自动全屏',
      type: 'checkbox',
      checked: settings.fullscreenInGame !== false,
      click: (item) => {
        settings.fullscreenInGame = item.checked;
        saveSettingsSoon();
      },
    },
    {
      label: '全屏时防止息屏',
      type: 'checkbox',
      checked: !!settings.keepAwake,
      click: (item) => {
        settings.keepAwake = item.checked;
        saveSettingsSoon();
        updateKeepAwake();
      },
    },
    {
      label: '自动恢复视角锁定（UI 关闭后）',
      type: 'checkbox',
      checked: settings.relock !== false,
      click: (item) => {
        settings.relock = item.checked;
        saveSettingsSoon();
      },
    },
    {
      label: '退出前询问',
      type: 'checkbox',
      checked: !!settings.confirmOnExit,
      click: (item) => {
        settings.confirmOnExit = item.checked;
        saveSettingsSoon();
      },
    },
    { type: 'separator' },
    { label: '重新加载', click: () => mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.reload() },
    { label: '回到入口页  (Ctrl+Shift+H)', click: goHome },
    { type: 'separator' },
    { label: '打开官网', click: () => shell.openExternal('@@OFFICIAL_SITE@@') },
    {
      label: '开发者工具  (F12)',
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        const wc = mainWindow.webContents;
        if (wc.isDevToolsOpened()) wc.closeDevTools();
        else wc.openDevTools({ mode: 'detach' });
      },
    },
    { type: 'separator' },
    {
      label: '立即退出（不再询问）',
      click: () => forceQuit(),
    },
  ]);
}

function refreshTrayMenu() {
  if (!tray) return;
  try {
    tray.setContextMenu(trayMenu());
  } catch (_) {
    /* 忽略 */
  }
}

// ---------------------------------------------------------------- 指针锁定（视角）

/**
 * 站点自己的 UI（公告 / 背包 / 菜单）打开时会主动释放指针锁定；关闭 UI 后它想重新锁定，
 * 但 Chromium 要求 requestPointerLock 必须发生在「用户手势」之后。
 * 浏览器里这次手势通常来自关闭 UI 的那一下点击；Electron 里有时会丢（例如 UI 是用
 * Escape / 快捷键关掉的，或者点击被我们拦下了），于是表现为：视角转不动，点一下才恢复。
 *
 * 处理：页面报告 pointerlockerror 时，用带 userGesture 的 executeJavaScript 让它重新请求锁定；
 * 仍失败则兜底在光标处补一次真实点击（必须在同一次手势窗口里，所以放在 250ms 后重试一次）。
 */
let lastLockLostAt = 0;
let lastRelockAt = 0;
let relockTimer = null;

/** 兜底：在光标处补一次真实点击（等同用户点一下，授予手势） */
function clickFallback(wc) {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isFocused()) return;
  try {
    const pt = screen.getCursorScreenPoint();
    const b = mainWindow.getContentBounds();
    const x = Math.round(Math.min(Math.max(pt.x - b.x, 1), Math.max(b.width - 2, 1)));
    const y = Math.round(Math.min(Math.max(pt.y - b.y, 1), Math.max(b.height - 2, 1)));
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  } catch (_) {}
}

function relockAfterUI(reason) {
  if (!settings.relock) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!mainWindow.isFocused()) return;
  // 只在「本来就在游戏里、刚刚丢过锁定」时恢复：
  // 落地页/登录页上的 pointerlockerror 不该被我们强行接管（会把鼠标困住）
  if (!gameRunning) return;
  if (!lastLockLostAt || Date.now() - lastLockLostAt > 10000) return;
  const now = Date.now();
  if (now - lastRelockAt < 900) return;
  lastRelockAt = now;

  const wc = mainWindow.webContents;
  clearTimeout(relockTimer);
  relockTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    // ① 优先：带 userGesture 让页面重新请求指针锁定（不产生额外点击）
    wc.executeJavaScript(
      '(() => { try { return !!(window.__ccfRelock && window.__ccfRelock()); } catch (e) { return false; } })()',
      true
    )
      .then((asked) => {
        if (!asked) return clickFallback(wc);
        // 250ms 后确认是否真的锁上；没锁上再补一次真实点击
        setTimeout(() => {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          wc.executeJavaScript('!!(document.pointerLockElement || document.webkitPointerLockElement)', true)
            .then((locked) => {
              if (!locked) clickFallback(wc);
            })
            .catch(() => {});
        }, 250);
      })
      .catch(() => clickFallback(wc));
  }, 60);
  console.log('[pointerlock] 尝试恢复视角锁定：' + reason);
}

ipcMain.on('@@SLUG@@:pointerlock', (_event, payload) => {
  const kind = payload && payload.kind;
  if (kind === 'error') {
    relockAfterUI('站点请求锁定失败');
  } else if (kind === 'lost') {
    lastLockLostAt = Date.now();
  }
});

// ---------------------------------------------------------------- 来自 preload 的状态

ipcMain.on('@@SLUG@@:fullscreen-state', (_event, payload) => {
  htmlFullscreen = !!(payload && payload.fullscreen);
  keyboardLockAvailable = !!(payload && payload.canLock);
  escFallbackArmed = htmlFullscreen && !keyboardLockAvailable;
  updateKeepAwake();
  refreshTrayMenu();
});
