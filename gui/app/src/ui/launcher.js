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
  const btnOpenMain = document.getElementById('btnOpenMain');

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

  (async function init() {
    try {
      const s = await window.forgeGui.settings();
      setTheme((s && s.theme) || 'dark');
    } catch (_) {
      setTheme('dark');
    }
    view.refresh();
  })();

  // 窗口获得焦点时刷新一下（别人刚生成完，切过来就能看到）
  window.addEventListener('focus', () => view.refresh());
})();
