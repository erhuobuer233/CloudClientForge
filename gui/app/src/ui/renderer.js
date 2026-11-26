'use strict';

/* CloudClientForge GUI —— 渲染进程逻辑 */

const $ = (sel) => document.querySelector(sel);

const el = {
  url: $('#url'),
  urlHint: $('#urlHint'),
  name: $('#name'),
  displayName: $('#displayName'),
  out: $('#out'),
  iconUrl: $('#iconUrl'),
  probe: $('#probe'),
  allowUrls: $('#allowUrls'),
  optShortcuts: $('#optShortcuts'),
  optZip: $('#optZip'),
  optSkipBuild: $('#optSkipBuild'),
  optForce: $('#optForce'),
  btnAdvanced: $('#btnAdvanced'),
  advanced: $('#advanced'),
  btnPickOut: $('#btnPickOut'),
  btnUseDefault: $('#btnUseDefault'),
  btnGenerate: $('#btnGenerate'),
  btnCancel: $('#btnCancel'),
  log: $('#log'),
  steps: $('#steps'),
  statusPill: $('#statusPill'),
  envbar: $('#envbar'),
  envText: $('#envText'),
  btnInstallToolchain: $('#btnInstallToolchain'),
  envProgress: $('#envProgress'),
  result: $('#result'),
  resultPath: $('#resultPath'),
  btnOpenOut: $('#btnOpenOut'),
  btnCopyPath: $('#btnCopyPath'),
  btnAgain: $('#btnAgain'),
  btnMin: $('#btnMin'),
  btnClose: $('#btnClose'),
  btnTheme: $('#btnTheme'),
  btnLauncher: $('#btnLauncher'),
};

const state = {
  theme: 'dark',
  running: false,
  success: false,
  targetDir: '',
  exePath: '',
  zipPath: '',
  lineCount: 0,
};

// ------------------------------------------------------------------ 设置

let saveTimer = null;

function collectSettings() {
  return {
    url: el.url.value.trim(),
    name: el.name.value.trim(),
    displayName: el.displayName.value.trim(),
    out: el.out.value.trim(),
    iconUrl: el.iconUrl.value.trim(),
    probe: el.probe.value.trim(),
    allowUrls: el.allowUrls.value.trim(),
    shortcuts: el.optShortcuts.checked,
    zip: el.optZip.checked,
    skipBuild: el.optSkipBuild.checked,
    force: el.optForce.checked,
    advancedOpen: el.btnAdvanced.classList.contains('open'),
    theme: state.theme,
  };
}

/** 深色 / 浅色切换（写 <html data-theme>，所有颜色走 CSS 变量） */
function setTheme(t) {
  const theme = t === 'light' ? 'light' : 'dark';
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  if (el.btnTheme) {
    el.btnTheme.textContent = theme === 'dark' ? '☀' : '☾';
    el.btnTheme.title = theme === 'dark' ? '切换到浅色主题' : '切换到深色主题';
  }
}

function saveSettingsSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => window.forgeGui.saveSettings(collectSettings()), 350);
}

function applySettings(s) {
  if (!s) return;
  if (s.url) el.url.value = s.url;
  el.name.value = s.name || '';
  el.displayName.value = s.displayName || '';
  el.out.value = s.out || '';
  el.iconUrl.value = s.iconUrl || '';
  el.probe.value = s.probe || '';
  el.allowUrls.value = s.allowUrls || '';
  el.optShortcuts.checked = !!s.shortcuts;
  el.optZip.checked = s.zip !== false;
  el.optSkipBuild.checked = !!s.skipBuild;
  el.optForce.checked = !!s.force;
  if (s.advancedOpen) toggleAdvanced(true);
  setTheme(s.theme || 'dark');
}

// ------------------------------------------------------------------ 默认输出目录

let forgeInfoCache = null;

function hostOf(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  try {
    return new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s).host;
  } catch (_) {
    return '';
  }
}

/** 与 forge.ps1 的默认规则一致：<生成器目录>\Cloudgame\<网址域名> */
function defaultOutPath() {
  if (!forgeInfoCache || !forgeInfoCache.root) return '';
  const host = hostOf(el.url.value);
  return host ? forgeInfoCache.root + '\\Cloudgame\\' + host : '';
}

