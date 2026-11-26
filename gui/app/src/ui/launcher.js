'use strict';

/**
 * 独立启动器窗口的逻辑：只管列表 + 主题 + 跳回主界面。
 * 列表本身来自 clients-view.js（和主窗口共用同一份实现）。
 */
(function () {
  const host = document.getElementById('window');
  const listEl = document.getElementById('clientList');
  const emptyEl = document.getElementById('clientEmpty');
  const subEl = document.getElementById('launcherSub');
  const btnRefresh = document.getElementById('btnRefreshClients');
  const btnTheme = document.getElementById('btnTheme');
  const btnMain = document.getElementById('btnMain');
  const btnClose = document.getElementById('btnClose');
  const btnMin = document.getElementById('btnMin');
  const btnOpenMain = document.getElementById('btnOpenMain');
  const verText = document.getElementById('verText');
  const updateText = document.getElementById('updateText');
  const btnCheckUpdate = document.getElementById('btnCheckUpdate');

  let theme = 'dark';

  function setTheme(t) {
    theme = t === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    if (btnTheme) {
      btnTheme.textContent = theme === 'dark' ? '☀' : '☾';
      btnTheme.title = theme === 'dark' ? '切换到浅色主题' : '切换到深色主题';
    }
  }

  const view = window.CloudClientsView.mount({
    hostEl: host,
    listEl,
    emptyEl,
    subEl,
  });

  if (btnRefresh) btnRefresh.addEventListener('click', () => view.refresh());
  if (btnMain) btnMain.addEventListener('click', () => window.forgeGui.openMain());
  if (btnOpenMain) btnOpenMain.addEventListener('click', () => window.forgeGui.openMain());
  if (btnClose) btnClose.addEventListener('click', () => window.close());
  if (btnMin) btnMin.addEventListener('click', () => window.forgeGui.minimize());

  if (btnTheme) {
    btnTheme.addEventListener('click', async () => {
      setTheme(theme === 'dark' ? 'light' : 'dark');
      try {
        const s = (await window.forgeGui.settings()) || {};
        s.theme = theme;
        window.forgeGui.saveSettings(s);
      } catch (_) {}
    });
  }

  let updateUrl = null;

  async function checkUpdate() {
    if (!updateText) return;
    updateText.classList.remove('new');
    updateText.textContent = '检查更新中…';
    if (btnCheckUpdate) btnCheckUpdate.disabled = true;
    try {
      const res = await window.forgeGui.checkUpdate();
      if (res && res.ok) {
        if (verText) verText.textContent = 'v' + res.current;
        if (res.newer) {
          updateUrl = res.url;
          updateText.textContent = '发现新版本 v' + res.latest + ' · 点这里';
          updateText.classList.add('new');
          updateText.title = res.url;
        } else {
          updateText.textContent = '已是最新版本';
          updateUrl = null;
        }
      } else {
        updateText.textContent = '暂时无法检查更新';
        updateUrl = null;
      }
    } catch (_) {
      updateText.textContent = '暂时无法检查更新';
    } finally {
      if (btnCheckUpdate) btnCheckUpdate.disabled = false;
    }
  }

  if (btnCheckUpdate) btnCheckUpdate.addEventListener('click', () => checkUpdate());
  if (updateText) {
    updateText.addEventListener('click', () => {
      if (updateUrl) window.forgeGui.openExternal(updateUrl);
    });
  }

  (async function init() {
    try {
      const s = await window.forgeGui.settings();
      setTheme((s && s.theme) || 'dark');
    } catch (_) {
      setTheme('dark');
    }
    try {
      const info = await window.forgeGui.info();
      if (verText && info && info.appVersion) verText.textContent = 'v' + info.appVersion;
    } catch (_) {}
    view.refresh();
    checkUpdate();
  })();

  // 窗口获得焦点时刷新一下（别人刚生成完，切过来就能看到）
  window.addEventListener('focus', () => view.refresh());
})();
