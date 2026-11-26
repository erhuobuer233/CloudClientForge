// CloudClientForge GUI —— 主进程
//
// 这是个「外壳」：界面负责收集参数、展示日志；真正的生成逻辑还是根目录的 forge.ps1，
// 这样 CLI 和 GUI 共用同一套实现，不会出现两份逻辑对不上的情况。
//
// 打包成单文件时，exe 里跑的是缓存目录里的副本，所以「forge 根目录」通过启动器
// 传进来的环境变量 CLOUDFORGE_HOME 定位（见 _build/launcher-gui.cs）。

const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  dialog,
  screen,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const PRODUCT = 'CloudClientForge';
const APP_DIR = path.join(__dirname, '..');

let mainWindow = null;
let child = null;

// ---------------------------------------------------------------- 定位 forge 根目录

function findForgeRoot() {
  const candidates = [];
  if (process.env.CLOUDFORGE_HOME) candidates.push(process.env.CLOUDFORGE_HOME);
  candidates.push(path.dirname(process.execPath));
  candidates.push(APP_DIR);
  candidates.push(path.join(APP_DIR, '..', '..', '..'));

  for (const base of candidates) {
    try {
      const p = path.resolve(base);
      if (fs.existsSync(path.join(p, 'forge.ps1'))) return p;
    } catch (_) {
      /* 忽略 */
    }
  }
  return null;
}

let forgeRoot = null;

function forgeInfo() {
  const root = forgeRoot;
  if (!root) {
    return { ok: false, root: null, toolchain: false, electron: null };
  }
  const tcElectron = path.join(root, 'toolchain', 'node_modules', 'electron', 'package.json');
  let electron = null;
  try {
    electron = JSON.parse(fs.readFileSync(tcElectron, 'utf8')).version || null;
  } catch (_) {
    electron = null;
  }
  return {
    ok: true,
    root,
    toolchain: !!electron,
    electron,
    templates: fs.existsSync(path.join(root, 'lib', 'template', 'main.js')),
  };
}

// ---------------------------------------------------------------- 窗口

function createWindow() {
  // 按屏幕可用区域自适应，1366×768 这类小屏也不会超出
  const area = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1060, Math.max(880, area.width - 40));
  const height = Math.min(780, Math.max(600, area.height - 40));

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 860,
    minHeight: 600,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    roundedCorners: true,
    hasShadow: true,
    resizable: true,
    title: PRODUCT,
    icon: path.join(APP_DIR, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // 开发自测：设了 CLOUDFORGE_AUTOTEST=<url> 时自动填表并点「生成」（正常使用不会触发）
  if (process.env.CLOUDFORGE_AUTOTEST) {
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const url = process.env.CLOUDFORGE_AUTOTEST;
      const out = process.env.CLOUDFORGE_AUTOTEST_OUT || '';
      mainWindow.webContents
        .executeJavaScript(
          `(() => {
             const u = document.getElementById('url');
             u.value = ${JSON.stringify(url)};
             u.dispatchEvent(new Event('input'));
             const o = document.getElementById('out');
             if (o) o.value = ${JSON.stringify(out)};
             document.getElementById('btnGenerate').click();
             return true;
           })()`,
          true
        )
        .catch(() => {});
    }, 1800);
  }
  mainWindow.on('closed', () => {
    mainWindow = null;
    killChild();
  });
}

function killChild() {
  if (!child) return;
  try {
    child.kill();
  } catch (_) {}
  child = null;
}

// ---------------------------------------------------------------- 设置

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch (_) {
    return {};
  }
}

function writeSettings(obj) {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(obj, null, 2), 'utf8');
  } catch (_) {}
}

// ---------------------------------------------------------------- 生成任务

function buildArgs(opts) {
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(forgeRoot, 'forge.ps1'),
    '-Url',
    String(opts.url || '').trim(),
  ];
  const add = (flag, value) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      args.push(flag, String(value).trim());
    }
  };
  add('-Name', opts.name);
  add('-DisplayName', opts.displayName);
  add('-Out', opts.out);
  add('-IconUrl', opts.iconUrl);
  add('-ProbeSelectors', opts.probe);
  if (opts.allowUrls) add('-AllowUrls', opts.allowUrls);
  if (opts.shortcuts) args.push('-Shortcuts');
  if (opts.skipZip) args.push('-SkipZip');
  if (opts.skipBuild) args.push('-SkipBuild');
  if (opts.force) args.push('-Force');
  return args;
}

function startForge(opts, event) {
  if (child) {
    event.sender.send('forge:log', { line: '[GUI] 已经有一个生成任务在跑。', kind: 'warn' });
    return { ok: false, error: 'busy' };
  }
  if (!forgeRoot) {
    return { ok: false, error: '找不到 forge.ps1（请把 CloudClientForge.exe 放在 CloudClientForge 目录里）' };
  }
  if (!opts || !opts.url || !/^https?:\/\/|^[\w.-]+\.[a-z]{2,}/i.test(String(opts.url).trim())) {
    return { ok: false, error: '请输入正确的网址（例如 https://xxx.com/cloudgame）' };
  }

  const args = buildArgs(opts);
  const sender = event.sender;

  child = spawn('powershell.exe', args, {
    cwd: forgeRoot,
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  });

  let buf = '';
  const flush = (chunk) => {
    buf += chunk;
    const parts = buf.split(/\r?\n/);
    buf = parts.pop();
    for (const line of parts) {
      if (sender.isDestroyed()) return;
      sender.send('forge:log', { line });
    }
  };

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', flush);
  child.stderr.on('data', flush);

  child.on('error', (err) => {
    if (!sender.isDestroyed()) sender.send('forge:log', { line: '[GUI] 启动 PowerShell 失败：' + err.message });
  });

  child.on('close', (code) => {
    if (buf.trim()) {
      for (const line of buf.split(/\r?\n/)) {
        if (!sender.isDestroyed()) sender.send('forge:log', { line });
      }
      buf = '';
    }
    child = null;
    if (!sender.isDestroyed()) sender.send('forge:exit', { code });
  });

  return { ok: true };
}

// ---------------------------------------------------------------- IPC

ipcMain.handle('gui:info', () => {
  forgeRoot = forgeRoot || findForgeRoot();
  return forgeInfo();
});

ipcMain.handle('gui:settings', () => readSettings());
ipcMain.handle('gui:save-settings', (_e, obj) => {
  writeSettings(obj || {});
  return true;
});

ipcMain.handle('forge:start', (event, opts) => startForge(opts, event));

ipcMain.handle('forge:cancel', () => {
  if (!child) return false;
  const pid = child.pid;
  killChild();
  if (pid) {
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    } catch (_) {}
  }
  return true;
});

ipcMain.handle('gui:pick-dir', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '选择输出目录',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

ipcMain.handle('gui:open-path', async (_e, p) => {
  if (!p) return false;
  try {
    const err = await shell.openPath(p);
    return !err;
  } catch (_) {
    return false;
  }
});

ipcMain.handle('gui:copy', (_e, text) => {
  const { clipboard } = require('electron');
  clipboard.writeText(String(text || ''));
  return true;
});

ipcMain.on('gui:minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('gui:close', () => {
  killChild();
  if (mainWindow) mainWindow.close();
  app.quit();
});

// ---------------------------------------------------------------- 启动

app.whenReady().then(() => {
  forgeRoot = findForgeRoot();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', killChild);