function updateOutHint() {
  const d = defaultOutPath();
  el.out.placeholder = d ? '默认：' + d : '默认：Cloudgame\\网址域名';
  el.out.title = d ? '留空就输出到 ' + d : '';
}

// ------------------------------------------------------------------ 高级选项

function toggleAdvanced(open) {
  const next = open === undefined ? !el.btnAdvanced.classList.contains('open') : open;
  el.btnAdvanced.classList.toggle('open', next);
  el.advanced.classList.toggle('hidden', !next);
  el.btnAdvanced.querySelector('span').textContent = next ? '收起高级选项' : '高级选项';
}

// ------------------------------------------------------------------ 日志

function lineClass(line) {
  if (/^==\s/.test(line)) return 'l-step';
  if (/^\s*\[x\]/.test(line) || /失败|error|Error/.test(line)) return 'l-err';
  if (/完成|✅/.test(line)) return 'l-ok';
  if (/^\s{3,}/.test(line)) return 'l-dim';
  return '';
}

function appendLog(line) {
  if (state.lineCount > 3000) {
    // 避免超长日志拖慢界面：过半时清掉前半段
    while (el.log.firstChild && state.lineCount > 1500) {
      el.log.removeChild(el.log.firstChild);
      state.lineCount -= 1;
    }
  }
  const div = document.createElement('div');
  const cls = lineClass(line);
  if (cls) div.className = cls;
  div.textContent = line || ' ';
  el.log.appendChild(div);
  state.lineCount += 1;
  el.log.scrollTop = el.log.scrollHeight;
}

function clearLog() {
  el.log.textContent = '';
  state.lineCount = 0;
}

// ------------------------------------------------------------------ 步骤 / 状态

const stepEls = () => Array.from(el.steps.querySelectorAll('.step'));

function setStep(n) {
  for (const s of stepEls()) {
    const i = Number(s.dataset.step);
    s.classList.toggle('done', i < n);
    s.classList.toggle('active', i === n);
  }
}

function finishSteps() {
  for (const s of stepEls()) {
    s.classList.add('done');
    s.classList.remove('active');
  }
}

function resetSteps() {
  for (const s of stepEls()) s.classList.remove('done', 'active');
}

function setStatus(kind, text) {
  el.statusPill.className = 'pill ' + kind;
  el.statusPill.textContent = text;
}

// ------------------------------------------------------------------ 结果

function showResult(path, note) {
  state.success = true;
  el.resultPath.textContent = path || '（见日志）';
  el.result.classList.add('show');
  if (note) {
    el.resultPath.textContent = path ? path : note;
  }
}

function hideResult() {
  state.success = false;
  el.result.classList.remove('show');
}

// ------------------------------------------------------------------ 生成

function isProbablyUrl(v) {
  const s = String(v || '').trim();
  if (!s) return false;
  if (/^https?:\/\//i.test(s)) return true;
  return /^[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(s);
}

function validateUrl(showHint) {
  const v = el.url.value;
  if (!v.trim()) {
    if (showHint) {
      el.urlHint.textContent = '请先粘贴云游戏网页地址';
      el.urlHint.classList.add('bad');
    }
    return false;
  }
  if (!isProbablyUrl(v)) {
    if (showHint) {
      el.urlHint.textContent = '网址格式看起来不对，需要 http(s):// 开头或至少包含域名';
      el.urlHint.classList.add('bad');
    }
    return false;
  }
  el.urlHint.textContent = '粘贴云游戏网页地址，例如 https://example.com/cloudgame';
  el.urlHint.classList.remove('bad');
  return true;
}

function setRunning(running) {
  state.running = running;
  el.btnGenerate.disabled = running;
  el.btnGenerate.querySelector('span').textContent = running ? '正在生成…' : '生成客户端';
  el.btnCancel.classList.toggle('hidden', !running);
  for (const k of ['url', 'name', 'displayName', 'out', 'iconUrl', 'probe', 'allowUrls']) {
    el[k].disabled = running || false;
  }
  el.btnPickOut.disabled = running;
  for (const k of ['optShortcuts', 'optZip', 'optSkipBuild', 'optForce']) el[k].disabled = running;
}

async function generate() {
  if (state.running) return;
  if (!validateUrl(true)) return;
  hideResult();
  clearLog();
  resetSteps();
  setStatus('running', '生成中');
  setRunning(true);

  const opts = {
    url: el.url.value.trim(),
    name: el.name.value.trim() || undefined,
    displayName: el.displayName.value.trim() || undefined,
    out: el.out.value.trim() || undefined,
    iconUrl: el.iconUrl.value.trim() || undefined,
    probe: el.probe.value.trim() || undefined,
    allowUrls: el.allowUrls.value.trim() || undefined,
    shortcuts: el.optShortcuts.checked,
    skipZip: !el.optZip.checked,
    skipBuild: el.optSkipBuild.checked,
    force: el.optForce.checked,
  };

  window.forgeGui.saveSettings(collectSettings());
  const res = await window.forgeGui.start(opts);
  if (!res || !res.ok) {
    setRunning(false);
    setStatus('error', '未开始');
    appendLog('[x] ' + ((res && res.error) || '启动失败'));
    if (res && res.error === 'busy') {
      /* 已经在跑 */
    }
  }
}

// ------------------------------------------------------------------ 事件绑定

el.btnGenerate.addEventListener('click', generate);
el.btnCancel.addEventListener('click', async () => {
  appendLog('[GUI] 正在取消…');
  await window.forgeGui.cancel();
});

el.url.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') generate();
});
el.url.addEventListener('input', () => {
  validateUrl(false);
  updateOutHint();
  saveSettingsSoon();
});

