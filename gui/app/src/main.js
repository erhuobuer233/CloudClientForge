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
  Menu,
  Tray,
  nativeImage,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const PRODUCT = 'CloudClientForge';
const APP_DIR = path.join(__dirname, '..');
const APP_VERSION = app.getVersion();

// 单实例：重复双击 exe 时聚焦已有窗口，而不是再开一个（以前会叠出好几个一样的窗口）
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });
}

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
    return { ok: false, root: null, appVersion: APP_VERSION, toolchain: false, electron: null };
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
    appVersion: APP_VERSION,
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
  mainWindow.on('close', (e) => {
    if (tray && !app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

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

// ---------------------------------------------------------------- 启动器窗口 / 托盘

let launcherWindow = null;
let tray = null;

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** 独立的小启动面板：不生成也能当「游戏启动器」用 */
function createLauncherWindow() {
  if (launcherWindow && !launcherWindow.isDestroyed()) {
    launcherWindow.show();
    launcherWindow.focus();
    return;
  }

  launcherWindow = new BrowserWindow({
    width: 520,
    height: 660,
    minWidth: 420,
    minHeight: 460,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    roundedCorners: true,
    hasShadow: true,
    resizable: true,
    title: 'CloudClientForge 启动器',
    icon: path.join(APP_DIR, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  launcherWindow.loadFile(path.join(__dirname, 'ui', 'launcher.html'));
  launcherWindow.once('ready-to-show', () => launcherWindow.show());
  launcherWindow.on('closed', () => {
    launcherWindow = null;
  });
}

function createTray() {
  try {
    const iconPath = path.join(APP_DIR, 'assets', 'icon.ico');
    tray = new Tray(iconPath);
    tray.setToolTip('CloudClientForge');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '打开启动器', click: () => createLauncherWindow() },
        { label: '显示主界面', click: () => showMainWindow() },
        { type: 'separator' },
        { label: '退出', click: () => { app.isQuitting = true; app.quit(); } },
      ])
    );
    tray.on('click', () => createLauncherWindow());
    tray.on('double-click', () => showMainWindow());
  } catch (_) {
    tray = null; // 托盘不可用不影响主流程
  }
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

// ---------------------------------------------------------------- 已生成的客户端（启动器）

/** 扫描 <forgeRoot>\Cloudgame\<host>\*.exe，返回可启动的客户端列表 */
function listClients() {
  if (!forgeRoot) return [];
  const root = path.join(forgeRoot, 'Cloudgame');
  let hosts = [];
  try {
    hosts = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch (_) {
    return [];
  }

  const items = [];
  for (const h of hosts) {
    const dir = path.join(root, h.name);
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.exe'));
    } catch (_) {
      continue;
    }
    for (const f of files) {
      const exePath = path.join(dir, f);
      let st = null;
      try {
        st = fs.statSync(exePath);
      } catch (_) {
        st = null;
      }
      let icon = null;
      try {
        const iconFile = path.join(dir, 'app', 'assets', 'icon.png');
        if (fs.existsSync(iconFile)) {
          icon = 'data:image/png;base64,' + fs.readFileSync(iconFile).toString('base64');
        }
      } catch (_) {
        icon = null;
      }
      items.push({
        host: h.name,
        name: f.replace(/\.exe$/i, ''),
        exePath,
        dir,
        size: st ? st.size : 0,
        mtime: st ? st.mtimeMs : 0,
        icon,
      });
    }
  }
  items.sort((a, b) => b.mtime - a.mtime);
  return items;
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

ipcMain.handle('gui:list-clients', () => listClients());

ipcMain.handle('gui:open-launcher', () => {
  createLauncherWindow();
  return true;
});

ipcMain.handle('gui:show-main', () => {
  showMainWindow();
  return true;
});

// ---- 客户端：删除 / 重命名 / 换图标（只允许动 Cloudgame 目录内的东西）----

function clientsGuard(p) {
  const root = forgeRoot ? path.join(forgeRoot, 'Cloudgame') : null;
  if (!root) throw new Error('没找到生成器目录');
  const base = path.resolve(root) + path.sep;
  const target = path.resolve(String(p || ''));
  if (!target.toLowerCase().startsWith(base.toLowerCase()) || target === path.resolve(root)) {
    throw new Error('路径不在 Cloudgame 目录内，已拒绝');
  }
  return target;
}

ipcMain.handle('gui:client-delete', (_e, exePath) => {
  try {
    const p = clientsGuard(exePath);
    const dir = path.dirname(p);
    fs.rmSync(dir, { recursive: true, force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('gui:client-rename', (_e, exePath, newName) => {
  try {
    const p = clientsGuard(exePath);
    const dir = path.dirname(p);
    const oldBase = path.basename(p, path.extname(p));
    const clean = String(newName || '')
      .replace(/[\\/:*?"<>|]/g, '')
      .trim()
      .slice(0, 60);
    if (!clean) return { ok: false, error: '名字不能为空' };
    if (clean === oldBase) return { ok: false, error: '名字没变化' };
    const target = path.join(dir, clean + '.exe');
    if (fs.existsSync(target)) return { ok: false, error: '同名文件已存在' };
    fs.renameSync(p, target);

    // 同目录的 Start *.cmd 里引用了 exe 名，一起改
    let cmds = [];
    try {
      cmds = fs.readdirSync(dir).filter((n) => /^Start .+\.cmd$/i.test(n));
    } catch (_) {}
    for (const f of cmds) {
      const fp = path.join(dir, f);
      try {
        const txt = fs.readFileSync(fp, 'utf8');
        if (txt.includes(oldBase)) {
          fs.writeFileSync(fp, txt.split(oldBase).join(clean), 'utf8');
        }
        const next = 'Start ' + clean + '.cmd';
        if (f !== next) fs.renameSync(fp, path.join(dir, next));
      } catch (_) {}
    }
    return { ok: true, exePath: target, name: clean };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('gui:client-set-icon', async (_e, exePath) => {
  try {
    const p = clientsGuard(exePath);
    const dir = path.dirname(p);
    const assets = path.join(dir, 'app', 'assets');
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '选择图标（建议 256×256 的 PNG）',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'ico', 'jpg', 'jpeg', 'bmp'] }],
    });
    if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true };
    const script = path.join(forgeRoot, 'lib', 'make-icon.ps1');
    if (!fs.existsSync(script)) return { ok: false, error: '缺少 lib/make-icon.ps1' };
    if (!fs.existsSync(assets)) return { ok: false, error: '这个客户端没有 app/assets 目录' };

    const code = await new Promise((resolve) => {
      const pargs = [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        '-Source',
        res.filePaths[0],
        '-OutDir',
        assets,
      ];
      const cp = spawn('powershell.exe', pargs, { windowsHide: true, stdio: 'ignore' });
      cp.on('error', () => resolve(-1));
      cp.on('exit', (c) => resolve(c));
    });
    if (code !== 0) return { ok: false, error: '图标转换失败（exit ' + code + '）' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('gui:launch-client', async (_e, exePath) => {
  const p = String(exePath || '');
  if (!p) return { ok: false, error: '缺少路径' };
  if (!fs.existsSync(p)) return { ok: false, error: '文件不存在：' + p };
  try {
    const err = await shell.openPath(p);
    return err ? { ok: false, error: err } : { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
});

ipcMain.handle('gui:reveal', (_e, target) => {
  try {
    shell.showItemInFolder(String(target || ''));
    return true;
  } catch (_) {
    return false;
  }
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
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (tray) mainWindow.hide();
    else app.quit();
  } else {
    app.quit();
  }
});

// ---------------------------------------------------------------- 启动

if (!singleInstance) {
  // 已经有一个 CloudClientForge 在跑，本进程直接退出
} else app.whenReady().then(() => {
  forgeRoot = findForgeRoot();
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!tray) app.quit();
});
app.on('before-quit', () => {
  app.isQuitting = true;
  killChild();
});
