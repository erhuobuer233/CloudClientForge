'use strict';

/**
 * 客户端列表视图（主窗口的「启动器」标签 + 独立启动器窗口共用）
 *
 * 用法：
 *   const view = window.CloudClientsView.mount({
 *     listEl, emptyEl, subEl, countEl, onEmptyAction, onToast,
 *   });
 *   view.refresh();
 */
(function () {
  function fmtSize(b) {
    if (!b) return '';
    if (b >= 1024 * 1024 * 1024) return (b / 1024 / 1024 / 1024).toFixed(1) + ' GB';
    if (b >= 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
    return Math.round(b / 1024) + ' KB';
  }

  function fmtDate(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /** 深色/浅色都用的轻提示 */
  function makeToast(host) {
    let el = null;
    let timer = null;
    return function toast(text, kind) {
      if (!el) {
        el = document.createElement('div');
        el.className = 'toast';
        host.appendChild(el);
      }
      el.textContent = text;
      el.className = 'toast show' + (kind === 'error' ? ' error' : '');
      clearTimeout(timer);
      timer = setTimeout(() => {
        el.className = 'toast';
      }, 2400);
    };
  }

  /** 圆角确认框 */
  function askConfirm(host, opts) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'overlay';
      overlay.innerHTML = `
        <div class="dialog" role="dialog" aria-modal="true">
          <div class="dialog-title"></div>
          <div class="dialog-body"></div>
          <div class="dialog-actions">
            <button class="mini-btn" data-act="cancel" type="button">取消</button>
            <button class="mini-btn danger-solid" data-act="ok" type="button"></button>
          </div>
        </div>`;
      overlay.querySelector('.dialog-title').textContent = opts.title || '确认';
      overlay.querySelector('.dialog-body').textContent = opts.body || '';
      overlay.querySelector('[data-act="ok"]').textContent = opts.okText || '确定';

      const close = (val) => {
        overlay.classList.remove('show');
        setTimeout(() => overlay.remove(), 160);
        resolve(val);
      };
      overlay.addEventListener('click', (e) => {
        const act = e.target && e.target.dataset && e.target.dataset.act;
        if (act === 'cancel') close(false);
        if (act === 'ok') close(true);
        if (e.target === overlay) close(false);
      });
      host.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('show'));
      overlay.querySelector('[data-act="cancel"]').focus();
    });
  }

  /** 圆角输入框（重命名） */
  function askText(host, opts) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'overlay';
      overlay.innerHTML = `
        <div class="dialog" role="dialog" aria-modal="true">
          <div class="dialog-title"></div>
          <div class="dialog-sub"></div>
          <input class="input dialog-input" spellcheck="false" />
          <div class="dialog-actions">
            <button class="mini-btn" data-act="cancel" type="button">取消</button>
            <button class="mini-btn strong" data-act="ok" type="button">保存</button>
          </div>
        </div>`;
      overlay.querySelector('.dialog-title').textContent = opts.title || '重命名';
      overlay.querySelector('.dialog-sub').textContent = opts.sub || '';
      const input = overlay.querySelector('.dialog-input');
      input.value = opts.value || '';

      const close = (val) => {
        overlay.classList.remove('show');
        setTimeout(() => overlay.remove(), 160);
        resolve(val);
      };
      const submit = () => {
        const v = input.value.trim();
        if (!v) return;
        close(v);
      };
      overlay.addEventListener('click', (e) => {
        const act = e.target && e.target.dataset && e.target.dataset.act;
        if (act === 'cancel') close(null);
        if (act === 'ok') submit();
        if (e.target === overlay) close(null);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
        if (e.key === 'Escape') close(null);
      });
      host.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('show'));
      input.focus();
      input.select();
    });
  }

  function mount(opts) {
    const host = opts.hostEl || document.getElementById('window');
    const listEl = opts.listEl;
    const emptyEl = opts.emptyEl;
    const subEl = opts.subEl;
    const countEl = opts.countEl;
    const toast = opts.onToast || makeToast(host);

    let refreshing = false;
    let openMenu = null;

    function closeMenu() {
      if (openMenu) {
        openMenu.remove();
        openMenu = null;
      }
    }

    document.addEventListener('click', (e) => {
      if (openMenu && !openMenu.contains(e.target)) closeMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenu();
    });

    function menuFor(item, anchor) {
      closeMenu();
      const menu = document.createElement('div');
      menu.className = 'ctx-menu';
      const mk = (label, handler, danger) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ctx-item' + (danger ? ' danger' : '');
        b.textContent = label;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          closeMenu();
          handler();
        });
        menu.appendChild(b);
      };
      mk('重命名', () => doRename(item));
      mk('更换图标', () => doIcon(item));
      mk('删除客户端', () => doDelete(item), true);

      host.appendChild(menu);
      const r = anchor.getBoundingClientRect();
      const hr = host.getBoundingClientRect();
      menu.style.left = Math.round(r.right - hr.left - menu.offsetWidth) + 'px';
      menu.style.top = Math.round(r.bottom - hr.top + 6) + 'px';
      openMenu = menu;
    }

    async function doLaunch(item) {
      const res = await window.forgeGui.launchClient(item.exePath);
      if (res && res.ok) toast('已启动：' + item.name);
      else toast('启动失败：' + ((res && res.error) || '未知错误'), 'error');
    }

    async function doRename(item) {
      const name = await askText(host, {
        title: '重命名客户端',
        sub: '改的是 exe 文件名，同目录的 Start *.cmd 会一起更新',
        value: item.name,
      });
      if (!name || name === item.name) return;
      const res = await window.forgeGui.renameClient(item.exePath, name);
      if (res && res.ok) {
        toast('已重命名为：' + name);
        refresh();
      } else {
        toast('重命名失败：' + ((res && res.error) || '未知错误'), 'error');
      }
    }

    async function doIcon(item) {
      const res = await window.forgeGui.setClientIcon(item.exePath);
      if (res && res.ok) {
        toast('图标已更新，重启客户端生效');
        refresh();
      } else if (!(res && res.canceled)) {
        toast('更换图标失败：' + ((res && res.error) || '未知错误'), 'error');
      }
    }

    async function doDelete(item) {
      const ok = await askConfirm(host, {
        title: '删除客户端？',
        body: `会删掉整个文件夹（含 exe、zip、源码）：\nCloudgame\\${item.host}\n\n这个操作不可恢复。`,
        okText: '删除',
      });
      if (!ok) return;
      const res = await window.forgeGui.deleteClient(item.exePath);
      if (res && res.ok) {
        toast('已删除：' + item.name);
        refresh();
      } else {
        toast('删除失败：' + ((res && res.error) || '未知错误'), 'error');
      }
    }

    function buildRow(item) {
      const row = document.createElement('div');
      row.className = 'client';

      const icon = document.createElement('img');
      icon.className = 'client-icon';
      icon.alt = '';
      if (item.icon) icon.src = item.icon;
      else icon.style.visibility = 'hidden';

      const meta = document.createElement('div');
      meta.className = 'client-meta';
      const name = document.createElement('div');
      name.className = 'client-name';
      name.textContent = item.name;
      const sub = document.createElement('div');
      sub.className = 'client-sub';
      sub.textContent = [item.host, fmtSize(item.size), fmtDate(item.mtime)].filter(Boolean).join(' · ');
      meta.appendChild(name);
      meta.appendChild(sub);

      const actions = document.createElement('div');
      actions.className = 'client-actions';

      const btnLaunch = document.createElement('button');
      btnLaunch.className = 'mini-btn strong';
      btnLaunch.type = 'button';
      btnLaunch.textContent = '启动';
      btnLaunch.addEventListener('click', (e) => {
        e.stopPropagation();
        doLaunch(item);
      });

      const btnFolder = document.createElement('button');
      btnFolder.className = 'mini-btn';
      btnFolder.type = 'button';
      btnFolder.textContent = '文件夹';
      btnFolder.addEventListener('click', (e) => {
        e.stopPropagation();
        window.forgeGui.reveal(item.exePath);
      });

      const btnMore = document.createElement('button');
      btnMore.className = 'mini-btn ghost more';
      btnMore.type = 'button';
      btnMore.textContent = '⋯';
      btnMore.title = '更多';
      btnMore.addEventListener('click', (e) => {
        e.stopPropagation();
        if (openMenu) {
          closeMenu();
          return;
        }
        menuFor(item, btnMore);
      });

      actions.appendChild(btnLaunch);
      actions.appendChild(btnFolder);
      actions.appendChild(btnMore);

      row.appendChild(icon);
      row.appendChild(meta);
      row.appendChild(actions);
      row.addEventListener('dblclick', () => doLaunch(item));
      return row;
    }

    async function refresh() {
      if (refreshing) return;
      refreshing = true;
      try {
        closeMenu();
        const list = (await window.forgeGui.listClients()) || [];
        if (countEl) countEl.textContent = String(list.length);
        listEl.innerHTML = '';
        if (!list.length) {
          if (emptyEl) emptyEl.classList.remove('hidden');
          if (subEl) subEl.textContent = '从 Cloudgame\\ 扫到的成品，双击卡片或点「启动」直接运行';
          return;
        }
        if (emptyEl) emptyEl.classList.add('hidden');
        if (subEl) subEl.textContent = `共 ${list.length} 个 · 双击卡片或点「启动」直接运行`;
        for (const item of list) listEl.appendChild(buildRow(item));
      } finally {
        refreshing = false;
      }
    }

    return { refresh, toast };
  }

  window.CloudClientsView = { mount };
})();