for (const key of ['name', 'displayName', 'out', 'iconUrl', 'probe', 'allowUrls']) {
  el[key].addEventListener('input', saveSettingsSoon);
}
for (const key of ['optShortcuts', 'optZip', 'optSkipBuild', 'optForce']) {
  el[key].addEventListener('change', saveSettingsSoon);
}

el.btnAdvanced.addEventListener('click', () => {
  toggleAdvanced();
  saveSettingsSoon();
});

el.btnUseDefault.addEventListener('click', () => {
  el.out.value = '';
  el.out.focus();
  updateOutHint();
  saveSettingsSoon();
});

el.btnPickOut.addEventListener('click', async () => {
  const dir = await window.forgeGui.pickDir();
  if (dir) {
    el.out.value = dir;
    saveSettingsSoon();
  }
});

el.btnOpenOut.addEventListener('click', () => {
  const p = state.exePath || state.targetDir;
  if (p) window.forgeGui.openPath(p);
});
el.btnCopyPath.addEventListener('click', () => {
  const p = state.exePath || state.targetDir;
  if (p) window.forgeGui.copy(p);
});
el.btnAgain.addEventListener('click', () => {
  hideResult();
  clearLog();
  resetSteps();
  setStatus('idle', '空闲');
  el.url.focus();
  el.url.select();
});

if (el.btnInstallToolchain) el.btnInstallToolchain.addEventListener('click', () => installToolchain());
if (window.forgeGui.onToolchainStage) {
  window.forgeGui.onToolchainStage((payload) => {
    const stage = payload && payload.stage;
    if (stage === 'npm') {
      showProgress(true);
      paintProgress(payload.percent || 8);
      startProgressTicker(40);
    } else if (stage === 'runtime') {
      showProgress(true);
      paintProgress(55);
      startProgressTicker(95);
    } else if (stage === 'done') {
      paintProgress(100);
      setTimeout(() => showProgress(false), 800);
    }
  });
}
if (window.forgeGui.onToolchainLog) {
  window.forgeGui.onToolchainLog((text) => {
    String(text || '')
      .split(/\r?\n/)
      .map((s) => s.replace(/\s+$/, ''))
      .filter((s) => s.length)
      .forEach((line) => appendLog(line));
  });
}

el.btnMin.addEventListener('click', () => window.forgeGui.minimize());
el.btnClose.addEventListener('click', () => window.forgeGui.close());

// ------------------------------------------------------------------ 接收日志

window.forgeGui.onLog(({ line }) => {
  appendLog(line);

  let m = line.match(/^==\s*(\d)\/6/);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 6) setStep(n);
    if (n === 0) resetSteps();
    if (n === 6) {
      /* 收尾：保持第 6 步 active，直到成功 */
    }
  }

  m = line.match(/^\s+目录\s*[:：]\s*(.+)$/);
  if (m) {
    state.targetDir = m[1].trim();
  }

  m = line.match(/^\s+exe:\s*(.+?)\s+\(([\d.]+) MB\)/);
  if (m) {
    state.exePath = m[1].trim();
  }

  m = line.match(/^\s+zip:\s*(.+?)\s+\(([\d.]+) MB\)/);
  if (m) {
    state.zipPath = m[1].trim();
  }

  if (/^==\s*完成/.test(line)) {
    finishSteps();
    setStatus('done', '完成');
    const target = state.exePath || state.targetDir;
    if (target) showResult(target);
  }

  if (/^\s*\[x\]/.test(line)) {
    setStatus('error', '失败');
    finishSteps();
  }
});

window.forgeGui.onExit(({ code }) => {
  setRunning(false);
  if (state.success) {
    setStatus('done', '完成');
    if (!el.result.classList.contains('show') && (state.exePath || state.targetDir)) {
      showResult(state.exePath || state.targetDir);
    }
    appendLog('');
    appendLog('== 全部完成，可以双击 exe 试用了。');
  } else if (code === 0) {
    setStatus('done', '完成');
    if (state.targetDir) showResult(state.targetDir);
  } else {
    setStatus('error', '已停止');
    appendLog('[x] 生成未完成（退出码 ' + code + '），请检查上面的日志。');
  }
});

// ------------------------------------------------------------------ 工具链状态

/**
 * 三种状态分开说，别再把「还没装」写成「不完整 / 打包会失败」：
 *   - 发布包本来就不带 toolchain\node_modules（450MB）
 *   - 首次生成时 forge 会自动装（npm install + Electron 运行时）
 */
function renderEnv(info) {
  const btn = el.btnInstallToolchain;
  if (!info || !info.ok) {
    el.envbar.className = 'envbar warn';
    el.envText.innerHTML =
      '<code>找不到 forge.ps1：请把 CloudClientForge.exe 放在 CloudClientForge 目录里（和 forge.ps1、toolchain 同级）</code>' +
      (info && info.appVersion ? ' · v' + info.appVersion : '');
    el.btnGenerate.disabled = true;
    if (btn) btn.classList.add('hidden');
    return;
  }

  const ver = info.appVersion ? ' · v' + info.appVersion : '';
  el.btnGenerate.disabled = false;

  if (!info.toolchain) {
    el.envbar.className = 'envbar warn';
    el.envText.innerHTML =
      '工具链未安装 · 首次生成会自动下载（约 1~2 分钟，需联网） · <code>' + info.root + '</code>' + ver;
    if (btn) btn.classList.remove('hidden');
    return;
  }

  if (!info.electronRuntime) {
    el.envbar.className = 'envbar warn';
    el.envText.innerHTML =
      'Electron 运行时缺失 · 首次生成会自动补下载（约 100MB） · <code>' + info.root + '</code>' + ver;
    if (btn) btn.classList.remove('hidden');
    return;
  }

  el.envbar.className = 'envbar ok';
  el.envText.innerHTML = '工具链就绪 · Electron <code>' + info.electron + '</code> · <code>' + info.root + '</code>' + ver;
  if (btn) btn.classList.add('hidden');
}

let progressTimer = null;
let progressCap = 0;

function paintProgress(percent) {
  const wrap = el.envProgress;
  if (!wrap) return;
  const bar = wrap.querySelector('b');
  if (bar) bar.style.width = Math.max(0, Math.min(100, percent)) + '%';
}

/** 阶段事件驱动：npm 阶段爬到 40%，Electron 运行时阶段爬到 95%，完成 100% */
function startProgressTicker(cap) {
  progressCap = cap;
  if (progressTimer) clearInterval(progressTimer);
  progressTimer = setInterval(() => {
    const wrap = el.envProgress;
    const bar = wrap && wrap.querySelector('b');
    if (!bar) return;
    const cur = parseFloat(bar.style.width) || 0;
    if (cur >= progressCap - 0.5) return;
    paintProgress(cur + Math.max(0.25, (progressCap - cur) * 0.06));
  }, 400);
}

function showProgress(show) {
  if (!el.envProgress) return;
  el.envProgress.classList.toggle('hidden', !show);
  if (!show) {
    if (progressTimer) clearInterval(progressTimer);
    progressTimer = null;
    paintProgress(0);
  }
}

async function installToolchain() {
  const btn = el.btnInstallToolchain;
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  btn.textContent = '安装中…';
  el.envbar.className = 'envbar warn';
  el.envText.textContent = '正在安装工具链（npm install + Electron 运行时）…';
  appendLog('');
  appendLog('== 安装工具链（首次约 1~2 分钟，日志会实时输出）==');

  showProgress(true);
  paintProgress(4);
  startProgressTicker(40);

  const res = await window.forgeGui.installToolchain();
  showProgress(false);
  btn.disabled = false;
  btn.textContent = '现在安装';

  if (res && res.ok) {
    appendLog('[ok] 工具链安装完成。');
    renderEnv(res.info || (await window.forgeGui.info()));
  } else {
    appendLog('[x] 工具链安装失败（exit ' + ((res && res.code) || '?') + '），看上面的日志。');
    el.envbar.className = 'envbar warn';
    el.envText.innerHTML = '工具链安装失败 · 也可手动在 <code>toolchain</code> 里执行 <code>npm install</code>';
    if (btn) btn.classList.remove('hidden');
  }
}

// ------------------------------------------------------------------ 启动

(async function init() {
  const info = await window.forgeGui.info();

  renderEnv(info);

  forgeInfoCache = info;
  applySettings(await window.forgeGui.settings());

  // 老配置里可能存过「生成器自己的目录」或它的上级（会把工具目录搞乱），直接清掉用默认
  const norm = (p) => String(p || '').replace(/[\\/]+$/, '').toLowerCase();
  const savedOut = norm(el.out.value);
  if (savedOut && info && info.ok && info.root) {
    if (savedOut === norm(info.root)) {
      el.out.value = '';
    }
  }

  updateOutHint();
  validateUrl(false);
  appendLog('把云游戏网址粘贴到左边，点「生成客户端」即可。');
  if (el.url.value.trim()) el.url.focus();
  el.url.addEventListener('blur', () => validateUrl(false));

  window.forgeGui.onLog(() => {});
})();

// ------------------------------------------------------------------ 启动器视图（主窗口内）

(function initShell() {
  const tabs = Array.from(document.querySelectorAll('.tab'));
  const views = {
    generate: document.getElementById('view-generate'),
    launcher: document.getElementById('view-launcher'),
  };
  const listEl = document.getElementById('clientList');
  const emptyEl = document.getElementById('clientEmpty');
  const subEl = document.getElementById('launcherSub');
  const countEl = document.getElementById('clientCount');
  const btnRefresh = document.getElementById('btnRefreshClients');
  const btnOpenDir = document.getElementById('btnOpenClientsDir');
  const btnGo = document.getElementById('btnGoGenerate');

  let clientView = null;
  if (listEl && window.CloudClientsView) {
    clientView = window.CloudClientsView.mount({
      hostEl: document.getElementById('window'),
      listEl,
      emptyEl,
      subEl,
      countEl,
    });
  }

  function switchView(name) {
    for (const tab of tabs) tab.classList.toggle('active', tab.dataset.view === name);
    for (const key of Object.keys(views)) {
      if (views[key]) views[key].classList.toggle('active', key === name);
    }
    if (name === 'launcher' && clientView) clientView.refresh();
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  }

  if (btnRefresh && clientView) btnRefresh.addEventListener('click', () => clientView.refresh());

  if (btnOpenDir) {
    btnOpenDir.addEventListener('click', async () => {
      const info = forgeInfoCache || (await window.forgeGui.info());
      if (info && info.ok) {
        const ok = await window.forgeGui.openPath(info.root + '\\Cloudgame');
        if (!ok && clientView) clientView.toast('目录还不存在，先生成一个客户端', 'error');
      }
    });
  }

  if (btnGo) btnGo.addEventListener('click', () => switchView('generate'));

  // 生成结束后刷新列表与角标
  window.forgeGui.onExit(() => {
    if (clientView) clientView.refresh();
  });

  // 主题切换
  setTheme(state.theme);
  if (el.btnTheme) {
    el.btnTheme.addEventListener('click', () => {
      setTheme(state.theme === 'dark' ? 'light' : 'dark');
      window.forgeGui.saveSettings(collectSettings());
    });
  }

  // 独立启动器窗口
  if (el.btnLauncher) {
    el.btnLauncher.addEventListener('click', () => window.forgeGui.openLauncher());
  }

  if (clientView) clientView.refresh();
})();